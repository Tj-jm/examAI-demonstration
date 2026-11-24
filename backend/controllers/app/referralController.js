const asyncHandler = require("express-async-handler");
const Coupon = require("../../models/couponModel");
const Purchase = require("../../models/purchaseModel");
const AppSettings = require("../../models/appSettingsModel");
const referrals = require("../../utils/referrals");

//@desc   My referral code, what it gives a friend and me, friends who
//        bought with it, and my reward coupons
//@route  GET /api/app/purchases/referrals
//@access Private (student)
const getMyReferrals = asyncHandler(async (req, res) => {
  const settings = await AppSettings.get();
  if (!referrals.isOn(settings)) return res.status(200).json({ enabled: false });

  const r = settings.referrals;
  const [coupon, friends, rewards] = await Promise.all([
    referrals.codeFor(req.student._id),
    Purchase.countDocuments({ referrer: req.student._id, status: "complete" }),
    Coupon.find({ ownerStudent: req.student._id }).sort({ createdAt: -1 }).limit(50)
      .select("code discountType discountValue redeemedCount maxRedemptions expiresAt isActive"),
  ]);

  res.status(200).json({
    enabled: true,
    code: coupon.code,
    currency: settings.defaultCurrency || "USD",
    discount: { type: r.discountType, value: r.discountValue },
    newStudentsOnly: r.newStudentsOnly !== false,
    reward: {
      kind: r.reward?.kind || "none",
      type: r.reward?.discountType,
      value: r.reward?.discountValue,
      credits: r.reward?.credits,
      validDays: r.reward?.validDays,
    },
    friends,
    rewards: rewards.map((c) => ({
      code: c.code,
      discount: { type: c.discountType, value: c.discountValue },
      used: c.maxRedemptions !== null && c.redeemedCount >= c.maxRedemptions,
      expired: Boolean(c.expiresAt && c.expiresAt < new Date()),
      expiresAt: c.expiresAt,
    })),
  });
});

//@desc   What a friend's referral code gives, for the landing page banner.
//        Says nothing about whose code it is.
//@route  GET /api/app/referral/:code
//@access Public
const checkReferralCode = asyncHandler(async (req, res) => {
  const settings = await AppSettings.get();
  const code = String(req.params.code || "").toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 40);
  if (!code || !referrals.isOn(settings)) return res.status(200).json({ valid: false });
  const coupon = await Coupon.findOne({ code, referrer: { $ne: null } }).select("discountType discountValue isActive expiresAt").lean();
  const valid = Boolean(coupon && coupon.isActive !== false && (!coupon.expiresAt || coupon.expiresAt > new Date()));
  if (!valid) return res.status(200).json({ valid: false });
  res.status(200).json({
    valid: true,
    code,
    discountType: coupon.discountType,
    discountValue: coupon.discountValue,
    currency: settings.defaultCurrency || "",
    newStudentsOnly: Boolean(settings.referrals?.newStudentsOnly),
  });
});

module.exports = { getMyReferrals, checkReferralCode };
