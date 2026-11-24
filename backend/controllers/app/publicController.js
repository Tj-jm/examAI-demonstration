const asyncHandler = require("express-async-handler");
const cache = require("../../utils/cache");
const tags = require("../../utils/cacheTags");
const { publicInstitution } = require("../../utils/institution");
const phoneCountries = require("../../utils/phoneCountries");
const AppSettings = require("../../models/appSettingsModel");
const LandingPage = require("../../models/landingPageModel");
const Batch = require("../../models/batchModel");
const Notice = require("../../models/noticeModel");
const Update = require("../../models/updateModel");
const email = require("../../adapters/email");
const sms = require("../../adapters/sms");
const { shape: shapeMedia } = require("../admin/mediaController");
const User = require("../../models/userModel");
const { SELECT: TEACHER_FIELDS, PROFILE_ROLES, shapePublicTeachers, teachersByBatch } = require("../../utils/teacherProfile");
const { ensureSlugs } = require("../../utils/courseSlug");

const hasActiveProgram = (batch) => batch.program?.isActive !== false;

// The one endpoint the student app calls before a student exists at all —
// branding and theme, so the login screen already looks like the
// institution's before anyone has signed in. No auth, so kept to exactly
// what's safe to hand to an anonymous request.

// Same definition of "available" as admin/settingsController — outside
// production, the dev-mode OTP echo stands in for real delivery, so a
// channel with no SMTP/SMS gateway configured is still usable for testing.
// This has to match that file exactly, or an admin could select "email" in
// Settings (allowed there) only to have this endpoint silently downgrade it
// to "none" for actual students.
const devFallback = process.env.NODE_ENV !== "production";
const emailAvailable = () => email.configured() || devFallback;
const phoneAvailable = () => sms.configured() || devFallback;

// No enrollment concept exists for an anonymous visitor — this is
// shapeBatch's (app/batchController.js) public-facing cousin, always
// showing plans (there's no "already enrolled" to hide them for) and
// never resolving per-student access at all.
const shapePublicBatch = async (batch, teachers = []) => ({
  _id: batch._id,
  slug: batch.slug || null,
  name: batch.name,
  icon: batch.icon,
  description: batch.description || null,
  accessType: batch.accessType,
  program: batch.program && {
    _id: batch.program._id,
    title: batch.program.title,
    icon: batch.program.icon,
    iconColor: batch.program.iconColor,
    description: batch.program.description || null,
    image: batch.program.image ? await shapeMedia(batch.program.image) : null,
    order: batch.program.order,
    isActive: batch.program.isActive,
  },
  features: batch.features,
  plans: batch.plans.filter((p) => p.isActive),
  teachers,
});

// The landing page's teachers section: the ones the admin picked, in their
// order, or every teacher with a public profile.
const landingTeachers = async (content = {}) => {
  const picked = (content.teacherIds || []).map(String).filter((id) => /^[a-f0-9]{24}$/.test(id));
  if (picked.length) {
    const users = await User.find({ _id: { $in: picked } }).select(TEACHER_FIELDS).lean();
    const byId = new Map(users.map((u) => [String(u._id), u]));
    return shapePublicTeachers(picked.map((id) => byId.get(id)).filter(Boolean));
  }
  const users = await User.find({ role: { $in: [...PROFILE_ROLES] }, isActive: true, isDeleted: { $ne: true }, "profile.public": { $ne: false } })
    .select(TEACHER_FIELDS).sort({ name: 1 }).limit(60).lean();
  return shapePublicTeachers(users);
};

const shapeNotice = async (notice) => {
  const doc = typeof notice.toObject === "function" ? notice.toObject() : notice;
  return {
    title: doc.title,
    bodyMarkdown: doc.bodyMarkdown,
    icon: doc.icon,
    link: doc.link,
    linkLabel: doc.linkLabel,
    publishFrom: doc.publishFrom,
    createdAt: doc.createdAt,
    coverImage: doc.coverImage ? await shapeMedia(doc.coverImage) : null,
  };
};

// Capped well below getGeneralNotices' own 20 — three is a slider, not a
// scrollable list, and this is a first impression for someone who hasn't
// signed up yet, not the ongoing homepage a student checks daily.
const LANDING_NOTICE_LIMIT = 3;
const LANDING_UPDATE_LIMIT = 5;

//@desc   The public landing page — its section configuration, plus live
//        data (catalogue, notices, updates) for whichever of those
//        sections are actually enabled. Only ever returns enabled
//        sections; the admin editor (landingPageController.js's
//        getLandingPage) is the one that also needs to see disabled ones.
//@route  GET /api/app/landing-page
//@access Public
const getPublicLandingPage = asyncHandler(async (req, res) => {
  // The same for every visitor: cached until the page, a batch, program,
  // notice, update or the settings change. Notices and updates scheduled to
  // go live later appear within LANDING_TTL_S of their time.
  const body = await cache.wrap("landing:page", [tags.LANDING, tags.BATCHES, tags.NOTICES], buildLandingPage, {
    group: "landing",
    ttlS: LANDING_TTL_S,
  });
  res.status(200).json(body);
});

const LANDING_TTL_S = 300;

const buildLandingPage = async () => {
  const [page, settings] = await Promise.all([LandingPage.get(), AppSettings.get()]);
  const enabled = page.sections.filter((s) => s.enabled);

  const needsCatalogue = enabled.some((s) => s.type === "catalogue" || (s.type === "interest" && s.content?.askBatch !== false));
  const needsNotices = enabled.some((s) => s.type === "notices");
  const needsUpdates = enabled.some((s) => s.type === "updates");
  const teachersSection = enabled.find((s) => s.type === "teachers");

  const [catalogue, notices, updates, teachers] = await Promise.all([
    needsCatalogue
        ? Batch.find({ isActive: true })
            .populate({ path: "program", select: "title icon iconColor description image order isActive", populate: { path: "image" } })
            .populate({ path: "teachers", select: TEACHER_FIELDS })
            .sort({ "program.order": 1, order: 1, name: 1 })
            .then((batches) => batches.filter(hasActiveProgram))
            .then((batches) => (settings.seo?.coursePages ? ensureSlugs(batches) : batches))
            .then(async (batches) => {
              const byBatch = await teachersByBatch(batches);
              return Promise.all(batches.map((b) => shapePublicBatch(b, byBatch.get(String(b._id)))));
            })
      : Promise.resolve([]),
    needsNotices
      ? Notice.find(Notice.liveQuery({ noticeType: "general" }))
          .populate("coverImage")
          .sort({ createdAt: -1 })
          .limit(LANDING_NOTICE_LIMIT)
          .lean()
          .then((docs) => Promise.all(docs.map(shapeNotice)))
      : Promise.resolve([]),
    needsUpdates
      ? Update.find({ isActive: true, publishedAt: { $lte: new Date() } })
          .sort({ publishedAt: -1 })
          .limit(LANDING_UPDATE_LIMIT)
          .select("title body link publishedAt")
      : Promise.resolve([]),
    teachersSection ? landingTeachers(teachersSection.content) : Promise.resolve([]),
  ]);

  return JSON.parse(JSON.stringify({
    sections: enabled.map((s) => ({ _id: s._id, type: s.type, content: s.content })),
    catalogue,
    notices,
    updates,
    teachers,
    defaultCurrency: settings.defaultCurrency || "USD",
  }));
};

//@desc   Public branding/theme settings for the student app
//@route  GET /api/app/settings
//@access Public
const getPublicSettings = asyncHandler(async (req, res) => {
  const settings = await AppSettings.get();

  const emailOk = emailAvailable();
  const smsOk = phoneAvailable();
  let identifier = settings.studentAuth.identifier;
  if (identifier === "both") {
    identifier = emailOk && smsOk ? "both" : emailOk ? "email" : smsOk ? "phone" : "none";
  } else if ((identifier === "email" && !emailOk) || (identifier === "phone" && !smsOk)) {
    identifier = "none";
  }

  res.status(200).json({
    siteName: settings.siteName,
    logo: settings.logo || null,
    favicon: settings.favicon || null,
    studentUi: settings.studentUi,
    mascot: require("../../utils/mascot").forStudents(settings.studentUi?.mascot),
    auth: {
      identifier,
      studentIdLogin: settings.institution?.studentIdLogin === true,
      codeLogin: settings.studentAuth.codeLogin !== false,
      countries: phoneCountries.offered(settings.studentAuth),
      whatsappCodes: sms.whatsappCodes(),
    },
    modules: settings.modules,
    // The institution's words for batches/programs/teachers, and whether it sells.
    institution: publicInstitution(settings),
    // Business contact info, not branding — only read by the receipt page.
    // Safe for an anonymous request the same way siteName/logo already are:
    // nothing here is more sensitive than what's printed on a storefront.
    receiptInfo: settings.receiptInfo || {},
    // Meta tags for the landing page — public the same way siteName/logo
    // already are, read by an anonymous browser and by crawlers alike.
    seo: settings.seo || {},
    // The in-app classroom's look — public like the rest of the branding.
    liveRoom: settings.liveRoom || {},
  });
});

// One course's public page (Settings → SEO → Course pages): what the
// landing page's pop-up shows, plus what's inside it and the program's
// other courses. Also used by app.js to fill the page's meta tags for
// crawlers and link previews.
const buildCoursePage = async (slug) => {
  const settings = await AppSettings.get();
  if (!settings.seo?.coursePages) return null;
  const key = String(slug || "").toLowerCase().slice(0, 120);
  const batch = await Batch.findOne({ slug: key, isActive: true })
    .populate({ path: "program", select: "title icon iconColor description image order isActive", populate: { path: "image" } })
    .populate({ path: "teachers", select: TEACHER_FIELDS });
  if (!batch || !hasActiveProgram(batch)) return null;

  const Lecture = require("../../models/lectureModel");
  const Exam = require("../../models/examModel");
  const LiveClass = require("../../models/liveClassModel");
  const [byBatch, lectures, exams, liveUpcoming, siblings] = await Promise.all([
    teachersByBatch([batch]),
    Lecture.countDocuments({ batches: batch._id, isPublished: { $ne: false } }),
    Exam.countDocuments({ batches: batch._id, isActive: { $ne: false }, isPublished: true }),
    LiveClass.countDocuments({ batch: batch._id, status: { $in: ["scheduled", "live"] }, scheduledAt: { $gte: new Date(Date.now() - 3 * 3600 * 1000) } }),
    Batch.find({ program: batch.program._id, isActive: true, _id: { $ne: batch._id } }).select("name slug icon accessType plans").sort({ order: 1, name: 1 }).limit(6),
  ]);
  await ensureSlugs(siblings);
  const course = await shapePublicBatch(batch, byBatch.get(String(batch._id)));
  return JSON.parse(JSON.stringify({
    design: settings.seo.courseDesign || "spotlight",
    // null: the page wears the student app's own theme.
    theme: settings.seo.courseTheme && settings.seo.courseTheme !== "app"
      ? { name: settings.seo.courseTheme, custom: settings.seo.courseTheme === "custom" ? settings.seo.courseCustomTheme : null }
      : null,
    currency: settings.defaultCurrency || "USD",
    siteName: settings.siteName || "",
    course: {
      ...course,
      stats: { lectures, exams, liveUpcoming },
    },
    // The page's own search and share tags, as set in Settings → SEO.
    seo: batch.seo || {},
    related: siblings.map((b) => ({ _id: b._id, slug: b.slug, name: b.name, icon: b.icon, accessType: b.accessType, from: (b.plans || []).filter((p) => p.isActive).map((p) => p.price).filter((n) => Number.isFinite(n)).sort((a, z) => a - z)[0] ?? null })),
  }));
};

//@desc   A course's public page
//@route  GET /api/app/courses/:slug
//@access Public
const getCoursePage = asyncHandler(async (req, res) => {
  const key = `landing:course:${String(req.params.slug || "").toLowerCase().slice(0, 120)}`;
  const body = await cache.wrap(key, [tags.LANDING, tags.BATCHES], () => buildCoursePage(req.params.slug), { group: "landing", ttlS: LANDING_TTL_S });
  if (!body) {
    res.status(404);
    throw new Error("This course page doesn't exist.");
  }
  res.status(200).json(body);
});

module.exports = { getPublicSettings, getPublicLandingPage, getCoursePage, buildCoursePage };
