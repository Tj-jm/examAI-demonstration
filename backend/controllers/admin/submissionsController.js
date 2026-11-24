const asyncHandler = require("express-async-handler");
const { questionFor } = require("../../utils/passageParts");
// A passage's written part shows its passage above it (utils/questionText.js).
const withStem = (q) => (q ? (q.context ? { ...(q.toObject ? q.toObject() : q), question: questionText(q) } : q) : null);
const { questionText } = require("../../utils/questionText");
const mongoose = require("mongoose");
const Submission = require("../../models/submissionModel");
const Exam = require("../../models/examModel");
const { studentExamIds } = require("../../utils/excludeStudentExams");
const { staffBatchIds } = require("../../utils/staffBatchIds");
const { examFlagSummary } = require("../../utils/conduct");
const { closeOverdue } = require("../../utils/finishAttempt");

// General oversight, distinct from the grading queue — that page is "here
// is my work to do" (status: grading, nothing else). This is "let me look
// up what a specific student did on a specific exam", any status, any
// student, any batch. Reads from the same Submission collection; nothing
// here writes to it except the grading action already exposed elsewhere.

//@desc   Every submission, filterable by student, exam, batch, and a view
//        (VIEWS) or a raw status; with each view's count
//@route  GET /api/submissions?studentId=&examId=&batchId=&view=&status=&page=&limit=
//@access Private
// The list's tabs: plain groups of statuses, so nobody has to know what
// "submitted" means next to "grading". "regrade" is any attempt with a
// regrade request, whatever its status.
const VIEWS = {
  live: { status: "in_progress" },
  marking: { status: { $in: ["submitted", "grading"] } },
  done: { status: "graded" },
  regrade: { "referral.requested": true },
  void: { status: { $in: ["rejected", "abandoned", "disqualified"] } },
};

const getSubmissions = asyncHandler(async (req, res) => {
  const { studentId, examId, batchId, status, view } = req.query;
  const page = Number(req.query.page) || 1;
  const limit = Math.min(Number(req.query.limit) || 30, 100);

  const query = {};
  if (studentId) query.student = studentId;
  // An explicit examId always wins over the exclusion below — an admin who
  // already has the id of a specific exam in hand is not browsing, and a
  // legacy practice-exam id typed or pasted directly should still resolve
  // rather than come back mysteriously empty.
  if (examId) {
    query.exam = examId;
  } else {
    query.exam = { $nin: await studentExamIds() };
  }
  const viewQuery = VIEWS[view] || (status ? { status } : {});

  // This page had no batch scoping at all — a teacher or grader could pick
  // "All batches" (or any batch by id) and browse every submission on the
  // platform, not just the ones from batches they're actually assigned to.
  // Same staffBatchIds rule the grading queue already enforces. An explicit
  // batchId outside what this account can see fails closed (empty result),
  // not by silently falling back to "show everything".
  const batchIds = await staffBatchIds(req.user);
  if (batchIds) {
    const allowed = new Set(batchIds.map(String));
    if (batchId && !allowed.has(String(batchId))) {
      res.status(200).json({ submissions: [], total: 0, page, pages: 1, counts: {} });
      return;
    }
    query.batch = batchId || { $in: batchIds };
  } else if (batchId) {
    query.batch = batchId;
  }

  // Attempts whose time ran out with the exam closed are scored now, so
  // the list shows them as submitted.
  await closeOverdue(query);

  // Each tab's count under the other filters.
  const countOf = async () => {
    const entries = await Promise.all(Object.entries(VIEWS).map(async ([k, q]) => [k, await Submission.countDocuments({ ...query, ...q })]));
    const counts = Object.fromEntries(entries);
    counts.all = await Submission.countDocuments(query);
    return counts;
  };
  const listQuery = { ...query, ...viewQuery };

  const [submissions, total, counts] = await Promise.all([
    Submission.find(listQuery)
      .populate("student", "name email phoneNumber")
      .populate("exam", "title mode")
      .populate("batch", "name")
      .select("student exam batch attempt status marks totalMarks startedAt submittedAt violations referral.requested referral.decision")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Submission.countDocuments(listQuery),
    countOf(),
  ]);

  res.status(200).json({
    submissions: submissions.map(({ violations, ...s }) => ({ ...s, violationCount: violations?.length || 0 })),
    total, page, pages: Math.max(1, Math.ceil(total / limit)), counts });
});

//@desc   One submission in full — every question, every answer, whatever
//        the status. Grading a pending written answer from here reuses the
//        same PUT /api/grading/:id/answers/:answerId the queue uses.
//@route  GET /api/submissions/:id
//@access Private
const getSubmission = asyncHandler(async (req, res) => {
  if (mongoose.isValidObjectId(req.params.id)) await closeOverdue({ _id: req.params.id });
  const submission = await Submission.findById(req.params.id)
    .populate("student", "name email phoneNumber")
    .populate("batch", "name")
    .populate("disqualified.by", "name identifier isDeleted")
    .populate("disqualified.reinstatedBy", "name identifier isDeleted");

  if (!submission) {
    res.status(404);
    throw new Error("Submission not found.");
  }

  const batchIds = await staffBatchIds(req.user);
  // submission.batch is populated above (for the name in the response) —
  // compare its ._id, not the populated document itself; see
  // gradingController.js's getForGrading for the bug this exact mistake
  // caused there.
  if (batchIds && !batchIds.some((id) => String(id) === String(submission.batch._id))) {
    res.status(403);
    throw new Error("You are not assigned to this batch.");
  }

  const exam = await Exam.findById(submission.exam).populate("questions");
  const questionMap = new Map(exam.questions.map((q) => [String(q._id), q]));

  res.status(200).json({
    _id: submission._id,
    exam: { _id: exam._id, title: exam.title },
    student: submission.student,
    batch: submission.batch,
    attempt: submission.attempt,
    status: submission.status,
    marks: submission.marks,
    totalMarks: submission.totalMarks,
    startedAt: submission.startedAt,
    submittedAt: submission.submittedAt,
    gradedAt: submission.gradedAt,
    totalTimeMs: submission.totalTimeMs,
    // Exam integrity flags and where they stand on the conduct record.
    violations: submission.violations,
    // Ended early by the exam's away limit — see submissionModel.js.
    awayEnd: submission.awayEnd,
    conduct: await examFlagSummary(submission, req.user),
    // See gradingController.js's getForGrading for the identical shaping —
    // kept in sync since this page also renders the disqualify/reinstate
    // panel (Disqualify is a grading action, reused here as-is rather than
    // duplicated, since this is the only page that can reach a submission
    // that never entered the grading queue at all, e.g. an all-objective
    // exam that went straight to "graded").
    disqualified: submission.disqualified && submission.disqualified.at
      ? {
          reason: submission.disqualified.reason,
          by: submission.disqualified.by
            ? {
                _id: submission.disqualified.by._id,
                name: submission.disqualified.by.identifierOrName?.() ?? submission.disqualified.by.name,
                isDeleted: submission.disqualified.by.isDeleted,
              }
            : null,
          at: submission.disqualified.at,
          reinstatedBy: submission.disqualified.reinstatedBy
            ? {
                _id: submission.disqualified.reinstatedBy._id,
                name: submission.disqualified.reinstatedBy.identifierOrName?.() ?? submission.disqualified.reinstatedBy.name,
                isDeleted: submission.disqualified.reinstatedBy.isDeleted,
              }
            : null,
          reinstatedAt: submission.disqualified.reinstatedAt,
        }
      : null,
    answers: submission.answers.map((a) => ({
      _id: a._id,
      question: withStem(questionFor(a, questionMap.get(String(a.question)))),
        subIndex: a.subIndex ?? null,
      questionType: a.questionType,
      selectedOption: a.selectedOption,
      statementAnswers: a.statementAnswers,
      subAnswers: a.subAnswers,
      answerText: a.answerText,
      answerImages: a.answerImages || [],
      annotatedImage: a.annotatedImage || null,
      marksAwarded: a.marksAwarded,
      teacherComment: a.teacherComment,
    })),
  });
});

//@desc   Permanently delete a submission. Attempt counts are computed live
//        off this collection (see app/examController.js's attemptCount),
//        not a separate stored counter, so this also frees up the attempt
//        slot it used — deleting a bad/test submission genuinely lets the
//        student attempt again, not just remove a record.
//@route  DELETE /api/submissions/:id
//@access Private (owner, admin only — unlike grading, which teacher/grader
//        share, this permanently erases graded marks and history, so it's
//        gated tighter at the route rather than here)
const deleteSubmission = asyncHandler(async (req, res) => {
  const submission = await Submission.findById(req.params.id);

  if (!submission) {
    res.status(404);
    throw new Error("Submission not found.");
  }

  await submission.deleteOne();

  res.status(200).json({ message: "Submission deleted." });
});

module.exports = { getSubmissions, getSubmission, deleteSubmission };
