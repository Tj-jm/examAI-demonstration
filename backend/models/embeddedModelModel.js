const mongoose = require("mongoose");

// One row per model downloaded onto this server for the "embedded" AI
// provider (see ai/embedded.js) — the zero-install option where a real
// llama.cpp server binary runs as a managed child process on localhost
// instead of a hand-installed Ollama or a hosted API. Tracked in Mongo
// rather than scanned off disk since a split (multi-part) model's part
// count and a vision model's mmproj file are decided at download time from
// the catalogue entry, not re-derivable from what's sitting in the folder —
// this is the durable record of what actually finished downloading, so "is
// this installed, and how do I start it" survives a server restart.
const embeddedModelSchema = new mongoose.Schema(
  {
    // Matches one entry in ai/embeddedCatalogue.js's CATALOGUE — the thing
    // a "Download" button in the admin panel actually points at.
    catalogueId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    // Absolute path on this server's disk to the model file llama-server is
    // launched with (-m). For a split model this is the first part only —
    // llama.cpp finds the rest itself as long as every part was downloaded
    // into this same folder alongside it, which pullModel always does.
    filePath: {
      type: String,
      required: true,
    },
    // Absolute path to the multimodal projector file, for a vision-capable
    // catalogue entry (passed to llama-server's --mmproj). Unset for a
    // text-only model.
    mmprojPath: String,
    sizeBytes: Number,
    downloadedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model("EmbeddedModel", embeddedModelSchema);
