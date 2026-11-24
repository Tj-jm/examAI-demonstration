const mongoose = require("mongoose");

// Records which student actually uploaded which storage key, for the doubt
// reference images and written-answer images students attach to their own
// submissions. Nothing reads this for display — its only job is to answer
// "did this student really upload this file" when a doubt/answer/submission
// later claims a key as its questionImage/answerImages (see
// utils/mediaUrl.js's assertOwnMediaUrl). Without it, that check could only
// prove a key exists somewhere in this deployment's storage, not that the
// student submitting it is the one who put it there — a student could
// otherwise pass off any other file they'd merely seen the url of (a lecture
// attachment, another student's shared image) as their own.
//
// Content-addressed keys (see adapters/storage/index.js's keyFor) mean two
// different students who upload byte-identical files land on the same key —
// unique per (student, key) rather than per key alone, so that's allowed:
// each of them genuinely did upload it.
const studentUploadSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
      index: true,
    },
    folder: { type: String, required: true },
    // An answer photo with no camera data (a screenshot, a snip, a saved
    // image): see utils/photo.js hasCameraData. Grading flags it.
    noCamera: { type: Boolean, default: false },
  },
  { timestamps: true }
);

studentUploadSchema.index({ key: 1, student: 1 }, { unique: true });

module.exports = mongoose.model("StudentUpload", studentUploadSchema);
