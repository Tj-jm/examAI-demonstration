const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Payslip = require("../../models/payslipModel");
const User = require("../../models/userModel");
const storage = require("../../adapters/storage");
const teamPay = require("../../utils/teamPay");
const classPay = require("../../utils/classPay");

// Team payslips (models/payslipModel.js). Owner and admin make, issue and
// pay them; every team member sees and confirms only their own, and never a
// draft.

const isAdmin = (user) => ["owner", "admin"].includes(user?.role);
const PAGE = 20;

const cleanLines = (lines) => (Array.isArray(lines) ? lines : []).slice(0, 50).map((l) => {
  const kind = ["grading", "doubts", "sales", "classes", "bonus", "deduction", "other"].includes(l?.kind) ? l.kind : "other";
  let amount = Math.round((Number(l?.amount) || 0) * 100) / 100;
  if (kind === "deduction") amount = -Math.abs(amount);
  if (kind === "bonus") amount = Math.abs(amount);
  return {
    kind,
    label: String(l?.label || "").trim().slice(0, 200) || kind,
    quantity: l?.quantity === null || l?.quantity === undefined || l?.quantity === "" ? null : Number(l.quantity) || 0,
    rate: l?.rate === null || l?.rate === undefined || l?.rate === "" ? null : Number(l.rate) || 0,
    amount,
  };
});

const date = (v) => {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

const find = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) { res.status(404); throw new Error("Payslip not found."); }
  const slip = await Payslip.findById(req.params.id);
  if (!slip) { res.status(404); throw new Error("Payslip not found."); }
  return slip;
};

// A member may only see their own, and never a draft.
const findForViewer = async (req, res) => {
  const slip = await find(req, res);
  if (!isAdmin(req.user) && (String(slip.user) !== String(req.user._id) || slip.status === "draft")) {
    res.status(404);
    throw new Error("Payslip not found.");
  }
  return slip;
};

// Two admins saving at once can pick the same number; the unique index
// refuses the second, which simply tries again.
const saveNew = async (slip) => {
  for (let i = 0; ; i += 1) {
    try {
      return await slip.save();
    } catch (err) {
      if (err?.code !== 11000 || i >= 3) throw err;
      slip.number = undefined;
    }
  }
};

//@desc   Payslips, newest first, with filters
//@route  GET /api/payslips?user=&role=&status=&from=&to=&page=
//@access Private (owner, admin)
const listPayslips = asyncHandler(async (req, res) => {
  const q = {};
  if (req.query.user && mongoose.isValidObjectId(req.query.user)) q.user = req.query.user;
  if (req.query.role) q.role = String(req.query.role);
  if (req.query.status) q.status = String(req.query.status);
  const when = teamPay.range(req.query.from, req.query.to);
  if (when) q.periodTo = when;
  const page = Math.max(1, Number(req.query.page) || 1);

  const [items, total, owed] = await Promise.all([
    Payslip.find(q).sort({ createdAt: -1 }).skip((page - 1) * PAGE).limit(PAGE).lean(),
    Payslip.countDocuments(q),
    Payslip.aggregate([
      { $match: { ...q, status: { $in: ["issued", "paid", "confirmed", "disputed"] } } },
      { $group: { _id: { currency: "$currency", paid: { $in: ["$status", ["paid", "confirmed"]] } }, total: { $sum: "$total" }, count: { $sum: 1 } } },
    ]),
  ]);

  const summary = new Map();
  for (const r of owed) {
    const e = summary.get(r._id.currency) || { currency: r._id.currency, paid: 0, due: 0, paidCount: 0, dueCount: 0 };
    if (r._id.paid) { e.paid += r.total; e.paidCount += r.count; } else { e.due += r.total; e.dueCount += r.count; }
    summary.set(r._id.currency, e);
  }

  res.status(200).json({ items, total, page, pages: Math.max(1, Math.ceil(total / PAGE)), summary: [...summary.values()] });
});

//@desc   Team members a payslip can be made for
//@route  GET /api/payslips/people
//@access Private (owner, admin)
const listPeople = asyncHandler(async (req, res) => {
  const people = await User.find({ role: { $in: ["admin", "teacher", "grader", "doubtSolver", "representative"] }, isDeleted: { $ne: true } })
    .select("name identifier email role isActive").sort({ role: 1, name: 1 }).lean();
  res.status(200).json(people.map((u) => ({ _id: u._id, name: u.identifier || u.name, email: u.email, role: u.role, isActive: u.isActive })));
});

//@desc   What a payslip for this person and period would say
//@route  GET /api/payslips/preview?user=&from=&to=&currency=
//@access Private (owner, admin)
const previewPayslip = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.query.user)) { res.status(400); throw new Error("Pick a team member."); }
  const out = await teamPay.suggestLines(req.query.user, req.query);
  if (!out) { res.status(404); throw new Error("Account not found."); }
  res.status(200).json(out);
});

//@desc   Make a payslip (a draft, or issued straight away)
//@route  POST /api/payslips
//@access Private (owner, admin)
const createPayslip = asyncHandler(async (req, res) => {
  const user = mongoose.isValidObjectId(req.body.user) ? await User.findById(req.body.user).select("name identifier role") : null;
  if (!user) { res.status(400); throw new Error("Pick a team member."); }
  const currency = String(req.body.currency || (await teamPay.settings()).currency || "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) { res.status(400); throw new Error("Pick a currency, like BDT or USD."); }
  const lines = cleanLines(req.body.lines);
  if (!lines.length) { res.status(400); throw new Error("Add at least one line."); }

  const slip = new Payslip({
    user: user._id,
    name: user.identifierOrName(),
    role: user.role,
    periodFrom: date(req.body.from),
    periodTo: date(req.body.to),
    currency,
    lines,
    note: String(req.body.note || "").slice(0, 2000),
    status: req.body.issue ? "issued" : "draft",
    issuedAt: req.body.issue ? new Date() : undefined,
    createdBy: req.user._id,
  });
  await saveNew(slip);
  res.status(201).json(slip);
});

//@desc   Edit a payslip's lines or note. Only before it's paid.
//@route  PUT /api/payslips/:id
//@access Private (owner, admin)
const updatePayslip = asyncHandler(async (req, res) => {
  const slip = await find(req, res);
  if (!["draft", "issued", "disputed"].includes(slip.status)) { res.status(400); throw new Error("A paid payslip can't be changed."); }
  if (req.body.lines !== undefined) {
    const lines = cleanLines(req.body.lines);
    if (!lines.length) { res.status(400); throw new Error("Add at least one line."); }
    slip.lines = lines;
  }
  if (req.body.note !== undefined) slip.note = String(req.body.note || "").slice(0, 2000);
  if (req.body.from !== undefined) slip.periodFrom = date(req.body.from);
  if (req.body.to !== undefined) slip.periodTo = date(req.body.to);
  await slip.save();
  res.status(200).json(slip);
});

//@desc   Show a draft (or a disputed one, after fixing it) to the member
//@route  POST /api/payslips/:id/issue
//@access Private (owner, admin)
const issuePayslip = asyncHandler(async (req, res) => {
  const slip = await find(req, res);
  if (!["draft", "disputed"].includes(slip.status)) { res.status(400); throw new Error("Only a draft or disputed payslip can be issued."); }
  slip.status = "issued";
  slip.issuedAt = new Date();
  await slip.save();
  res.status(200).json(slip);
});

//@desc   Record the payment
//@route  POST /api/payslips/:id/pay  { method, reference, paidAt, proofUrl }
//@access Private (owner, admin)
const payPayslip = asyncHandler(async (req, res) => {
  const slip = await find(req, res);
  if (!["draft", "issued", "disputed"].includes(slip.status)) { res.status(400); throw new Error("This payslip is already paid."); }
  const method = String(req.body.method || "").trim();
  if (!method) { res.status(400); throw new Error("Say how it was paid, like bKash or bank transfer."); }
  slip.payment = {
    method: method.slice(0, 60),
    reference: String(req.body.reference || "").trim().slice(0, 120),
    paidAt: date(req.body.paidAt) || new Date(),
    proofUrl: req.body.proofUrl ? String(req.body.proofUrl).slice(0, 1000) : slip.payment?.proofUrl,
    by: req.user._id,
  };
  if (!slip.issuedAt) slip.issuedAt = new Date();
  slip.status = "paid";
  slip.dispute = undefined;
  await slip.save();
  res.status(200).json(slip);
});

//@desc   Delete a payslip that hasn't been paid
//@route  DELETE /api/payslips/:id
//@access Private (owner, admin)
const deletePayslip = asyncHandler(async (req, res) => {
  const slip = await find(req, res);
  if (["paid", "confirmed"].includes(slip.status)) { res.status(400); throw new Error("A paid payslip is kept as a record."); }
  await slip.deleteOne();
  res.status(200).json({ ok: true });
});

//@desc   Upload a payment proof picture
//@route  POST /api/payslips/upload-proof
//@access Private (owner, admin)
const uploadProof = asyncHandler(async (req, res) => {
  if (!req.file) { res.status(400); throw new Error("Choose a picture."); }
  const stored = await storage.store("payslip-proofs", req.file);
  res.status(200).json({ url: await storage.urlFor(stored.key, stored.driver) });
});

//@desc   Class pay: each teacher's rate and the classes they took, priced
//@route  GET /api/payslips/class-pay?from=&to=&user=
//@access Private (owner, admin)
const getClassPay = asyncHandler(async (req, res) => {
  res.status(200).json(await classPay.report(req.query));
});

//@desc   A teacher's own classes in a period, with hours and pay
//@route  GET /api/payslips/class-pay/mine?from=&to=
//@access Private (any staff)
const myClassPay = asyncHandler(async (req, res) => {
  const out = await classPay.report({ from: req.query.from, to: req.query.to, user: req.user._id });
  res.status(200).json({ rules: out.rules, row: out.rows[0] || null });
});

//@desc   Set someone's class pay rate
//@route  PUT /api/payslips/class-pay/rates/:userId  { mode, rate, overtime }
//@access Private (owner, admin)
const setClassRate = asyncHandler(async (req, res) => {
  const user = mongoose.isValidObjectId(req.params.userId) ? await User.findById(req.params.userId) : null;
  if (!user || user.isDeleted || !["owner", "admin", "teacher"].includes(user.role)) { res.status(404); throw new Error("Team member not found."); }
  const now = user.classPay?.toObject?.() || {};
  user.classPay = {
    mode: req.body.mode !== undefined ? (req.body.mode === "class" ? "class" : "hour") : now.mode || "hour",
    rate: req.body.rate !== undefined ? Math.max(0, Math.round((Number(req.body.rate) || 0) * 100) / 100) : now.rate || 0,
    overtime: req.body.overtime !== undefined ? Boolean(req.body.overtime) : Boolean(now.overtime),
  };
  await user.save();
  res.status(200).json({ _id: user._id, classPay: user.classPay });
});

//@desc   This account's payslips (never drafts) and what's still due
//@route  GET /api/payslips/mine
//@access Private (any staff)
const myPayslips = asyncHandler(async (req, res) => {
  const items = await Payslip.find({ user: req.user._id, status: { $ne: "draft" } }).sort({ createdAt: -1 }).limit(200).lean();
  const totals = new Map();
  for (const p of items) {
    const e = totals.get(p.currency) || { currency: p.currency, paid: 0, due: 0 };
    if (["paid", "confirmed"].includes(p.status)) e.paid += p.total; else e.due += p.total;
    totals.set(p.currency, e);
  }
  res.status(200).json({ items, totals: [...totals.values()] });
});

//@desc   One payslip
//@route  GET /api/payslips/:id
//@access Private (owner, admin, or the member it's for)
const getPayslip = asyncHandler(async (req, res) => {
  res.status(200).json(await findForViewer(req, res));
});

//@desc   The member says they received the money
//@route  POST /api/payslips/:id/confirm
//@access Private (the member it's for)
const confirmPayslip = asyncHandler(async (req, res) => {
  const slip = await findForViewer(req, res);
  if (String(slip.user) !== String(req.user._id)) { res.status(403); throw new Error("Only the person it's for can confirm it."); }
  if (slip.status !== "paid") { res.status(400); throw new Error("Only a paid payslip can be confirmed."); }
  slip.status = "confirmed";
  slip.confirmedAt = new Date();
  await slip.save();
  res.status(200).json(slip);
});

//@desc   The member says something is wrong
//@route  POST /api/payslips/:id/dispute  { note }
//@access Private (the member it's for)
const disputePayslip = asyncHandler(async (req, res) => {
  const slip = await findForViewer(req, res);
  if (String(slip.user) !== String(req.user._id)) { res.status(403); throw new Error("Only the person it's for can raise this."); }
  if (!["issued", "paid"].includes(slip.status)) { res.status(400); throw new Error("This payslip can't be disputed now."); }
  const note = String(req.body.note || "").trim();
  if (!note) { res.status(400); throw new Error("Say what's wrong."); }
  slip.status = "disputed";
  slip.dispute = { note: note.slice(0, 2000), at: new Date() };
  await slip.save();
  res.status(200).json(slip);
});

module.exports = {
  listPayslips, listPeople, previewPayslip, createPayslip, updatePayslip, issuePayslip, payPayslip, deletePayslip, uploadProof,
  myPayslips, getPayslip, confirmPayslip, disputePayslip, getClassPay, myClassPay, setClassRate,
};
