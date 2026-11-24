const Purchase = require("../models/purchaseModel");
const Student = require("../models/studentModel");
const { resolveExpiry } = require("./accessWindow");

// The students in a batch right now: everyone whose purchases or grants
// (Grant access, Import) for it haven't run out. Trials are left out: a
// trial student is trying the batch, not on its register.
const rosterIds = async (batchId, now = new Date()) => {
  const purchases = await Purchase.find({ batch: batchId, status: "complete" })
    .select("student plan startDate").sort({ startDate: 1 }).lean();
  const byStudent = new Map();
  for (const p of purchases) {
    const key = String(p.student);
    if (!byStudent.has(key)) byStudent.set(key, []);
    byStudent.get(key).push(p);
  }
  return [...byStudent.entries()].filter(([, list]) => {
    const expiry = resolveExpiry(list);
    return expiry && expiry >= now;
  }).map(([id]) => id);
};

// The same, with names: active accounts only, sorted by name.
const roster = async (batchId) => {
  const ids = await rosterIds(batchId);
  return Student.find({ _id: { $in: ids }, isActive: true, deletedAt: null })
    .select("name email phoneNumber studentId").sort({ name: 1 }).lean();
};

module.exports = { rosterIds, roster };
