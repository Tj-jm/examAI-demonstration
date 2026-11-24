const asyncHandler = require("express-async-handler");
const Lecture = require("../../models/lectureModel");
const Chapter = require("../../models/chapterModel");
const Topic = require("../../models/topicModel");
const Media = require("../../models/mediaModel");
const Batch = require("../../models/batchModel");
const { Question } = require("../../models/questionModel");
const { shape: shapeMedia } = require("./mediaController");
const { forReview } = require("../../utils/shapeQuestion");
const AiConfig = require("../../models/aiConfigModel");
const aiService = require("../../ai/service");
const {
  generateLecturePracticeQuestions: generateLecturePracticeQuestionsPrompt,
  suggestLectureDescription: suggestLectureDescriptionPrompt,
} = require("../../ai/prompts");
const {
  lecturePracticeQuestions: lecturePracticeQuestionsSchema,
  lectureDescriptionSuggestion: lectureDescriptionSuggestionSchema,
} = require("../../ai/schemas");

// Only these two are self-checkable with no grading step — see
// lectureModel.js's practiceQuestions comment. Shared by both the
// bank-assignment endpoint and the AI-generation one below so a lecture's
// practice set can never end up with a written question in it either way.
const PRACTICE_TYPES = ["mcq", "mtf"];

// What the admin's practice-question window needs beyond forReview: where the
// question is filed and whether it's a normal bank question (isForPractice)
// or one kept to this lecture's quiz.
const bankFiling = (q) => ({
  source: q.source,
  isForPractice: q.isForPractice !== false,
  lectureQuizOnly: q.lectureQuizOnly === true,
  chapter: q.chapter ? String(q.chapter._id || q.chapter) : null,
  topic: q.topic ? String(q.topic._id || q.topic) : null,
});

// Lectures are a pool. A batch sees one because it is listed in that lecture's
// `batches` array — nothing is matched implicitly by subject, which is why the
// three branching paths of the original getLecturesByBatch are gone.
//
// `tag` replaces lectureType. It groups lectures for the author's benefit and
// has no bearing on who can see them, so there is only ever one gate.

const UPDATABLE = [
  "title",
  "description",
  "bodyMarkdown",
  "topic",
  "video",
  "attachments",
  "tag",
  "order",
  "isPublished",
];

const pick = (body, fields) =>
  fields.reduce((acc, key) => {
    if (body[key] !== undefined) acc[key] = body[key];
    return acc;
  }, {});

//@desc   List lectures in the pool
//@route  GET /api/lectures
//@access Private
const getLectures = asyncHandler(async (req, res) => {
  const { subject, chapter, topic, tag, batch, search, unassigned } = req.query;
  const page = Number(req.query.page) || 1;
  const limit = Math.min(Number(req.query.limit) || 30, 100);

  const query = {};
  if (subject) query.subject = subject;
  if (chapter) query.chapter = chapter;
  // "none" is the chapter-pool sentinel used everywhere else in this app
  // (questionController.js's getQuestions, aiController.js's
  // getReviewQueue, examController.js's smartPickQuestions, …) — a lecture
  // filed straight under a chapter with no topic of its own.
  if (topic === "none") query.topic = null;
  else if (topic) query.topic = topic;
  if (tag) query.tag = tag;
  if (batch) query.batches = batch;
  if (search) query.title = { $regex: search, $options: "i" };

  // Content sitting in the pool with nowhere to be seen is the most common
  // thing an author is hunting for.
  if (unassigned === "true") query.batches = { $size: 0 };

  if (req.query.includeUnpublished !== "true") query.isPublished = true;

  // Counts for the status strip on the list page: the same filters, before
  // the status itself narrows them.
  const base = { ...query };
  // Lectures with an AI video lesson (made, and published to students).
  const VideoLesson = require("../../models/videoLessonModel");
  const [withAiVideo, aiPublished] = await Promise.all([
    VideoLesson.distinct("lecture", { lecture: { $ne: null }, student: null, "segments.0": { $exists: true } }),
    VideoLesson.distinct("lecture", { lecture: { $ne: null }, student: null, "segments.0": { $exists: true }, published: true }),
  ]);
  const STATUS = {
    published: { isPublished: true },
    draft: { isPublished: false },
    novideo: { video: null },
    unassigned: { batches: { $size: 0 } },
    aivideo: { _id: { $in: aiPublished } },
    noaivideo: { _id: { $nin: withAiVideo } },
  };
  if (STATUS[req.query.status]) Object.assign(query, STATUS[req.query.status]);

  const counts = req.query.counts === "true"
    ? Object.fromEntries(await Promise.all([
      ["all", base],
      ...Object.entries(STATUS).map(([key, extra]) => [key, { ...base, ...extra }]),
    ].map(async ([key, q]) => [key, await Lecture.countDocuments(q)])))
    : undefined;

  const [lectures, total] = await Promise.all([
    Lecture.find(query)
      .populate("chapter", "title section")
      .populate("topic", "title")
      .populate("video")
      .sort({ order: 1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Lecture.countDocuments(query),
  ]);

  res.status(200).json({
    lectures: await Promise.all(
      lectures.map(async (l) => {
        const doc = l.toObject();
        // A signed video url expires, so it is resolved per request rather
        // than stored on the document.
        if (doc.video) doc.video = await shapeMedia(doc.video);
        doc.aiVideo = aiPublished.some((id) => String(id) === String(doc._id)) ? "published"
          : withAiVideo.some((id) => String(id) === String(doc._id)) ? "draft" : null;
        return doc;
      })
    ),
    total,
    page,
    pages: Math.ceil(total / limit),
    counts,
  });
});

//@desc   Who watched a lecture: started, finished, how far on average
//@route  GET /api/lectures/:id/stats
//@access Private
const getLectureStats = asyncHandler(async (req, res) => {
  const lecture = await Lecture.findById(req.params.id).select("video batches").populate("video", "durationSeconds").populate("batches", "name");
  if (!lecture) {
    res.status(404);
    throw new Error("Lecture not found.");
  }
  const LectureProgress = require("../../models/lectureProgressModel");
  const rows = await LectureProgress.find({ lecture: lecture._id }).select("batch lastPositionSeconds completedAt lastWatchedAt").lean();
  const length = lecture.video?.durationSeconds || 0;
  // How far one student got, 0..1. A finished lecture counts as all of it.
  const share = (r) => (r.completedAt ? 1 : length ? Math.min(1, (r.lastPositionSeconds || 0) / length) : null);
  const sum = (list) => {
    const shares = list.map(share).filter((v) => v != null);
    return {
      started: list.length,
      finished: list.filter((r) => r.completedAt).length,
      averagePercent: shares.length ? Math.round((shares.reduce((a, b) => a + b, 0) / shares.length) * 100) : null,
      lastWatchedAt: list.reduce((at, r) => (r.lastWatchedAt && (!at || r.lastWatchedAt > at) ? r.lastWatchedAt : at), null),
    };
  };
  const byBatch = (lecture.batches || []).map((b) => ({
    batch: { _id: b._id, name: b.name },
    ...sum(rows.filter((r) => String(r.batch) === String(b._id))),
  }));
  res.status(200).json({ ...sum(rows), durationSeconds: length || null, byBatch });
});

//@desc   Get one lecture
//@route  GET /api/lectures/:id
//@access Private
const getLecture = asyncHandler(async (req, res) => {
  const lecture = await Lecture.findById(req.params.id)
    .populate("subject", "title")
    .populate("chapter", "title section")
    .populate("topic", "title")
    .populate("video")
    .populate("attachments")
    .populate("batches", "name")
    .populate("practiceQuestionSets.batch", "name")
    .populate("practiceQuestionSets.questions");

  if (!lecture) {
    res.status(404);
    throw new Error("Lecture not found.");
  }

  const doc = lecture.toObject();
  if (doc.video) doc.video = await shapeMedia(doc.video);
  if (Array.isArray(doc.attachments)) {
    doc.attachments = await Promise.all(doc.attachments.map((a) => shapeMedia(a)));
  }
  // The admin editor needs to show the source (so an AI-written question can
  // be badged and reviewed) and, for mcq, images — forReview already
  // resolves media and is what every other "an admin needs the full,
  // answer-key-included shape" call site uses.
  if (Array.isArray(doc.practiceQuestionSets)) {
    doc.practiceQuestionSets = await Promise.all(
      lecture.practiceQuestionSets.map(async (set) => ({
        batch: set.batch,
        questions: await Promise.all(
          set.questions.map(async (q) => ({ ...(await forReview(q)), ...bankFiling(q) }))
        ),
      }))
    );
  }

  res.status(200).json(doc);
});

//@desc   Create a lecture
//@route  POST /api/lectures
//@access Private
const createLecture = asyncHandler(async (req, res) => {
  const { title, chapter, topic } = req.body;

  if (!title || !chapter) {
    res.status(400);
    throw new Error("A title and chapter are required.");
  }

  const parent = await Chapter.findById(chapter);
  if (!parent) {
    res.status(404);
    throw new Error("Chapter not found.");
  }

  // A topic is optional, but if given it has to belong to the chapter — a
  // lecture filed under a topic from a different chapter would be unreachable
  // from either.
  if (topic) {
    const child = await Topic.findById(topic);
    if (!child) {
      res.status(404);
      throw new Error("Topic not found.");
    }
    if (String(child.chapter) !== String(parent._id)) {
      res.status(400);
      throw new Error("That topic does not belong to this chapter.");
    }
  }

  const lecture = await Lecture.create({
    ...pick(req.body, UPDATABLE),
    chapter: parent._id,
    // derived, never accepted from the body, so it cannot disagree
    subject: parent.subject,
    batches: [],
  });

  res.status(201).json(lecture);
});

//@desc   Update a lecture
//@route  PUT /api/lectures/:id
//@access Private
const updateLecture = asyncHandler(async (req, res) => {
  const lecture = await Lecture.findById(req.params.id);

  if (!lecture) {
    res.status(404);
    throw new Error("Lecture not found.");
  }

  if (req.body.chapter && String(req.body.chapter) !== String(lecture.chapter)) {
    const parent = await Chapter.findById(req.body.chapter);
    if (!parent) {
      res.status(404);
      throw new Error("Chapter not found.");
    }
    lecture.chapter = parent._id;
    lecture.subject = parent.subject;
    // The old topic belonged to the old chapter, so it cannot survive the move.
    lecture.topic = undefined;
  }

  if (req.body.topic) {
    const child = await Topic.findById(req.body.topic);
    if (!child) {
      res.status(404);
      throw new Error("Topic not found.");
    }
    if (String(child.chapter) !== String(lecture.chapter)) {
      res.status(400);
      throw new Error("That topic does not belong to this chapter.");
    }
  }

  // batches is not in UPDATABLE. Assignment goes through the assignment
  // endpoints so there is one code path for it, not two.
  Object.assign(lecture, pick(req.body, UPDATABLE));
  await lecture.save();

  res.status(200).json(lecture);
});

// One set per batch (lectureModel.js's practiceQuestionSets) — finds the
// existing subdocument for a batch, or pushes a fresh empty one so callers
// always have something to assign `.questions` onto. Never queries; the
// caller already has `lecture` loaded and is about to `.save()` it.
const findOrCreateSet = (lecture, batchId) => {
  let set = lecture.practiceQuestionSets.find((s) => String(s.batch) === String(batchId));
  if (!set) {
    lecture.practiceQuestionSets.push({ batch: batchId, questions: [] });
    set = lecture.practiceQuestionSets[lecture.practiceQuestionSets.length - 1];
  }
  return set;
};

const shapeSet = async (set) => ({
  batch: set.batch,
  questions: await Promise.all(set.questions.map(async (q) => ({ ...(await forReview(q)), ...bankFiling(q) }))),
});

//@desc   Assign existing bank questions to one batch's "Ace this lecture"
//        practice set — same pattern as examController's setQuestions,
//        restricted to mcq/mtf (see PRACTICE_TYPES), scoped to one of this
//        lecture's batches at a time so different batches can carry
//        different sets.
//@route  PUT /api/lectures/:id/practice-questions
//@access Private
const setPracticeQuestions = asyncHandler(async (req, res) => {
  const lecture = await Lecture.findById(req.params.id);
  if (!lecture) {
    res.status(404);
    throw new Error("Lecture not found.");
  }

  const { batchId, questionIds } = req.body;
  if (!batchId || !lecture.batches.some((b) => String(b) === String(batchId))) {
    res.status(400);
    throw new Error("Pick one of this lecture's assigned batches.");
  }
  if (!Array.isArray(questionIds)) {
    res.status(400);
    throw new Error("Send the question ids to keep.");
  }

  const unique = [...new Set(questionIds.map(String))];
  const found = await Question.find({ _id: { $in: unique } }).select("type").lean();

  if (found.length !== unique.length) {
    const foundIds = new Set(found.map((q) => String(q._id)));
    const missing = unique.filter((id) => !foundIds.has(id));
    res.status(400);
    throw new Error(`${missing.length} question id${missing.length === 1 ? "" : "s"} could not be found.`);
  }

  const wrongType = found.filter((q) => !PRACTICE_TYPES.includes(q.type));
  if (wrongType.length > 0) {
    res.status(400);
    throw new Error("Only multiple-choice and true/false questions can go in a lecture's practice set — written questions need grading, which defeats an instant self-check.");
  }

  findOrCreateSet(lecture, batchId).questions = unique;
  await lecture.save();

  await lecture.populate("practiceQuestionSets.questions");
  const set = lecture.practiceQuestionSets.find((s) => String(s.batch) === String(batchId));
  res.status(200).json(await shapeSet(set));
});

//@desc   Generate new practice questions with AI from this lecture's notes,
//        and add them to its practice set. Admin-triggered — student: null
//        on the AI call, so this never touches any student's own daily
//        cap or credits (see featureCosts.js's comment on why this feature
//        key has no cost entry). Costs whatever the platform's AI provider
//        costs to run, attributed to the chosen batch for reporting only.
//@route  POST /api/lectures/:id/practice-questions/generate
//@access Private
const generatePracticeQuestions = asyncHandler(async (req, res) => {
  const lecture = await Lecture.findById(req.params.id);
  if (!lecture) {
    res.status(404);
    throw new Error("Lecture not found.");
  }

  const { batchId, count } = req.body;
  if (!batchId || !lecture.batches.some((b) => String(b) === String(batchId))) {
    res.status(400);
    throw new Error("Pick one of this lecture's assigned batches to generate against.");
  }
  const types = ["mcq", "mtf"].includes(req.body.types) ? req.body.types : "mixed";

  // Writes questions, so it also follows the admin-wide "Generate
  // questions" switch in AI settings, on top of the batch switches.
  if (!(await AiConfig.get()).features.questionGeneration) {
    res.status(403);
    throw new Error("Question generation is switched off in AI settings.");
  }

  const batch = await Batch.findById(batchId).select("features");
  if (!batch?.features?.aiAssist || !batch?.features?.lecturePracticeGeneration) {
    res.status(400);
    throw new Error("AI-generated practice questions aren't turned on for that batch — enable both AI assist and lecture practice generation first.");
  }

  if (!lecture.bodyMarkdown || !lecture.bodyMarkdown.trim()) {
    res.status(400);
    throw new Error("This lecture has no written notes yet — there's nothing to generate questions from.");
  }
  // No topic requirement here — Question.topic is optional (questionModel.js:
  // null means chapter pool, same as a question filed there by hand), so a
  // lecture with no topic of its own (filed at the chapter level only) can
  // still generate a chapter-pool practice set. A prior version of this
  // check claimed topic was required and blocked every chapter-only lecture
  // from ever generating practice questions at all — it wasn't.

  const requestedCount = Math.min(Math.max(Number(count) || 5, 3), 8);

  const prompt = generateLecturePracticeQuestionsPrompt({
    title: lecture.title,
    bodyMarkdown: lecture.bodyMarkdown,
    count: requestedCount,
    types,
  });

  const { data, usage } = await aiService.generate({
    feature: "lecture-practice-generate",
    schema: lecturePracticeQuestionsSchema,
    student: null,
    batch: batchId,
    ...prompt,
  });

  // A model that ignored the type asked for: keep only what was asked.
  const wanted = data.questions.filter((q) => types === "mixed" || q.type === types);
  if (!wanted.length) {
    res.status(502);
    throw new Error("The AI didn't write the type of question asked for. Try again.");
  }

  const created = await Promise.all(
    wanted.map((q) =>
      Question.create({
        type: q.type,
        question: q.question,
        subject: lecture.subject,
        chapter: lecture.chapter,
        // null here is the chapter-pool convention, not a missing value —
        // same as any hand-filed chapter-pool question (questionModel.js).
        topic: lecture.topic || null,
        // Scoped to just the batch generated for, not every batch this
        // lecture happens to be assigned to — a question written for one
        // batch's practice set has no business also silently appearing in
        // another batch's exam builder or bank search.
        batches: [batchId],
        difficulty: q.difficulty,
        skillType: q.skillType,
        solutionText: q.solutionText,
        // Only in this lecture's quiz: never on the batch's practice page,
        // practice exams, the study plan or the tutor (batchQuestionScope).
        // Bank questions picked into the quiz keep showing there as before.
        isForPractice: false,
        lectureQuizOnly: true,
        source: "ai",
        aiMeta: { model: usage?.model, sourceRef: String(lecture._id) },
        status: "published",
        publishedAt: new Date(),
        ...(q.type === "mcq"
          ? { options: q.options, correctOption: q.correctOption }
          : { statements: q.statements }),
      })
    )
  );

  const set = findOrCreateSet(lecture, batchId);
  set.questions = [...set.questions, ...created.map((q) => q._id)];
  await lecture.save();

  const shapedNew = await Promise.all(created.map(async (q) => ({ ...(await forReview(q)), ...bankFiling(q) })));
  res.status(200).json({
    created: shapedNew,
    practiceQuestionIds: set.questions,
  });
});

//@desc   Delete a lecture
//@route  DELETE /api/lectures/:id
//@access Private
const deleteLecture = asyncHandler(async (req, res) => {
  const lecture = await Lecture.findById(req.params.id);

  if (!lecture) {
    res.status(404);
    throw new Error("Lecture not found.");
  }

  // Unlike a question in an exam, a lecture has no dependants that would break.
  // Removing it from the batches that show it is enough, and that is implicit
  // in deleting the document.
  const mediaIds = [lecture.video, ...(lecture.attachments || [])].filter(Boolean);

  await lecture.deleteOne();
  await require("../../models/docChunkModel").deleteMany({ lecture: lecture._id });

  // Media is deleted with the lecture only when nothing else points at it.
  for (const id of mediaIds) {
    const stillUsed = await Lecture.countDocuments({
      $or: [{ video: id }, { attachments: id }],
    });
    if (stillUsed === 0) {
      await Media.deleteOne({ _id: id });
    }
  }

  res.status(200).json({ message: "Lecture deleted." });
});

//@desc   The full platform order as bare ids, cheapest shape possible
//@route  GET /api/lectures/order
//@access Private
// reorderLectures rewrites every lecture's order in one bulkWrite, so moving
// one lecture within a single batch still needs the whole platform's current
// order to merge into — but computing that merge only needs ids, not each
// lecture's populated chapter/topic/video and a signed url resolved per row.
// getLectures pages that full shape 100 at a time; this returns every id in
// one lean, unpopulated query instead.
const getLectureOrder = asyncHandler(async (req, res) => {
  const lectures = await Lecture.find({}).select("_id").sort({ order: 1, createdAt: -1 }).lean();
  res.status(200).json({ ids: lectures.map((l) => l._id) });
});

//@desc   Reorder lectures within a chapter
//@route  PUT /api/lectures/reorder
//@access Private
const reorderLectures = asyncHandler(async (req, res) => {
  const { ids } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400);
    throw new Error("Send the lecture ids in their new order.");
  }

  await Lecture.bulkWrite(
    ids.map((id, index) => ({
      updateOne: { filter: { _id: id }, update: { order: index } },
    }))
  );

  res.status(200).json({ message: "Order saved." });
});

//@desc   Publish or unpublish in bulk
//@route  PUT /api/lectures/publish
//@access Private
const setPublished = asyncHandler(async (req, res) => {
  const { ids, isPublished } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400);
    throw new Error("Send a list of lecture ids.");
  }

  const result = await Lecture.updateMany(
    { _id: { $in: ids } },
    { isPublished: Boolean(isPublished) }
  );

  res.status(200).json({
    message: `${result.modifiedCount} lecture${result.modifiedCount === 1 ? "" : "s"} updated.`,
    modified: result.modifiedCount,
  });
});

//@desc   Drafts a short description from a lecture's own written notes —
//        works for a lecture that hasn't been saved yet (a title + draft
//        notes typed into the editor's form, sent straight through) as well
//        as an existing one, so it doesn't force "save first, then
//        generate". Draft-only: the caller fills the description field with
//        the result and still saves it themselves, same as suggestSeoMeta.
//        Gated on an admin-wide AiConfig switch, not a batch feature — this
//        is an authoring aid, not something a batch's students opt into or
//        are ever billed for.
//@route  POST /api/lectures/description/suggest
//@access Private
const suggestDescription = asyncHandler(async (req, res) => {
  const config = await AiConfig.get();
  if (!config.features.lectureDescription) {
    res.status(403);
    throw new Error("AI lecture descriptions are switched off in AI settings.");
  }

  const title = String(req.body.title || "").trim();
  const bodyMarkdown = String(req.body.bodyMarkdown || "").trim();

  if (!bodyMarkdown) {
    res.status(400);
    throw new Error("Write the lecture's notes first — there's nothing to draft a description from yet.");
  }

  const prompt = suggestLectureDescriptionPrompt({ title: title || "Untitled lecture", bodyMarkdown });

  const { data } = await aiService.generate({
    feature: "lecture-description-suggest",
    schema: lectureDescriptionSuggestionSchema,
    ...prompt,
    maxTokens: 200,
    user: req.user._id,
  });

  res.status(200).json(data);
});

//@desc   Rebuild document chat's index of a lecture (notes + files)
//@route  POST /api/lectures/:id/doc-index
//@access Private
const reindexLecture = asyncHandler(async (req, res) => {
  const lecture = await Lecture.findById(req.params.id).select("_id");
  if (!lecture) {
    res.status(404);
    throw new Error("Lecture not found.");
  }
  const result = await require("../../utils/docIndex").indexLecture(lecture._id);
  const fresh = await Lecture.findById(lecture._id).select("docIndex");
  res.status(200).json({ docIndex: fresh.docIndex, ...result });
});

//@desc   Read a lecture's scanned pages with AI vision, so document chat can
//        search them. Costs AI calls (billed to the platform like other
//        admin AI actions); runs in the background.
//@route  POST /api/lectures/:id/doc-index/read-scans
//@access Private
const readLectureScans = asyncHandler(async (req, res) => {
  const lecture = await Lecture.findById(req.params.id).select("docIndex");
  if (!lecture) {
    res.status(404);
    throw new Error("Lecture not found.");
  }
  const pages = (lecture.docIndex?.pendingScans || []).reduce((n, e) => n + (e.pages?.length || 0), 0);
  if (!pages) {
    res.status(400);
    throw new Error("This lecture has no scanned pages waiting to be read.");
  }
  const { readScannedPages, MAX_SCAN_PAGES } = require("../../utils/docIndex");
  readScannedPages(lecture._id, req.user._id).catch((error) => console.error(`Reading scans for lecture ${lecture._id}: ${error.message}`));
  res.status(202).json({ pages: Math.min(pages, MAX_SCAN_PAGES), message: `Reading ${Math.min(pages, MAX_SCAN_PAGES)} scanned page(s). The index updates when it's done.` });
});

module.exports = {
  getLectureStats,
  reindexLecture,
  readLectureScans,
  getLectures,
  getLecture,
  getLectureOrder,
  createLecture,
  updateLecture,
  deleteLecture,
  reorderLectures,
  setPublished,
  setPracticeQuestions,
  generatePracticeQuestions,
  suggestDescription,
};