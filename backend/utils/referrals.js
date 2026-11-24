const crypto = require("crypto");
const Coupon = require("../models/couponModel");
const Purchase = require("../models/purchaseModel");
const AiCredit = require("../models/aiCreditModel");
const AppSettings = require("../models/appSettingsModel");

// Referrals ride on the coupon pipeline (purchaseController.js's
// resolvePriceAndCoupon), so pricing, previews, redemption counts and the
// per-student limit all work the way they already do for coupons:
//
// - A student's referral code is a Coupon with `referrer` set. It discounts
//   batch plans only, once per friend (limitOnePerStudent).
// - When a friend's paid purchase made with it completes, rewardReferral
//   gives the referrer their reward once: a one-use Coupon only they may
//   use (`ownerStudent`), or AI credits.
//
// Settings → Sales → Referrals holds the discount and reward. Changing the
// discount rewrites every referral code (syncReferralCodes) so the code a
// student shared always gives what the settings say today.

const fail = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

// No 0/O/1/I, so a code read out over the phone is typed right.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const randomCode = (prefix, length = 6) => {
  const bytes = crypto.randomBytes(length);
  let out = prefix;
  for (let i = 0; i < length; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
};

// Inserts a coupon under a fresh random code, retrying on the rare clash
// with an existing code (Coupon.code is unique).
const createWithCode = async (prefix, fields) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await Coupon.create({ ...fields, code: randomCode(prefix) });
    } catch (error) {
      if (error.code !== 11000 || error.keyPattern?.code !== 1) throw error;
    }
  }
  throw new Error("Could not make a unique code. Try again.");
};

const isOn = (settings) => Boolean(settings.referrals?.enabled) && settings.institution?.sales !== false;

// The student's referral coupon, made on first ask.
const codeFor = async (studentId) => {
  const existing = await Coupon.findOne({ referrer: studentId });
  if (existing) return existing;
  const settings = await AppSettings.get();
  const r = settings.referrals || {};
  try {
    return await createWithCode("R", {
      referrer: studentId,
      discountType: r.discountType || "percent",
      discountValue: r.discountValue ?? 10,
      products: ["subscriptions"],
      limitOnePerStudent: true,
      isActive: isOn(settings),
    });
  } catch (error) {
    // Two first asks at once: the other one made it.
    const made = await Coupon.findOne({ referrer: studentId });
    if (made) return made;
    throw error;
  }
};

// Every referral code follows the current settings.
const syncReferralCodes = async (settings) => {
  const r = settings.referrals || {};
  await Coupon.updateMany(
    { referrer: { $ne: null } },
    { $set: { discountType: r.discountType || "percent", discountValue: r.discountValue ?? 10, isActive: isOn(settings) } }
  );
};

// Extra rules for referral and reward coupons, on top of Coupon.isValid.
// Called wherever a coupon is resolved for a student; throws the error the
// student sees.
const checkUse = async (coupon, studentId) => {
  if (coupon.ownerStudent && String(coupon.ownerStudent) !== String(studentId)) {
    throw fail("That coupon is not valid for this plan.");
  }
  if (!coupon.referrer) return;
  if (String(coupon.referrer) === String(studentId)) {
    throw fail("You can't use your own referral code. Share it with a friend.");
  }
  const settings = await AppSettings.get();
  if (!isOn(settings)) throw fail("That coupon is not valid for this plan.");
  if (settings.referrals.newStudentsOnly !== false
    && (await Purchase.exists({ student: studentId, kind: "batch", status: "complete", amountPaid: { $gt: 0 } }))) {
    throw fail("Referral codes are for a first purchase only.");
  }
};

// Gives the referrer their reward for one completed purchase, once. Never
// throws: a reward that fails must not fail the purchase it rides on.
const rewardReferral = async (purchase) => {
  try {
    if (!purchase?.referrer || !(purchase.amountPaid > 0) || purchase.status !== "complete") return null;
    const settings = await AppSettings.get();
    const reward = settings.referrals?.reward || {};
    if (!isOn(settings) || !reward.kind || reward.kind === "none") return null;

    if (reward.maxPerStudent > 0) {
      const given = await Purchase.countDocuments({ referrer: purchase.referrer, referralRewarded: true });
      if (given >= reward.maxPerStudent) return null;
    }

    // Claimed first, so a redelivered webhook can't reward twice.
    const claim = await Purchase.updateOne({ _id: purchase._id, referralRewarded: { $ne: true } }, { $set: { referralRewarded: true } });
    if (!claim.modifiedCount) return null;

    const notify = require("./notify").notify;
    if (reward.kind === "aiCredits") {
      const credits = Math.max(0, Math.round(reward.credits || 0));
      if (!credits) return null;
      await AiCredit.updateOne({ student: purchase.referrer, batch: null }, { $inc: { balance: credits } }, { upsert: true });
      await notify(purchase.referrer, "referralReward", {
        title: `A friend joined with your code: ${credits} AI credits added`,
        link: "/purchases",
      }).catch(() => {});
      return { kind: "aiCredits", credits };
    }

    const coupon = await createWithCode("RW", {
      ownerStudent: purchase.referrer,
      discountType: reward.discountType || "percent",
      discountValue: reward.discountValue ?? 10,
      products: ["subscriptions"],
      maxRedemptions: 1,
      expiresAt: new Date(Date.now() + (reward.validDays || 90) * 86400000),
    });
    const off = coupon.discountType === "percent" ? `${coupon.discountValue}%` : `${coupon.discountValue} ${settings.defaultCurrency || ""}`.trim();
    await notify(purchase.referrer, "referralReward", {
      title: `A friend joined with your code: ${off} off your next purchase`,
      body: `Use code ${coupon.code} at checkout.`,
      link: "/purchases",
    }).catch(() => {});
    return { kind: "coupon", code: coupon.code };
  } catch (error) {
    console.error(`Referral reward for purchase ${purchase?._id} failed:`, error.message);
    return null;
  }
};

module.exports = { codeFor, syncReferralCodes, checkUse, rewardReferral, isOn };
