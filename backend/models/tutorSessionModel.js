const mongoose = require("mongoose");

// One AI Tutoring session (aiTutorController.js). Layouts chat and book: an AI
// tutor asks about one lecture in writing, follows up and marks each answer
// (same turns as an Oral Quiz). Layout paper: one creative question, a
// stimulus and four parts the student answers and the AI marks.
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
    // teacher feedback: the words of the student's answer that were wrong.
    wrongPart: String,
    // student answer: drawn pages or photos, uploaded through the app.
    images: { type: [String], default: undefined },
  },
  { _id: false, timestamps: { createdAt: true, updatedAt: false } }
);

const tutorSessionSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true, index: true },
    batch: { type: mongoose.Schema.Types.ObjectId, ref: "Batch", required: true },
    lecture: { type: mongoose.Schema.Types.ObjectId, ref: "Lecture", required: true },
    lectureTitle: String,
    // The lesson's language (from its material): the teacher speaks it.
    language: { type: String, enum: ["Bangla", "English"], default: "English" },
    status: { type: String, enum: ["active", "done"], default: "active" },
    // Fixed when the session starts, so changing the setting later doesn't
    // break a session in progress.
    layout: { type: String, enum: ["chat", "book", "paper"], default: "chat" },
    // The scoring settings (AiConfig.aiTutor) when the session started.
    scoring: {
      strictness: String,
      hintPenalty: Number,
      stepMarking: Boolean,
      criteriaWeight: Number,
    },
    paper: {
      stimulus: String,
      parts: [{
        _id: false,
        question: String,
        // Model answer: shown after the part is marked.
        model: String,
        marks: Number,
        answer: String,
        images: { type: [String], default: undefined },
        got: Number,
        feedback: String,
        wrongPart: String,
        paid: Boolean,
      }],
    },
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
      // With criteria counted: the marks-only score and the criteria's %.
      marksScore: Number,
      criteriaWeight: Number,
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

tutorSessionSchema.index({ student: 1, batch: 1, updatedAt: -1 });

module.exports = mongoose.model("TutorSession", tutorSessionSchema);
