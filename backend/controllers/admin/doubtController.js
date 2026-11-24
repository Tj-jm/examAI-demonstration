const asyncHandler = require("express-async-handler");
const Doubt = require("../../models/doubtModel");
const Topic = require("../../models/topicModel");
const User = require("../../models/userModel");
const Student = require("../../models/studentModel");
const { notify } = require("../../utils/notify");
const storage = require("../../adapters/storage");
const { preparePhoto } = require("../../utils/photo");

// Same name/email/phone $or pattern as studentController.js's getStudents —
// resolved to a set of student ids first, rather than searched inline on
// Doubt itself, since a doubt only ever stores a student ref, not a copy
// of their name/email/phone to match against directly.
const findMatchingStudentIds = (search) =>
  Student.find({
    $or: [
      { name: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
      { phoneNumber: { $regex: search, $options: "i" } },
    ],
  }).distinct("_id");

// A doubt-solver's queue is deliberately narrower than the grading queue —
// it only ever shows status: "escalated". A doubt that's still with the AI,
// or already resolved, has nothing here for a human to do — with one
// exception: a doubt reopened by an approved review also sits at
// "escalated", and is visible here only to the solver who originally
// answered it (see the $or below, and resolveDoubt's own guard for the
// server-side half of that restriction).
const buildQueueQuery = async (req) => {
  const query = { status: "escalated" };
  if (req.query.batchId) query.batch = req.query.batchId;

  if (req.query.subjectId) {
    const topicIds = await Topic.find({ subject: req.query.subjectId }).distinct("_id");
    query.topic = { $in: topicIds };
  }

  // Filters on `student`, not a second top-level $or — that key is already
  // taken below by the doubtSolver visibility restriction, and a second
  // $or on the same query object would just silently overwrite the first.
  if (req.query.search) {
    const studentIds = await findMatchingStudentIds(req.query.search);
    query.student = { $in: studentIds };
  }

  // A brand-new escalation has no resolvedBy yet, so it's open to anyone.
  // One that's back here because a review was approved keeps the original
  // resolvedBy from its first answer, and only that person should see it —
  // reusing resolvedBy rather than inventing a parallel "assignedTo" field.
  if (req.user.role === "doubtSolver") {
    query.$or = [
      { resolvedBy: { $exists: false } },
      { resolvedBy: null },
      { resolvedBy: req.user._id },
    ];
  }

  return query;
};

//@desc   Doubts waiting on a human — either escalated from AI, asked for
//        directly, or reopened by an approved review
//@route  GET /api/doubts?batchId=&subjectId=&search=&page=&limit=
//@access Private (owner, admin, doubtSolver)
const getQueue = asyncHandler(async (req, res) => {
  const query = await buildQueueQuery(req);
  const page = Number(req.query.page) || 1;
  const limit = Math.min(Number(req.query.limit) || 30, 100);

  const [doubts, total] = await Promise.all([
    Doubt.find(query)
      .populate("student", "name email phoneNumber")
      .populate("batch", "name")
      .select("student batch question mode createdAt escalatedAt resolvedBy review")
      .sort({ createdAt: 1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Doubt.countDocuments(query),
  ]);

  res.status(200).json({ doubts, total, page, pages: Math.ceil(total / limit) });
});

//@desc   One doubt in full, whatever its status — a resolved one still
//        needs to be viewable, just not re-resolvable unless a review was
//        approved on it
//@route  GET /api/doubts/:id
//@access Private (owner, admin, doubtSolver)
const getDoubt = asyncHandler(async (req, res) => {
  const doubt = await Doubt.findById(req.params.id)
    .populate("student", "name email phoneNumber")
    .populate("batch", "name")
    .populate("resolvedBy", "name identifier isDeleted")
    .populate("review.decidedBy", "name identifier");

  if (!doubt) {
    res.status(404);
    throw new Error("Doubt not found.");
  }

  res.status(200).json({ doubt });
});

//@desc   Answer a doubt manually — also how a review-approved doubt gets
//        its updated answer, since approval simply sets status back to
//        "escalated" and lets this same endpoint handle it again.
//@route  PUT /api/doubts/:id/resolve
//@access Private (owner, admin, doubtSolver)
const resolveDoubt = asyncHandler(async (req, res) => {
  const { answer, answerImage } = req.body;
  if (!answer || !answer.trim()) {
    res.status(400);
    throw new Error("Write an answer before resolving.");
  }

  const doubt = await Doubt.findById(req.params.id);
  if (!doubt) {
    res.status(404);
    throw new Error("Doubt not found.");
  }
  if (doubt.status === "resolved") {
    res.status(400);
    throw new Error("This doubt is already resolved.");
  }

  // The queue already hides a review-reopened doubt from anyone but its
  // original solver — this is the same rule enforced server-side, since a
  // filtered list is a UI convenience, not a security boundary. A brand-new
  // escalation (resolvedBy still unset) has no such restriction yet.
  if (doubt.resolvedBy && String(doubt.resolvedBy) !== String(req.user._id)) {
    res.status(403);
    throw new Error("Only the doubt solver who originally answered this may update it.");
  }

  doubt.humanAnswer = answer.trim();
  // undefined leaves whatever was there alone (relevant on a review-approved
  // re-resolve); an explicit "" clears a previously attached image out.
  if (answerImage !== undefined) doubt.humanAnswerImage = answerImage || null;
  doubt.status = "resolved";
  doubt.resolvedBy = req.user._id;
  doubt.resolvedAt = new Date();
  await doubt.save();

  await notify(doubt.student, "doubtResolved", {
    title: "Your doubt was resolved",
    body: doubt.question?.slice(0, 100),
    link: `/batches/${doubt.batch}/doubts/${doubt._id}`,
  });

  res.status(200).json({ doubt });
});

//@desc   Solved-doubt history. A doubt-solver or teacher only ever sees
//        their own, regardless of any solverId in the query — that
//        restriction is enforced here, not just left to the frontend not
//        asking. An owner/admin sees every solver's history by default,
//        or narrows to one with ?solverId=, the same picker the payment
//        tab already uses. Same fields the payment-stats endpoint below
//        counts from.
//@route  GET /api/doubts/mine?from=&to=&page=&solverId=&search=
//@access Private (owner, admin, doubtSolver)
const getMySolvedDoubts = asyncHandler(async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Math.min(Number(req.query.limit) || 20, 100);

  const query = { status: "resolved" };
  if (["doubtSolver", "teacher"].includes(req.user.role)) {
    query.resolvedBy = req.user._id;
  } else if (req.query.solverId) {
    query.resolvedBy = req.query.solverId;
  }
  // else: owner/admin with no solverId — every solver's history at once.

  if (req.query.from || req.query.to) {
    query.resolvedAt = {};
    if (req.query.from) query.resolvedAt.$gte = new Date(req.query.from);
    if (req.query.to) query.resolvedAt.$lte = new Date(req.query.to);
  }

  if (req.query.search) {
    const studentIds = await findMatchingStudentIds(req.query.search);
    query.student = { $in: studentIds };
  }

  const [doubts, total] = await Promise.all([
    Doubt.find(query)
      .populate("student", "name")
      .populate("batch", "name")
      .populate("resolvedBy", "name identifier isDeleted")
      .select("student batch question humanAnswer resolvedAt resolvedBy review")
      .sort({ resolvedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Doubt.countDocuments(query),
  ]);

  res.status(200).json({ doubts, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

// Shared by both the solver's own stats view and an owner/admin checking
// any one solver — one calculation, so a solver's own count and what an
// admin sees for them when processing payment can never quietly disagree.
const countResolved = (solverId, from, to) => {
  const query = { resolvedBy: solverId, status: "resolved" };
  if (from || to) {
    query.resolvedAt = {};
    if (from) query.resolvedAt.$gte = new Date(from);
    if (to) query.resolvedAt.$lte = new Date(to);
  }
  return Doubt.countDocuments(query);
};

//@desc   How many doubts this solver has resolved in a date range — the
//        payment-window count, for their own reference.
//@route  GET /api/doubts/stats/me?from=&to=
//@access Private (owner, admin, doubtSolver)
const getMyStats = asyncHandler(async (req, res) => {
  const count = await countResolved(req.user._id, req.query.from, req.query.to);
  res.status(200).json({ count, from: req.query.from || null, to: req.query.to || null });
});

//@desc   List everyone who has ever resolved a doubt, for the payment-stats
//        and history pickers — not everyone with the doubtSolver role.
//        role: "doubtSolver" is a staff-account type (locked down to only
//        the doubt panel, per representativeGate.js); it isn't the only way
//        to resolve a doubt. An owner or admin can and does resolve doubts
//        directly sometimes, and this list is what lets them show up in
//        their own payment/history pickers when they do — filtering by
//        role would silently exclude them even though they're a completely
//        real entry in resolvedBy on real doubts.
//@route  GET /api/doubts/solvers
//@access Private (owner, admin)
const listDoubtSolvers = asyncHandler(async (req, res) => {
  const resolverIds = await Doubt.distinct("resolvedBy", { resolvedBy: { $ne: null } });
  const solvers = await User.find({ _id: { $in: resolverIds } })
    .select("name identifier email isActive role")
    .sort({ name: 1 });
  res.status(200).json(solvers);
});

//@desc   An owner/admin checking one solver's resolved count for a date
//        range — the actual payment-processing step. Same calculation
//        getMyStats uses, just aimed at someone else.
//@route  GET /api/doubts/solvers/:id/stats?from=&to=
//@access Private (owner, admin)
const getSolverStats = asyncHandler(async (req, res) => {
  const solver = await User.findById(req.params.id).select("name identifier");
  if (!solver) {
    res.status(404);
    throw new Error("Account not found.");
  }

  const count = await countResolved(solver._id, req.query.from, req.query.to);
  res.status(200).json({
    solver: { _id: solver._id, name: solver.identifierOrName() },
    count,
    from: req.query.from || null,
    to: req.query.to || null,
  });
});

//@desc   Pending review requests — a student asked to have a resolved
//        doubt looked at again, and nobody has decided yet. Only ever
//        reaches owner/admin, per the review workflow's own rule that a
//        doubt-solver cannot approve reviews (including their own work).
//@route  GET /api/doubts/reviews?page=&limit=
//@access Private (owner, admin)
const getReviewRequests = asyncHandler(async (req, res) => {
  const query = { "review.requested": true, "review.decision": null };
  const page = Number(req.query.page) || 1;
  const limit = Math.min(Number(req.query.limit) || 30, 100);

  const [doubts, total] = await Promise.all([
    Doubt.find(query)
      .populate("student", "name email")
      .populate("batch", "name")
      .populate("resolvedBy", "name identifier isDeleted")
      .sort({ "review.requestedAt": 1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Doubt.countDocuments(query),
  ]);

  res.status(200).json({ doubts, total, page, pages: Math.ceil(total / limit) });
});

//@desc   Approve or reject a pending review request. Approving reopens the
//        doubt to "escalated" for its original solver to update; rejecting
//        leaves the existing answer as final. Either way review.requested
//        stays true forever — this is the one and only review this doubt
//        will ever get, win or lose.
//@route  PUT /api/doubts/:id/review
//@access Private (owner, admin)
const decideReview = asyncHandler(async (req, res) => {
  const { approve } = req.body;
  if (typeof approve !== "boolean") {
    res.status(400);
    throw new Error("Say whether this review is approved or rejected.");
  }

  const doubt = await Doubt.findById(req.params.id);
  if (!doubt) {
    res.status(404);
    throw new Error("Doubt not found.");
  }
  if (!doubt.review.requested || doubt.review.decision) {
    res.status(400);
    throw new Error("There is no pending review request on this doubt.");
  }

  doubt.review.decision = approve ? "approved" : "rejected";
  doubt.review.decidedBy = req.user._id;
  doubt.review.decidedAt = new Date();
  if (approve) doubt.status = "escalated";
  await doubt.save();

  res.status(200).json({ doubt });
});

//@desc   Upload an image for a doubt-solver's reply — a worked step, a
//        diagram, a marked-up version of the student's photo. Mirrors the
//        student app's own upload-image route on the doubt (createDoubt's
//        questionImage), just for the other side of the conversation.
//        Declared under /api/doubts so a doubtSolver's restricted role
//        gate (see representativeGate.js) already covers it — a generic
//        /api/media/upload route is out of reach for that role.
//@route  POST /api/doubts/upload-image
//@access Private (owner, admin, doubtSolver, teacher)
const uploadAnswerImage = asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400);
    throw new Error("No file was received.");
  }

  const stored = await storage.store("doubt-images", await preparePhoto(req.file));
  const url = await storage.urlFor(stored.key, stored.driver);

  res.status(200).json({ url });
});

//@desc   Permanently remove a doubt — owner/admin only, not a doubt-solver
//        action even on their own resolved work. There's no soft-delete or
//        undo here on purpose: this is for a genuinely bad/spam/duplicate
//        entry, not a routine action, so it stays a deliberate, rare one.
//@route  DELETE /api/doubts/:id
//@access Private (owner, admin)
const deleteDoubt = asyncHandler(async (req, res) => {
  const doubt = await Doubt.findByIdAndDelete(req.params.id);

  if (!doubt) {
    res.status(404);
    throw new Error("Doubt not found.");
  }

  res.status(200).json({ message: "Doubt deleted." });
});

module.exports = {
  getQueue, getDoubt, resolveDoubt, deleteDoubt, uploadAnswerImage,
  getMySolvedDoubts, getMyStats, listDoubtSolvers, getSolverStats,
  getReviewRequests, decideReview,
};
