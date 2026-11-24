const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Purchase = require("../../models/purchaseModel");
const Batch = require("../../models/batchModel");
const Coupon = require("../../models/couponModel");
const teamPay = require("../../utils/teamPay");

// Earning means money that actually landed — status: "complete" only.
// "pending" hasn't happened yet and "refunded" was given back, so both are
// excluded everywhere in this file; counting either would overstate
// revenue in a way that only shows up as a discrepancy against whatever
// the payment gateway's own dashboard says, days later.
//
// The date filter runs on createdAt (when the Purchase document was made,
// which happens at webhook-confirmation time — i.e. when the money was
// actually received), not startDate (when access begins). Those are
// usually the same moment but are not the same concept, and a report about
// earning has to mean the first one.
//
// Nothing here is ever summed across currencies into one blended number —
// $1 and ৳1 are not interchangeable, and a platform running Stripe for USD
// alongside SSLCommerz for BDT needs those kept apart at every level of
// this report, not just at the very top.

const buildMatch = async (query) => {
  const match = { status: "complete" };

  if (query.from || query.to) {
    match.createdAt = {};
    if (query.from) match.createdAt.$gte = new Date(query.from);
    // A bare date ("2026-01-31") means the whole of that day, not its
    // first millisecond.
    if (query.to) match.createdAt.$lte = /^\d{4}-\d{2}-\d{2}$/.test(query.to) ? new Date(`${query.to}T23:59:59.999Z`) : new Date(query.to);
  }

  if (query.batch && mongoose.isValidObjectId(query.batch)) match.batch = new mongoose.Types.ObjectId(query.batch);
  if (["batch", "ai-credits"].includes(query.kind)) match.kind = query.kind;
  if (query.provider) match.provider = String(query.provider);
  if (query.currency) match.currency = String(query.currency);
  if (query.coupon) match.couponCode = String(query.coupon).trim().toUpperCase();
  // A seller (representative): sales made with any of their coupons.
  if (query.seller && mongoose.isValidObjectId(query.seller)) {
    match.coupon = { $in: await Coupon.distinct("_id", { representative: query.seller }) };
  }

  return match;
};

// One aggregation, several facets — a single collection scan rather than
// four separate queries hitting the same Purchase documents four times.
const runFacets = async (match) => {
  const [result] = await Purchase.aggregate([
    { $match: match },
    {
      $facet: {
        byCurrencyAndKind: [
          { $group: { _id: { currency: "$currency", kind: "$kind" }, total: { $sum: "$amountPaid" }, count: { $sum: 1 } } },
        ],
        byBatch: [
          { $match: { kind: "batch" } },
          { $group: { _id: { batch: "$batch", currency: "$currency" }, total: { $sum: "$amountPaid" }, count: { $sum: 1 } } },
        ],
        aiPacks: [
          { $match: { kind: "ai-credits" } },
          {
            $group: {
              _id: { batch: "$batch", currency: "$currency" },
              total: { $sum: "$amountPaid" },
              credits: { $sum: "$credits" },
              count: { $sum: 1 },
            },
          },
        ],
        byProvider: [
          { $group: { _id: { provider: "$provider", currency: "$currency" }, total: { $sum: "$amountPaid" }, count: { $sum: 1 } } },
        ],
      },
    },
  ]);

  return result;
};

// Batch names are resolved separately rather than with a $lookup inside the
// aggregation — the number of distinct batches touched by a date range is
// always small, and a plain find() is easier to read than a pipeline join
// for what is genuinely just a label lookup.
const resolveBatchNames = async (batchIds) => {
  const ids = [...new Set(batchIds.filter(Boolean).map(String))];
  if (ids.length === 0) return new Map();

  const batches = await Batch.find({ _id: { $in: ids } }).select("name");
  return new Map(batches.map((b) => [String(b._id), b.name]));
};

//@desc   Revenue summary — grand totals per currency, batch-wise,
//        AI-pack-wise, and by payment provider, over an optional date range.
//@route  GET /api/admin/earnings/summary
//@access Private (owner, admin)
const getSummaryData = async (match) => {
  const facets = await runFacets(match);

  const names = await resolveBatchNames([
    ...facets.byBatch.map((r) => r._id.batch),
    ...facets.aiPacks.map((r) => r._id.batch),
  ]);

  // Grand totals per currency, batch revenue and AI revenue kept as
  // separate columns on the same row rather than one blended figure — the
  // whole point of calling AI packs out on their own in the first place.
  const byCurrency = new Map();
  for (const row of facets.byCurrencyAndKind) {
    const key = row._id.currency;
    if (!byCurrency.has(key)) {
      byCurrency.set(key, { currency: key, batchTotal: 0, aiTotal: 0, count: 0 });
    }
    const entry = byCurrency.get(key);
    entry.count += row.count;
    if (row._id.kind === "ai-credits") entry.aiTotal += row.total;
    else entry.batchTotal += row.total;
  }
  const currencyTotals = [...byCurrency.values()]
    .map((r) => ({ ...r, grandTotal: r.batchTotal + r.aiTotal }))
    .sort((a, b) => a.currency.localeCompare(b.currency));

  const byBatch = facets.byBatch
    .map((r) => ({
      batchId: r._id.batch,
      batchName: names.get(String(r._id.batch)) || "(deleted batch)",
      currency: r._id.currency,
      total: r.total,
      count: r.count,
    }))
    .sort((a, b) => b.total - a.total);

  const aiPacks = facets.aiPacks
    .map((r) => ({
      batchId: r._id.batch || null,
      // null batch is a general (platform-wide) AI pack, not tied to any
      // one batch's students — labelled explicitly rather than left blank,
      // since a blank cell in an export reads as missing data, not "general".
      batchName: r._id.batch ? (names.get(String(r._id.batch)) || "(deleted batch)") : "General",
      currency: r._id.currency,
      total: r.total,
      credits: r.credits,
      count: r.count,
    }))
    .sort((a, b) => b.total - a.total);

  const byProvider = facets.byProvider
    .map((r) => ({ provider: r._id.provider, currency: r._id.currency, total: r.total, count: r.count }))
    .sort((a, b) => b.total - a.total);

  return { currencyTotals, byBatch, aiPacks, byProvider };
};

const getSummary = asyncHandler(async (req, res) => {
  const match = await buildMatch(req.query);
  const data = await getSummaryData(match);
  res.status(200).json(data);
});

// Where each completed sale came from, first match wins: a student's
// referral code, a campaign the student clicked in the week before, a short link, a representative's coupon, any other
// coupon, recorded by hand, or nothing (the student found it alone).
const SOURCE = {
  $switch: {
    branches: [
      { case: { $ne: [{ $ifNull: ["$referrer", null] }, null] }, then: "referral" },
      { case: { $ne: [{ $ifNull: ["$campaign", null] }, null] }, then: "campaign" },
      { case: { $ne: [{ $ifNull: ["$viaShortLink", null] }, null] }, then: "shortLink" },
      { case: { $ne: [{ $ifNull: ["$_rep", null] }, null] }, then: "representative" },
      { case: { $ne: [{ $ifNull: ["$coupon", null] }, null] }, then: "coupon" },
      { case: { $eq: ["$provider", "manual"] }, then: "manual" },
    ],
    default: "direct",
  },
};

const top = (field, extra = {}) => [
  { $match: { [field]: { $ne: null }, ...extra } },
  { $group: { _id: { key: `$${field}`, currency: "$currency" }, total: { $sum: "$amountPaid" }, count: { $sum: 1 } } },
  { $sort: { count: -1, total: -1 } },
  { $limit: 15 },
];

//@desc   Sales by where they came from, with the top coupons, short links,
//        representatives and referring students
//@route  GET /api/earnings/sources
//@access Private (owner, admin)
const getSources = asyncHandler(async (req, res) => {
  const match = await buildMatch(req.query);
  const [facets] = await Purchase.aggregate([
    { $match: match },
    // Plain localField lookup (no sub-pipeline), so older MongoDB versions run it too.
    { $lookup: { from: "coupons", localField: "coupon", foreignField: "_id", as: "_c" } },
    { $addFields: { _rep: { $ifNull: [{ $arrayElemAt: ["$_c.representative", 0] }, null] } } },
    { $project: { _c: 0 } },
    { $addFields: { _source: SOURCE } },
    {
      $facet: {
        bySource: [
          { $group: { _id: { source: "$_source", currency: "$currency" }, total: { $sum: "$amountPaid" }, discount: { $sum: "$discountAmount" }, count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ],
        coupons: top("couponCode", { referrer: null }),
        shortLinks: top("viaShortLink"),
        representatives: top("_rep"),
        referrers: top("referrer"),
        campaigns: top("campaign"),
      },
    },
  ]);

  const ShortLink = require("../../models/shortLinkModel");
  const User = require("../../models/userModel");
  const Student = require("../../models/studentModel");
  const ids = (rows) => [...new Set(rows.map((r) => String(r._id.key)))];
  const Campaign = require("../../models/campaignModel");
  const [links, reps, students, camps] = await Promise.all([
    ShortLink.find({ code: { $in: ids(facets.shortLinks) } }).select("code clicks couponCode").populate("batch", "name").lean(),
    User.find({ _id: { $in: ids(facets.representatives) } }).select("name email").lean(),
    Student.find({ _id: { $in: ids(facets.referrers) } }).select("name email phone").lean(),
    Campaign.find({ _id: { $in: ids(facets.campaigns) } }).select("name stats.recipients stats.clicks").lean(),
  ]);
  const byKey = (list, key) => new Map(list.map((x) => [String(x[key]), x]));
  const linkOf = byKey(links, "code");
  const repOf = byKey(reps, "_id");
  const studentOf = byKey(students, "_id");
  const campaignOf = byKey(camps, "_id");
  const row = (r, extra) => ({ currency: r._id.currency, total: r.total, count: r.count, ...extra });

  res.status(200).json({
    bySource: facets.bySource.map((r) => ({ source: r._id.source, currency: r._id.currency, total: r.total, discount: r.discount, count: r.count })),
    coupons: facets.coupons.map((r) => row(r, { code: r._id.key })),
    shortLinks: facets.shortLinks.map((r) => {
      const link = linkOf.get(String(r._id.key));
      return row(r, {
        code: r._id.key,
        coupon: link?.couponCode || null,
        batch: link?.batch?.name || null,
        // All-time clicks: a short link keeps one counter, not one per day.
        clicks: link?.clicks ?? null,
      });
    }),
    representatives: facets.representatives.map((r) => {
      const u = repOf.get(String(r._id.key));
      return row(r, { name: u?.name || "(removed user)", email: u?.email || null });
    }),
    referrers: facets.referrers.map((r) => {
      const st = studentOf.get(String(r._id.key));
      return row(r, { studentId: r._id.key, name: st?.name || "(removed student)", contact: st?.email || st?.phone || null });
    }),
    campaigns: facets.campaigns.map((r) => {
      const c = campaignOf.get(String(r._id.key));
      return row(r, { campaignId: r._id.key, name: c?.name || "(deleted campaign)", recipients: c?.stats?.recipients ?? null, clicks: c?.stats?.clicks ?? null });
    }),
  });
});

// Day buckets for up to ~3 months, week buckets up to ~2 years, month
// buckets beyond that, so the chart stays readable at any range.
const bucketFor = (match) => {
  const from = match.createdAt?.$gte;
  const to = match.createdAt?.$lte || new Date();
  const days = from ? (to - from) / 86400000 : Infinity;
  return days <= 92 ? "day" : days <= 730 ? "week" : "month";
};

//@desc   Revenue over time, per currency, in day/week/month buckets
//@route  GET /api/earnings/trend
//@access Private (owner, admin)
const getTrend = asyncHandler(async (req, res) => {
  const match = await buildMatch(req.query);
  const unit = ["day", "week", "month"].includes(req.query.unit) ? req.query.unit : bucketFor(match);
  const format = unit === "month" ? "%Y-%m" : "%Y-%m-%d";
  // Weeks start on Monday: shift each date back to its Monday first
  // (plain $subtract, so older MongoDB versions run it too).
  const date = unit === "week"
    ? { $subtract: ["$createdAt", { $multiply: [{ $mod: [{ $add: [{ $dayOfWeek: "$createdAt" }, 5] }, 7] }, 86400000] }] }
    : "$createdAt";
  const rows = await Purchase.aggregate([
    { $match: match },
    { $group: { _id: { at: { $dateToString: { format, date } }, currency: "$currency" }, total: { $sum: "$amountPaid" }, count: { $sum: 1 } } },
    { $sort: { "_id.at": 1 } },
  ]);
  res.status(200).json({
    unit,
    rows: rows.map((r) => ({ at: r._id.at, currency: r._id.currency, total: r.total, count: r.count })),
  });
});

const escapeRegex = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

//@desc   The matching sales one page at a time, newest first, with a
//        search over the student (name, email, phone) or the payment id
//@route  GET /api/earnings/transactions
//@access Private (owner, admin)
const getTransactions = asyncHandler(async (req, res) => {
  const match = await buildMatch(req.query);
  const limit = Math.min(100, Math.max(10, Number(req.query.limit) || 25));
  const page = Math.max(1, Number(req.query.page) || 1);
  const q = String(req.query.q || "").trim().slice(0, 80);
  if (q) {
    const Student = require("../../models/studentModel");
    const rx = new RegExp(escapeRegex(q), "i");
    const students = await Student.find({ $or: [{ name: rx }, { email: rx }, { phone: rx }] }).select("_id").limit(500).lean();
    match.$or = [
      { student: { $in: students.map((st) => st._id) } },
      { transactionId: q },
      { providerRef: q },
      { checkoutReference: q },
      { couponCode: q.toUpperCase() },
    ];
  }
  const [items, total] = await Promise.all([
    Purchase.find(match)
      .select("student batch kind currency amountPaid discountAmount couponCode provider transactionId providerRef credits createdAt")
      .populate("student", "name email phone")
      .populate("batch", "name")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Purchase.countDocuments(match),
  ]);
  res.status(200).json({ items, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

//@desc   Which payment methods and currencies exist, for the filters
//@route  GET /api/earnings/options
//@access Private (owner, admin)
const getOptions = asyncHandler(async (req, res) => {
  const [providers, currencies] = await Promise.all([
    Purchase.distinct("provider", { status: "complete" }),
    Purchase.distinct("currency", { status: "complete" }),
  ]);
  res.status(200).json({ providers: providers.filter(Boolean).sort(), currencies: currencies.filter(Boolean).sort() });
});

//@desc   Sellers' sales and commission, and doubt solvers' answered doubts
//        and pay, for a date range; one person or everyone (utils/teamPay.js)
//@route  GET /api/earnings/team/sellers?from=&to=&seller=
//@route  GET /api/earnings/team/doubt-solvers?from=&to=&solver=
//@access Private (owner, admin)
const getTeamSellers = asyncHandler(async (req, res) => {
  res.status(200).json(await teamPay.sellers(req.query));
});
const getTeamDoubtSolvers = asyncHandler(async (req, res) => {
  res.status(200).json(await teamPay.doubtSolvers(req.query));
});

module.exports = { getSummary, getSummaryData, buildMatch, getSources, getTrend, getTransactions, getOptions, getTeamSellers, getTeamDoubtSolvers };
