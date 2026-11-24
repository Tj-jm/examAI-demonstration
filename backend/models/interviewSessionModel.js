const mongoose = require("mongoose");

// One interview practice session (interviewController.js). The panel asks
// out loud, the student answers out loud (or types, when the admin allows),
// each answer is marked and the report scores the criteria.
const turnSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ["interviewer", "student"], required: true },
    // interviewer: question | followUp | feedback | closing
    // student: answer | skip
    kind: { type: String, required: true },
    text: { type: String, default: "" },
    // Which main question (1-based) this turn belongs to.
    q: { type: Number, default: 0 },
    // Which interviewer (index into interviewers) speaks.
    by: { type: Number, default: 0 },
    verdict: { type: String, enum: ["strong", "ok", "weak", "skipped"] },
    // student answer: seconds taken; out of time.
    seconds: Number,
    timedOut: Boolean,
  },
  { _id: false, timestamps: { createdAt: true, updatedAt: false } }
);

const interviewSessionSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true, index: true },
    batch: { type: mongoose.Schema.Types.ObjectId, ref: "Batch", required: true },
    // Where it came from: an admin's interview, a lecture viva, or one the
    // student described.
    source: { type: String, enum: ["set", "lecture", "own"], default: "set" },
    set: { type: mongoose.Schema.Types.ObjectId, ref: "InterviewSet", default: null },
    lecture: { type: mongoose.Schema.Types.ObjectId, ref: "Lecture", default: null },
    // A copy of the setup, so editing the interview later doesn't change a
    // session in progress.
    title: String,
    kind: String,
    brief: String,
    interviewers: [{ _id: false, name: String, role: String, style: String }],
    criteria: [String],
    mustAsk: [String],
    language: { type: String, enum: ["Bangla", "English"], default: "English" },
    layout: { type: String, enum: ["panel", "board", "video"], default: "panel" },
    answerSeconds: { type: Number, default: 90 },
    status: { type: String, enum: ["active", "done"], default: "active" },
    asked: { type: Number, default: 0 },
    limit: { type: Number, default: 6 },
    followUpsNow: { type: Number, default: 0 },
    paidQ: { type: Number, default: 0 },
    // Marks per main question, 0–10.
    marks: { type: [Number], default: [] },
    turns: { type: [turnSchema], default: [] },
    report: {
      score: Number,
      criteria: [{ _id: false, name: String, score: Number }],
      strengths: [String],
      weaknesses: [String],
      tips: [String],
      // The weakest answer, said better.
      better: { question: String, answer: String },
      remark: String,
    },
    endedAt: Date,
  },
  { timestamps: true }
);

interviewSessionSchema.index({ student: 1, batch: 1, updatedAt: -1 });

module.exports = mongoose.model("InterviewSession", interviewSessionSchema);
