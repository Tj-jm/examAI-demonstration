const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const VideoLesson = require("../../models/videoLessonModel");
const Lecture = require("../../models/lectureModel");
const Purchase = require("../../models/purchaseModel");
const Trial = require("../../models/trialModel");
const { Question } = require("../../models/questionModel");
const { resolveExpiry } = require("../../utils/accessWindow");
const { shapeLesson, lessonImages } = require("../../utils/videoLesson");

// A published video lesson for students. Shown wherever a question's
// solution or a lecture is, so it isn't tied to one batch route: the
// student needs an active purchase or trial on a batch that has the
// question or lecture (an archive question: on any batch).

const activeBatchIds = async (studentId) => {
  const now = new Date();
  const [purchases, trials] = await Promise.all([
    Purchase.find({ student: studentId, status: "complete" }).select("batch plan startDate").sort({ startDate: 1 }).lean(),
    Trial.find({ student: studentId, endDate: { $gte: now } }).select("batch").lean(),
  ]);
  const byBatch = new Map();
  for (const p of purchases) byBatch.set(String(p.batch), [...(byBatch.get(String(p.batch)) || []), p]);
  const ids = new Set(trials.map((t) => String(t.batch)));
  for (const [b, list] of byBatch) {
    const expiry = resolveExpiry(list);
    if (expiry && expiry >= now) ids.add(b);
  }
  return ids;
};

const none = (res) => res.status(200).json({ lesson: null });

//@route  GET /api/app/video-lessons/question/:id
//@access Private (student)
const getQuestionLesson = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return none(res);
  const q = await Question.findById(req.params.id).select("batches isPublic status questionImage solutionImage").populate("questionImage solutionImage");
  if (!q || q.status !== "published") return none(res);
  const lesson = await VideoLesson.findOne({ question: q._id, published: true });
  if (!lesson) return none(res);
  const active = await activeBatchIds(req.student._id);
  // No batch list on the question means any batch may show it.
  const listed = q.batches || [];
  const ok = active.size > 0 && (!listed.length || q.isPublic || listed.some((b) => active.has(String(b))));
  if (!ok) return none(res);
  res.status(200).json({ lesson: await shapeLesson(lesson, await lessonImages(q)) });
});

//@route  GET /api/app/video-lessons/lecture/:id
//@access Private (student)
const getLectureLesson = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return none(res);
  const lecture = await Lecture.findById(req.params.id).select("batches isPublished").lean();
  if (!lecture?.isPublished) return none(res);
  const lesson = await VideoLesson.findOne({ lecture: lecture._id, published: true });
  if (!lesson) return none(res);
  const active = await activeBatchIds(req.student._id);
  if (!(lecture.batches || []).some((b) => active.has(String(b)))) return none(res);
  res.status(200).json({ lesson: await shapeLesson(lesson) });
});

module.exports = { getQuestionLesson, getLectureLesson, activeBatchIds };
