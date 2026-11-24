const mongoose = require("mongoose");
const cacheInvalidation = require("../utils/cacheInvalidation");
const tags = require("../utils/cacheTags");

// Paper sets: one pool of questions (copied from an ordinary exam) cut into
// several ordinary exams, Set A, Set B and so on. Each set is a normal Exam
// (Exam.paperSet points back here), so taking, marking and results work as
// for any exam. A student is given one set (examSetAssignmentModel.js):
//   random:   any set, the least-used first.
//   schedule: a set whose own opening window is open when they start.
// See utils/examSets.js and controllers/admin/examSetController.js.

const ruleSchema = new mongoose.Schema(
  {
    // Either may be null: any topic, or any difficulty.
    topic: { type: mongoose.Schema.Types.ObjectId, ref: "Topic", default: null },
    // Questions with no topic only (topic null alone means any topic).
    noTopic: { type: Boolean, default: false },
    difficulty: { type: String, enum: ["easy", "medium", "hard", null], default: null },
    label: { type: String, maxlength: 120 },
    count: { type: Number, min: 0, max: 500, required: true },
  },
  { _id: false }
);

const examSetGroupSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    // The exam the pool and the settings (duration, kind, attempts,
    // shuffle, away limit...) come from. It stays a draft.
    source: { type: mongoose.Schema.Types.ObjectId, ref: "Exam", required: true },
    pool: [{ type: mongoose.Schema.Types.ObjectId, ref: "Question" }],
    // Items per paper. A passage's written parts count as one item.
    perPaper: { type: Number, min: 1, max: 500, default: 10 },
    setCount: { type: Number, min: 2, max: 30, default: 4 },
    // Empty: draw from the whole pool.
    rules: { type: [ruleSchema], default: [] },
    assign: { type: String, enum: ["random", "schedule"], default: "random" },
    batches: [{ type: mongoose.Schema.Types.ObjectId, ref: "Batch", index: true }],
    // Random mode: every set opens and closes together.
    opensAt: { type: Date, default: null },
    closesAt: { type: Date, default: null },
    sets: [
      {
        _id: false,
        exam: { type: mongoose.Schema.Types.ObjectId, ref: "Exam" },
        label: String,
      },
    ],
    builtAt: { type: Date, default: null },
    isPublished: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

examSetGroupSchema.plugin(cacheInvalidation, { tags: () => [tags.EXAMS] });

module.exports = mongoose.model("ExamSetGroup", examSetGroupSchema);
