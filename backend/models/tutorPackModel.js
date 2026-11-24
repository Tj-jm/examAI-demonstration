const mongoose = require("mongoose");

// AI Tutoring questions: free ones used today, and extra ones bought with AI
// credits (AiConfig.aiTutor). Same shape as PoraPack.
const tutorPackSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true },
    batch: { type: mongoose.Schema.Types.ObjectId, ref: "Batch", required: true },
    remaining: { type: Number, default: 0, min: 0 },
    packDay: String,
    day: String,
    usedToday: { type: Number, default: 0 },
  },
  { timestamps: true }
);

tutorPackSchema.index({ student: 1, batch: 1 }, { unique: true });

module.exports = mongoose.model("TutorPack", tutorPackSchema);
