const mongoose = require("mongoose");
const cacheInvalidation = require("../utils/cacheInvalidation");
const tags = require("../utils/cacheTags");

// Lectures and topic content were two systems doing the same job at different
// levels of the tree. This is one model that attaches to a chapter and
// optionally narrows to a topic.
//
// Visibility is explicit assignment: a lecture is visible to a batch only if
// that batch appears in `batches`. There is no implicit subject matching.

const lectureSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Please add a title"],
      trim: true,
    },
    description: String,

    // The lecture's own written content — notes, a worked explanation,
    // whatever a video alone does not cover. Rendered as Markdown, not full
    // MDX: letting an author's stored content execute arbitrary JSX would
    // mean anyone who can create a lecture can run script in every browser
    // that later views it. Markdown gets everything a written lecture
    // actually needs — headings, lists, code, links — without that risk.
    bodyMarkdown: String,
    // Cached once generated — the summary is the same for every student, so
    // there's no reason to regenerate it per-viewer. Cleared automatically
    // whenever bodyMarkdown changes (see the pre-save hook below), so an
    // edited lecture doesn't keep showing a summary of the old notes.
    aiSummary: [String],
    // Same caching story as aiSummary, different source and shape — a
    // prose recap of the lecture's attached files (PDFs, Word docs,
    // slides), not its own written notes. See ai/prompts/index.js's
    // summarizeLectureAttachments. Cleared whenever the attachments list
    // itself changes (see the pre-save hook below) — editing bodyMarkdown
    // has no bearing on this one.
    aiAttachmentSummary: String,

    // Document chat's index of this lecture (utils/docIndex.js): its notes
    // and readable files cut into DocChunks. Rebuilt automatically when the
    // notes or attachments change.
    docIndex: {
      status: { type: String, enum: ["none", "indexing", "ready", "failed"], default: "none" },
      indexedAt: Date,
      chunks: { type: Number, default: 0 },
      // Bumped on every rebuild, so a cached copy of the chunks knows it's old.
      version: { type: Number, default: 0 },
      // Scanned pages with no text layer, not yet read with AI vision —
      // shown to the admin with a "Read them" button.
      pendingScans: [
        {
          _id: false,
          media: { type: mongoose.Schema.Types.ObjectId, ref: "Media" },
          title: String,
          pages: [Number],
        },
      ],
      // Files that couldn't be read at all (video, images, unknown types).
      skipped: [String],
      error: String,
    },

    subject: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subject",
      required: true,
      index: true,
    },
    chapter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Chapter",
      required: true,
      index: true,
    },
    topic: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Topic",
    },

    video: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Media",
    },
    attachments: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Media",
      },
    ],

    // a tag for organisation, not an access rule
    tag: String,

    batches: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Batch",
        index: true,
      },
    ],

    order: {
      type: Number,
      default: 0,
    },
    isPublished: {
      type: Boolean,
      default: false,
    },

    // "Ace this lecture" — a self-check quiz shown under the lecture's
    // content on the student app. One set PER BATCH, not one shared list —
    // the same lecture assigned to two batches (a slower cohort and a fast
    // one, a paid batch and a free trial one, whatever) can quiz them
    // differently. A batch with no set here just shows no card, same as a
    // lecture with nothing assigned at all. Same reuse-the-bank pattern as
    // Exam.questions (questionModel.js's Question is one shared collection,
    // not exam-scoped) — a question can sit in a real exam and in more than
    // one batch's practice set at once. Restricted at the controller level
    // to mcq/mtf only — written answers need a person or an AI grading call
    // to score, which defeats the point of an instant self-check.
    practiceQuestionSets: [
      {
        batch: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Batch",
          required: true,
        },
        questions: [
          {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Question",
          },
        ],
      },
    ],
  },
  { timestamps: true }
);

lectureSchema.index({ chapter: 1, order: 1 });

lectureSchema.pre("save", function (next) {
  if (this.isModified("bodyMarkdown")) {
    this.aiSummary = undefined;
    // Pasted pictures get links that work for students too (utils/noteImages.js).
    this.bodyMarkdown = require("../utils/noteImages").stableImages(this.bodyMarkdown);
  }
  if (this.isModified("attachments")) {
    this.aiAttachmentSummary = undefined;
  }
  // Remembered for the post-save hook below, which runs after isModified is
  // reset.
  this.$locals.reindex = this.isNew || this.isModified("bodyMarkdown") || this.isModified("attachments");
  next();
});

// New notes or files: rebuild document chat's index in the background. Not
// awaited — a lecture save never waits on reading a PDF.
lectureSchema.post("save", function (doc) {
  if (!doc.$locals.reindex) return;
  setImmediate(() => {
    require("../utils/docIndex")
      .indexLecture(doc._id)
      .catch((error) => console.error(`Document chat index for lecture ${doc._id}: ${error.message}`));
  });
});

// Writes here drop the cached reads built from them (utils/cacheInvalidation.js).
lectureSchema.plugin(cacheInvalidation, { tags: () => [tags.LECTURES] });

module.exports = mongoose.model("Lecture", lectureSchema);
