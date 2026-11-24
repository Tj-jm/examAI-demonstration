const asyncHandler = require("express-async-handler");
const { parseKey, answerKey, questionFor } = require("../../utils/passageParts");
// A passage's marks from its multiple choice questions only.
const mcqMarks = (q) => (q.subQuestions || []).filter((sq) => sq.type !== "written").reduce((n, sq) => n + (sq.marks || 0), 0);
const { questionText, fullQuestionText } = require("../../utils/questionText");
const { batchQuestionScope, subjectIds } = require("../../utils/batchSubjects");
const { Question } = require("../../models/questionModel");
const { loadQuestionsInOrder } = require("../../utils/loadQuestionsInOrder");
const Submission = require("../../models/submissionModel");
const PracticeAttempt = require("../../models/practiceAttemptModel");
const PracticeExamRecord = require("../../models/practiceExamRecordModel");
const { forTaking, forReview, partForReview } = require("../../utils/shapeQuestion");
const aiService = require("../../ai/service");
const { AiCapReachedError } = aiService;
const { gradeWrittenPractice, practiceExamInsight: buildInsightPrompt } = require("../../ai/prompts");
const { handwritingMode, practiceHandwriting, withNote } = require("../../utils/handwriting");
const { gradedAnswer: gradedAnswerSchema, examPerformanceReport: insightSchema } = require("../../ai/schemas");
const { computePercent } = require("../../utils/practiceScoring");
const AiConfig = require("../../models/aiConfigModel");
const { capWrittenByBudget, writtenCostSummary, needsGrading } = require("../../utils/writtenBudget");
const { collectAnswerImages, gradingImageUrl } = require("../../utils/practiceAnswerImages");
const { gradeWrittenAnswers } = require("../../utils/gradeWrittenAnswers");
const { rankWeakTopics } = require("../../utils/weakTopics");
const { sanitizeReasoning } = require("../../ai/leakGuard");
const { reconcileRubricMarks } = require("../../utils/rubricMarks");

// This replaces the old createCustomExam, which built a real Exam and a
// real Submission and ran a student's self-built practice paper through the
// exact same pipeline a teacher's exam uses. That made every practice
// attempt indistinguishable from real exam activity everywhere that
// pipeline is visible — the admin exam list, a student's own results
// history, attempt counts.
//
// Nothing about an attempt is written to the database until it is
// finished, and even then only one thing survives: a running average (see
// practiceExamRecordModel.js). There is no Exam document, no Submission, no
// row reserving the attempt while it's in progress. The question set built
// here lives only in this response and whatever the client holds onto
// until it calls submit.
//
// The trade-off, stated plainly: no resume-after-refresh, and no
// server-enforced timer. A real exam has both because a real exam has
// stakes worth protecting against a lost connection or a manipulated
// clock. Practice does not, and the whole point of this rewrite was to
// stop treating it as if it did.

const MIN_QUESTIONS = 3;
const MAX_QUESTIONS = 50;
// Passage is scored objectively by Submission.scoreObjective (its
// subAnswers), same as the archive's practice exams.
const VALID_TYPES = ["mcq", "mtf", "written", "passage"];

// A written answer is graded synchronously against the rubric, right here,
// rather than queued the way a real exam's written questions are — that
// queue exists because a real exam's result has to be trustworthy even if
// grading takes a while. A practice result that isn't even saved has no
// "later" to defer to, so the entire submission is graded in one request.
//
// aiAssist is checked explicitly rather than left to a route-level guard:
// this endpoint's real job (scoring mcq/mtf) has nothing to do with AI, so
// gating the whole route the way /practice/explain does would block a
// student's entirely-objective paper just because aiAssist happens to be
// off. aiService.generate itself only enforces caps and cost limits, not
// the feature flag — calling it without this check would quietly grade
// written answers through a feature the batch has switched off.
const gradeWritten = async (question, answerText, { student, batch, aiAssist, imageUrl }) => {
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
  if (!aiAssist) {
    return { marksAwarded: null, note: "AI assistance is off for this batch, so written questions can't be graded here." };
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
      feature: "practice-exam-grade-written",
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
    // One written question failing to grade — a cap reached mid-submission,
    // a provider hiccup — must not cost the student every other answer in
    // the paper. Nothing here is retryable (there is no saved state to
    // retry against), so the rest of the submission is graded and returned
    // with this one question flagged instead of the whole request failing.
    return {
      marksAwarded: null,
      note: error instanceof AiCapReachedError ? error.message : "Could not be auto-graded — try again later.",
    };
  }
};

//@desc   This student's running average across every practice exam they
//        have built in this batch — shown on the setup screen before they
//        start another one.
//@route  GET /api/app/batches/:batchId/practice-exams/record
//@access Private (student + batchAccess + features.practice)
const getRecord = asyncHandler(async (req, res) => {
  const record = await PracticeExamRecord.findOne({ student: req.student._id, batch: req.batch._id });

  res.status(200).json({
    attemptCount: record?.attemptCount || 0,
    averagePercent: record ? Math.round(record.averagePercent) : null,
  });
});

//@desc   Build a timed practice paper from the student's own choice of
//        topics, types, duration and question count. Nothing is written to
//        the database — see the note at the top of this file.
//@route  POST /api/app/batches/:batchId/practice-exams
//@access Private (student + batchAccess + features.practice)
const buildPracticeExam = asyncHandler(async (req, res) => {
  const { topicIds, chapterIds, types, durationMinutes, questionCount } = req.body;

  const validTopicIds = Array.isArray(topicIds) ? topicIds : [];
  // chapterIds is the chapter-pool sentinel used everywhere else in the app
  // (getTopics/getPracticeQuestions) — a chapter id standing in for "every
  // question filed straight under this chapter with no topic". Gated on the
  // same batch flag those two already check, so this endpoint can't be used
  // to reach chapter-pool questions on a batch that has chapter practice
  // turned off.
  const validChapterIds = req.batch.features?.practiceByChapter && Array.isArray(chapterIds) ? chapterIds : [];

  if (validTopicIds.length === 0 && validChapterIds.length === 0) {
    res.status(400);
    throw new Error("Choose at least one topic.");
  }

  const validTypes = Array.isArray(types) ? types.filter((t) => VALID_TYPES.includes(t)) : [];
  if (validTypes.length === 0) {
    res.status(400);
    throw new Error("Choose at least one question type.");
  }

  const duration = Number(durationMinutes);
  if (!duration || duration < 5 || duration > 240) {
    res.status(400);
    throw new Error("Pick a duration between 5 and 240 minutes.");
  }

  // Written questions in a practice paper can only ever be graded by AI —
  // there is no human teacher marking an attempt that is never saved — so
  // offering "written" as a choice when the batch has aiAssist off would
  // build a paper guaranteed to come back ungradable on every one of those
  // questions. Excluded here rather than left to fail loudly at submit time.
  const gradableTypes = req.batch.features?.aiAssist ? validTypes : validTypes.filter((t) => t !== "written");

  if (gradableTypes.length === 0) {
    res.status(400);
    throw new Error("Written questions need AI assistance, which is off for this batch. Choose multiple choice or true/false instead.");
  }

  const requestedCount = Math.min(Math.max(Number(questionCount) || 10, MIN_QUESTIONS), MAX_QUESTIONS);

  // Same $or-of-two-shapes pattern as applyContentFilters/getReviewQueue:
  // a topic match and a chapter-pool match (topic: null, chapter: $in) are
  // structurally different queries, so they're built as separate clauses
  // rather than forced into one $in that a chapter-pool "id" could never
  // actually satisfy.
  const scopeClauses = [];
  if (validTopicIds.length > 0) scopeClauses.push({ topic: { $in: validTopicIds } });
  if (validChapterIds.length > 0) scopeClauses.push({ topic: null, chapter: { $in: validChapterIds } });

  const available = await Question.find({
    ...batchQuestionScope(req.batch),
    status: "published",
    type: { $in: gradableTypes },
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

  // A passage with written questions under it needs AI grading too.
  const written = req.batch.features?.aiAssist ? available.filter(needsGrading) : [];
  const nonWritten = available.filter((q) => !needsGrading(q));

  // Only as many written questions as the student can pay to grade — see
  // utils/writtenBudget.js.
  const config = await AiConfig.get();
  const budget = await capWrittenByBudget({
    written,
    student: req.student._id,
    batch: req.batch._id,
    config,
    feature: "practice-exam-grade-written",
  });
  const cappedWritten = budget.written;
  const pool = [...cappedWritten, ...nonWritten];

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

//@desc   Grade a completed practice paper in one shot and return the full
//        answer key alongside the student's own answers, for a one-time
//        review. This response is the only copy of the detailed result
//        that will ever exist — the client is responsible for holding onto
//        it, since there is nothing here to fetch again later.
//@route  POST /api/app/batches/:batchId/practice-exams/submit
//@access Private (student + batchAccess + features.practice)
const submitPracticeExam = asyncHandler(async (req, res) => {
  const { answers } = req.body;

  if (!Array.isArray(answers) || answers.length === 0) {
    res.status(400);
    throw new Error("No answers were submitted.");
  }

  // "<passage>:<index>" answers a passage's written question (utils/passageParts.js).
  const questionIds = answers.map((a) => parseKey(a.questionId).question).filter(Boolean);

  // Re-fetched from the live collection rather than trusted from the
  // client — exactly the trust model a real submission's grading already
  // uses. A stray or tampered id simply has nothing to match against below.
  const questions = await Question.find({
    _id: { $in: questionIds },
    ...batchQuestionScope(req.batch),
    status: "published",
  }).populate("topic", "_id");

  const questionMap = new Map(questions.map((q) => [String(q._id), q]));

  // A throwaway, unsaved Submission document, built only to reuse its
  // already-tested mcq/mtf scoring rather than re-implement negative
  // marking and partial credit a second time in a different file — a
  // second implementation is how the two would eventually disagree.
  // Required-field validation never runs because .save() is never called,
  // and nothing here ever reaches the database. questionType is set from
  // the re-fetched question's own type, not copied from the client, since
  // scoreObjective's branching has to run on the truth, not on whatever a
  // request claims a question is.
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
        aiAssist: req.batch.features?.aiAssist,
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

    // Feeds the same weak-topic signal the topic-drill flow builds. This is
    // new: a custom exam previously contributed nothing to weak-topic
    // detection at all, even though answering a question inside a
    // self-built paper is exactly as informative about a student's grasp
    // of that topic as drilling it directly.
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

  // totalMarks can be 0 if every question turned out ungradable (every
  // written question missing a rubric, say) — nothing to average in that
  // case, and forcing a 0% into the record would misrepresent a content
  // gap as a failed attempt.
  const percent = computePercent(marksAwarded, totalMarks);

  if (percent !== null) {
    await PracticeExamRecord.recordAttempt(req.student._id, req.batch._id, percent);
  }
  if (attemptLogs.length > 0) {
    await PracticeAttempt.insertMany(attemptLogs);
  }

  // What this submission's AI grading cost, so the student sees it on the
  // result. Taken from today's free allowance first, then credits.
  const aiCreditsUsed = aiGraded > 0 ? aiGraded * (await AiConfig.get()).getFeatureCost("practice-exam-grade-written") : 0;

  res.status(200).json({ percent, marksAwarded, totalMarks, questions: results, aiGraded, aiCreditsUsed });
});

//@desc   A one-off, student-requested coaching note on a practice exam they
//        just finished — same shape/prompt family as the auto-generated
//        exam performance report (utils/examReport.js), but triggered on
//        click rather than automatically, since nothing about a practice
//        exam is persisted for a background job to react to (see the note
//        at the top of this file). The client echoes back the graded
//        result it already has (from submitPracticeExam's response, never
//        stored server-side) — trusted here the same way it's trusted
//        anywhere else in this ephemeral flow, since nothing scored or
//        billed depends on it; only the coaching text does.
//@route  POST /api/app/batches/:batchId/practice-exams/insight
//@access Private (student + batchAccess + features.practice)
const getPracticeExamInsight = asyncHandler(async (req, res) => {
  if (!req.batch.features?.aiAssist) {
    res.status(403);
    throw new Error("AI assistance is off for this batch.");
  }
  if (!req.batch.features?.practiceExamInsight) {
    res.status(403);
    throw new Error("AI insight on practice exams is off for this batch.");
  }

  const { questions, marksAwarded, totalMarks } = req.body;
  if (!Array.isArray(questions) || questions.length === 0) {
    res.status(400);
    throw new Error("No graded result to build an insight from.");
  }

  const questionIds = questions.map((q) => q._id).filter(Boolean);
  const docs = await Question.find({ _id: { $in: questionIds }, ...batchQuestionScope(req.batch) })
    .select("topic chapter")
    .populate("topic", "title")
    .populate("chapter", "title");
  const docMap = new Map(docs.map((d) => [String(d._id), d]));

  // Same byTopic-or-byChapter grouping as examReport.js's own report, just
  // fed from the client-echoed isCorrect/gradable instead of re-deriving it
  // from raw answers a second time.
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

  const ranked = await rankWeakTopics(req.student._id, req.batch._id, { subjects: subjectIds(req.batch) });
  const weakTopics = ranked.map((r) => ({ title: r.title, accuracy: r.accuracy, attempts: r.attempts }));

  const { data } = await aiService.generate({
    feature: "practice-exam-insight",
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

module.exports = { getRecord, buildPracticeExam, submitPracticeExam, getPracticeExamInsight };
