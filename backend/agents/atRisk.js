const mongoose = require("mongoose");
const AgentRun = require("../models/agentRunModel");
const Batch = require("../models/batchModel");
const Submission = require("../models/submissionModel");
const PracticeAttempt = require("../models/practiceAttemptModel");
const Notification = require("../models/notificationModel");

// The at-risk agent's weekly pass (jobs/agents.js, or "Run now"). For each
// batch that allows it, looks at each active student:
//   - scores falling: last three graded exams vs the three before
//   - low scores: average of the last three below the setting
//   - gone quiet: no practice or exams for N days, after being active
//   - missing classes: absent from the last three in-app classes
// and offers each one a personal check-in (one approval step each), with
// their weakest topic to practise. The plan's summary tells staff what it
// found, even if they send nothing.
const WEEK_MS = 6 * 86400000;
const MAX_PER_BATCH = 30;

const pct = (s) => (s.totalMarks ? (s.marks / s.totalMarks) * 100 : null);
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

const signalsFor = async (studentId, batch, cfg, recentClasses) => {
  const reasons = [];
  const subs = await Submission.find({ student: studentId, batch: batch._id, status: "graded" })
    .sort({ submittedAt: -1 }).limit(6).select("marks totalMarks submittedAt").lean();
  const scores = subs.map(pct).filter((x) => x !== null);
  const last = avg(scores.slice(0, 3));
  const before = avg(scores.slice(3, 6));
  if (scores.length >= 6 && before - last >= cfg.scoreDrop) reasons.push(`scores down ${Math.round(before - last)} pts (${Math.round(before)}% → ${Math.round(last)}%)`);
  else if (scores.length >= 3 && last < cfg.lowScore) reasons.push(`averaging ${Math.round(last)}% on recent exams`);

  const quietSince = new Date(Date.now() - cfg.quietDays * 86400000);
  const [recentPractice, recentExam, everActive] = await Promise.all([
    PracticeAttempt.exists({ student: studentId, batch: batch._id, createdAt: { $gte: quietSince } }),
    Submission.exists({ student: studentId, batch: batch._id, submittedAt: { $gte: quietSince } }),
    PracticeAttempt.exists({ student: studentId, batch: batch._id }).then((x) => x || Submission.exists({ student: studentId, batch: batch._id })),
  ]);
  if (everActive && !recentPractice && !recentExam) reasons.push(`no practice or exams for ${cfg.quietDays}+ days`);

  if (recentClasses.length >= 3) {
    const LiveAttendance = require("../models/liveAttendanceModel");
    const came = await LiveAttendance.exists({ liveClass: { $in: recentClasses }, student: studentId });
    if (!came) reasons.push("missed the last 3 live classes");
  }
  return reasons;
};

const sweep = async ({ force = false } = {}) => {
  const engine = require("./engine");
  const { rankWeakTopics } = require("../utils/weakTopics");
  const { getActiveBatchStudentIds, reachableStudents } = require("../utils/batchMembers");
  const Student = require("../models/studentModel");
  const LiveClass = require("../models/liveClassModel");
  const s = await engine.settings();
  const cfg = { scoreDrop: 15, lowScore: 40, quietDays: 10, ...(s.atRisk?.toObject?.() || s.atRisk || {}) };
  if (!s.enabled || !cfg.enabled) return { skipped: "off" };
  const owner = await engine.actingOwner();
  if (!owner) return { skipped: "no owner account" };
  const batches = await Batch.find({ "features.agentAtRisk": true }).select("name").lean();
  // Timed-out attempts are scored when looked at (utils/finishAttempt.js):
  // score them now, so this week's numbers include them.
  await require("../utils/finishAttempt").closeOverdue({ batch: { $in: batches.map((b) => b._id) } }).catch(() => {});
  if (!batches.length) return { skipped: "no batch allows it" };

  const runs = [];
  for (const batch of batches) {
    // Once a week per batch, unless run by hand.
    if (!force && await AgentRun.exists({ agent: "atRisk", batches: batch._id, createdAt: { $gte: new Date(Date.now() - WEEK_MS) } })) continue;
    const studentIds = (await reachableStudents(await getActiveBatchStudentIds(batch._id))).map((x) => new mongoose.Types.ObjectId(String(x)));
    const recentClasses = (await LiveClass.find({ batch: batch._id, provider: "livekit", status: "ended" }).sort({ scheduledAt: -1 }).limit(3).select("_id").lean()).map((c) => c._id);
    // Nobody is checked on twice in a week, and nobody staff already
    // decided about (sent or rejected) in the last week is offered again.
    const weekAgo = new Date(Date.now() - WEEK_MS);
    const nudged = new Set((await Notification.find({ type: "studyNudge", student: { $in: studentIds }, createdAt: { $gte: weekAgo } }).select("student").lean()).map((n) => String(n.student)));
    for (const r of await AgentRun.find({ agent: "atRisk", batches: batch._id, createdAt: { $gte: weekAgo } }).select("steps.args.studentId").lean()) {
      for (const st of r.steps) nudged.add(String(st.args?.studentId));
    }

    const steps = [];
    const counts = {};
    const weakCount = new Map();
    for (const sid of studentIds) {
      if (steps.length >= MAX_PER_BATCH || nudged.has(String(sid))) continue;
      const reasons = await signalsFor(sid, batch, cfg, recentClasses);
      if (!reasons.length) continue;
      for (const r of reasons) { const k = r.split(" ")[0]; counts[k] = (counts[k] || 0) + 1; }
      const weak = (await rankWeakTopics(sid, batch._id).catch(() => []))[0];
      const weakOk = weak && weak.accuracy < 60;
      if (weakOk) weakCount.set(weak.title, (weakCount.get(weak.title) || 0) + 1);
      const student = await Student.findById(sid).select("name").lean();
      const first = (student?.name || "there").split(" ")[0];
      const message = weakOk
        ? `Hi ${first}, we noticed things have been a bit tough lately. A few minutes on ${weak.title} (you're at ${weak.accuracy}% there) will help most. You've got this, and your teachers are here if you need help.`
        : `Hi ${first}, we haven't seen much of you lately. Jump back in with a short practice session; your teachers are here if you need help.`;
      steps.push({
        tool: "nudge_student",
        title: `Check in: ${student?.name || "a student"}`,
        args: {
          studentId: String(sid), batchId: String(batch._id), studentName: student?.name || "A student", batchName: batch.name,
          reasons: weakOk ? [...reasons, `weakest: ${weak.title} ${weak.accuracy}%`] : reasons,
          message,
          topicId: weakOk && !weak.chapterPool ? String(weak._id) : null,
          topicTitle: weakOk ? weak.title : null,
        },
      });
    }
    if (!steps.length) continue;
    const common = [...weakCount.entries()].sort((a, b) => b[1] - a[1])[0];
    const run = await engine.startPrepared({
      agent: "atRisk",
      user: owner,
      request: `Weekly check: ${batch.name}`,
      reply: `${steps.length} student${steps.length === 1 ? "" : "s"} in ${batch.name} could use a check-in.${common && common[1] >= 2 ? ` The most common weak spot is ${common[0]} (${common[1]} students); a revision class on it could help, so ask the copilot to schedule one.` : ""} Each message is personal and points to their weakest topic.`,
      steps,
    });
    runs.push(run?._id);
  }
  return { runs };
};

module.exports = { sweep, signalsFor };
