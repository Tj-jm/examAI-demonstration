const mongoose = require("mongoose");

// One row per student per lecture. Resume position and "watched" both live
// here rather than on Student or Lecture, so a dashboard can query "this
// student's progress across every lecture in a batch" in one indexed query.

const lectureProgressSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
      index: true,
    },
    lecture: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lecture",
      required: true,
      index: true,
    },
    batch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Batch",
      required: true,
    },
    lastPositionSeconds: {
      type: Number,
      default: 0,
    },
    completedAt: Date,
    lastWatchedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

lectureProgressSchema.index({ student: 1, lecture: 1 }, { unique: true });
lectureProgressSchema.index({ student: 1, batch: 1, lastWatchedAt: -1 });

module.exports = mongoose.model("LectureProgress", lectureProgressSchema);
