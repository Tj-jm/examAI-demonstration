const asyncHandler = require("express-async-handler");
const Lecture = require("../../models/lectureModel");
const LectureProgress = require("../../models/lectureProgressModel");
const Document = require("../../models/documentModel");
const { Question } = require("../../models/questionModel");
const { shape: shapeMedia } = require("../admin/mediaController");
const { forReview } = require("../../utils/shapeQuestion");
const { orderLectures, compareKeys } = require("../../utils/courseOutline");
const aiService = require("../../ai/service");
const lectureSummaries = require("../../utils/lectureSummaries");
const storage = require("../../adapters/storage");
const { extract: extractText, SUPPORTED: EXTRACT_SUPPORTED } = require("../../ai/ingest");
const { summarizeLecture: summarizeLecturePrompt, summarizeLectureAttachments: summarizeLectureAttachmentsPrompt } = require("../../ai/prompts");
const { lectureSummary: lectureSummarySchema, lectureAttachmentSummary: lectureAttachmentSummarySchema } = require("../../ai/schemas");

//@desc   Lectures assigned to this batch
//@route  GET /api/app/batches/:batchId/lectures
//@access Private (student + batchAccess + features.lectures)
const getLectures = asyncHandler(async (req, res) => {
  // In the batch's outline order (utils/courseOutline.js). The hierarchical
  // layouts group by chapter and topic and sort each by `order`, so those
  // are sent as the outline's rank rather than the syllabus's own number.
  const lectures = await Lecture.find({ batches: req.batch._id, isPublished: true })
    .populate("chapter", "title")
    .populate("topic", "title")
    .lean();
  const ol = await orderLectures(req.batch, lectures);
  const chapterRank = new Map();
  for (const l of lectures) if (l.chapter && !chapterRank.has(String(l.chapter._id))) chapterRank.set(String(l.chapter._id), chapterRank.size);
  const topicIds = [...new Set(lectures.filter((l) => l.topic).map((l) => String(l.topic._id)))].sort((a, b) => compareKeys(ol.topicKey(a), ol.topicKey(b)));
  const topicRank = new Map(topicIds.map((id, i) => [id, i]));

  const progress = await LectureProgress.find({
    student: req.student._id,
    lecture: { $in: lectures.map((l) => l._id) },
  })
    .select("lecture completedAt lastPositionSeconds")
    .lean();
  const progressByLecture = new Map(progress.map((p) => [String(p.lecture), p]));

  res.status(200).json({
    lectures: lectures.map((l) => {
      const p = progressByLecture.get(String(l._id));
      return {
        _id: l._id,
        title: l.title,
        description: l.description,
        chapter: l.chapter && { ...l.chapter, order: chapterRank.get(String(l.chapter._id)) },
        topic: l.topic && { ...l.topic, order: topicRank.get(String(l.topic._id)) },
        group: l.chapter ? ol.group(l.chapter._id) : null,
        tag: l.tag,
        hasVideo: Boolean(l.video),
        hasNotes: Boolean(l.bodyMarkdown),
        attachmentCount: (l.attachments || []).length,
        watched: Boolean(p?.completedAt),
        lastPositionSeconds: p?.lastPositionSeconds || 0,
      };
    }),
    groups: ol.groups,
  });
});

//@desc   One lecture, in full — nested under its batch so batchAccess has
//        a :batchId to check against
//@route  GET /api/app/batches/:batchId/lectures/:id
//@access Private (student + batchAccess on the given batch)
const getLecture = asyncHandler(async (req, res) => {
  const lecture = await Lecture.findById(req.params.id)
    .populate("chapter", "title")
    .populate("topic", "title")
    .populate("video")
    .populate("attachments");

  if (!lecture || !lecture.isPublished) {
    res.status(404);
    throw new Error("Lecture not found.");
  }

  if (!lecture.batches.some((b) => String(b) === String(req.batch._id))) {
    res.status(404);
    throw new Error("Lecture not found in this batch.");
  }

  const doc = lecture.toObject();
  // A protected video's link plays only for this student.
  if (doc.video) doc.video = await shapeMedia(doc.video, { viewer: req.student._id });
  if (Array.isArray(doc.attachments)) {
    doc.attachments = await Promise.all(doc.attachments.map((a) => shapeMedia(a)));
  }
  delete doc.batches;
  // This student's own summaries, never another student's.
  Object.assign(doc, await lectureSummaries.mine(lecture, req.student._id));

  const progress = await LectureProgress.findOneAndUpdate(
    { student: req.student._id, lecture: lecture._id },
    { $setOnInsert: { batch: req.batch._id }, $set: { lastWatchedAt: new Date() } },
    { upsert: true, new: true }
  );

  res.status(200).json({ ...doc, progress: { lastPositionSeconds: progress.lastPositionSeconds, watched: Boolean(progress.completedAt) } });
});

//@desc   Save watch position, or mark complete
//@route  PUT /api/app/batches/:batchId/lectures/:id/progress
//@access Private (student + batchAccess)
const updateProgress = asyncHandler(async (req, res) => {
  const { positionSeconds, completed } = req.body;

  const update = { lastWatchedAt: new Date() };
  if (positionSeconds !== undefined) update.lastPositionSeconds = positionSeconds;
  if (completed) update.completedAt = new Date();

  const progress = await LectureProgress.findOneAndUpdate(
    { student: req.student._id, lecture: req.params.id },
    { $set: update, $setOnInsert: { batch: req.batch._id } },
    { upsert: true, new: true }
  );

  res.status(200).json(progress);
});

//@desc   Bullet-point summary of a lecture's notes — each student's own,
//        made and billed per student (utils/lectureSummaries.js).
//@route  POST /api/app/batches/:batchId/lectures/:id/summarize
//@access Private (student + batchAccess + features.lectures + features.aiAssist)
const summarizeLecture = asyncHandler(async (req, res) => {
  const lecture = await Lecture.findById(req.params.id);

  if (!lecture || !lecture.isPublished || !lecture.batches.some((b) => String(b) === String(req.batch._id))) {
    res.status(404);
    throw new Error("Lecture not found in this batch.");
  }
  // regenerate: don't serve their saved one, call the AI again.
  if (!req.body.regenerate) {
    const { aiSummary } = await lectureSummaries.mine(lecture, req.student._id);
    if (aiSummary.length > 0) {
      res.status(200).json({ points: aiSummary });
      return;
    }
  }
  if (!lecture.bodyMarkdown || !lecture.bodyMarkdown.trim()) {
    res.status(400);
    throw new Error("This lecture has no notes to summarise yet.");
  }

  const { points } = await lectureSummaries.make(lecture, req.student._id, "points", async () => {
    const prompt = summarizeLecturePrompt({
      title: lecture.title,
      description: lecture.description,
      bodyMarkdown: lecture.bodyMarkdown,
    });
    const { data } = await aiService.generate({
      feature: "lecture-summarize",
      schema: lectureSummarySchema,
      student: req.student._id,
      batch: req.batch._id,
      ...prompt,
    });
    return { points: data.points };
  });

  res.status(200).json({ points });
});

// Text for one attachment. A matching Document (same key+driver — the
// exact content-addressing lookup upload()/fromDocument() already use for
// dedup) means this attachment came from the ingest library and already
// has its text cached there; reused rather than re-parsed. Only an
// attachment that was uploaded directly, bypassing the library, ever falls
// through to extracting fresh from the stored bytes. Returns null (not a
// throw) for anything unreadable — one bad attachment shouldn't block
// summarising the rest of a lecture's files.
const getAttachmentText = async (attachment) => {
  const doc = await Document.findOne({ key: attachment.key, driver: attachment.driver }).select("extractedText");
  if (doc?.extractedText) return doc.extractedText;

  if (!EXTRACT_SUPPORTED.includes(attachment.mimeType)) return null;

  try {
    const buffer = await storage.get(attachment.key, attachment.driver);
    const { text } = await extractText(buffer, attachment.mimeType);
    return text;
  } catch {
    return null;
  }
};

//@desc   Prose summary of what's in a lecture's attachments — each
//        student's own, like summarizeLecture above.
//@route  POST /api/app/batches/:batchId/lectures/:id/summarize-attachments
//@access Private (student + batchAccess + features.lectures + features.aiAssist)
const summarizeLectureAttachments = asyncHandler(async (req, res) => {
  const lecture = await Lecture.findById(req.params.id).populate("attachments");

  if (!lecture || !lecture.isPublished || !lecture.batches.some((b) => String(b) === String(req.batch._id))) {
    res.status(404);
    throw new Error("Lecture not found in this batch.");
  }
  if (!req.body.regenerate) {
    const { aiAttachmentSummary } = await lectureSummaries.mine(lecture, req.student._id);
    if (aiAttachmentSummary) {
      res.status(200).json({ summary: aiAttachmentSummary });
      return;
    }
  }
  if (!lecture.attachments || lecture.attachments.length === 0) {
    res.status(400);
    throw new Error("This lecture has no attachments to summarise.");
  }

  const { summary } = await lectureSummaries.make(lecture, req.student._id, "attachments", async () => {
    const parts = [];
    for (const attachment of lecture.attachments) {
      const text = await getAttachmentText(attachment);
      if (text && text.trim()) parts.push(`# ${attachment.title || "Attachment"}\n${text}`);
    }

    if (parts.length === 0) {
      throw Object.assign(
        new Error("None of this lecture's attachments could be read for a summary — only PDF, Word, PowerPoint and plain text files are supported."),
        { statusCode: 400 }
      );
    }

    const prompt = summarizeLectureAttachmentsPrompt({
      title: lecture.title,
      description: lecture.description,
      attachmentText: parts.join("\n\n---\n\n"),
    });
    const { data } = await aiService.generate({
      feature: "lecture-attachment-summary",
      schema: lectureAttachmentSummarySchema,
      student: req.student._id,
      batch: req.batch._id,
      ...prompt,
    });
    return { summary: data.summary };
  });

  res.status(200).json({ summary });
});

//@desc   A lecture's "Ace this lecture" practice questions — answer key
//        included, same as SimilarQuestionsModal's AI-generated set. This
//        is an instant self-check, not a tracked attempt: no submission
//        record, no score saved anywhere, checking an answer is pure
//        client-side comparison once the student has the question in hand.
//@route  GET /api/app/batches/:batchId/lectures/:id/practice
//@access Private (student + batchAccess + features.lectures + features.practice)
const getPracticeQuestions = asyncHandler(async (req, res) => {
  const lecture = await Lecture.findById(req.params.id).select("isPublished batches practiceQuestionSets");

  if (!lecture || !lecture.isPublished || !lecture.batches.some((b) => String(b) === String(req.batch._id))) {
    res.status(404);
    throw new Error("Lecture not found in this batch.");
  }

  // One set per batch (lectureModel.js) — this student only ever sees the
  // set built for the batch they're actually viewing the lecture through,
  // never another batch's set even if this lecture is shared across both.
  const set = lecture.practiceQuestionSets.find((s) => String(s.batch) === String(req.batch._id));
  const questionIds = set?.questions || [];

  if (questionIds.length === 0) {
    res.status(200).json({ questions: [] });
    return;
  }

  // Re-checked here rather than trusted from the stored ids — a question
  // pulled from the practice set (rejected on later review) or unpublished
  // shouldn't keep reaching students just because it's still in the array.
  const questions = await Question.find({
    _id: { $in: questionIds },
    type: { $in: ["mcq", "mtf"] },
    status: "published",
  });

  // In the lecture's own saved order, not whatever order Mongo's $in
  // returned them in.
  const order = new Map(questionIds.map((id, i) => [String(id), i]));
  questions.sort((a, b) => order.get(String(a._id)) - order.get(String(b._id)));

  const shaped = await Promise.all(
    questions.map(async (q) => ({ ...(await forReview(q)), source: q.source }))
  );

  res.status(200).json({ questions: shaped });
});

module.exports = { getLectures, getLecture, updateProgress, summarizeLecture, summarizeLectureAttachments, getPracticeQuestions };
