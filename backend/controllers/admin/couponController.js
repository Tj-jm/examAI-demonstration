const asyncHandler = require("express-async-handler");
const Coupon = require("../../models/couponModel");
const Purchase = require("../../models/purchaseModel");

// redeemedCount on the coupon itself (incremented at checkout — see
// purchaseController.js) answers "how many times", cheaply, with no
// aggregation needed. It does not answer "how much money", which needs a
// pass over Purchase grouped by coupon — done once here for every coupon on
// the current page, not once per coupon, for the same reason the earnings
// report uses a single $facet rather than N separate queries.
const attachPerformance = async (coupons) => {
  const ids = coupons.map((c) => c._id);
  if (ids.length === 0) return coupons.map((c) => ({ ...c.toObject(), performance: [] }));

  const rows = await Purchase.aggregate([
    { $match: { coupon: { $in: ids }, status: "complete" } },
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

  return coupons.map((c) => ({ ...c.toObject(), performance: byCoupon.get(String(c._id)) || [] }));
};

//@desc   Paginated coupon list with performance per currency, filterable by
//        representative — "owner and admin can see all coupon activities".
//@route  GET /api/coupons
//@access Private (owner, admin)
const getCoupons = asyncHandler(async (req, res) => {
  const { representative, search, status } = req.query;
  const page = Number(req.query.page) || 1;
  const limit = Math.min(Number(req.query.limit) || 20, 100);

  // Students' referral codes and reward coupons are made and managed by
  // utils/referrals.js, not here.
  const query = { referrer: null, ownerStudent: null };
  if (representative) query.representative = representative;
  if (search) query.code = { $regex: search, $options: "i" };
  if (status === "active") query.isActive = true;
  if (status === "inactive") query.isActive = false;

  const [coupons, total] = await Promise.all([
    Coupon.find(query)
      .populate("batches", "name")
      .populate("representative", "name email")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Coupon.countDocuments(query),
  ]);

  res.status(200).json({
    coupons: await attachPerformance(coupons),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
  });
});

//@desc   One coupon, for the editor
//@route  GET /api/coupons/:id
//@access Private (owner, admin)
const getCoupon = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findById(req.params.id)
    .populate("batches", "name")
    .populate("representative", "name email");

  if (!coupon) {
    res.status(404);
    throw new Error("Coupon not found.");
  }

  const [shaped] = await attachPerformance([coupon]);
  res.status(200).json(shaped);
});

const ALLOWED_FIELDS = [
  "code", "discountType", "discountValue", "batches", "maxRedemptions",
  "expiresAt", "isActive", "representative", "products", "limitOnePerStudent",
];

const pick = (source, fields) =>
  Object.fromEntries(fields.filter((f) => source[f] !== undefined).map((f) => [f, source[f]]));

const validate = ({ discountType, discountValue, products }) => {
  if (discountType === "percent" && discountValue > 100) {
    return "A percentage discount can't be more than 100.";
  }
  if (products && products.length === 0) {
    return "A coupon has to apply to at least one of subscriptions or AI credit packs.";
  }
  return null;
};

//@desc   Create a coupon
//@route  POST /api/coupons
//@access Private (owner, admin)
const createCoupon = asyncHandler(async (req, res) => {
  const body = pick(req.body, ALLOWED_FIELDS);

  if (!body.code || !body.discountType || body.discountValue === undefined) {
    res.status(400);
    throw new Error("A coupon needs a code, a discount type and a value.");
  }

  const error = validate(body);
  if (error) {
    res.status(400);
    throw new Error(error);
  }

  const exists = await Coupon.findOne({ code: String(body.code).trim().toUpperCase() });
  if (exists) {
    res.status(409);
    throw new Error("A coupon with that code already exists.");
  }

  const coupon = await Coupon.create({ ...body, createdBy: req.user._id });
  await coupon.populate("batches", "name");
  await coupon.populate("representative", "name email");

  res.status(201).json({ ...coupon.toObject(), performance: [] });
});

//@desc   Update a coupon
//@route  PUT /api/coupons/:id
//@access Private (owner, admin)
const updateCoupon = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findById(req.params.id);

  if (!coupon) {
    res.status(404);
    throw new Error("Coupon not found.");
  }

  const body = pick(req.body, ALLOWED_FIELDS);
  const merged = { ...coupon.toObject(), ...body };

  const error = validate(merged);
  if (error) {
    res.status(400);
    throw new Error(error);
  }

  if (body.code) {
    const codeUpper = String(body.code).trim().toUpperCase();
    const clash = await Coupon.findOne({ code: codeUpper, _id: { $ne: coupon._id } });
    if (clash) {
      res.status(409);
      throw new Error("A coupon with that code already exists.");
    }
  }

  Object.assign(coupon, body);
  await coupon.save();
  await coupon.populate("batches", "name");
  await coupon.populate("representative", "name email");

  const [shaped] = await attachPerformance([coupon]);
  res.status(200).json(shaped);
});

//@desc   Delete a coupon. Purchases that already used it keep their own
//        snapshotted couponCode/discountAmount — deleting the coupon
//        document does not rewrite what anyone actually paid.
//@route  DELETE /api/coupons/:id
//@access Private (owner, admin)
const deleteCoupon = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findById(req.params.id);

  if (!coupon) {
    res.status(404);
    throw new Error("Coupon not found.");
  }

  await coupon.deleteOne();
  res.status(200).json({ message: "Coupon deleted." });
});

module.exports = { getCoupons, getCoupon, createCoupon, updateCoupon, deleteCoupon };
