const asyncHandler = require("express-async-handler");
const { answersFor, answerKey } = require("../../utils/passageParts");
const autosave = require("../../utils/autosave");
const Exam = require("../../models/examModel");
const Submission = require("../../models/submissionModel");
const { Question } = require("../../models/questionModel");
const { forTaking } = require("../../utils/shapeQuestion");
const { attemptDeadline, closeIfOverdue, closeOverdue, markBack, awayMessage } = require("../../utils/finishAttempt");
const { recordExamViolation } = require("../../utils/conduct");
const ExamSetGroup = require("../../models/examSetGroupModel");
const examSets = require("../../utils/examSets");

// Whether the on-screen calculator is offered. A student's own practice
// exam follows the batch's practice switch; a real exam its own setting,
// else the batch's default for exams.
const calculatorAllowed = (exam, batch) => {
  const f = batch?.features || {};
  if (exam.createdByStudent) return f.calculator !== false;
  return typeof exam.calculator === "boolean" ? exam.calculator : f.examCalculator === true;
};

// A student's own practice paper no longer creates an Exam document at all
// (see practiceExamController.js) — this check is what remains from when it
// did, kept purely as protection against any exam created the old way
// before this change shipped. createdByStudent will never be set on
// anything created from here on, so for every new exam this is simply a
// no-op that always returns true.
const notOwnedByAnotherStudent = (exam, studentId) =>
  !exam.createdByStudent || String(exam.createdByStudent) === String(studentId);

// Starting an exam and resuming one are the same action here — a student
// who refreshes mid-exam calls the same endpoint and gets back the same
// in-progress submission rather than a second attempt.

//@desc   Exams assigned to this batch, with this student's attempt status
//@route  GET /api/app/batches/:batchId/exams?page=&limit=
//@access Private (student + batchAccess + features.exams)
// The filter chips on the student's exam list. "taken" overlaps the others:
// it's every exam with an attempt.
const EXAM_FILTERS = {
  // Startable now, or an attempt to resume.
  open: (e) => e.status === "in_progress" || (e.isOpen && e.status !== "exhausted"),
  upcoming: (e) => !e.isOpen && Boolean(e.opensAt) && e.status !== "in_progress",
  taken: (e) => e.attemptsUsed > 0,
  // Its window has closed (taking it is no longer possible).
  closed: (e) => !e.isOpen && !e.opensAt && e.status !== "in_progress",
};

const getExams = asyncHandler(async (req, res) => {
  const query = { batches: req.batch._id, isPublished: true, createdByStudent: null, offline: null };
  const page = Number(req.query.page) || 1;
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const filter = EXAM_FILTERS[req.query.filter] ? req.query.filter : "all";

  // Every exam on the batch, shaped for this student, then filtered and
  // paged: a filter depends on the student's own attempts, which the
  // exam documents don't hold. A batch has hundreds of exams at most.
  const [exams] = await Promise.all([
    Exam.find(query)
      // isPublished and createdAt aren't used anywhere below except inside
      // isOpen() itself — Mongoose's inclusion-style .select() excludes
      // anything not named here, including timestamps fields, so leaving
      // either out doesn't just skip an unused property: it makes isOpen()
      // read them as undefined and return false unconditionally, since the
      // method has no way to know the query filter already guarantees
      // isPublished is true on every document it's called on.
      .select("title description mode durationMinutes attemptsAllowed opensAt liveHours closesAt isActive isPublished createdAt questions paperSet")
      .sort({ createdAt: -1 })
      .limit(2000),
  ]);

  // Paper sets: one entry per group, standing for the student's own set
  // (or, before they have one, the set they would see now).
  const groupIds = [...new Set(exams.filter((e) => e.paperSet?.group).map((e) => String(e.paperSet.group)))];
  const groups = new Map((groupIds.length ? await ExamSetGroup.find({ _id: { $in: groupIds }, isPublished: true }).select("title").lean() : []).map((g) => [String(g._id), g]));
  const { plain, folded } = examSets.foldSets(exams, await examSets.assignmentsFor(req.student._id, groupIds), groups);
  const entries = [
    ...plain.map((e) => ({ exam: e, id: e._id, title: e.title })),
    ...folded.filter((f) => groups.has(f.groupId)).map((f) => ({ exam: f.exam, id: f.groupId, title: f.title || f.exam.title })),
  ].sort((a, b) => b.exam.createdAt - a.exam.createdAt);

  const mine = { student: req.student._id, exam: { $in: exams.map((e) => e._id) } };
  await closeOverdue(mine);
  const submissions = await Submission.find(mine)
    .select("exam status attempt marks totalMarks")
    .lean();

  const byExam = new Map();
  for (const s of submissions) {
    const key = String(s.exam);
    if (!byExam.has(key)) byExam.set(key, []);
    byExam.get(key).push(s);
  }

  const shaped = entries.map(({ exam: e, id, title }) => {
    const attempts = byExam.get(String(e._id)) || [];
    const inProgress = attempts.find((a) => a.status === "in_progress");
    return {
      _id: id,
      title,
      description: e.description,
      mode: e.mode,
      durationMinutes: e.durationMinutes,
      questionCount: e.questions.length,
      attemptsAllowed: e.attemptsAllowed,
      attemptsUsed: attempts.length,
      isOpen: e.isOpen(),
      opensAt: e.opensLater(),
      status: inProgress ? "in_progress" : attempts.length >= e.attemptsAllowed ? "exhausted" : "available",
      lastGraded: attempts.filter((a) => a.status === "graded").sort((a, b) => b.attempt - a.attempt)[0] || null,
    };
  });
  const counts = { all: shaped.length };
  for (const [k, test] of Object.entries(EXAM_FILTERS)) counts[k] = shaped.filter(test).length;
  const list = filter === "all" ? shaped : shaped.filter(EXAM_FILTERS[filter]);
  res.status(200).json({
    exams: list.slice((page - 1) * limit, page * limit),
    total: list.length,
    page,
    pages: Math.max(1, Math.ceil(list.length / limit)),
    filter,
    counts,
  });
});

//@desc   Rules and summary before starting — no questions yet
//@route  GET /api/app/batches/:batchId/exams/:id
//@access Private (student + batchAccess)
const getExamRules = asyncHandler(async (req, res) => {
  // A paper set's group id (or a set's id) means the student's own set.
  const examId = await examSets.resolveExamId(req.params.id, req.student._id);
  const exam = examId && await Exam.findById(examId).populate("questions", "marks type subQuestions.type");

  if (
    !exam || !exam.isPublished ||
    !exam.batches.some((b) => String(b) === String(req.batch._id)) ||
    !notOwnedByAnotherStudent(exam, req.student._id)
  ) {
    res.status(404);
    throw new Error("Exam not found in this batch.");
  }

  await closeOverdue({ student: req.student._id, exam: exam._id });
  const attemptCount = await Submission.countDocuments({ student: req.student._id, exam: exam._id });

  // The rules screen needs to know this to tell "start" from "resume" apart
  // — without it, a student mid-attempt sees the same "Start exam" button
  // as someone who has never opened it, with no indication anything is
  // already running.
  const inProgress = await Submission.findOne({ student: req.student._id, exam: exam._id, status: "in_progress" });

  const group = exam.paperSet?.group ? await ExamSetGroup.findById(exam.paperSet.group).select("title").lean() : null;

  res.status(200).json({
    _id: exam._id,
    title: group?.title || exam.title,
    description: exam.description,
    mode: exam.mode,
    durationMinutes: exam.durationMinutes,
    bufferSeconds: exam.bufferSeconds,
    scriptGraceMinutes: exam.scriptGraceMinutes,
    awayMode: exam.awayMode || "off",
    awayMinutes: exam.awayMinutes,
    calculator: calculatorAllowed(exam, req.batch),
    hasWrittenQuestions: exam.questions.some((q) => q.type === "written" || (q.subQuestions || []).some((sq) => sq.type === "written")),
    questionCount: exam.questions.length,
    totalMarks: exam.totalMarks(),
    attemptsAllowed: exam.attemptsAllowed,
    attemptsUsed: attemptCount,
    inProgress: Boolean(inProgress),
    isOpen: exam.isOpen(),
    opensAt: exam.opensLater(),
    showResultImmediately: exam.showResultImmediately,
  });
});

// Seeded by the attempt's id, so a student who resumes sees the same order
// they started with rather than a new one on every load.
const seeded = (seed) => {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
};

const shuffle = (array, seed) => {
  const random = seeded(seed);
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

//@desc   Start a new attempt, or resume the one already in progress
//@route  POST /api/app/batches/:batchId/exams/:id/start
//@access Private (student + batchAccess)
const startExam = asyncHandler(async (req, res) => {
  // A paper set: the student's own set, given now if they have none yet.
  const examId = await examSets.resolveExamId(req.params.id, req.student._id, { assign: true });
  const exam = examId && await Exam.findById(examId).populate("questions");

  if (
    !exam || !exam.isPublished ||
    !exam.batches.some((b) => String(b) === String(req.batch._id)) ||
    !notOwnedByAnotherStudent(exam, req.student._id)
  ) {
    res.status(404);
    throw new Error("Exam not found in this batch.");
  }
  if (!exam.isOpen()) {
    res.status(403);
    throw new Error("This exam is not open right now.");
  }

  const existing = await Submission.findOne({ student: req.student._id, exam: exam._id, status: "in_progress" });

  let ended = false;
  if (existing) {
    // Answers still held in Redis (Pro, buffered autosave) are written
    // first, so the attempt resumes with every one of them.
    await autosave.settle(existing, { save: true });
    // Back after closing the tab or leaving the exam page: their away
    // flags get the time they came back (no later than the deadline).
    if (markBack(existing, new Date(Math.min(Date.now(), attemptDeadline(existing, exam))))) {
      await existing.save();
      await recordExamViolation(existing).catch(() => {});
    }
    ended = await closeIfOverdue(existing, exam);
    if (!ended) return res.status(200).json(await shapeStart(exam, existing, req.batch));
  }

  // Why the last attempt closed, for the student.
  const closedBecause = ended === "away"
    ? awayMessage(existing.awayEnd)
    : "Your last attempt ran out of time, so it was submitted with the answers you'd saved.";

  const attemptCount = await Submission.countDocuments({ student: req.student._id, exam: exam._id });
  if (attemptCount >= exam.attemptsAllowed) {
    res.status(403);
    throw new Error(existing
      ? `${closedBecause} There are no attempts left on this exam.`
      : "No attempts remaining on this exam.");
  }

  // A closed attempt never rolls straight into a new one: the student is
  // told, and starts the next attempt themselves (body.newAttempt).
  if (existing && !req.body?.newAttempt) {
    const left = exam.attemptsAllowed - attemptCount;
    return res.status(409).json({
      code: "ATTEMPT_TIMED_OUT",
      reason: ended,
      message: `${closedBecause} You have ${left} attempt${left === 1 ? "" : "s"} left.`,
      submissionId: existing._id,
      nextAttempt: attemptCount + 1,
      attemptsLeft: left,
    });
  }

  // exam+student+attempt is uniquely indexed (submissionModel.js), so two
  // near-simultaneous requests racing past the attemptCount check above
  // cannot both create the same attempt number — the loser's create() below
  // throws a duplicate-key error rather than silently succeeding twice. That
  // is correct at the database level, but the loser still needs an answer:
  // refetch and return whichever submission actually won, so a genuine
  // double-call (a flaky retry, StrictMode's dev-only double effect, a
  // double-click on Start) resumes the one real attempt instead of erroring
  // out or, worse, quietly consuming a second one.
  let submission;
  try {
    submission = await Submission.create({
      exam: exam._id,
      student: req.student._id,
      batch: req.batch._id,
      attempt: attemptCount + 1,
      status: "in_progress",
      startedAt: new Date(),
      answers: answersFor(exam.questions),
    });
  } catch (error) {
    if (error.code !== 11000) throw error;

    const winner = await Submission.findOne({ student: req.student._id, exam: exam._id, status: "in_progress" });
    if (!winner) throw error; // genuinely something else — surface the real error

    return res.status(200).json(await shapeStart(exam, winner, req.batch));
  }

  res.status(201).json(await shapeStart(exam, submission, req.batch));
});

const shapeStart = async (exam, submission, batch) => {
  const questions = exam.shuffleQuestions ? shuffle(exam.questions, submission._id) : exam.questions;

  return {
    submissionId: submission._id,
    startedAt: submission.startedAt,
    // The server's clock now, so the timer can count on it rather than the
    // device's (often a few seconds off, either way).
    serverNow: Date.now(),
    durationMinutes: exam.durationMinutes,
    bufferSeconds: exam.bufferSeconds,
    // Script-upload grace period only ever matters when there's a written
    // question to photograph — questions.map(forTaking) below already
    // carries each question's type, so the client derives "does this exam
    // even have one" itself rather than trusting a second flag to agree.
    scriptGraceMinutes: exam.scriptGraceMinutes,
    awayMode: exam.awayMode || "off",
    awayMinutes: exam.awayMinutes,
    // Which flags the exam page watches for (Conduct settings).
    watch: await require("../../utils/finishAttempt").examWatch(),
    calculator: calculatorAllowed(exam, batch),
    questions: await Promise.all(questions.map(forTaking)),
    savedAnswers: submission.answers.map((a) => ({
      // "<passage>:<index>" for a passage's written question.
      question: answerKey(a),
      selectedOption: a.selectedOption,
      statementAnswers: a.statementAnswers,
      subAnswers: a.subAnswers,
      answerText: a.answerText,
      answerImages: a.answerImages,
    })),
  };
};

module.exports = { getExams, getExamRules, startExam, calculatorAllowed };
