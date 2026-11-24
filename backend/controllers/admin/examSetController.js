const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Exam = require("../../models/examModel");
const ExamSetGroup = require("../../models/examSetGroupModel");
const ExamSetAssignment = require("../../models/examSetAssignmentModel");
const Submission = require("../../models/submissionModel");
const { Question } = require("../../models/questionModel");
const Topic = require("../../models/topicModel");
const { labelFor, unitsOf, drawSets, overlapOf } = require("../../utils/examSets");

// Paper sets (models/examSetGroupModel.js): a pool exam cut into several
// ordinary exams, each student given one (utils/examSets.js). Each set is a
// normal Exam, so the rest of the system (taking, marking, results) is
// unchanged. Settings below come from the pool exam when the sets are built.

const COPIED = [
  "description", "subjects", "topics", "mode", "durationMinutes", "bufferSeconds", "scriptGraceMinutes",
  "awayMode", "awayMinutes", "calculator", "liveHours", "unpublishAt", "attemptsAllowed",
  "shuffleQuestions", "showResultImmediately",
];

const SAT = { $in: ["in_progress", "submitted", "grading", "graded", "rejected", "disqualified"] };

const notFound = (res) => {
  res.status(404);
  throw new Error("Paper sets not found.");
};

const loadGroup = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) notFound(res);
  const group = await ExamSetGroup.findById(req.params.id);
  if (!group) notFound(res);
  return group;
};

// The pool's questions in pool order.
const poolQuestions = async (group) => {
  const rows = await Question.find({ _id: { $in: group.pool } }).select("type marks topic difficulty group status").lean();
  const byId = new Map(rows.map((q) => [String(q._id), q]));
  return group.pool.map((id) => byId.get(String(id))).filter(Boolean);
};

// What the rule editor offers: the pool's items split by topic, by
// difficulty, and by both, with how many items each holds.
const poolInfo = async (group) => {
  const questions = await poolQuestions(group);
  const units = unitsOf(questions);
  const topicIds = [...new Set(units.map((u) => u.topic).filter(Boolean))];
  const topics = new Map((await Topic.find({ _id: { $in: topicIds } }).select("title").lean()).map((t) => [String(t._id), t.title]));
  const tally = (keyOf) => {
    const map = new Map();
    for (const u of units) {
      const k = keyOf(u);
      const row = map.get(k.key) || { ...k.rule, label: k.label, items: 0 };
      row.items += 1;
      map.set(k.key, row);
    }
    return [...map.values()];
  };
  const topicPart = (u) => ({ id: u.topic, label: u.topic ? topics.get(u.topic) || "Topic" : "No topic" });
  const marks = [...new Set(units.map((u) => u.marks))];
  return {
    questions: questions.length,
    items: units.length,
    equalMarks: marks.length <= 1,
    unapproved: questions.filter((q) => ["pending_review", "draft", "rejected"].includes(q.status)).length,
    byTopic: tally((u) => ({ key: u.topic || "-", label: topicPart(u).label, rule: { topic: u.topic, noTopic: !u.topic, difficulty: null } })),
    byDifficulty: tally((u) => ({ key: u.difficulty || "-", label: u.difficulty || "Any", rule: { topic: null, difficulty: u.difficulty } })),
    byBoth: tally((u) => ({
      key: `${u.topic || "-"}|${u.difficulty || "-"}`,
      label: `${topicPart(u).label} · ${u.difficulty || "any"}`,
      rule: { topic: u.topic, noTopic: !u.topic, difficulty: u.difficulty },
    })),
  };
};

// Each set with its schedule and how many students have it and sat it.
const setRows = async (group) => {
  const ids = group.sets.map((s) => s.exam);
  const [exams, given, sat] = await Promise.all([
    Exam.find({ _id: { $in: ids } }).select("title questions opensAt closesAt isPublished isActive").populate("questions", "marks").lean(),
    ExamSetAssignment.aggregate([{ $match: { group: group._id } }, { $group: { _id: "$exam", n: { $sum: 1 } } }]),
    Submission.aggregate([{ $match: { exam: { $in: ids }, status: SAT } }, { $group: { _id: "$exam", students: { $addToSet: "$student" } } }]),
  ]);
  const byId = new Map(exams.map((e) => [String(e._id), e]));
  const givenOf = new Map(given.map((g) => [String(g._id), g.n]));
  const satOf = new Map(sat.map((g) => [String(g._id), g.students.length]));
  return group.sets.map((s) => {
    const e = byId.get(String(s.exam));
    return {
      exam: s.exam,
      label: s.label,
      questions: e?.questions?.length || 0,
      totalMarks: (e?.questions || []).reduce((sum, q) => sum + (q?.marks || 0), 0),
      opensAt: e?.opensAt || null,
      closesAt: e?.closesAt || null,
      given: givenOf.get(String(s.exam)) || 0,
      sat: satOf.get(String(s.exam)) || 0,
    };
  });
};

const anySat = async (group) =>
  group.sets.length ? Submission.countDocuments({ exam: { $in: group.sets.map((s) => s.exam) }, status: SAT }) : 0;

const shape = async (group) => {
  const populated = await ExamSetGroup.findById(group._id).populate("batches", "name").populate("source", "title").lean();
  const sets = await setRows(group);
  const setExams = await Exam.find({ _id: { $in: group.sets.map((s) => s.exam) } }).select("questions").lean();
  const keys = setExams.map((e) => e.questions.map((q) => ({ key: String(q) })));
  return {
    ...populated,
    sets,
    overlap: setExams.length > 1 ? overlapOf(keys) : null,
    pool: await poolInfo(group),
    locked: (await anySat(group)) > 0,
  };
};

//@desc   Paper-set groups
//@route  GET /api/exam-sets
//@access Private
const listGroups = asyncHandler(async (req, res) => {
  const groups = await ExamSetGroup.find({}).populate("batches", "name").sort({ createdAt: -1 }).limit(300).lean();
  res.status(200).json({
    groups: groups.map((g) => ({
      _id: g._id, title: g.title, setCount: g.sets.length || g.setCount, perPaper: g.perPaper,
      assign: g.assign, isPublished: g.isPublished, batches: g.batches, builtAt: g.builtAt, poolSize: g.pool.length,
    })),
  });
});

//@desc   One group with its sets, schedule and pool breakdown
//@route  GET /api/exam-sets/:id
const getGroup = asyncHandler(async (req, res) => {
  const group = await loadGroup(req, res);
  res.status(200).json(await shape(group));
});

//@desc   Start paper sets from an exam's questions
//@route  POST /api/exam-sets  { source }
const createGroup = asyncHandler(async (req, res) => {
  const source = mongoose.isValidObjectId(req.body.source) ? await Exam.findById(req.body.source) : null;
  if (!source || source.offline || source.createdByStudent || source.paperSet?.group) {
    res.status(400);
    throw new Error("Pick an ordinary exam to take the questions from.");
  }
  if (source.questions.length < 2) {
    res.status(400);
    throw new Error("The exam needs at least 2 questions to make paper sets.");
  }
  const units = unitsOf(await Question.find({ _id: { $in: source.questions } }).select("group").lean());
  const group = await ExamSetGroup.create({
    title: source.title,
    source: source._id,
    pool: source.questions,
    perPaper: Math.max(1, Math.min(10, units.length - 1)),
    setCount: 4,
    batches: source.batches,
    opensAt: source.opensAt || null,
    closesAt: source.closesAt || null,
    createdBy: req.user?._id,
  });
  res.status(201).json(await shape(group));
});

//@desc   Change a group's settings or schedule
//@route  PUT /api/exam-sets/:id
// Body: title, perPaper, setCount, rules, assign, batches, opensAt, closesAt,
// windows: [{ exam, opensAt, closesAt }] (schedule mode, per set).
const updateGroup = asyncHandler(async (req, res) => {
  const group = await loadGroup(req, res);
  const b = req.body || {};
  const locked = (await anySat(group)) > 0;
  const structural = ["perPaper", "setCount", "rules"].some((k) => b[k] !== undefined);
  if (locked && structural) {
    res.status(409);
    throw new Error("Students have already sat these sets, so the papers can't change. Make new paper sets instead.");
  }

  if (typeof b.title === "string" && b.title.trim()) group.title = b.title.trim().slice(0, 160);
  if (b.perPaper !== undefined) group.perPaper = Math.max(1, Math.min(500, Math.round(Number(b.perPaper) || 1)));
  if (b.setCount !== undefined) group.setCount = Math.max(2, Math.min(30, Math.round(Number(b.setCount) || 2)));
  if (Array.isArray(b.rules)) {
    group.rules = b.rules.slice(0, 60).map((r) => ({
      topic: mongoose.isValidObjectId(r.topic) ? r.topic : null,
      noTopic: !mongoose.isValidObjectId(r.topic) && r.noTopic === true,
      difficulty: ["easy", "medium", "hard"].includes(r.difficulty) ? r.difficulty : null,
      label: String(r.label || "").slice(0, 120),
      count: Math.max(0, Math.min(500, Math.round(Number(r.count) || 0))),
    }));
  }
  if (["random", "schedule"].includes(b.assign)) group.assign = b.assign;
  if (Array.isArray(b.batches)) group.batches = b.batches.filter((x) => mongoose.isValidObjectId(x));
  const when = (v) => (v ? new Date(v) : null);
  if (b.opensAt !== undefined) group.opensAt = when(b.opensAt);
  if (b.closesAt !== undefined) group.closesAt = when(b.closesAt);
  if (group.opensAt && group.closesAt && group.closesAt <= group.opensAt) {
    res.status(400);
    throw new Error("The closing time must be after the opening time.");
  }
  await group.save();

  // The sets follow the group: batches always, the shared window in random
  // mode, each set's own window in schedule mode.
  const ids = group.sets.map((s) => s.exam);
  if (ids.length) {
    await Exam.updateMany({ _id: { $in: ids } }, { $set: { batches: group.batches } });
    if (group.assign === "random") {
      await Exam.updateMany({ _id: { $in: ids } }, { $set: { opensAt: group.opensAt, closesAt: group.closesAt } });
    } else if (Array.isArray(b.windows)) {
      for (const w of b.windows) {
        if (!ids.some((id) => String(id) === String(w.exam))) continue;
        const opensAt = when(w.opensAt);
        const closesAt = when(w.closesAt);
        if (opensAt && closesAt && closesAt <= opensAt) {
          res.status(400);
          throw new Error("Each set's closing time must be after its opening time.");
        }
        await Exam.updateOne({ _id: w.exam }, { $set: { opensAt, closesAt } });
      }
    }
  }
  res.status(200).json(await shape(group));
});

//@desc   Draw the sets (again) from the pool
//@route  POST /api/exam-sets/:id/build
// Creates one ordinary exam per set from the pool exam's settings. Refused
// once anyone has sat a set; before that, the old sets are replaced.
const buildSets = asyncHandler(async (req, res) => {
  const group = await loadGroup(req, res);
  if (group.isPublished) {
    res.status(409);
    throw new Error("Unpublish the paper sets before drawing them again.");
  }
  if ((await anySat(group)) > 0) {
    res.status(409);
    throw new Error("Students have already sat these sets, so they can't be drawn again.");
  }
  const source = await Exam.findById(group.source).lean();
  if (!source) {
    res.status(400);
    throw new Error("The exam the questions came from was deleted.");
  }
  // The pool follows the source exam's current questions.
  group.pool = source.questions;
  const questions = await poolQuestions(group);
  const units = unitsOf(questions);
  if (group.perPaper > units.length) {
    res.status(400);
    throw new Error(`Each paper has ${group.perPaper} items, but the pool has only ${units.length}.`);
  }
  let drawn;
  try {
    drawn = drawSets(units, { perPaper: group.perPaper, setCount: group.setCount, rules: group.rules });
  } catch (error) {
    res.status(400);
    throw error;
  }

  // Keep each label's schedule across a redraw.
  const oldExams = await Exam.find({ _id: { $in: group.sets.map((s) => s.exam) } }).select("opensAt closesAt paperSet").lean();
  const oldWindow = new Map(oldExams.map((e) => [e.paperSet?.label, { opensAt: e.opensAt, closesAt: e.closesAt }]));

  const created = [];
  for (let i = 0; i < drawn.length; i += 1) {
    const label = labelFor(i);
    const window = group.assign === "schedule"
      ? oldWindow.get(label) || { opensAt: null, closesAt: null }
      : { opensAt: group.opensAt, closesAt: group.closesAt };
    const settings = Object.fromEntries(COPIED.filter((k) => source[k] !== undefined).map((k) => [k, source[k]]));
    const exam = await Exam.create({
      ...settings,
      title: `${group.title} · Set ${label}`,
      questions: drawn[i].flatMap((u) => u.questions.map((q) => q._id)),
      batches: group.batches,
      ...window,
      isPublished: false,
      isActive: false,
      source: "manual",
      paperSet: { group: group._id, label },
    });
    created.push({ exam: exam._id, label });
  }

  // The old sets go only after the new ones exist.
  if (oldExams.length) {
    await ExamSetAssignment.deleteMany({ group: group._id });
    await Submission.deleteMany({ exam: { $in: oldExams.map((e) => e._id) } });
    await Exam.deleteMany({ _id: { $in: oldExams.map((e) => e._id) } });
  }
  group.sets = created;
  group.builtAt = new Date();
  await group.save();
  res.status(200).json(await shape(group));
});

//@desc   Publish or unpublish every set at once
//@route  PUT /api/exam-sets/:id/publish  { isPublished }
const setPublished = asyncHandler(async (req, res) => {
  const group = await loadGroup(req, res);
  const publish = Boolean(req.body?.isPublished);
  const ids = group.sets.map((s) => s.exam);
  if (publish) {
    if (!ids.length) {
      res.status(400);
      throw new Error("Draw the sets before publishing.");
    }
    if (!group.batches.length) {
      res.status(400);
      throw new Error("Pick at least one batch before publishing.");
    }
    const exams = await Exam.find({ _id: { $in: ids } }).select("questions opensAt").lean();
    const unreviewed = await Question.countDocuments({ _id: { $in: exams.flatMap((e) => e.questions) }, status: { $in: ["pending_review", "draft", "rejected"] } });
    if (unreviewed > 0) {
      res.status(400);
      throw new Error(`${unreviewed} question${unreviewed === 1 ? " is" : "s are"} not approved yet. Approve or remove ${unreviewed === 1 ? "it" : "them"} in Review, then draw the sets again.`);
    }
  }
  await Exam.updateMany({ _id: { $in: ids } }, { $set: publish ? { isPublished: true, isActive: true } : { isPublished: false, isActive: false } });
  group.isPublished = publish;
  await group.save();
  res.status(200).json(await shape(group));
});

//@desc   One merit list across all sets
//@route  GET /api/exam-sets/:id/results
// Each student's best graded attempt, as a percentage (sets can differ a
// little in total marks), ranked 1, 1, 3.
const getResults = asyncHandler(async (req, res) => {
  const group = await loadGroup(req, res);
  const labelOf = new Map(group.sets.map((s) => [String(s.exam), s.label]));
  const subs = await Submission.find({ exam: { $in: group.sets.map((s) => s.exam) }, status: "graded" })
    .select("exam student marks totalMarks attempt submittedAt")
    .populate("student", "name studentId")
    .lean();
  const best = new Map();
  for (const s of subs) {
    if (!s.student) continue;
    const pct = s.totalMarks > 0 ? (100 * (s.marks || 0)) / s.totalMarks : 0;
    const key = String(s.student._id);
    const prev = best.get(key);
    if (!prev || pct > prev.percent) {
      best.set(key, { student: s.student, set: labelOf.get(String(s.exam)), marks: s.marks || 0, totalMarks: s.totalMarks || 0, percent: Math.round(pct * 10) / 10, submission: s._id });
    }
  }
  const rows = [...best.values()].sort((a, b) => b.percent - a.percent);
  rows.forEach((r, i) => { r.rank = i > 0 && rows[i - 1].percent === r.percent ? rows[i - 1].rank : i + 1; });

  // Average per set, to spot a set that came out harder.
  const perSet = group.sets.map((s) => {
    const mine = rows.filter((r) => r.set === s.label);
    return { label: s.label, students: mine.length, average: mine.length ? Math.round((10 * mine.reduce((sum, r) => sum + r.percent, 0)) / mine.length) / 10 : null };
  });
  res.status(200).json({ rows, perSet });
});

//@desc   Delete a group and its sets
//@route  DELETE /api/exam-sets/:id
// Only while unpublished and before anyone sat a set.
const deleteGroup = asyncHandler(async (req, res) => {
  const group = await loadGroup(req, res);
  if (group.isPublished) {
    res.status(409);
    throw new Error("Unpublish the paper sets before deleting them.");
  }
  if ((await anySat(group)) > 0) {
    res.status(409);
    throw new Error("Students have sat these sets. Unpublished, they stay for the record.");
  }
  const ids = group.sets.map((s) => s.exam);
  await ExamSetAssignment.deleteMany({ group: group._id });
  await Submission.deleteMany({ exam: { $in: ids } });
  await Exam.deleteMany({ _id: { $in: ids } });
  await group.deleteOne();
  res.status(200).json({ message: "Paper sets deleted." });
});

module.exports = { listGroups, getGroup, createGroup, updateGroup, buildSets, setPublished, getResults, deleteGroup };
