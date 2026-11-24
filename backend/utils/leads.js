const mongoose = require("mongoose");
const Lead = require("../models/leadModel");
const PlanView = require("../models/planViewModel");
const Purchase = require("../models/purchaseModel");
const Student = require("../models/studentModel");
const { normalisePhone, phoneCountry } = require("./guardian");

// Leads: people who left their details on the landing page's interest form,
// and signed-in students who looked at a batch's plans without buying.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);

const recordPlanView = (student, batch) =>
  PlanView.updateOne(
    { student, batch, day: dayKey() },
    { $inc: { views: 1 }, $set: { lastAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
    { upsert: true }
  ).catch(() => {});

// The form's fields, checked. { lead } or { error }.
const cleanLead = (body, settings) => {
  const name = String(body?.name || "").trim().slice(0, 80);
  const rawPhone = String(body?.phone || "").trim();
  const email = String(body?.email || "").trim().toLowerCase().slice(0, 120);
  if (!name) return { error: "Please write your name." };
  let phone = "";
  if (rawPhone) {
    const country = phoneCountry(settings) || settings?.auth?.countries?.[0]?.code || "BD";
    phone = normalisePhone(rawPhone, country);
    if (!phone) return { error: "That phone number doesn't look right." };
  }
  if (email && !EMAIL.test(email)) return { error: "That email doesn't look right." };
  if (!phone && !email) return { error: "Please give a phone number or an email so we can reach you." };
  return {
    lead: {
      name, phone, email,
      batch: mongoose.isValidObjectId(body?.batch) ? body.batch : null,
      message: String(body?.message || "").trim().slice(0, 500),
      source: String(body?.source || "landing").replace(/[^a-z0-9-]/gi, "").slice(0, 40) || "landing",
      ref: String(body?.ref || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40),
    },
  };
};

// Saves a lead. The same phone or email within a week updates that lead
// instead of making a second one.
const saveLead = async (lead) => {
  const or = [lead.phone && { phone: lead.phone }, lead.email && { email: lead.email }].filter(Boolean);
  const recent = await Lead.findOne({ $or: or, createdAt: { $gte: new Date(Date.now() - 7 * 86400000) } });
  if (recent) {
    for (const k of ["name", "batch", "message", "ref", "phone", "email"]) if (lead[k]) recent[k] = lead[k];
    if (recent.status === "lost") recent.status = "new";
    await recent.save();
    return recent;
  }
  // Already a student: still saved, already joined.
  const student = await Student.findOne({ $or: or.map((q) => (q.phone ? { phoneNumber: q.phone } : q)), isProfileComplete: true }).select("_id").lean();
  return Lead.create({ ...lead, ...(student ? { student: student._id, status: "joined", joinedAt: new Date() } : {}) });
};

// A new student matching open leads by phone or email: those are joined.
const markJoined = async (student) => {
  const or = [student.phoneNumber && { phone: student.phoneNumber }, student.email && { email: student.email }].filter(Boolean);
  if (!or.length) return 0;
  const r = await Lead.updateMany(
    { $or: or, status: { $in: ["new", "contacted", "lost"] } },
    { $set: { status: "joined", student: student._id, joinedAt: new Date() } }
  );
  return r.modifiedCount || 0;
};

// Signed-in students who opened a batch's plans in the last `days` and
// have no completed purchase of it since. Newest first.
const interested = async ({ days = 14, batch, page = 1, limit = 30 } = {}) => {
  const since = dayKey(new Date(Date.now() - days * 86400000));
  const match = { day: { $gte: since }, ...(batch && mongoose.isValidObjectId(batch) ? { batch: oid(batch) } : {}) };
  const grouped = await PlanView.aggregate([
    { $match: match },
    { $group: { _id: { student: "$student", batch: "$batch" }, views: { $sum: "$views" }, lastAt: { $max: "$lastAt" }, firstDay: { $min: "$day" } } },
    { $sort: { lastAt: -1 } },
    { $limit: 2000 },
  ]);
  if (!grouped.length) return { rows: [], total: 0, page: 1, pages: 1 };

  const bought = await Purchase.find({
    student: { $in: [...new Set(grouped.map((g) => String(g._id.student)))].map(oid) },
    batch: { $in: [...new Set(grouped.map((g) => String(g._id.batch)))].map(oid) },
    status: "complete",
  }).select("student batch createdAt").lean();
  const boughtAt = new Map();
  for (const p of bought) {
    const k = `${p.student}:${p.batch}`;
    if (!boughtAt.has(k) || boughtAt.get(k) < p.createdAt) boughtAt.set(k, p.createdAt);
  }
  // Still interested: never bought it, or bought before they looked again.
  const open = grouped.filter((g) => {
    const at = boughtAt.get(`${g._id.student}:${g._id.batch}`);
    return !at || at < new Date(`${g.firstDay}T00:00:00Z`);
  });

  const pages = Math.max(1, Math.ceil(open.length / limit));
  const slice = open.slice((page - 1) * limit, page * limit);
  const Batch = require("../models/batchModel");
  const [students, batches] = await Promise.all([
    Student.find({ _id: { $in: slice.map((g) => g._id.student) } }).select("name email phoneNumber marketingOptOut").lean(),
    Batch.find({ _id: { $in: slice.map((g) => g._id.batch) } }).select("name").lean(),
  ]);
  const sMap = new Map(students.map((s) => [String(s._id), s]));
  const bMap = new Map(batches.map((b) => [String(b._id), b.name]));
  return {
    rows: slice.map((g) => {
      const s = sMap.get(String(g._id.student)) || {};
      return {
        student: { _id: g._id.student, name: s.name || "Student", email: s.email || "", phone: s.phoneNumber || "", optedOut: Boolean(s.marketingOptOut) },
        batch: { _id: g._id.batch, name: bMap.get(String(g._id.batch)) || "" },
        views: g.views,
        lastAt: g.lastAt,
      };
    }),
    total: open.length,
    page,
    pages,
  };
};

module.exports = { recordPlanView, cleanLead, saveLead, markJoined, interested, dayKey };
