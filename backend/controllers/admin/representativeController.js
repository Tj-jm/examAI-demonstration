const asyncHandler = require("express-async-handler");
const User = require("../../models/userModel");
const Coupon = require("../../models/couponModel");
const Purchase = require("../../models/purchaseModel");

// The one place "how is this representative's coupon doing" gets computed —
// used by both getMyPerformance (a representative looking at themselves)
// and getPerformanceFor (an owner/admin looking at any one of them). Two
// entry points, one calculation, so the numbers a representative sees are
// provably the same numbers an admin would see for that same person —
// never a friendlier or a stricter version depending on who's asking.
//
// from/to are optional and filter by Purchase.createdAt — when a sale
// closed, not when the coupon was created. Omitted entirely means
// all-time, same as before this was added.
const buildPerformance = async (representativeId, { from, to } = {}) => {
  const coupons = await Coupon.find({ representative: representativeId })
    .populate("batches", "name")
    .sort({ createdAt: -1 });

  const ids = coupons.map((c) => c._id);

  const match = { coupon: { $in: ids }, status: "complete" };
  if (from || to) {
    match.createdAt = {};
    if (from) match.createdAt.$gte = new Date(from);
    if (to) match.createdAt.$lte = new Date(to);
  }

  const rows = ids.length === 0 ? [] : await Purchase.aggregate([
    { $match: match },
    {
      $group: {
        _id: { coupon: "$coupon", currency: "$currency" },
        revenue: { $sum: "$amountPaid" },
        discountGiven: { $sum: "$discountAmount" },
        count: { $sum: 1 },
      },
    },
  ]);

  const byCoupon = new Map();
  for (const row of rows) {
    const key = String(row._id.coupon);
    if (!byCoupon.has(key)) byCoupon.set(key, []);
    byCoupon.get(key).push({
      currency: row._id.currency,
      revenue: row.revenue,
      discountGiven: row.discountGiven,
      count: row.count,
    });
  }

  // A grand total per currency across every one of this representative's
  // coupons, not just per-coupon — the number they actually care about
  // first is "how much have I brought in overall", not "how did coupon #3
  // specifically do".
  const totalsByCurrency = new Map();
  for (const row of rows) {
    const key = row._id.currency;
    if (!totalsByCurrency.has(key)) totalsByCurrency.set(key, { currency: key, revenue: 0, discountGiven: 0, count: 0 });
    const entry = totalsByCurrency.get(key);
    entry.revenue += row.revenue;
    entry.discountGiven += row.discountGiven;
    entry.count += row.count;
  }

  return {
    coupons: coupons.map((c) => ({ ...c.toObject(), performance: byCoupon.get(String(c._id)) || [] })),
    totals: [...totalsByCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
  };
};

//@desc   A representative's own coupon performance — nothing else on this
//        admin panel is reachable from this role; see
//        middleware/representativeGate.js for how that's enforced.
//@route  GET /api/representatives/me/coupons?from=&to=
//@access Private (representative)
const getMyPerformance = asyncHandler(async (req, res) => {
  const data = await buildPerformance(req.user._id, { from: req.query.from, to: req.query.to });
  res.status(200).json(data);
});

//@desc   List every representative account, for the coupon editor's
//        attach-to-representative picker.
//@route  GET /api/representatives
//@access Private (owner, admin)
const listRepresentatives = asyncHandler(async (req, res) => {
  const reps = await User.find({ role: "representative" }).select("name email isActive").sort({ name: 1 });
  res.status(200).json(reps);
});

//@desc   An owner/admin viewing one representative's performance — the
//        exact same calculation as their own view, not a separate one.
//@route  GET /api/representatives/:id/coupons?from=&to=
//@access Private (owner, admin)
const getPerformanceFor = asyncHandler(async (req, res) => {
  const rep = await User.findOne({ _id: req.params.id, role: "representative" }).select("name email");
  if (!rep) {
    res.status(404);
    throw new Error("Representative not found.");
  }

  const data = await buildPerformance(rep._id, { from: req.query.from, to: req.query.to });
  res.status(200).json({ representative: rep, ...data });
});

//@desc   Every representative at once, ranked by revenue, for a given date
//        range — the "who's actually bringing in business" view, rather
//        than picking one representative at a time via getPerformanceFor.
//        One aggregation across every representative's coupons together,
//        not buildPerformance called once per representative — the same
//        reasoning getLeaderboard uses: a single pipeline scales the same
//        way regardless of how many representatives exist, where a loop
//        of N queries gets slower with every one added.
//@route  GET /api/representatives/summary?from=&to=
//@access Private (owner, admin)
const getAllPerformance = asyncHandler(async (req, res) => {
  const reps = await User.find({ role: "representative" }).select("name email isActive");
  if (reps.length === 0) {
    res.status(200).json({ representatives: [] });
    return;
  }

  const coupons = await Coupon.find({ representative: { $in: reps.map((r) => r._id) } }).select("representative");
  const repByCoupon = new Map(coupons.map((c) => [String(c._id), String(c.representative)]));
  const couponIds = coupons.map((c) => c._id);

  const match = { coupon: { $in: couponIds }, status: "complete" };
  if (req.query.from || req.query.to) {
    match.createdAt = {};
    if (req.query.from) match.createdAt.$gte = new Date(req.query.from);
    if (req.query.to) match.createdAt.$lte = new Date(req.query.to);
  }

  const rows = couponIds.length === 0 ? [] : await Purchase.aggregate([
    { $match: match },
    {
      $group: {
        _id: { coupon: "$coupon", currency: "$currency" },
        revenue: { $sum: "$amountPaid" },
        discountGiven: { $sum: "$discountAmount" },
        count: { $sum: 1 },
      },
    },
  ]);

  // Rows are grouped by coupon — re-grouped here by representative (via
  // the coupon→representative map above), since a representative usually
  // has more than one code and the number that matters is the combined
  // total across all of them, not per-coupon.
  const totalsByRep = new Map();
  for (const row of rows) {
    const repId = repByCoupon.get(String(row._id.coupon));
    if (!repId) continue;
    if (!totalsByRep.has(repId)) totalsByRep.set(repId, new Map());
    const byCurrency = totalsByRep.get(repId);
    const currency = row._id.currency;
    if (!byCurrency.has(currency)) byCurrency.set(currency, { currency, revenue: 0, discountGiven: 0, count: 0 });
    const entry = byCurrency.get(currency);
    entry.revenue += row.revenue;
    entry.discountGiven += row.discountGiven;
    entry.count += row.count;
  }

  const representatives = reps
    .map((rep) => ({
      _id: rep._id,
      name: rep.name,
      email: rep.email,
      isActive: rep.isActive,
      totals: [...(totalsByRep.get(String(rep._id))?.values() || [])].sort((a, b) => a.currency.localeCompare(b.currency)),
    }))
    // Highest-earning first, using whichever currency's revenue is
    // largest for that rep as the sort key — imperfect across mixed
    // currencies, but this is a ranking for a glance, not a ledger; the
    // per-currency totals underneath are what's actually authoritative.
    .sort((a, b) => (Math.max(0, ...b.totals.map((t) => t.revenue)) - Math.max(0, ...a.totals.map((t) => t.revenue))));

  res.status(200).json({ representatives });
});

module.exports = { getMyPerformance, listRepresentatives, getPerformanceFor, getAllPerformance };
