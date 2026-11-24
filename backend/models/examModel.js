const mongoose = require("mongoose");
const cacheInvalidation = require("../utils/cacheInvalidation");
const tags = require("../utils/cacheTags");

// Because all three question types live in one collection, an exam holds a
// single ordered array. No refPath, no parallel questions[]/mtfQuestions[]
// arrays to keep in sync, and totalMarks is a real sum rather than
// questions.length * correctMarks.

const examSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Please add a title"],
      trim: true,
    },
    description: String,

    subjects: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Subject",
      },
    ],
    topics: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Topic",
      },
    ],

    questions: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Question",
      },
    ],

    batches: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Batch",
        index: true,
      },
    ],

    // Set only on exams a student built themselves (a timed practice exam
    // with their own choice of topics/types/duration) — null for every
    // exam a teacher or admin authored. getExams filters these out of the
    // shared list; getExamRules/startExam check this against req.student
    // so nobody else in the batch can find or take another student's
    // custom exam by guessing or enumerating ids.
    createdByStudent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      default: null,
      index: true,
    },

    mode: {
      type: String,
      enum: ["quiz", "test", "mock"],
      default: "test",
    },
    durationMinutes: {
      type: Number,
      required: [true, "Please add a duration"],
      min: 1,
    },
    // grace period after the timer for a submission still to be accepted
    // (network-latency allowance — a save or submit that lands within this
    // many seconds of the deadline is still honoured, nothing more)
    bufferSeconds: {
      type: Number,
      default: 90,
    },
    // A separate, much longer grace period, in minutes, for attaching
    // photographed answer scripts after the main timer runs out — distinct
    // from bufferSeconds above. Only meaningful on an exam with at least one
    // written question; 0 (the default) means no such window at all, and
    // the main timer's expiry submits immediately as before.
    scriptGraceMinutes: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Away limit: a student away from the exam (tab switched, page left)
    // for longer than awayMinutes in one go. "off" only flags it; "submit"
    // ends the attempt then and scores what was saved; "abandon" ends it
    // with zero. Unset on a new exam = the default under Conduct settings.
    awayMode: { type: String, enum: ["off", "submit", "abandon"] },
    awayMinutes: { type: Number, default: 5, min: 1 },
    // On-screen calculator during this exam: true / false, or null to
    // follow the batch's default (Batch.features.examCalculator).
    calculator: { type: Boolean, default: null },
    // mock only — hours the exam stays open after opensAt
    liveHours: Number,
    opensAt: Date,
    // Any exam: closes at this time. unpublishAt: jobs/examSchedule.js
    // unpublishes it then.
    closesAt: Date,
    unpublishAt: Date,

    // Tracked against jobs/examReminders.js's day-before/hour-before
    // reminder notifications — compared against the exam's CURRENT opensAt
    // (not a bare boolean), so editing the schedule re-arms both reminders
    // rather than needing a separate reset. Gotcha: this whole object must
    // always be reassigned wholesale when updating one field of it —
    // Mongoose doesn't track a mutation 2+ levels deep on a plain nested
    // schema like `exam.reminders.oneDaySentFor = ...` (see the project's
    // own notes on this exact trap).
    reminders: {
      oneDaySentFor: { type: Date, default: null },
      oneHourSentFor: { type: Date, default: null },
    },

    attemptsAllowed: {
      type: Number,
      default: 1,
      min: 1,
    },
    shuffleQuestions: {
      type: Boolean,
      default: false,
    },
    showResultImmediately: {
      type: Boolean,
      default: true,
    },

    isPublished: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: false,
    },

    source: {
      type: String,
      enum: ["manual", "ai"],
      default: "manual",
    },

    // One set of a paper-set group (examSetGroupModel.js): built from the
    // group's pool, and students reach it only through the group
    // (utils/examSets.js). Unset on every other exam.
    paperSet: {
      type: new mongoose.Schema({
        group: { type: mongoose.Schema.Types.ObjectId, ref: "ExamSetGroup", index: true },
        label: { type: String, maxlength: 4 },
      }, { _id: false }),
      default: undefined,
    },

    // An exam sat on paper at the centre; staff enter the marks on a sheet
    // (controllers/admin/offlineExamController.js). No questions, never
    // taken in the app; each student's mark is a graded submission.
    offline: {
      type: new mongoose.Schema({
        date: { type: Date, required: true },
        fullMarks: { type: Number, required: true, min: 1 },
        passMarks: { type: Number, default: null },
        // Optional per-question columns (label, max marks).
        parts: { type: [{ label: { type: String, maxlength: 40 }, max: { type: Number, min: 0 } }], default: [] },
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        // Who created or changed the sheet, and what changed.
        log: { type: [{ at: Date, by: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, note: String, _id: false }], default: [] },
      }, { _id: false }),
      default: undefined,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

examSchema.virtual("questionCount").get(function () {
  return Array.isArray(this.questions) ? this.questions.length : 0;
});

// Real sum over the questions. Requires questions to be populated; returns
// null when they are not, so a caller never silently reports a wrong total.
examSchema.methods.totalMarks = function () {
  if (this.offline?.fullMarks) return this.offline.fullMarks;
  if (!Array.isArray(this.questions) || this.questions.length === 0) return 0;
  if (!this.questions[0] || !this.questions[0].marks) return null;

  return this.questions.reduce((sum, q) => sum + (q.marks || 0), 0);
};

// A new exam takes the away-limit default from Conduct settings.
examSchema.pre("save", async function () {
  if (!this.isNew || this.awayMode) return;
  const conduct = (await require("./appSettingsModel").get()).conduct || {};
  this.awayMode = conduct.awayMode || "off";
  if (conduct.awayMinutes) this.awayMinutes = conduct.awayMinutes;
});

// Published and switched on, but its opening time is still ahead: the
// student app shows "Opens …" instead of "Closed". Null otherwise.
examSchema.methods.opensLater = function () {
  return this.isActive && this.isPublished && this.opensAt && this.opensAt > Date.now() ? this.opensAt : null;
};

// A mock closes on its own once liveHours has elapsed.
examSchema.methods.isOpen = function () {
  if (this.offline || !this.isActive || !this.isPublished) return false;

  if (this.opensAt && this.opensAt > Date.now()) return false;

  if (this.closesAt && this.closesAt <= Date.now()) return false;

  if (this.mode === "mock" && this.liveHours) {
    const start = this.opensAt || this.createdAt;
    const closesAt = new Date(start).getTime() + this.liveHours * 60 * 60 * 1000;
    if (Date.now() > closesAt) return false;
  }

  return true;
};

// Writes here drop the cached reads built from them (utils/cacheInvalidation.js).
examSchema.plugin(cacheInvalidation, { tags: () => [tags.EXAMS] });

// Leaderboards follow every write (utils/leaderboard.js; Pro).
examSchema.plugin(require("../utils/leaderboard").examHooks);

module.exports = mongoose.model("Exam", examSchema);
