const asyncHandler = require("express-async-handler");
const { Question } = require("../../models/questionModel");
const PracticeAttempt = require("../../models/practiceAttemptModel");
const CodingDraft = require("../../models/codingDraftModel");
const { batchQuestionScope } = require("../../utils/batchSubjects");
const { forTaking, shapeField } = require("../../utils/shapeQuestion");
const { runTests, marksFor } = require("../../utils/codeRunner");

// Coding practice (batch feature codingPractice): every coding question
// assigned to the batch, solved one at a time with Run and Submit.

const findProblem = (req, id, lean = true) => {
  const q = Question.findOne({ _id: id, ...batchQuestionScope(req.batch), status: "published", type: "coding" });
  return lean ? q.lean() : q;
};

const runnerError = (res, error) => {
  if (error.statusCode) res.status(error.statusCode);
  throw error;
};

//@desc   Every coding problem in the batch, with this student's status
//@route  GET /api/app/batches/:batchId/coding
const listProblems = asyncHandler(async (req, res) => {
  const problems = await Question.find({ ...batchQuestionScope(req.batch), status: "published", type: "coding" })
    .select("question marks difficulty languages subject chapter topic createdAt")
    .populate("subject", "title").populate("chapter", "title")
    .sort({ createdAt: 1 }).lean();
  const ids = problems.map((p) => p._id);
  const attempts = await PracticeAttempt.aggregate([
    { $match: { student: req.student._id, question: { $in: ids } } },
    { $group: { _id: "$question", tries: { $sum: 1 }, solved: { $max: { $cond: ["$isCorrect", 1, 0] } } } },
  ]);
  const byId = new Map(attempts.map((a) => [String(a._id), a]));
  res.status(200).json({
    problems: problems.map((p) => {
      const a = byId.get(String(p._id));
      return {
        _id: p._id, title: String(p.question || "").split("\n")[0].slice(0, 140), marks: p.marks, difficulty: p.difficulty,
        languages: p.languages, subject: p.subject?.title || "", chapter: p.chapter?.title || "",
        status: a?.solved ? "solved" : a ? "tried" : "new", tries: a?.tries || 0,
      };
    }),
  });
});

//@desc   One problem, the student's saved code and past submissions
//@route  GET /api/app/batches/:batchId/coding/:questionId
const getProblem = asyncHandler(async (req, res) => {
  // A full document: forTaking populates its images.
  const q = await findProblem(req, req.params.questionId, false);
  if (!q) {
    res.status(404);
    throw new Error("Problem not found in this batch.");
  }
  const [draft, history] = await Promise.all([
    CodingDraft.findOne({ student: req.student._id, question: q._id }).lean(),
    PracticeAttempt.find({ student: req.student._id, question: q._id }).sort({ createdAt: -1 }).limit(20)
      .select("selectedOption isCorrect codePassed codeTotal createdAt").lean(),
  ]);
  res.status(200).json({
    question: await forTaking(q),
    draft: draft ? { language: draft.language, code: draft.code } : null,
    history: history.map((h) => ({ at: h.createdAt, language: h.selectedOption, passed: h.codePassed, total: h.codeTotal, solved: h.isCorrect })),
  });
});

//@desc   Save the student's code (autosave)
//@route  PUT /api/app/batches/:batchId/coding/:questionId/draft
const saveDraft = asyncHandler(async (req, res) => {
  const q = await findProblem(req, req.params.questionId);
  if (!q) {
    res.status(404);
    throw new Error("Problem not found in this batch.");
  }
  const { code, language } = req.body || {};
  if (!q.languages.includes(language)) {
    res.status(400);
    throw new Error("That language isn't allowed for this problem.");
  }
  await CodingDraft.updateOne(
    { student: req.student._id, question: q._id },
    { $set: { code: String(code || "").slice(0, 50000), language } },
    { upsert: true }
  );
  res.status(200).json({ saved: true });
});

//@desc   Run against the shown tests
//@route  POST /api/app/batches/:batchId/coding/run
const runProblem = asyncHandler(async (req, res) => {
  const { questionId, code, language } = req.body || {};
  const q = await findProblem(req, questionId);
  if (!q) {
    res.status(404);
    throw new Error("Problem not found in this batch.");
  }
  if (!q.languages.includes(language)) {
    res.status(400);
    throw new Error("That language isn't allowed for this problem.");
  }
  const shown = q.tests.filter((t) => !t.hidden);
  try {
    const results = await runTests({ code: String(code || ""), language, tests: shown, timeLimitMs: q.timeLimitMs });
    res.status(200).json({ results: results.map((r, i) => ({ ...r, input: shown[i].input, expected: shown[i].output })) });
  } catch (error) {
    runnerError(res, error);
  }
});

//@desc   Submit: every test, hidden ones too. Saved as a practice attempt.
//@route  POST /api/app/batches/:batchId/coding/:questionId/submit
const submitProblem = asyncHandler(async (req, res) => {
  const q = await findProblem(req, req.params.questionId, false);
  if (!q) {
    res.status(404);
    throw new Error("Problem not found in this batch.");
  }
  const { code, language, timeSpentMs } = req.body || {};
  if (!q.languages.includes(language)) {
    res.status(400);
    throw new Error("That language isn't allowed for this problem.");
  }
  let results;
  try {
    results = await runTests({ code: String(code || ""), language, tests: q.tests, timeLimitMs: q.timeLimitMs });
  } catch (error) {
    runnerError(res, error);
  }
  const passed = results.filter((r) => r.passed).length;
  const previous = await PracticeAttempt.findOne({ student: req.student._id, question: q._id }).sort({ createdAt: -1 }).select("seenCount");
  await PracticeAttempt.create({
    student: req.student._id, batch: req.batch._id, question: q._id,
    topic: q.topic || undefined, chapter: q.topic ? undefined : q.chapter,
    selectedOption: language, answerText: String(code || "").slice(0, 50000),
    codePassed: passed, codeTotal: results.length,
    isCorrect: passed === results.length, timeSpentMs: Number(timeSpentMs) || 0, seenCount: (previous?.seenCount || 0) + 1,
  });
  await q.populate(["solutionImage", "solutionVideo", "solutionPdf", "solutionAttachments"]);
  res.status(200).json({
    isCorrect: passed === results.length, passed, total: results.length, marks: marksFor(q, results), outOf: q.marks,
    results: results.map((r, i) => (q.tests[i].hidden
      ? { hidden: true, passed: r.passed, status: r.status }
      : { ...r, input: q.tests[i].input, expected: q.tests[i].output })),
    solutionText: q.solutionText,
    solutionImage: await shapeField(q.solutionImage),
    solutionVideo: await shapeField(q.solutionVideo),
    solutionPdf: await shapeField(q.solutionPdf),
    solutionAttachments: await Promise.all((q.solutionAttachments || []).map(shapeField)),
  });
});

module.exports = { listProblems, getProblem, saveDraft, runProblem, submitProblem };
