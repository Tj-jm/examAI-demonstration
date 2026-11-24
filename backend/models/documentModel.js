const mongoose = require("mongoose");

// A document uploaded to generate questions used to be read once and thrown
// away — extracted into chunks in memory, then gone the moment the request
// ended. Reusing the same source for a second batch of questions meant
// uploading and re-reading the exact same file from scratch.
//
// This keeps both the original file (via the storage adapter, so a person can
// still see what was uploaded) and the text already extracted from it — the
// expensive part of ingest is parsing a pdf/docx/pptx, not chunking, so
// caching the extracted text is what actually makes reuse instant.
const documentSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Please add a title"],
      trim: true,
    },
    originalFilename: String,
    mimeType: {
      type: String,
      required: true,
    },
    // local | s3 — same meaning as on Media, kept alongside the key so a
    // driver switch mid-project doesn't strand old rows pointing nowhere.
    driver: {
      type: String,
      required: true,
      default: "local",
    },
    key: {
      type: String,
      required: true,
    },
    sizeBytes: Number,

    // Sha256 of the original bytes. Re-uploading the same file — a teacher
    // who forgot they already added it, or the ingest form's own preview step
    // running again — resolves to this document instead of storing it twice.
    contentHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    // Cached at upload time so picking this document from a dropdown later
    // never re-parses the original file just to chunk it again.
    // Not required: a fully scanned document has (almost) no text layer —
    // its content comes from `transcripts` below instead.
    extractedText: {
      type: String,
      default: "",
    },
    pages: Number,
    // One cleaned string per page (PDF) or slide (PowerPoint), so a run can
    // target a page range. Absent on Word/text files and on documents saved
    // before this existed — those are re-read from storage on first use.
    pageTexts: {
      type: [String],
      default: undefined,
      select: false,
    },
    // Pages ("p12") or embedded Word images ("img3") with no text layer,
    // readable with AI vision (ingest.openScans).
    scanned: {
      type: [String],
      default: undefined,
    },
    // AI-vision transcriptions of those, cached by ref so a page is only
    // ever paid for once across runs.
    transcripts: {
      type: Map,
      of: String,
      default: undefined,
      select: false,
    },
    // Which reader produced pageTexts/scanned above. 2 = font-aware (Bijoy
    // fonts converted, maths/figure pages sent to vision — ingest/pdfPages.js).
    // An older PDF entry is re-read from storage on its next use, and its
    // transcripts (made by the older, figure-less prompt) are dropped.
    extractVersion: Number,
    // Why each page in `scanned` is read with vision ("p3" → ["maths",
    // "figures"]) — shown before a run so the cost isn't a surprise.
    visionReasons: { type: mongoose.Schema.Types.Mixed, default: undefined },
    // Exact positions of embedded pictures ("p3" → [[l,t,r,b], …], thousandths
    // of the page), used to crop figures precisely.
    imageBoxes: { type: mongoose.Schema.Types.Mixed, default: undefined, select: false },
    bijoyPages: Number,
    // Render scale per scanned page ("p1" → 2.77), so a scan is read at its
    // own resolution — see ingest/pdfPages.scanScale.
    renderScales: { type: mongoose.Schema.Types.Mixed, default: undefined },
    // Figures already cropped and stored ("p3f1" → Media id), so a re-run
    // attaches the same image instead of storing it again.
    figures: {
      type: Map,
      of: mongoose.Schema.Types.ObjectId,
      default: undefined,
      select: false,
    },
    characters: Number,
    chunkCount: Number,
    looksScanned: {
      type: Boolean,
      default: false,
    },
    sample: String,

    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    usedCount: {
      type: Number,
      default: 0,
    },
    lastUsedAt: Date,
  },
  { timestamps: true }
);

documentSchema.index({ title: "text", originalFilename: "text" });

module.exports = mongoose.model("Document", documentSchema);