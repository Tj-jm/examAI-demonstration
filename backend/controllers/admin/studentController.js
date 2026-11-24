const asyncHandler = require("express-async-handler");
const { cleanGuardian } = require("../../utils/guardian");
const mongoose = require("mongoose");
const Student = require("../../models/studentModel");
const Batch = require("../../models/batchModel");
const Purchase = require("../../models/purchaseModel");
const Trial = require("../../models/trialModel");
const Submission = require("../../models/submissionModel");
const AppSettings = require("../../models/appSettingsModel");
const AiCredit = require("../../models/aiCreditModel");
const AiUsage = require("../../models/aiUsageModel");
const Doubt = require("../../models/doubtModel");
const StudyPlan = require("../../models/studyPlanModel");
const PracticeAttempt = require("../../models/practiceAttemptModel");
const PracticeExamRecord = require("../../models/practiceExamRecordModel");
const PracticeFavorite = require("../../models/practiceFavoriteModel");
const LectureProgress = require("../../models/lectureProgressModel");
const Notification = require("../../models/notificationModel");
const StudentUpload = require("../../models/studentUploadModel");
const Exam = require("../../models/examModel");
const { resolveExpiry } = require("../../utils/accessWindow");
const { staffBatchIds } = require("../../utils/staffBatchIds");

// Enrolment and payment are separate here. The original could only create a
// student together with a purchase, so a teacher granting free access to a
// scholarship student had to fabricate a transaction.

const shape = (student) => ({
  _id: student._id,
  name: student.name,
  email: student.email,
  phoneNumber: student.phoneNumber,
  studentId: student.studentId || null,
  guardian: student.guardian ? { name: student.guardian.name || "", relation: student.guardian.relation || "", phone: student.guardian.phone || "", email: student.guardian.email || "", optOut: Boolean(student.guardian.optOut) } : null,
  isProfileComplete: student.isProfileComplete,
  isActive: student.isActive,
  createdAt: student.createdAt,
  // Erased at the student's own request (utils/accountDeletion.js).
  deletedAt: student.deletedAt || null,
});

//@desc   List students
//@route  GET /api/students
//@access Private
const getStudents = asyncHandler(async (req, res) => {
  const { search, batch, status } = req.query;
  const page = Number(req.query.page) || 1;
  const limit = Math.min(Number(req.query.limit) || 30, 100);

  const query = {};

  if (search) {
    query.$or = [
      { name: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
      { phoneNumber: { $regex: search, $options: "i" } },
      { studentId: { $regex: search, $options: "i" } },
    ];
  }

  if (status === "complete") query.isProfileComplete = true;
  if (status === "incomplete") query.isProfileComplete = false;
  if (status === "inactive") {
    query.isActive = false;
    query.deletedAt = null;
  }
  if (status === "deleted") query.deletedAt = { $ne: null };

  // Filtering by batch means filtering by who currently has access to it,
  // which lives on purchases and trials rather than on the student.
  if (batch) {
    const now = new Date();
    const [purchases, trials] = await Promise.all([
      Purchase.find({ batch, status: "complete", endDate: { $gte: now } }).distinct("student"),
      Trial.find({ batch, endDate: { $gte: now } }).distinct("student"),
    ]);
    query._id = { $in: [...purchases, ...trials] };
  }

  // This list had no batch scoping at all — a teacher or grader searching
  // for a student (e.g. the Submissions page's student picker) could find
  // and pick ANY student on the platform, not just one in a batch they're
  // assigned to. Picking one outside their batches then silently produced
  // an empty/403 result downstream (submissions are correctly scoped), which
  // is what made the search feel broken. Restrict to students who have ever
  // had a purchase, trial, or submission tied to one of this staff member's
  // batches — union of all three, not just active access, so a student they
  // legitimately handled before (e.g. an expired trial) still turns up.
  const staffScope = await staffBatchIds(req.user);
  if (staffScope) {
    const allowed = new Set(staffScope.map(String));
    if (batch && !allowed.has(String(batch))) {
      res.status(200).json({ students: [], total: 0, page, pages: 1 });
      return;
    }
    const scopeBatchIds = batch ? [batch] : staffScope;
    const [scopedPurchases, scopedTrials, scopedSubmissions] = await Promise.all([
      Purchase.find({ batch: { $in: scopeBatchIds } }).distinct("student"),
      Trial.find({ batch: { $in: scopeBatchIds } }).distinct("student"),
      Submission.find({ batch: { $in: scopeBatchIds } }).distinct("student"),
    ]);
    const scopedIds = new Set(
      [...scopedPurchases, ...scopedTrials, ...scopedSubmissions].map(String)
    );
    query._id = query._id
      ? { $in: query._id.$in.filter((id) => scopedIds.has(String(id))) }
      : { $in: [...scopedIds] };
  }

  const [students, total] = await Promise.all([
    Student.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Student.countDocuments(query),
  ]);

  res.status(200).json({
    students: students.map(shape),
    total,
    page,
    pages: Math.ceil(total / limit),
  });
});

//@desc   One student with their access and results
//@route  GET /api/students/:id
//@access Private
const getStudent = asyncHandler(async (req, res) => {
  const student = await Student.findById(req.params.id);

  if (!student) {
    res.status(404);
    throw new Error("Student not found.");
  }

  const now = new Date();

  const [purchases, trials, submissions, aiCredits, aiUsageRecent, aiUsageSummaryAgg] = await Promise.all([
    Purchase.find({ student: student._id })
      .populate("batch", "name")
      .sort({ startDate: 1 }),
    Trial.find({ student: student._id }).populate("batch", "name"),
    Submission.find({ student: student._id, status: "graded" })
      .populate("exam", "title")
      .sort({ submittedAt: -1 })
      .limit(20),
    // One student's own AI credit balances — general and per-batch. The
    // global spend dashboard (aiController.js's getUsage) only shows a
    // top-200-by-call-count leaderboard, which is fine for "who's using
    // this a lot" but useless for "what has THIS student actually used,"
    // which is what a support conversation about one student needs.
    AiCredit.find({ student: student._id }).populate("batch", "name"),
    // Most recent calls, for a quick "what just happened" list — capped
    // the same way submissions above is, this is a support view, not a
    // paginated report.
    AiUsage.find({ student: student._id }).sort({ createdAt: -1 }).limit(50),
    // Totals across this student's entire history, not just the capped
    // recent list above, so the summary numbers don't quietly undercount
    // once a student has made more than 50 calls ever.
    AiUsage.aggregate([
      { $match: { student: student._id } },
      {
        $group: {
          _id: null,
          calls: { $sum: 1 },
          cost: { $sum: "$estimatedCostUsd" },
          creditsSpent: { $sum: "$creditsSpent" },
          failures: { $sum: { $cond: ["$ok", 0, 1] } },
        },
      },
    ]),
  ]);

  const aiUsageSummary = aiUsageSummaryAgg[0]
    ? {
        calls: aiUsageSummaryAgg[0].calls,
        cost: aiUsageSummaryAgg[0].cost,
        creditsSpent: aiUsageSummaryAgg[0].creditsSpent,
        failures: aiUsageSummaryAgg[0].failures,
      }
    : { calls: 0, cost: 0, creditsSpent: 0, failures: 0 };

  // Same scoping as the list: a teacher/grader can only open a student who
  // has a purchase, trial, or submission tied to one of their batches —
  // otherwise this page leaked the full cross-batch history (every payment,
  // every result) of a student they have nothing to do with. Checked with a
  // fresh, unlimited query rather than the "graded, last 20" list above,
  // which could miss an ungraded submission that's the only real link.
  const staffScope = await staffBatchIds(req.user);
  if (staffScope) {
    const allowed = new Set(staffScope.map(String));
    const hasScopedPurchase = purchases.some((p) => p.batch && allowed.has(String(p.batch._id)));
    const hasScopedTrial = trials.some((t) => t.batch && allowed.has(String(t.batch._id)));
    const hasScopedSubmission = hasScopedPurchase || hasScopedTrial
      ? true
      : Boolean(await Submission.exists({ student: student._id, batch: { $in: staffScope } }));
    if (!hasScopedPurchase && !hasScopedTrial && !hasScopedSubmission) {
      res.status(403);
      throw new Error("You are not assigned to this student's batch.");
    }
  }

  // Access is computed per batch from stacked purchases, the same way the
  // student-facing middleware does it.
  const byBatch = purchases.reduce((acc, p) => {
    if (p.status !== "complete") return acc;
    const key = String(p.batch ? p.batch._id : p.batch);
    (acc[key] = acc[key] || []).push(p);
    return acc;
  }, {});

  const access = Object.entries(byBatch).map(([batchId, list]) => {
    const expiry = resolveExpiry(list);
    const batch = list[0].batch;
    return {
      batch: batch ? { _id: batch._id, name: batch.name } : batchId,
      via: "purchase",
      expiresAt: expiry,
      isActive: Boolean(expiry && expiry >= now),
    };
  });

  for (const trial of trials) {
    const already = access.find(
      (a) => a.batch && String(a.batch._id) === String(trial.batch._id)
    );
    if (already && already.isActive) continue;

    access.push({
      batch: { _id: trial.batch._id, name: trial.batch.name },
      via: "trial",
      expiresAt: trial.endDate,
      isActive: trial.endDate >= now,
    });
  }

  res.status(200).json({
    student: shape(student),
    access,
    purchases,
    submissions,
    aiCredits,
    aiUsageRecent,
    aiUsageSummary,
  });
});

//@desc   Create a student account
//@route  POST /api/students
//@access Private
const createStudent = asyncHandler(async (req, res) => {
  const { name, email, phoneNumber, password } = req.body;
  const studentId = String(req.body.studentId || "").trim().toUpperCase() || undefined;

  if (!name || !password) {
    res.status(400);
    throw new Error("A name and password are required.");
  }

  if (!email && !phoneNumber && !studentId) {
    res.status(400);
    throw new Error("An email, phone number or student ID is required.");
  }

  const clash = await Student.findOne({
    $or: [
      ...(email ? [{ email: String(email).toLowerCase() }] : []),
      ...(phoneNumber ? [{ phoneNumber }] : []),
      ...(studentId ? [{ studentId }] : []),
    ],
  });

  if (clash) {
    res.status(409);
    throw new Error("A student with that email, phone number or student ID already exists.");
  }

  const student = await Student.create({
    name,
    email,
    phoneNumber,
    studentId,
    password,
    isProfileComplete: true,
    isOtpVerified: true,
  });

  res.status(201).json(shape(student));
});

//@desc   Update a student
//@route  PUT /api/students/:id
//@access Private
const updateStudent = asyncHandler(async (req, res) => {
  const student = await Student.findById(req.params.id);

  if (!student) {
    res.status(404);
    throw new Error("Student not found.");
  }

  const allowed = ["name", "email", "phoneNumber", "studentId", "isActive"];
  if (req.body.studentId !== undefined) {
    const id = String(req.body.studentId || "").trim().toUpperCase();
    if (id && (await Student.exists({ studentId: id, _id: { $ne: student._id } }))) {
      res.status(409);
      throw new Error("Another student already has that student ID.");
    }
    req.body.studentId = id || undefined;
  }
  for (const key of allowed) {
    if (req.body[key] !== undefined) student[key] = req.body[key];
  }
  if (req.body.guardian !== undefined) {
    const { guardian, error } = cleanGuardian(req.body.guardian, student.guardian?.toObject?.() || {}, await AppSettings.get());
    if (error) { res.status(400); throw new Error(error); }
    student.guardian = guardian;
  }

  await student.save();
  res.status(200).json(shape(student));
});

//@desc   Reset a student's password. If they registered but never
//        finished completeProfile (no name/password, isProfileComplete:
//        false), finishes the profile at the same time — app/authController
//        .js's login unconditionally rejects any account with
//        isProfileComplete: false regardless of password, so setting one
//        here alone used to save without error and still leave the
//        student exactly as unable to log in as before, with nothing to
//        explain why.
//@route  PUT /api/students/:id/password
//@access Private
const resetStudentPassword = asyncHandler(async (req, res) => {
  const { password, name } = req.body;

  if (!password) {
    res.status(400);
    throw new Error("A new password is required.");
  }

  const student = await Student.findById(req.params.id).select("+password");

  if (!student) {
    res.status(404);
    throw new Error("Student not found.");
  }

  if (!student.isProfileComplete) {
    if (!name && !student.name) {
      res.status(400);
      throw new Error("This student never finished signing up — a name is required to activate the account along with the password.");
    }
    if (name) student.name = name;
    student.isProfileComplete = true;
  }

  student.password = password;
  // Ends any session they have open.
  student.sessionId = undefined;
  await student.save();

  res.status(200).json({ message: "Password reset.", student: shape(student) });
});

//@desc   Permanently delete a student and every record tied to them —
//        purchases/trials, exam submissions, AI usage and credit balances,
//        practice history, study plans, doubts, notifications, uploaded
//        files, and any custom practice exam they built themselves. This
//        used to refuse outright once a submission existed, on the
//        reasoning that a school may be required to keep exam history —
//        that protection is now the buyer's own call: Deactivate
//        (updateStudent, isActive: false) is the reversible alternative
//        that keeps every record and just stops access; this is the
//        irreversible one, for a buyer who wants the record gone entirely
//        (e.g. a GDPR-style erasure request).
//
//        Deliberately does NOT touch a LiveClass's registrants array (a
//        stray entry for a deleted student there is inert clutter, not a
//        broken reference) or Doubt threads a teacher answered for other
//        students — only what this student themselves owns.
//@route  DELETE /api/students/:id
//@access Private, owner/admin only
const deleteStudent = asyncHandler(async (req, res) => {
  const student = await Student.findById(req.params.id);

  if (!student) {
    res.status(404);
    throw new Error("Student not found.");
  }

  await Promise.all([
    Purchase.deleteMany({ student: student._id }),
    Trial.deleteMany({ student: student._id }),
    Submission.deleteMany({ student: student._id }),
    AiUsage.deleteMany({ student: student._id }),
    AiCredit.deleteMany({ student: student._id }),
    Doubt.deleteMany({ student: student._id }),
    StudyPlan.deleteMany({ student: student._id }),
    PracticeAttempt.deleteMany({ student: student._id }),
    PracticeExamRecord.deleteMany({ student: student._id }),
    PracticeExamRecord.Archive.deleteMany({ student: student._id }),
    PracticeAttempt.Archive.deleteMany({ student: student._id }),
    PracticeFavorite.Archive.deleteMany({ student: student._id }),
    StudyPlan.Archive.deleteMany({ student: student._id }),
    PracticeFavorite.deleteMany({ student: student._id }),
    LectureProgress.deleteMany({ student: student._id }),
    Notification.deleteMany({ student: student._id }),
    StudentUpload.deleteMany({ student: student._id }),
    // Only exams this student built themselves via the custom-exam
    // picker (createdByStudent) — never a teacher-authored exam merely
    // taken by them, which Submission above already covers.
    Exam.deleteMany({ createdByStudent: student._id }),
  ]);

  await student.deleteOne();
  res.status(200).json({ message: "Student and all associated records deleted." });
});

//@desc   Grant access to a batch without a payment
//@route  POST /api/students/:id/enrol
//@access Private
const enrolStudent = asyncHandler(async (req, res) => {
  const { batchId, days, note } = req.body;

  const [student, batch] = await Promise.all([
    Student.findById(req.params.id),
    Batch.findById(batchId),
  ]);

  if (!student) {
    res.status(404);
    throw new Error("Student not found.");
  }
  if (!batch) {
    res.status(404);
    throw new Error("Batch not found.");
  }

  // A grant is a zero-price purchase, so it stacks and expires through exactly
  // the same code path as a paid one.
  const purchase = await Purchase.create({
    student: student._id,
    batch: batch._id,
    plan: {
      label: note || "Granted access",
      price: 0,
      durationDays: days === null || days === undefined ? null : Number(days),
      isInfinite: days === null || days === undefined,
    },
    currency: (await AppSettings.get()).defaultCurrency,
    provider: "manual",
    status: "complete",
    recordedBy: req.user._id,
    note,
  });

  res.status(201).json(purchase);
});

//@desc   Record a payment taken outside the app
//@route  POST /api/students/:id/purchases
//@access Private
const recordPurchase = asyncHandler(async (req, res) => {
  const { batchId, planLabel, method, transactionId, note, startDate } = req.body;

  const [student, batch, settings] = await Promise.all([
    Student.findById(req.params.id),
    Batch.findById(batchId),
    AppSettings.get(),
  ]);

  if (!student) {
    res.status(404);
    throw new Error("Student not found.");
  }
  if (!batch) {
    res.status(404);
    throw new Error("Batch not found.");
  }

  const plan = batch.plans.find((p) => p.label === planLabel);

  if (!plan) {
    res.status(400);
    throw new Error(
      `"${planLabel}" is not a plan on this batch. Available: ${batch.plans.map((p) => p.label).join(", ") || "none"}`
    );
  }

  if (transactionId) {
    const duplicate = await Purchase.findOne({ transactionId });
    if (duplicate) {
      res.status(409);
      throw new Error("A purchase with that reference has already been recorded.");
    }
  }

  // The plan is snapshotted, so repricing the batch later does not rewrite
  // what this student agreed to.
  const purchase = await Purchase.create({
    student: student._id,
    batch: batch._id,
    plan: {
      label: plan.label,
      price: plan.price,
      durationDays: plan.durationDays,
      isInfinite: plan.isInfinite,
    },
    currency: settings.defaultCurrency,
    provider: method || "manual",
    transactionId,
    status: "complete",
    recordedBy: req.user._id,
    note,
    startDate: startDate ? new Date(startDate) : new Date(),
  });

  res.status(201).json(purchase);
});

//@desc   Reverse a recorded purchase
//@route  DELETE /api/purchases/:id
//@access Private, admin
const deletePurchase = asyncHandler(async (req, res) => {
  const purchase = await Purchase.findById(req.params.id);

  if (!purchase) {
    res.status(404);
    throw new Error("Purchase not found.");
  }

  // Gateway payments are marked refunded rather than removed, because the
  // money moved and the record has to survive. Manual entries were only ever
  // a note, so a mistyped one can be removed.
  if (purchase.provider !== "manual") {
    purchase.status = "refunded";
    await purchase.save();
    res.status(200).json({ message: "Purchase marked as refunded.", purchase });
    return;
  }

  await purchase.deleteOne();
  res.status(200).json({ message: "Purchase removed." });
});

//@desc   List purchases across all students
//@route  GET /api/purchases
//@access Private
const getPurchases = asyncHandler(async (req, res) => {
  const { batch, status, search } = req.query;
  const page = Number(req.query.page) || 1;
  const limit = Math.min(Number(req.query.limit) || 30, 100);

  const query = {};
  if (batch) query.batch = batch;
  if (status) query.status = status;

  if (search) {
    const students = await Student.find({
      $or: [
        { name: { $regex: search, $options: "i" } },
        { phoneNumber: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ],
    }).distinct("_id");

    query.$or = [
      { student: { $in: students } },
      { transactionId: { $regex: search, $options: "i" } },
    ];
  }

  const [purchases, total, revenue] = await Promise.all([
    Purchase.find(query)
      .populate("student", "name phoneNumber email")
      .populate("batch", "name")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Purchase.countDocuments(query),
    Purchase.aggregate([
      { $match: { ...query, status: "complete" } },
      { $group: { _id: null, total: { $sum: "$plan.price" } } },
    ]),
  ]);

  res.status(200).json({
    purchases,
    total,
    page,
    pages: Math.ceil(total / limit),
    revenue: revenue.length > 0 ? revenue[0].total : 0,
  });
});

//@desc   Import students from a spreadsheet (utils/studentImport.js)
//@route  POST /api/students/import  { rows: [{ studentId, name, email, phoneNumber, password, batch }], dryRun }
//@access Private (owner, admin)
const importStudentRows = asyncHandler(async (req, res) => {
  try {
    const result = await require("../../utils/studentImport").importStudents(req.body?.rows, { dryRun: Boolean(req.body?.dryRun), recordedBy: req.user._id });
    res.status(200).json(result);
  } catch (error) {
    res.status(error.statusCode || 500);
    throw error;
  }
});

//@desc   Give an ID from the pattern to every finished student without one
//@route  POST /api/students/assign-ids
const assignStudentIds = asyncHandler(async (req, res) => {
  const { currentPattern, nextStudentId } = require("../../utils/studentIdPattern");
  const pattern = await currentPattern();
  if (!pattern) { res.status(400); throw new Error("Set a student ID pattern first (Settings → Institution)."); }
  const missing = await Student.find({ isProfileComplete: true, deletedAt: null, name: { $ne: "" }, $or: [{ studentId: null }, { studentId: "" }] })
    .select("name email phoneNumber createdAt").sort({ createdAt: 1 }).limit(5000);
  let assigned = 0;
  for (const s of missing) {
    const id = await nextStudentId(pattern, s);
    await Student.updateOne({ _id: s._id }, { $set: { studentId: id } });
    assigned += 1;
  }
  res.json({ assigned });
});

//@desc   A student's Oral Quiz sessions (with transcripts)
//@route  GET /api/students/:id/pora
//@access Private
const getStudentPora = asyncHandler(async (req, res) => {
  const PoraSession = require("../../models/poraSessionModel");
  const { shapeSession } = require("../app/poraController");
  if (!require("mongoose").isValidObjectId(req.params.id)) {
    res.status(404);
    throw new Error("Student not found.");
  }
  const sessions = await PoraSession.find({ student: req.params.id }).sort({ updatedAt: -1 }).limit(50).populate("batch", "name");
  res.status(200).json({
    sessions: sessions.map((x) => ({ ...shapeSession(x), batchName: x.batch?.name || "" })),
  });
});

//@desc   A student's AI Tutoring sessions (with transcripts)
//@route  GET /api/students/:id/tutor
//@access Private
const getStudentTutor = asyncHandler(async (req, res) => {
  const TutorSession = require("../../models/tutorSessionModel");
  const { shapeSession } = require("../app/aiTutorController");
  if (!require("mongoose").isValidObjectId(req.params.id)) {
    res.status(404);
    throw new Error("Student not found.");
  }
  const sessions = await TutorSession.find({ student: req.params.id }).sort({ updatedAt: -1 }).limit(50).populate("batch", "name");
  res.status(200).json({
    sessions: sessions.map((x) => ({ ...shapeSession(x), batchName: x.batch?.name || "" })),
  });
});

//@desc   A student's interview practice sessions (with transcripts)
//@route  GET /api/students/:id/interview
//@access Private
const getStudentInterview = asyncHandler(async (req, res) => {
  const InterviewSession = require("../../models/interviewSessionModel");
  if (!require("mongoose").isValidObjectId(req.params.id)) {
    res.status(404);
    throw new Error("Student not found.");
  }
  const sessions = await InterviewSession.find({ student: req.params.id }).sort({ updatedAt: -1 }).limit(50).populate("batch", "name");
  // Staff see everything, the panel's notes on each answer included.
  res.status(200).json({
    sessions: sessions.map((x) => ({
      _id: x._id, title: x.title, kind: x.kind, status: x.status, asked: x.asked, limit: x.limit, marks: x.marks,
      score: x.report?.score ?? null, report: x.report || null, turns: x.turns, interviewers: x.interviewers,
      updatedAt: x.updatedAt, batchName: x.batch?.name || "",
    })),
  });
});

module.exports = {
  getStudentInterview,
  getStudentTutor,
  getStudentPora,
  assignStudentIds,
  importStudentRows,
  getStudents,
  getStudent,
  createStudent,
  updateStudent,
  resetStudentPassword,
  deleteStudent,
  enrolStudent,
  recordPurchase,
  deletePurchase,
  getPurchases,
};
