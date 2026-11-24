const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const Visitor = require("../models/visitorModel");
const VisitSession = require("../models/visitSessionModel");
const PageStat = require("../models/pageStatModel");
const AppSettings = require("../models/appSettingsModel");
const { readToken } = require("./generateToken");

// Visitor analytics: the student app reports each page it opens
// (student-app/src/utils/visits.js), and the admin Visitors page reads the
// report below. First-party only, no third-party scripts and nothing
// personal until the visitor signs in.

const ID = /^[A-Za-z0-9-]{8,64}$/;
const HEX = /^[a-f0-9]{24}$/i;
const BOT = /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|whatsapp\/|curl|wget|python|axios/i;

const NAMED = [
  [/(^|\.)(facebook\.com|fb\.com|fb\.me|messenger\.com)$/, "Facebook"],
  [/(^|\.)instagram\.com$/, "Instagram"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "YouTube"],
  [/(^|\.)google\.[a-z.]+$/, "Google"],
  [/(^|\.)bing\.com$/, "Bing"],
  [/(^|\.)(t\.co|x\.com|twitter\.com)$/, "X"],
  [/(^|\.)(linkedin\.com|lnkd\.in)$/, "LinkedIn"],
  [/(^|\.)(whatsapp\.com|wa\.me)$/, "WhatsApp"],
  [/(^|\.)(telegram\.org|t\.me)$/, "Telegram"],
  [/(^|\.)tiktok\.com$/, "TikTok"],
];
const UTM = { facebook: "Facebook", fb: "Facebook", instagram: "Instagram", ig: "Instagram", youtube: "YouTube", google: "Google", tiktok: "TikTok", whatsapp: "WhatsApp", telegram: "Telegram", linkedin: "LinkedIn", twitter: "X", x: "X", email: "Email", sms: "SMS" };

const clip = (s, n) => String(s ?? "").trim().slice(0, n);

const hostOf = (url) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};

// Where a visit came from: tagged links first, then the page that linked here.
const sourceOf = (q, referrer, ownHost, app) => {
  const utm = clip(q.utm_source, 40).toLowerCase();
  if (utm) return UTM[utm] || utm;
  if (q.fbclid) return "Facebook";
  if (q.gclid) return "Google";
  if (q.c) return "Campaign message";
  if (q.coupon || q.ref) return "Referral / code";
  const host = hostOf(referrer);
  if (host && host !== ownHost) {
    const named = NAMED.find(([re]) => re.test(host));
    return named ? named[1] : clip(host, 60);
  }
  return app ? "App" : "Direct";
};

const deviceOf = (ua, app) => {
  if (app) return "app";
  if (/ipad|tablet/i.test(ua)) return "tablet";
  if (/mobi|android|iphone/i.test(ua)) return "mobile";
  return "desktop";
};

// One row per kind of page: a course's id is kept, other ids folded.
const normalPath = (raw) => {
  let p = clip(raw, 200).split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  if (!p.startsWith("/")) p = `/${p}`;
  if (/^\/(verify|progress|r)\//.test(p)) return `/${p.split("/")[1]}/:id`;
  const parts = p.split("/");
  return parts
    .map((seg, i) => (HEX.test(seg) && !["batches", "purchases"].includes(parts[i - 1]) ? ":id" : seg.slice(0, 40)))
    .join("/");
};

const stepOf = (path) => {
  if (path === "/register") return "register";
  if (/^\/purchases\/[a-f0-9]{24}$/i.test(path)) return "plans";
  return "";
};

// The signed-in student, if any, without a database read.
const studentOf = (req) => {
  try {
    const token = readToken(req, "student");
    if (!token) return null;
    const d = jwt.verify(token, process.env.JWT_SECRET);
    return d.aud === "student" && HEX.test(String(d.id)) ? d.id : null;
  } catch {
    return null;
  }
};

const record = async (req) => {
  const b = req.body || {};
  if (!ID.test(String(b.v || "")) || !ID.test(String(b.s || ""))) return;
  const ua = String(req.get("user-agent") || "");
  if (!ua || BOT.test(ua)) return;
  const settings = await AppSettings.get();
  if (settings.studentUi?.trackVisitors === false) return;

  const { zoneOf, localParts } = require("./progressReports");
  const now = new Date();
  const t = localParts(now, zoneOf(settings));
  const day = `${t.y}-${String(t.m).padStart(2, "0")}-${String(t.d).padStart(2, "0")}`;
  const q = b.q && typeof b.q === "object" ? b.q : {};
  const app = Boolean(b.app);
  const path = normalPath(b.p);
  const step = stepOf(path);
  const student = studentOf(req);
  const source = sourceOf(q, clip(b.r, 500), hostOf(`http://${req.get("host")}`), app);
  const device = deviceOf(ua, app);
  const campaign = clip(q.utm_campaign, 60) || (HEX.test(String(q.c || "")) ? `c:${q.c}` : "");
  const coupon = clip(q.coupon || q.ref, 40).toUpperCase();
  const loc = require("./geo").locate(req, settings.studentUi?.visitorLocation === true) || {};
  const place = { country: loc.country || "", region: loc.region || "", city: loc.city || "" };

  const linked = student ? { student } : {};
  const visitorUpdate = {
    $setOnInsert: { firstAt: now, source, campaign, coupon, landing: path, device, ...place },
    $set: { lastAt: now, ...linked },
    $inc: { sessions: b.n ? 1 : 0 },
  };
  if (step) visitorUpdate.$addToSet = { steps: step };

  await Promise.all([
    Visitor.updateOne({ _id: b.v }, visitorUpdate, { upsert: true }),
    VisitSession.updateOne(
      { _id: b.s },
      {
        $setOnInsert: { visitor: b.v, startedAt: now, day, source, device, landing: path, ...place },
        $set: { lastAt: now, ...linked },
        $inc: { views: 1 },
      },
      { upsert: true }
    ),
    PageStat.updateOne({ day, path }, { $inc: { views: 1 } }, { upsert: true }),
  ]);
};

// ---------- report ----------

const dayKey = (date, tz, localParts) => {
  const t = localParts(date, tz);
  return `${t.y}-${String(t.m).padStart(2, "0")}-${String(t.d).padStart(2, "0")}`;
};

const report = async (days) => {
  const Student = require("../models/studentModel");
  const Purchase = require("../models/purchaseModel");
  const CheckoutStart = require("../models/checkoutStartModel");
  const Batch = require("../models/batchModel");
  const Campaign = require("../models/campaignModel");
  const { zoneOf, localParts } = require("./progressReports");

  const settings = await AppSettings.get();
  const tz = zoneOf(settings);
  // Revenue in the main currency only: two currencies never add up.
  const cur = String(settings.defaultCurrency || "USD").toUpperCase();
  const now = Date.now();
  const from = new Date(now - days * 86400000);
  const dayList = [];
  for (let i = days - 1; i >= 0; i--) dayList.push(dayKey(new Date(now - i * 86400000), tz, localParts));
  const fromDay = dayList[0];
  const inRange = { startedAt: { $gte: from } };
  const fresh = { firstAt: { $gte: from } };
  const has = (step) => ({ $cond: [{ $in: [step, { $ifNull: ["$steps", []] }] }, 1, 0] });

  const placeId = { country: "$country", region: "$region", city: "$city" };
  const [totals, byDay, devices, hours, sessionsBySource, funnelBySource, byCampaign, linked, pages, checkoutsByBatch, salesByBatch, sessionsByPlace, visitorsByPlace] = await Promise.all([
    VisitSession.aggregate([{ $match: inRange }, { $group: { _id: null, sessions: { $sum: 1 }, views: { $sum: "$views" }, visitors: { $addToSet: "$visitor" } } }, { $project: { sessions: 1, views: 1, visitors: { $size: "$visitors" } } }]),
    VisitSession.aggregate([
      { $match: inRange },
      { $group: { _id: { day: "$day", visitor: "$visitor" }, sessions: { $sum: 1 } } },
      { $group: { _id: "$_id.day", visitors: { $sum: 1 }, sessions: { $sum: "$sessions" } } },
    ]),
    VisitSession.aggregate([{ $match: inRange }, { $group: { _id: "$device", sessions: { $sum: 1 } } }]),
    VisitSession.aggregate([{ $match: inRange }, { $group: { _id: { $hour: { date: "$startedAt", timezone: tz } }, sessions: { $sum: 1 } } }]),
    VisitSession.aggregate([{ $match: inRange }, { $group: { _id: "$source", sessions: { $sum: 1 } } }]),
    Visitor.aggregate([{ $match: fresh }, { $group: { _id: "$source", visitors: { $sum: 1 }, register: { $sum: has("register") }, plans: { $sum: has("plans") } } }]),
    Visitor.aggregate([
      { $match: { ...fresh, $or: [{ campaign: { $ne: "" } }, { coupon: { $ne: "" } }] } },
      { $group: { _id: { campaign: "$campaign", coupon: "$coupon" }, visitors: { $sum: 1 }, register: { $sum: has("register") }, plans: { $sum: has("plans") } } },
      { $sort: { visitors: -1 } },
      { $limit: 30 },
    ]),
    Visitor.find({ ...fresh, student: { $ne: null } }).select("source campaign coupon country region city student firstAt").lean(),
    PageStat.aggregate([{ $match: { day: { $gte: fromDay } } }, { $group: { _id: "$path", views: { $sum: "$views" } } }, { $sort: { views: -1 } }, { $limit: 300 }]),
    CheckoutStart.aggregate([{ $match: { createdAt: { $gte: from } } }, { $group: { _id: "$batch", checkouts: { $sum: 1 } } }]),
    Purchase.aggregate([
      { $match: { status: "complete", createdAt: { $gte: from }, batch: { $ne: null } } },
      { $group: { _id: "$batch", sales: { $sum: 1 }, revenue: { $sum: { $cond: [{ $eq: ["$currency", cur] }, { $ifNull: ["$amountPaid", "$plan.price"] }, 0] } } } },
    ]),
    VisitSession.aggregate([{ $match: { ...inRange, country: { $nin: ["", null] } } }, { $group: { _id: placeId, sessions: { $sum: 1 } } }, { $sort: { sessions: -1 } }, { $limit: 100 }]),
    Visitor.aggregate([{ $match: { ...fresh, country: { $nin: ["", null] } } }, { $group: { _id: placeId, visitors: { $sum: 1 } } }]),
  ]);

  // What the new visitors who signed in went on to do.
  const ids = [...new Set(linked.map((v) => String(v.student)))];
  const [students, checkouts, purchases] = ids.length
    ? await Promise.all([
        Student.find({ _id: { $in: ids } }).select("createdAt").lean(),
        CheckoutStart.find({ student: { $in: ids }, createdAt: { $gte: from } }).select("student createdAt").lean(),
        Purchase.find({ student: { $in: ids }, status: "complete", createdAt: { $gte: from } }).select("student createdAt amountPaid plan.price currency").lean(),
      ])
    : [[], [], []];
  const createdAt = new Map(students.map((s) => [String(s._id), s.createdAt]));
  const outcome = (v) => {
    const sid = String(v.student);
    const since = new Date(v.firstAt).getTime() - 60000;
    const signedUp = (createdAt.get(sid)?.getTime() || 0) >= since;
    const checkout = checkouts.some((c) => String(c.student) === sid && c.createdAt.getTime() >= since);
    const paid = purchases.filter((p) => String(p.student) === sid && p.createdAt.getTime() >= since);
    return { signedUp, checkout, paid: paid.length > 0, revenue: paid.reduce((s, p) => s + (p.currency === cur ? p.amountPaid ?? p.plan?.price ?? 0 : 0), 0) };
  };
  const add = (into, o) => {
    into.signups += o.signedUp ? 1 : 0;
    into.checkouts += o.checkout ? 1 : 0;
    into.paid += o.paid ? 1 : 0;
    into.revenue += o.revenue;
  };
  const blank = () => ({ signups: 0, checkouts: 0, paid: 0, revenue: 0 });

  const funnel = { visitors: 0, register: 0, plans: 0, ...blank() };
  const sources = new Map();
  const sourceRow = (name) => {
    if (!sources.has(name)) sources.set(name, { source: name, sessions: 0, visitors: 0, register: 0, plans: 0, ...blank() });
    return sources.get(name);
  };
  for (const s of sessionsBySource) sourceRow(s._id || "Direct").sessions = s.sessions;
  for (const s of funnelBySource) {
    Object.assign(sourceRow(s._id || "Direct"), { visitors: s.visitors, register: s.register, plans: s.plans });
    funnel.visitors += s.visitors;
    funnel.register += s.register;
    funnel.plans += s.plans;
  }
  const campaignKey = (v) => `${v.campaign}|${v.coupon}`;
  const campaignOutcome = new Map();
  const placeKey = (x) => `${x.country || ""}|${x.region || ""}|${x.city || ""}`;
  const places = new Map();
  const placeRow = (x) => {
    const k = placeKey(x);
    if (!places.has(k)) places.set(k, { country: x.country || "", region: x.region || "", city: x.city || "", sessions: 0, visitors: 0, ...blank() });
    return places.get(k);
  };
  for (const s of sessionsByPlace) placeRow(s._id).sessions = s.sessions;
  for (const s of visitorsByPlace) if (places.has(placeKey(s._id))) placeRow(s._id).visitors = s.visitors;
  for (const v of linked) {
    const o = outcome(v);
    if (v.country && places.has(placeKey(v))) add(placeRow(v), o);
    add(funnel, o);
    add(sourceRow(v.source || "Direct"), o);
    if (v.campaign || v.coupon) {
      const k = campaignKey(v);
      if (!campaignOutcome.has(k)) campaignOutcome.set(k, blank());
      add(campaignOutcome.get(k), o);
    }
  }

  // Names for campaign ids and course ids.
  const campaignIds = byCampaign.map((c) => c._id.campaign).filter((c) => c.startsWith("c:")).map((c) => c.slice(2));
  const coursePages = pages.filter((p) => /^\/purchases\/[a-f0-9]{24}$/i.test(p._id));
  const batchIds = new Set([...coursePages.map((p) => p._id.split("/")[2]), ...checkoutsByBatch.map((c) => String(c._id)), ...salesByBatch.map((s) => String(s._id))]);
  for (const p of pages) {
    const m = /^\/batches\/([a-f0-9]{24})/i.exec(p._id);
    if (m) batchIds.add(m[1]);
  }
  const validBatchIds = [...batchIds].filter((id) => mongoose.isValidObjectId(id));
  const [campaignDocs, batchDocs] = await Promise.all([
    campaignIds.length ? Campaign.find({ _id: { $in: campaignIds } }).select("name").lean() : [],
    validBatchIds.length ? Batch.find({ _id: { $in: validBatchIds } }).select("name").lean() : [],
  ]);
  const campaignName = new Map(campaignDocs.map((c) => [String(c._id), c.name]));
  const batchName = new Map(batchDocs.map((b) => [String(b._id), b.name]));

  const courses = new Map();
  const courseRow = (id) => {
    if (!courses.has(id)) courses.set(id, { batch: id, name: batchName.get(id) || "Removed course", planViews: 0, checkouts: 0, sales: 0, revenue: 0 });
    return courses.get(id);
  };
  for (const p of coursePages) courseRow(p._id.split("/")[2]).planViews += p.views;
  for (const c of checkoutsByBatch) courseRow(String(c._id)).checkouts = c.checkouts;
  for (const s of salesByBatch) Object.assign(courseRow(String(s._id)), { sales: s.sales, revenue: s.revenue });

  const labelPath = (path) => path.replace(/^\/(batches|purchases)\/([a-f0-9]{24})/i, (all, kind, id) => `/${kind}/${batchName.get(id) || ":id"}`);
  const dayMap = new Map(byDay.map((d) => [d._id, d]));
  const hourMap = new Map(hours.map((h) => [h._id, h.sessions]));
  const t = totals[0] || { sessions: 0, views: 0, visitors: 0 };

  return {
    days,
    timezone: tz,
    currency: cur,
    tracking: settings.studentUi?.trackVisitors !== false,
    totals: { visitors: t.visitors, sessions: t.sessions, views: t.views, newVisitors: funnel.visitors, signups: funnel.signups, paid: funnel.paid, revenue: funnel.revenue },
    byDay: dayList.map((d) => ({ day: d, visitors: dayMap.get(d)?.visitors || 0, sessions: dayMap.get(d)?.sessions || 0 })),
    funnel,
    sources: [...sources.values()].sort((a, b) => b.visitors - a.visitors || b.sessions - a.sessions),
    campaigns: byCampaign.map((c) => {
      const id = c._id.campaign.startsWith("c:") ? c._id.campaign.slice(2) : "";
      return {
        campaign: id ? campaignName.get(id) || "Removed campaign" : c._id.campaign,
        coupon: c._id.coupon,
        visitors: c.visitors,
        register: c.register,
        plans: c.plans,
        ...(campaignOutcome.get(`${c._id.campaign}|${c._id.coupon}`) || blank()),
      };
    }),
    courses: [...courses.values()].sort((a, b) => b.planViews - a.planViews || b.sales - a.sales),
    pages: pages.slice(0, 20).map((p) => ({ path: labelPath(p._id), views: p.views })),
    places: [...places.values()].sort((a, b) => b.sessions - a.sessions).slice(0, 30),
    location: { enabled: settings.studentUi?.visitorLocation === true, ...require("./geo").status() },
    devices: devices.map((d) => ({ device: d._id || "desktop", sessions: d.sessions })).sort((a, b) => b.sessions - a.sessions),
    hours: Array.from({ length: 24 }, (_, h) => hourMap.get(h) || 0),
  };
};

module.exports = {
  record, report, sourceOf, normalPath };
