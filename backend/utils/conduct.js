const ConductEvent = require("../models/conductEventModel");
const Student = require("../models/studentModel");
const AppSettings = require("../models/appSettingsModel");
const { notify } = require("./notify");
const { findAbuse } = require("./abuseWords");

// Everything that writes to a student's conduct record goes through here,
// so the automatic rule and the student's notification are never missed.

const DAY = 86400000;
const fmt = (date) => new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

// A thrown error the API answers with its own status.
const refuse = (status, message) => {
  const error = new Error(message);
  error.statusCode = status;
  return error;
};

// The automatic rule: enough recent abuse flags pause AI features.
const applyAutoRule = async (studentId) => {
  const settings = (await AppSettings.get()).conduct || {};
  if (!settings.autoPause) return;
  const since = new Date(Date.now() - (settings.windowDays || 30) * DAY);
  const flags = await ConductEvent.countDocuments({ student: studentId, kind: "abuse", status: { $ne: "dismissed" }, createdAt: { $gte: since } });
  if (flags < (settings.flags || 3)) return;
  const student = await Student.findById(studentId).select("aiPausedUntil");
  if (!student || (student.aiPausedUntil && student.aiPausedUntil > new Date())) return;
  const until = new Date(Date.now() + (settings.pauseDays || 7) * DAY);
  await Student.updateOne({ _id: studentId }, { $set: { aiPausedUntil: until } });
  await ConductEvent.create({
    student: studentId,
    kind: "action",
    source: "auto",
    action: "pauseAi",
    until,
    status: "handled",
    text: `${flags} abusive messages in ${settings.windowDays || 30} days.`,
  });
  await notify(studentId, "accountStanding", {
    title: "AI features paused on your account",
    body: `After repeated abusive messages, AI features are paused until ${fmt(until)}.`,
    link: "/account",
  }).catch(() => {});
};

const recordAbuse = async ({ student, batch = null, source, text, flaggedBy }) => {
  const event = await ConductEvent.create({
    student,
    batch,
    kind: "abuse",
    source,
    flaggedBy,
    text: String(text || "").slice(0, 2000),
  });
  await notify(student, "accountStanding", {
    title: "A message was flagged",
    body: "Please keep messages respectful. Repeated abusive messages can pause AI features or suspend your account.",
    link: "/account",
  }).catch(() => {});
  await applyAutoRule(student);
  return event;
};

// The free first check. Throws (400) and records the flag when a message
// is abusive, so it never reaches the AI or a teacher.
const screenMessage = async ({ student, batch = null, source, text }) => {
  const word = findAbuse(text);
  if (!word) return;
  await recordAbuse({ student, batch, source, text, flaggedBy: "words" });
  throw refuse(400, "That message was flagged as abusive and wasn't sent. Please keep it respectful.");
};

// AI features paused? Checked on every student AI call (ai/service.js).
const assertAiAllowed = async (studentId) => {
  if (!studentId) return;
  const student = await Student.findById(studentId).select("aiPausedUntil").lean();
  if (student?.aiPausedUntil && new Date(student.aiPausedUntil) > new Date()) {
    throw refuse(403, `AI features are paused on your account until ${fmt(student.aiPausedUntil)}.`);
  }
};

// Suspended right now? → a message for the student, or null.
const suspensionMessage = (student) => {
  if (!student) return null;
  if (!student.isActive) return "This account has been deactivated.";
  if (student.suspendedUntil && new Date(student.suspendedUntil) > new Date()) {
    return `This account is suspended until ${fmt(student.suspendedUntil)}.`;
  }
  return null;
};

// An exam attempt's integrity flags reach the conduct record only once the
// attempt has `conduct.examFlags` of them (default 3): one tab switch —
// a notification pulled down, a phone locked for a moment — is noise, and
// the grader still sees every flag on the paper itself.
const examFlagMin = async () => Math.max(1, Number((await AppSettings.get()).conduct?.examFlags) || 3);

// Filter that leaves out attempts below that line (older records made
// before it existed included).
const withoutMinorExamFlags = (min) => ({ $or: [{ kind: { $ne: "examViolation" } }, { count: { $gte: min } }] });

// What the conduct record says about one attempt's flags, for the admin
// submission views: whether it made the record (and its status there), the
// line it has to reach, and how many of this student's attempts are on it.
// Owner/admin only — the conduct centre is theirs — so null for anyone else.
const examFlagSummary = async (submission, user) => {
  if (!["owner", "admin"].includes(user?.role)) return null;
  const min = await examFlagMin();
  const studentId = submission.student?._id || submission.student;
  const [event, attemptsOnRecord] = await Promise.all([
    ConductEvent.findOne({ submission: submission._id, kind: "examViolation" }).select("status count").lean(),
    ConductEvent.countDocuments({ student: studentId, kind: "examViolation", status: { $ne: "dismissed" }, count: { $gte: min } }),
  ]);
  return {
    line: min,
    event: event && event.count >= min ? { _id: event._id, status: event.status, count: event.count } : null,
    attemptsOnRecord,
  };
};

const span = (ms) => {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ""}`;
};

// "Away from the exam 3 times, 4 min 12 s in all." — tab switches and
// leaving the exam page, with the time away when they came back.
const awaySummary = (violations = []) => {
  const away = violations.filter((v) => v.type === "tab-hidden" || v.type === "left-exam");
  if (!away.length) return null;
  const back = away.filter((v) => v.backAt);
  const ms = back.reduce((sum, v) => sum + (new Date(v.backAt) - new Date(v.at)), 0);
  const left = away.filter((v) => v.type === "left-exam").length;
  const parts = [`Away from the exam ${away.length} time${away.length === 1 ? "" : "s"}`];
  if (back.length) parts.push(`${span(ms)} in all`);
  if (left) parts.push(`left the exam page ${left === 1 ? "once" : `${left} times`}`);
  const gone = away.length - back.length;
  if (gone) parts.push(gone === 1 ? "once without coming back" : `${gone} times without coming back`);
  return `${parts.join(", ")}.`;
};

// One record per attempt, its count and time away kept current.
const recordExamViolation = async (submission) => {
  const count = submission.violations?.length || 1;
  if (count < (await examFlagMin())) return null;
  const ended = submission.awayEnd?.mode
    ? `Attempt ${submission.awayEnd.mode === "abandon" ? "abandoned (zero)" : "auto-submitted"} for being away over ${submission.awayEnd.limitMinutes} min.`
    : null;
  const text = [awaySummary(submission.violations), ended].filter(Boolean).join(" ") || null;
  const existing = await ConductEvent.findOneAndUpdate(
    { submission: submission._id, kind: "examViolation" },
    { $set: { count, text } },
    { new: true }
  );
  if (existing) return existing;
  return ConductEvent.create({
    student: submission.student,
    batch: submission.batch || null,
    kind: "examViolation",
    source: "exam",
    submission: submission._id,
    exam: submission.exam || null,
    count,
    text,
  });
};

const recordDisqualified = (submission, user, reason) =>
  ConductEvent.create({
    student: submission.student,
    batch: submission.batch || null,
    kind: "disqualified",
    source: "exam",
    submission: submission._id,
    exam: submission.exam || null,
    text: reason,
    by: user?._id || null,
    status: "handled",
    handledBy: user?._id || null,
    handledAt: new Date(),
  });

// A disqualification reversed: its record stays, marked dismissed.
const recordReinstated = (submission, user) =>
  ConductEvent.updateMany(
    { submission: submission._id, kind: "disqualified", status: { $ne: "dismissed" } },
    { $set: { status: "dismissed", handledBy: user?._id || null, handledAt: new Date() } }
  );

module.exports = {
  DAY, fmt, refuse, recordAbuse, screenMessage, assertAiAllowed, suspensionMessage,
  recordExamViolation, recordDisqualified, recordReinstated, applyAutoRule,
  examFlagMin, withoutMinorExamFlags, examFlagSummary, awaySummary,
};
