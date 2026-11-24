const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const DeletionRequest = require("../../models/deletionRequestModel");
const Student = require("../../models/studentModel");
const AppSettings = require("../../models/appSettingsModel");
const { notify } = require("../../utils/notify");
const { complete } = require("../../utils/accountDeletion");

// Admin → Account deletions: students' requests, approval when the
// settings ask for it, and the settings themselves.

//@desc   Requests, newest first
//@route  GET /api/deletions?status=
const listRequests = asyncHandler(async (req, res) => {
  const query = {};
  if (["pending", "awaiting", "completed", "cancelled", "rejected"].includes(req.query.status)) query.status = req.query.status;
  else if (req.query.status === "active") query.status = { $in: ["pending", "awaiting"] };
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = 30;
  const [requests, total] = await Promise.all([
    DeletionRequest.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate("handledBy", "name").lean(),
    DeletionRequest.countDocuments(query),
  ]);
  res.status(200).json({ requests, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

//@desc   Waiting for approval (nav badge)
//@route  GET /api/deletions/counts
const deletionCounts = asyncHandler(async (req, res) => {
  const [awaiting, pending] = await Promise.all([
    DeletionRequest.countDocuments({ status: "awaiting" }),
    DeletionRequest.countDocuments({ status: "pending" }),
  ]);
  res.status(200).json({ awaiting, pending });
});

const findActive = async (req, res) => {
  const request = mongoose.isValidObjectId(req.params.id)
    ? await DeletionRequest.findOne({ _id: req.params.id, status: { $in: ["pending", "awaiting"] } })
    : null;
  if (!request) {
    res.status(404);
    throw new Error("No open request with that id.");
  }
  return request;
};

//@desc   Approve: erase now (also skips the rest of a grace period)
//@route  POST /api/deletions/:id/approve
const approveRequest = asyncHandler(async (req, res) => {
  const request = await findActive(req, res);
  await complete(request, req.user._id);
  res.status(200).json({ request });
});

//@desc   Reject: the account stays; the student is told why
//@route  POST /api/deletions/:id/reject   { note }
const rejectRequest = asyncHandler(async (req, res) => {
  const request = await findActive(req, res);
  const note = String(req.body.note || "").trim().slice(0, 1000);
  if (!note) {
    res.status(400);
    throw new Error("Tell the student why.");
  }
  request.status = "rejected";
  request.note = note;
  request.handledBy = req.user._id;
  await request.save();
  await Student.updateOne({ _id: request.student }, { $set: { deletionScheduledFor: null } });
  await notify(request.student, "accountDeletion", {
    title: "Your account wasn't deleted",
    body: note,
    link: "/account",
  }).catch(() => {});
  res.status(200).json({ request });
});

//@desc   Settings
//@route  GET/PUT /api/deletions/settings
const getDeletionSettings = asyncHandler(async (req, res) => {
  res.status(200).json({ accountDeletion: (await AppSettings.get()).accountDeletion || {} });
});
const updateDeletionSettings = asyncHandler(async (req, res) => {
  const settings = await AppSettings.get();
  const current = settings.accountDeletion || {};
  const { enabled, graceDays, autoDelete } = req.body;
  if (enabled !== undefined) current.enabled = Boolean(enabled);
  if (autoDelete !== undefined) current.autoDelete = Boolean(autoDelete);
  if (graceDays !== undefined) current.graceDays = Math.min(365, Math.max(0, Math.round(Number(graceDays) || 0)));
  settings.accountDeletion = current;
  await settings.save();
  res.status(200).json({ accountDeletion: settings.accountDeletion });
});

module.exports = { listRequests, deletionCounts, approveRequest, rejectRequest, getDeletionSettings, updateDeletionSettings };
