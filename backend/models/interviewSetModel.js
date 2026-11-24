const mongoose = require("mongoose");

// An interview students can practise (admin → Interview practice): a board
// viva, an admission, scholarship or job interview. One to three
// interviewers ask in turn; the report scores the set's criteria.
// lecture: a viva on that lecture's material (asked from it only).
// batches: empty = every batch with Interview practice on.
const interviewSetSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    kind: { type: String, enum: ["viva", "admission", "job", "scholarship", "other"], default: "viva" },
    // What the interview is for, as the interviewers should know it: the
    // post, the university, the subject, what they look for.
    brief: { type: String, default: "", maxlength: 2000 },
    interviewers: [{
      _id: false,
      name: { type: String, maxlength: 40 },
      role: { type: String, maxlength: 60 },
      style: { type: String, maxlength: 200 },
    }],
    // What the report scores (each out of 10).
    criteria: { type: [String], default: [] },
    // Questions they must ask (in any order), besides their own.
    mustAsk: { type: [String], default: [] },
    lecture: { type: mongoose.Schema.Types.ObjectId, ref: "Lecture", default: null },
    language: { type: String, enum: ["English", "Bangla"], default: "English" },
    questions: { type: Number, default: 6, min: 2, max: 15 },
    batches: [{ type: mongoose.Schema.Types.ObjectId, ref: "Batch" }],
    isPublished: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("InterviewSet", interviewSetSchema);
