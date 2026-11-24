const mongoose = require("mongoose");

// One finished caption line from an in-app class, as the host's browser
// heard it. Read back in order to make the class notes.
const liveTranscriptSchema = new mongoose.Schema(
  {
    liveClass: { type: mongoose.Schema.Types.ObjectId, ref: "LiveClass", required: true },
    text: { type: String, required: true, maxlength: 2000 },
    at: { type: Date, required: true },
    lang: { type: String, default: "en-US" },
  },
  { timestamps: false }
);

liveTranscriptSchema.index({ liveClass: 1, at: 1 });

module.exports = mongoose.model("LiveTranscript", liveTranscriptSchema);
