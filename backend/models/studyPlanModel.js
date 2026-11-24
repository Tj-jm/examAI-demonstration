const mongoose = require("mongoose");

// One plan per student per batch — regenerating replaces it wholesale
// rather than accumulating a history. The plan is meant to answer "what
// should I do next", not serve as an archive of old advice, matching how
// it's presented (student-triggered "Regenerate", not a log).
const studyPlanSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
      index: true,
    },
    // Optional — batch: null is the archive's own scope, still unique per
    // student via the index below (one archive-wide plan per student,
    // same as one plan per batch per student).
    batch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Batch",
      default: null,
      index: true,
    },

    summary: { type: String, required: true },

    // What was actually requested when this plan was built (3, 5 or 7) —
    // stored rather than re-derived from days.length so the UI can default
    // a regenerate's duration picker to "whatever this plan already is"
    // without having to infer it back from the array.
    durationDays: { type: Number, default: 7 },
    // The length picked (3, 5, 7, 15 or 30). durationDays above is what was
    // built, which can be shorter when the content is thin; the picker
    // shows this one.
    requestedDays: { type: Number, default: null },

    days: [
      {
        day: { type: Number, required: true }, // 1..durationDays
        focus: { type: String, required: true },
        // Student-checked, not inferred from practice activity — a day can
        // be "done" by watching the lecture alone, or the student may just
        // want to tick past a day they handled outside the app entirely.
        completed: { type: Boolean, default: false },
        // Ticked by the tutor from real work (utils/tutor.js), not by hand.
        autoDone: { type: Boolean, default: false },
        // Its questions or lectures are gone, or the batch's feature is off
        // (utils/tutor.js syncPlan). Skipped by the tutor; clears if the
        // content comes back.
        unavailable: { type: Boolean, default: false },
        // True only for the plan's final cumulative day (see
        // studyPlanController.js's buildSchedule) — every topic at once,
        // deliberately not narrowed by skill. The student-app uses this to
        // skip the practice modal's auto-skill-pick for this day
        // specifically, since "revision" means comprehensive review, not
        // one more skill-narrowed session.
        revision: { type: Boolean, default: false },
        // What kind of day this is, so the frontend knows which card to
        // render — "practice" (topics[] as always), "lecture" (watch
        // before that topic's practice), "exam" (a self-build exam — see
        // the `exam` field below), or "revision" (same as revision: true
        // above, kept as its own kind too so a caller can switch on this
        // one field instead of checking two). Defaults to "practice" so a
        // plan generated before this field existed still reads correctly.
        kind: { type: String, enum: ["practice", "lecture", "exam", "revision"], default: "practice" },
        // Present only when kind === "exam" — everything
        // buildPracticeExam/CustomExamSetup needs to launch this exact
        // paper with no setup screen (see StudyPlan.jsx's "Start exam").
        // topic/chapterPool mirror the same fields on topics[0], kept
        // alongside rather than read from there so an exam day's launch
        // params don't depend on topics[] never changing shape.
        exam: {
          topic: { type: mongoose.Schema.Types.ObjectId },
          chapterPool: { type: Boolean, default: false },
          title: { type: String },
          questionCount: { type: Number },
          types: { type: [String], default: ["mcq"] },
          durationMinutes: { type: Number },
        },
        topics: [
          {
            // Snapshotted title, not just a populate-on-read ref — the plan
            // should still read correctly days later even if the topic is
            // since renamed or removed from the bank. topic itself is kept
            // too, so a live link into practice for that topic is still
            // possible while it still exists. Never populated anywhere in
            // this codebase (checked before this comment was written), so
            // it's safe for this id to actually be a Chapter id instead of a
            // Topic one — see chapterPool below.
            topic: { type: mongoose.Schema.Types.ObjectId },
            // True when the id above is a Chapter id, not a Topic one — a
            // day built from a chapter-pool weak spot (utils/weakTopics.js),
            // where "topic" is doing double duty as "whatever this day's
            // practice link points at". Absent/false for every plan
            // generated before this field existed, which is the correct
            // reading for those too: they only ever pointed at real topics.
            chapterPool: { type: Boolean, default: false },
            title: { type: String, required: true },
            note: { type: String, required: true },
            // Which specific skill (recall, application, ...) this entry
            // targets — deterministically assigned in
            // studyPlanController.js's buildSchedule, weakest-skill-first
            // per topic. "none" is the miscellaneous-bucket sentinel
            // (questions with no skillType at all, same convention as
            // topic/chapter "none" filters elsewhere in this codebase).
            // Absent entirely only on the plan's final revision day, which
            // is deliberately not narrowed by skill.
            skillType: { type: String },
            // Snapshotted the same way `title` is — a lecture the topic
            // already had linked (see utils/weakTopics.js's lectureForTopic)
            // attached deterministically, not left to the model to name
            // correctly. Absent when the topic has no lecture to point at.
            lecture: {
              lecture: { type: mongoose.Schema.Types.ObjectId, ref: "Lecture" },
              title: { type: String },
            },
          },
        ],
      },
    ],

    generatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

studyPlanSchema.index({ student: 1, batch: 1 }, { unique: true });

const StudyPlan = mongoose.model("StudyPlan", studyPlanSchema);
// The archive's own copy, per student per batch, apart from the batch's
// own practice.
StudyPlan.Archive = mongoose.model("ArchiveStudyPlan", studyPlanSchema.clone());
module.exports = StudyPlan;
