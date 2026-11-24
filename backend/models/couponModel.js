const mongoose = require("mongoose");

// Built now so the checkout flow never needs re-architecting to add a
// discount later — redemption counting and validity live here; actually
// creating and managing coupons from the admin panel is a small, separate
// follow-up on top of this.

const couponSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: [true, "Please add a code"],
      trim: true,
      uppercase: true,
      unique: true,
    },
    discountType: {
      type: String,
      enum: ["percent", "fixed"],
      required: true,
    },
    // percent: 0-100. fixed: a currency amount in the purchase's own currency.
    discountValue: {
      type: Number,
      required: [true, "Please add a discount value"],
      min: 0,
    },

    // Empty means valid for any batch. Scoping to specific batches is what
    // makes a coupon usable for a single-batch promotion rather than a
    // site-wide one.
    batches: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Batch",
      },
    ],

    // Which kind of purchase this coupon can discount — a batch
    // subscription plan, an AI credit pack, or (the default) both. Not
    // named appliesTo: that name is already a method on this schema for
    // batch-scoping, and a schema field with the same name would shadow it
    // on every document instance, silently breaking every call to it.
    // Always non-empty in practice — the admin UI never lets both boxes be
    // unchecked at once, so there is no "empty means everything" case to
    // handle the way batches has.
    products: {
      type: [String],
      enum: ["subscriptions", "aiCredits"],
      default: ["subscriptions", "aiCredits"],
    },
    maxRedemptions: {
      type: Number,
      default: null,
    },
    // Off by default: most coupons here fund a purchase (a renewal, adding
    // days to a subscription), and a student redeeming the same code again
    // later is exactly that, not abuse — maxRedemptions is what actually
    // caps how far a coupon can be milked overall. Turned on, this narrows
    // one specific coupon (a referral code, say) to one redemption per
    // student on top of that cap, for the cases where reuse by the same
    // student genuinely is the thing being guarded against.
    limitOnePerStudent: {
      type: Boolean,
      default: false,
    },
    redeemedCount: {
      type: Number,
      default: 0,
    },
    expiresAt: Date,
    isActive: {
      type: Boolean,
      default: true,
    },

    // Optional. Not one-to-one — a representative can have several codes
    // (a new one each campaign, say), so this points from coupon to
    // representative rather than the other way around. null means the
    // coupon isn't attributed to anyone, which is the default for every
    // coupon an owner/admin creates for themselves.
    representative: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    // Referrals (utils/referrals.js). A student's own referral code is a
    // coupon with `referrer` set: friends use it at checkout. A reward for
    // a friend's purchase is a one-use coupon with `ownerStudent` set, which
    // only that student may use. Neither shows in the admin coupon list.
    referrer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      default: null,
    },
    ownerStudent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      default: null,
      index: true,
    },
  },
  { timestamps: true }
);

// One referral code per student, even when two first requests race.
couponSchema.index({ referrer: 1 }, { unique: true, partialFilterExpression: { referrer: { $type: "objectId" } } });

couponSchema.methods.appliesTo = function (batchId) {
  return this.batches.length === 0 || this.batches.some((b) => String(b) === String(batchId));
};

couponSchema.methods.coversProduct = function (product) {
  return this.products.includes(product);
};

// product is required, not optional with a skip-if-absent default — a call
// site that forgets to pass it should fail closed (block the coupon
// everywhere) rather than silently succeed as if this check didn't exist.
couponSchema.methods.isValid = function (batchId, product) {
  if (!this.isActive) return false;
  if (this.expiresAt && this.expiresAt < new Date()) return false;
  if (this.maxRedemptions !== null && this.redeemedCount >= this.maxRedemptions) return false;
  if (!this.appliesTo(batchId)) return false;
  if (!this.coversProduct(product)) return false;
  return true;
};

// Rounded to two decimal places rather than left to float precision — a
// price of $19.99 discounted by 15% should not become $16.991499999999998.
couponSchema.methods.apply = function (price) {
  const discount = this.discountType === "percent" ? price * (this.discountValue / 100) : this.discountValue;
  return Math.max(0, Math.round((price - discount) * 100) / 100);
};

// Atomic claim-and-increment: the filter re-checks isActive and the
// redemption cap in the same operation that increments redeemedCount, so
// two concurrent redemptions racing the last slot can't both read the same
// "count < cap" snapshot and both write — only one findOneAndUpdate can
// match and increment; the loser gets null back and must not grant
// whatever it was about to grant. A plain `coupon.redeemedCount += 1;
// coupon.save()` (read-modify-write on a document already in memory) does
// not have this property: two requests loading the same coupon at once can
// each read the same starting count, each add one, and each save — one
// increment is silently lost and the cap can be redeemed past.
couponSchema.statics.tryRedeem = async function (couponId) {
  return this.findOneAndUpdate(
    {
      _id: couponId,
      isActive: true,
      $or: [{ maxRedemptions: null }, { $expr: { $lt: ["$redeemedCount", "$maxRedemptions"] } }],
    },
    { $inc: { redeemedCount: 1 } },
    { new: true }
  );
};

module.exports = mongoose.model("Coupon", couponSchema);
