const mongoose = require("mongoose");

// One model for video and pdf, replacing the separate videoModel and pdfModel.
// The storage adapter decides how `key` resolves to a URL, so a buyer on local
// disk and a buyer on S3 store identical documents.

const mediaSchema = new mongoose.Schema(
  {
    title: String,
    kind: {
      type: String,
      enum: ["video", "pdf", "image", "document"],
      required: true,
    },
    // local | s3 | bunny | youtube | vimeo | link
    driver: {
      type: String,
      required: true,
      default: "local",
    },
    // path for local/s3, video id for bunny, full url for link/youtube/vimeo
    key: {
      type: String,
      required: true,
    },
    sizeBytes: Number,
    mimeType: String,
    durationSeconds: Number,
    // AI-vision readings of this file's scanned pages ("p3" → text), for
    // document chat — paid for once, reused by every later re-index.
    transcripts: {
      type: Map,
      of: String,
      default: undefined,
      select: false,
    },
    // Self-hosted protected video (utils/protectedVideo.js): the file cut
    // into encrypted 6-second chunks, played through expiring playlists,
    // with keys handed out only to a signed-in viewer. driver is
    // "protected" once it is ready (or straight away for a new upload).
    hls: {
      status: { type: String, enum: ["queued", "converting", "ready", "failed"] },
      progress: Number,
      error: String,
      hd: Boolean,
      // Where the encrypted chunks are: a storage prefix and its driver.
      folder: String,
      storage: String,
      renditions: [{ _id: false, name: String, height: Number, bandwidth: Number, durations: [Number] }],
      // One AES-128 key (hex) per 10 chunks, never sent with the media.
      keys: { type: [String], select: false },
      // The original: a stored file (driver + key), or an upload waiting on
      // the disk of the server that took it (path + host).
      source: { driver: String, key: String, path: String, host: String },
      // The server converting it now.
      worker: String,
      startedAt: Date,
      finishedAt: Date,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Media", mediaSchema);