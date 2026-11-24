const mongoose = require("mongoose");

// A student's follow-up questions on one practice question they answered,
// and the AI's replies (utils/practiceQna.js). One thread per student,
// batch and question; kept so the conversation survives a reload and the
// per-question limit can't be dodged by starting over.
const practiceQnaSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true },
    batch: { type: mongoose.Schema.Types.ObjectId, ref: "Batch", required: true },
    question: { type: mongoose.Schema.Types.ObjectId, ref: "Question", required: true },
    messages: [
      {
        _id: false,
        role: { type: String, enum: ["student", "ai"], required: true },
        text: { type: String, required: true },
        // The solution line the student pointed at (1-based), if any.
        line: { type: Number, default: null },
        // An AI reply that declined an off-topic message.
        refused: { type: Boolean, default: false },
        at: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

practiceQnaSchema.index({ student: 1, batch: 1, question: 1 }, { unique: true });

module.exports = mongoose.model("PracticeQna", practiceQnaSchema);
