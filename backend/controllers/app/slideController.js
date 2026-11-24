const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const SlideDeck = require("../../models/slideDeckModel");
const { withPictures } = require("../admin/slideController");

// Lecture slides for students (batch feature lectureSlides): the batch's
// published decks. Speaker notes never leave the server.

const published = async (req, res) => {
  const deck = mongoose.isValidObjectId(req.params.deckId)
    ? await SlideDeck.findOne({ _id: req.params.deckId, batch: req.params.batchId, published: true })
    : null;
  if (!deck) { res.status(404); throw new Error("Those slides aren't available."); }
  return deck;
};
const forStudent = (d) => {
  const { notes, outline, brief, source, createdBy, updatedBy, slideCount, ...rest } = d;
  return { ...rest, chapter: source?.chapter || null, slides: (d.slides || []).map(({ notes: _n, imagePrompt: _p, ...s }) => ({ ...s, quiz: s.quiz ? { question: s.quiz.question, options: s.quiz.options, answer: s.quiz.answer } : s.quiz })) };
};

//@desc   The batch's published decks, with each one's chapter for grouping
//@route  GET /api/app/batches/:batchId/slides
const listDecks = asyncHandler(async (req, res) => {
  const decks = await SlideDeck.find({ batch: req.params.batchId, published: true })
    .select("title look source.kind source.chapter allowDownload updatedAt slides.layout slides.title slides.subtitle")
    .populate("source.chapter", "title")
    .sort({ updatedAt: -1 }).lean();
  res.status(200).json(decks.map((d) => ({
    _id: d._id, title: d.title, look: d.look, allowDownload: d.allowDownload, updatedAt: d.updatedAt,
    chapter: d.source?.chapter ? { _id: d.source.chapter._id, title: d.source.chapter.title } : null,
    count: d.slides.length, first: d.slides[0] || null,
  })));
});

//@route  GET /api/app/batches/:batchId/slides/:deckId
const getDeck = asyncHandler(async (req, res) => {
  const deck = await published(req, res);
  res.status(200).json(forStudent(await withPictures(deck)));
});

//@desc   The deck as a PDF, when the teacher allows downloads
//@route  GET /api/app/batches/:batchId/slides/:deckId/pdf
const deckPdf = asyncHandler(async (req, res) => {
  const deck = await published(req, res);
  if (!deck.allowDownload) { res.status(403); throw new Error("These slides can't be downloaded."); }
  const { printSlides, canPrint } = require("../../utils/slidePrint");
  if (canPrint()) { res.status(503); throw new Error("Downloads aren't available right now."); }
  const buf = await printSlides(await withPictures(deck, { forPrint: true }));
  const name = (deck.title || "slides").replace(/[^\p{L}\p{N} _.-]/gu, "").trim() || "slides";
  res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="slides.pdf"; filename*=UTF-8''${encodeURIComponent(name)}.pdf`, "Cache-Control": "no-store" });
  res.send(buf);
});

module.exports = { listDecks, getDeck, deckPdf };
