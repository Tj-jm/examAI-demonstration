const crypto = require("crypto");
const mongoose = require("mongoose");
const Campaign = require("../models/campaignModel");
const CampaignDelivery = require("../models/campaignDeliveryModel");
const Student = require("../models/studentModel");
const Purchase = require("../models/purchaseModel");
const Trial = require("../models/trialModel");
const Notification = require("../models/notificationModel");
const AppSettings = require("../models/appSettingsModel");
const sms = require("../adapters/sms");
const email = require("../adapters/email");
const { rosterIds } = require("./roster");
const { studentBase } = require("./certificates");
const { envBaseUrl } = require("./baseUrl");

// Campaigns: one message to a group of students by in-app notification, SMS
// and/or email, now or at a set time.
//
// - audienceIds: who gets it, worked out when it sends (not when it's
//   written), from active accounts that haven't opted out.
// - send: runs as a background job (utils/backgroundJobs.js). Each student
//   gets a CampaignDelivery first, so a resumed or retried run never sends
//   anyone the same campaign twice.
// - Clicks: links carry ?c=<campaign>; the student app reports the click
//   (recordClick). A purchase within 7 days of a click is credited to that
//   campaign (attributionFor, purchaseController.js).

const DAY = 86400000;
const ATTRIBUTION_DAYS = 7;
const STALE_MS = 10 * 60 * 1000; // a "sending" run with no heartbeat this long is picked up again

// SMS parts a text costs: 160 plain characters (153 each when split), or
// 70 (67) once it has Bangla or other non-GSM characters. Same count as
// utils/progressReports.js, kept here so campaigns don't depend on it.
const GSM = /^[@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-./0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà^{}\\[~\]|€]*$/;
const smsParts = (text) => {
  const s = String(text || "");
  if (GSM.test(s)) return s.length <= 160 ? 1 : Math.ceil(s.length / 153);
  const units = [...s].reduce((n, ch) => n + (ch.codePointAt(0) > 0xffff ? 2 : 1), 0);
  return units <= 70 ? 1 : Math.ceil(units / 67);
};

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const asSet = (list) => new Set(list.map(String));

// ---------------------------------------------------------------- audience

const baseQuery = { isActive: true, deletedAt: null, marketingOptOut: { $ne: true } };

// Students who did anything since `since`: an exam, practice, a lecture, or
// just opened the app.
const activeSince = async (since, ids) => {
  const SubmissionModel = require("../models/submissionModel");
  const PracticeAttempt = require("../models/practiceAttemptModel");
  const LectureProgress = require("../models/lectureProgressModel");
  const inIds = ids ? { student: { $in: ids.map(oid) } } : {};
  const [subs, practice, lectures, seen] = await Promise.all([
    SubmissionModel.distinct("student", { ...inIds, createdAt: { $gte: since } }),
    PracticeAttempt.distinct("student", { ...inIds, createdAt: { $gte: since } }),
    LectureProgress.distinct("student", { ...inIds, updatedAt: { $gte: since } }),
    Student.distinct("_id", { ...(ids ? { _id: { $in: ids.map(oid) } } : {}), lastSeenAt: { $gte: since } }),
  ]);
  return asSet([...subs, ...practice, ...lectures, ...seen]);
};

// Ids of the students a campaign's audience means right now.
const audienceIds = async (audience = {}, now = new Date()) => {
  const kind = audience.kind || "all";
  const days = Math.min(365, Math.max(1, Number(audience.days) || 7));
  const batch = audience.batch && mongoose.isValidObjectId(String(audience.batch)) ? String(audience.batch) : null;
  let candidates = null; // null: every student

  if (kind === "batch") {
    if (!batch) return [];
    candidates = await rosterIds(batch, now);
  } else if (kind === "neverBought") {
    const paid = asSet(await Purchase.distinct("student", { kind: "batch", status: "complete", amountPaid: { $gt: 0 } }));
    candidates = (await Student.distinct("_id", baseQuery)).map(String).filter((id) => !paid.has(id));
  } else if (kind === "trialEnding") {
    const trials = await Trial.find({ endDate: { $gte: now, $lte: new Date(now.getTime() + days * DAY) }, ...(batch ? { batch } : {}) })
      .select("student batch").lean();
    const out = new Set();
    for (const t of trials) {
      const bought = await Purchase.exists({ student: t.student, batch: t.batch, status: "complete" });
      if (!bought) out.add(String(t.student));
    }
    candidates = [...out];
  } else if (kind === "expired") {
    // Access to a batch that ran out in the last `days` and hasn't been renewed.
    const ended = await Purchase.find({
      kind: "batch", status: "complete",
      endDate: { $gte: new Date(now.getTime() - days * DAY), $lt: now },
      ...(batch ? { batch } : {}),
    }).select("student batch").lean();
    const out = new Set();
    const onRoster = new Map(); // batch -> Set of students with access now
    for (const p of ended) {
      const b = String(p.batch);
      if (!onRoster.has(b)) onRoster.set(b, asSet(await rosterIds(b, now)));
      if (!onRoster.get(b).has(String(p.student))) out.add(String(p.student));
    }
    candidates = [...out];
  } else if (kind === "inactive") {
    const since = new Date(now.getTime() - days * DAY);
    // Accounts newer than the window haven't had the chance to go quiet.
    const pool = batch
      ? (await Student.distinct("_id", { _id: { $in: (await rosterIds(batch, now)).map(oid) }, createdAt: { $lt: since } })).map(String)
      : (await Student.distinct("_id", { ...baseQuery, createdAt: { $lt: since } })).map(String);
    const active = await activeSince(since, pool);
    candidates = pool.filter((id) => !active.has(id));
  }

  const query = candidates === null ? baseQuery : { ...baseQuery, _id: { $in: candidates.map(oid) } };
  return (await Student.distinct("_id", query)).map(String);
};

// ---------------------------------------------------------------- message

const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "";
// {name} is the student's first name; {batch} the batch an automation is
// about (utils/automations.js), when there is one.
const personal = (text, student, vars = {}) => String(text || "")
  .replace(/\{name\}/g, firstName(student?.name) || "there")
  .replace(/\{batch\}/g, vars.batchName || "your course");

// The page a message opens. "{batch}" in it is the automation's batch.
const linkOf = (campaign, vars = {}) => {
  let link = String(campaign.link || "/");
  if (!link.includes("{batch}")) return link;
  return vars.batchId ? link.replace(/\{batch\}/g, vars.batchId) : "/purchases";
};

// The campaign's link, as a path for the in-app notification and a full URL
// for SMS and email, both carrying ?c=<campaign> for click counting, and
// the campaign's coupon as ?coupon= so checkout fills in that code rather
// than a referral code saved on the device earlier.
const withCampaign = (link, id, coupon) => {
  const path = String(link || "/").startsWith("/") ? String(link || "/") : `/${link}`;
  return `${path}${path.includes("?") ? "&" : "?"}c=${id}${coupon ? `&coupon=${encodeURIComponent(coupon)}` : ""}`;
};
const fullUrl = (link, id, settings, coupon) => {
  const base = studentBase(settings);
  return /^https?:\/\//.test(base) ? `${base}${withCampaign(link, id, coupon)}` : "";
};

const smsText = (campaign, student, settings, vars = {}) => [
  personal(campaign.message, student, vars),
  campaign.couponCode ? `Code: ${campaign.couponCode}` : "",
  fullUrl(linkOf(campaign, vars), campaign._id, settings, campaign.couponCode),
].filter(Boolean).join(" ");

// An email's unsubscribe link: signed, so nobody can opt someone else out.
const unsubscribeSig = (studentId) =>
  crypto.createHmac("sha256", String(process.env.JWT_SECRET || "")).update(`unsubscribe:${studentId}`).digest("base64url").slice(0, 32);
const unsubscribeUrl = (studentId) => {
  const base = envBaseUrl("SERVER_URL");
  return base ? `${base}/api/app/unsubscribe?s=${studentId}&t=${unsubscribeSig(studentId)}` : "";
};
const checkUnsubscribe = (studentId, sig) => {
  if (!mongoose.isValidObjectId(String(studentId || "")) || typeof sig !== "string") return false;
  const want = Buffer.from(unsubscribeSig(studentId));
  const got = Buffer.from(sig);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
};

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// The button and the small line over the title, by what started the email.
const BUTTON = { checkoutAbandoned: "Finish enrolment", trialEnding: "Keep learning", accessExpiring: "Renew", accessExpired: "Come back", inactive: "Pick up where you left off", noPurchase: "See the courses" };
const KICKER = { checkoutAbandoned: "Almost there", trialEnding: "Trial ending soon", accessExpiring: "Access ending soon", accessExpired: "We miss you", inactive: "We miss you" };
const emailFor = (campaign, student, settings, vars = {}) => {
  const brand = settings.siteName || "";
  const body = personal(campaign.message, student, vars);
  const url = fullUrl(linkOf(campaign, vars), campaign._id, settings, campaign.couponCode);
  const off = unsubscribeUrl(student._id);
  const subject = personal(campaign.title, student, vars) || brand || "News";
  const text = [body, campaign.couponCode ? `Code: ${campaign.couponCode}` : "", url, "", off ? `Unsubscribe: ${off}` : ""].filter((x, i) => i < 3 ? x : true).join("\n");
  const t = campaign.trigger?.type;
  const label = campaign.kind === "automation" && BUTTON[t] ? BUTTON[t] : "Take a look";
  const html = require("./emailLayout").render(settings, {
    kicker: campaign.kind === "automation" ? KICKER[t] || "" : "",
    title: subject,
    text: body,
    code: campaign.couponCode || "",
    note: campaign.couponCode ? "Use this code when you pay." : "",
    button: url ? { label, url } : null,
    preheader: body.slice(0, 110),
    reason: brand ? `You're getting this because you have an account at ${brand}.` : "",
    unsubscribe: off,
  });
  return { subject, text, html };
};

// ---------------------------------------------------------------- estimate

// What sending now would do: how many students, and how many by each channel.
// `ids` (automations) replaces the audience with these students.
const estimate = async (campaign, ids = null) => {
  if (ids) ids = (await Student.distinct("_id", { ...baseQuery, _id: { $in: ids.map(oid) } })).map(String);
  else ids = await audienceIds(campaign.audience);
  const settings = await AppSettings.get();
  const students = await Student.find({ _id: { $in: ids.map(oid) } }).select("name email phoneNumber whatsappOptIn").lean();
  const c = campaign.channels || {};
  const withPhone = students.filter((s) => s.phoneNumber).length;
  const withEmail = students.filter((s) => s.email).length;
  const sample = students[0] || { name: "Rahim" };
  const text = smsText({ ...campaign, _id: campaign._id || "preview" }, sample, settings);
  return {
    recipients: ids.length,
    app: c.app ? ids.length : 0,
    sms: c.sms ? withPhone : 0,
    smsPartsEach: c.sms ? smsParts(text) : 0,
    smsParts: c.sms ? withPhone * smsParts(text) : 0,
    email: c.email ? withEmail : 0,
    smsReady: sms.configured(),
    emailReady: email.configured(),
    appOn: settings.notificationSettings?.campaign !== false,
    sampleSms: c.sms ? text : "",
  };
};

// ---------------------------------------------------------------- send

const CHUNK = 50;

// One student's copy: claims the delivery first (unique on campaign,
// student and key), so a second run or server never sends it twice, then
// sends by each channel and records how it went. `inc` collects the
// campaign's counters. Returns false when it was already delivered.
const deliverTo = async ({ campaign, student, settings, adapters, inc, ready, key = "", vars = {} }) => {
  try {
    await CampaignDelivery.create({ campaign: campaign._id, student: student._id, key, channels: [] });
  } catch (error) {
    if (error.code === 11000) return false;
    throw error;
  }
  const results = [];
  const attempt = async (channel, isReady, run) => {
    if (!campaign.channels[channel]) return;
    if (!isReady) { results.push({ channel, status: "skipped", error: "not set up" }); inc["stats.skipped"] += 1; return; }
    try {
      const extra = await run();
      if (extra === false) { results.push({ channel, status: "skipped", error: "no address" }); inc["stats.skipped"] += 1; return; }
      results.push({ channel, status: "sent" });
      inc[`stats.${channel}`] += 1;
    } catch (error) {
      results.push({ channel, status: "failed", error: String(error.message || error).slice(0, 200) });
      inc["stats.failed"] += 1;
    }
  };
  await attempt("app", ready.appOn, async () => {
    await Notification.create({
      student: student._id, type: "campaign",
      title: personal(campaign.title || settings.siteName || "News", student, vars).slice(0, 200),
      body: personal(campaign.message, student, vars).slice(0, 1000),
      link: withCampaign(linkOf(campaign, vars), campaign._id, campaign.couponCode),
    });
  });
  await attempt("sms", ready.smsReady, async () => {
    if (!student.phoneNumber) return false;
    const text = smsText(campaign, student, settings, vars);
    await adapters.sms.send(student.phoneNumber, text, { optIn: student.whatsappOptIn !== false });
    inc["stats.smsParts"] += smsParts(text);
    return true;
  });
  await attempt("email", ready.emailReady, async () => {
    if (!student.email) return false;
    const mail = emailFor(campaign, student, settings, vars);
    await adapters.email.send(student.email, mail.subject, mail.text, mail.html);
    return true;
  });
  await CampaignDelivery.updateOne({ campaign: campaign._id, student: student._id, key }, { $set: { channels: results } });
  return true;
};

const newCounters = () => ({ "stats.app": 0, "stats.sms": 0, "stats.smsParts": 0, "stats.email": 0, "stats.failed": 0, "stats.skipped": 0 });

// Which channels can go out right now for this campaign.
const readiness = (campaign, settings, adapters) => ({
  appOn: campaign.channels.app && settings.notificationSettings?.campaign !== false,
  smsReady: campaign.channels.sms && adapters.sms.configured(),
  emailReady: campaign.channels.email && adapters.email.configured(),
});

// Sends one campaign that is in "sending". Safe to run again: students who
// already have a delivery are skipped.
const send = async (campaignId, { adapters = { sms, email } } = {}) => {
  const campaign = await Campaign.findById(campaignId);
  if (!campaign || campaign.status !== "sending") return;
  const settings = await AppSettings.get();
  const ids = await audienceIds(campaign.audience);
  await Campaign.updateOne({ _id: campaign._id }, { $set: { "stats.recipients": ids.length, heartbeatAt: new Date() } });

  const done = asSet(await CampaignDelivery.distinct("student", { campaign: campaign._id }));
  const todo = ids.filter((id) => !done.has(id));
  const { appOn, smsReady, emailReady } = readiness(campaign, settings, adapters);

  for (let i = 0; i < todo.length; i += CHUNK) {
    // Cancelled while sending: stop between chunks.
    const fresh = await Campaign.findById(campaign._id).select("status").lean();
    if (fresh?.status !== "sending") return;

    const students = await Student.find({ _id: { $in: todo.slice(i, i + CHUNK).map(oid) }, ...baseQuery })
      .select("name email phoneNumber whatsappOptIn").lean();
    const inc = newCounters();

    for (const student of students) {
      await deliverTo({ campaign, student, settings, adapters, inc, ready: { appOn, smsReady, emailReady } });
    }
    await Campaign.updateOne({ _id: campaign._id }, { $inc: inc, $set: { heartbeatAt: new Date() } });
  }

  await Campaign.updateOne({ _id: campaign._id, status: "sending" }, { $set: { status: "sent", finishedAt: new Date(), heartbeatAt: null } });
};

// Moves a campaign to "sending" and queues it. Returns false when it wasn't
// in a state that can start.
const start = async (campaignId, from = ["draft", "scheduled"]) => {
  const now = new Date();
  const claimed = await Campaign.findOneAndUpdate(
    { _id: campaignId, status: { $in: from } },
    { $set: { status: "sending", startedAt: now, heartbeatAt: now, error: "" } },
    { new: true }
  );
  if (!claimed) return false;
  await require("./queue").enqueue("campaign-send", { campaignId: String(campaignId) });
  return true;
};

// Every minute (jobs/campaigns.js): start scheduled campaigns that are due,
// and pick up a run whose sender stopped (a restart mid-send).
const runDue = async (now = new Date()) => {
  const due = await Campaign.find({ status: "scheduled", scheduledAt: { $lte: now } }).select("_id").lean();
  for (const c of due) await start(c._id, ["scheduled"]);
  const stale = await Campaign.find({ status: "sending", heartbeatAt: { $lt: new Date(now.getTime() - STALE_MS) } }).select("_id").lean();
  for (const c of stale) {
    const claimed = await Campaign.findOneAndUpdate(
      { _id: c._id, status: "sending", heartbeatAt: { $lt: new Date(now.getTime() - STALE_MS) } },
      { $set: { heartbeatAt: now }, $inc: { restarts: 1 } },
      { new: true }
    );
    if (!claimed) continue;
    if (claimed.restarts > 3) {
      await Campaign.updateOne({ _id: c._id }, { $set: { status: "failed", finishedAt: now, heartbeatAt: null, error: "Sending kept stopping. Students who already got it won't get it again if you duplicate and send." } });
    } else {
      await require("./queue").enqueue("campaign-send", { campaignId: String(c._id) });
    }
  }
  return due.length;
};

// ---------------------------------------------------------------- clicks and sales

// The student opened a campaign link. Counted once per student.
const recordClick = async (campaignId, studentId) => {
  if (!mongoose.isValidObjectId(String(campaignId || ""))) return false;
  const res = await CampaignDelivery.updateOne(
    { campaign: campaignId, student: studentId, clickedAt: null },
    { $set: { clickedAt: new Date() } }
  );
  if (!res.modifiedCount) return false;
  await Campaign.updateOne({ _id: campaignId }, { $inc: { "stats.clicks": 1 } });
  return true;
};

// The campaign to credit a purchase to: the last one this student clicked
// in the past week. Never throws.
const attributionFor = async (studentId, now = new Date()) => {
  try {
    if (!studentId) return null;
    const d = await CampaignDelivery.findOne({ student: studentId, clickedAt: { $gte: new Date(now.getTime() - ATTRIBUTION_DAYS * DAY) } })
      .sort({ clickedAt: -1 }).select("campaign").lean();
    return d?.campaign || null;
  } catch {
    return null;
  }
};

// Sales credited to each campaign, per currency.
const salesFor = async (campaignIds) => {
  const rows = await Purchase.aggregate([
    { $match: { campaign: { $in: campaignIds.map(oid) }, status: "complete" } },
    { $group: { _id: { campaign: "$campaign", currency: "$currency" }, total: { $sum: "$amountPaid" }, count: { $sum: 1 } } },
  ]);
  const out = {};
  for (const r of rows) {
    const key = String(r._id.campaign);
    (out[key] = out[key] || []).push({ currency: r._id.currency, total: r.total, count: r.count });
  }
  return out;
};

module.exports = {
  audienceIds, estimate, send, start, runDue, recordClick, attributionFor, salesFor,
  smsText, smsParts, emailFor, withCampaign, checkUnsubscribe, unsubscribeUrl, personal, linkOf,
  deliverTo, newCounters, readiness, baseQuery, CAMPAIGN_ATTRIBUTION_DAYS: ATTRIBUTION_DAYS,
};
