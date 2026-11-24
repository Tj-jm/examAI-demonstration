const mongoose = require("mongoose");

// A student's place with one written question in Learn mode (study cards,
// controllers/app/learnController.js): a Leitner box and when the card is
// next due. Rating "again" sends it back to the first box, "good" moves it
// up one; higher boxes come back less often.
const learnCardSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true },
    batch: { type: mongoose.Schema.Types.ObjectId, ref: "Batch", required: true },
    question: { type: mongoose.Schema.Types.ObjectId, ref: "Question", required: true },
    box: { type: Number, default: 0, min: 0, max: 5 },
    dueAt: { type: Date, default: Date.now },
    lastRating: { type: String, enum: ["again", "partly", "good"] },
    reviews: { type: Number, default: 0 },
  },
  { timestamps: true }
);

learnCardSchema.index({ student: 1, batch: 1, question: 1 }, { unique: true });

module.exports = mongoose.model("LearnCard", learnCardSchema);
