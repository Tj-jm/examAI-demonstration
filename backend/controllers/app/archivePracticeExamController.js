const asyncHandler = require("express-async-handler");
const { parseKey, answerKey, questionFor } = require("../../utils/passageParts");
// A passage's marks from its multiple choice questions only.
const mcqMarks = (q) => (q.subQuestions || []).filter((sq) => sq.type !== "written").reduce((n, sq) => n + (sq.marks || 0), 0);
const { questionText, fullQuestionText } = require("../../utils/questionText");
const { subjectIds, subjectScope } = require("../../utils/batchSubjects");
const mongoose = require("mongoose");
const { Question } = require("../../models/questionModel");
const { loadQuestionsInOrder } = require("../../utils/loadQuestionsInOrder");
const Submission = require("../../models/submissionModel");
const PracticeAttempt = require("../../models/practiceAttemptModel").Archive;
const PracticeExamRecord = require("../../models/practiceExamRecordModel");
const { forTaking, forReview, partForReview } = require("../../utils/shapeQuestion");
const aiService = require("../../ai/service");
const AiConfig = require("../../models/aiConfigModel");
const { capWrittenByBudget, writtenCostSummary, needsGrading } = require("../../utils/writtenBudget");
const { collectAnswerImages, gradingImageUrl } = require("../../utils/practiceAnswerImages");
const { gradeWrittenAnswers } = require("../../utils/gradeWrittenAnswers");
const { AiCapReachedError } = aiService;
const { gradeWrittenPractice, practiceExamInsight: buildInsightPrompt } = require("../../ai/prompts");
const { handwritingMode, practiceHandwriting, withNote } = require("../../utils/handwriting");
const { gradedAnswer: gradedAnswerSchema, examPerformanceReport: insightSchema } = require("../../ai/schemas");
const { computePercent } = require("../../utils/practiceScoring");
const { rankWeakTopics } = require("../../utils/weakTopics");
const { sanitizeReasoning } = require("../../ai/leakGuard");
const { reconcileRubricMarks } = require("../../utils/rubricMarks");

// The archive's own version of practiceExamController.js — same
// build/submit/insight flow (nothing persisted until submit, no Exam/
// Submission written even then, only a running average survives), scoped
// by isPublic + this batch's own archiveAuthorities instead of
// Question.batches. Written-question grading and inclusion are not gated
// behind req.batch.features?.aiAssist here — archive's explain/similar
// endpoints (archiveController.js) already don't check that flag either,
// so this stays consistent with the rest of the module rather than
// introducing a new, asymmetric gate just for this one endpoint.
//
// Everything is recorded with batch: null — one shared running average and
// weak-topic signal archive-wide, same convention as every other archive
// write in this app.

const MIN_QUESTIONS = 3;
const MAX_QUESTIONS = 50;
// Includes passage, unlike practiceExamController.js's own VALID_TYPES —
// Submission.scoreObjective already grades a passage's subAnswers
// correctly (each sub-question scored like a standalone mcq, summed into
// one marksAwarded), it was simply never wired into either exam builder's
// type list before. Archive gets it here since the user asked for it
// directly; nothing stops the batch version from getting the same fix
// later.
const VALID_TYPES = ["mcq", "mtf", "written", "passage"];

const gradeWritten = async (question, answerText, { student, batch, enabled, imageUrl }) => {
  // No rubric: a gap in the question bank, not the student's — left out of
  // the percentage entirely rather than scored.
  if (!question.rubric?.length) {
    return { marksAwarded: null, note: "No rubric set up for this question." };
  }
  // A written question left blank (no text and no image) scores 0 — counted
  // in the total like any other unanswered question — with no AI call and
  // no AI credit spent.
  if ((!answerText || !answerText.trim()) && !imageUrl) {
    return { marksAwarded: 0, note: "No answer — 0 marks. No AI credit used." };
  }
  // The build step never hands out written questions with archiveAiAssist
  // off; this closes the direct-API path to AI grading too.
  if (!enabled) {
    return { marksAwarded: null, note: "AI assistance is off for this batch's archive, so written answers can't be graded here." };
  }

  try {
    const prompt = gradeWrittenPractice({
      question: questionText(question),
      rubric: question.rubric,
      modelAnswer: question.modelAnswer,
      studentAnswer: answerText?.trim() || "(No typed answer — see the attached image.)",
      totalMarks: question.marks,
      images: imageUrl ? 1 : 0,
    });

    const { data } = await aiService.generate({
      feature: "archive-exam-grade-written",
      schema: gradedAnswerSchema,
      imageUrl,
      student,
      batch,
      ...prompt,
    });

    // Built from the rubric rows the model marked, not its bare total.
    // Then the handwriting check on its photo (utils/handwriting.js).
    const check = practiceHandwriting(
      data,
      reconcileRubricMarks({ rubric: question.rubric, totalMarks: question.marks, data }).marks,
      imageUrl ? await handwritingMode("practice") : "off",
    );
    return { marksAwarded: check.marks, aiReasoning: withNote(sanitizeReasoning(data.reasoning, question.modelAnswer), check.note), charged: true };
  } catch (error) {
    return {
      marksAwarded: null,
      note: error instanceof AiCapReachedError ? error.message : "Could not be auto-graded — try again later.",
    };
  }
};

//@desc   This student's running average across every archive practice exam
//        they have built — shared across every batch's archive door
//@route  GET /api/app/batches/:batchId/archive/exam-record
//@access Private (student + batchAccess + this batch has archiveAuthorities)
const getRecord = asyncHandler(async (req, res) => {
  const record = await PracticeExamRecord.Archive.findOne({ student: req.student._id, batch: req.batch._id });

  res.status(200).json({
    attemptCount: record?.attemptCount || 0,
    averagePercent: record ? Math.round(record.averagePercent) : null,
  });
});

//@desc   Build a timed practice paper from the student's own choice of
//        archive topics, types, duration and question count. Nothing is
//        written to the database until submit.
//@route  POST /api/app/batches/:batchId/archive/exam
//@access Private (student + batchAccess + this batch has archiveAuthorities)
const buildArchiveExam = asyncHandler(async (req, res) => {
  const { topicIds, chapterIds, types, durationMinutes, questionCount } = req.body;

  const validTopicIds = Array.isArray(topicIds) ? topicIds : [];
  const validChapterIds = Array.isArray(chapterIds) ? chapterIds : [];

  if (validTopicIds.length === 0 && validChapterIds.length === 0) {
    res.status(400);
    throw new Error("Choose at least one topic.");
  }

  const requestedTypes = Array.isArray(types) ? types.filter((t) => VALID_TYPES.includes(t)) : [];
  // Written is the only AI-graded type here (passage is scored objectively
  // by Submission.scoreObjective, same as mcq/mtf) — excluded at build
  // time rather than accepted and silently ungraded at submit time, same
  // pattern practiceExamController.js's own aiAssist check uses for batch
  // practice exams.
  const validTypes = req.batch.features?.archiveAiAssist ? requestedTypes : requestedTypes.filter((t) => t !== "written");
  if (validTypes.length === 0) {
    res.status(400);
    throw new Error(
      requestedTypes.length > 0 && requestedTypes.every((t) => t === "written")
        ? "AI assistance is off for this batch's archive, so written questions aren't available here."
        : "Choose at least one question type."
    );
  }

  const duration = Number(durationMinutes);
  if (!duration || duration < 5 || duration > 240) {
    res.status(400);
    throw new Error("Pick a duration between 5 and 240 minutes.");
  }

  const requestedCount = Math.min(Math.max(Number(questionCount) || 10, MIN_QUESTIONS), MAX_QUESTIONS);

  const allowed = (req.batch.archiveAuthorities || []).map((id) => new mongoose.Types.ObjectId(id));

  const scopeClauses = [];
  if (validTopicIds.length > 0) scopeClauses.push({ topic: { $in: validTopicIds } });
  if (validChapterIds.length > 0) scopeClauses.push({ topic: null, chapter: { $in: validChapterIds } });

  const available = await Question.find({
    isPublic: true,
    status: "published",
    "sources.authority": { $in: allowed },
    ...subjectScope(req.batch),
    type: { $in: validTypes },
    $or: scopeClauses,
  })
    // Id and type are all the picking below needs; the chosen questions are
    // loaded in full afterwards.
    .select("_id type subQuestions.type")
    .lean();

  if (available.length < MIN_QUESTIONS) {
    res.status(400);
    throw new Error(
      `Only ${available.length} question${available.length === 1 ? "" : "s"} match that combination — need at least ${MIN_QUESTIONS}. Try more topics or types.`
    );
  }

  // Same budget rule as batch practice exams (utils/writtenBudget.js),
  // against the archive's own shared pool (batch: null).
  const config = await AiConfig.get();
  const budget = await capWrittenByBudget({
    written: available.filter(needsGrading),
    student: req.student._id,
    batch: req.batch._id,
    config,
    feature: "archive-exam-grade-written",
  });
  const pool = [...budget.written, ...available.filter((q) => !needsGrading(q))];

  if (pool.length < MIN_QUESTIONS) {
    res.status(400);
    throw new Error(
      `Only ${pool.length} question${pool.length === 1 ? "" : "s"} are available right now — the rest are written questions beyond what you can currently get graded. Try fewer written questions, or buy more AI credits.`
    );
  }

  const selected = await loadQuestionsInOrder(
    [...pool].sort(() => Math.random() - 0.5).slice(0, Math.min(requestedCount, pool.length)).map((q) => q._id)
  );

  res.status(201).json({
    durationMinutes: duration,
    questions: await Promise.all(selected.map(forTaking)),
    // AI credit cost of grading this paper's written questions, or null.
    aiCost: writtenCostSummary({ selected, ...budget }),
  });
});

//@desc   Grade a completed archive practice paper in one shot — the answer
//        key and the student's own answers, for a one-time review.
//@route  POST /api/app/batches/:batchId/archive/exam/submit
//@access Private (student + batchAccess + this batch has archiveAuthorities)
const submitArchiveExam = asyncHandler(async (req, res) => {
  const { answers } = req.body;

  if (!Array.isArray(answers) || answers.length === 0) {
    res.status(400);
    throw new Error("No answers were submitted.");
  }

  // "<passage>:<index>" answers a passage's written question (utils/passageParts.js).
  const questionIds = answers.map((a) => parseKey(a.questionId).question).filter(Boolean);
  const allowed = (req.batch.archiveAuthorities || []).map((id) => new mongoose.Types.ObjectId(id));

  const questions = await Question.find({
    _id: { $in: questionIds },
    isPublic: true,
    status: "published",
    "sources.authority": { $in: allowed },
    ...subjectScope(req.batch),
  }).populate("topic", "_id");

  const questionMap = new Map(questions.map((q) => [String(q._id), q]));

  const scratch = new Submission({
    student: req.student._id,
    batch: req.batch._id,
    answers: answers
      .filter((a) => questionMap.has(parseKey(a.questionId).question))
      .map((a) => ({
        question: parseKey(a.questionId).question,
        subIndex: parseKey(a.questionId).subIndex ?? undefined,
        questionType: parseKey(a.questionId).subIndex !== null ? "written" : questionMap.get(parseKey(a.questionId).question).type,
        selectedOption: a.selectedOption ?? null,
        statementAnswers: a.statementAnswers,
        subAnswers: a.subAnswers,
        answerText: a.answerText ?? null,
      })),
  });

  await require("../../utils/codeRunner").judgeAnswers(scratch.answers, questionMap);
  scratch.scoreObjective(questionMap);

  const answerImages = await collectAnswerImages(req, answers);

  // Written answers are graded up front (utils/gradeWrittenAnswers.js), so
  // the AI calls can overlap; the loop below only reads the results.
  const writtenJobs = scratch.answers
    .map((answer) => ({ answer, question: questionFor(answer, questionMap.get(String(answer.question))) }))
    .filter(({ question }) => question?.type === "written");
  const gradedWritten = await gradeWrittenAnswers({
    jobs: writtenJobs,
    student: req.student._id,
    batch: req.batch._id,
    grade: (answer, question) =>
      gradeWritten(question, answer.answerText, {
        imageUrl: gradingImageUrl(req, answerImages.get(question.subIndex != null ? `${question._id}:${question.subIndex}` : String(question._id))),
        student: req.student._id,
        batch: req.batch._id,
        enabled: Boolean(req.batch.features?.archiveAiAssist),
      }),
  });

  let marksAwarded = 0;
  let totalMarks = 0;
  // Written answers actually graded by AI — the only ones that cost credits.
  let aiGraded = 0;
  const results = [];
  const attemptLogs = [];

  for (const answer of scratch.answers) {
    const doc = questionMap.get(String(answer.question));
    if (!doc) continue;
    const question = questionFor(answer, doc);
    const key = answerKey(answer);

    let note = null;

    if (question.type === "written") {
      const graded = gradedWritten.get(key);
      answer.marksAwarded = graded.marksAwarded;
      answer.aiReasoning = graded.aiReasoning || null;
      note = graded.note || null;
      if (graded.charged) aiGraded += 1;
    }

    // A passage with only written questions has nothing of its own to mark.
    const gradable = answer.marksAwarded !== null && answer.marksAwarded !== undefined
      && !(question.type === "passage" && mcqMarks(question) === 0);

    if (gradable) {
      marksAwarded += answer.marksAwarded;
      // A passage's own marks here are its mcqs'; its written ones count apart.
      totalMarks += question.type === "passage" ? mcqMarks(question) : question.marks;
    }

    const isCorrect = gradable ? answer.marksAwarded >= (question.type === "passage" ? mcqMarks(question) : question.marks) * 0.6 : null;

    results.push({
      ...(answer.subIndex != null ? await partForReview(doc, answer.subIndex) : await forReview(doc)),
      yourAnswer: {
        selectedOption: answer.selectedOption,
        statementAnswers: answer.statementAnswers,
        subAnswers: answer.subAnswers,
        answerText: answer.answerText,
        answerImages: answerImages.get(key) || [],
      },
      marksAwarded: answer.marksAwarded,
      isCorrect,
      aiReasoning: answer.aiReasoning || null,
      gradable,
      note,
    });

    if (question.topic && gradable) {
      attemptLogs.push({
        student: req.student._id,
        batch: req.batch._id,
        question: question._id,
        topic: question.topic._id,
        selectedOption: answer.selectedOption || undefined,
        statementAnswers: answer.statementAnswers,
        answerText: answer.answerText || undefined,
        marksAwarded: answer.marksAwarded,
        isCorrect,
      });
    }
  }

  const percent = computePercent(marksAwarded, totalMarks);

  if (percent !== null) {
    await PracticeExamRecord.Archive.recordAttempt(req.student._id, req.batch._id, percent);
  }
  if (attemptLogs.length > 0) {
    await PracticeAttempt.insertMany(attemptLogs);
  }

  // What this submission's AI grading cost, so the student sees it on the
  // result. Taken from today's free allowance first, then credits.
  const aiCreditsUsed = aiGraded > 0 ? aiGraded * (await AiConfig.get()).getFeatureCost("archive-exam-grade-written") : 0;

  res.status(200).json({ percent, marksAwarded, totalMarks, questions: results, aiGraded, aiCreditsUsed });
});

//@desc   A one-off coaching note on an archive practice exam just finished
//@route  POST /api/app/batches/:batchId/archive/exam/insight
//@access Private (student + batchAccess + this batch has archiveAuthorities)
const getArchiveExamInsight = asyncHandler(async (req, res) => {
  const { questions, marksAwarded, totalMarks } = req.body;
  if (!Array.isArray(questions) || questions.length === 0) {
    res.status(400);
    throw new Error("No graded result to build an insight from.");
  }

  const questionIds = questions.map((q) => q._id).filter(Boolean);
  const docs = await Question.find({ _id: { $in: questionIds } })
    .select("topic chapter")
    .populate("topic", "title")
    .populate("chapter", "title");
  const docMap = new Map(docs.map((d) => [String(d._id), d]));

  const byGroup = new Map();
  for (const q of questions) {
    if (q.gradable === false || q.isCorrect === null || q.isCorrect === undefined) continue;
    const doc = docMap.get(String(q._id));
    const group = doc?.topic || doc?.chapter;
    if (!group) continue;

    const groupId = String(group._id);
    if (!byGroup.has(groupId)) byGroup.set(groupId, { title: group.title, total: 0, correct: 0 });
    const row = byGroup.get(groupId);
    row.total += 1;
    if (q.isCorrect) row.correct += 1;
  }

  const attemptTopics = [...byGroup.values()]
    .map((r) => ({ title: r.title, accuracy: Math.round((r.correct / r.total) * 100), attempts: r.total }))
    .sort((a, b) => a.accuracy - b.accuracy);

  const ranked = await rankWeakTopics(req.student._id, req.batch._id, { subjects: subjectIds(req.batch), archive: true });
  const weakTopics = ranked.map((r) => ({ title: r.title, accuracy: r.accuracy, attempts: r.attempts }));

  const { data } = await aiService.generate({
    feature: "archive-exam-insight",
    schema: insightSchema,
    student: req.student._id,
    batch: req.batch._id,
    ...buildInsightPrompt({
      marks: Number(marksAwarded) || 0,
      totalMarks: Number(totalMarks) || 0,
      attemptTopics,
      weakTopics,
    }),
  });

  res.status(200).json(data);
});

module.exports = { getRecord, buildArchiveExam, submitArchiveExam, getArchiveExamInsight };
