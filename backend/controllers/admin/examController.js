const asyncHandler = require("express-async-handler");
const { statusCounts } = require("../../utils/statusCounts");
const mongoose = require("mongoose");
const Exam = require("../../models/examModel");
const Submission = require("../../models/submissionModel");
const { Question } = require("../../models/questionModel");
const { studentExamIds } = require("../../utils/excludeStudentExams");
const AiConfig = require("../../models/aiConfigModel");
const ai = require("../../ai/service");
const { examSmartPick: buildSmartPickPrompt, allocateTypes } = require("../../ai/prompts");
const { examSmartPick: smartPickSchema } = require("../../ai/schemas");
// Both endpoints below used to fetch questions with .lean() and hand them
// straight back — a lean query skips Mongoose entirely, so questionImage and
// options[].image stayed raw ObjectIds instead of the {url} shape the admin
// UI (and every other question list in this app) expects. forReview does the
// same populate-then-resolve-to-a-signed-url work every other admin-facing
// question view already relies on.
const { forReview } = require("../../utils/shapeQuestion");

// An exam is an ordered list of question ids pointing into the single Question
// collection, so a paper holding all three types loads in one query and its
// total is a real sum rather than questionCount * marksPerQuestion.

const UPDATABLE = [
  "title",
  "description",
  "subjects",
  "topics",
  "mode",
  "durationMinutes",
  "bufferSeconds",
  "scriptGraceMinutes",
  "awayMode",
  "awayMinutes",
  "calculator",
  "liveHours",
  "opensAt",
  "closesAt",
  "unpublishAt",
  "attemptsAllowed",
  "shuffleQuestions",
  "showResultImmediately",
];

const pick = (body, fields) =>
  fields.reduce((acc, key) => {
    if (body[key] !== undefined) acc[key] = body[key];
    return acc;
  }, {});

// Changing the questions or the marking of a paper people have already sat
// would silently rescore them against rules they never saw.
const assertNotSat = async (exam, res) => {
  const attempts = await Submission.countDocuments({
    exam: exam._id,
    status: { $in: ["in_progress", "submitted", "grading", "graded"] },
  });

  if (attempts > 0) {
    res.status(409);
    throw new Error(
      `${attempts} student${attempts === 1 ? " has" : "s have"} already started this exam. Duplicate it and edit the copy instead.`
    );
  }
};

const summarise = (exam, questions) => {
  const counts = questions.reduce((acc, q) => {
    acc[q.type] = (acc[q.type] || 0) + 1;
    return acc;
  }, {});

  return {
    questionCount: questions.length,
    totalMarks: questions.reduce((sum, q) => sum + (q.marks || 0), 0),
    byType: counts,
    // A paper with written questions cannot release a mark the moment it is
    // submitted, so the client needs to know before the student starts.
    needsGrading: Boolean(counts.written),
    missingRubric: questions.filter(
      (q) => q.type === "written" && (!q.rubric || q.rubric.length === 0)
    ).length,
  };
};

//@desc   List exams
//@route  GET /api/exams
//@access Private
const getExams = asyncHandler(async (req, res) => {
  const { batch, mode, search, status, subject } = req.query;
  const page = Number(req.query.page) || 1;
  const limit = Math.min(Number(req.query.limit) || 30, 100);

  // Belt-and-suspenders against any exam a student built for themselves the
  // old way, before that stopped creating Exam documents entirely — see
  // excludeStudentExams.js. Every new exam has createdByStudent: null, so
  // this excludes nothing once no such exam is left in the collection.
  // Offline exams (marks entered on a sheet) live on the batch's
  // offline marks page, not here.
  const query = { createdByStudent: null, offline: null };
  if (batch) query.batches = batch;
  if (mode) query.mode = mode;
  if (search) query.title = { $regex: String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
  // An exam is "in" a subject when it's tagged with it or holds any of its
  // questions (tagging exams with subjects is optional).
  if (subject && mongoose.isValidObjectId(subject)) {
    const ids = await Question.distinct("_id", { subject });
    query.$or = [{ subjects: subject }, { questions: { $in: ids } }];
  }
  const STATUS = {
    published: { isPublished: true },
    draft: { isPublished: false },
    open: { isActive: true },
    unassigned: { batches: { $size: 0 } },
  };
  const counts = req.query.counts === "true" ? await statusCounts(Exam, { ...query }, STATUS) : undefined;
  if (STATUS[status]) Object.assign(query, STATUS[status]);

  const [exams, total] = await Promise.all([
    Exam.find(query)
      .populate("subjects", "title")
      .populate("batches", "name")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Exam.countDocuments(query),
  ]);

  res.status(200).json({
    exams: exams.map((e) => ({ ...e, questionCount: e.questions.length })),
    total,
    page,
    pages: Math.ceil(total / limit),
    counts,
  });
});

//@desc   Get one exam with its questions in order
//@route  GET /api/exams/:id
//@access Private
const getExam = asyncHandler(async (req, res) => {
  const exam = await Exam.findById(req.params.id)
    .populate("subjects", "title")
    .populate("topics", "title")
    .populate("batches", "name");

  // Treated as not found rather than "this belongs to a student" — the
  // admin panel has never been able to open one of these, and a 404 here
  // is exactly as informative as it is for an id that never existed.
  if (!exam || exam.createdByStudent) {
    res.status(404);
    throw new Error("Exam not found.");
  }

  // find() does not preserve the order of an $in, and the order of a paper is
  // meaningful, so it is restored against the stored id list.
  const questions = await Question.find({ _id: { $in: exam.questions } });
  const byId = new Map(questions.map((q) => [String(q._id), q]));
  const orderedDocs = exam.questions.map((id) => byId.get(String(id))).filter(Boolean);
  const ordered = await Promise.all(orderedDocs.map((q) => forReview(q)));

  const [attempts, graded] = await Promise.all([
    Submission.countDocuments({ exam: exam._id, status: { $ne: "in_progress" } }),
    Submission.countDocuments({ exam: exam._id, status: "graded" }),
  ]);

  res.status(200).json({
    exam,
    questions: ordered,
    summary: summarise(exam, ordered),
    attempts,
    graded,
    // Once anyone has sat it, structural edits are refused.
    isLocked: attempts > 0,
  });
});

//@desc   Create an exam
//@route  POST /api/exams
//@access Private
const createExam = asyncHandler(async (req, res) => {
  const { title, durationMinutes } = req.body;

  if (!title || !durationMinutes) {
    res.status(400);
    throw new Error("A title and duration are required.");
  }

  const exam = await Exam.create({
    ...pick(req.body, UPDATABLE),
    questions: [],
    batches: [],
    source: "manual",
  });

  res.status(201).json(exam);
});

//@desc   Update exam settings
//@route  PUT /api/exams/:id
//@access Private
const updateExam = asyncHandler(async (req, res) => {
  const exam = await Exam.findById(req.params.id);

  if (!exam) {
    res.status(404);
    throw new Error("Exam not found.");
  }

  // Timing and marking change what a mark means, so they are locked once
  // anyone has sat the paper. Cosmetic fields stay editable.
  const structural = ["durationMinutes", "bufferSeconds", "scriptGraceMinutes", "awayMode", "awayMinutes", "attemptsAllowed", "mode"];
  const touchesStructure = structural.some((key) => req.body[key] !== undefined);

  if (touchesStructure) {
    await assertNotSat(exam, res);
  }

  Object.assign(exam, pick(req.body, UPDATABLE));
  await exam.save();

  res.status(200).json(exam);
});

//@desc   Set the question list and its order
//@route  PUT /api/exams/:id/questions
//@access Private
const setQuestions = asyncHandler(async (req, res) => {
  const exam = await Exam.findById(req.params.id);

  if (!exam) {
    res.status(404);
    throw new Error("Exam not found.");
  }

  await assertNotSat(exam, res);

  const { questionIds } = req.body;

  if (!Array.isArray(questionIds)) {
    res.status(400);
    throw new Error("Send the question ids in their intended order.");
  }

  const unique = [...new Set(questionIds.map(String))];

  if (unique.length !== questionIds.length) {
    res.status(400);
    throw new Error("The same question cannot appear twice in one exam.");
  }

  // Every id is verified to exist before anything is stored, so a bad id
  // cannot leave the paper with a hole that only shows up mid-exam.
  const found = await Question.find({ _id: { $in: unique } });

  if (found.length !== unique.length) {
    const foundIds = new Set(found.map((q) => String(q._id)));
    const missing = unique.filter((id) => !foundIds.has(id));
    res.status(400);
    throw new Error(`These questions do not exist: ${missing.join(", ")}`);
  }

  exam.questions = unique;
  await exam.save();

  const byId = new Map(found.map((q) => [String(q._id), q]));
  const ordered = await Promise.all(unique.map((id) => forReview(byId.get(id))));

  res.status(200).json({
    questions: ordered,
    summary: summarise(exam, ordered),
  });
});

//@desc   Add questions to the end of an exam
//@route  POST /api/exams/:id/questions
//@access Private
const addQuestions = asyncHandler(async (req, res) => {
  const exam = await Exam.findById(req.params.id);

  if (!exam) {
    res.status(404);
    throw new Error("Exam not found.");
  }

  await assertNotSat(exam, res);

  const { questionIds } = req.body;

  if (!Array.isArray(questionIds) || questionIds.length === 0) {
    res.status(400);
    throw new Error("Send a list of question ids.");
  }

  const existing = new Set(exam.questions.map(String));
  const incoming = [...new Set(questionIds.map(String))].filter((id) => !existing.has(id));

  if (incoming.length === 0) {
    res.status(200);
    return res.json({ message: "Those questions are already in this exam.", added: 0 });
  }

  const found = await Question.countDocuments({ _id: { $in: incoming } });
  if (found !== incoming.length) {
    res.status(400);
    throw new Error("One or more of those questions does not exist.");
  }

  exam.questions.push(...incoming);
  await exam.save();

  res.status(200).json({
    message: `Added ${incoming.length} question${incoming.length === 1 ? "" : "s"}.`,
    added: incoming.length,
    questionCount: exam.questions.length,
  });
});

const ALLOWED_TYPES = ["mcq", "mtf", "written", "passage"];

// Bucket by type is oversampled by this factor before the model sees it (so
// there's something real to choose between), capped so the prompt itself
// stays a bounded size regardless of how big the matching pool is.
const OVERSAMPLE_FACTOR = 4;
const MAX_CANDIDATES_PER_TYPE = 24;

//@desc   Fill a target count of questions from the bank, scoped by whatever
//        filters the admin set on the picker, split across types and chosen
//        by AI from an oversampled candidate pool — never invented, never
//        auto-published. Lands in the exam exactly like a manual pick does,
//        for the same review-before-you-publish flow.
//@route  POST /api/exams/:id/smart-pick
//@access Private
const smartPickQuestions = asyncHandler(async (req, res) => {
  const exam = await Exam.findById(req.params.id);

  if (!exam) {
    res.status(404);
    throw new Error("Exam not found.");
  }

  await assertNotSat(exam, res);

  const config = await AiConfig.get();
  if (!config.features.smartExamBuilder) {
    res.status(403);
    throw new Error("AI question picking is switched off in AI settings.");
  }

  const count = Math.min(Math.max(Number(req.body.count) || 0, 1), 50);
  const types = Array.isArray(req.body.types) && req.body.types.length > 0
    ? req.body.types.filter((t) => ALLOWED_TYPES.includes(t))
    : ALLOWED_TYPES;

  if (types.length === 0) {
    res.status(400);
    throw new Error("Choose at least one question type.");
  }

  const { subject, chapter, topic, difficulty, tag } = req.body;
  const baseQuery = { status: "published", _id: { $nin: exam.questions }, ...Question.IN_BANK };
  if (subject) baseQuery.subject = subject;
  if (chapter) baseQuery.chapter = chapter;
  // "none" is the chapter-pool sentinel used across the bank/practice
  // filters (questionController.js's getQuestions, practiceController.js's
  // getTopics) — without this branch it fell through to the `else if
  // (topic)` below and got cast straight to an ObjectId, which either
  // errored or (worse) silently matched nothing.
  if (topic === "none") baseQuery.topic = null;
  else if (topic) baseQuery.topic = topic;
  if (difficulty) baseQuery.difficulty = difficulty;
  if (tag) baseQuery.tags = String(tag).trim().toLowerCase();

  // Same split-count-across-types math generateQuestions uses to build a
  // mixed batch — reused as-is here to split a mixed PICK instead.
  const targets = allocateTypes(count, types);

  // Every bucket's pool is shuffled in JS the same way buildPracticeExam
  // picks a random slice of a matching pool (practiceExamController.js) —
  // this codebase has no $sample anywhere. A bucket whose pool doesn't even
  // exceed its target is taken whole, no picking (AI or otherwise) needed;
  // only a bucket with more candidates than it needs goes to the model, and
  // only the oversampled slice, not the full pool.
  const buckets = [];
  for (const [type, target] of Object.entries(targets)) {
    // Full documents, not a trimmed projection — these are the exact docs
    // that may end up saved onto the exam and run through forReview below,
    // which needs every field a question can have (options, rubric,
    // solution…), not just the handful the prompt itself reads from.
    const pool = await Question.find({ ...baseQuery, type }).populate("topic", "title");
    const shuffled = [...pool].sort(() => Math.random() - 0.5);

    if (shuffled.length <= target) {
      buckets.push({ type, target, chosen: shuffled, candidates: [] });
    } else {
      const candidates = shuffled.slice(0, Math.min(shuffled.length, target * OVERSAMPLE_FACTOR, MAX_CANDIDATES_PER_TYPE));
      buckets.push({ type, target, chosen: [], candidates, leftover: shuffled.slice(candidates.length) });
    }
  }

  // Flattened across every bucket that actually needs a choice made, so one
  // call covers the whole pick instead of one per type — each candidate's
  // position in THIS flat array is the only thing the model ever refers to.
  const flatCandidates = [];
  const aiTargets = {};
  for (const bucket of buckets) {
    if (bucket.candidates.length === 0) continue;
    aiTargets[bucket.type] = bucket.target;
    for (const q of bucket.candidates) {
      flatCandidates.push({
        globalIndex: flatCandidates.length,
        question: q,
        type: bucket.type,
      });
    }
  }

  let picksByType = {};
  let tokens = 0;
  if (flatCandidates.length > 0) {
    const built = buildSmartPickPrompt({
      candidates: flatCandidates.map((c) => ({
        index: c.globalIndex,
        type: c.type,
        question: c.question.question,
        difficulty: c.question.difficulty,
        marks: c.question.marks,
        topicTitle: c.question.topic?.title,
      })),
      targets: aiTargets,
    });

    const { data, usage } = await ai.generate({
      feature: "exam_question_selection",
      schema: smartPickSchema,
      user: req.user._id,
      maxTokens: Math.min(300 + flatCandidates.length * 20, 4000),
      ...built,
    });
    tokens = usage.promptTokens + usage.completionTokens;

    // Same treatment as studyPlanController.js's topicIndex: an index the
    // model returns that doesn't point into the list it was actually given
    // is dropped rather than trusted, never bounds-widened or coerced.
    const seen = new Set();
    for (const idx of data.picks) {
      const candidate = flatCandidates[idx];
      if (!candidate || seen.has(idx)) continue;
      seen.add(idx);
      (picksByType[candidate.type] ||= []).push(candidate.question);
    }
  }

  // A bucket the model under-filled (fewer sound picks than asked, or no AI
  // call happened to reach it at all) is padded from its own leftover
  // pool — the unused tail of the same shuffle, not a fresh query — so the
  // exam still ends up as close to `count` as the bank actually allows,
  // same "write fewer rather than inventing" ethos as generateQuestions,
  // just applied to picking instead of writing.
  const finalQuestions = [];
  for (const bucket of buckets) {
    // A bucket built with candidates: [] never went to the model at all
    // (its whole pool was taken directly, see the loop above) — checked
    // this way, not by chosen.length, so a bucket whose pool was
    // legitimately empty is still read as "no AI needed" rather than
    // mistaken for one the model under-filled.
    const picked = bucket.candidates.length === 0 ? bucket.chosen : (picksByType[bucket.type] || []);
    const short = bucket.target - picked.length;
    const padded = short > 0 && bucket.leftover ? bucket.leftover.slice(0, short) : [];
    finalQuestions.push(...picked, ...padded);
  }

  const newIds = finalQuestions.map((q) => String(q._id));
  exam.questions.push(...newIds);
  await exam.save();

  const byId = new Map(finalQuestions.map((q) => [String(q._id), q]));
  const ordered = await Promise.all(newIds.map((id) => forReview(byId.get(id))));

  res.status(200).json({
    message: newIds.length > 0
      ? `Added ${newIds.length} question${newIds.length === 1 ? "" : "s"}.`
      : "No matching questions were found for that scope.",
    added: newIds.length,
    questions: ordered,
    questionCount: exam.questions.length,
    tokens,
  });
});

//@desc   Remove a question from an exam
//@route  DELETE /api/exams/:id/questions/:questionId
//@access Private
const removeQuestion = asyncHandler(async (req, res) => {
  const exam = await Exam.findById(req.params.id);

  if (!exam) {
    res.status(404);
    throw new Error("Exam not found.");
  }

  await assertNotSat(exam, res);

  exam.questions = exam.questions.filter(
    (id) => String(id) !== String(req.params.questionId)
  );
  await exam.save();

  res.status(200).json({ questionCount: exam.questions.length });
});

//@desc   Publish or unpublish
//@route  PUT /api/exams/:id/publish
//@access Private
const setPublished = asyncHandler(async (req, res) => {
  const exam = await Exam.findById(req.params.id);

  if (!exam) {
    res.status(404);
    throw new Error("Exam not found.");
  }

  const publish = Boolean(req.body.isPublished);

  if (publish) {
    if (exam.questions.length === 0) {
      res.status(400);
      throw new Error("Add at least one question before publishing.");
    }
    if (exam.batches.length === 0) {
      res.status(400);
      throw new Error("Assign this exam to at least one batch before publishing.");
    }

    // startExam serves exam.questions with no status filter, so an
    // unreviewed AI question (e.g. from a predicted paper) would reach
    // students as-is. Approve or remove them first.
    const unreviewed = await Question.countDocuments({
      _id: { $in: exam.questions },
      status: { $in: ["pending_review", "draft", "rejected"] },
    });
    if (unreviewed > 0) {
      res.status(400);
      throw new Error(`${unreviewed} question${unreviewed === 1 ? " is" : "s are"} not approved yet. Approve or remove ${unreviewed === 1 ? "it" : "them"} in Review before publishing.`);
    }

    // A written question with no rubric cannot be graded by anything but a
    // human, and the teacher should find that out now rather than when forty
    // submissions are waiting.
    const written = await Question.find({
      _id: { $in: exam.questions },
      type: "written",
    }).lean();

    const noRubric = written.filter((q) => !q.rubric || q.rubric.length === 0);

    if (noRubric.length > 0 && req.body.force !== true) {
      res.status(409);
      return res.json({
        message: `${noRubric.length} written question${noRubric.length === 1 ? " has" : "s have"} no rubric and will need grading by hand. Send force to publish anyway.`,
        questionsMissingRubric: noRubric.map((q) => ({ _id: q._id, question: q.question })),
      });
    }
  }

  exam.isPublished = publish;
  if (!publish) exam.isActive = false;

  await exam.save();
  res.status(200).json(exam);
});

//@desc   Open or close an exam
//@route  PUT /api/exams/:id/active
//@access Private
const setActive = asyncHandler(async (req, res) => {
  const exam = await Exam.findById(req.params.id);

  if (!exam) {
    res.status(404);
    throw new Error("Exam not found.");
  }

  if (req.body.isActive && !exam.isPublished) {
    res.status(400);
    throw new Error("Publish this exam before opening it.");
  }

  exam.isActive = Boolean(req.body.isActive);
  await exam.save();

  res.status(200).json(exam);
});

//@desc   Duplicate an exam
//@route  POST /api/exams/:id/duplicate
//@access Private
const duplicateExam = asyncHandler(async (req, res) => {
  const source = await Exam.findById(req.params.id).lean();

  if (!source) {
    res.status(404);
    throw new Error("Exam not found.");
  }

  // The way to edit a paper people have already sat: copy it, change the copy.
  // The duplicate starts unpublished and unassigned so it cannot go live by
  // accident.
  delete source._id;
  delete source.createdAt;
  delete source.updatedAt;

  const copy = await Exam.create({
    ...source,
    title: req.body.title || `${source.title} (copy)`,
    batches: [],
    isPublished: false,
    isActive: false,
  });

  res.status(201).json(copy);
});

//@desc   Delete an exam
//@route  DELETE /api/exams/:id
//@access Private
// Deleting used to be blocked outright by any submission at all — the only
// way to remove a mistaken or obsolete exam with even one attempt against
// it was to leave it in the database forever. The rule now is the reverse
// of "how many submissions": it's "is this exam still live". An exam has to
// be taken out of circulation (unpublished) before it can be removed at
// all, and once it has been, the submission count no longer matters —
// every submission goes with it.
//
// isPublished is the gate rather than isActive because isActive only
// governs a mock's open/closed window (see examModel's isOpen()) and can
// legitimately be false on a live, published exam between windows. isActive
// is not evidence the exam has been taken out of circulation the way
// isPublished is.
const deleteExam = asyncHandler(async (req, res) => {
  const exam = await Exam.findById(req.params.id);

  if (!exam) {
    res.status(404);
    throw new Error("Exam not found.");
  }

  if (exam.isPublished) {
    res.status(409);
    throw new Error("Unpublish this exam before deleting it.");
  }

  const { deletedCount } = await Submission.deleteMany({ exam: exam._id });
  await exam.deleteOne();

  res.status(200).json({
    message: deletedCount > 0
      ? `Exam deleted, along with ${deletedCount} submission${deletedCount === 1 ? "" : "s"}.`
      : "Exam deleted.",
  });
});

module.exports = {
  getExams,
  getExam,
  createExam,
  updateExam,
  setQuestions,
  addQuestions,
  smartPickQuestions,
  removeQuestion,
  setPublished,
  setActive,
  duplicateExam,
  deleteExam,
};
