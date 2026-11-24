const mongoose = require("mongoose");

// Practice had no attempt record at all — a student could read questions and
// solutions but nothing was stored. This is what makes weak topic detection,
// adaptive practice and "explain my mistake" possible outside of exams.

const practiceAttemptSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
      index: true,
    },
    // Optional: an archive attempt (no batch context) is stored with
    // batch: null, its own valid scope everywhere this is read — same
    // convention AiUsage/AiCredit already use for batch-less activity.
    batch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Batch",
      default: null,
    },
    question: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Question",
      required: true,
      index: true,
    },
    // Not required: a chapter-pool question (Question.topic === null) has
    // no topic to attribute this attempt to, only a chapter — the same
    // "topic XOR chapter" duality questionModel.js's own documents carry.
    // rankWeakTopics (utils/weakTopics.js) groups by this field and already
    // drops any group that doesn't resolve to a real Topic, so a
    // chapter-pool attempt naturally falls out of weak-topic ranking
    // without special-casing there — it has nothing to rank.
    topic: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Topic",
      index: true,
    },
    chapter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Chapter",
      index: true,
    },

    selectedOption: String,
    statementAnswers: [
      {
        index: Number,
        value: Boolean,
      },
    ],
    // Only set for a passage attempt — one entry per sub-question, each
    // graded independently like a standalone mcq. The top-level isCorrect
    // above is then "every sub-question correct", the same all-or-nothing
    // signal a plain mcq/mtf attempt already carries, so rankWeakTopics
    // needs no passage-specific branching.
    subAnswers: [
      {
        index: Number,
        selectedOption: String,
        isCorrect: Boolean,
      },
    ],
    // Only set for written questions, graded by AI against the question's
    // rubric — mcq/mtf attempts score against a fixed key and don't need
    // the actual answer kept around the way a written one is worth reviewing.
    answerText: String,
    // Coding: tests passed out of all of them (selectedOption is the language).
    codePassed: { type: Number, default: undefined },
    codeTotal: { type: Number, default: undefined },
    // Same image-attachment support as Submission.answerImages — a batch's
    // writtenAnswerImages toggle covers both real exams and practice, not
    // just one or the other.
    answerImages: {
      type: [String],
      default: undefined,
    },
    marksAwarded: Number,

    isCorrect: {
      type: Boolean,
      required: true,
    },
    timeSpentMs: {
      type: Number,
      default: 0,
    },
    // how many times this student has now seen this question
    seenCount: {
      type: Number,
      default: 1,
    },
  },
  { timestamps: true }
);

practiceAttemptSchema.index({ student: 1, topic: 1, createdAt: -1 });
// "Last attempt at this question" and the seen-before checks.
practiceAttemptSchema.index({ student: 1, question: 1, createdAt: -1 });

const PracticeAttempt = mongoose.model("PracticeAttempt", practiceAttemptSchema);
// The archive's own copy, per student per batch, apart from the batch's
// own practice.
PracticeAttempt.Archive = mongoose.model("ArchiveAttempt", practiceAttemptSchema.clone());
module.exports = PracticeAttempt;
