const mongoose = require("mongoose");

// A practice exam (the student-built timed paper from CustomExamSetup, not
// the per-topic drilling flow — that already has its own PracticeAttempt
// collection and is untouched by this) used to create a real Exam and a
// real Submission and run through the exact same pipeline a teacher's exam
// does. That meant every practice attempt showed up in the admin panel next
// to real exams and their real submissions, with no way to tell them apart
// short of reading the title.
//
// Practice attempts are no longer persisted as Exam/Submission documents at
// all — see practiceExamController.js, which builds the paper, grades it,
// and returns the full result in one response with nothing written to
// either collection. This is the only thing that survives an attempt: a
// running average, one document per student per batch.
//
// Batch-scoped rather than per-student-global or per-topic-combination,
// matching how everything else in this app is scoped (see the project
// notes on batch-scoped student routes) — a student's record in one batch
// says nothing about a different batch's material, so averaging across
// them would blur two unrelated signals into one meaningless number.
const practiceRecordSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
    },
    // Optional — batch: null is the archive's own scope, still unique per
    // student via the index below, same convention as PracticeAttempt/
    // PracticeFavorite/StudyPlan.
    batch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Batch",
      default: null,
    },

    attemptCount: {
      type: Number,
      default: 0,
    },

    // The running average itself, stored rather than derived from a sum —
    // there is no per-attempt log to derive it from, by design. Recomputed
    // incrementally on each attempt (see recordAttempt below), which is
    // exact for an average and avoids ever needing the individual scores.
    averagePercent: {
      type: Number,
      default: 0,
    },

    lastAttemptAt: Date,
  },
  { timestamps: true }
);

practiceRecordSchema.index({ student: 1, batch: 1 }, { unique: true });

// The pure half of the running-average update, kept separate from the
// findOneAndUpdate call below so the arithmetic itself — the part a bug
// would actually hide in — can be unit tested without a database.
practiceRecordSchema.statics.nextAverage = function (oldAverage, oldCount, newScore) {
  const count = (oldCount || 0) + 1;
  return (oldAverage || 0) + (newScore - (oldAverage || 0)) / count;
};

// Incremental mean update: newAvg = oldAvg + (score - oldAvg) / newCount.
// Exact for a running average and needs no history of individual scores,
// which is the whole point — nothing per-attempt is kept.
practiceRecordSchema.statics.recordAttempt = async function (studentId, batchId, percent) {
  const record = await this.findOneAndUpdate(
    { student: studentId, batch: batchId },
    [
      {
        $set: {
          attemptCount: { $add: [{ $ifNull: ["$attemptCount", 0] }, 1] },
          averagePercent: {
            $add: [
              { $ifNull: ["$averagePercent", 0] },
              {
                $divide: [
                  { $subtract: [percent, { $ifNull: ["$averagePercent", 0] }] },
                  { $add: [{ $ifNull: ["$attemptCount", 0] }, 1] },
                ],
              },
            ],
          },
          lastAttemptAt: new Date(),
        },
      },
    ],
    { upsert: true, new: true }
  );

  return record;
};

const PracticeExamRecord = mongoose.model("PracticeExamRecord", practiceRecordSchema);
// Archive practice exams: the same running average, per student per batch,
// kept apart from the batch's own practice exams.
PracticeExamRecord.Archive = mongoose.model("ArchiveExamRecord", practiceRecordSchema.clone());
module.exports = PracticeExamRecord;
