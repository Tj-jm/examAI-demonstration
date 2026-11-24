const mongoose = require("mongoose");

// Which set of a paper-set group (examSetGroupModel.js) a student was given.
// One per student per group, kept for every attempt and every resume.
const examSetAssignmentSchema = new mongoose.Schema(
  {
    group: { type: mongoose.Schema.Types.ObjectId, ref: "ExamSetGroup", required: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true, index: true },
    exam: { type: mongoose.Schema.Types.ObjectId, ref: "Exam", required: true, index: true },
  },
  { timestamps: true }
);

examSetAssignmentSchema.index({ group: 1, student: 1 }, { unique: true });

module.exports = mongoose.model("ExamSetAssignment", examSetAssignmentSchema);
