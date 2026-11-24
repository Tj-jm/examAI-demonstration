const mongoose = require("mongoose");

// Some gateways cannot carry our metadata to the webhook and back.
//
// Stripe takes an arbitrary metadata object and Razorpay takes up to 15
// `notes`, so for those the checkout itself carries everything the webhook
// needs and nothing has to be stored in between — see the comment at the top
// of purchaseController.js, which is still true for them.
//
// SSLCommerz gives you exactly four pass-through fields (value_a..value_d).
// A batch purchase needs eleven. So for that class of gateway the metadata is
// parked here under our own transaction reference, and the webhook reads it
// back by that reference.
//
// This is deliberately NOT a "pending purchase" in the business sense. No
// access is granted from it, it is never shown to a student, and its
// existence means nothing except "a checkout page was opened". The Purchase
// collection remains the only record that money moved, which keeps the
// original design property intact: an abandoned checkout leaves no trace
// that could be mistaken for a paid one.

const pendingCheckoutSchema = new mongoose.Schema(
  {
    // Our own reference, sent to the gateway as its transaction id and
    // returned to us on the webhook. Also what Purchase.providerRef ends up
    // holding for these providers, so the duplicate guard works unchanged.
    reference: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    provider: {
      type: String,
      required: true,
      lowercase: true,
    },

    // The same object that would have travelled as gateway metadata. Left as
    // a free-form map on purpose: it mirrors whatever the checkout built, and
    // the webhook validates the fields it needs exactly as it does for a
    // provider that carried them itself.
    metadata: {
      type: Map,
      of: String,
      default: () => new Map(),
    },

    // Checked against what the gateway reports it actually charged. A gateway
    // that reports a different figure than the one we quoted is not a
    // purchase to honour — it is a tampered callback.
    amount: Number,
    currency: String,

    // Abandoned checkouts are the common case, not the exception, so these
    // expire themselves rather than accumulating forever. Twenty-four hours
    // is far longer than any hosted payment page stays valid, so a genuine
    // late webhook still finds its record.
    createdAt: {
      type: Date,
      default: Date.now,
      expires: 60 * 60 * 24,
    },
  },
  { timestamps: false }
);

pendingCheckoutSchema.methods.toMetadata = function () {
  return Object.fromEntries(this.metadata || new Map());
};

module.exports = mongoose.model("PendingCheckout", pendingCheckoutSchema);
