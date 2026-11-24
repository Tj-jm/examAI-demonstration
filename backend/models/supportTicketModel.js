const mongoose = require("mongoose");

// A student's support request and the conversation about it. "appeal"
// tickets are opened from the student's account standing page and point
// at the conduct event they dispute (see conductEventModel.js).
const CATEGORIES = ["payment", "technical", "content", "account", "appeal", "other"];
const STATUSES = ["open", "waiting", "resolved"];

const messageSchema = new mongoose.Schema(
  {
    from: { type: String, enum: ["student", "staff"], required: true },
    // Staff replies only: who wrote it.
    author: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    text: { type: String, default: "" },
    images: { type: [String], default: [] },
    at: { type: Date, default: Date.now },
  },
  { _id: true }
);

const supportTicketSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true },
    batch: { type: mongoose.Schema.Types.ObjectId, ref: "Batch", default: null },
    category: { type: String, enum: CATEGORIES, required: true },
    subject: { type: String, required: true, maxlength: 140 },
    // open = waiting on staff, waiting = waiting on the student.
    status: { type: String, enum: STATUSES, default: "open" },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    conductEvent: { type: mongoose.Schema.Types.ObjectId, ref: "ConductEvent", default: null },
    messages: { type: [messageSchema], default: [] },
    lastActivityAt: { type: Date, default: Date.now },
    // When the support agent last looked at it (agents/support.js): not
    // looked at again until the student writes something new.
    agentCheckedAt: { type: Date, default: null },
    // Which side has a reply it hasn't opened yet.
    unreadByStudent: { type: Boolean, default: false },
    unreadByStaff: { type: Boolean, default: true },
    resolvedAt: Date,
  },
  { timestamps: true }
);

supportTicketSchema.index({ student: 1, lastActivityAt: -1 });
supportTicketSchema.index({ status: 1, lastActivityAt: -1 });
supportTicketSchema.index({ assignedTo: 1, status: 1 });

module.exports = mongoose.model("SupportTicket", supportTicketSchema);
module.exports.CATEGORIES = CATEGORIES;
module.exports.STATUSES = STATUSES;
