const mongoose = require("mongoose");

// Extra course-chat questions a student bought with AI credits, once the
// free daily questions (AiConfig.docChat.dailyMessages) are used up. One
// balance per student per batch. Whether it lasts past the day it was
// bought is the admin's call (AiConfig.docChat.packCarryOver).
const docChatPackSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true },
    batch: { type: mongoose.Schema.Types.ObjectId, ref: "Batch", required: true },
    remaining: { type: Number, default: 0, min: 0 },
    // The day the last pack was bought — without carry-over, the balance
    // only counts on that day.
    packDay: String,
    // Free questions asked today (the count resets when `day` changes).
    day: String,
    usedToday: { type: Number, default: 0 },
  },
  { timestamps: true }
);

docChatPackSchema.index({ student: 1, batch: 1 }, { unique: true });

module.exports = mongoose.model("DocChatPack", docChatPackSchema);
