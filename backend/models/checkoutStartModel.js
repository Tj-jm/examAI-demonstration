const mongoose = require("mongoose");

// A paid checkout someone started (purchaseController.js startCheckout).
// The "checkout not finished" automation (utils/automations.js) looks for
// ones with no purchase after them. Kept 30 days.
const checkoutStartSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true, index: true },
    batch: { type: mongoose.Schema.Types.ObjectId, ref: "Batch", required: true },
    planLabel: String,
    reference: String,
    createdAt: { type: Date, default: Date.now, expires: 30 * 86400 },
  },
  { versionKey: false }
);

checkoutStartSchema.index({ createdAt: 1, batch: 1 });

module.exports = mongoose.model("CheckoutStart", checkoutStartSchema);
