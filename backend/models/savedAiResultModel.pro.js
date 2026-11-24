const mongoose = require("mongoose");

// AI results kept to be served again (utils/aiReuse.pro.js): sets of
// similar questions, hint chains and explanations of a wrong answer. Every
// student who asks the same thing about the same question can be given one
// of these instead of a new, billed AI call (Settings → Performance).
//
// A result belongs to one version of its question: contentKey is a hash of
// what the AI was shown, so editing the question's text, options or answer
// leaves the old results unmatched (and they are retired when next looked
// up). A change that doesn't touch the content, such as filing it under
// another topic, keeps them.
const savedAiResultSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["similar", "hint", "explanation"], required: true },
    question: { type: mongoose.Schema.Types.ObjectId, ref: "Question", required: true },
    contentKey: { type: String, required: true },
    // What else the result depends on: "sub:<n>" for a hint on one question
    // under a passage, the chosen option or true/false answers for an
    // explanation. Empty when nothing else.
    variant: { type: String, default: "" },
    // similar: { questions: [...] }; explanation: the explanation response.
    payload: { type: mongoose.Schema.Types.Mixed, default: null },
    // hint: the escalating hints in order, each written after the ones before.
    hints: { type: [String], default: undefined },

    // active: served. pending_review: waits for an admin (Settings →
    // Performance, approval "review"). retired: never served again.
    status: { type: String, enum: ["active", "pending_review", "retired"], default: "active" },
    servedCount: { type: Number, default: 0 },
    // The students given this result most recently, so one student isn't
    // handed the same similar set twice while another is available.
    servedTo: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    // The AI call that made it: who paid, and with which model.
    feature: { type: String, default: "" },
    model: { type: String, default: "" },
    // What the AI call(s) that made it cost, in USD: each serve saves this.
    costUsd: { type: Number, default: 0 },
    createdFor: { type: mongoose.Schema.Types.ObjectId, ref: "Student", default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

savedAiResultSchema.index({ kind: 1, question: 1, contentKey: 1, variant: 1, status: 1 });
savedAiResultSchema.index({ status: 1, kind: 1, createdAt: -1 });

module.exports = mongoose.model("SavedAiResult", savedAiResultSchema);
