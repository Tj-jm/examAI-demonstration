const mongoose = require("mongoose");

// A signed-in student opened a batch's plans (purchaseController.js
// getBatchPlans): one row per student, batch and day. The Leads page lists
// those who looked and haven't bought. Kept 60 days.
const planViewSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true },
  batch: { type: mongoose.Schema.Types.ObjectId, ref: "Batch", required: true },
  day: { type: String, required: true }, // YYYY-MM-DD
  views: { type: Number, default: 1 },
  lastAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now, expires: 60 * 86400 },
});

planViewSchema.index({ student: 1, batch: 1, day: 1 }, { unique: true });
planViewSchema.index({ lastAt: -1 });

module.exports = mongoose.model("PlanView", planViewSchema);
