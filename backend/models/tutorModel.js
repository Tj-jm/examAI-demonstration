const mongoose = require("mongoose");

// One student's tutor in one batch: on or off, an exam they're sprinting
// towards, their streak, and recent days' plans.
const taskSchema = new mongoose.Schema(
  {
    key: String,
    kind: { type: String, enum: ["practice", "lecture", "exam", "plan"] },
    title: String,
    detail: String,
    link: String,
    refId: { type: mongoose.Schema.Types.ObjectId, default: null },
    target: { type: Number, default: 1 },
    // kind "plan": which study plan day this is (utils/tutor.js).
    planDay: { type: Number, default: null },
    // What target counts: "questions", or "lectures" for a lecture plan day.
    unit: { type: String, default: "questions" },
  },
  { _id: false }
);

const tutorSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true },
    batch: { type: mongoose.Schema.Types.ObjectId, ref: "Batch", required: true },
    enabled: { type: Boolean, default: true },
    // Which study plan the tutor follows where the batch has the archive
    // and the student made both.
    planSource: { type: String, enum: ["batch", "archive"], default: "batch" },
    timezone: { type: String, default: "UTC" },
    sprint: {
      date: { type: Date, default: null },
      label: { type: String, default: "", maxlength: 120 },
      // Picked from the batch's exams (else the label was typed).
      exam: { type: mongoose.Schema.Types.ObjectId, ref: "Exam", default: null },
    },
    streak: { type: Number, default: 0 },
    bestStreak: { type: Number, default: 0 },
    lastCompleteDay: { type: String, default: null }, // YYYY-MM-DD in the student's timezone
    lastNudgeDay: { type: String, default: null },
    // Today's plan, kept for the day so it doesn't shift under the student.
    day: { type: String, default: null },
    // The study plan today's tasks were built from (its generatedAt): a new
    // plan rebuilds today's tasks.
    planStamp: { type: Date, default: null },
    // Last day the sprint showed the study plan backlog warning.
    lastBacklogWarnDay: { type: String, default: null },
    // Topics in the sprint's exam that are outside the batch's subjects,
    // so practice can't serve them (said once in the day's note).
    sprintOutside: { type: Number, default: 0 },
    tasks: { type: [taskSchema], default: [] },
  },
  { timestamps: true }
);

tutorSchema.index({ student: 1, batch: 1 }, { unique: true });

module.exports = mongoose.model("Tutor", tutorSchema);
