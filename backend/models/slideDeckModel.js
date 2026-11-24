const mongoose = require("mongoose");

// Lecture slides (Admin → Batch → Slides). A deck belongs to one batch. The
// AI drafts an outline from a source (a chapter's lectures and questions
// or pasted text), then the slides. Drawn by the admin panel's
// SlideView (one renderer for the editor, present mode, the PDF and .pptx).

const LAYOUTS = ["title", "section", "bullets", "twoCol", "imageText", "quote", "code", "quiz"];
const PRESETS = ["clean", "chalk", "bold", "academic", "dark", "soft", "custom"];

const slideSchema = new mongoose.Schema({
  layout: { type: String, enum: LAYOUTS, default: "bullets" },
  title: { type: String, default: "", maxlength: 300 },
  subtitle: { type: String, default: "", maxlength: 300 },
  bullets: { type: [String], default: [] },
  // twoCol
  leftTitle: { type: String, default: "", maxlength: 200 },
  rightTitle: { type: String, default: "", maxlength: 200 },
  left: { type: [String], default: [] },
  right: { type: [String], default: [] },
  // imageText: an uploaded picture (a Media id; the API adds its URL in
  // the deck's `pictures`).
  image: { type: String, default: "", maxlength: 40 },
  imagePrompt: { type: String, default: "", maxlength: 500 },
  // code
  code: { type: String, default: "", maxlength: 6000 },
  codeLang: { type: String, default: "", maxlength: 30 },
  // quote
  quote: { type: String, default: "", maxlength: 1000 },
  by: { type: String, default: "", maxlength: 200 },
  // quiz: a copy, so editing the bank question later doesn't change a deck.
  quiz: {
    question: { type: String, default: "", maxlength: 2000 },
    options: { type: [String], default: [] },
    answer: { type: Number, default: 0 },
    from: { type: mongoose.Schema.Types.ObjectId, ref: "Question", default: null },
  },
  // Speaker notes: never shown to students.
  notes: { type: String, default: "", maxlength: 5000 },
});

const slideDeckSchema = new mongoose.Schema(
  {
    batch: { type: mongoose.Schema.Types.ObjectId, ref: "Batch", required: true, index: true },
    title: { type: String, required: true, maxlength: 200 },
    source: {
      // chapter: its lectures and MCQs (lectures/questions narrow it when
      // set); lectures: picked lectures, with picked questions for quizzes;
      // questions: a deck made straight from picked questions (no AI).
      kind: { type: String, enum: ["chapter", "lectures", "questions", "text"], default: "chapter" },
      lectures: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Lecture" }], default: [] },
      questions: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Question" }], default: [] },
      // questions: revision (each question, then its answer) or quiz (MCQs only).
      questionMode: { type: String, enum: ["revision", "quiz"], default: "revision" },
      chapter: { type: mongoose.Schema.Types.ObjectId, ref: "Chapter", default: null },
      topic: { type: mongoose.Schema.Types.ObjectId, ref: "Topic", default: null },
      text: { type: String, default: "", maxlength: 60000 },
    },
    // What the teacher asked for: level, length, focus.
    brief: { type: String, default: "", maxlength: 1000 },
    slideCount: { type: Number, default: 12, min: 3, max: 40 },
    language: { type: String, default: "en" },
    look: {
      preset: { type: String, enum: PRESETS, default: "clean" },
      // custom only (empty: the preset's own)
      bg: { type: String, default: "" },
      text: { type: String, default: "" },
      accent: { type: String, default: "" },
      headFont: { type: String, default: "" },
      bodyFont: { type: String, default: "" },
      // Media ids, like a slide's image.
      bgImage: { type: String, default: "" },
      logo: { type: String, default: "" },
      // No logo uploaded: show the institution's logo (Settings).
      siteLogo: { type: Boolean, default: true },
    },
    footer: {
      show: { type: Boolean, default: true },
      text: { type: String, default: "", maxlength: 120 },
      numbers: { type: Boolean, default: true },
    },
    outline: {
      // image: a picture (Media id) picked in the outline, put on the slide written from it.
      type: [{ title: { type: String, maxlength: 300 }, points: [String], layout: { type: String, enum: LAYOUTS, default: "bullets" }, image: { type: String, default: "" } }],
      default: [],
    },
    slides: { type: [slideSchema], default: [] },
    // Student view (next step): off until published.
    published: { type: Boolean, default: false },
    allowDownload: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

slideDeckSchema.statics.LAYOUTS = LAYOUTS;
slideDeckSchema.statics.PRESETS = PRESETS;

module.exports = mongoose.model("SlideDeck", slideDeckSchema);
