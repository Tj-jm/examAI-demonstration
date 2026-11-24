const mongoose = require("mongoose");
const AppSettings = require("../models/appSettingsModel");
const User = require("../models/userModel");
const Coupon = require("../models/couponModel");
const Purchase = require("../models/purchaseModel");
const Doubt = require("../models/doubtModel");

// What team members earned in a date range (Settings → Grading → Team pay).
//
//   Sellers (representatives): completed sales made with their coupons, per
//     currency, and a commission of sellerPercent on the amount paid.
//   Doubt solvers: doubts they answered (resolvedBy/resolvedAt) times
//     doubtRate, in the app's default currency.
//
// Grading pay stays in gradingController (payStats), class pay in
// utils/classPay.js. suggestLines() puts them all together for a payslip.

const round2 = (n) => Math.round(n * 100) / 100;

// "To" is a date: the whole of that day counts.
const range = (from, to) => {
  if (!from && !to) return null;
  const r = {};
  if (from) r.$gte = new Date(from);
  if (to) {
    const d = new Date(to);
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(to))) d.setUTCHours(23, 59, 59, 999);
    r.$lte = d;
  }
  return r;
};

const settings = async () => {
  const s = await AppSettings.get();
  const t = s.teamPay?.toObject?.() || s.teamPay || {};
  return { doubtRate: Number(t.doubtRate) || 0, sellerPercent: Number(t.sellerPercent) || 0, currency: s.defaultCurrency || "" };
};

const people = (role, id) => {
  const q = { role, isDeleted: { $ne: true } };
  if (id) q._id = id;
  return User.find(q).select("name identifier email isActive role").sort({ name: 1 }).lean();
};

// One row per seller: { user, sales, totals: [{ currency, revenue, discount, count, commission }] }.
const sellers = async ({ from, to, seller } = {}) => {
  const { sellerPercent } = await settings();
  const reps = await people("representative", seller && mongoose.isValidObjectId(seller) ? seller : null);
  const coupons = await Coupon.find({ representative: { $in: reps.map((r) => r._id) } }).select("representative").lean();
  const repByCoupon = new Map(coupons.map((c) => [String(c._id), String(c.representative)]));

  const match = { coupon: { $in: coupons.map((c) => c._id) }, status: "complete" };
  const when = range(from, to);
  if (when) match.createdAt = when;
  const rows = coupons.length ? await Purchase.aggregate([
    { $match: match },
    { $group: { _id: { coupon: "$coupon", currency: "$currency" }, revenue: { $sum: "$amountPaid" }, discount: { $sum: "$discountAmount" }, count: { $sum: 1 } } },
  ]) : [];

  const byRep = new Map();
  for (const row of rows) {
    const rep = repByCoupon.get(String(row._id.coupon));
    if (!byRep.has(rep)) byRep.set(rep, new Map());
    const cur = byRep.get(rep);
    const e = cur.get(row._id.currency) || { currency: row._id.currency, revenue: 0, discount: 0, count: 0 };
    e.revenue += row.revenue || 0;
    e.discount += row.discount || 0;
    e.count += row.count;
    cur.set(row._id.currency, e);
  }

  return {
    sellerPercent,
    rows: reps.map((u) => {
      const totals = [...(byRep.get(String(u._id))?.values() || [])]
        .map((t) => ({ ...t, revenue: round2(t.revenue), discount: round2(t.discount), commission: sellerPercent ? round2((t.revenue * sellerPercent) / 100) : null }))
        .sort((a, b) => a.currency.localeCompare(b.currency));
      return { user: u, sales: totals.reduce((n, t) => n + t.count, 0), totals };
    }).sort((a, b) => b.sales - a.sales),
  };
};

// One row per doubt solver: { user, answered, amount }. Owners and admins
// who answered doubts are listed too.
const doubtSolvers = async ({ from, to, solver } = {}) => {
  const { doubtRate, currency } = await settings();
  const id = solver && mongoose.isValidObjectId(solver) ? new mongoose.Types.ObjectId(String(solver)) : null;
  const match = { resolvedBy: id || { $ne: null } };
  const when = range(from, to);
  if (when) match.resolvedAt = when;
  const counts = await Doubt.aggregate([{ $match: match }, { $group: { _id: "$resolvedBy", count: { $sum: 1 } } }]);
  const byUser = new Map(counts.map((c) => [String(c._id), c.count]));

  const users = id
    ? await User.find({ _id: id }).select("name identifier email isActive role").lean()
    : await User.find({ $or: [{ _id: { $in: counts.map((c) => c._id) } }, { role: "doubtSolver", isDeleted: { $ne: true } }] })
      .select("name identifier email isActive role").sort({ name: 1 }).lean();

  return {
    doubtRate,
    currency,
    rows: users.map((u) => {
      const answered = byUser.get(String(u._id)) || 0;
      return { user: u, answered, amount: doubtRate ? round2(answered * doubtRate) : null };
    }).sort((a, b) => b.answered - a.answered),
  };
};

// What a payslip for this person and period would say, in one currency:
// grading, doubts and seller commission, each only when it applies.
const suggestLines = async (userId, { from, to, currency } = {}) => {
  const s = await settings();
  const cur = String(currency || s.currency || "").toUpperCase();
  const user = await User.findById(userId).select("name identifier role").lean();
  if (!user) return null;
  const lines = [];
  // Grading and doubt rates are in the app's default currency.
  const homeCurrency = !s.currency || cur === s.currency.toUpperCase();

  if (homeCurrency && ["owner", "admin", "teacher", "grader"].includes(user.role)) {
    // Lazy: the controller is big and only payslips need it here.
    const { payStats } = require("../controllers/admin/gradingController");
    const g = await payStats(userId, from, to);
    if (g.count) {
      lines.push({
        kind: "grading",
        label: g.payMode === "script" ? "Scripts graded" : "Answers graded",
        quantity: g.count,
        rate: g.rate || 0,
        amount: g.amount || 0,
      });
    }
  }

  // Live classes, at this person's own rate (utils/classPay.js; lazy, it
  // requires this file).
  if (homeCurrency) lines.push(...(await require("./classPay").linesFor(userId, { from, to })));

  const d = await doubtSolvers({ from, to, solver: userId });
  const doubts = d.rows[0]?.answered || 0;
  if (doubts && homeCurrency) {
    lines.push({ kind: "doubts", label: "Doubts answered", quantity: doubts, rate: s.doubtRate, amount: d.rows[0].amount || 0 });
  }

  if (user.role === "representative") {
    const r = await sellers({ from, to, seller: userId });
    const t = r.rows[0]?.totals.find((x) => x.currency === cur);
    if (t) {
      lines.push({
        kind: "sales",
        label: `Commission on ${t.count} sale${t.count === 1 ? "" : "s"} (${round2(t.revenue)} ${cur})`,
        quantity: t.count,
        rate: s.sellerPercent,
        amount: t.commission || 0,
      });
    }
  }

  return { user, currency: cur, lines };
};

module.exports = { settings, sellers, doubtSolvers, suggestLines, range, round2 };
