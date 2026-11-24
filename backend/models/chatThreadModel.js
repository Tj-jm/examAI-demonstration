const mongoose = require("mongoose");

// A student's conversation with their course documents: "Ask this lecture"
// (lecture set) or "Ask your course" (lecture null).
const MAX_MESSAGES = 50;

const citationSchema = new mongoose.Schema(
  {
    lecture: { type: mongoose.Schema.Types.ObjectId, ref: "Lecture" },
    lectureTitle: String,
    kind: { type: String, enum: ["notes", "file"] },
    media: { type: mongoose.Schema.Types.ObjectId, ref: "Media" },
    title: String,
    page: Number,
    quote: String,
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ["student", "assistant"], required: true },
    text: { type: String, required: true },
    // Student only: a photo sent with the question (its URL), read with the
    // vision model before searching.
    image: String,
    citations: { type: [citationSchema], default: undefined },
    // Assistant only: answered from the documents, or not found in them
    // (then either a labelled general answer or a pointer to a teacher).
    foundInDocuments: Boolean,
    generalAnswer: Boolean,
    at: { type: Date, default: Date.now },
  },
  { _id: true }
);

const chatThreadSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true },
    batch: { type: mongoose.Schema.Types.ObjectId, ref: "Batch", required: true },
    lecture: { type: mongoose.Schema.Types.ObjectId, ref: "Lecture", default: null },
    title: String,
    messages: { type: [messageSchema], default: [] },
    // For the admin's "questions the documents couldn't answer" list.
    unanswered: { type: Number, default: 0 },
  },
  { timestamps: true }
);

chatThreadSchema.index({ student: 1, batch: 1, updatedAt: -1 });
chatThreadSchema.index({ batch: 1, updatedAt: -1 });

chatThreadSchema.pre("save", function (next) {
  if (this.messages.length > MAX_MESSAGES) this.messages = this.messages.slice(-MAX_MESSAGES);
  next();
});

module.exports = mongoose.model("ChatThread", chatThreadSchema);
