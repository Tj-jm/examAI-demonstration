const mongoose = require("mongoose");

// Coursework with a due date: homework, a project, a lab report. Students
// hand in text and/or files; staff grade it against an optional rubric.
// One batch each (a copy per batch when the same work goes to several).

const fileSchema = new mongoose.Schema(
  { url: { type: String, required: true }, name: { type: String, default: "" }, type: { type: String, default: "" } },
  { _id: false },
);

const assignmentSchema = new mongoose.Schema(
  {
    batch: { type: mongoose.Schema.Types.ObjectId, ref: "Batch", required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    // Markdown, like notices.
    instructions: { type: String, default: "", maxlength: 20000 },
    attachments: { type: [fileSchema], default: [] },
    // Which column of the gradebook it counts in (utils/gradebook.js).
    category: { type: String, trim: true, default: "Assignments", maxlength: 60 },
    opensAt: { type: Date, default: null }, // hidden from students until then
    dueAt: { type: Date, required: true },
    // Late work: refused once past the due date, or accepted for lateDays
    // more days with latePenalty percent off per day started.
    allowLate: { type: Boolean, default: false },
    lateDays: { type: Number, default: 3, min: 0, max: 60 },
    latePenalty: { type: Number, default: 10, min: 0, max: 100 },
    submissionType: { type: String, enum: ["text", "files", "both"], default: "both" },
    maxFiles: { type: Number, default: 5, min: 1, max: 10 },
    maxMarks: { type: Number, required: true, min: 0, max: 1000 },
    // Optional: rows a grader scores one by one; their sum is the mark.
    rubric: {
      type: [{ criterion: { type: String, required: true, trim: true }, marks: { type: Number, required: true, min: 0 }, guidance: { type: String, default: "" } }],
      default: [],
    },
    // A model answer or marking notes for graders (and AI checking). Never
    // shown to students.
    markingNotes: { type: String, default: "", maxlength: 20000 },
    isPublished: { type: Boolean, default: false },
    // When the assignment agent sent its "due soon" reminder.
    remindedAt: { type: Date, default: null },
    publishedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

assignmentSchema.index({ batch: 1, dueAt: -1 });

// The last moment a hand-in is accepted.
assignmentSchema.methods.closesAt = function () {
  const due = new Date(this.dueAt).getTime();
  return new Date(this.allowLate ? due + (this.lateDays || 0) * 86400000 : due);
};

// Percent taken off a hand-in made at `at` (0 when on time).
assignmentSchema.methods.penaltyFor = function (at) {
  const lateMs = new Date(at).getTime() - new Date(this.dueAt).getTime();
  if (lateMs <= 0) return 0;
  const days = Math.ceil(lateMs / 86400000);
  return Math.min(100, days * (this.latePenalty || 0));
};

const submissionSchema = new mongoose.Schema(
  {
    assignment: { type: mongoose.Schema.Types.ObjectId, ref: "Assignment", required: true, index: true },
    batch: { type: mongoose.Schema.Types.ObjectId, ref: "Batch", required: true, index: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true, index: true },
    text: { type: String, default: "", maxlength: 50000 },
    files: { type: [fileSchema], default: [] },
    // draft: saved, not handed in. submitted: waiting for a grade.
    // graded: marked, visible to the student once returned.
    status: { type: String, enum: ["draft", "submitted", "graded"], default: "draft" },
    submittedAt: { type: Date, default: null },
    latePenalty: { type: Number, default: 0 }, // percent, fixed at hand-in
    rubricScores: { type: [{ marks: Number, comment: { type: String, default: "" } }], default: [] },
    marks: { type: Number, default: null }, // before the late penalty
    finalMarks: { type: Number, default: null }, // after it: what counts
    feedback: { type: String, default: "", maxlength: 10000 },
    returned: { type: Boolean, default: false }, // the student can see the grade
    gradedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    gradedAt: { type: Date, default: null },
    // An AI suggestion (assignment checking, or the assignment agent):
    // never the grade until staff accept it.
    ai: {
      marks: { type: Number, default: null },
      rubricScores: { type: [{ marks: Number, comment: { type: String, default: "" } }], default: undefined },
      feedback: { type: String, default: "" },
      reasoning: { type: String, default: "" },
      by: { type: String, default: "" }, // "check" | "agent"
      at: { type: Date, default: null },
    },
  },
  { timestamps: true },
);

submissionSchema.index({ assignment: 1, student: 1 }, { unique: true });

const Assignment = mongoose.model("Assignment", assignmentSchema);
const AssignmentSubmission = mongoose.model("AssignmentSubmission", submissionSchema);

module.exports = { Assignment, AssignmentSubmission };
