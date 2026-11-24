const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const VideoLesson = require("../../models/videoLessonModel");
const Lecture = require("../../models/lectureModel");
const AiConfig = require("../../models/aiConfigModel");
const { Question } = require("../../models/questionModel");
const aiService = require("../../ai/service");
const tts = require("../../ai/tts");
const storage = require("../../adapters/storage");
const { studentVideoScript } = require("../../ai/prompts");
const { studentVideo: studentVideoSchema } = require("../../ai/schemas");
const { batchQuestionScope } = require("../../utils/batchSubjects");
const { lectureMaterial, solutionOf, shapeLesson, sentencesOf } = require("../../utils/videoLesson");
const { cleanSegments, inBackground, removeAudio } = require("../admin/videoLessonController");
const { cleanHighlight, inLecture } = require("../../utils/lectureHighlight");

// Short videos a student asks for from a lecture or a question's solution,
// and the part of its AI video they were watching: "elaborate the proof".
// Kept as VideoLesson kind "student", seen only by that student. The script
// is written in the request (so a credit or cap error comes straight back),
// the voice in the background. Billed as student-video; gated by Settings
// → AI (features.studentVideos) and the batch (features.studentVideos, with
// aiAssist), with a daily count per student.

const MAX_ASK = 300;
const SOURCE_MAX = 12000;
const OFF_TOPIC = "That isn't about this lesson. Ask about a step or idea in it, or for a short recap of it.";

const idOr400 = (id, res) => {
  if (!mongoose.isValidObjectId(id)) { res.status(400); throw new Error("Not a valid id."); }
  return id;
};

// A published lesson's part as text: what was said and what was on the board.
const partText = (seg) => {
  if (!seg) return "";
  const board = (seg.board || []).map((b) => [b.text, b.latex, ...(b.items || [])].filter(Boolean).join(" ")).filter(Boolean);
  return `${seg.say}${board.length ? `\nOn the board: ${board.join(" | ")}` : ""}`;
};

// What the video is made from, checked against this batch.
const sourceOf = async (req, res) => {
  const { lecture: lectureId, question: questionId } = req.body || {};
  const segment = Number.isInteger(req.body?.segment) && req.body.segment >= 0 ? req.body.segment : null;
  if (lectureId) {
    const lecture = await Lecture.findOne({ _id: idOr400(lectureId, res), batches: req.batch._id, isPublished: true });
    if (!lecture) { res.status(404); throw new Error("Lecture not found in this batch."); }
    // A passage they highlighted in the notes (utils/lectureHighlight.js).
    const highlight = cleanHighlight(req.body?.highlight);
    if (highlight && !inLecture(highlight, lecture)) { res.status(400); throw new Error("That selection isn't from this lecture."); }
    const lesson = await VideoLesson.findOne({ lecture: lecture._id, published: true }).lean();
    const material = [lecture.description, (await lectureMaterial(lecture, "")) || lesson?.segments?.map(partText).join("\n\n")].filter(Boolean).join("\n\n");
    return { title: lecture.title, material: material.slice(0, SOURCE_MAX), focus: segment !== null ? partText(lesson?.segments?.[segment]) : "", highlight, source: { lecture: lecture._id, segment, highlight } };
  }
  if (questionId) {
    const q = await Question.findOne({ _id: idOr400(questionId, res), ...batchQuestionScope(req.batch), status: "published" });
    if (!q) { res.status(404); throw new Error("Question not found in this batch."); }
    const solution = solutionOf(q);
    if (!solution) { res.status(400); throw new Error("This question has no solution to explain yet."); }
    const lesson = await VideoLesson.findOne({ question: q._id, published: true }).lean();
    const options = q.type === "mcq" ? `\nOptions: ${(q.options || []).map((o) => `${o.key}. ${o.text}`).join("; ")}\nAnswer: ${q.correctOption}` : "";
    return { title: "This question's solution", material: `QUESTION: ${q.question}${options}\n\nSOLUTION:\n${solution}`.slice(0, SOURCE_MAX), focus: segment !== null ? partText(lesson?.segments?.[segment]) : "", source: { question: q._id, segment } };
  }
  res.status(400);
  throw new Error("Pick the lecture or question this is about.");
};

const startOfDay = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d; };

// The voice, a clip per sentence, in the background. No voice set up: it
// plays with captions, as other video lessons do.
const voice = (id) => inBackground(async () => {
  if (!(await tts.status()).ready) {
    await VideoLesson.updateOne({ _id: id }, { $set: { "job.status": "done" } });
    return;
  }
  try {
    const doc = await VideoLesson.findById(id);
    if (!doc) return;
    let made = 0;
    for (const seg of doc.segments) {
      const parts = [];
      for (const text of sentencesOf(seg.say)) {
        // With word timings when the voice gives them (tts.speakTimed).
        const { mp3, marks } = await tts.speakTimed(text, { language: doc.language });
        const stored = await storage.storeGenerated("video-lessons", mp3, "audio/mpeg");
        parts.push({ text, key: stored.key, driver: stored.driver, durationSeconds: tts.mp3Duration(mp3), ...(marks?.length ? { marks } : {}) });
        made += 1;
        await VideoLesson.updateOne({ _id: id }, { $set: { "job.done": made } });
      }
      seg.parts = parts;
    }
    doc.job.status = "done";
    doc.job.done = made;
    await doc.save();
  } catch (e) {
    // What's voiced is lost with the half-made lesson's save; captions still play.
    await VideoLesson.updateOne({ _id: id }, { $set: { "job.status": "done", "job.error": `No voice this time: ${e.message || "the voice service failed"}.` } });
  }
});

const shape = async (lesson) => {
  const out = await shapeLesson(lesson);
  return { ...out, ask: lesson.ask, source: lesson.source, refused: Boolean(lesson.refused), createdAt: lesson.createdAt };
};

//@desc   Ask for a short video on one point of a lecture or solution
//@route  POST /api/app/batches/:batchId/videos { lecture | question, segment?, highlight?, ask }
//@access Private (student + batchAccess + aiAssist + studentVideos)
const requestVideo = asyncHandler(async (req, res) => {
  const config = await AiConfig.get();
  if (!config.features?.studentVideos) { res.status(403); throw new Error("Short AI videos are switched off."); }
  const ask = String(req.body?.ask || "").trim();
  if (!ask) { res.status(400); throw new Error("Say what to explain, e.g. \"elaborate the proof\"."); }
  if (ask.length > MAX_ASK) { res.status(400); throw new Error(`Keep it to ${MAX_ASK} characters: one point at a time.`); }

  const daily = Math.max(1, Number(config.studentVideos?.dailyPerStudent) || 3);
  const [today, running] = await Promise.all([
    VideoLesson.countDocuments({ kind: "student", student: req.student._id, createdAt: { $gte: startOfDay() } }),
    VideoLesson.exists({ kind: "student", student: req.student._id, "job.status": "running", "job.startedAt": { $gte: new Date(Date.now() - 10 * 60 * 1000) } }),
  ]);
  // 403, not 429: more credits wouldn't help.
  if (today >= daily) { res.status(403); throw new Error(`That's today's ${daily} short videos. More tomorrow.`); }
  if (running) { res.status(409); throw new Error("Your last video is still being made. Wait for it to finish."); }

  const { title, material, focus, highlight = "", source } = await sourceOf(req, res);
  if (material.trim().length < 40) { res.status(400); throw new Error("There isn't enough in this lesson to make a video from."); }
  const maxParts = Math.min(4, Math.max(1, Number(config.studentVideos?.maxParts) || 3));

  const { data } = await aiService.generate({
    feature: "student-video",
    schema: studentVideoSchema,
    student: req.student._id,
    batch: req.batch._id,
    wrapLatex: false,
    maxTokens: 5000,
    ...studentVideoScript({ title, material, focus, highlight, ask, maxParts, language: "" }),
  });

  // Off topic: said in words, not made into a video, and not counted for today.
  if (data.onTopic === false) { res.status(422); throw new Error(OFF_TOPIC); }
  // No pictures or drawings here: those need the question's figure or more AI calls.
  const raw = data.segments.slice(0, maxParts);
  const segments = cleanSegments(raw.map((sg) => ({ ...sg, board: (sg.board || []).filter((b) => !["image", "diagram", "highlight", "sequence", "remove", "camera", "clip"].includes(b.type)) })), { hasImage: false, hasSolutionImage: false, language: "" })
    .filter((sg) => sg.say);
  if (!segments.length) { res.status(502); throw new Error("The AI didn't return a usable video. Try again."); }

  const lesson = await VideoLesson.create({
    kind: "student",
    student: req.student._id,
    batch: req.batch._id,
    source,
    ask,
    title: String(data.title).trim().slice(0, 160),
    published: true,
    segments,
    generatedAt: new Date(),
    job: { kind: "voice", status: "running", startedAt: new Date(), done: 0, total: segments.reduce((n, sg) => n + sentencesOf(sg.say).length, 0), error: null },
  });
  voice(lesson._id);
  res.status(201).json({ video: await shape(lesson) });
});

//@desc   This student's short videos for a lecture or question, newest first
//@route  GET /api/app/batches/:batchId/videos?lecture=|question=
//@access Private (student + batchAccess + aiAssist + studentVideos)
const listVideos = asyncHandler(async (req, res) => {
  const filter = { kind: "student", student: req.student._id, batch: req.batch._id, refused: { $ne: true } };
  if (req.query.lecture) filter["source.lecture"] = idOr400(req.query.lecture, res);
  if (req.query.question) filter["source.question"] = idOr400(req.query.question, res);
  const config = await AiConfig.get();
  const [videos, today] = await Promise.all([
    VideoLesson.find(filter).sort({ createdAt: -1 }).limit(10),
    VideoLesson.countDocuments({ kind: "student", student: req.student._id, createdAt: { $gte: startOfDay() } }),
  ]);
  const daily = Math.max(1, Number(config.studentVideos?.dailyPerStudent) || 3);
  res.json({ videos: await Promise.all(videos.map(shape)), leftToday: Math.max(0, daily - today), daily, enabled: Boolean(config.features?.studentVideos) });
});

//@desc   One of this student's short videos (polled while its voice is made)
//@route  GET /api/app/batches/:batchId/videos/:id
//@access Private (student + batchAccess + aiAssist + studentVideos)
const getVideo = asyncHandler(async (req, res) => {
  const lesson = await VideoLesson.findOne({ _id: idOr400(req.params.id, res), kind: "student", student: req.student._id });
  if (!lesson) { res.status(404); throw new Error("Video not found."); }
  res.json({ video: await shape(lesson) });
});

//@desc   Delete one of this student's short videos and its audio
//@route  DELETE /api/app/batches/:batchId/videos/:id
//@access Private (student + batchAccess + aiAssist + studentVideos)
const deleteVideo = asyncHandler(async (req, res) => {
  const lesson = await VideoLesson.findOne({ _id: idOr400(req.params.id, res), kind: "student", student: req.student._id });
  if (!lesson) { res.status(404); throw new Error("Video not found."); }
  await removeAudio(lesson);
  await lesson.deleteOne();
  res.json({ ok: true });
});

module.exports = { requestVideo, listVideos, getVideo, deleteVideo };
