const AgentRun = require("../models/agentRunModel");
const AiConfig = require("../models/aiConfigModel");
const Batch = require("../models/batchModel");
const Submission = require("../models/submissionModel");
const User = require("../models/userModel");
const { call } = require("./invoke");

// The grading agent's pass (jobs/agents.js, every few minutes, or "Run
// now"): AI-marks written answers waiting for grading, the same way the
// grading screen's AI button does, then offers to apply the marks of each
// script where every answer is at or above the confidence setting. Scripts
// it isn't sure about become "send to a person" steps: open the script from
// the step, and approve to put it in the grading queue (to anyone, or a
// grader picked on the step) with the AI suggestions filled in.
const MAX_SCRIPTS = 20;

// The three batch switches the agent needs, by name.
const SWITCHES = [
  ["agentGrading", "Grading agent"],
  ["aiAssist", "AI help"],
  ["examAiGrading", "AI-assisted grading"],
];

// Batches with scripts waiting that the agent may not touch, and why: so
// "nothing to do" never hides work sitting in a batch with a switch off.
const blockedBatches = async () => {
  const waiting = await Submission.aggregate([
    { $match: { status: "grading" } },
    { $group: { _id: "$batch", n: { $sum: 1 } } },
  ]);
  if (!waiting.length) return [];
  const batches = await Batch.find({ _id: { $in: waiting.map((w) => w._id) } }).select("name features").lean();
  const count = new Map(waiting.map((w) => [String(w._id), w.n]));
  return batches
    .map((b) => ({ batchId: String(b._id), name: b.name, waiting: count.get(String(b._id)) || 0, missing: SWITCHES.filter(([k]) => !b.features?.[k]).map(([, label]) => label) }))
    .filter((b) => b.missing.length);
};

const sweep = async () => {
  const engine = require("./engine");
  const s = await engine.settings();
  if (!s.enabled || !s.grading?.enabled) return { skipped: "off" };
  const config = await AiConfig.get();
  if (!config.features?.writtenGrading) return { skipped: "AI grading is switched off in Settings → AI" };
  const owner = await engine.actingOwner();
  if (!owner) return { skipped: "no owner account" };

  const blocked = await blockedBatches();
  const batches = await Batch.find({ "features.agentGrading": true, "features.aiAssist": true, "features.examAiGrading": true }).select("_id graders teachers").lean();
  if (!batches.length) {
    const why = blocked.length
      ? `no batch has all three switches on (${blocked.map((b) => `${b.name}: ${b.waiting} waiting, needs ${b.missing.join(" + ")}`).join("; ")})`
      : "no batch allows it";
    return { skipped: why, blocked };
  }
  // Attempts that ran out of time with the exam closed are only scored when
  // looked at (utils/finishAttempt.js); look now, so their written answers
  // reach this pass instead of waiting for someone to open them.
  await require("../utils/finishAttempt").closeOverdue({ batch: { $in: batches.map((b) => b._id) } }).catch(() => {});

  // Scripts already waiting in an open request are left alone.
  const open = await AgentRun.find({ agent: "grading", status: { $in: ["awaiting", "running"] } }).select("steps.args.submissionId").lean();
  const busy = open.flatMap((r) => r.steps.map((st) => st.args?.submissionId)).filter(Boolean);

  // Left alone: approved regrades (a person's job), scripts a person holds
  // or was assigned, and ones already sent to a person for review.
  const subs = await Submission.find({
    status: "grading", batch: { $in: batches.map((b) => b._id) }, _id: { $nin: busy },
    heldBy: null, agentReviewAt: null,
    $nor: [{ "referral.requested": true, "referral.decision": "approved" }],
  })
    .sort({ submittedAt: 1 })
    .limit(MAX_SCRIPTS)
    .populate("student", "name")
    .populate("exam", "title questions");
  const { gradeWithAi } = require("../controllers/admin/gradingController");
  const { Question } = require("../models/questionModel");
  const min = s.grading.minConfidence ?? 0.85;
  let marked = 0;
  const ready = [];
  const review = [];
  const staffNames = new Map();

  for (const sub of subs) {
    const pending = sub.answers.filter((a) => a.questionType === "written" && (a.marksAwarded === null || a.marksAwarded === undefined));
    if (!pending.length) continue;
    // A person has started marking it: theirs to finish.
    if (sub.answers.some((a) => a.questionType === "written" && a.gradedBy === "teacher")) continue;
    for (const a of pending) {
      // Marked before AI wrote an explanation for the student (no
      // aiFeedback at all, not even null): marked again, once.
      if (a.aiMarks !== null && a.aiMarks !== undefined && a.aiFeedback !== undefined) continue;
      try {
        await call(gradeWithAi, { user: owner, params: { id: String(sub._id), answerId: String(a._id) } });
        marked += 1;
      } catch {
        // No rubric, an empty answer, AI off for the batch: a teacher's job.
      }
    }
    const fresh = await Submission.findById(sub._id).select("answers");
    const answers = fresh.answers.filter((a) => pending.some((p) => String(p._id) === String(a._id)));
    const qs = await Question.find({ _id: { $in: answers.map((a) => a.question) } }).select("marks subQuestions.marks").lean();
    const marksOf = new Map(qs.map((q) => [String(q._id), q]));
    // A passage's written question is out of its own marks.
    const outOf = { get: (id, a) => { const q = marksOf.get(id); return (a && a.subIndex != null ? q?.subQuestions?.[a.subIndex]?.marks : q?.marks) || 0; } };
    const order = (sub.exam?.questions || []).map(String);
    const base = {
      submissionId: String(sub._id),
      batchId: String(sub.batch),
      studentName: sub.student?.name || "A student",
      examTitle: sub.exam?.title || "an exam",
    };
    // An answer held by the handwriting check (utils/handwriting.js) waits
    // for a teacher whatever the confidence.
    const sure = (a) => a.aiMarks !== null && a.aiMarks !== undefined && (a.aiConfidence ?? 0) >= min && a.handwritingAction !== "hold";
    if (answers.every(sure)) {
      ready.push({
        tool: "apply_grades",
        title: `Apply marks: ${base.studentName}`,
        args: { ...base, grades: answers.map((a) => ({ answerId: String(a._id), marks: a.aiMarks, outOf: outOf.get(String(a.question), a), confidence: a.aiConfidence })) },
      });
      continue;
    }
    const batch = batches.find((b) => String(b._id) === String(sub.batch));
    const staffIds = [...(batch?.graders || []), ...(batch?.teachers || [])].map(String);
    const missing = staffIds.filter((x) => !staffNames.has(x));
    if (missing.length) {
      const users = await User.find({ _id: { $in: missing }, isActive: { $ne: false }, isDeleted: { $ne: true } }).select("name identifier").lean();
      for (const u of users) staffNames.set(String(u._id), u.identifier || u.name);
    }
    review.push({
      tool: "review_script",
      title: `Needs a person: ${base.studentName}`,
      args: {
        ...base,
        unsure: answers.filter((a) => !sure(a)).map((a) => ({
          answerId: String(a._id),
          question: Math.max(1, order.indexOf(String(a.question)) + 1),
          marks: a.aiMarks ?? null,
          outOf: outOf.get(String(a.question), a),
          confidence: a.aiConfidence ?? null,
        })),
        graderId: "",
        graders: staffIds.filter((x) => staffNames.has(x)).map((x) => ({ _id: x, name: staffNames.get(x) })),
      },
    });
  }

  if (!ready.length && !review.length) return { marked, needTeacher: 0, run: null, blocked };
  if (review.length) await Submission.updateMany({ _id: { $in: review.map((r) => r.args.submissionId) } }, { agentReviewAt: new Date() });
  const pct = Math.round(min * 100);
  const run = await engine.startPrepared({
    agent: "grading",
    user: owner,
    request: "Grading pass",
    reply: [
      `AI-marked ${marked} written answer${marked === 1 ? "" : "s"}.`,
      ready.length ? `${ready.length} script${ready.length === 1 ? " is" : "s are"} marked with ${pct}%+ confidence on every answer and ready to apply.` : "",
      review.length ? `${review.length} need${review.length === 1 ? "s" : ""} a person (an answer below ${pct}%, no rubric, or not handwritten): open each from its step, and approve to put it in the grading queue with the AI suggestions filled in, for anyone or a grader you pick.` : "",
    ].filter(Boolean).join(" "),
    steps: [...ready, ...review],
  });
  return { marked, needTeacher: review.length, run: run?._id, blocked };
};

module.exports = { sweep, blockedBatches };
