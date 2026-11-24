const asyncHandler = require("express-async-handler");
const User = require("../../models/userModel");
const { applyProfile, adminProfile, hasProfile } = require("../../utils/teacherProfile");

// My profile, my settings and my home: every staff account's own page
// (admin panel → My profile, and the role homes). Everything here acts on
// the signed-in account only; nothing in the body can point it elsewhere.

const text = (v, n) => String(v ?? "").trim().slice(0, n);
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const day = (d) => new Date(d).toISOString().slice(0, 10);
const DAY = 86400000;

// Consecutive days up to today (or yesterday: today isn't over yet).
const streakOf = (days) => {
  const set = new Set(days || []);
  let d = new Date();
  if (!set.has(day(d))) d = new Date(d.getTime() - DAY);
  let n = 0;
  while (set.has(day(d))) { n += 1; d = new Date(d.getTime() - DAY); }
  return n;
};

const shapeSelf = async (u) => ({
  _id: u._id,
  name: u.name,
  email: u.email,
  role: u.role,
  phone: u.phone || "",
  payout: u.payout || { method: "none" },
  prefs: u.prefs || {},
  away: u.away?.until && u.away.until > new Date() ? u.away : { until: null, note: "" },
  duty: { note: u.duty?.note || "", goal: u.duty?.goal || 0, off: u.duty?.off || [] },
  logins: [...(u.logins || [])].reverse(),
  lastActiveAt: u.lastActiveAt,
  createdAt: u.createdAt,
  streak: streakOf(u.activeDays),
  activeDays: (u.activeDays || []).slice(-30),
  // The public profile (teachers, admins): photo, headline, subjects, bio.
  profile: hasProfile(u) ? await adminProfile(u) : null,
});

//@route  GET /api/auth/self
const getSelf = asyncHandler(async (req, res) => {
  const u = await User.findById(req.user._id);
  res.status(200).json(await shapeSelf(u));
});

//@desc   Their own details and settings. Role, email, duty and pay are
//        an admin's; the public profile's on/off switch too.
//@route  PUT /api/auth/self
const updateSelf = asyncHandler(async (req, res) => {
  const u = await User.findById(req.user._id);
  const b = req.body || {};
  if (b.name !== undefined) {
    const name = text(b.name, 80);
    if (!name) { res.status(400); throw new Error("Your name can't be empty."); }
    u.name = name;
  }
  if (b.phone !== undefined) u.phone = text(b.phone, 30);
  if (b.payout && typeof b.payout === "object") {
    const p = b.payout;
    u.payout = {
      method: ["none", "bkash", "nagad", "rocket", "bank"].includes(p.method) ? p.method : "none",
      account: text(p.account, 60), holder: text(p.holder, 80), bank: text(p.bank, 80), branch: text(p.branch, 80),
    };
  }
  if (b.prefs && typeof b.prefs === "object") {
    const p = b.prefs;
    const was = u.prefs?.toObject?.() || u.prefs || {};
    u.prefs = {
      ...was,
      ...(p.theme !== undefined ? { theme: ["system", "light", "dark"].includes(p.theme) ? p.theme : "system" } : {}),
      ...(p.fontScale !== undefined ? { fontScale: [90, 100, 110, 125].includes(Number(p.fontScale)) ? Number(p.fontScale) : 100 } : {}),
      ...(p.alerts !== undefined ? { alerts: Boolean(p.alerts) } : {}),
      ...(p.sound !== undefined ? { sound: Boolean(p.sound) } : {}),
      ...(p.quietFrom !== undefined ? { quietFrom: HHMM.test(p.quietFrom) ? p.quietFrom : "" } : {}),
      ...(p.quietTo !== undefined ? { quietTo: HHMM.test(p.quietTo) ? p.quietTo : "" } : {}),
    };
  }
  if (b.away && typeof b.away === "object") {
    const until = b.away.until ? new Date(b.away.until) : null;
    if (until && (Number.isNaN(until.getTime()) || until <= new Date())) { res.status(400); throw new Error("Pick a date in the future to be away until."); }
    if (until && until - Date.now() > 180 * DAY) { res.status(400); throw new Error("Away mode lasts at most 6 months."); }
    u.away = { until, note: until ? text(b.away.note, 200) : "" };
  }
  if (b.profile && typeof b.profile === "object" && hasProfile(u)) {
    const { public: _ignored, ...rest } = b.profile;
    applyProfile(u, rest);
  }
  await u.save();
  if (b.profile) require("../../utils/cache").touch(require("../../utils/cacheTags").LANDING).catch(() => {});
  res.status(200).json(await shapeSelf(u));
});

//@desc   Their profile photo (images only), stored like the Team page's.
//@route  POST /api/auth/self/photo  (multipart "file")
const uploadPhoto = asyncHandler(async (req, res) => {
  if (!req.file || !/^image\/(png|jpe?g|webp)$/.test(req.file.mimetype)) { res.status(400); throw new Error("Send a PNG, JPEG or WebP picture."); }
  const u = await User.findById(req.user._id);
  if (!hasProfile(u)) { res.status(400); throw new Error("Only teachers and admins have a profile photo."); }
  const storage = require("../../adapters/storage");
  const Media = require("../../models/mediaModel");
  const stored = await storage.store("teachers", req.file);
  const media = await Media.findOne({ key: stored.key, driver: stored.driver }) || await Media.create({ title: req.file.originalname, kind: stored.kind, driver: stored.driver, key: stored.key, sizeBytes: req.file.size, mimeType: req.file.mimetype, uploadedBy: u._id });
  applyProfile(u, { photo: String(media._id) });
  await u.save();
  require("../../utils/cache").touch(require("../../utils/cacheTags").LANDING).catch(() => {});
  res.status(200).json(await shapeSelf(u));
});

// ---------------------------------------------------------------- home

const since = (days) => new Date(Date.now() - days * DAY);
const weekStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; };

// Per day, the last 14 days, from [{_id: "YYYY-MM-DD", n}].
const series = (rows) => {
  const m = new Map(rows.map((r) => [r._id, r.n]));
  return Array.from({ length: 14 }, (_, i) => { const d = day(Date.now() - (13 - i) * DAY); return { day: d, n: m.get(d) || 0 }; });
};
const byDay = (field) => ({ $dateToString: { format: "%Y-%m-%d", date: field } });

// Answers this person marked.
const graded = async (uid) => {
  const Submission = require("../../models/submissionModel");
  return Submission.aggregate([
    { $match: { "answers.gradedByUser": uid, "answers.gradedAt": { $gte: since(14) } } },
    { $unwind: "$answers" },
    { $match: { "answers.gradedByUser": uid, "answers.gradedAt": { $gte: since(14) } } },
    { $group: { _id: byDay("$answers.gradedAt"), n: { $sum: 1 } } },
  ]);
};
const resolved = async (uid) => {
  const Doubt = require("../../models/doubtModel");
  return Doubt.aggregate([
    { $match: { resolvedBy: uid, resolvedAt: { $gte: since(14) } } },
    { $group: { _id: byDay("$resolvedAt"), n: { $sum: 1 } } },
  ]);
};
const UNIT = {
  teacher: "scripts marked and doubts solved", grader: "scripts marked", doubtSolver: "doubts solved",
  representative: "active days",
};

//@desc   Their home: what's waiting, this week's work against their goal,
//        their streak.
//@route  GET /api/auth/self/home
const home = asyncHandler(async (req, res) => {
  const u = req.user;
  const uid = u._id;
  const out = { role: u.role, name: u.name, unit: UNIT[u.role] || "active days", goal: u.duty?.goal || 0, note: u.duty?.note || "", streak: streakOf(u.activeDays), cards: [] };
  let rows = [];

  if (u.role === "grader" || u.role === "teacher") rows = rows.concat(await graded(uid));
  if (u.role === "doubtSolver" || u.role === "teacher") rows = rows.concat(await resolved(uid));
  if (u.role === "representative") {
    const set = new Set(u.activeDays || []);
    rows = [...set].map((d) => ({ _id: d, n: 1 }));
  }
  // Two sources on one day add up.
  const merged = new Map();
  rows.forEach((r) => merged.set(r._id, (merged.get(r._id) || 0) + r.n));
  out.days = series([...merged].map(([k, n]) => ({ _id: k, n })));
  const ws = day(weekStart());
  out.week = out.days.filter((d) => d.day >= ws).reduce((a, d) => a + d.n, 0);

  // What's waiting, per role.
  if (u.role === "doubtSolver" || u.role === "teacher") {
    const Doubt = require("../../models/doubtModel");
    const avg = await Doubt.aggregate([{ $match: { resolvedBy: uid, resolvedAt: { $gte: since(30) } } }, { $group: { _id: null, ms: { $avg: { $subtract: ["$resolvedAt", "$createdAt"] } } } }]).catch(() => []);
    if (avg[0]?.ms) out.cards.push({ k: "reply", n: Math.round(avg[0].ms / 60000), label: "minutes average reply (30 days)" });
  }
  if (u.role === "teacher") {
    const LiveClass = require("../../models/liveClassModel");
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const classes = await LiveClass.find({ teachers: uid, status: { $in: ["scheduled", "live"] }, scheduledAt: { $gte: start, $lt: new Date(start.getTime() + 7 * DAY) } }).select("title scheduledAt status").sort({ scheduledAt: 1 }).limit(10).lean().catch(() => []);
    out.items = classes.map((c) => ({ title: c.title, at: c.scheduledAt, status: c.status, to: "/live-classes" }));
  }
  res.status(200).json(out);
});

module.exports = { getSelf, updateSelf, uploadPhoto, home, streakOf };
