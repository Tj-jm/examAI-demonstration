const mongoose = require("mongoose");

// A teacher's remark on one student's report card for one batch.
const gradeRemarkSchema = new mongoose.Schema(
  {
    batch: { type: mongoose.Schema.Types.ObjectId, ref: "Batch", required: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true },
    text: { type: String, trim: true, maxlength: 1000, default: "" },
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

gradeRemarkSchema.index({ batch: 1, student: 1 }, { unique: true });

module.exports = mongoose.model("GradeRemark", gradeRemarkSchema);
