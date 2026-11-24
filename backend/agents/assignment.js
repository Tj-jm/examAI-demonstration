const AgentRun = require("../models/agentRunModel");
const Batch = require("../models/batchModel");
const { Assignment, AssignmentSubmission } = require("../models/assignmentModel");
const { rosterIds } = require("../utils/roster");
const { notify } = require("../utils/notify");

// The assignment agent (jobs/agents.js, every 10 minutes, or "Run now"):
// suggests a grade and feedback for each new hand-in in the batches that
// allow it (ai/assignmentCheck.js), then offers to apply them; and the day
// before work is due, reminds students who haven't handed it in.
const MAX_PER_PASS = 20;
const DECLINED_MS = 90 * 86400000;

const allowedBatches = async () =>
  (await Batch.find({ "features.agentAssignments": true, "features.assignments": { $ne: false } }).select("_id").lean()).map((b) => b._id);

const sweep = async () => {
  const engine = require("./engine");
  const s = await engine.settings();
  if (!s.enabled || !s.assignment?.enabled) return { skipped: "off" };
  const owner = await engine.actingOwner();
  if (!owner) return { skipped: "no owner account" };
  const batches = await allowedBatches();
  if (!batches.length) return { skipped: "no batch allows it" };

  // Hand-ins already waiting in an open request are left alone, and so is a
  // suggestion staff turned down (or a request they cancelled), until the
  // student hands in again.
  const runs = await AgentRun.find({
    agent: "assignment",
    $or: [
      { status: { $in: ["awaiting", "running"] } },
      { status: "cancelled", createdAt: { $gte: new Date(Date.now() - DECLINED_MS) } },
      { "steps.status": "rejected", createdAt: { $gte: new Date(Date.now() - DECLINED_MS) } },
    ],
  }).select("status createdAt steps.status steps.args.submissionId").lean();
  const busy = [];
  const declined = new Map();
  for (const r of runs) {
    for (const st of r.steps) {
      const subId = st.args?.submissionId;
      if (!subId) continue;
      if (["awaiting", "running"].includes(r.status)) busy.push(subId);
      else if (st.status === "rejected" || r.status === "cancelled") {
        if (!declined.has(subId) || declined.get(subId) < r.createdAt) declined.set(subId, r.createdAt);
      }
    }
  }

  const candidates = await AssignmentSubmission.find({ status: "submitted", batch: { $in: batches }, _id: { $nin: busy } })
    .sort({ submittedAt: 1 }).limit(MAX_PER_PASS + declined.size).populate("student", "name");
  const subs = candidates.filter((sub) => {
    const at = declined.get(String(sub._id));
    return !at || (sub.submittedAt && sub.submittedAt > at);
  }).slice(0, MAX_PER_PASS);
  const { checkSubmission } = require("../ai/assignmentCheck");
  // No request here: relative /media links get the server's public address.
  const origin = String(process.env.SERVER_URL || process.env.PROD_ORIGIN || "").replace(/\/$/, "");
  const toUrl = (u) => (/^https?:\/\//i.test(u) ? u : `${origin}${u}`);
  let checked = 0;
  let failed = 0;
  const ready = [];
  for (const sub of subs) {
    const assignment = await Assignment.findById(sub.assignment);
    if (!assignment) continue;
    // A suggestion made before the student handed in again is stale.
    const fresh = sub.ai?.at && sub.submittedAt && sub.ai.at >= sub.submittedAt;
    if (!fresh) {
      try {
        await checkSubmission({ assignment, submission: sub, toUrl, by: "agent", user: owner._id });
        checked += 1;
      } catch {
        failed += 1;
        continue;
      }
    }
    ready.push({
      tool: "apply_assignment_grade",
      title: `Grade: ${sub.student?.name || "a student"} · ${assignment.title}`,
      args: {
        submissionId: String(sub._id),
        batchId: String(sub.batch),
        studentName: sub.student?.name || "A student",
        assignmentTitle: assignment.title,
        marks: sub.ai.marks,
        outOf: assignment.maxMarks,
        returnToStudent: Boolean(s.assignment.returnGrades),
      },
    });
  }
  if (!ready.length) return { checked, failed, run: null };
  const run = await engine.startPrepared({
    agent: "assignment",
    user: owner,
    request: "Assignment pass",
    reply: `Suggested grades for ${ready.length} hand-in${ready.length === 1 ? "" : "s"}${failed ? ` (${failed} couldn't be read)` : ""}. Each suggestion is also on the hand-in, for a teacher to accept or change.`,
    steps: ready,
  });
  return { checked, failed, run: run?._id };
};

// Once per assignment: students who haven't handed in work due within a day.
const reminders = async (now = new Date()) => {
  const engine = require("./engine");
  const s = await engine.settings();
  if (!s.enabled || !s.assignment?.enabled || s.assignment.reminders === false) return { skipped: "off" };
  const batches = await allowedBatches();
  if (!batches.length) return { reminded: 0 };
  const soon = await Assignment.find({
    batch: { $in: batches }, isPublished: true, remindedAt: null,
    dueAt: { $gt: now, $lte: new Date(now.getTime() + 24 * 3600000) },
    $or: [{ opensAt: null }, { opensAt: { $lte: now } }],
  });
  let reminded = 0;
  for (const a of soon) {
    const handedIn = new Set((await AssignmentSubmission.find({ assignment: a._id, status: { $ne: "draft" } }).distinct("student")).map(String));
    const due = (await rosterIds(a.batch)).filter((id) => !handedIn.has(String(id)));
    await notify(due, "assignmentReminder", {
      title: `Due soon: ${a.title}`,
      body: `Hand it in by ${new Date(a.dueAt).toUTCString().slice(0, 22)}.`,
      link: `/batches/${a.batch}/assignments/${a._id}`,
    }).catch(() => {});
    await Assignment.updateOne({ _id: a._id }, { $set: { remindedAt: now } });
    reminded += due.length;
  }
  return { reminded };
};

// A hand-in arrived: the next pass (within 10 minutes) picks it up.
const onSubmitted = () => {};

module.exports = { sweep, reminders, onSubmitted };
