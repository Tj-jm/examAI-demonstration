const mongoose = require("mongoose");

// A student asking for their account to be deleted. After the grace period
// it is either erased automatically or waits for staff to approve, per
// AppSettings.accountDeletion (see utils/accountDeletion.js).
//   pending   — in the grace period; the student can still cancel
//   awaiting  — grace over, waiting for staff approval
//   completed — erased
//   cancelled — the student changed their mind
//   rejected  — staff kept the account (with a note to the student)
const deletionRequestSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true },
    // Kept so the request still reads as someone after the erase.
    name: String,
    contact: String,
    reason: { type: String, default: "" },
    status: { type: String, enum: ["pending", "awaiting", "completed", "cancelled", "rejected"], default: "pending" },
    scheduledFor: { type: Date, required: true },
    handledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    note: { type: String, default: null },
    completedAt: Date,
  },
  { timestamps: true }
);

deletionRequestSchema.index({ status: 1, scheduledFor: 1 });
deletionRequestSchema.index({ student: 1, createdAt: -1 });

module.exports = mongoose.model("DeletionRequest", deletionRequestSchema);
