const asyncHandler = require("express-async-handler");
const { questionFor } = require("../../utils/passageParts");
// A passage's written part shows its passage above it (utils/questionText.js).
const withStem = (q) => (q ? (q.context ? { ...(q.toObject ? q.toObject() : q), question: questionText(q) } : q) : null);
const { questionText, fullQuestionText } = require("../../utils/questionText");
const mongoose = require("mongoose");
const Submission = require("../../models/submissionModel");
const Exam = require("../../models/examModel");
const Batch = require("../../models/batchModel");
const AiConfig = require("../../models/aiConfigModel");
const User = require("../../models/userModel");
const { Question } = require("../../models/questionModel");
const { studentExamIds } = require("../../utils/excludeStudentExams");
const { notify } = require("../../utils/notify");
const { scheduleExamPerformanceReport } = require("../../utils/examReport");
const { sendResultMessage } = require("../../utils/progressReports");
const { toAbsoluteUrl, resolveOwnMediaKey } = require("../../utils/mediaUrl");
const StudentUpload = require("../../models/studentUploadModel");
const { staffBatchIds } = require("../../utils/staffBatchIds");
const storage = require("../../adapters/storage");
const aiService = require("../../ai/service");
const { AiCapReachedError } = aiService;
const { gradeWritten: gradeWrittenPrompt } = require("../../ai/prompts");
const { handwritingMode, notHandwritten } = require("../../utils/handwriting");
const { gradedAnswer: gradedAnswerSchema } = require("../../ai/schemas");
const { containsModelAnswerLeak } = require("../../ai/leakGuard");
const { reconcileRubricMarks } = require("../../utils/rubricMarks");
const flow = require("../../utils/gradingFlow");
const Student = require("../../models/studentModel");

// staffBatchIds now lives in utils/staffBatchIds.js — submissionsController.js
// needed the exact same "which batches can this account touch" rule
// (getSubmissions/getSubmission had no batch scoping at all until it was
// pulled out), so it's shared rather than re-copied a second time.

// Anonymization for the grader role (point 3 of the spec, not a teacher
// concern — a teacher keeps the full identity context it's always had).
// Applied at the response-shaping layer only, never by omitting fields
// from the query, so nothing here silently starts depending on the
// student document existing.
const shapeStudentFor = (user, student) => {
  if (user.role !== "grader") return student;
  return null;
};

// "Whoever did the first pass does the regrade" — the rule as given. Only
// ever meaningful for a written answer that's actually part of an approved
// referral: mcq/mtf are auto-scored, so there's no "first grader" to route
// back to (point 1 of the spec — those stay open to anyone on the batch,
// same as an answer with no gradedByUser at all, e.g. graded before this
// field existed). Returns the ObjectId the regrade is locked to, or null
// when it's open to anyone assigned to the batch. Takes the populated
// gradedByUser (needs isActive + isDeleted) and the batch doc (needs
// teachers + graders) so this never issues its own query — callers already
// have both loaded.
// Regrade routing lives in utils/gradingFlow.js (regradeTarget): the
// person a regraded answer is reserved for, or null for anyone on the batch.

// A claim older than this is abandoned, not held — there's no reliable
// "I closed the tab" signal from the frontend, so staleness is the only
// thing that ever frees a claim nobody explicitly released. Long enough to
// grade a real submission without getting bumped mid-work, short enough
// that a crashed tab doesn't lock a submission out for the rest of the day.
const CLAIM_STALE_MS = 20 * 60 * 1000;

const isPrivileged = (user) => ["owner", "admin"].includes(user.role);

// Pure and exported so the boundary itself (not just the plumbing around
// it) has a test that doesn't need a database — shared by shapeClaim,
// gradeAnswer's guard, and claimSubmission's query, so "is this claim still
// live" only ever has one definition.
const claimIsLive = (claimedAt, now = new Date()) =>
  Boolean(claimedAt) && new Date(claimedAt) > new Date(now.getTime() - CLAIM_STALE_MS);

const shapeClaim = (submission) => {
  if (!submission.claimedBy || !claimIsLive(submission.claimedAt)) return null;
  const claimant = submission.claimedBy;
  return {
    _id: claimant._id,
    name: claimant.identifierOrName?.() ?? claimant.name,
    claimedAt: submission.claimedAt,
  };
};

// Manual grading only for now — the prompt and schema for AI-assisted
// grading exist (ai/prompts, ai/schemas) but nothing calls them yet. This
// gives a written exam somewhere to actually finish: without it, a
// submission with a written answer sits at "grading" forever.

//@desc   Submissions with at least one ungraded written answer
//@route  GET /api/grading?page=&limit=
//@access Private
const escapeRegex = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getQueue = asyncHandler(async (req, res) => {
  const privileged = isPrivileged(req.user);
  const g = await flow.gradingSettings();
  const query = { status: "grading" };
  // Same exclusion as submissionsController — a legacy practice exam's
  // written answer sitting in "grading" would otherwise be a teacher's
  // work item with no exam anyone can actually open behind it.
  const notStudentExams = { $nin: await studentExamIds() };
  query.exam = notStudentExams;

  const batchIds = await staffBatchIds(req.user);
  if (batchIds) query.batch = { $in: batchIds };
  const and = [];

  // Batch: anyone, within the batches they grade.
  if (req.query.batch && mongoose.isValidObjectId(req.query.batch)
    && (!batchIds || batchIds.some((b) => String(b) === String(req.query.batch)))) {
    query.batch = new mongoose.Types.ObjectId(String(req.query.batch));
  }
  // Student search: owners and admins (graders mark anonymously).
  if (privileged && req.query.q && String(req.query.q).trim()) {
    const rx = new RegExp(escapeRegex(String(req.query.q).trim()), "i");
    const ids = await Student.find({ $or: [{ name: rx }, { email: rx }, { phoneNumber: rx }, { studentId: rx }] }).select("_id").limit(1000).lean();
    query.student = { $in: ids.map((x) => x._id) };
  }
  if (!privileged) {
    // A script held by someone else (by-script pay, or assigned by an
    // admin) isn't theirs to pick up — unless that person can no longer
    // grade, in which case it's open again.
    const gone = await User.find({ $or: [{ isActive: false }, { isDeleted: true }] }).select("_id").lean();
    and.push({ $or: [{ heldBy: null }, { heldBy: req.user._id }, { heldBy: { $in: gone.map((u) => u._id) } }] });
  }

  // Where a script is in its marking. Stuck and held are for owners and
  // admins; everyone can narrow to not started, part-marked or regrades.
  const STATES = {
    untouched: { test: flow.isUntouched },
    partial: { test: flow.isPartial },
    regrade: { extra: { "referral.requested": true, "referral.decision": "approved" } },
    ...(privileged ? { stuck: { test: (x) => flow.isStuck(x, g.stuckHours) }, held: { extra: { heldBy: { $ne: null } } } } : {}),
  };
  const withAnd = (q, more = []) => (and.length || more.length ? { ...q, $and: [...and, ...more] } : q);
  const narrow = async (q, key) => {
    const st = STATES[key];
    if (!st) return withAnd(q);
    if (st.extra) return withAnd({ ...q, ...st.extra });
    return withAnd(q, [{ _id: { $in: await flow.idsWhere(withAnd(q), st.test) } }]);
  };

  // The exams with scripts waiting (for the exam filter), before the exam
  // and the state narrow the list.
  const examRows = await Submission.find(withAnd(query)).select("exam").populate("exam", "title").lean();
  const examTally = new Map();
  for (const r of examRows) {
    if (!r.exam?._id) continue;
    const k = String(r.exam._id);
    examTally.set(k, { _id: r.exam._id, title: r.exam.title, count: (examTally.get(k)?.count || 0) + 1 });
  }
  const exams = [...examTally.values()].sort((a, b) => b.count - a.count);
  if (req.query.examId && mongoose.isValidObjectId(req.query.examId)) query.exam = new mongoose.Types.ObjectId(String(req.query.examId));

  // Counts per state, for the strip at the top of the queue.
  const counts = req.query.counts === "true"
    ? Object.fromEntries(await Promise.all([
      ["all", withAnd(query)],
      ...await Promise.all(Object.keys(STATES).map(async (key) => [key, await narrow(query, key)])),
    ].map(async ([key, q]) => [key, await Submission.countDocuments(q)])))
    : undefined;

  const finalQuery = await narrow(query, req.query.state);

  const page = Number(req.query.page) || 1;
  const limit = Math.min(Number(req.query.limit) || 30, 100);

  const [submissions, total, stuck] = await Promise.all([
    Submission.find(finalQuery)
      .populate("exam", "title")
      .populate("student", "name email phoneNumber studentId")
      .populate("batch", "name")
      .populate("claimedBy", "name identifier")
      .populate("heldBy", flow.USER_FIELDS)
      .select("exam student batch attempt submittedAt answers claimedBy claimedAt violations heldBy heldAssigned progressAt status referral")
      .sort({ submittedAt: 1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Submission.countDocuments(finalQuery),
    privileged
      ? flow.idsWhere({ status: "grading", ...(batchIds ? { batch: { $in: batchIds } } : {}) }, (x) => flow.isStuck(x, g.stuckHours)).then((ids) => ids.length)
      : Promise.resolve(0),
  ]);

  res.status(200).json({
    submissions: submissions.map((s) => {
      const claim = shapeClaim(s);
      const written = s.answers.filter((a) => a.questionType === "written");
      const held = s.heldBy && s.heldBy._id ? s.heldBy : null;
      return {
        _id: s._id,
        exam: s.exam,
        student: shapeStudentFor(req.user, s.student),
        batch: s.batch,
        attempt: s.attempt,
        submittedAt: s.submittedAt,
        pendingCount: s.pendingWrittenAnswers().length,
        writtenCount: written.length,
        violationCount: s.violations.length,
        claimedBy: claim && String(claim._id) !== String(req.user._id) ? claim : null,
        claimedByMe: Boolean(claim) && String(claim._id) === String(req.user._id),
        heldBy: held && (privileged || String(held._id) !== String(req.user._id))
          ? { _id: held._id, name: held.identifierOrName?.() ?? held.name, gone: held.isDeleted || held.isActive === false, assigned: s.heldAssigned }
          : null,
        heldByMe: Boolean(held) && String(held._id) === String(req.user._id),
        regrade: flow.isRegrade(s),
        stuck: privileged && flow.isStuck(s, g.stuckHours),
        lastProgress: flow.lastProgress(s),
      };
    }),
    total,
    page,
    pages: Math.ceil(total / limit),
    stuck,
    stuckHours: g.stuckHours,
    payMode: g.payMode,
    counts,
    exams,
  });
});

//@desc   One submission, for grading — written questions alongside the
//        student's answers, everything a marker needs on one screen
//@route  GET /api/grading/:id
//@access Private
//@desc   One answer image, sent from this server. Script view draws the
//        pages on a canvas it then saves, which needs the image from this
//        origin: storage on another host without CORS headers loads as
//        nothing there.
//@route  GET /api/grading/:id/answers/:answerId/images/:index (or /annotated)
//@access Private (staff on the submission's batch)
const IMAGE_TYPES = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };
const getAnswerImage = asyncHandler(async (req, res) => {
  const submission = await Submission.findById(req.params.id).select("batch answers._id answers.answerImages answers.annotatedImage");
  if (!submission) {
    res.status(404);
    throw new Error("Submission not found.");
  }
  const batchIds = await staffBatchIds(req.user);
  if (batchIds && !batchIds.some((id) => String(id) === String(submission.batch))) {
    res.status(403);
    throw new Error("You are not assigned to this batch.");
  }
  const answer = submission.answers.id(req.params.answerId);
  // "annotated" is the teacher's saved marked-up page.
  const url = req.params.index === "annotated" ? answer?.annotatedImage : answer?.answerImages?.[Number(req.params.index)];
  // Only a file this app stored itself, read from its own storage.
  const key = url && resolveOwnMediaKey(url);
  if (!key) {
    res.status(404);
    throw new Error("Image not found.");
  }
  let bytes;
  try {
    bytes = await storage.get(key, url.startsWith("/media/") ? "local" : undefined);
  } catch {
    res.status(404);
    throw new Error("Image not found.");
  }
  res.set("Content-Type", IMAGE_TYPES[key.split(".").pop().toLowerCase()] || "application/octet-stream");
  res.set("Cache-Control", "private, max-age=300");
  res.send(bytes);
});

const getForGrading = asyncHandler(async (req, res) => {
  const submission = await Submission.findById(req.params.id)
    .populate("student", "name email phoneNumber")
    .populate("batch", "name")
    .populate("answers.gradedByUser", "name identifier isDeleted isActive")
    .populate("referral.decidedBy", "name identifier isDeleted")
    .populate("disqualified.by", "name identifier isDeleted")
    .populate("disqualified.reinstatedBy", "name identifier isDeleted")
    .populate("claimedBy", "name identifier")
    .populate("heldBy", flow.USER_FIELDS)
    .populate("referral.routeTo", flow.USER_FIELDS)
    .populate("answers.regradeOf.by", flow.USER_FIELDS);

  if (!submission) {
    res.status(404);
    throw new Error("Submission not found.");
  }

  const batchIds = await staffBatchIds(req.user);
  // submission.batch is populated (line above, for the name in the
  // response) — comparing String(submission.batch) against a plain ObjectId
  // never matches, since that stringifies the whole populated document, not
  // its id. Every non-owner/admin (teacher, grader) was being told "you are
  // not assigned to this batch" even when correctly assigned, the moment
  // they opened a submission from a queue that filtered correctly (getQueue
  // never populates before its own check, so it never had this bug).
  if (batchIds && !batchIds.some((id) => String(id) === String(submission.batch._id))) {
    res.status(403);
    throw new Error("You are not assigned to this batch.");
  }

  // A blank written answer is 0, also on a script reopened before reopening
  // kept blanks at 0.
  const blankIds = submission.answers
    .filter((a) => a.questionType === "written" && (a.marksAwarded === null || a.marksAwarded === undefined)
      && !(typeof a.answerText === "string" && a.answerText.trim())
      && !(a.answerImages || []).some((u) => typeof u === "string" && u.trim()))
    .map((a) => a._id);
  if (blankIds.length) {
    await Submission.updateOne(
      { _id: submission._id },
      { $set: { "answers.$[a].marksAwarded": 0, "answers.$[a].gradedBy": "auto" } },
      { arrayFilters: [{ "a._id": { $in: blankIds } }] }
    );
    for (const a of submission.answers) if (blankIds.some((id) => String(id) === String(a._id))) { a.marksAwarded = 0; a.gradedBy = "auto"; }
  }

  const batchDoc = await Batch.findById(submission.batch._id).select("features teachers graders");
  // The admin-wide "Grade written answers" switch (AI settings) on top of
  // this batch's own aiAssist + examAiGrading.
  const aiConfig = await AiConfig.get();
  const aiGradingAvailable = Boolean(
    aiConfig.features.writtenGrading && batchDoc?.features?.aiAssist && batchDoc?.features?.examAiGrading
  );

  const exam = await Exam.findById(submission.exam).populate("questions");
  const questionMap = new Map(exam.questions.map((q) => [String(q._id), q]));
  // Answer photos uploaded with no camera data (utils/photo.js hasCameraData).
  const keyOf = new Map(submission.answers.flatMap((a) => a.answerImages || []).map((u) => [u, resolveOwnMediaKey(u)]));
  const noCameraKeys = new Set((await StudentUpload.find({
    key: { $in: [...keyOf.values()].filter(Boolean) }, student: submission.student?._id || submission.student, noCamera: true,
  }).select("key").lean()).map((u) => u.key));

  const claim = shapeClaim(submission);
  const g = await flow.gradingSettings();
  const holder = flow.holderOf(submission, batchDoc);
  const heldByOther = Boolean(holder) && String(holder._id) !== String(req.user._id) && !isPrivileged(req.user);
  const userName = (u) => (u ? u.identifierOrName?.() ?? u.name : null);

  res.status(200).json({
    _id: submission._id,
    exam: { _id: exam._id, title: exam.title },
    student: shapeStudentFor(req.user, submission.student),
    anonymous: req.user.role === "grader",
    batch: submission.batch,
    attempt: submission.attempt,
    status: submission.status,
    marks: submission.marks,
    totalMarks: submission.totalMarks,
    submittedAt: submission.submittedAt,
    gradedAt: submission.gradedAt,
    totalTimeMs: submission.totalTimeMs,
    // Flag-only exam integrity — see models/submissionModel.js. Sent as
    // the raw list (not just a count) so a grader can see the pattern
    // (three tab-switches in the last 2 minutes reads very differently
    // from three spread evenly across a 90-minute exam).
    startedAt: submission.startedAt,
    violations: submission.violations,
    // Ended early by the exam's away limit — see submissionModel.js.
    awayEnd: submission.awayEnd,
    conduct: await require("../../utils/conduct").examFlagSummary(submission, req.user),
    // Owner/admin's disqualify/reinstate decision — see submissionModel.js.
    // Sent whenever a decision exists at all (even after a reinstate), so
    // the panel can show the history, not just the live "is it disqualified
    // right now" state.
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
    aiGradingAvailable,
    // Whole-submission claim (see claimSubmission/releaseClaim below) —
    // separate from the per-answer regrade lock further down (lockedTo).
    claimedBy: claim,
    claimedByMe: Boolean(claim) && String(claim._id) === String(req.user._id),
    canGradeSubmission: isPrivileged(req.user) || ((!claim || String(claim._id) === String(req.user._id)) && !heldByOther),
    // Held for one grader (by-script pay, or assigned by an admin).
    heldBy: holder ? { _id: holder._id, name: userName(holder), assigned: submission.heldAssigned, since: submission.heldSince } : null,
    heldByOther,
    payMode: g.payMode,
    stuck: isPrivileged(req.user) && flow.isStuck(submission, g.stuckHours),
    stuckHours: g.stuckHours,
    lastProgress: flow.lastProgress(submission),
    answers: submission.answers.map((a) => {
      const target = flow.regradeTarget(submission, a, batchDoc);
      const lockedTo = target?._id || null;
      // Marked by someone else: theirs, unless an admin reopens it. A
      // teacher may still correct a mark the grading agent applied.
      const graded = a.marksAwarded !== null && a.marksAwarded !== undefined;
      const markedByOther = graded && !isPrivileged(req.user) && (
        a.gradedByUser ? String(a.gradedByUser._id || a.gradedByUser) !== String(req.user._id) : req.user.role === "grader"
      );
      return {
        _id: a._id,
        question: withStem(questionFor(a, questionMap.get(String(a.question)))),
        subIndex: a.subIndex ?? null,
        questionType: a.questionType,
        selectedOption: a.selectedOption,
        statementAnswers: a.statementAnswers,
        subAnswers: a.subAnswers,
        answerText: a.answerText,
        answerImages: a.answerImages,
        noCameraImages: (a.answerImages || []).filter((u) => noCameraKeys.has(keyOf.get(u))),
        annotatedImage: a.annotatedImage,
        marksAwarded: a.marksAwarded,
        gradedBy: a.gradedBy,
        gradedByUser: a.gradedByUser
          ? { _id: a.gradedByUser._id, name: a.gradedByUser.identifierOrName?.() ?? a.gradedByUser.name, isDeleted: a.gradedByUser.isDeleted }
          : null,
        aiMarks: a.aiMarks,
        aiReasoning: a.aiReasoning,
        aiConfidence: a.aiConfidence,
        aiFeedback: a.aiFeedback || null,
        notHandwritten: a.notHandwritten || null,
        handwritingAction: a.handwritingAction || null,
        teacherComment: a.teacherComment,
        adminNoteToTeacher: a.adminNoteToTeacher,
        isGraded: a.marksAwarded !== null && a.marksAwarded !== undefined,
        // Regrade routing (see regradeLockedTo). null everywhere outside an
        // active regrade — a plain grading pass is never locked to anyone.
        // Only populated when it's locked to someone other than the
        // viewer — a name to explain why their own marks field is
        // disabled, never a reason to show a lock badge on their own work.
        lockedTo: lockedTo && String(lockedTo) !== String(req.user._id)
          ? { _id: target._id, name: userName(target), until: submission.referral?.routeUntil || null }
          : null,
        regradeOf: a.regradeOf?.by ? { by: { _id: a.regradeOf.by._id, name: userName(a.regradeOf.by) }, at: a.regradeOf.at, marks: a.regradeOf.marks } : null,
        markedByOther,
        canGrade: isPrivileged(req.user) || ((!lockedTo || String(lockedTo) === String(req.user._id)) && !markedByOther && !heldByOther),
      };
    }),
    referral: submission.referral && submission.referral.requested
      ? {
          requested: true,
          reason: submission.referral.reason,
          questionIds: submission.referral.questionIds,
          requestedAt: submission.referral.requestedAt,
          decision: submission.referral.decision,
          decidedBy: submission.referral.decidedBy
            ? {
                _id: submission.referral.decidedBy._id,
                name: submission.referral.decidedBy.identifierOrName?.() ?? submission.referral.decidedBy.name,
                isDeleted: submission.referral.decidedBy.isDeleted,
              }
            : null,
          decidedAt: submission.referral.decidedAt,
          regradeNote: submission.referral.regradeNote,
          routeMode: submission.referral.routeMode || "original",
          routeTo: submission.referral.routeTo?._id ? { _id: submission.referral.routeTo._id, name: userName(submission.referral.routeTo) } : null,
          routeUntil: submission.referral.routeUntil,
        }
      : null,
  });
});

//@desc   Claim a submission for grading — first-pass claim, not the
//        per-answer regrade lock (regradeLockedTo/lockedTo above, which is
//        a separate, narrower thing). Atomic: the findOneAndUpdate's filter
//        is the whole check, so two graders hitting this at once can never
//        both win it.
//@route  POST /api/grading/:id/claim
//@access Private
const claimSubmission = asyncHandler(async (req, res) => {
  const batchIds = await staffBatchIds(req.user);
  const baseQuery = { _id: req.params.id };
  if (batchIds) baseQuery.batch = { $in: batchIds };

  // A script held for someone else (by-script pay, or assigned by an admin)
  // can only be opened to look at, not claimed.
  if (!isPrivileged(req.user)) {
    const held = await Submission.findOne(baseQuery).select("heldBy batch").populate("heldBy", flow.USER_FIELDS);
    if (held?.heldBy?._id && String(held.heldBy._id) !== String(req.user._id)) {
      const batchDoc = await Batch.findById(held.batch).select("teachers graders");
      const holder = flow.holderOf(held, batchDoc);
      if (holder) {
        res.status(409);
        throw new Error(`${holder.identifierOrName?.() ?? holder.name} is grading this script.`);
      }
    }
  }

  // Owner/admin can always (re)claim, including snatching an active claim —
  // they're the ones who'd get asked to sort out a stuck submission anyway.
  // Everyone else can claim when it's free, stale, or already theirs.
  const staleBefore = new Date(Date.now() - CLAIM_STALE_MS);
  const claimQuery = isPrivileged(req.user)
    ? baseQuery
    : {
        ...baseQuery,
        $or: [
          { claimedBy: null },
          { claimedAt: { $lt: staleBefore } },
          { claimedBy: req.user._id },
        ],
      };

  const submission = await Submission.findOneAndUpdate(
    claimQuery,
    { claimedBy: req.user._id, claimedAt: new Date() },
    { new: true }
  );

  if (submission) {
    res.status(200).json({
      claimedBy: { _id: req.user._id, name: req.user.identifierOrName?.() ?? req.user.name },
      claimedAt: submission.claimedAt,
    });
    return;
  }

  // Didn't win the claim — find out why, to give a useful error rather than
  // a bare 409/404.
  const existing = await Submission.findOne(baseQuery).populate("claimedBy", "name identifier");
  if (!existing) {
    res.status(404);
    throw new Error("Submission not found.");
  }
  const holder = existing.claimedBy;
  res.status(409);
  throw new Error(`Already claimed by ${holder?.identifierOrName?.() ?? holder?.name ?? "someone else"}.`);
});

//@desc   Give up a claim — either the current holder, or owner/admin
//        clearing a stuck one on someone else's behalf.
//@route  POST /api/grading/:id/release
//@access Private
const releaseClaim = asyncHandler(async (req, res) => {
  const query = isPrivileged(req.user)
    ? { _id: req.params.id }
    : { _id: req.params.id, claimedBy: req.user._id };

  const submission = await Submission.findOneAndUpdate(
    query,
    { claimedBy: null, claimedAt: null },
    { new: true }
  );

  if (!submission) {
    res.status(404);
    throw new Error("Submission not found, or you don't hold the claim on it.");
  }
  res.status(200).json({ message: "Released." });
});

//@desc   Mark one written answer within a submission
//@route  PUT /api/grading/:id/answers/:answerId
//@access Private
const gradeAnswer = asyncHandler(async (req, res) => {
  const { marks, comment } = req.body;

  const submission = await Submission.findById(req.params.id)
    .populate("heldBy", flow.USER_FIELDS)
    .populate("referral.routeTo", flow.USER_FIELDS)
    .populate("answers.regradeOf.by", flow.USER_FIELDS);
  if (!submission) {
    res.status(404);
    throw new Error("Submission not found.");
  }

  const batchIds = await staffBatchIds(req.user);
  if (batchIds && !batchIds.some((id) => String(id) === String(submission.batch))) {
    res.status(403);
    throw new Error("You are not assigned to this batch.");
  }

  const answer = submission.answers.id(req.params.answerId);
  if (!answer) {
    res.status(404);
    throw new Error("Answer not found on this submission.");
  }

  // Whole-submission claim (claimSubmission/releaseClaim above) — separate
  // from, and checked before, the per-answer regrade lock below. A stale
  // claim (CLAIM_STALE_MS) is abandoned, not held, so it never blocks a
  // save; a live claim held by someone else does.
  if (!isPrivileged(req.user)) {
    let heldByOther =
      submission.claimedBy &&
      String(submission.claimedBy) !== String(req.user._id) &&
      claimIsLive(submission.claimedAt);
    // A claim by someone deactivated or deleted since doesn't count.
    if (heldByOther && !(await User.exists({ _id: submission.claimedBy, isActive: { $ne: false }, isDeleted: { $ne: true } }))) heldByOther = false;
    if (heldByOther) {
      res.status(409);
      throw new Error("Someone else is currently grading this submission.");
    }
  }

  // Regrade routing — owner/admin bypass this the same way they bypass the
  // batch-assignment check above; a teacher or grader only gets to save
  // marks on a locked regrade if they're the one it's locked to (see
  // regradeLockedTo). A comment-only save (the mcq/mtf "note back to the
  // student" path) is never locked — there's no "first grader" to route it
  // to for an auto-scored answer, per point 1 of the spec.
  const g = await flow.gradingSettings();
  const batchDoc = await Batch.findById(submission.batch).select("teachers graders");
  const holder = flow.holderOf(submission, batchDoc);
  if (!isPrivileged(req.user) && holder && String(holder._id) !== String(req.user._id)) {
    res.status(409);
    throw new Error(`${holder.identifierOrName?.() ?? holder.name} is grading this script. An admin can reopen it.`);
  }
  if (marks !== undefined && marks !== null && !isPrivileged(req.user)) {
    const target = flow.regradeTarget(submission, answer, batchDoc);
    if (target && String(target._id) !== String(req.user._id)) {
      res.status(403);
      throw new Error(`This regrade is with ${target.identifierOrName?.() ?? target.name} for now. Ask an admin to reassign it if they're unavailable.`);
    }
    // An answer someone else marked is theirs. A teacher may still correct
    // a mark the grading agent applied.
    const graded = answer.marksAwarded !== null && answer.marksAwarded !== undefined;
    if (graded && (answer.gradedByUser ? String(answer.gradedByUser) !== String(req.user._id) : req.user.role === "grader")) {
      res.status(403);
      throw new Error("Someone else already marked this answer. Ask an admin if it needs changing.");
    }
  }

  const hasMarks = marks !== undefined && marks !== null;
  const hasComment = comment !== undefined;

  if (!hasMarks && !hasComment) {
    res.status(400);
    throw new Error("Nothing to save.");
  }

  // Marks can only ever be hand-set on a written answer — mcq/mtf are
  // auto-scored by design, and manually overriding an auto-score is a
  // bigger question (does it change how the exam is graded going
  // forward? does the total recompute the same way?) that hasn't been
  // decided yet. A comment-only update has no such question — it doesn't
  // touch marksAwarded or totals at all, which is exactly why a flagged
  // mcq/mtf answer can get a teacher's response here without needing that
  // decision made first.
  if (hasMarks) {
    if (answer.questionType !== "written") {
      res.status(400);
      throw new Error("Only written answers are graded by hand.");
    }
    if (typeof marks !== "number" || !Number.isFinite(marks) || marks < 0) {
      res.status(400);
      throw new Error("Enter a mark of zero or more.");
    }
    // Never more than the question (or, under a passage, that part) is worth.
    const question = await Question.findById(answer.question).select("type marks subQuestions");
    const outOf = Number(questionFor(answer, question)?.marks);
    if (Number.isFinite(outOf) && marks > outOf) {
      res.status(400);
      throw new Error(`This answer is out of ${outOf}. Enter ${outOf} or less.`);
    }
    answer.marksAwarded = marks;
    // The grading agent applying AI marks a person approved is AI grading,
    // not a teacher's own mark (agents/tools/grading.js).
    answer.gradedBy = req.agent ? "ai" : "teacher";
    // A regrade by the person who first marked it keeps their original
    // credit date; by anyone else, the credit moves to them.
    const original = answer.regradeOf?.by?._id || answer.regradeOf?.by;
    if (req.agent) {
      answer.gradedByUser = null;
      answer.gradedAt = new Date();
    } else if (!(original && String(original) === String(req.user._id) && answer.regradeOf?.at)) {
      answer.gradedByUser = req.user._id;
      answer.gradedAt = new Date();
    }
    if (!req.agent) {
      submission.progressAt = new Date();
      // By-script pay: the first person to mark a script holds it.
      if (g.payMode === "script" && !isPrivileged(req.user) && !holder) {
        submission.heldBy = req.user._id;
        submission.heldSince = new Date();
        submission.heldAssigned = false;
      }
    }
  }

  if (hasComment) {
    answer.teacherComment = comment;
  }

  // This specific answer has now been looked at — see regradeReviewed on
  // answerSchema. A no-op outside an active regrade (default is already
  // true), so it's always safe to set unconditionally.
  answer.regradeReviewed = true;

  // Captured before finalizeIfComplete can flip it — that's how a genuine
  // grading→graded transition is told apart from a submission that was
  // already graded before this call (see finalizeIfComplete's own note).
  const wasGraded = submission.status === "graded";
  // Once a referral is approved, referral.decision stays "approved" for
  // the rest of this submission's life (a student gets exactly one ever) —
  // so any completion that happens while it's set is by definition the
  // regrade finishing, not the original grading pass.
  const isRegrade = Boolean(submission.referral?.requested && submission.referral?.decision === "approved");
  const complete = submission.finalizeIfComplete();
  if (complete && hasMarks) {
    // Whole-script credit ("by script" pay): whoever finished it. A
    // regrade leaves it with the first finisher unless someone else did it.
    const by = req.agent ? null : req.user._id;
    if (!isRegrade && !wasGraded) submission.credit = { by, at: new Date() };
    else if (isRegrade && by && submission.credit?.by && String(submission.credit.by) !== String(by)) submission.credit = { by, at: new Date() };
    else if (isRegrade && by && !submission.credit?.by) submission.credit = { by, at: new Date() };
    submission.heldBy = null;
    submission.heldSince = null;
    submission.heldAssigned = false;
  }

  // finalizeIfComplete only tracks written marks — a flagged mcq/mtf answer
  // never has a mark to clear, so "complete" can go true while one of those
  // still hasn't been looked at. This checks every flagged answer, not just
  // the written ones, and regradeNotified makes it fire exactly once even
  // though "complete" (and this check) can keep evaluating true on every
  // later save, e.g. editing a note after the regrade is already done.
  let notifyRegradeComplete = false;
  if (isRegrade && complete && !submission.referral.regradeNotified) {
    const referredIds = submission.referral.questionIds.map(String);
    const fullyReviewed = submission.answers
      .filter((a) => referredIds.includes(String(a.question)))
      .every((a) => a.regradeReviewed !== false);
    if (fullyReviewed) {
      submission.referral.regradeNotified = true;
      notifyRegradeComplete = true;
    }
  }

  // Heartbeat: every successful save refreshes the claim, so an actively
  // working grader never gets bumped by their own staleness timeout
  // mid-session. Also silently claims an unclaimed submission on first
  // save, so there's no separate "claim" click required before grading —
  // the explicit claim endpoint exists for the frontend to reserve it up
  // front (and to show "X is grading this" to everyone else), not because
  // a save requires it.
  if (!isPrivileged(req.user)) {
    submission.claimedBy = req.user._id;
    submission.claimedAt = new Date();
  }

  await submission.save();

  // Same notification type/title as every other step of the referral flow
  // (decideReferral, saveReferralNote) — one recognizable "update on your
  // regrade request" line the student can pattern-match, rather than
  // reusing "Your exam has been graded" a second time, which would read
  // like a duplicate of the very first grading notification.
  if (notifyRegradeComplete) {
    await notify(submission.student, "examReview", {
      title: "Update on your regrade request",
      body: "Your regrade is complete — marks have been updated.",
      link: `/submissions/${submission._id}`,
    });
    // Marks just changed on a submission that already had a report from
    // before the regrade — regenerate so it reflects the updated marks,
    // same call as the first-time case below.
    await scheduleExamPerformanceReport(submission._id);
  } else if (!isRegrade && complete && !wasGraded) {
    const exam = await Exam.findById(submission.exam).select("title");
    await notify(submission.student, "examGraded", {
      title: "Your exam has been graded",
      body: exam?.title,
      link: `/submissions/${submission._id}`,
    });
    // Never blocks this response — see generateExamPerformanceReport's own
    // internal try/catch.
    await scheduleExamPerformanceReport(submission._id);
    // First grade only: a regrade doesn't send a second result message.
    sendResultMessage(submission._id);
  }

  res.status(200).json({
    message: !hasMarks
      ? "Note saved."
      : complete && !wasGraded
        ? "Graded. This submission is now fully scored."
        : complete
          ? "Saved."
          : "Saved. Other written answers here are still pending.",
    status: submission.status,
    marks: submission.marks,
  });
});

//@desc   Ask AI to suggest a grade for one written exam answer — a
//        starting point the teacher can accept or override via
//        gradeAnswer above, never applied as the final mark on its own.
//        Gated by the admin-wide "Grade written answers" switch
//        (AiConfig.features.writtenGrading) and by both aiAssist and
//        examAiGrading being on for this batch (see batchModel.js) — teacher-initiated, so this deliberately
//        passes student: null to the AI service, which (see
//        assertWithinCaps in ai/service.js) skips the student's own daily
//        allowance and credit checks entirely rather than spending a
//        student's personal AI budget on an action they didn't take.
//        batch is still passed through, so the cost is attributed there
//        for reporting.
//@route  POST /api/grading/:id/answers/:answerId/ai-grade
//@access Private (owner, admin, teacher)
const gradeWithAi = asyncHandler(async (req, res) => {
  const aiConfig = await AiConfig.get();
  if (!aiConfig.features.writtenGrading) {
    res.status(403);
    throw new Error("AI grading is switched off in AI settings.");
  }

  const submission = await Submission.findById(req.params.id);
  if (!submission) {
    res.status(404);
    throw new Error("Submission not found.");
  }

  const batchIds = await staffBatchIds(req.user);
  if (batchIds && !batchIds.some((id) => String(id) === String(submission.batch))) {
    res.status(403);
    throw new Error("You are not assigned to this batch.");
  }

  const batch = await Batch.findById(submission.batch).select("features");
  if (!batch?.features?.aiAssist || !batch?.features?.examAiGrading) {
    res.status(400);
    throw new Error("AI-assisted grading is not enabled for this batch.");
  }

  const answer = submission.answers.id(req.params.answerId);
  if (!answer) {
    res.status(404);
    throw new Error("Answer not found on this submission.");
  }
  if (answer.questionType !== "written") {
    res.status(400);
    throw new Error("Only written answers can be graded by AI.");
  }

  // A passage's written question is marked as that part (utils/passageParts.js).
  const question = questionFor(answer, await Question.findById(answer.question));
  if (!question?.rubric?.length) {
    res.status(400);
    throw new Error("This question has no rubric set up, so it can't be AI-graded.");
  }

  const hasImages = answer.answerImages?.length > 0;
  if (!answer.answerText?.trim() && !hasImages) {
    res.status(400);
    throw new Error("This answer is empty — nothing to grade.");
  }

  try {
    const prompt = gradeWrittenPrompt({
      question: questionText(question),
      rubric: question.rubric,
      modelAnswer: question.modelAnswer,
      studentAnswer: answer.answerText?.trim() || "(No typed answer — see the attached image.)",
      totalMarks: question.marks,
      images: hasImages ? answer.answerImages.length : 0,
    });

    // Every attached photo, sent as one page stacked in order (see
    // ai/service.js imageUrls).
    const imageUrls = hasImages ? answer.answerImages.map((u) => toAbsoluteUrl(req, u)) : undefined;

    const { data } = await aiService.generate({
      feature: "exam-grade-written",
      schema: gradedAnswerSchema,
      student: null,
      batch: submission.batch,
      imageUrls,
      ...prompt,
    });

    // Built from the rubric rows the model marked, not its bare total.
    answer.aiMarks = reconcileRubricMarks({ rubric: question.rubric, totalMarks: question.marks, data }).marks;
    // The teacher sees what was read from the photos too, to check the AI
    // read the work before trusting its mark.
    answer.aiReasoning = hasImages && data.transcript ? `${data.reasoning}\n\nRead from the photo:\n${data.transcript}` : data.reasoning;
    answer.aiConfidence = data.confidence;
    // The explanation of the mark for the student, sent as their note when
    // the mark is used (practice shows its feedback the same way). None if
    // it quotes the model answer.
    answer.aiFeedback = data.feedback && !containsModelAnswerLeak(data.feedback, question.modelAnswer) ? data.feedback : null;
    // Photos that aren't the student's handwriting (utils/handwriting.js).
    const mode = hasImages ? await handwritingMode("exam") : "off";
    const source = mode === "off" ? null : notHandwritten(data);
    answer.notHandwritten = source;
    answer.handwritingAction = source ? mode : null;
    if (source && mode === "zero") answer.aiMarks = 0;
    await submission.save();

    res.status(200).json({
      aiMarks: answer.aiMarks, aiReasoning: answer.aiReasoning, aiConfidence: answer.aiConfidence, aiFeedback: answer.aiFeedback,
      notHandwritten: answer.notHandwritten, handwritingAction: answer.handwritingAction,
    });
  } catch (error) {
    res.status(error instanceof AiCapReachedError ? 429 : 500);
    throw new Error(error.message || "Could not grade this with AI right now.");
  }
});

//@desc   Save a teacher's marked-up version of a written answer — the
//        script doodler's canvas (background + pen/shape/text
//        annotations) flattened into one image client-side and uploaded
//        here as a single file. Persistent, same as a physically
//        annotated paper script would be kept: replacing a previous
//        annotation overwrites it, there's no history of past markups.
//@route  POST /api/grading/:id/answers/:answerId/annotation
//@access Private (owner, admin, teacher)
const saveAnnotation = asyncHandler(async (req, res) => {
  const submission = await Submission.findById(req.params.id);
  if (!submission) {
    res.status(404);
    throw new Error("Submission not found.");
  }

  const batchIds = await staffBatchIds(req.user);
  if (batchIds && !batchIds.some((id) => String(id) === String(submission.batch))) {
    res.status(403);
    throw new Error("You are not assigned to this batch.");
  }

  const answer = submission.answers.id(req.params.answerId);
  if (!answer) {
    res.status(404);
    throw new Error("Answer not found on this submission.");
  }

  if (!req.file) {
    res.status(400);
    throw new Error("No file was received.");
  }

  const stored = await storage.store("annotated-scripts", req.file);
  const url = await storage.urlFor(stored.key, stored.driver);

  answer.annotatedImage = url;
  await submission.save();

   res.status(200).json({ url });
});

// ---------------------------------------------------------------- referrals

// Pending referral requests — admin-only. A teacher sees their own work through
// the grading queue (same as always); this is the "decide whether to send it
// back" list, the admin's triage step before anything reaches a teacher again.
const getPendingReferrals = asyncHandler(async (req, res) => {
  // view: pending (waiting for a decision), regrading (approved, not
  // finished yet) or done (approved and finished, or rejected).
  const view = req.query.view || "pending";
  const VIEWS = {
    pending: { "referral.decision": null },
    regrading: { "referral.decision": "approved", status: "grading" },
    done: { $or: [{ "referral.decision": "rejected" }, { "referral.decision": "approved", status: { $ne: "grading" } }] },
  };
  const query = { "referral.requested": true };

  const batchIds = await staffBatchIds(req.user);
  if (batchIds) query.batch = { $in: batchIds };
  if (req.query.batch && mongoose.isValidObjectId(req.query.batch)) query.batch = req.query.batch;
  if (req.query.q && String(req.query.q).trim()) {
    const rx = new RegExp(escapeRegex(String(req.query.q).trim()), "i");
    const ids = await Student.find({ $or: [{ name: rx }, { email: rx }, { phoneNumber: rx }, { studentId: rx }] }).select("_id").limit(1000).lean();
    query.student = { $in: ids.map((x) => x._id) };
  }
  // Counts per view under the same filters, for the strip on the page.
  const counts = req.query.counts === "true"
    ? Object.fromEntries(await Promise.all(Object.entries(VIEWS).map(async ([key, extra]) => [key, await Submission.countDocuments({ ...query, ...extra })])))
    : undefined;
  Object.assign(query, VIEWS[view] || VIEWS.pending);

  const page = Number(req.query.page) || 1;
  const limit = Math.min(Number(req.query.limit) || 30, 100);

  const [submissions, total] = await Promise.all([
    Submission.find(query)
      .populate("exam", "title")
      .populate("student", "name email phoneNumber studentId")
      .populate("batch", "name")
      .populate("referral.routeTo", "name identifier")
      .select("exam student batch attempt referral submittedAt status")
      .sort({ "referral.requestedAt": 1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Submission.countDocuments(query),
  ]);

  // The flagged questions by their text, so the list says which ones.
  const flaggedIds = [...new Set(submissions.flatMap((s) => (s.referral?.questionIds || []).map(String)))];
  const flaggedText = new Map((await Question.find({ _id: { $in: flaggedIds } }).select("question type").lean())
    .map((q) => [String(q._id), { _id: q._id, type: q.type, text: String(q.question || "").replace(/\s+/g, " ").trim().slice(0, 140) }]));

  res.status(200).json({
    submissions: submissions.map((s) => ({
      _id: s._id,
      exam: s.exam,
      student: s.student,
      batch: s.batch,
      attempt: s.attempt,
      submittedAt: s.submittedAt,
      status: s.status,
      referral: s.referral,
      flagged: (s.referral?.questionIds || []).map((qid) => flaggedText.get(String(qid))).filter(Boolean),
    })),
    total,
    page,
    pages: Math.ceil(total / limit),
    counts,
  });
});

// Approve or reject a referral request. Approving sends the submission back
// to "grading" so the original teacher can recheck — the answers in the
// referral's questionIds keep their existing marksAwarded but are now
// "pending" via the pendingWrittenAnswers override. Rejecting leaves the
// existing grade as final. Either way, the student is notified.
const decideReferral = asyncHandler(async (req, res) => {
  const { approve, comment, route } = req.body;

  if (typeof approve !== "boolean") {
    res.status(400);
    throw new Error("Say whether this referral is approved or rejected.");
  }

  const submission = await Submission.findById(req.params.id);
  if (!submission) {
    res.status(404);
    throw new Error("Submission not found.");
  }

  const batchIds = await staffBatchIds(req.user);
  if (batchIds && !batchIds.some((id) => String(id) === String(submission.batch))) {
    res.status(403);
    throw new Error("You do not have access to this batch.");
  }

  if (!submission.referral?.requested || submission.referral?.decision) {
    res.status(400);
    throw new Error("There is no pending referral request on this submission.");
  }

  submission.referral.decision = approve ? "approved" : "rejected";
  submission.referral.decidedBy = req.user._id;
  submission.referral.decidedAt = new Date();

  if (approve) {
    // Re-open only the referred answers, and only actually clear a mark on
    // the written ones — mcq/mtf stay auto-scored no matter what (marks
    // there are never hand-set, see gradeAnswer above and FlaggedOtherCard
    // in Grading.jsx, which only ever offers a note, not a mark, for those).
    // Nulling an mcq/mtf's marksAwarded here used to silently zero it out
    // once finalizeIfComplete summed the total, since pendingWrittenAnswers
    // only tracks written types and never noticed that mark had vanished.
    const referredIds = submission.referral.questionIds.map(String);
    for (const answer of submission.answers) {
      if (referredIds.includes(String(answer.question))) {
        // Private guidance for the teacher re-checking this answer — not
        // the student-facing teacherComment. See adminNoteToTeacher on
        // answerSchema (submissionModel.js).
        answer.adminNoteToTeacher = comment || answer.adminNoteToTeacher;
        // Every flagged answer needs a fresh look, whether or not its mark
        // can actually change — see regradeReviewed on answerSchema.
        answer.regradeReviewed = false;
        if (answer.questionType !== "written") continue;
        // The first marker keeps their credit (gradedByUser/gradedAt) unless
        // someone else ends up doing the regrade (gradeAnswer).
        answer.regradeOf = { by: answer.gradedByUser || null, at: answer.gradedAt || null, marks: answer.marksAwarded ?? null };
        answer.marksAwarded = null;
        answer.gradedBy = null;
      }
    }

    // Where the regrade goes: each answer back to whoever marked it first
    // (default), one chosen grader, or anyone on the batch. Reserved for
    // Settings → Grading's regrade hours, then open to anyone.
    const g = await flow.gradingSettings();
    const until = new Date(Date.now() + g.regradeHours * 3600 * 1000);
    if (route && route !== "original" && route !== "pool") {
      const batchDoc = await Batch.findById(submission.batch).select("teachers graders");
      if (!mongoose.isValidObjectId(route) || !(await flow.assertAssignable(route, batchDoc))) {
        res.status(400);
        throw new Error("Pick someone active and assigned to this batch.");
      }
      submission.referral.routeMode = "grader";
      submission.referral.routeTo = route;
      submission.referral.routeUntil = until;
    } else {
      submission.referral.routeMode = route === "pool" ? "pool" : "original";
      submission.referral.routeTo = null;
      submission.referral.routeUntil = route === "pool" ? null : until;
    }
    submission.heldBy = null;
    submission.heldSince = null;
    submission.heldAssigned = false;
    submission.claimedBy = null;
    submission.claimedAt = null;

    submission.status = "grading";
    submission.referral.regradeNotified = false;
  }

  await submission.save();

  // Same title at every step of this flow (see gradeAnswer's regrade
  // branch and saveReferralNote below) — one consistent line the student
  // recognizes as "about my regrade request", the specifics in the body.
  await notify(submission.student, "examReview", {
    title: "Update on your regrade request",
    body: approve
      ? "Your referred exam is being re-checked."
      : "Your review request was not approved.",
    link: `/submissions/${submission._id}`,
  });

  res.status(200).json({
    submission: {
      _id: submission._id,
      status: submission.status,
      referral: submission.referral,
    },
  });
});

// Disqualify a submission — owner/admin only, reversible via reinstate below.
// Deliberately doesn't touch marks/answers/status history beyond recording
// what it was: this sits alongside grading as a separate status, the same
// "flag it, let a person decide what it means" spirit as violations (see
// submissionModel.js), just with a person's decision recorded instead of an
// automatic log entry.
const disqualifySubmission = asyncHandler(async (req, res) => {
  const { reason } = req.body;

  if (typeof reason !== "string" || !reason.trim()) {
    res.status(400);
    throw new Error("A reason is required to disqualify a submission.");
  }

  const submission = await Submission.findById(req.params.id);
  if (!submission) {
    res.status(404);
    throw new Error("Submission not found.");
  }

  const batchIds = await staffBatchIds(req.user);
  if (batchIds && !batchIds.some((id) => String(id) === String(submission.batch))) {
    res.status(403);
    throw new Error("You do not have access to this batch.");
  }

  if (submission.status === "disqualified") {
    res.status(400);
    throw new Error("This submission is already disqualified.");
  }

  submission.disqualified = {
    reason: reason.trim(),
    by: req.user._id,
    at: new Date(),
    previousStatus: submission.status,
    reinstatedBy: null,
    reinstatedAt: null,
  };
  submission.status = "disqualified";

  await submission.save();
  await require("../../utils/conduct").recordDisqualified(submission, req.user, reason.trim()).catch(() => {});

  await notify(submission.student, "examDisqualified", {
    title: "Your exam attempt was disqualified",
    body: reason.trim(),
    link: `/submissions/${submission._id}`,
  });

  res.status(200).json({
    submission: { _id: submission._id, status: submission.status, disqualified: submission.disqualified },
  });
});

// Undo a disqualification — restores whatever status this submission held
// the moment before (usually "graded" or "grading"), so nothing about the
// underlying marks needs recomputing. The disqualified sub-doc itself is
// kept, not cleared, as the record of what happened; reinstatedBy/At are
// just added onto it.
const reinstateSubmission = asyncHandler(async (req, res) => {
  const submission = await Submission.findById(req.params.id);
  if (!submission) {
    res.status(404);
    throw new Error("Submission not found.");
  }

  const batchIds = await staffBatchIds(req.user);
  if (batchIds && !batchIds.some((id) => String(id) === String(submission.batch))) {
    res.status(403);
    throw new Error("You do not have access to this batch.");
  }

  if (submission.status !== "disqualified") {
    res.status(400);
    throw new Error("This submission is not disqualified.");
  }

  submission.status = submission.disqualified?.previousStatus || "graded";
  submission.disqualified.reinstatedBy = req.user._id;
  submission.disqualified.reinstatedAt = new Date();

  await submission.save();
  await require("../../utils/conduct").recordReinstated(submission, req.user).catch(() => {});

  await notify(submission.student, "examDisqualified", {
    title: "Your exam attempt was reinstated",
    body: "The disqualification on this attempt was reversed — it's back to counting normally.",
    link: `/submissions/${submission._id}`,
  });

  res.status(200).json({
    submission: { _id: submission._id, status: submission.status, disqualified: submission.disqualified },
  });
});

// Save the note that the teacher wants the student to see after an approved
// referral has been re-graded. The note is stored on the referral itself so it
// travels with the review decision instead of being tied to one answer.
const saveReferralNote = asyncHandler(async (req, res) => {
  const { note } = req.body;

  if (typeof note !== "string" || note.trim().length > 2000) {
    res.status(400);
    throw new Error("Enter a re-grader note of 2,000 characters or fewer.");
  }

  const submission = await Submission.findById(req.params.id);
  if (!submission) {
    res.status(404);
    throw new Error("Submission not found.");
  }

  const batchIds = await staffBatchIds(req.user);
  if (batchIds && !batchIds.some((id) => String(id) === String(submission.batch))) {
    res.status(403);
    throw new Error("You do not have access to this batch.");
  }

  if (!submission.referral?.requested || submission.referral.decision !== "approved") {
    res.status(400);
    throw new Error("This referral has not been approved for re-grading.");
  }

  submission.referral.regradeNote = note.trim() || null;
  await submission.save();

  // Previously silent — nothing told the student a note was added, so they'd
  // only ever see it by reopening the result page on their own. Same
  // notification line as the rest of this flow (decideReferral, gradeAnswer's
  // regrade branch); only sent when there's actually a note now, not when
  // one is cleared back to empty.
  if (submission.referral.regradeNote) {
    await notify(submission.student, "examReview", {
      title: "Update on your regrade request",
      body: "The teacher added a note to your regrade.",
      link: `/submissions/${submission._id}`,
    });
  }

  res.status(200).json({ referral: submission.referral });
});

// ---------------------------------------------------------------- reassign

//@desc   Owner/admin hands a locked regrade to someone else — the original
//        grader left, was removed from the batch, or is just unavailable
//        (point 2 of the spec). Setting gradedByUser to a new eligible
//        staff member re-locks the regrade to them (regradeLockedTo reads
//        this same field); passing no graderId opens it back up to anyone
//        assigned to the batch, same as an answer that never had a first
//        grader. Refuses outside an open regrade on a referred written
//        answer — gradedByUser elsewhere is a real "who marked this"
//        history record, and reassigning it there would misattribute a
//        grading pass that already genuinely happened.
//@route  PUT /api/grading/:id/answers/:answerId/reassign
//@access Private (owner, admin)
const reassignAnswer = asyncHandler(async (req, res) => {
  const { graderId } = req.body;

  const submission = await Submission.findById(req.params.id);
  if (!submission) {
    res.status(404);
    throw new Error("Submission not found.");
  }

  const answer = submission.answers.id(req.params.answerId);
  if (!answer) {
    res.status(404);
    throw new Error("Answer not found on this submission.");
  }

  const isRegrade = Boolean(submission.referral?.requested && submission.referral?.decision === "approved");
  const referredIds = new Set((submission.referral?.questionIds || []).map(String));
  if (!isRegrade || answer.questionType !== "written" || !referredIds.has(String(answer.question))) {
    res.status(400);
    throw new Error("This answer isn't part of an open regrade.");
  }

  const batch = await Batch.findById(submission.batch).select("teachers graders");
  if (graderId) {
    if (!mongoose.isValidObjectId(graderId) || !(await flow.assertAssignable(graderId, batch))) {
      res.status(400);
      throw new Error("Pick someone active and assigned to this batch.");
    }
  }
  // The whole regrade moves: to one person for Settings → Grading's
  // regrade hours, or to anyone on the batch now. Credit isn't touched
  // here; it moves only if someone other than the first marker re-marks.
  const g = await flow.gradingSettings();
  submission.referral.routeMode = graderId ? "grader" : "pool";
  submission.referral.routeTo = graderId || null;
  submission.referral.routeUntil = graderId ? new Date(Date.now() + g.regradeHours * 3600 * 1000) : null;
  answer.regradeReviewed = false;

  await submission.save();
  res.status(200).json({
    message: graderId ? "Reassigned." : "Opened up to anyone on the batch.",
    routeTo: submission.referral.routeTo,
    routeUntil: submission.referral.routeUntil,
  });
});

// ------------------------------------------------------------------ reopen

//@desc   Throw away a script's marking so far and put it back: to anyone on
//        the batch, or held for one grader. AI suggestions stay. For a
//        part-marked script that's stuck, or one the grading agent wasn't
//        sure about. During a regrade only the referred answers reopen.
//@route  POST /api/grading/:id/reopen  { graderId? }
//@access Private (owner, admin)
const reopenSubmission = asyncHandler(async (req, res) => {
  if (!isPrivileged(req.user)) { res.status(403); throw new Error("Only an owner or admin can reopen a script."); }
  const submission = await Submission.findById(req.params.id);
  if (!submission) { res.status(404); throw new Error("Submission not found."); }
  const batchIds = await staffBatchIds(req.user);
  if (batchIds && !batchIds.some((id) => String(id) === String(submission.batch))) { res.status(403); throw new Error("You do not have access to this batch."); }
  if (submission.status !== "grading") { res.status(400); throw new Error("Only a script still being marked can be reopened."); }
  const { graderId } = req.body || {};
  if (graderId) {
    const batchDoc = await Batch.findById(submission.batch).select("teachers graders");
    if (!mongoose.isValidObjectId(graderId) || !(await flow.assertAssignable(graderId, batchDoc))) {
      res.status(400);
      throw new Error("Pick someone active and assigned to this batch.");
    }
  }
  const cleared = flow.reopenScript(submission, { graderId: graderId || null });
  if (flow.isRegrade(submission) && graderId) {
    const g = await flow.gradingSettings();
    submission.referral.routeUntil = new Date(Date.now() + g.regradeHours * 3600 * 1000);
  }
  submission.markModified("answers");
  await submission.save();
  res.json({ message: `${cleared ? `Cleared ${cleared} mark${cleared === 1 ? "" : "s"}. ` : ""}${graderId ? "Assigned." : "Open to anyone on the batch."}`, cleared });
});

//@desc   Who a script can be handed to: active teachers and graders on its batch
//@route  GET /api/grading/:id/staff
//@access Private (owner, admin)
const getSubmissionStaff = asyncHandler(async (req, res) => {
  const submission = await Submission.findById(req.params.id).select("batch");
  if (!submission) { res.status(404); throw new Error("Submission not found."); }
  const batch = await Batch.findById(submission.batch).select("teachers graders");
  const ids = [...(batch?.teachers || []), ...(batch?.graders || [])];
  const staff = await User.find({ _id: { $in: ids }, isActive: { $ne: false }, isDeleted: { $ne: true } }).select("name identifier role").sort({ name: 1 }).lean();
  res.json(staff.map((u) => ({ _id: u._id, name: u.identifier || u.name, role: u.role })));
});

// ------------------------------------------------------------------ stats

// Pay counts (Settings → Grading). Answers: every written answer this person
// marked, dated by when. A regrade by the first marker keeps the first
// date; by someone else, the answer counts for them instead. Scripts:
// scripts this person finished (Submission.credit).
const countGradedAnswers = async (userId, from, to) => {
  const match = { "answers.gradedByUser": new mongoose.Types.ObjectId(String(userId)) };
  if (from || to) {
    match["answers.gradedAt"] = {};
    if (from) match["answers.gradedAt"].$gte = new Date(from);
    if (to) match["answers.gradedAt"].$lte = endOfDay(to);
  }
  const [result] = await Submission.aggregate([
    { $unwind: "$answers" },
    { $match: match },
    { $count: "count" },
  ]);
  return result?.count || 0;
};

const countFinishedScripts = (userId, from, to) => {
  const q = { "credit.by": userId };
  if (from || to) {
    q["credit.at"] = {};
    if (from) q["credit.at"].$gte = new Date(from);
    if (to) q["credit.at"].$lte = endOfDay(to);
  }
  return Submission.countDocuments(q);
};

// "To" is a date: the whole of that day counts.
const endOfDay = (to) => {
  const d = new Date(to);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(to))) d.setUTCHours(23, 59, 59, 999);
  return d;
};

const payStats = async (userId, from, to) => {
  const g = await flow.gradingSettings();
  const [answers, scripts] = await Promise.all([countGradedAnswers(userId, from, to), countFinishedScripts(userId, from, to)]);
  const count = g.payMode === "script" ? scripts : answers;
  const rate = g.payMode === "script" ? g.ratePerScript : g.ratePerQuestion;
  return { count, answers, scripts, payMode: g.payMode, rate, amount: rate ? Math.round(count * rate * 100) / 100 : null, from: from || null, to: to || null };
};

//@desc   This account's graded answers and finished scripts in a date
//        range, and the pay they come to (Settings → Grading)
//@route  GET /api/grading/stats/me?from=&to=
//@access Private (owner, admin, teacher, grader)
const getMyGradingStats = asyncHandler(async (req, res) => {
  res.status(200).json(await payStats(req.user._id, req.query.from, req.query.to));
});

//@desc   For the pay picker: every active teacher and grader (a count of
//        zero is an answer too), plus anyone else who has graded an answer
//        or finished a script — owners and admins included if they marked any.
//@route  GET /api/grading/graders
//@access Private (owner, admin)
const listGraders = asyncHandler(async (req, res) => {
  const [a, b] = await Promise.all([
    Submission.distinct("answers.gradedByUser", { "answers.gradedByUser": { $ne: null } }),
    Submission.distinct("credit.by", { "credit.by": { $ne: null } }),
  ]);
  const graders = await User.find({ $or: [
    { _id: { $in: [...a, ...b] } },
    { role: { $in: ["teacher", "grader"] }, isActive: { $ne: false }, isDeleted: { $ne: true } },
  ] })
    .select("name identifier email isActive isDeleted role")
    .sort({ name: 1 });
  res.status(200).json(graders);
});

//@desc   One teacher's or grader's pay counts for a date range
//@route  GET /api/grading/graders/:id/stats?from=&to=
//@access Private (owner, admin)
const getGraderStats = asyncHandler(async (req, res) => {
  const staff = await User.findById(req.params.id).select("name identifier");
  if (!staff) {
    res.status(404);
    throw new Error("Account not found.");
  }
  res.status(200).json({ grader: { _id: staff._id, name: staff.identifierOrName() }, ...(await payStats(staff._id, req.query.from, req.query.to)) });
});

module.exports = {
  getAnswerImage,
  getQueue, getForGrading, gradeAnswer, gradeWithAi, saveAnnotation,
  claimSubmission, releaseClaim,
  getPendingReferrals, decideReferral, saveReferralNote, reassignAnswer,
  disqualifySubmission, reinstateSubmission,
  getMyGradingStats, listGraders, getGraderStats, payStats,
  reopenSubmission, getSubmissionStaff, payStats,
  // Exported for tests/gradingClaim.js — pure boundary logic, no DB needed.
  claimIsLive, CLAIM_STALE_MS,
};