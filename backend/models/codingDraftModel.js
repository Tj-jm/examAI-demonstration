const mongoose = require("mongoose");

// A student's latest code on a coding practice problem, so they can leave
// and come back to it. One per student per problem.
const codingDraftSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true },
    question: { type: mongoose.Schema.Types.ObjectId, ref: "Question", required: true },
    language: { type: String, default: "" },
    code: { type: String, default: "", maxlength: 50000 },
  },
  { timestamps: true }
);

codingDraftSchema.index({ student: 1, question: 1 }, { unique: true });

module.exports = mongoose.model("CodingDraft", codingDraftSchema);
