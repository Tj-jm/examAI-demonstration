const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const ai = require("../../ai/service");
const { writingTask } = require("../../ai/writing");
const { courseFacts } = require("../../ai/courseFacts");
const AiConfig = require("../../models/aiConfigModel");
const AppSettings = require("../../models/appSettingsModel");
const Exam = require("../../models/examModel");
const Batch = require("../../models/batchModel");
const Submission = require("../../models/submissionModel");

// Posts, posters and promo videos for social media (admin Posters page): a
// new course, an exam's top scorers, an admission offer, a festival
// greeting or a general post. The text comes from AI over
// real facts; the poster itself is drawn in the browser, so names and
// numbers are exact (image models spell badly). An AI picture can go
// behind it.

const KINDS = ["batch", "results", "offer", "greeting", "general"];
const oid = (id) => new mongoose.Types.ObjectId(String(id));

// An exam's best scorers: each student's best graded attempt, highest
// marks first, quicker first on a tie.
const topScorers = async (examId, count = 5) => {
  const exam = await Exam.findById(examId).select("title batches").populate("batches", "name").lean();
  if (!exam) return null;
  const rows = await Submission.aggregate([
    { $match: { exam: oid(examId), status: "graded", marks: { $ne: null } } },
    { $sort: { marks: -1, totalTimeMs: 1 } },
    { $group: { _id: "$student", marks: { $first: "$marks" }, totalMarks: { $first: "$totalMarks" }, timeMs: { $first: "$totalTimeMs" } } },
    { $sort: { marks: -1, timeMs: 1 } },
    { $limit: Math.min(10, Math.max(1, Number(count) || 5)) },
    { $lookup: { from: "students", localField: "_id", foreignField: "_id", as: "student" } },
    { $set: { student: { $arrayElemAt: ["$student", 0] } } },
  ]);
  return {
    exam: { _id: exam._id, title: exam.title, batchName: exam.batches?.[0]?.name || "" },
    scorers: rows.map((r, i) => ({
      rank: i + 1,
      name: r.student?.name || "Student",
      marks: r.marks,
      totalMarks: r.totalMarks,
      percent: r.totalMarks ? Math.round((r.marks / r.totalMarks) * 100) : null,
    })),
  };
};

//@desc   An exam's top scorers, for a results poster
//@route  GET /api/posters/top-scorers?exam=&count=
//@access Private (owner, admin)
const getTopScorers = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.query.exam)) {
    res.status(400);
    throw new Error("Pick an exam.");
  }
  const out = await topScorers(req.query.exam, req.query.count);
  if (!out) {
    res.status(404);
    throw new Error("That exam wasn't found.");
  }
  res.status(200).json(out);
});

//@desc   Poster text and a Facebook caption, written by AI from real facts
//@route  POST /api/posters/write
//@access Private (owner, admin)
const writePoster = asyncHandler(async (req, res) => {
  if (!(await AiConfig.get()).features.writingHelp) {
    res.status(403);
    throw new Error("Write with AI is switched off. Turn it on in Settings → AI → Features.");
  }
  const body = req.body || {};
  const kind = KINDS.includes(body.kind) ? body.kind : "batch";
  const facts = [];

  if ((kind === "batch" || kind === "offer") && mongoose.isValidObjectId(body.batch)) {
    const course = await courseFacts("batch", body.batch);
    if (course) facts.push(...course.facts);
  }
  if (kind === "offer") {
    if (String(body.offer || "").trim()) facts.push(`The offer: ${String(body.offer).trim().slice(0, 300)}`);
    if (body.until) facts.push(`Offer ends: ${new Date(body.until).toDateString()}`);
    if (String(body.couponCode || "").trim()) facts.push(`Code to use: ${String(body.couponCode).trim().slice(0, 40)}`);
  }
  if (kind === "greeting") {
    const occasion = String(body.festival || "").trim().slice(0, 80);
    if (!occasion) {
      res.status(400);
      throw new Error("Pick the festival or day.");
    }
    facts.push(`Occasion: ${occasion}`);
  }
  if (kind === "general" && !String(body.prompt || "").trim()) {
    res.status(400);
    throw new Error("Say what the post is about.");
  }
  if (kind === "general" && mongoose.isValidObjectId(body.batch)) {
    const course = await courseFacts("batch", body.batch);
    if (course) facts.push(...course.facts);
  }
  if (kind === "results") {
    if (!mongoose.isValidObjectId(body.exam)) {
      res.status(400);
      throw new Error("Pick an exam.");
    }
    const top = await topScorers(body.exam, body.count);
    if (!top) {
      res.status(404);
      throw new Error("That exam wasn't found.");
    }
    facts.push(`Exam: ${top.exam.title}${top.exam.batchName ? ` (${top.exam.batchName})` : ""}`);
    for (const s of top.scorers) facts.push(`Rank ${s.rank}: ${s.name}, ${s.marks}/${s.totalMarks}`);
  }
  if (!facts.length && !String(body.prompt || "").trim()) {
    res.status(400);
    throw new Error(kind === "offer" ? "Pick a course or describe the offer first." : "Pick a course first.");
  }

  const { schema, system, prompt } = writingTask("poster", {
    kind,
    facts,
    prompt: body.prompt,
    siteName: (await AppSettings.get()).siteName,
    language: body.language === "bn" ? "bn" : "en",
  });
  const { data } = await ai.generate({ feature: "write-poster", schema, system, prompt, maxTokens: 1500, user: req.user._id, wrapLatex: false });
  res.status(200).json(data);
});

const SCENES = {
  batch: "students studying together in a bright modern classroom",
  results: "a celebratory scene with trophies, confetti and graduation caps",
  offer: "a cheerful study desk with books, a notebook and a laptop",
  greeting: "a warm festive scene with soft lights and decorations",
  general: "a bright, friendly scene of students learning",
};

//@desc   An AI picture to sit behind a poster, returned inline (not saved)
//@route  POST /api/posters/background
//@access Private (owner, admin)
const posterBackground = asyncHandler(async (req, res) => {
  const config = await AiConfig.get(true);
  if (!config.features.aiImages) {
    res.status(403);
    throw new Error("AI images are switched off. Turn them on in Settings → AI → Features.");
  }
  const kind = KINDS.includes(req.body?.kind) ? req.body.kind : "batch";
  const shape = ["square", "tall"].includes(req.body?.shape) ? req.body.shape : "square";
  const festival = String(req.body?.festival || "").trim().slice(0, 80);
  const scene = String(req.body?.prompt || "").trim().slice(0, 600)
    || (kind === "greeting" && festival ? `a warm festive scene celebrating ${festival}, true to how it is celebrated` : SCENES[kind]);
  let image;
  try {
    image = await require("../../utils/aiPicture").generate({
      config, feature: "picture-poster", user: req.user._id, shape,
      prompt: `${scene}. A background for a social media poster: soft, uncluttered, with calm space in the middle for text laid on top. Do not include any words, letters, numbers, logos or watermarks.`,
    });
  } catch (error) {
    res.status(error.statusCode || 502);
    throw error;
  }
  // Inline, so the browser can draw it into the poster without a
  // cross-origin canvas taint.
  res.status(200).json({ dataUrl: `data:${image.mimeType};base64,${image.buffer.toString("base64")}` });
});

//@desc   A voice reading the promo video's script, returned inline
//@route  POST /api/posters/voice { text, language }
//@access Private (owner, admin)
const posterVoice = asyncHandler(async (req, res) => {
  const tts = require("../../ai/tts");
  if (!(await tts.status()).ready) {
    res.status(400);
    throw new Error("No voice is set up. Add one in Settings → AI → Voice.");
  }
  const text = String(req.body?.text || "").trim().slice(0, 700);
  if (!text) {
    res.status(400);
    throw new Error("Write what the voice says first.");
  }
  const mp3 = await tts.speak(text, { language: req.body?.language === "bn" ? "Bangla" : "" });
  res.status(200).json({ dataUrl: `data:audio/mpeg;base64,${mp3.toString("base64")}`, seconds: tts.mp3Duration(mp3) });
});

//@desc   Batches and recent exams to pick from
//@route  GET /api/posters/options
//@access Private (owner, admin)
const posterOptions = asyncHandler(async (req, res) => {
  const [batches, exams] = await Promise.all([
    Batch.find({}).select("name").sort({ createdAt: -1 }).limit(200).lean(),
    Exam.find({ isPublished: true, createdByStudent: null }).select("title batches").populate("batches", "name").sort({ createdAt: -1 }).limit(100).lean(),
  ]);
  res.status(200).json({
    voiceReady: (await require("../../ai/tts").status()).ready,
    batches: batches.map((b) => ({ _id: b._id, name: b.name })),
    exams: exams.map((e) => ({ _id: e._id, title: e.title, batchName: e.batches?.[0]?.name || "" })),
  });
});

module.exports = { getTopScorers, writePoster, posterBackground, posterVoice, posterOptions, topScorers };
