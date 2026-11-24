const mongoose = require("mongoose");

// A poll during an in-app class: a multiple-choice question from the bank
// or typed on the spot. One answer per student; the host closes it and
// reveals the results (and the right answer, when there is one).
const livePollSchema = new mongoose.Schema(
  {
    liveClass: { type: mongoose.Schema.Types.ObjectId, ref: "LiveClass", required: true, index: true },
    question: { type: mongoose.Schema.Types.ObjectId, ref: "Question", default: null },
    text: { type: String, required: true },
    image: { type: String, default: null },
    options: { type: [{ key: String, text: String, image: { type: String, default: null } }], default: [] },
    correct: { type: String, default: null },
    status: { type: String, enum: ["open", "closed"], default: "open" },
    revealed: { type: Boolean, default: false },
    responses: { type: [{ student: { type: mongoose.Schema.Types.ObjectId, ref: "Student" }, key: String, at: Date }], default: [] },
    closedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("LivePoll", livePollSchema);
