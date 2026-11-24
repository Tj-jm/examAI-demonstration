const asyncHandler = require("express-async-handler");
const { TYPES, WORDS, publicInstitution } = require("../../utils/institution");
const AiConfig = require("../../models/aiConfigModel");
const AppSettings = require("../../models/appSettingsModel");
const storage = require("../../adapters/storage");
const sms = require("../../adapters/sms");
const email = require("../../adapters/email");
const payment = require("../../adapters/payment");
const PaymentGateway = require("../../models/paymentGatewayModel");
const ai = require("../../ai/service");
const schemas = require("../../ai/schemas");
const prompts = require("../../ai/prompts");
const { LEVEL_BANDS } = require("../../utils/levelTitles");
const phoneCountries = require("../../utils/phoneCountries");
const { validPattern } = require("../../utils/studentIdPattern");
const mascot = require("../../utils/mascot");

// One settings document drives both panels. The admin panel's own theme is a
// personal, per-browser preference (see uiSlice.js) and deliberately does not
// live here — studentUi does, because it has to be the same for every
// student, set once by whoever runs the institution.

// Outside production, registration works with no SMTP or SMS gateway set up
// at all — the verification code is echoed straight into the register
// response (see app/authController.js) so the whole flow is testable with
// zero third-party accounts. That fallback is what makes a channel usable,
// not just its own configured() check, and both places that decide whether
// a channel can be offered — this file and app/publicController.js — have
// to agree on the same definition of "available" or one of them ends up
// offering a signup method the other silently refuses.
const devFallback = process.env.NODE_ENV !== "production";
const emailAvailable = () => email.configured() || devFallback;
const phoneAvailable = () => sms.configured() || devFallback;

//@desc   Read platform settings, plus live adapter status for the UI to
//        gate options against (an admin should not be able to select "phone"
//        signup if no SMS gateway is actually configured — unless the dev
//        fallback covers it)
//@route  GET /api/settings
//@access Private
const getSettings = asyncHandler(async (req, res) => {
  const settings = await AppSettings.get();

  res.status(200).json({
    ...settings.toObject(),
    terms: publicInstitution(settings).terms,
    phoneCountries: phoneCountries.ALL,
    adapters: {
      sms: sms.list(),
      email: { configured: email.configured() },
      payment: await payment.list(),
      devFallback,
      emailAvailable: emailAvailable(),
      phoneAvailable: phoneAvailable(),
    },
  });
});

const UPDATABLE_TOP = ["siteName", "defaultCurrency", "defaultLocale", "manualPaymentMethods"];

//@desc   Update platform settings
//@route  PUT /api/settings
//@access Private (owner, admin)
const updateSettings = asyncHandler(async (req, res) => {
  const settings = await AppSettings.get();

  for (const key of UPDATABLE_TOP) {
    if (req.body[key] !== undefined) settings[key] = req.body[key];
  }

  if (req.body.studentUi) {
    const ui = { ...req.body.studentUi };
    if (ui.videoPlayer !== undefined) {
      const vp = ui.videoPlayer || {};
      ui.videoPlayer = {
        accent: /^#[0-9a-f]{6}$/i.test(vp.accent || "") ? vp.accent : "",
        skip: [5, 10, 15, 30].includes(Number(vp.skip)) ? Number(vp.skip) : 10,
        startQuality: vp.startQuality === "best" ? "best" : "auto",
      };
    }
    // One name per level band, short enough to fit the progress card.
    if (ui.levelTitles !== undefined) {
      ui.levelTitles = Array.isArray(ui.levelTitles)
        ? LEVEL_BANDS.map((_, i) => String(ui.levelTitles[i] ?? "").trim().slice(0, 24))
        : undefined;
    }
    if (ui.errorMessages !== undefined) {
      const em = ui.errorMessages || {};
      const clip = (s, n) => String(s ?? "").trim().slice(0, n);
      ui.errorMessages = {
        general: clip(em.general, 200),
        network: clip(em.network, 200),
        rules: (Array.isArray(em.rules) ? em.rules : [])
          .map((r) => ({ match: clip(r?.match, 200), text: clip(r?.text, 200) }))
          .filter((r) => r.match && r.text)
          .slice(0, 50),
      };
    }
    if (ui.mascot !== undefined) {
      const m = ui.mascot || {};
      const before = settings.studentUi.mascot?.toObject?.() || {};
      ui.mascot = {
        enabled: m.enabled !== undefined ? Boolean(m.enabled) : Boolean(before.enabled),
        name: String(m.name ?? before.name ?? "").trim().slice(0, 30),
        preset: ["pip", "nib", "spark", "custom"].includes(m.preset) ? m.preset : before.preset || "pip",
        custom: m.custom !== undefined ? mascot.cleanCharacter(m.custom) : before.custom || null,
        built: m.built !== undefined ? mascot.cleanBuilt(m.built) : before.built || null,
        description: String(m.description ?? before.description ?? "").trim().slice(0, 600),
        peekMinutes: Math.min(60, Math.max(0, Math.round(Number(m.peekMinutes ?? before.peekMinutes ?? 4)) || 0)),
        cheer: m.cheer !== undefined ? Boolean(m.cheer) : before.cheer !== false,
      };
      if (ui.mascot.preset === "custom" && !ui.mascot.custom) {
        res.status(400);
        throw new Error("Draw a mascot from a description first, or pick a built-in one.");
      }
    }
    settings.studentUi = { ...settings.studentUi.toObject(), ...ui };
  }

  if (req.body.institution) {
    const inst = req.body.institution;
    const next = settings.institution?.toObject?.() || {};
    if (inst.type !== undefined) {
      if (!TYPES.includes(inst.type)) {
        res.status(400);
        throw new Error(`Institution type is one of: ${TYPES.join(", ")}.`);
      }
      next.type = inst.type;
    }
    if (inst.labels) {
      next.labels = { ...(next.labels || {}) };
      for (const w of WORDS) {
        if (inst.labels[w] !== undefined) next.labels[w] = String(inst.labels[w] || "").trim().slice(0, 40);
      }
    }
    if (inst.sales !== undefined) next.sales = Boolean(inst.sales);
    if (inst.studentIdLogin !== undefined) next.studentIdLogin = Boolean(inst.studentIdLogin);
    if (inst.studentIdPattern !== undefined) {
      try { next.studentIdPattern = validPattern(inst.studentIdPattern); } catch (e) { res.status(400); throw e; }
    }
    settings.institution = next;
  }

  if (req.body.referrals) {
    const r = req.body.referrals;
    const next = settings.referrals?.toObject?.() || {};
    const reward = { ...(next.reward || {}) };
    const num = (v, min, max) => Math.min(max, Math.max(min, Number(v) || 0));
    const type = (v) => {
      if (!["percent", "fixed"].includes(v)) { res.status(400); throw new Error("A discount is a percent or a fixed amount."); }
      return v;
    };
    if (r.enabled !== undefined) next.enabled = Boolean(r.enabled);
    if (r.newStudentsOnly !== undefined) next.newStudentsOnly = Boolean(r.newStudentsOnly);
    if (r.discountType !== undefined) next.discountType = type(r.discountType);
    if (r.discountValue !== undefined) next.discountValue = num(r.discountValue, 0, 1e9);
    const rw = r.reward || {};
    if (rw.kind !== undefined) {
      if (!["coupon", "aiCredits", "none"].includes(rw.kind)) { res.status(400); throw new Error("The reward is a coupon, AI credits or nothing."); }
      reward.kind = rw.kind;
    }
    if (rw.discountType !== undefined) reward.discountType = type(rw.discountType);
    if (rw.discountValue !== undefined) reward.discountValue = num(rw.discountValue, 0, 1e9);
    if (rw.validDays !== undefined) reward.validDays = Math.round(num(rw.validDays, 1, 3650));
    if (rw.credits !== undefined) reward.credits = Math.round(num(rw.credits, 0, 1e6));
    if (rw.maxPerStudent !== undefined) reward.maxPerStudent = Math.round(num(rw.maxPerStudent, 0, 1e6));
    for (const [t, v] of [[next.discountType, next.discountValue], [reward.discountType, reward.discountValue]]) {
      if (t === "percent" && v > 100) { res.status(400); throw new Error("A percent discount is at most 100."); }
    }
    next.reward = reward;
    settings.referrals = next;
  }

  if (req.body.grading) {
    const g = req.body.grading;
    const next = settings.grading?.toObject?.() || {};
    if (g.payMode !== undefined) {
      if (!["question", "script"].includes(g.payMode)) { res.status(400); throw new Error("Pay is by question or by script."); }
      next.payMode = g.payMode;
    }
    for (const k of ["ratePerQuestion", "ratePerScript"]) {
      if (g[k] !== undefined) next[k] = Math.max(0, Number(g[k]) || 0);
    }
    for (const k of ["stuckHours", "regradeHours"]) {
      if (g[k] !== undefined) next[k] = Math.min(720, Math.max(1, Math.round(Number(g[k]) || 24)));
    }
    settings.grading = next;
  }

  if (req.body.teamPay) {
    const t = req.body.teamPay;
    const next = settings.teamPay?.toObject?.() || {};
    if (t.doubtRate !== undefined) next.doubtRate = Math.max(0, Number(t.doubtRate) || 0);
    if (t.sellerPercent !== undefined) next.sellerPercent = Math.min(100, Math.max(0, Number(t.sellerPercent) || 0));
    settings.teamPay = next;
  }

  if (req.body.classPay) {
    const c = req.body.classPay;
    const next = settings.classPay?.toObject?.() || {};
    const num = (v, min, max) => Math.min(max, Math.max(min, Number(v) || 0));
    if (c.minMinutes !== undefined) next.minMinutes = Math.round(num(c.minMinutes, 0, 600));
    if (c.payEmpty !== undefined) next.payEmpty = Boolean(c.payEmpty);
    if (c.roundMinutes !== undefined) next.roundMinutes = [1, 5, 15, 30].includes(Number(c.roundMinutes)) ? Number(c.roundMinutes) : 15;
    if (c.graceMinutes !== undefined) next.graceMinutes = Math.round(num(c.graceMinutes, 0, 600));
    if (c.lateCancelHours !== undefined) next.lateCancelHours = num(c.lateCancelHours, 0, 168);
    if (c.lateCancelPercent !== undefined) next.lateCancelPercent = num(c.lateCancelPercent, 0, 100);
    if (c.noShowDeduction !== undefined) next.noShowDeduction = num(c.noShowDeduction, 0, 1e9);
    settings.classPay = next;
  }

  if (req.body.receiptInfo) {
    const current = settings.receiptInfo.toObject();
    settings.receiptInfo = { ...current, ...req.body.receiptInfo, tax: { ...(current.tax || {}), ...(req.body.receiptInfo.tax || {}) } };
  }

  if (req.body.videoBoard) {
    const vb = { ...req.body.videoBoard };
    for (const k of ["board", "ink", "accent"]) {
      if (vb[k] !== undefined && vb[k] !== null && !/^#[0-9a-f]{6}$/i.test(vb[k])) {
        res.status(400);
        throw new Error("Board colours are hex values like #1e3b2f.");
      }
    }
    if (vb.callouts !== undefined && !["soft", "sticky", "marker", "card", "quote", "plain"].includes(vb.callouts)) delete vb.callouts;
    for (const k of ["paper", "paperInk", "paperBg", "paperAccent", "mascot", "mascotBubbles"]) delete vb[k];
    settings.videoBoard = { ...(settings.videoBoard?.toObject?.() || {}), ...vb };
  }

  if (req.body.liveRoom) {
    settings.liveRoom = { ...(settings.liveRoom?.toObject?.() || {}), ...req.body.liveRoom };
  }

  if (req.body.seo) {
    settings.seo = { ...settings.seo.toObject(), ...req.body.seo };
  }

  if (req.body.studentAuth) {
    const current = settings.studentAuth?.toObject?.() || settings.studentAuth || {};
    const identifier = req.body.studentAuth.identifier ?? current.identifier;

    // Offering a channel that cannot actually deliver anything is worse than
    // not offering it — a student would type in a phone number and never
    // receive a code, with no way to know why. In development the dev-mode
    // echo stands in for real delivery, so this only truly blocks a channel
    // in production.
    if (identifier === "phone" && !phoneAvailable()) {
      res.status(400);
      throw new Error("No SMS gateway is configured (SMS_PROVIDER in the environment). Phone signup cannot be offered yet.");
    }
    if (identifier === "both" && !(phoneAvailable() && emailAvailable())) {
      res.status(400);
      throw new Error("Both email and SMS need to be configured before offering both as signup options.");
    }
    if (identifier === "email" && !emailAvailable()) {
      res.status(400);
      throw new Error("SMTP is not configured (SMTP_HOST, SMTP_USER, SMTP_PASS). Email signup cannot be offered yet.");
    }

    const next = { ...current, identifier };
    if (req.body.studentAuth.codeLogin !== undefined) next.codeLogin = Boolean(req.body.studentAuth.codeLogin);
    if (req.body.studentAuth.countries !== undefined) {
      next.countries = phoneCountries.valid(req.body.studentAuth.countries);
      if (!next.countries.length) {
        res.status(400);
        throw new Error("Pick at least one country for phone numbers.");
      }
    }
    if (req.body.studentAuth.defaultCountry !== undefined) next.defaultCountry = String(req.body.studentAuth.defaultCountry).toUpperCase();
    // The default must be one of the offered countries.
    if (!(next.countries || []).includes(next.defaultCountry)) next.defaultCountry = (next.countries || ["BD"])[0];
    settings.studentAuth = next;
  }

  if (req.body.modules) {
    settings.modules = { ...settings.modules.toObject(), ...req.body.modules };
  }

  if (req.body.notificationSettings) {
    settings.notificationSettings = {
      ...settings.notificationSettings.toObject(),
      ...req.body.notificationSettings,
    };
  }

  await settings.save();
  // Referral codes follow the discount and the on/off switch (and Sell
  // access, which also turns referrals off).
  if (req.body.referrals || req.body.institution) await require("../../utils/referrals").syncReferralCodes(settings);
  res.status(200).json(settings);
});

//@desc   Upload the platform logo
//@route  POST /api/settings/logo
//@access Private (owner, admin)
const uploadLogo = asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400);
    throw new Error("No file was received.");
  }

  const stored = await storage.store("branding", req.file);
  const url = await storage.urlFor(stored.key, stored.driver);

  const settings = await AppSettings.get();
  settings.logo = url;
  await settings.save();

  res.status(200).json({ logo: url });
});

//@desc   Upload the platform favicon (PNG or ICO)
//@route  POST /api/settings/favicon
//@access Private (owner, admin)
const uploadFavicon = asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400);
    throw new Error("No file was received.");
  }

  const stored = await storage.store("branding", req.file);
  const url = await storage.urlFor(stored.key, stored.driver);

  const settings = await AppSettings.get();
  settings.favicon = url;
  await settings.save();

  res.status(200).json({ favicon: url });
});

const FEATURE_ICON_KEYS = [
  "lectures", "practice", "exams", "results", "doubts", "notices", "leaderboard",
  // Present on the student "Jump to" grid (BatchHome.jsx) but missing from
  // this allowlist until now — liveClasses and studyPlan already passed a
  // featureKey through to FeatureIcon, so a custom icon for them would have
  // silently 400'd on upload; aiCredits had no featureKey at all, fixed in
  // BatchHome.jsx alongside this.
  "liveClasses", "studyPlan", "aiCredits",
  // Added alongside the batch-module pivot — archive is a real "Jump to"
  // tile (BatchHome.jsx) same as any other, and needs the same icon/name
  // override support, not a second-class one missing from this list.
  "archive",
  // The archive's own internal hub (ArchiveHome.jsx) — its four tiles get
  // the same icon/name override treatment as BatchHome's own grid.
  "archiveBrowse", "archiveStudyPlan", "archiveExam", "archiveFavorites",
  // My progress, My tutor and Ask your course tiles.
  "progress", "tutor", "docChat",
  // Oral Quiz: the AI teacher asks, the student answers.
  "poraDhora",
  // AI Tutoring: a written lesson check.
  "aiTutor",
  // Interview practice: a viva or interview panel.
  "interview",
];

//@desc   Upload a custom image for one feature's icon on the student
//        "Jump to" grid
//@route  POST /api/settings/feature-icon/:feature
//@access Private (owner, admin)
const uploadFeatureIcon = asyncHandler(async (req, res) => {
  if (!FEATURE_ICON_KEYS.includes(req.params.feature)) {
    res.status(400);
    throw new Error(`Unknown feature "${req.params.feature}".`);
  }
  if (!req.file) {
    res.status(400);
    throw new Error("No file was received.");
  }

  const stored = await storage.store("feature-icons", req.file);
  const url = await storage.urlFor(stored.key, stored.driver);

  const settings = await AppSettings.get();
  // Reassigning the whole studentUi object (not just the nested
  // featureIcons path within it) — verified directly that only this level
  // of reassignment gets tracked by Mongoose's change detection here;
  // studentUi is a plain nested schema, not its own sub-document with
  // independent tracking, so a change two levels deep silently never
  // reaches isModified and .save() would persist nothing.
  const currentFeatureIcons = settings.studentUi.featureIcons?.toObject
    ? settings.studentUi.featureIcons.toObject()
    : (settings.studentUi.featureIcons || {});
  settings.studentUi = {
    ...settings.studentUi.toObject(),
    featureIcons: { ...currentFeatureIcons, [req.params.feature]: { kind: "custom", value: url } },
  };
  await settings.save();

  res.status(200).json({ featureIcons: settings.studentUi.featureIcons });
});

//@desc   Enable/configure one payment gateway. Several may be enabled at
//        once — which one a given charge uses is decided per currency at
//        checkout time, not here.
//@route  PUT /api/settings/payment/:provider
//@access Private (owner, admin)
//
// Secrets are write-only over this API. A value posted here is encrypted and
// stored; nothing in any response ever contains a decrypted credential, only
// the last four characters as proof one is present. There is deliberately no
// GET that returns a secret — see models/paymentGatewayModel.js.
const updatePaymentGateway = asyncHandler(async (req, res) => {
  const provider = String(req.params.provider || "").toLowerCase();
  const driver = payment.driverFor(provider);

  if (!driver) {
    res.status(404);
    throw new Error(`Unknown payment provider "${provider}".`);
  }

  let gateway = await PaymentGateway.forProvider(provider, { withSecrets: true });
  if (!gateway) {
    gateway = new PaymentGateway({ provider });
  }

  if (req.body.enabled !== undefined) gateway.enabled = Boolean(req.body.enabled);
  if (req.body.priority !== undefined) gateway.priority = Number(req.body.priority) || 0;
  if (Array.isArray(req.body.currencies)) gateway.currencies = req.body.currencies;

  // Only fields this driver actually declares are accepted, so a typo'd or
  // injected key cannot quietly accumulate in the document.
  for (const field of driver.credentials) {
    const submitted = req.body.credentials?.[field.key];
    if (submitted === undefined) continue;

    // A field supplied by the environment is not writable from the UI. The
    // environment wins at read time regardless, so accepting a value here
    // would store something that could never take effect — worse than
    // refusing it, because the admin would believe it had.
    if (field.envVar && process.env[field.envVar]) continue;

    if (field.secret) {
      gateway.setSecret(field.key, submitted);
    } else {
      if (!gateway.config) gateway.config = new Map();
      const value = String(submitted).trim();
      if (value) gateway.config.set(field.key, value);
      else gateway.config.delete(field.key);
    }
  }

  // Enabling a gateway that cannot actually charge anyone is the payment
  // equivalent of offering a signup channel that cannot deliver a code —
  // refused here for the same reason that check exists above.
  if (gateway.enabled) {
    const creds = payment.resolveCredentials(driver, gateway);
    const missing = payment.missingCredentials(driver, creds);
    if (missing.length) {
      res.status(400);
      throw new Error(
        `${driver.label} cannot be enabled yet — still missing: ${missing.join(", ")}.`
      );
    }
  }

  await gateway.save();

  res.status(200).json({ gateway: gateway.toSafeJSON(), adapters: { payment: await payment.list() } });
});


//@desc   AI-drafted meta title/description/keywords for the landing page,
//        from a plain-language description of what the institution offers.
//        Admin-only tool, not student-billed — same reasoning as
//        question_generation: no student/batch context exists for this.
//@route  POST /api/settings/seo/suggest
//@access Private (owner, admin)
const suggestSeoMeta = asyncHandler(async (req, res) => {
  if (!(await AiConfig.get()).features.seoSuggest) {
    res.status(403);
    throw new Error("SEO suggestions are switched off in AI settings.");
  }

  // One course's page: drafted from the course itself, plus anything typed.
  let course = null;
  if (req.body.batch) {
    const Batch = require("../../models/batchModel");
    const b = /^[a-f0-9]{24}$/i.test(String(req.body.batch))
      ? await Batch.findById(req.body.batch).select("name description accessType program").populate("program", "title description")
      : null;
    if (!b) {
      res.status(404);
      throw new Error("Course not found.");
    }
    course = [
      `Course: ${b.name}`,
      b.program?.title && `Program: ${b.program.title}`,
      b.accessType === "free" && "Free to join",
      b.description && `About: ${String(b.description).slice(0, 1500)}`,
      b.program?.description && `About the program: ${String(b.program.description).slice(0, 800)}`,
    ].filter(Boolean).join("\n");
  }

  const context = String(req.body.context || "").trim();
  if (!context && !course) {
    res.status(400);
    throw new Error("Describe what this institution teaches or offers — the suggestion is drafted from that.");
  }

  const settings = await AppSettings.get();
  const prompt = prompts.suggestSeoMeta({ siteName: settings.siteName, context, course });

  const { data } = await ai.generate({
    feature: "seo-meta-suggest",
    schema: schemas.seoMetaSuggestion,
    ...prompt,
  });

  res.status(200).json(data);
});

//@desc   Every course's public page and its search and share tags
//@route  GET /api/settings/seo/courses
//@access Private (owner, admin)
const listCourseSeo = asyncHandler(async (req, res) => {
  const Batch = require("../../models/batchModel");
  const { ensureSlugs } = require("../../utils/courseSlug");
  const { plain } = require("../../utils/pageMeta");
  const settings = await AppSettings.get();
  const batches = await ensureSlugs(
    await Batch.find({}).select("name slug description isActive program seo").populate({ path: "program", select: "title description image isActive", populate: { path: "image" } }).sort({ name: 1 })
  );
  const { shape: shapeMedia } = require("./mediaController");
  const covers = await Promise.all(batches.map((b) => (b.program?.image ? shapeMedia(b.program.image).catch(() => null) : null)));
  // Where the student app lives, for the page links.
  const base = require("../../utils/pageMeta").siteBase(req, settings);
  res.status(200).json({ base, courses: batches.map((b, i) => ({
    _id: b._id,
    name: b.name,
    slug: b.slug,
    isActive: b.isActive && b.program?.isActive !== false,
    program: b.program?.title || "",
    seo: { metaTitle: "", metaDescription: "", keywords: [], ogImage: "", ...(b.seo?.toObject?.() || b.seo || {}) },
    // What the page uses when a field is left empty (utils/pageMeta.js).
    auto: {
      metaTitle: `${b.name}${b.program?.title ? ` · ${b.program.title}` : ""} | ${settings.siteName || "ExamAI"}`,
      metaDescription: plain(b.description || b.program?.description) || settings.seo?.metaDescription || "",
      ogImage: covers[i]?.url || settings.seo?.ogImage || "",
    },
  })) });
});

//@desc   Set one course page's search and share tags
//@route  PUT /api/settings/seo/courses/:id  { metaTitle, metaDescription, keywords, ogImage }
//@access Private (owner, admin)
const updateCourseSeo = asyncHandler(async (req, res) => {
  const Batch = require("../../models/batchModel");
  const batch = /^[a-f0-9]{24}$/i.test(String(req.params.id)) ? await Batch.findById(req.params.id) : null;
  if (!batch) {
    res.status(404);
    throw new Error("Course not found.");
  }
  const b = req.body || {};
  const text = (v, n) => String(v || "").trim().slice(0, n);
  const image = text(b.ogImage, 1000);
  if (image && !/^(https?:\/\/|\/)/i.test(image)) {
    res.status(400);
    throw new Error("The share image must be a web address (https://…).");
  }
  batch.seo = {
    metaTitle: text(b.metaTitle, 120),
    metaDescription: text(b.metaDescription, 300),
    keywords: (Array.isArray(b.keywords) ? b.keywords : String(b.keywords || "").split(","))
      .map((k) => text(k, 60)).filter(Boolean).slice(0, 20),
    ogImage: image,
  };
  await batch.save();
  res.status(200).json({ _id: batch._id, seo: batch.seo });
});

//@desc   The built-in mascots, to preview and pick from
//@route  GET /api/settings/mascot/presets
//@access Private (admin)
const getMascotPresets = asyncHandler(async (req, res) => {
  res.status(200).json({
    presets: Object.entries(mascot.PRESETS).map(([key, p]) => ({ key, label: p.label, character: p.character })),
  });
});

//@desc   AI draws a mascot from a description (not saved: the admin
//        previews it, and Save keeps it)
//@route  POST /api/settings/mascot/generate  { description }
//@access Private (owner, admin)
const generateMascot = asyncHandler(async (req, res) => {
  const description = String(req.body.description || "").trim().slice(0, 600);
  if (description.length < 3) {
    res.status(400);
    throw new Error("Describe the mascot first: what it is, its colours, anything it holds.");
  }
  const { data } = await ai.generate({
    feature: "mascot",
    schema: schemas.mascotCharacter,
    user: req.user?._id,
    maxTokens: 4000,
    wrapLatex: false,
    ...prompts.mascotCharacter({ description, example: mascot.PRESETS.pip.character }),
  });
  const character = mascot.cleanCharacter(data);
  if (!character) {
    res.status(502);
    throw new Error("The AI's drawing didn't come out right. Try again, or describe it a little differently.");
  }
  res.status(200).json({ character });
});

module.exports = {
  getMascotPresets,
  generateMascot,
  getSettings, updateSettings, uploadLogo, uploadFavicon, uploadFeatureIcon, updatePaymentGateway, suggestSeoMeta,
  listCourseSeo, updateCourseSeo,
};
