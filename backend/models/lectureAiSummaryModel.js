const mongoose = require("mongoose");

// A student's own AI summary of a lecture: key points from its notes
// ("points") or a recap of its files ("attachments"). Each student makes and
// pays for their own. `source` fingerprints what it was made from, so one
// made before the lecture was edited is ignored (utils/lectureSummaries.js).
const lectureAiSummarySchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true },
    lecture: { type: mongoose.Schema.Types.ObjectId, ref: "Lecture", required: true },
    kind: { type: String, enum: ["points", "attachments"], required: true },
    points: [String],
    summary: String,
    source: { type: String, required: true },
  },
  { timestamps: true }
);

lectureAiSummarySchema.index({ student: 1, lecture: 1, kind: 1 }, { unique: true });
lectureAiSummarySchema.index({ lecture: 1 });

module.exports = mongoose.model("LectureAiSummary", lectureAiSummarySchema);
