const mongoose = require("mongoose");

// One citable piece of a lecture's material — a section of its notes, or
// part of one page of an attached file — for document chat
// (utils/docIndex.js builds these, utils/docRetrieve.js searches them).
// Rebuilt whenever the lecture's notes or attachments change.
const docChunkSchema = new mongoose.Schema(
  {
    lecture: { type: mongoose.Schema.Types.ObjectId, ref: "Lecture", required: true },
    // Where it came from, for the citation chip: the notes (heading) or a
    // file (title + page).
    source: {
      kind: { type: String, enum: ["notes", "file"], required: true },
      media: { type: mongoose.Schema.Types.ObjectId, ref: "Media" },
      title: String,
    },
    page: Number,
    order: { type: Number, default: 0 },
    text: { type: String, required: true },
    // Search terms (utils/docText.terms), unique per chunk, indexed so a
    // question only ever loads chunks that share a word with it.
    terms: { type: [String], default: [] },
    termCount: Number,
    hash: String,
    // Meaning vector, when the AI provider offers embeddings (optional —
    // keyword search works without it).
    embedding: { type: [Number], default: undefined, select: false },
    embedModel: String,
  },
  { timestamps: true }
);

docChunkSchema.index({ lecture: 1, order: 1 });
docChunkSchema.index({ lecture: 1, terms: 1 });

module.exports = mongoose.model("DocChunk", docChunkSchema);
