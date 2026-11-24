const mongoose = require("mongoose");
const cacheInvalidation = require("../utils/cacheInvalidation");
const { studentAccessTags } = require("../utils/cacheTags");

// The plan is snapshotted rather than referenced, so editing a batch plan
// never rewrites the terms someone already paid for.

const purchaseSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
      index: true,
    },
    batch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Batch",
      // Not required — a general AI-credit purchase (kind: "ai-credits",
      // batch unset on the plan itself) has no batch to attach to. Every
      // other purchase kind still always provides one; this only relaxes
      // the schema to allow the one case that genuinely has none.
      index: true,
    },

    plan: {
      label: { type: String, required: true },
      price: { type: Number, required: true },
      durationDays: { type: Number, default: null },
      isInfinite: { type: Boolean, default: false },
    },
    currency: {
      type: String,
      default: "USD",
      uppercase: true,
    },

    // Snapshotted alongside the plan, same reasoning: a coupon edited or
    // deactivated later must not rewrite what this student actually paid.
    coupon: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Coupon",
    },
    couponCode: String,
    // Snapshotted from the coupon at the moment of this purchase, same
    // reasoning as plan/discountAmount above: whether reuse was restricted
    // is a fact about this purchase, not something that should retroactively
    // change if the coupon's own setting is edited later. Also what the
    // partial unique index below actually keys off, since an index can't
    // reach into another collection to check the coupon's current setting.
    couponSingleUsePerStudent: {
      type: Boolean,
      default: false,
    },
    // Which specific short link (if any) led to this purchase — a coupon
    // can have several short links (different batches, different targets),
    // and couponCode alone can't say which one actually converted. Plain
    // string, not a ref to ShortLink: the link can be deleted later without
    // orphaning this record's own history of what happened.
    viaShortLink: {
      type: String,
      default: null,
    },
    discountAmount: {
      type: Number,
      default: 0,
    },
    // The student whose referral code this purchase used (snapshotted from
    // the coupon), and whether their reward was given (utils/referrals.js).
    referrer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      default: null,
      index: true,
    },
    referralRewarded: {
      type: Boolean,
      default: false,
    },
    // The campaign whose link the student opened in the 7 days before
    // buying (utils/campaigns.js attributionFor).
    campaign: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
      default: null,
      index: true,
    },
    // What was actually charged — plan.price minus discountAmount. Kept
    // separate from plan.price so a report can show list price and paid
    // price without recomputing the discount every time.
    amountPaid: Number,

    // Distinguishes an AI-credit purchase from a regular batch-access one
    // in the same history list — "batch" is the default (and every
    // existing purchase before this field existed) so nothing already in
    // the collection needs a migration to keep meaning what it always meant.
    kind: {
      type: String,
      enum: ["batch", "ai-credits"],
      default: "batch",
    },
    // Only meaningful when kind is "ai-credits" — how many calls this
    // specific purchase granted, for a receipt/history line to say
    // "50 credits" rather than just showing a price with nothing to attach
    // it to.
    credits: Number,

    provider: {
      type: String,
      default: "manual",
    },
    providerRef: String,
    // Our own checkout reference (purchaseController's newReference()),
    // stored alongside providerRef rather than instead of it because the
    // two are not interchangeable: providerRef is whatever a given gateway
    // treats as its own transaction id (Stripe/SSLCommerz/PayPal happen to
    // echo our reference back as that id, but Razorpay and bKash issue
    // their own and never see ours as anything but metadata). This field
    // is always our reference, regardless of provider, which is what lets
    // /purchases/verify/:sessionId find a purchase by the value every
    // provider's success redirect can actually carry — see
    // buildSuccessUrl() in purchaseController.js.
    checkoutReference: { type: String, index: true },
    transactionId: {
      type: String,
      index: true,
    },
    // Access ended early (a student promoted out of the batch). See
    // utils/accessWindow.js resolveExpiry.
    endedAt: { type: Date, default: null },
    status: {
      type: String,
      enum: ["pending", "complete", "failed", "refunded"],
      default: "pending",
      index: true,
    },

    // recorded by hand rather than paid through a gateway
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    note: String,

    startDate: {
      type: Date,
      default: Date.now,
    },
    endDate: Date,

    // Tax invoice, when turned on in Settings (utils/invoice.js).
    invoice: {
      number: String,
      issuedAt: Date,
      label: String,
      rate: Number,
      net: Number,
      tax: Number,
      taxId: String,
      // GST lines (CGST + SGST, or IGST); empty for a single tax.
      parts: [{ _id: false, label: String, rate: Number, amount: Number }],
      // Who it's billed to, as it was when issued.
      buyer: { name: String, contact: String, taxId: String, state: String },
      sellerState: String,
      creditNote: String,
      creditNoteAt: Date,
    },
  },
  { timestamps: true }
);

// Enforces "one redemption per student per coupon" at the database layer,
// not just in the read-then-create check purchaseController.js does first,
// for coupons that actually opted into that restriction
// (couponSingleUsePerStudent — see couponModel.js's limitOnePerStudent).
// That check (Purchase.exists, then later Purchase.create) has a race
// window between the two — two concurrent requests from the same student
// can both read "not yet redeemed" before either has created its Purchase.
// A partial unique index closes it: the second concurrent insert for the
// same {student, coupon} pair fails with a duplicate-key error instead of
// silently succeeding. Restricted to couponSingleUsePerStudent: true so a
// coupon meant to be freely reused (the default) is never constrained by
// this at all — a student can hold any number of complete purchases against
// the same reusable coupon.
purchaseSchema.index(
  { student: 1, coupon: 1 },
  { unique: true, partialFilterExpression: { coupon: { $exists: true }, status: "complete", couponSingleUsePerStudent: true } }
);

// batchAccess.js looks this up on every batch request a student makes.
purchaseSchema.index({ student: 1, batch: 1, status: 1 });

// The earnings page: completed sales in a date range, newest first.
purchaseSchema.index({ status: 1, createdAt: -1 });

purchaseSchema.pre("save", function (next) {
  if (this.amountPaid === undefined || this.amountPaid === null) {
    this.amountPaid = Math.max(0, (this.plan?.price || 0) - (this.discountAmount || 0));
  }

  if (this.plan.isInfinite) {
    this.endDate = new Date("9999-12-31T23:59:59Z");
    return next();
  }

  if (this.isModified("startDate") || this.isModified("plan") || !this.endDate) {
    const days = this.plan.durationDays || 0;
    this.endDate = new Date(new Date(this.startDate).getTime() + days * 86400000);
  }

  return next();
});

purchaseSchema.pre("save", async function () {
  if (["complete", "refunded"].includes(this.status)) await require("../utils/invoice").assign(this);
});

// Writes here drop the cached reads built from them (utils/cacheInvalidation.js).
purchaseSchema.plugin(cacheInvalidation, { tags: studentAccessTags });

module.exports = mongoose.model("Purchase", purchaseSchema);
