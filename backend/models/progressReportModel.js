const mongoose = require("mongoose");

// One progress report to one student (utils/progressReports.js): what it
// said, the private link to it, and every message sent about it. Kind
// "periodic" is the weekly/fortnightly/monthly summary; "result" is the
// instant message when one exam is graded. The unique index is what stops
// the same report going out twice, from a restart or a second server.
const deliverySchema = new mongoose.Schema(
  {
    recipient: { type: String, enum: ["student", "guardian"], required: true },
    channel: { type: String, enum: ["sms", "email"], required: true },
    to: { type: String, required: true },
    status: { type: String, enum: ["sent", "failed", "skipped"], required: true },
    error: { type: String, default: "" },
    parts: { type: Number, default: 0 }, // SMS parts billed
    at: { type: Date, default: Date.now },
  },
  { _id: true }
);

const progressReportSchema = new mongoose.Schema(
  {
    batch: { type: mongoose.Schema.Types.ObjectId, ref: "Batch", required: true, index: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true, index: true },
    kind: { type: String, enum: ["periodic", "result"], required: true },
    // The scheduled date ("2026-10-16"), "manual-<time>" for Send now, or
    // the submission id for a result.
    period: { type: String, required: true },
    from: { type: Date, default: null },
    to: { type: Date, default: null },
    frequency: { type: String, default: "" },
    language: { type: String, default: "en" },
    // What the report says, fixed when made: the link shows this, not
    // whatever the numbers are by the time it's opened.
    snapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
    smsText: { type: String, default: "" },
    token: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    deliveries: { type: [deliverySchema], default: [] },
    status: { type: String, enum: ["sending", "sent", "partial", "failed", "nothing"], default: "sending" },
    openedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

progressReportSchema.index({ batch: 1, student: 1, kind: 1, period: 1 }, { unique: true });
progressReportSchema.index({ createdAt: -1 });
progressReportSchema.index({ "deliveries.at": -1, "deliveries.channel": 1 });

module.exports = mongoose.model("ProgressReport", progressReportSchema);
