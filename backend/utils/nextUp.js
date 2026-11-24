const Lecture = require("../models/lectureModel");
const LectureProgress = require("../models/lectureProgressModel");
const Exam = require("../models/examModel");
const LiveClass = require("../models/liveClassModel");
const Submission = require("../models/submissionModel");
const Tutor = require("../models/tutorModel");

// What a student should do next, for the home screen and batch home styles
// that lead with it (Bento, Tabs, Today): the lecture to pick up,
// the next exam they can still take, and a live class on now or coming up.

const GRACE_MS = 60 * 60 * 1000;
const STALE_LIVE_MS = 3 * 60 * 60 * 1000;
// Same phases as the live class list (controllers/app/liveClassController.js).
const livePhase = (lc, now) => {
  const end = new Date(lc.scheduledAt).getTime() + (lc.durationMinutes || 60) * 60000;
  if (lc.status === "live") return lc.provider !== "livekit" && now > end + STALE_LIVE_MS ? "past" : "live";
  if (lc.status === "scheduled" && end + GRACE_MS >= now) return "upcoming";
  return "past";
};

// The lecture half-watched most recently, else the first one not finished.
const lectureFor = async (studentId, batchId) => {
  const lectures = await Lecture.find({ batches: batchId, isPublished: true }).select("title order createdAt").sort({ order: 1, createdAt: 1 }).lean();
  if (!lectures.length) return null;
  const ids = lectures.map((l) => l._id);
  const progress = await LectureProgress.find({ student: studentId, lecture: { $in: ids } }).select("lecture completedAt lastWatchedAt lastPositionSeconds").lean();
  const byId = new Map(progress.map((p) => [String(p.lecture), p]));
  const started = progress.filter((p) => !p.completedAt).sort((a, b) => new Date(b.lastWatchedAt || 0) - new Date(a.lastWatchedAt || 0))[0];
  const pick = started ? lectures.find((l) => String(l._id) === String(started.lecture)) : lectures.find((l) => !byId.get(String(l._id))?.completedAt);
  if (!pick) return null;
  return { _id: pick._id, title: pick.title, started: Boolean(started), number: lectures.indexOf(pick) + 1, total: lectures.length };
};

// Open now with attempts left (closing soonest first), else the next to open.
const examFor = async (studentId, batchIds) => {
  const now = Date.now();
  const exams = await Exam.find({ batches: { $in: batchIds }, isPublished: true, isActive: { $ne: false }, offline: { $ne: true }, $or: [{ closesAt: null }, { closesAt: { $gt: new Date() } }] })
    .sort({ opensAt: 1 }).limit(60);
  if (!exams.length) return null;
  const used = new Map();
  for (const s of await Submission.find({ student: studentId, exam: { $in: exams.map((e) => e._id) } }).select("exam").lean()) {
    used.set(String(s.exam), (used.get(String(s.exam)) || 0) + 1);
  }
  const left = exams.filter((e) => (used.get(String(e._id)) || 0) < (e.attemptsAllowed || 1));
  const open = left.filter((e) => e.isOpen()).sort((a, b) => (a.closesAt ? +a.closesAt : Infinity) - (b.closesAt ? +b.closesAt : Infinity));
  const soon = left.filter((e) => e.opensAt && +e.opensAt > now);
  const e = open[0] || soon[0];
  if (!e) return null;
  const batch = e.batches.find((b) => batchIds.some((x) => String(x) === String(b)));
  // A paper set's page is reached by its group's id (utils/examSets.js).
  return { _id: e.paperSet?.group || e._id, batch, title: e.title, durationMinutes: e.durationMinutes, opensAt: e.opensAt || null, closesAt: e.closesAt || null, open: e.isOpen() };
};

// On now, else the soonest coming up.
const liveFor = async (batchIds) => {
  const now = Date.now();
  // A class marked live counts however long ago it was scheduled.
  const rows = await LiveClass.find({ batch: { $in: batchIds }, $or: [{ status: "live" }, { status: "scheduled", scheduledAt: { $gte: new Date(now - 24 * 3600 * 1000) } }] })
    .select("title scheduledAt durationMinutes status provider batch").sort({ scheduledAt: 1 }).limit(40).lean();
  const live = rows.filter((r) => livePhase(r, now) === "live");
  const upcoming = rows.filter((r) => livePhase(r, now) === "upcoming");
  const pick = live[0] || upcoming[0];
  return pick ? { _id: pick._id, batch: pick.batch, title: pick.title, scheduledAt: pick.scheduledAt, durationMinutes: pick.durationMinutes, live: Boolean(live[0]) } : null;
};

const forBatch = async (studentId, batchId) => {
  const [lecture, exam, live] = await Promise.all([lectureFor(studentId, batchId), examFor(studentId, [batchId]), liveFor([batchId])]);
  return { lecture, exam, live };
};

// The home screen: across every batch the student is in.
const forHome = async (studentId, batchIds, { timezone } = {}) => {
  if (!batchIds.length) return { exam: null, live: null, liveToday: [], examsToday: [], tasks: [], streak: 0 };
  const now = Date.now();
  const tz = timezone || "UTC";
  const dayKey = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const today = dayKey(new Date());
  const [exam, live, liveRows, examRows, tutors] = await Promise.all([
    examFor(studentId, batchIds),
    liveFor(batchIds),
    LiveClass.find({ batch: { $in: batchIds }, $or: [{ status: "live" }, { status: "scheduled", scheduledAt: { $gte: new Date(now - 24 * 3600 * 1000), $lte: new Date(now + 36 * 3600 * 1000) } }] })
      .select("title scheduledAt durationMinutes status provider batch").sort({ scheduledAt: 1 }).limit(20).lean(),
    Exam.find({ batches: { $in: batchIds }, isPublished: true, isActive: { $ne: false }, offline: { $ne: true }, $or: [{ opensAt: { $gte: new Date(now - 24 * 3600 * 1000), $lte: new Date(now + 36 * 3600 * 1000) } }, { closesAt: { $gte: new Date(now), $lte: new Date(now + 36 * 3600 * 1000) } }] })
      .select("title opensAt closesAt durationMinutes batches paperSet").limit(20).lean(),
    Tutor.find({ student: studentId, batch: { $in: batchIds }, enabled: true }).select("batch streak lastCompleteDay day tasks").lean(),
  ]);
  const inBatch = (list) => list.find((b) => batchIds.some((x) => String(x) === String(b)));
  // Today's timeline: classes and exams whose time falls on today.
  const liveToday = liveRows.filter((r) => livePhase(r, now) === "live" || (livePhase(r, now) === "upcoming" && dayKey(new Date(r.scheduledAt)) === today))
    .map((r) => ({ _id: r._id, batch: r.batch, title: r.title, at: r.scheduledAt, durationMinutes: r.durationMinutes, live: livePhase(r, now) === "live" }));
  const examsToday = examRows.map((e) => {
    const at = e.opensAt && +e.opensAt > now ? e.opensAt : e.closesAt;
    return at && dayKey(new Date(at)) === today ? { _id: e.paperSet?.group || e._id, batch: inBatch(e.batches), title: e.title, at, closes: at === e.closesAt, durationMinutes: e.durationMinutes } : null;
  }).filter(Boolean);
  const tasks = tutors.filter((t) => t.day === today).flatMap((t) => (t.tasks || []).slice(0, 6).map((k) => ({ batch: t.batch, title: k.title, detail: k.detail, link: k.link, kind: k.kind })));
  // A streak still counts while yesterday or today was completed.
  const yesterday = dayKey(new Date(now - 86400000));
  const streak = Math.max(0, ...tutors.filter((t) => t.lastCompleteDay === today || t.lastCompleteDay === yesterday).map((t) => t.streak || 0));
  return { exam, live, liveToday, examsToday, tasks: tasks.slice(0, 8), streak };
};

module.exports = { forBatch, forHome, livePhase };
