const LiveClass = require("../models/liveClassModel");
const Batch = require("../models/batchModel");

// The after-class agent's pass (jobs/agents.js): for each in-app class
// that ended in the last few days on a batch that allows it, once its notes
// are ready (or an hour after the end if there are none), plans a quiz from
// the notes and a catch-up message for absentees. Once per class.
const RECENT_MS = 3 * 86400000;
const NO_NOTES_WAIT_MS = 60 * 60 * 1000;

const sweep = async () => {
  const engine = require("./engine");
  const { absentees } = require("./tools/afterClass");
  const s = await engine.settings();
  const cfg = s.afterClass || {};
  if (!s.enabled || !cfg.enabled) return { skipped: "off" };
  const owner = await engine.actingOwner();
  if (!owner) return { skipped: "no owner account" };
  const batches = await Batch.find({ "features.agentAfterClass": true }).select("_id").lean();
  if (!batches.length) return { skipped: "no batch allows it" };

  const classes = await LiveClass.find({
    provider: "livekit", status: "ended", agentAfterClassAt: null,
    batch: { $in: batches.map((b) => b._id) }, updatedAt: { $gte: new Date(Date.now() - RECENT_MS) },
  });
  const runs = [];
  for (const lc of classes) {
    const notes = lc.notes?.status || "none";
    if (notes === "writing") continue;
    const endedLongAgo = Date.now() - new Date(lc.updatedAt) > NO_NOTES_WAIT_MS;
    if (notes !== "ready" && !endedLongAgo) continue;

    const steps = [];
    const notesBits = [];
    const quiz = cfg.quiz !== false && notes === "ready" && lc.publishChapter;
    if (quiz) {
      steps.push({ tool: "make_class_quiz", title: "Make a quiz from the notes", args: { liveClassId: String(lc._id), batchId: String(lc.batch), classTitle: lc.title, count: cfg.quizSize || 5 } });
      steps.push({ tool: "publish_class_quiz", title: "Publish the quiz", args: { exam: "step:1", batchId: String(lc.batch) } });
    } else if (cfg.quiz !== false) {
      notesBits.push(notes !== "ready" ? "no quiz, because the class had no captions to make notes from" : "no quiz, because the class has no chapter set");
    }
    if (cfg.absentees !== false) {
      const absent = await absentees(lc._id, lc.batch);
      if (absent.length) {
        steps.push({ tool: "message_absentees", title: "Message students who missed it", args: { liveClassId: String(lc._id), batchId: String(lc.batch), classTitle: lc.title, absent: absent.length, withQuiz: Boolean(quiz) } });
      } else notesBits.push("everyone attended");
    }
    lc.agentAfterClassAt = new Date();
    await lc.save();
    if (!steps.length) continue;
    const run = await engine.startPrepared({
      agent: "afterClass",
      user: owner,
      request: `After class: ${lc.title}`,
      reply: `“${lc.title}” has ended.${quiz ? ` I'll make a ${cfg.quizSize || 5}-question quiz from the class notes and publish it.` : ""}${steps.some((st) => st.tool === "message_absentees") ? " I'll send the students who missed it a catch-up message." : ""}${notesBits.length ? ` (${notesBits.join("; ")}.)` : ""}`,
      steps,
    });
    runs.push(run?._id);
  }
  return { runs };
};

module.exports = { sweep };
