const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Batch = require("../../models/batchModel");
const Purchase = require("../../models/purchaseModel");
const Student = require("../../models/studentModel");
const { resolveExpiry } = require("../../utils/accessWindow");
const cache = require("../../utils/cache");
const tags = require("../../utils/cacheTags");

// Moving a class up a year: students with access to one batch get access
// to the next (or none, when they graduate), and their old access ends.
// Results and history stay with each student.

// Students with access to the batch now.
const activeIn = async (batchId) => {
  const rows = await Purchase.find({ batch: batchId, status: "complete" }).select("student plan startDate endedAt").sort({ startDate: 1 }).lean();
  const by = new Map();
  for (const p of rows) {
    const k = String(p.student);
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(p);
  }
  const now = new Date();
  return [...by].filter(([, list]) => { const e = resolveExpiry(list); return e && e >= now; }).map(([k]) => k);
};

//@desc   Who would move: students with access to the batch now
//@route  GET /api/batches/:id/promote
//@access Private (owner, admin)
const promotePreview = asyncHandler(async (req, res) => {
  const ids = await activeIn(req.params.id);
  const students = await Student.find({ _id: { $in: ids }, deletedAt: null }).select("name studentId email phoneNumber").sort({ name: 1 }).lean();
  res.status(200).json({ students });
});

//@desc   Promote: { to (batch id, or null to graduate), keep: [student ids held back], copyContent }
//@route  POST /api/batches/:id/promote
//@access Private (owner, admin)
const promote = asyncHandler(async (req, res) => {
  const from = await Batch.findById(req.params.id).select("name");
  if (!from) { res.status(404); throw new Error("Batch not found."); }
  const toId = req.body.to || null;
  const to = toId ? await Batch.findById(toId).select("name") : null;
  if (toId && !to) { res.status(404); throw new Error("The next batch wasn't found."); }
  if (to && String(to._id) === String(from._id)) { res.status(400); throw new Error("Pick a different batch to move into."); }
  const keep = new Set((Array.isArray(req.body.keep) ? req.body.keep : []).map(String));
  const moving = (await activeIn(from._id)).filter((s) => !keep.has(s));
  const now = new Date();

  if (to) {
    // A free, lifetime grant in the new batch, like Enrol (studentController).
    const currency = (await require("../../models/appSettingsModel").get()).defaultCurrency;
    await Purchase.create(moving.map((s) => ({
      student: s, batch: to._id, plan: { label: `Promoted from ${from.name}`, price: 0, durationDays: null, isInfinite: true },
      currency, provider: "manual", status: "complete", recordedBy: req.user._id, note: `Promoted from ${from.name}`, startDate: now,
    })));
  }
  if (moving.length) {
    await Purchase.updateMany({ batch: from._id, student: { $in: moving.map((s) => new mongoose.Types.ObjectId(s)) }, status: "complete", endedAt: null }, { $set: { endedAt: now } });
    await cache.touch(moving.map(tags.access));
  }
  if (to && req.body.copyContent) {
    const { copyAssignments } = require("./assignmentController");
    await require("../../agents/invoke").call(copyAssignments, { user: req.user, params: { id: String(to._id), sourceId: String(from._id) }, body: {} }).catch(() => null);
  }
  res.status(200).json({ moved: moving.length, keptBack: keep.size, to: to?.name || null });
});

module.exports = { promotePreview, promote };
