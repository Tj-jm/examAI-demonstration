const asyncHandler = require("express-async-handler");
const Submission = require("../../models/submissionModel");
const Exam = require("../../models/examModel");
const Batch = require("../../models/batchModel");
const storage = require("../../adapters/storage");
const { assertOwnMediaUrl, recordStudentUpload } = require("../../utils/mediaUrl");
const { forReview, partForReview } = require("../../utils/shapeQuestion");
const { notify } = require("../../utils/notify");
const { preparePhoto, hasCameraData } = require("../../utils/photo");
const { finishAttempt, closeIfOverdue, closeOverdue, markBack, awayMessage } = require("../../utils/finishAttempt");
const autosave = require("../../utils/autosave");

// Not nested under a batch — a submission already knows its own exam and
// batch, and the only access check that matters from here on is ownership.

const loadOwn = async (req, res) => {
  const submission = await Submission.findById(req.params.id);
  if (!submission || String(submission.student) !== String(req.student._id)) {
    res.status(404);
    throw new Error("Submission not found.");
  }
  return submission;
};

// A generous but real ceiling — nothing about a written answer needs more
// than a handful of photographed pages, and an unbounded array here would
// be an easy way to bloat a submission document or hand the AI-grading
// vision call an unreasonable number of images to fetch and pay for.
const MAX_ANSWER_IMAGES = 10;

//@desc   Save one answer. Called on every change; the exam UI's own
//        autosave decides how often
//@route  PUT /api/app/submissions/:id/answer
//@access Private (student)
const saveAnswer = asyncHandler(async (req, res) => {
  // Pro, buffered (Settings → Performance): held in Redis and written to the
  // database a few seconds later, with the same checks (utils/autosave.js).
  try {
    if (await autosave.save({ id: req.params.id, studentId: req.student._id, body: req.body || {} })) {
      return res.status(200).json({ saved: true });
    }
  } catch (error) {
    if (error.statusCode) res.status(error.statusCode);
    throw error;
  }

  const submission = await loadOwn(req, res);
  const exam = await Exam.findById(submission.exam).select("durationMinutes bufferSeconds scriptGraceMinutes");

  if (submission.status !== "in_progress") {
    res.status(400);
    throw new Error("This attempt is no longer open for answers.");
  }

  // scriptGraceMinutes only ever extends the deadline when this attempt
  // actually has a written question — submission.answers already carries
  // each answer's questionType from startExam, so that's checked here
  // rather than trusting the client or re-querying the Question collection.
  const mainDeadline = submission.startedAt.getTime() + exam.durationMinutes * 60000;
  const hasWritten = submission.answers.some((a) => a.questionType === "written");
  const graceMs = hasWritten ? (exam.scriptGraceMinutes || 0) * 60000 : 0;
  const deadline = mainDeadline + graceMs + exam.bufferSeconds * 1000;

  if (Date.now() > deadline) {
    res.status(400);
    throw new Error("Time is up for this attempt. Submit what you have.");
  }

  // Past the main timer (plus its small network buffer) but still inside
  // the script-upload grace window — every field except answerImages is
  // locked, same as what the client already shows.
  const inGrace = graceMs > 0 && Date.now() > mainDeadline + exam.bufferSeconds * 1000;

  const { questionId, selectedOption, statementAnswers, subAnswers, answerText, answerImages, timeSpentMs } = req.body;
  // "<question>:<index>" for a passage's written question (utils/passageParts.js).
  const answer = require("../../utils/passageParts").findAnswer(submission.answers, questionId);

  if (!answer) {
    res.status(400);
    throw new Error("That question is not part of this attempt.");
  }

  if (inGrace && (selectedOption !== undefined || statementAnswers !== undefined || subAnswers !== undefined || answerText !== undefined)) {
    res.status(400);
    throw new Error("Time is up — only script images can still be attached.");
  }

  if (selectedOption !== undefined) answer.selectedOption = selectedOption;
  if (statementAnswers !== undefined) answer.statementAnswers = statementAnswers;
  if (subAnswers !== undefined) answer.subAnswers = subAnswers;
  if (answerText !== undefined) answer.answerText = answerText;
  if (answerImages !== undefined) {
    // Checked here, not just left to the upload endpoint below — a batch
    // could have this switched off after images were already attached
    // (or the request crafted directly), and an answer's own saved images
    // shouldn't grow past what the toggle currently allows.
    const batch = await Batch.findById(submission.batch).select("features");
    if (!batch?.features?.writtenAnswerImages) {
      res.status(403);
      throw new Error("Image attachments are not enabled for this batch.");
    }
    if (answerImages.length > MAX_ANSWER_IMAGES) {
      res.status(400);
      throw new Error(`No more than ${MAX_ANSWER_IMAGES} images per answer.`);
    }
    for (const image of answerImages) {
      await assertOwnMediaUrl(image, req.student._id, "answer image");
    }
    answer.answerImages = answerImages;
  }
  if (timeSpentMs) answer.timeSpentMs = (answer.timeSpentMs || 0) + timeSpentMs;

  await submission.save();
  res.status(200).json({ saved: true });
});

const VALID_VIOLATION_TYPES = ["tab-hidden", "answer-paste", "window-blur", "fullscreen-exit", "left-exam"];

//@desc   Log one exam-integrity flag (tab-switch, window blur, fullscreen
//        exit) during an in-progress attempt. Flag-only, by design — this
//        never touches status, marks, or grading; a grader sees the count
//        and decides what it means, same as any other context they weigh.
//        Silently no-ops once the attempt is no longer in_progress rather
//        than erroring — a flag firing right as the exam auto-submits (a
//        blur from the submit confirm dialog itself, say) is timing noise,
//        not something the student should see fail.
//@route  POST /api/app/submissions/:id/violation
//@access Private (student)
const logViolation = asyncHandler(async (req, res) => {
  const submission = await loadOwn(req, res);

  if (submission.status !== "in_progress") {
    res.status(200).json({ logged: false });
    return;
  }

  const { type } = req.body;

  // Back on the exam after a tab switch: stamps when, so the flag shows how
  // long they were away. Not a flag of its own.
  if (type === "back") {
    const marked = markBack(submission);
    if (marked) {
      await submission.save();
      await require("../../utils/conduct").recordExamViolation(submission).catch(() => {});
    }
    // Away too long (the exam's away limit), or the time ran out meanwhile.
    const ended = marked ? await closeIfOverdue(submission) : false;
    res.status(200).json({ logged: marked, ended: Boolean(ended), message: ended === "away" ? awayMessage(submission.awayEnd) : undefined });
    return;
  }

  if (!VALID_VIOLATION_TYPES.includes(type)) {
    res.status(400);
    throw new Error("Unrecognized violation type.");
  }

  // Switched off under Conduct settings: not logged.
  const { WATCH_OF, examWatch } = require("../../utils/finishAttempt");
  if (WATCH_OF[type] && !(await examWatch())[WATCH_OF[type]]) {
    res.status(200).json({ logged: false });
    return;
  }

  submission.violations.push({ type });
  await submission.save();
  await require("../../utils/conduct").recordExamViolation(submission).catch(() => {});
  res.status(200).json({ logged: true });
});

//@desc   Upload one image to attach to a written answer, during an
//        in-progress attempt — gated by this batch's writtenAnswerImages
//        toggle (owner/admin only, see BatchDetail.jsx). Returns just the
//        url; the client adds it to whatever it sends as answerImages on
//        the next saveAnswer call, the same way a doubt's reference image
//        is uploaded separately from the doubt itself.
//@route  POST /api/app/submissions/:id/answer-image
//@access Private (student)
const uploadAnswerImage = asyncHandler(async (req, res) => {
  const submission = await loadOwn(req, res);

  if (submission.status !== "in_progress") {
    res.status(400);
    throw new Error("This attempt is no longer open for answers.");
  }

  const batch = await Batch.findById(submission.batch).select("features");
  if (!batch?.features?.writtenAnswerImages) {
    res.status(403);
    throw new Error("Image attachments are not enabled for this batch.");
  }

  if (!req.file) {
    res.status(400);
    throw new Error("No file was received.");
  }

  // A page from the in-app drawing pad is stored apart, so its url shows a
  // teacher it was drawn in the app (Grading's "Drawn in app" tag).
  const folder = req.query.drawn === "1" ? "answer-drawings" : "answer-images";
  // A photo with no camera data (a screenshot, a saved image) is marked
  // for the teacher. Drawn pages and in-app camera shots have none by
  // nature, so they're not.
  const noCamera = folder === "answer-images" && req.query.camera !== "1" && !(await hasCameraData(req.file));
  const stored = await storage.store(folder, await preparePhoto(req.file));
  await recordStudentUpload(stored.key, req.student._id, folder, { noCamera });
  const url = await storage.urlFor(stored.key, stored.driver);

  res.status(201).json({ url, noCamera });
});

//@desc   Finalize the attempt — scores everything that can be scored without
//        a person, and queues written answers for grading
//@route  POST /api/app/submissions/:id/submit
//@access Private (student)
const submitExam = asyncHandler(async (req, res) => {
  const submission = await loadOwn(req, res);

  // Already closed — usually the timed-out attempt being looked at a moment
  // before this auto-submit arrived. Either way it's handed in; the client
  // goes on to the result.
  if (submission.status !== "in_progress") {
    res.status(200).json({ status: submission.status, message: "This attempt has already been submitted." });
    return;
  }

  const exam = await Exam.findById(submission.exam).populate("questions");
  // Late (a slow network at time-up): what was saved by the deadline is
  // scored, as of the deadline — saveAnswer refuses anything later. Past
  // the away limit: ended the way the exam says.
  if (!(await closeIfOverdue(submission, exam))) await finishAttempt(submission, exam);
  const fresh = await Submission.findById(submission._id).select("status awayEnd");

  res.status(200).json({
    status: fresh.status,
    message: fresh.awayEnd?.mode
      ? awayMessage(fresh.awayEnd)
      : fresh.status === "graded"
        ? "Submitted and scored."
        : "Submitted. Written answers are queued for grading.",
  });
});

//@desc   One submission — the result once graded, a status message before that
//@route  GET /api/app/submissions/:id
//@access Private (student)
const getSubmission = asyncHandler(async (req, res) => {
  let submission = await loadOwn(req, res);
  // Time ran out with the exam closed: scored now, with what was saved.
  if (await closeIfOverdue(submission)) submission = await loadOwn(req, res);

  // An offline exam's mark (entered on a sheet by staff): no answers.
  if (submission.offline) {
    const ex = await Exam.findById(submission.exam).select("title offline").lean();
    const parts = ex?.offline?.parts || [];
    res.status(200).json({
      offline: true,
      status: submission.status,
      absent: Boolean(submission.offline.absent),
      batch: submission.batch,
      exam: submission.exam,
      examTitle: ex?.title,
      date: ex?.offline?.date,
      marks: submission.offline.absent ? null : submission.marks,
      totalMarks: submission.totalMarks,
      passMarks: ex?.offline?.passMarks ?? null,
      parts: parts.map((p, i) => ({ label: p.label, max: p.max, marks: submission.offline.parts?.[i] ?? null })).filter((p) => p.marks !== null),
      remark: submission.offline.remark || "",
    });
    return;
  }

  // A referral being re-checked also parks the submission at "grading" —
  // same status as before it was ever graded the first time. Without this,
  // approving even one flagged question out of twenty dropped the student
  // straight back to the bare "with a grader" stub below, hiding every
  // answer and mark they'd already seen, not just the one under review.
  const isRegrading = submission.status === "grading"
    && submission.referral?.requested
    && submission.referral?.decision === "approved";

  // The pre-graded states used to return status + batch and nothing else,
  // which left the result screen with no exam title to show and no way to
  // link back to the exam itself — so an in-progress attempt opened from
  // the results list was a dead end. One projected lookup fixes both.
  if (submission.status !== "graded" && !isRegrading) {
    const stub = await Exam.findById(submission.exam).select("title");

    if (submission.status === "in_progress") {
      res.status(200).json({
        status: "in_progress",
        batch: submission.batch,
        exam: submission.exam,
        examTitle: stub?.title,
      });
      return;
    }

    res.status(200).json({
      status: submission.status,
      message: submission.awayEnd?.mode === "abandon" ? awayMessage(submission.awayEnd) : statusMessage(submission.status),
      awayEnded: submission.awayEnd?.mode ? true : undefined,
      // Only meaningful for a disqualified attempt — undefined everywhere
      // else, which JSON.stringify drops rather than sending a stray null.
      reason: submission.status === "disqualified" ? submission.disqualified?.reason : undefined,
      batch: submission.batch,
      exam: submission.exam,
      examTitle: stub?.title,
      attempt: submission.attempt,
    });
    return;
  }

  const exam = await Exam.findById(submission.exam).populate("questions");
  const questionMap = new Map(exam.questions.map((q) => [String(q._id), q]));
  const referredIds = new Set((submission.referral?.questionIds || []).map(String));

  const answers = await Promise.all(submission.answers.map(async (a) => {
    const question = questionMap.get(String(a.question));
    return {
      question: !question ? null : a.subIndex != null ? await partForReview(question, a.subIndex) : await forReview(question),
      selectedOption: a.selectedOption,
      statementAnswers: a.statementAnswers,
      subAnswers: a.subAnswers,
      answerText: a.answerText,
      answerImages: a.answerImages,
      annotatedImage: a.annotatedImage,
      codeResult: a.codeResult,
      marksAwarded: a.marksAwarded,
      teacherComment: a.teacherComment,
      // Only meaningful while isRegrading — everything else on the paper
      // keeps its existing (final) mark and shows normally underneath.
      underReview: isRegrading && referredIds.has(String(a.question)),
    };
  }));

  res.status(200).json({
    _id: submission._id,
    status: submission.status,
    regradeInProgress: isRegrading,
    // Ended early by the away limit: shown above the result.
    awayNote: submission.awayEnd?.mode ? awayMessage(submission.awayEnd) : undefined,
    examTitle: exam.title,
    batch: submission.batch,
    attempt: submission.attempt,
    // The total isn't a real number again until every flagged answer has a
    // mark once more — showing submission.marks here would silently count
    // an under-review answer as whatever it was worth before, or as zero.
    marks: isRegrading ? null : submission.marks,
    totalMarks: submission.totalMarks,
    totalTimeMs: submission.totalTimeMs,
    submittedAt: submission.submittedAt,
   gradedAt: submission.gradedAt,
    answers,
    referral: submission.getReferralState(),
    // Absent (undefined) when nothing was generated — an older submission,
    // one from a batch without aiAssist on, or one with nothing topic-
    // classified to report on (see utils/examReport.js). Also withheld
    // while a regrade is in progress (isRegrading) — the marks it was
    // computed from may be about to change, and gradeAnswer regenerates it
    // once the regrade actually completes.
    performanceReport: submission.performanceReport?.generatedAt && !isRegrading
      ? submission.performanceReport
      : undefined,
    // Being written in the background (Pro): the page checks back for it.
    performanceReportPending:
      !isRegrading &&
      Boolean(submission.performanceReport?.queuedAt) &&
      !submission.performanceReport?.generatedAt &&
      Date.now() - new Date(submission.performanceReport.queuedAt).getTime() < REPORT_WAIT_MS,
  });
});

// How long the result page waits for a queued report before giving up on it.
const REPORT_WAIT_MS = 10 * 60 * 1000;

const statusMessage = (status) => ({
  submitted: "Scoring in progress.",
  grading: "A written answer here is waiting on a grader.",
  // Older attempts only — a late or timed-out attempt is now scored with
  // what was saved in time.
  rejected: "This arrived after the time allowed and was not scored.",
  abandoned: "This attempt ran out of time and was never submitted.",
  disqualified: "This attempt was disqualified and is not eligible for a score.",
}[status] || "");

//@desc   This student's attempt history, optionally filtered to one exam
//        or one batch — the results page filters by batch, so that query
//        param has to be real, not just examId as before
//@route  GET /api/app/submissions?examId=...&batchId=...&page=&limit=
//@access Private (student)
const listSubmissions = asyncHandler(async (req, res) => {
  const query = { student: req.student._id };
  if (req.query.examId) query.exam = req.query.examId;
  if (req.query.batchId) query.batch = req.query.batchId;
  const page = Number(req.query.page) || 1;
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  await closeOverdue(query);

  const [submissions, total] = await Promise.all([
    Submission.find(query)
      .populate("exam", "title mode offline.date")
      .populate("batch", "name")
      .select("exam batch attempt status marks totalMarks startedAt submittedAt offline")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Submission.countDocuments(query),
  ]);

  res.status(200).json({ submissions, total, page, pages: Math.ceil(total / limit) });
});

// A student can request exactly one review per submission, ever — approved
// or rejected, requested stays true once set. This is a hard cap, not a
// "one at a time" rule. Only allowed when the submission is already fully
// graded; a student cannot refer a paper that's still in progress.
//
// Unlike doubt reviews (which are a single-document lookup), a submission
// review names specific questions via questionIds — a student thinks "this
// MCQ was marked wrong" or "this written answer deserves more marks", not
// "redo the whole paper".
const requestExamReview = asyncHandler(async (req, res) => {
  const { reason, questionIds } = req.body;

  if (!reason || !reason.trim()) {
    res.status(400);
    throw new Error("Say what you'd like the teacher to look at.");
  }

  if (!Array.isArray(questionIds) || questionIds.length === 0) {
    res.status(400);
    throw new Error("Select at least one question to refer.");
  }

  const submission = await loadOwn(req, res);

  if (submission.status !== "graded") {
    res.status(400);
    throw new Error("Only a fully-graded exam can be referred.");
  }

  if (submission.referral?.requested) {
    res.status(400);
    throw new Error("You've already submitted a review request for this exam.");
  }

  // The questionIds are validated client-side against the exam's questions,
  // but a tampered request could name anything — filter to ones that are
  // actually on this exam.
  const validIds = (questionIds || []).filter((qid) => {
    const id = String(qid);
    return submission.answers.some((a) => String(a.question) === id);
  });

  if (validIds.length === 0) {
    res.status(400);
    throw new Error("Select at least one question from this exam to refer.");
  }

  submission.referral = {
    requested: true,
    reason: reason.trim(),
    questionIds: validIds,
    requestedAt: new Date(),
  };

  await submission.save();

  await notify(submission.student, "examReview", {
    title: "Review requested",
    body: "Your referral request is pending an admin decision.",
    link: `/submissions/${submission._id}`,
  });

  res.status(200).json({ submission });
});

//@desc   Run a coding answer against the question's shown tests (hidden
//        ones count only when the paper is handed in)
//@route  POST /api/app/submissions/:id/run-code
//@access Private (student)
const runCode = asyncHandler(async (req, res) => {
  const submission = await loadOwn(req, res);
  if (submission.status !== "in_progress") {
    res.status(400);
    throw new Error("This attempt is no longer open for answers.");
  }
  const { questionId, code, language } = req.body || {};
  const answer = submission.answers.find((a) => String(a.question) === String(questionId) && a.questionType === "coding");
  if (!answer) {
    res.status(400);
    throw new Error("That question is not part of this attempt.");
  }
  const { Question } = require("../../models/questionModel");
  const question = await Question.findById(questionId).lean();
  if (!question?.languages?.includes(language)) {
    res.status(400);
    throw new Error("That language isn't allowed for this question.");
  }
  const shown = (question.tests || []).filter((t) => !t.hidden);
  const { runTests } = require("../../utils/codeRunner");
  try {
    const results = await runTests({ code: String(code || ""), language, tests: shown, timeLimitMs: question.timeLimitMs });
    res.status(200).json({ results: results.map((r, i) => ({ ...r, input: shown[i].input, expected: shown[i].output })) });
  } catch (error) {
    if (error.statusCode) res.status(error.statusCode);
    throw error;
  }
});

module.exports = {
  runCode,
  saveAnswer, logViolation, uploadAnswerImage, submitExam, getSubmission, listSubmissions, requestExamReview,
};
