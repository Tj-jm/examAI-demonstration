const asyncHandler = require("express-async-handler");
const Batch = require("../models/batchModel");

// Assigning content to a batch used to be any logged-in staff member's to
// do, regardless of whether they had anything to do with that batch. This
// narrows it: owner/admin can still touch any batch, same as before, but a
// teacher can only assign to (or otherwise modify content on) a batch they
// are actually listed against. Being added to that list is itself an
// owner/admin action, in batchController.updateBatch — a teacher can never
// grant themselves access to a batch this way.
const requireBatchTeacher = asyncHandler(async (req, res, next) => {
  if (["owner", "admin"].includes(req.user.role)) return next();

  const batchId = req.params.id || req.params.batchId;
  if (!batchId) {
    res.status(400);
    throw new Error("No batch specified.");
  }

  const batch = await Batch.findById(batchId).select("teachers");
  if (!batch) {
    res.status(404);
    throw new Error("Batch not found.");
  }

  if (!batch.hasTeacher(req.user._id)) {
    res.status(403);
    throw new Error("You are not assigned to teach this batch.");
  }

  return next();
});

// Tagged the same way allow() is, for tests/routeAudit.js's benefit — this
// is stricter than a plain role list (a teacher only passes for batches
// they're actually on), but "auth + role:owner/admin/teacher" is still an
// honest, if conservative, summary of what it restricts to.
requireBatchTeacher.isRoleGuard = true;
requireBatchTeacher.roles = ["owner", "admin", "teacher"];

module.exports = { requireBatchTeacher };