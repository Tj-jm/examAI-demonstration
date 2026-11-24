const mongoose = require("mongoose");

// A bookmark, nothing more — deliberately not feeding into weak-topic
// scoring or any other analytics. A student might favorite a question for
// reasons that have nothing to do with getting it wrong (a well-written
// example worth revisiting, one they want to show someone, etc), so mixing
// this into the accuracy-based weak-topic signal would just add noise to
// an algorithm that has nothing to do with why something was bookmarked.
const practiceFavoriteSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
      index: true,
    },
    // Optional — see practiceAttemptModel.js's own comment on batch: null
    // meaning "archive-scoped", not "unset".
    batch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Batch",
      default: null,
    },
    question: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Question",
      required: true,
    },
  },
  { timestamps: true }
);

// One favorite per student per question — toggling twice in a row should
// flip it back off, never create a duplicate row.
practiceFavoriteSchema.index({ student: 1, question: 1 }, { unique: true });
practiceFavoriteSchema.index({ student: 1, batch: 1, createdAt: -1 });

const PracticeFavorite = mongoose.model("PracticeFavorite", practiceFavoriteSchema);
// The archive's own copy, per student per batch, apart from the batch's
// own practice.
PracticeFavorite.Archive = mongoose.model("ArchiveFavorite", practiceFavoriteSchema.clone());
module.exports = PracticeFavorite;
