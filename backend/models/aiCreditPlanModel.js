const mongoose = require("mongoose");

// A batch's own credit packages, same shape as the regular access plans on
// Batch itself — but this is a separate model, not another array on Batch,
// because it needs its own checkout flow and its own webhook handling
// distinct from granting batch access.
const aiCreditPlanSchema = new mongoose.Schema(
  {
    // Unset means a general, platform-wide pack — usable to cover any
    // batch's AI use, not just one. Set means it only shows up (and only
    // grants credit) for that specific batch. Both kinds share this same
    // model and the same admin CRUD screen, just filtered by whether batch
    // is present.
    batch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Batch",
      index: true,
    },
    label: {
      type: String,
      required: [true, "Give this credit pack a name"],
      trim: true,
    },
    credits: {
      type: Number,
      required: [true, "How many AI calls does this pack grant?"],
      min: 1,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AiCreditPlan", aiCreditPlanSchema);
