const mongoose = require("mongoose");

// One entry in a student's conduct record (admin panel → Conduct, and the
// student's own Account standing page):
//   abuse         — an abusive message to the AI or in a doubt
//   examViolation — an exam attempt's integrity flags (one entry per attempt,
//                   its count kept up to date)
//   disqualified  — an exam attempt disqualified by staff
//   warning       — a message from staff about the student's conduct
//   action        — something staff (or the automatic rule) did to the
//                   account: AI paused/resumed, suspended, reactivated
const KINDS = ["abuse", "examViolation", "disqualified", "warning", "action"];

const conductEventSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true },
    batch: { type: mongoose.Schema.Types.ObjectId, ref: "Batch", default: null },
    kind: { type: String, enum: KINDS, required: true },
    // Where it came from: course-chat, doubt, exam, staff, auto.
    source: { type: String, default: null },
    // The message that was flagged (abuse), or staff's note.
    text: { type: String, default: null },
    // abuse: "words" (the word list) or "ai" (the model judged it).
    flaggedBy: { type: String, default: null },
    submission: { type: mongoose.Schema.Types.ObjectId, ref: "Submission", default: null },
    exam: { type: mongoose.Schema.Types.ObjectId, ref: "Exam", default: null },
    count: { type: Number, default: 1 },
    // action: warn | pauseAi | resumeAi | suspend | reactivate
    action: { type: String, default: null },
    until: { type: Date, default: null },
    // open = not looked at yet; handled = staff dealt with it;
    // dismissed = a false alarm (doesn't count toward the automatic rule).
    status: { type: String, enum: ["open", "handled", "dismissed"], default: "open" },
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    handledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    handledAt: Date,
    appealTicket: { type: mongoose.Schema.Types.ObjectId, ref: "SupportTicket", default: null },
  },
  { timestamps: true }
);

conductEventSchema.index({ student: 1, createdAt: -1 });
conductEventSchema.index({ createdAt: -1 });
conductEventSchema.index({ submission: 1, kind: 1 });

module.exports = mongoose.model("ConductEvent", conductEventSchema);
module.exports.KINDS = KINDS;
