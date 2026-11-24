const asyncHandler = require("express-async-handler");
const ConductEvent = require("../../models/conductEventModel");
const DeletionRequest = require("../../models/deletionRequestModel");
const AppSettings = require("../../models/appSettingsModel");
const Student = require("../../models/studentModel");
const { notify } = require("../../utils/notify");
const { fmt, DAY, examFlagMin, withoutMinorExamFlags } = require("../../utils/conduct");

// The student's own account page: standing (conduct record) and, see
// below, deletion.

//@desc   My account standing: restrictions in force and my record
//@route  GET /api/app/account/standing
const getStanding = asyncHandler(async (req, res) => {
  const now = new Date();
  const events = await ConductEvent.find({ student: req.student._id, status: { $ne: "dismissed" }, ...withoutMinorExamFlags(await examFlagMin()) })
    .sort({ createdAt: -1 })
    .limit(100)
    .populate("exam", "title")
    .populate("batch", "name")
    .select("kind source text flaggedBy count action until status appealTicket exam batch createdAt")
    .lean();
  const aiPausedUntil = req.student.aiPausedUntil && req.student.aiPausedUntil > now ? req.student.aiPausedUntil : null;
  res.status(200).json({
    aiPausedUntil,
    // Far-future pause = until staff lift it.
    aiPausedIndefinitely: Boolean(aiPausedUntil && aiPausedUntil.getFullYear() > 2900),
    events,
  });
});

//@desc   Can I delete my account, and is a request in progress?
//@route  GET /api/app/account/deletion
const getDeletion = asyncHandler(async (req, res) => {
  const settings = (await AppSettings.get()).accountDeletion || {};
  const request = await DeletionRequest.findOne({ student: req.student._id, status: { $in: ["pending", "awaiting"] } })
    .select("status scheduledFor reason createdAt")
    .lean();
  const last = request ? null : await DeletionRequest.findOne({ student: req.student._id, status: "rejected" }).sort({ updatedAt: -1 }).select("note updatedAt").lean();
  res.status(200).json({
    enabled: settings.enabled !== false,
    graceDays: settings.graceDays ?? 14,
    needsApproval: settings.autoDelete === false,
    request,
    lastRejected: last,
  });
});

//@desc   Ask for my account to be deleted
//@route  POST /api/app/account/deletion   { reason, confirm: "DELETE" }
const requestDeletion = asyncHandler(async (req, res) => {
  const settings = (await AppSettings.get()).accountDeletion || {};
  if (settings.enabled === false) {
    res.status(403);
    throw new Error("Deleting your account from the app isn't available. Contact support.");
  }
  if (String(req.body.confirm || "").trim().toUpperCase() !== "DELETE") {
    res.status(400);
    throw new Error('Type DELETE to confirm.');
  }
  if (await DeletionRequest.exists({ student: req.student._id, status: { $in: ["pending", "awaiting"] } })) {
    res.status(409);
    throw new Error("A deletion request is already in progress.");
  }
  const graceDays = settings.graceDays ?? 14;
  const scheduledFor = new Date(Date.now() + graceDays * DAY);
  const request = await DeletionRequest.create({
    student: req.student._id,
    name: req.student.name,
    contact: req.student.email || req.student.phoneNumber,
    reason: String(req.body.reason || "").trim().slice(0, 1000),
    scheduledFor,
  });
  await Student.updateOne({ _id: req.student._id }, { $set: { deletionScheduledFor: scheduledFor } });
  // No grace period: done now (or handed to staff).
  if (graceDays === 0) await require("../../utils/accountDeletion").processDue();
  await notify(req.student._id, "accountDeletion", {
    title: "Account deletion requested",
    body: graceDays
      ? `Your account will be deleted on ${fmt(scheduledFor)}${settings.autoDelete === false ? " after staff review" : ""}. You can cancel until then from your Account page.`
      : "Your account is being deleted.",
    link: "/account",
  }).catch(() => {});
  res.status(201).json({ request: { status: request.status, scheduledFor, reason: request.reason, createdAt: request.createdAt } });
});

//@desc   Cancel my deletion request
//@route  DELETE /api/app/account/deletion
const cancelDeletion = asyncHandler(async (req, res) => {
  const request = await DeletionRequest.findOne({ student: req.student._id, status: { $in: ["pending", "awaiting"] } });
  if (!request) {
    res.status(404);
    throw new Error("There's no deletion request to cancel.");
  }
  request.status = "cancelled";
  await request.save();
  await Student.updateOne({ _id: req.student._id }, { $set: { deletionScheduledFor: null } });
  await notify(req.student._id, "accountDeletion", {
    title: "Account deletion cancelled",
    body: "Your account stays as it is.",
    link: "/account",
  }).catch(() => {});
  res.status(200).json({ ok: true });
});

module.exports = { getStanding, getDeletion, requestDeletion, cancelDeletion };
