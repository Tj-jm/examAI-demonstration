const mongoose = require("mongoose");

// Every model call is logged. Buyers ask for this on day one, and it is what
// makes per-batch and per-student caps enforceable.

const aiUsageSchema = new mongoose.Schema(
  {
    feature: {
      type: String,
      required: true,
      index: true,
    },
    provider: String,
    model: String,
    // A fallback after an earlier connection failed.
    fallback: { type: Boolean, default: false },

    promptTokens: { type: Number, default: 0 },
    completionTokens: { type: Number, default: 0 },
    // zero for local models, which is the whole point of supporting them
    estimatedCostUsd: { type: Number, default: 0 },

    latencyMs: Number,
    ok: { type: Boolean, default: true },
    errorMessage: String,
    // True when this call went through because the batch's free daily
    // allowance was already used up and a purchased AI credit covered it
    // instead — kept separate from ok/errorMessage so the usage dashboard
    // can show "how much of today's usage was free vs paid" at a glance.
    paidWithCredit: { type: Boolean, default: false },
    // Redundant with paidWithCredit for a free call (always 0 there), but
    // this is what makes a per-feature cost change auditable after the
    // fact — "how many credits did doubt-solve-image actually charge on
    // this date" reads straight off logged usage instead of needing to
    // cross-reference AiConfig's current (possibly since-changed) setting.
    creditsSpent: { type: Number, default: 0 },
    // What this call cost against the daily free allowance, regardless of
    // whether it ended up paid by that allowance or by a credit — this is
    // the field sumCostToday (ai/usage.js) sums to check the next call
    // against, so a cost-20 feature actually draws down 20 of a 50-point
    // daily budget instead of counting the same "1" a cost-1 feature does.
    // Defaults to 1 so any record logged before this field existed is
    // still read correctly (see the $ifNull in that aggregation) rather
    // than silently contributing 0 to historical totals.
    featureCost: { type: Number, default: 1 },
    // A saved AI result served again instead of a new call (Pro, Settings →
    // Performance): no tokens, and savedUsd is what generating it cost.
    reused: { type: Boolean, default: false },
    // Charge given back because the request it served failed (ai/chargeScope.js).
    refunded: { type: Boolean, default: false },
    savedUsd: { type: Number, default: 0 },

    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    batch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Batch",
      index: true,
    },
  },
  { timestamps: true }
);

aiUsageSchema.index({ createdAt: -1 });
aiUsageSchema.index({ student: 1, createdAt: -1 });

module.exports = mongoose.model("AiUsage", aiUsageSchema);
