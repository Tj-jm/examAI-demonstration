const mongoose = require("mongoose");

// One Oral Quiz session (poraController.js): an AI teacher asks a student
// about one lecture, follows up, and marks each answer; a report at the end.
// A "question" is a main question; follow-ups and hints belong to it.
const turnSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ["teacher", "student"], required: true },
    // teacher: question | followUp | hint | feedback | closing
    // student: answer | skip | hint
    kind: { type: String, required: true },
    text: { type: String, default: "" },
    // Which main question (1-based) this turn belongs to.
    q: { type: Number, default: 0 },
    // teacher question/followUp: the line of the material it is about,
    // checked to be really in it, and where it came from.
    quote: String,
    passage: String,
    sourceTitle: String,
    // teacher feedback on the answer before it.
    verdict: { type: String, enum: ["correct", "partial", "wrong", "skipped"] },
  },
  { _id: false, timestamps: { createdAt: true, updatedAt: false } }
);

const poraSessionSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true, index: true },
    batch: { type: mongoose.Schema.Types.ObjectId, ref: "Batch", required: true },
    lecture: { type: mongoose.Schema.Types.ObjectId, ref: "Lecture", required: true },
    lectureTitle: String,
    // The lesson's language (from its material): the teacher speaks it.
    language: { type: String, enum: ["Bangla", "English"], default: "English" },
    status: { type: String, enum: ["active", "done"], default: "active" },
    // Main questions asked so far, and the limit for this session.
    asked: { type: Number, default: 0 },
    limit: { type: Number, default: 5 },
    // Follow-ups asked on the current question.
    followUpsNow: { type: Number, default: 0 },
    // The current main question was paid for (its first answer counted).
    paidQ: { type: Number, default: 0 },
    hints: { type: Number, default: 0 },
    // Marks per main question, 0–10.
    marks: { type: [Number], default: [] },
    turns: { type: [turnSchema], default: [] },
    report: {
      score: Number,
      criteria: [{ _id: false, name: String, score: Number }],
      strengths: [String],
      weaknesses: [String],
      remark: String,
      language: String,
    },
    endedAt: Date,
  },
  { timestamps: true }
);

poraSessionSchema.index({ student: 1, batch: 1, updatedAt: -1 });

module.exports = mongoose.model("PoraSession", poraSessionSchema);
