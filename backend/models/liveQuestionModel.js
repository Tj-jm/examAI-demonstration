const mongoose = require("mongoose");

// A question a student asks during an in-app class (the Q&A board).
// Others upvote it; the host answers, dismisses or spotlights it.
const liveQuestionSchema = new mongoose.Schema(
  {
    liveClass: { type: mongoose.Schema.Types.ObjectId, ref: "LiveClass", required: true, index: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true },
    name: { type: String, default: "" },
    text: { type: String, required: true, maxlength: 400 },
    upvotes: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    // "pending": a webinar guest's question waiting for a host to approve it.
    status: { type: String, enum: ["pending", "open", "answered", "dismissed"], default: "open" },
    // Asked by a public webinar's guest (`student` then holds the guest's id).
    guest: { type: Boolean, default: false },
    spotlight: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("LiveQuestion", liveQuestionSchema);
