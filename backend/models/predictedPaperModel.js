const mongoose = require("mongoose");

// One document per "Predicted paper" run (predictedPaperController.js) —
// persisted for the same reason QuestionAudit is: the run costs several AI
// calls, so a reload or navigating away must never lose it. Also the thing
// the admin comes back to after approving its AI-written questions in
// Review, to turn it into a real Exam.

const predictedTopicSchema = new mongoose.Schema(
  {
    topic: { type: mongoose.Schema.Types.ObjectId, ref: "Topic", default: null },
    chapter: { type: mongoose.Schema.Types.ObjectId, ref: "Chapter", default: null },
    title: String,
    likelihood: { type: String, enum: ["high", "medium", "low"] },
    share: Number,
    reason: String,
    yearsSeen: [{ _id: false, year: Number, count: Number }],
    realCount: { type: Number, default: 0 },
    aiCount: { type: Number, default: 0 },
  },
  { _id: false }
);

// A Schema instance rather than an inline literal — `origin` sits next to a
// ref here, and keeping the element a real Schema avoids Mongoose's "type"
// key heuristics (see questionAuditModel.js's duplicateQuestionRefSchema).
const paperQuestionSchema = new mongoose.Schema(
  {
    question: { type: mongoose.Schema.Types.ObjectId, ref: "Question", required: true },
    origin: { type: String, enum: ["real", "ai"], required: true },
    topicIndex: Number,
  },
  { _id: false }
);

const predictedPaperSchema = new mongoose.Schema(
  {
    authority: { type: mongoose.Schema.Types.ObjectId, ref: "ExamAuthority", required: true },
    subject: { type: mongoose.Schema.Types.ObjectId, ref: "Subject", required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    params: {
      count: Number,
      realShare: Number,
      types: [String],
      difficulty: String,
    },
    // generating → ready (or failed) → exam_created
    status: {
      type: String,
      enum: ["generating", "ready", "failed", "exam_created"],
      default: "generating",
      index: true,
    },
    error: String,
    warnings: [String],
    summary: String,
    years: [Number],
    predictedYear: Number,
    topics: [predictedTopicSchema],
    questions: [paperQuestionSchema],
    exam: { type: mongoose.Schema.Types.ObjectId, ref: "Exam", default: null },
    // Shared into the student archive as an untimed "Predicted set" for
    // every batch whose archive includes this board (archiveController.js).
    sharedAsSet: { type: Boolean, default: false, index: true },
    sharedAt: Date,
  },
  { timestamps: true }
);

module.exports = mongoose.model("PredictedPaper", predictedPaperSchema);
