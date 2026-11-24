const Batch = require("../models/batchModel");
const Purchase = require("../models/purchaseModel");
const Trial = require("../models/trialModel");
const Student = require("../models/studentModel");
const { resolveExpiry } = require("./accessWindow");

// The reverse of middleware/batchAccess.js: that answers "does this one
// student have access to this one batch" per request; this answers "which
// students currently have access to this batch", for fanning a batch
// notice's notification out to the right audience. Reuses resolveExpiry
// rather than approximating "currently enrolled" with a cheaper but looser
// query — a notification about a batch a student's access just lapsed on
// is a minor wrong, but there is no reason to get it wrong when the exact
// check already exists and is already tested.
// Not erased (accountDeletion.js) and not deactivated for good.
const LIVE_ACCOUNT = { deletedAt: null, isActive: { $ne: false } };

const getActiveBatchStudentIds = async (batchId) => {
  const batch = await Batch.findById(batchId).select("accessType");
  if (!batch) return [];

  // A free batch has no membership check at all in batchAccess — any
  // authenticated student passes. There is no narrower audience to resolve
  // than every student on the platform.
  if (batch.accessType === "free") {
    return (await Student.find(LIVE_ACCOUNT).select("_id")).map((s) => s._id);
  }

  const now = new Date();

  const [purchases, trials] = await Promise.all([
    Purchase.find({ batch: batchId, status: "complete" }).sort({ startDate: 1 }),
    Trial.find({ batch: batchId, endDate: { $gte: now } }).select("student"),
  ]);

  const byStudent = new Map();
  for (const purchase of purchases) {
    const key = String(purchase.student);
    if (!byStudent.has(key)) byStudent.set(key, []);
    byStudent.get(key).push(purchase);
  }

  const activeIds = [];
  for (const [studentId, studentPurchases] of byStudent) {
    const expiry = resolveExpiry(studentPurchases);
    if (expiry && expiry >= now) activeIds.push(studentId);
  }

  const trialIds = trials.map((t) => String(t.student));

  // A Set because a student can hold both a purchase and a trial record —
  // counted once, not notified twice. Purchases outlive the account, so
  // erased and deactivated accounts are dropped here.
  const ids = [...new Set([...activeIds, ...trialIds])];
  if (!ids.length) return ids;
  const live = new Set((await Student.find({ _id: { $in: ids }, ...LIVE_ACCOUNT }).select("_id").lean()).map((s) => String(s._id)));
  return ids.filter((id) => live.has(id));
};

// Drops deleted and suspended accounts (and ids with no account left):
// agents shouldn't plan messages for people who can't read them.
const reachableStudents = async (ids) => {
  if (!ids.length) return [];
  const now = new Date();
  const ok = await Student.find({
    _id: { $in: ids }, deletedAt: null, isActive: { $ne: false },
    $or: [{ suspendedUntil: null }, { suspendedUntil: { $lte: now } }],
  }).select("_id").lean();
  const keep = new Set(ok.map((s) => String(s._id)));
  return ids.filter((id) => keep.has(String(id)));
};

module.exports = { getActiveBatchStudentIds, reachableStudents };
