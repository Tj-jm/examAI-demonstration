const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const ConductEvent = require("../../models/conductEventModel");
const Student = require("../../models/studentModel");
const AppSettings = require("../../models/appSettingsModel");
const { notify } = require("../../utils/notify");
const { DAY, fmt, examFlagMin, withoutMinorExamFlags } = require("../../utils/conduct");

// Admin → Conduct: every student with something on their record, in one
// place — abusive messages, exam integrity flags, disqualifications — and
// what staff can do about it.

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const oid = (id) => new mongoose.Types.ObjectId(String(id));

//@desc   Students with conduct records, filtered and summarised
//@route  GET /api/conduct?kind=&batchId=&status=open|all&minFlags=&days=&search=&restricted=1&sort=recent|most&page=
const listStudents = asyncHandler(async (req, res) => {
  const { kind, batchId, status, minFlags, days, search, restricted, sort } = req.query;
  const match = {};
  if (ConductEvent.KINDS.includes(kind)) match.kind = kind;
  else match.kind = { $in: ["abuse", "examViolation", "disqualified"] };
  if (batchId && mongoose.isValidObjectId(batchId)) match.batch = oid(batchId);
  if (status === "open") match.status = "open";
  else match.status = { $ne: "dismissed" };
  if (Number(days) > 0) match.createdAt = { $gte: new Date(Date.now() - Number(days) * DAY) };
  Object.assign(match, withoutMinorExamFlags(await examFlagMin()));

  if (search && String(search).trim()) {
    const pattern = new RegExp(escapeRegex(String(search).trim()), "i");
    match.student = { $in: await Student.find({ $or: [{ name: pattern }, { email: pattern }, { phoneNumber: pattern }] }).distinct("_id") };
  }
  if (restricted === "1") {
    const now = new Date();
    const ids = await Student.find({ $or: [{ aiPausedUntil: { $gt: now } }, { suspendedUntil: { $gt: now } }, { isActive: false }] }).distinct("_id");
    match.student = match.student ? { $in: match.student.$in.filter((id) => ids.some((x) => String(x) === String(id))) } : { $in: ids };
  }

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = 30;
  // Totals added up here rather than in an aggregation: the record is
  // small (a flag is rare), and $cond/$max in $group aren't available on
  // every MongoDB-compatible server.
  const events = await ConductEvent.find(match).select("student kind status count createdAt").sort({ createdAt: -1 }).limit(20000).lean();
  const groups = events.map((e) => ({ _id: { student: e.student, kind: e.kind, status: e.status }, n: 1, count: e.count || 1, last: e.createdAt }));
  const byStudent = new Map();
  for (const g of groups) {
    const key = String(g._id.student);
    const row = byStudent.get(key) || { _id: g._id.student, total: 0, abuse: 0, examViolation: 0, disqualified: 0, open: 0, last: null };
    row.total += g.n;
    if (g._id.kind === "examViolation") row.examViolation += g.count;
    else if (row[g._id.kind] !== undefined) row[g._id.kind] += g.n;
    if (g._id.status === "open") row.open += g.n;
    if (!row.last || g.last > row.last) row.last = g.last;
    byStudent.set(key, row);
  }
  let all = [...byStudent.values()];
  if (Number(minFlags) > 0) all = all.filter((r) => r.total >= Number(minFlags));
  all.sort(sort === "most" ? (a, b) => b.total - a.total || b.last - a.last : (a, b) => b.last - a.last);
  const total = all.length;
  const rows = all.slice((page - 1) * limit, page * limit);
  const students = await Student.find({ _id: { $in: rows.map((r) => r._id) } })
    .select("name email phoneNumber isActive aiPausedUntil suspendedUntil")
    .lean();
  const byId = new Map(students.map((s) => [String(s._id), s]));
  res.status(200).json({
    rows: rows.map((r) => ({ ...r, student: byId.get(String(r._id)) || { _id: r._id, name: "Deleted student" } })),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
  });
});

//@desc   Open flags waiting for a look (nav badge)
//@route  GET /api/conduct/counts
const conductCounts = asyncHandler(async (req, res) => {
  const open = await ConductEvent.countDocuments({ status: "open", kind: { $in: ["abuse", "examViolation"] }, ...withoutMinorExamFlags(await examFlagMin()) });
  res.status(200).json({ open });
});

//@desc   One student's full record
//@route  GET /api/conduct/students/:id
const getStudentRecord = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(404);
    throw new Error("Student not found.");
  }
  const min = await examFlagMin();
  const [student, events] = await Promise.all([
    Student.findById(req.params.id).select("name email phoneNumber isActive aiPausedUntil suspendedUntil createdAt").lean(),
    ConductEvent.find({ student: req.params.id, ...withoutMinorExamFlags(min) })
      .sort({ createdAt: -1 })
      .limit(300)
      .populate("batch", "name")
      .populate("exam", "title")
      .populate("by", "name")
      .populate("handledBy", "name")
      .lean(),
  ]);
  if (!student) {
    res.status(404);
    throw new Error("Student not found.");
  }
  res.status(200).json({ student, events });
});

//@desc   Mark one entry handled, dismissed (a false alarm) or open again
//@route  PUT /api/conduct/events/:id
const updateEvent = asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!["open", "handled", "dismissed"].includes(status)) {
    res.status(400);
    throw new Error("Unknown status.");
  }
  const event = mongoose.isValidObjectId(req.params.id) ? await ConductEvent.findById(req.params.id) : null;
  if (!event) {
    res.status(404);
    throw new Error("Entry not found.");
  }
  event.status = status;
  event.handledBy = status === "open" ? null : req.user._id;
  event.handledAt = status === "open" ? null : new Date();
  await event.save();
  res.status(200).json({ event });
});

const ACTIONS = {
  warn: "Warning",
  pauseAi: "AI features paused",
  resumeAi: "AI features resumed",
  suspend: "Account suspended",
  reactivate: "Account reactivated",
};

//@desc   Act on a student: warn, pause/resume AI, suspend, reactivate.
//        Records it, notifies the student, and marks their open flags
//        handled.
//@route  POST /api/conduct/students/:id/action  { action, days?, message? }
const actOnStudent = asyncHandler(async (req, res) => {
  const { action } = req.body;
  const message = String(req.body.message || "").trim().slice(0, 2000);
  const days = Number(req.body.days) || 0; // 0 = permanent (suspend) / until lifted (pauseAi)
  if (!ACTIONS[action]) {
    res.status(400);
    throw new Error("Unknown action.");
  }
  if (action === "warn" && !message) {
    res.status(400);
    throw new Error("Write the warning to send.");
  }
  const student = mongoose.isValidObjectId(req.params.id) ? await Student.findById(req.params.id) : null;
  if (!student) {
    res.status(404);
    throw new Error("Student not found.");
  }
  if (student.deletedAt) {
    res.status(409);
    throw new Error("This student deleted their account.");
  }

  const until = days > 0 ? new Date(Date.now() + days * DAY) : null;
  let title;
  let body;
  if (action === "warn") {
    title = "A warning about your conduct";
    body = message;
  } else if (action === "pauseAi") {
    // No end date: paused until lifted — kept far in the future.
    student.aiPausedUntil = until || new Date("2999-12-31");
    title = "AI features paused on your account";
    body = `${until ? `Until ${fmt(until)}.` : "Until staff lift it."}${message ? ` ${message}` : ""}`;
  } else if (action === "resumeAi") {
    student.aiPausedUntil = null;
    title = "AI features are back on your account";
    body = message || null;
  } else if (action === "suspend") {
    if (until) student.suspendedUntil = until;
    else student.isActive = false;
    title = "Your account was suspended";
    body = `${until ? `Until ${fmt(until)}.` : "Contact support if you think this is a mistake."}${message ? ` ${message}` : ""}`;
  } else if (action === "reactivate") {
    student.isActive = true;
    student.suspendedUntil = null;
    title = "Your account was reactivated";
    body = message || null;
  }
  await student.save();

  const event = await ConductEvent.create({
    student: student._id,
    kind: action === "warn" ? "warning" : "action",
    source: "staff",
    action,
    until: action === "pauseAi" || action === "suspend" ? until : null,
    text: message || null,
    by: req.user._id,
    status: "handled",
    handledBy: req.user._id,
    handledAt: new Date(),
  });
  await ConductEvent.updateMany(
    { student: student._id, status: "open" },
    { $set: { status: "handled", handledBy: req.user._id, handledAt: new Date() } }
  );
  // A suspended student can't sign in to read it, but sees it on return.
  await notify(student._id, "accountStanding", { title, body, link: "/account" }).catch(() => {});

  res.status(200).json({ event, label: ACTIONS[action] });
});

//@desc   The automatic rule
//@route  GET/PUT /api/conduct/settings
const getConductSettings = asyncHandler(async (req, res) => {
  const settings = await AppSettings.get();
  res.status(200).json({ conduct: settings.conduct || {} });
});
const updateConductSettings = asyncHandler(async (req, res) => {
  const settings = await AppSettings.get();
  const { autoPause, flags, windowDays, pauseDays, examFlags, awayMode, awayMinutes, watch } = req.body;
  const conduct = settings.conduct || {};
  if (autoPause !== undefined) conduct.autoPause = Boolean(autoPause);
  if (flags !== undefined) conduct.flags = Math.max(1, Math.round(Number(flags) || 1));
  if (windowDays !== undefined) conduct.windowDays = Math.max(1, Math.round(Number(windowDays) || 1));
  if (examFlags !== undefined) conduct.examFlags = Math.max(1, Math.round(Number(examFlags) || 1));
  if (["off", "submit", "abandon"].includes(awayMode)) conduct.awayMode = awayMode;
  if (awayMinutes !== undefined) conduct.awayMinutes = Math.max(1, Math.round(Number(awayMinutes) || 1));
  if (pauseDays !== undefined) conduct.pauseDays = Math.max(1, Math.round(Number(pauseDays) || 1));
  if (watch && typeof watch === "object") {
    const now = conduct.watch?.toObject ? conduct.watch.toObject() : conduct.watch || {};
    conduct.watch = Object.fromEntries(["tabSwitch", "leftWindow", "paste", "leftPage"].map((k) => [k, watch[k] !== undefined ? Boolean(watch[k]) : now[k] !== false]));
  }
  settings.conduct = conduct;
  await settings.save();
  res.status(200).json({ conduct: settings.conduct });
});

module.exports = { listStudents, conductCounts, getStudentRecord, updateEvent, actOnStudent, getConductSettings, updateConductSettings };
