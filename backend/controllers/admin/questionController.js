const asyncHandler = require("express-async-handler");
const { statusCounts } = require("../../utils/statusCounts");
const { answerKeyOf, liveAttempts, scoredAttempts, rescoreQuestion } = require("../../utils/questionAnswerKey");
const mongoose = require("mongoose");
const ExcelJS = require("exceljs");
const { Question } = require("../../models/questionModel");
const Topic = require("../../models/topicModel");
const Chapter = require("../../models/chapterModel");
const Exam = require("../../models/examModel");
const Lecture = require("../../models/lectureModel");
const ExamAuthority = require("../../models/examAuthorityModel");
const { sourcesFromBody, normalizeSources, hasSource, sourceMatch, yearList, parseSourceCells, addSource, parseYears } = require("../../utils/archiveSources");
const { shape: shapeMedia } = require("./mediaController");
const { SKILL_TYPES, normalizeSkillType } = require("../../utils/skillTypes");

// Validation lives here rather than only in the schema because the useful
// errors are cross-field: an MCQ whose correctOption names an option that does
// not exist passes every individual field validator and is still broken.

const COMMON = [
  "question",
  "questionImage",
  "marks",
  "negativeMarks",
  "difficulty",
  "skillType",
  "solutionText",
  "solutionImage",
  "solutionVideo",
  "solutionPdf",
  "solutionAttachments",
  "isPublic",
  "isForPractice",
  "batches",
  "status",
  "tags",
  "context",
  "partLabel",
  "group",
];

// Trim, lowercase, dedupe, drop empties. Mongoose's own pre("save") hook on
// Question does this too, but insertMany (both bulk paths below) skips
// document middleware entirely, so anything that goes through insertMany
// needs this applied explicitly on the way in.
const normalizeTags = (tags) => {
  if (!Array.isArray(tags)) return [];
  const seen = new Set();
  return tags
    .map((t) => String(t).trim().toLowerCase())
    .filter((t) => t && !seen.has(t) && seen.add(t));
};

const BY_TYPE = {
  mcq: ["options", "correctOption"],
  mtf: ["statements"],
  written: ["rubric", "modelAnswer", "wordLimit"],
  // marks is deliberately NOT picked here — a passage's own marks is never
  // taken from the request, always recomputed from subQuestions by the
  // model's pre-validate hook (questionModel.js). Picking it from COMMON
  // instead (below) is harmless since the hook overwrites it regardless.
  passage: ["subQuestions"],
  coding: ["languages", "starterCode", "tests", "timeLimitMs"],
};

// Archive filing: `sources` (every board + its years), or the older single
// authority/year/paperLabel fields. Absent from the body → nothing returned,
// so an update that doesn't mention sources leaves them alone.
const pickSources = (body) => {
  const sources = sourcesFromBody(body);
  return sources ? { sources } : {};
};

const pick = (body, fields) =>
  fields.reduce((acc, key) => {
    if (body[key] !== undefined) acc[key] = body[key];
    return acc;
  }, {});

// Returns a message, or null when the shape is sound.
const validateShape = (type, body) => {
  if (type === "mcq") {
    if (!Array.isArray(body.options) || body.options.length < 2) {
      return "An MCQ needs at least two options.";
    }

    const keys = body.options.map((o) => o && o.key);

    if (keys.some((k) => !k)) {
      return "Every option needs a key.";
    }
    if (new Set(keys).size !== keys.length) {
      return "Option keys must be unique.";
    }
    if (body.options.some((o) => !o.text && !o.image)) {
      return "Every option needs text or an image.";
    }
    if (!body.correctOption) {
      return "Mark which option is correct.";
    }
    // The check the schema cannot make on its own.
    if (!keys.includes(body.correctOption)) {
      return `The correct option "${body.correctOption}" is not one of the options.`;
    }
    return null;
  }

  if (type === "mtf") {
    if (!Array.isArray(body.statements) || body.statements.length < 2) {
      return "An MTF question needs at least two statements.";
    }
    if (body.statements.some((s) => !s || !s.text)) {
      return "Every statement needs text.";
    }
    if (body.statements.some((s) => typeof s.isTrue !== "boolean")) {
      return "Every statement must be marked true or false.";
    }
    return null;
  }

  if (type === "written") {
    // A rubric is optional at authoring time, but without one the AI grader
    // has nothing to score against — flagged in the response rather than
    // blocking, so a teacher can draft first and add the rubric later.
    if (body.rubric && !Array.isArray(body.rubric)) {
      return "The rubric must be a list of criteria.";
    }
    if (Array.isArray(body.rubric) && body.rubric.some((r) => !r.criterion || r.marks === undefined)) {
      return "Every rubric row needs a criterion and marks.";
    }
    return null;
  }

  if (type === "coding") {
    const { LANGUAGES } = require("../../utils/codeRunner");
    if (!Array.isArray(body.languages) || !body.languages.length) return "Allow at least one language.";
    if (body.languages.some((l) => !LANGUAGES[l])) return "One of the languages isn't supported.";
    if (!Array.isArray(body.tests) || !body.tests.length) return "Add at least one test.";
    if (body.tests.some((t) => !t || typeof t.output !== "string" || !t.output.trim())) return "Every test needs an expected output.";
    if (body.tests.length > 50) return "No more than 50 tests.";
    return null;
  }

  if (type === "passage") {
    if (!Array.isArray(body.subQuestions) || body.subQuestions.length < 1) {
      return "Add at least one question under the passage.";
    }
    for (let i = 0; i < body.subQuestions.length; i += 1) {
      const sq = body.subQuestions[i] || {};
      const label = `Question ${i + 1}`;
      if (!sq.question) return `${label} is missing its text.`;
      // A written question under the passage: marked against its rubric.
      if (sq.type === "written") {
        if (!(Number(sq.marks) > 0)) return `${label} needs marks.`;
        continue;
      }
      if (!Array.isArray(sq.options) || sq.options.length < 2) {
        return `${label} needs at least two options.`;
      }
      const keys = sq.options.map((o) => o && o.key);
      if (keys.some((k) => !k)) return `${label}: every option needs a key.`;
      if (new Set(keys).size !== keys.length) return `${label}: option keys must be unique.`;
      if (sq.options.some((o) => !o.text && !o.image)) {
        return `${label}: every option needs text or an image.`;
      }
      if (!sq.correctOption) return `${label}: mark which option is correct.`;
      if (!keys.includes(sq.correctOption)) {
        return `${label}: the correct option "${sq.correctOption}" is not one of its options.`;
      }
    }
    return null;
  }

  return "Unknown question type.";
};

// Groups questions by where their topic sits in the syllabus rather than by
// creation time — the same order/title pair every other list in the admin
// panel sorts by (see taxonomyController's getTree). A plain
// `.sort({ topic: 1 })` would group by the topic's ObjectId, which has no
// relationship to the order a teacher actually arranged subjects, chapters
// and topics in, so the grouping would look arbitrary rather than by topic.
// Newest to the bank first: when a question went live, falling back to when
// it was written for drafts and pending ones. _id breaks ties, so a bulk
// batch sharing one timestamp pages in a stable order.
const NEWEST_FIRST = { publishedAt: -1, createdAt: -1, _id: -1 };

const findSortedByTopic = async (query, page, limit) =>
  Question.aggregate([
    { $match: query },
    { $lookup: { from: "subjects", localField: "subject", foreignField: "_id", as: "_subject" } },
    { $lookup: { from: "chapters", localField: "chapter", foreignField: "_id", as: "_chapter" } },
    { $lookup: { from: "topics", localField: "topic", foreignField: "_id", as: "_topic" } },
    { $unwind: { path: "$_subject", preserveNullAndEmptyArrays: true } },
    { $unwind: { path: "$_chapter", preserveNullAndEmptyArrays: true } },
    { $unwind: { path: "$_topic", preserveNullAndEmptyArrays: true } },
    {
      $sort: {
        "_subject.order": 1, "_subject.title": 1,
        "_chapter.order": 1, "_chapter.title": 1,
        "_topic.order": 1, "_topic.title": 1,
        ...NEWEST_FIRST,
      },
    },
    { $skip: (page - 1) * limit },
    { $limit: limit },
    { $project: { _subject: 0, _chapter: 0, _topic: 0 } },
  ]);

// No solution of any kind, and none waiting in review.
const MISSING_SOLUTION = [
  { $or: [{ solutionText: { $in: [null, ""] } }, { solutionText: { $exists: false } }] },
  { solutionVideo: { $exists: false } },
  { solutionPdf: { $exists: false } },
  { solutionStatus: { $ne: "pending_review" } },
];
const HAS_MODEL_ANSWER = { $exists: true, $nin: [null, ""] };
const HAS = { $exists: true, $nin: [null, ""] };
const EMPTY = { $in: [null, ""] };
// For reference fields (a Media id): "" isn't a valid id to compare with.
const HAS_REF = { $exists: true, $ne: null };
const NO_REF = { $in: [null] };
// The admin list's "Resources" filter: what a question already has.
// AI video ones are resolved against VideoLesson (async).
const RESOURCE_FILTERS = {
  solution: { solutionText: HAS },
  "no-solution-text": { solutionText: EMPTY },
  "solution-image": { solutionImage: HAS_REF },
  "solution-video": { solutionVideo: HAS_REF },
  "no-solution-video": { solutionVideo: NO_REF },
  "solution-pdf": { $or: [{ solutionPdf: HAS_REF }, { "solutionAttachments.0": { $exists: true } }] },
  "model-answer": { modelAnswer: HAS },
  "no-model-answer": { type: "written", modelAnswer: EMPTY },
};
const resourceFilter = async (resource) => {
  if (RESOURCE_FILTERS[resource]) return RESOURCE_FILTERS[resource];
  if (!["ai-video", "ai-video-published", "no-ai-video"].includes(resource)) return null;
  const VideoLesson = require("../../models/videoLessonModel");
  const ids = await VideoLesson.distinct("question", {
    question: { $ne: null },
    ...(resource === "ai-video-published" ? { published: true } : {}),
    // A lesson still being written for the first time has no script yet.
    "segments.0": { $exists: true },
  });
  return resource === "no-ai-video" ? { _id: { $nin: ids } } : { _id: { $in: ids } };
};

// The lectures whose quiz uses each question, with the batch each quiz is
// for: { questionId: [{ _id, title, batches: [{ _id, name }] }] }. Shown on
// the Questions page for lecture-quiz-only questions, and on one question.
const servingLectures = async (ids) => {
  const lectures = await Lecture.find({ "practiceQuestionSets.questions": { $in: ids } })
    .select("title practiceQuestionSets")
    .populate("practiceQuestionSets.batch", "name")
    .lean();
  const wanted = new Set(ids.map(String));
  const map = {};
  for (const lecture of lectures) {
    for (const set of lecture.practiceQuestionSets || []) {
      for (const qid of set.questions || []) {
        const key = String(qid);
        if (!wanted.has(key)) continue;
        const list = (map[key] = map[key] || []);
        let entry = list.find((l) => String(l._id) === String(lecture._id));
        if (!entry) list.push((entry = { _id: lecture._id, title: lecture.title, batches: [] }));
        if (set.batch && !entry.batches.some((b) => String(b._id) === String(set.batch._id))) {
          entry.batches.push({ _id: set.batch._id, name: set.batch.name });
        }
      }
    }
  }
  return map;
};

//@desc   List questions
//@route  GET /api/questions
//@access Private
const getQuestions = asyncHandler(async (req, res) => {
  const { subject, chapter, topic, type, difficulty, skillType, status, search, hasSolution, hasModelAnswer, sort, tag, authority, year, isPublic } = req.query;
  const page = Number(req.query.page) || 1;
  const limit = Math.min(Number(req.query.limit) || 20, 100);

  // Lecture-quiz-only questions stay out of the bank; ?quizOnly=true lists
  // just them (the Questions page's "Lecture quiz only" filter).
  // ?quizOnly=any lists both (a live class's poll picker).
  const query = req.query.quizOnly === "true" ? { lectureQuizOnly: true } : req.query.quizOnly === "any" ? {} : { ...Question.IN_BANK };
  if (subject) query.subject = subject;
  if (chapter) query.chapter = chapter;
  // A passage's written parts (utils/questionText.js).
  if (req.query.group) query.group = String(req.query.group);
  if (authority && mongoose.isValidObjectId(String(authority))) Object.assign(query, sourceMatch(authority, year));
  else if (year && yearList(year).length) query["sources.years"] = { $in: yearList(year) };
  if (isPublic === "true") query.isPublic = true;
  else if (isPublic === "false") query.isPublic = false;
  // "none" is a sentinel, same convention as skillType's "unassigned" below —
  // { topic: null } matches every chapter-pool question (every passage
  // question, plus any mcq/mtf/written filed straight under a chapter).
  if (topic === "none") query.topic = null;
  else if (topic) query.topic = topic;
  // "mcq,written": any of these types.
  if (type) query.type = String(type).includes(",") ? { $in: String(type).split(",").map((t) => t.trim()).filter(Boolean) } : type;
  if (difficulty) query.difficulty = difficulty;
  // "unassigned" is a sentinel, not a real enum value — { skillType: null }
  // matches both a field explicitly set to null and one that was never set
  // at all, which is exactly "hasn't been classified yet" either way.
  if (skillType === "unassigned") query.skillType = null;
  else if (skillType) query.skillType = skillType;
  // Mongo matches an equality filter against an array field as "contains",
  // so this alone is enough — no $elemMatch needed for a single value.
  if (tag) query.tags = tag.trim().toLowerCase();
  query.status = status || "published";
  // Typed text, not a pattern: "(", "+" and "?" are common in maths.
  if (search) query.question = { $regex: String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };

  if (hasSolution === "false") {
    // A question with a solution already sitting in review is not "missing" a
    // solution — it has one, just not approved yet. Without excluding it here,
    // clicking "Write N solutions" a second time before those first ones are
    // reviewed would burn AI calls re-writing solutions that already exist.
    query.$and = [...MISSING_SOLUTION];
  } else if (hasSolution === "true") {
    // A written-out solution or model answer.
    query.$and = [{ $or: [{ solutionText: HAS }, { modelAnswer: HAS }] }];
  }
  if (hasModelAnswer === "true") query.modelAnswer = HAS_MODEL_ANSWER;
  const byResource = await resourceFilter(req.query.resource);
  if (byResource) query.$and = [...(query.$and || []), byResource];
  // Counts per type for the status strip, under every filter but the type.
  let counts;
  if (req.query.counts === "true") {
    const { type: _type, ...base } = query;
    const TYPES = ["mcq", "mtf", "written", "passage", "coding"];
    counts = await statusCounts(Question, base, Object.fromEntries(TYPES.map((t) => [t, { type: t }])));
  }

  const [rows, total] = await Promise.all([
    sort === "topic"
      ? findSortedByTopic(query, page, limit)
      : Question.find(query)
          .sort(NEWEST_FIRST)
          .skip((page - 1) * limit)
          .limit(limit),
    Question.countDocuments(query),
  ]);

  // Only computed when a specific topic is being browsed and the caller
  // hasn't explicitly asked for a non-default status — that's the exact
  // moment "this topic looks empty" and "these questions are sitting in
  // Review, not actually missing" can otherwise be confused for the same
  // thing. Cheap: one indexed count, only fires when a topic is selected.
  let pendingForTopic = 0;
  if (topic && topic !== "none" && !status) {
    pendingForTopic = await Question.countDocuments({ topic, status: "pending_review" });
  }

  // The aggregation path returns plain objects rather than documents; the
  // populate static works on either, so both paths finish the same way.
  // options.image only exists on mcq docs, but Mongoose no-ops a populate
  // path that a given doc's (discriminator) schema doesn't have, so listing
  // it here is safe for the mtf/written rows mixed into the same result.
  const questions = await Question.populate(rows, [
    { path: "topic", select: "title" },
    { path: "chapter", select: "title" },
    { path: "sources.authority", select: "name shortName type" },
    { path: "questionImage" },
    { path: "options.image" },
  ]);

  const lecturesOf = req.query.quizOnly === "true" ? await servingLectures(rows.map((q) => q._id)) : null;
  res.status(200).json({
    questions: await Promise.all(
      questions.map(async (q) => {
        const doc = typeof q.toObject === "function" ? q.toObject() : q;
        if (doc.questionImage) doc.questionImage = await shapeMedia(doc.questionImage);
        if (Array.isArray(doc.options)) {
          doc.options = await Promise.all(
            doc.options.map(async (option) => ({
              ...option,
              image: option.image ? await shapeMedia(option.image) : null,
            }))
          );
        }
        if (lecturesOf) doc.lectures = lecturesOf[String(doc._id)] || [];
        return doc;
      })
    ),
    total,
    page,
    pages: Math.ceil(total / limit),
    pendingForTopic,
    counts,
  });
});

// A question is useless to the editor without its media resolved: the client
// gets an ObjectId where it expected a url, so a saved image vanishes from the
// form the moment the response comes back.
const loadWithMedia = async (id) => {
  const question = await Question.findById(id)
    .populate("topic", "title")
    .populate("chapter", "title")
    .populate("subject", "title")
    .populate("sources.authority", "name shortName type")
    .populate("questionImage")
    .populate("solutionImage")
    .populate("solutionVideo")
    .populate("solutionPdf")
    .populate("solutionAttachments")
    .populate("options.image")
    .populate("subQuestions.questionImage")
    .populate("subQuestions.options.image");

  if (!question) return null;

  // Media documents hold a storage key, not a url. The url is resolved at
  // request time because a signed one has an expiry.
  const doc = question.toObject();

  for (const field of ["questionImage", "solutionImage", "solutionVideo", "solutionPdf"]) {
    if (doc[field]) doc[field] = await shapeMedia(doc[field]);
  }
  if (Array.isArray(doc.solutionAttachments)) {
    doc.solutionAttachments = await Promise.all(doc.solutionAttachments.map((a) => shapeMedia(a)));
  }

  if (Array.isArray(doc.options)) {
    doc.options = await Promise.all(
      doc.options.map(async (option) => ({
        ...option,
        image: option.image ? await shapeMedia(option.image) : null,
      }))
    );
  }

  if (Array.isArray(doc.subQuestions)) {
    doc.subQuestions = await Promise.all(
      doc.subQuestions.map(async (sq) => ({
        ...sq,
        questionImage: sq.questionImage ? await shapeMedia(sq.questionImage) : null,
        options: await Promise.all(
          (sq.options || []).map(async (option) => ({
            ...option,
            image: option.image ? await shapeMedia(option.image) : null,
          }))
        ),
      }))
    );
  }

  return doc;
};

//@desc   Get one question
//@route  GET /api/questions/:id
//@access Private
const getQuestion = asyncHandler(async (req, res) => {
  const doc = await loadWithMedia(req.params.id);

  if (!doc) {
    res.status(404);
    throw new Error("Question not found.");
  }

  doc.lectures = (await servingLectures([doc._id]))[String(doc._id)] || [];
  res.status(200).json(doc);
});

//@desc   Create a question
//@route  POST /api/questions
//@access Private
// "" from the admin UI's "Not set" option isn't a valid enum member (only
// null/undefined bypass Mongoose's enum check) — normalized to null here so
// picking "Not set" saves cleanly instead of failing validation.
const normalizeSkillTypeBody = (body) => {
  if (body.skillType === "") body.skillType = null;
};

// Resolves where a question is filed: either a topic (subject/chapter
// derived from it, as always) or, for the chapter pool, a chapter directly
// (subject derived from the chapter, topic left null). A passage question
// can only ever use the chapter path — enforced here, not in the schema,
// same "cross-field rule lives in the controller" convention as
// validateShape's correctOption check.
const resolveFiling = async (type, { topic, chapter }) => {
  if (type === "passage") {
    if (topic) {
      return { error: "Passage questions can only be filed under a chapter, not a topic." };
    }
    if (!chapter) {
      return { error: "Choose a chapter." };
    }
    const chapterDoc = await Chapter.findById(chapter);
    if (!chapterDoc) return { error: "Chapter not found.", notFound: true };
    return { topic: null, chapter: chapterDoc._id, subject: chapterDoc.subject };
  }

  if (topic) {
    const topicDoc = await Topic.findById(topic);
    if (!topicDoc) return { error: "Topic not found.", notFound: true };
    return { topic: topicDoc._id, chapter: topicDoc.chapter, subject: topicDoc.subject };
  }

  if (chapter) {
    const chapterDoc = await Chapter.findById(chapter);
    if (!chapterDoc) return { error: "Chapter not found.", notFound: true };
    return { topic: null, chapter: chapterDoc._id, subject: chapterDoc.subject };
  }

  return { error: "Choose a topic, or a chapter for the chapter pool." };
};

const createQuestion = asyncHandler(async (req, res) => {
  normalizeSkillTypeBody(req.body);
  const { type, topic, chapter } = req.body;

  if (!BY_TYPE[type]) {
    res.status(400);
    throw new Error("Choose a question type: mcq, mtf, written, passage or coding.");
  }

  if (!req.body.question) {
    res.status(400);
    throw new Error("Question text is required.");
  }

  const problem = validateShape(type, req.body);
  if (problem) {
    res.status(400);
    throw new Error(problem);
  }

  const filing = await resolveFiling(type, { topic, chapter });
  if (filing.error) {
    res.status(filing.notFound ? 404 : 400);
    throw new Error(filing.error);
  }

  const payload = {
    ...pick(req.body, COMMON),
    ...pickSources(req.body),
    ...pick(req.body, BY_TYPE[type]),
    type,
    topic: filing.topic,
    chapter: filing.chapter,
    subject: filing.subject,
    source: "manual",
  };

  // There is no such thing as a question in "the archive" generically — it
  // is always filed under a specific board/exam/book. isPublic alone with no
  // authority would be visible nowhere in the archive's own browse-by-board
  // navigation, so it is refused rather than silently allowed.
  if (payload.isPublic && !hasSource(payload)) {
    res.status(400);
    throw new Error("Pick a board/exam/book before adding this question to the archive.");
  }

  const question = await Question.create(payload);

  // The same shape a read returns, so the client never has to guess whether an
  // image field holds a url or an id.
  res.status(201).json(await loadWithMedia(question._id));
});

//@desc   Move many questions to a different topic (or the chapter pool) in
//        one call. Reassigning a question's filing used to only be possible
//        one at a time through updateQuestion — the only way to actually
//        clear out (and so delete) a topic with questions spread across a
//        lot of chapters was opening every single one in the editor and
//        changing its topic dropdown by hand.
//@route  PUT /api/questions/bulk/move
//@access Private
const bulkMoveQuestions = asyncHandler(async (req, res) => {
  const { questionIds, topic, chapter } = req.body;

  if (!Array.isArray(questionIds) || questionIds.length === 0) {
    res.status(400);
    throw new Error("Select at least one question to move.");
  }

  const questions = await Question.find({ _id: { $in: questionIds } }).select("type");
  if (questions.length === 0) {
    res.status(404);
    throw new Error("None of the selected questions could be found.");
  }

  // Re-filed through the exact same topic-or-chapter rule a single update
  // uses, per type present in the selection — cached per type rather than
  // per question since the only thing resolveFiling's outcome varies on
  // here is "is this a passage", not which specific question it is.
  const filingByType = new Map();
  for (const q of questions) {
    if (!filingByType.has(q.type)) {
      filingByType.set(q.type, await resolveFiling(q.type, { topic, chapter }));
    }
  }

  const distinctTypes = [...filingByType.values()];
  if (distinctTypes.every((f) => f.error)) {
    // Every type in the selection failed the same way (e.g. the whole
    // selection is passage questions and the target is a topic) — nothing
    // would move, so this is a hard error instead of a silent 0-moved
    // "success".
    res.status(400);
    throw new Error(distinctTypes[0].error);
  }

  let moved = 0;
  const rejected = [];
  for (const q of questions) {
    const filing = filingByType.get(q.type);
    // A passage can't take a topic target any more in bulk than it could
    // through the editor — reported per question rather than silently
    // dropped or silently violating "passage is always chapter pool".
    if (filing.error) {
      rejected.push({ id: String(q._id), reason: filing.error });
      continue;
    }
    await Question.updateOne(
      { _id: q._id },
      { $set: { topic: filing.topic, chapter: filing.chapter, subject: filing.subject } }
    );
    moved += 1;
  }

  res.status(200).json({ moved, rejected });
});

//@desc   Bulk-add (or remove) a set of questions to the public archive —
//        the same "select questions, apply one change to all of them"
//        mechanism bulkMoveQuestions already gives topic/chapter filing,
//        applied to isPublic (+ authority) instead. Every question type is
//        eligible (unlike bulkMoveQuestions' topic-filing rule, isPublic has
//        no passage restriction), so nothing here is ever rejected
//        per-question. There is no generic "add to archive" — a board/exam/
//        book is mandatory whenever isPublic is being turned on, same rule
//        as create/updateQuestion.
//@route  PUT /api/questions/bulk/archive
//@access Private
const bulkArchiveQuestions = asyncHandler(async (req, res) => {
  const { questionIds, isPublic, authority } = req.body;

  if (!Array.isArray(questionIds) || questionIds.length === 0) {
    res.status(400);
    throw new Error("Select at least one question.");
  }
  if (typeof isPublic !== "boolean") {
    res.status(400);
    throw new Error("isPublic must be true or false.");
  }
  if (isPublic && !authority) {
    res.status(400);
    throw new Error("Pick a board/exam/book before adding these questions to the archive.");
  }
  if (isPublic && !mongoose.isValidObjectId(String(authority))) {
    res.status(400);
    throw new Error("That board/exam/book isn't valid.");
  }

  // Removing from the archive keeps every board and year as they are, in
  // case it's added back later.
  if (!isPublic) {
    const result = await Question.updateMany({ _id: { $in: questionIds } }, { $set: { isPublic: false } });
    res.status(200).json({ updated: result.modifiedCount });
    return;
  }

  // Adding files each question under this board with these years (optional)
  // — merged into whatever boards/years it already has, never replacing
  // them. Merged here rather than with a pipeline update so it works on any
  // MongoDB version; a selection is at most a page of questions.
  const years = parseYears(Array.isArray(req.body.years) ? req.body.years : String(req.body.years || "").split(","));
  const questions = await Question.find({ _id: { $in: questionIds } }).select("sources isPublic").lean();
  const ops = questions.map((q) => ({
    updateOne: {
      filter: { _id: q._id },
      update: { $set: { isPublic: true, sources: addSource(q.sources, authority, years) } },
    },
  }));
  const result = ops.length ? await Question.bulkWrite(ops, { ordered: false }) : { modifiedCount: 0 };

  res.status(200).json({ updated: result.modifiedCount });
});


//@desc   Update a question
//@route  PUT /api/questions/:id
//@access Private
const updateQuestion = asyncHandler(async (req, res) => {
  normalizeSkillTypeBody(req.body);
  const question = await Question.findById(req.params.id);

  if (!question) {
    res.status(404);
    throw new Error("Question not found.");
  }

  // Changing type would mean moving between discriminators, which mongoose
  // will not do in place. Delete and recreate instead.
  if (req.body.type && req.body.type !== question.type) {
    res.status(400);
    throw new Error("A question's type cannot be changed. Create a new one instead.");
  }

  // Type-specific fields are validated against the merged result, not the
  // patch, so sending only `correctOption` is still checked against the
  // options already stored.
  const merged = { ...question.toObject(), ...req.body };
  const problem = validateShape(question.type, merged);
  if (problem) {
    res.status(400);
    throw new Error(problem);
  }

  // A filing field present in the body (even resending the same value) is
  // re-resolved through the same topic-or-chapter rule createQuestion uses
  // — including the passage-can't-have-a-topic check — rather than only
  // reassigning topic/chapter/subject piecemeal per field the way this used
  // to. Neither field present at all (the common case: editing anything
  // else about the question) skips this entirely, unchanged from before.
  if (req.body.topic !== undefined || req.body.chapter !== undefined) {
    const filing = await resolveFiling(question.type, { topic: req.body.topic, chapter: req.body.chapter });
    if (filing.error) {
      res.status(filing.notFound ? 404 : 400);
      throw new Error(filing.error);
    }
    question.topic = filing.topic;
    question.chapter = filing.chapter;
    question.subject = filing.subject;
  }

  // The answer key (utils/questionAnswerKey.js) can't change while students
  // are sitting an exam that uses this question.
  const keyBefore = answerKeyOf(question);

  Object.assign(
    question,
    pick(req.body, COMMON),
    pickSources(req.body),
    pick(req.body, BY_TYPE[question.type])
  );
  // "Save to question bank" on a lecture-quiz-only question (admin
  // LectureView): it joins the bank as a normal question.
  if (req.body.addToBank === true) {
    question.lectureQuizOnly = false;
    question.isForPractice = true;
  }

  const keyChanged = answerKeyOf(question) !== keyBefore;
  if (keyChanged) {
    const live = await liveAttempts(question._id);
    if (live.count > 0) {
      res.status(409);
      throw new Error(
        `${live.count} student${live.count === 1 ? " is" : "s are"} sitting ${live.exams.map((e) => `"${e.title}"`).join(", ")} right now. ` +
        "The answer, marks and statements can't change until they finish. Text and solutions can still be edited."
      );
    }
  }

  // Same rule as createQuestion — no generic "in the archive", always a
  // specific board/exam/book.
  if (question.isPublic && !hasSource(question)) {
    res.status(400);
    throw new Error("Pick a board/exam/book before adding this question to the archive.");
  }

  // A person writing solutionText by hand has made their own call — an AI
  // proposal still sitting in review for the same question is now stale,
  // and leaving it there would offer to overwrite the solution just typed.
  if (req.body.solutionText !== undefined && question.solutionStatus === "pending_review") {
    question.solutionStatus = "none";
    question.pendingSolutionText = undefined;
  }

  await question.save();
  // A changed key with finished attempts behind it: the editor offers a
  // re-score (rescoreQuestion below).
  const rescore = keyChanged ? await scoredAttempts(question._id) : null;
  res.status(200).json({ ...(await loadWithMedia(question._id)), rescore: rescore?.submissions ? rescore : null });
});

//@desc   Re-score a question in every finished attempt of every exam using it
//@route  POST /api/questions/:id/rescore
//@access Private
const rescoreQuestionAttempts = asyncHandler(async (req, res) => {
  const question = await Question.findById(req.params.id);
  if (!question) {
    res.status(404);
    throw new Error("Question not found.");
  }
  const live = await liveAttempts(question._id);
  if (live.count > 0) {
    res.status(409);
    throw new Error("Students are sitting an exam with this question right now. Re-score once they finish.");
  }
  res.status(200).json(await rescoreQuestion(question));
});

//@desc   Use written questions' model answers as their missing solutions
//@route  POST /api/questions/bulk/model-answers
//@access Private
// No AI: the model answer is the teacher's (or the reviewed generator's)
// own, so it goes live as the solution straight away. Only questions with
// no solution at all are touched.
const applyModelAnswers = asyncHandler(async (req, res) => {
  const questions = await Question.find({
    status: "published",
    type: "written",
    modelAnswer: HAS_MODEL_ANSWER,
    $and: MISSING_SOLUTION,
  }).select("modelAnswer").lean();
  if (questions.length) {
    await Question.bulkWrite(questions.map((q) => ({
      updateOne: { filter: { _id: q._id }, update: { $set: { solutionText: q.modelAnswer } } },
    })));
  }
  const n = questions.length;
  res.status(200).json({ updated: n, message: `Added ${n} model answer${n === 1 ? "" : "s"} as solution${n === 1 ? "" : "s"}.` });
});

//@desc   Delete a question
//@route  DELETE /api/questions/:id
//@access Private
const deleteQuestion = asyncHandler(async (req, res) => {
  const question = await Question.findById(req.params.id);

  if (!question) {
    res.status(404);
    throw new Error("Question not found.");
  }

  // Deleting a question that an exam still references would silently change
  // that exam's total marks and orphan every submitted answer pointing at it.
  // A legacy practice exam does not count here — nothing an admin can see
  // references the question from their side, so blocking deletion over it
  // would be an unexplainable dead end.
  const usedBy = await Exam.countDocuments({ questions: question._id, createdByStudent: null });

  if (usedBy > 0) {
    res.status(409);
    throw new Error(
      `This question is used in ${usedBy} exam${usedBy === 1 ? "" : "s"}. Remove it from them first.`
    );
  }

  await question.deleteOne();
  res.status(200).json({ message: "Question deleted." });
});

// insertMany (both bulk paths) skips document middleware entirely — see
// normalizeTags' comment above — so a passage row never runs the model's
// pre("validate") hook that normally sums its subQuestions into `marks`.
// Reproduced here rather than left to insertMany so a bulk-imported
// passage's total isn't silently stuck at whatever (or nothing) came
// through COMMON's own `marks` field.
const sumPassageMarks = (subQuestions) =>
  (subQuestions || []).reduce((sum, sq) => sum + (Number(sq.marks) || 0), 0);

//@desc   Create many questions at once
//@route  POST /api/questions/bulk
//@access Private
const bulkCreateQuestions = asyncHandler(async (req, res) => {
  const { questions, topicId, chapterId } = req.body;

  if (!Array.isArray(questions) || questions.length === 0) {
    res.status(400);
    throw new Error("Send a list of questions.");
  }

  if (questions.length > 200) {
    res.status(400);
    throw new Error("Import at most 200 questions at a time.");
  }

  if (topicId && chapterId) {
    res.status(400);
    throw new Error("Choose a topic or a chapter, not both.");
  }
  if (!topicId && !chapterId) {
    res.status(400);
    throw new Error("Choose a topic, or a chapter for the chapter pool.");
  }

  // Filing the whole batch under a topic or, for the chapter pool, a
  // chapter directly — same two paths as a single question's resolveFiling
  // above, just resolved once for the whole file instead of per row.
  let parentTopic = null;
  let parentChapter = null;
  if (topicId) {
    parentTopic = await Topic.findById(topicId);
    if (!parentTopic) {
      res.status(404);
      throw new Error("Topic not found.");
    }
  } else {
    parentChapter = await Chapter.findById(chapterId);
    if (!parentChapter) {
      res.status(404);
      throw new Error("Chapter not found.");
    }
  }

  // Invalid rows are reported with their index and the reason. The original
  // dropped them silently and returned only a count, which made a bad import
  // impossible to debug — and that matters far more once a model is producing
  // the rows.
  const valid = [];
  const rejected = [];

  questions.forEach((row, index) => {
    const type = row.type || "mcq";

    if (!BY_TYPE[type]) {
      rejected.push({ index, reason: `Unknown type "${type}".` });
      return;
    }
    // A passage question can only ever live in the chapter pool — filing
    // the whole batch under a topic and a passage row in it are
    // incompatible, same rule as a single question's resolveFiling above.
    if (type === "passage" && parentTopic) {
      rejected.push({ index, reason: "Passage questions can only be filed under a chapter, not a topic." });
      return;
    }
    if (!row.question) {
      rejected.push({ index, reason: "Missing question text." });
      return;
    }

    const problem = validateShape(type, row);
    if (problem) {
      rejected.push({ index, reason: problem });
      return;
    }
    // No generic "add to archive" — same rule as create/updateQuestion.
    const rowSources = pickSources(row);
    if (row.isPublic && !hasSource(rowSources)) {
      rejected.push({ index, reason: "isPublic is true but authority is missing — pick a board/exam/book to add this to the archive." });
      return;
    }

    valid.push({
      ...pick(row, COMMON),
      ...rowSources,
      ...pick(row, BY_TYPE[type]),
      ...(type === "passage" && { marks: sumPassageMarks(row.subQuestions) }),
      type,
      topic: parentTopic ? parentTopic._id : null,
      chapter: parentTopic ? parentTopic.chapter : parentChapter._id,
      subject: parentTopic ? parentTopic.subject : parentChapter.subject,
      source: row.source === "ai" ? "ai" : "import",
    });
  });

  if (valid.length === 0) {
    res.status(400);
    return res.json({
      message: "No valid questions to import.",
      created: 0,
      rejected,
    });
  }

  const created = await Question.insertMany(valid, { ordered: false });

  res.status(201).json({
    message: `Imported ${created.length} of ${questions.length}.`,
    created: created.length,
    rejected,
    questions: created,
  });
});

// ---------- spreadsheet bulk import ----------
//
// A second front door onto the exact same import, for a teacher working from
// Excel/Sheets instead of pasting JSON: same COMMON/BY_TYPE/validateShape
// rules above, just fed from parsed spreadsheet rows instead of a request
// body. bulkCreateQuestions itself is untouched — this reuses its helpers
// rather than replacing anything, so nothing here can change what that
// endpoint (and the smoke test pinned to its response shape) already does.

const OPTION_LETTERS = ["A", "B", "C", "D", "E", "F"];
const STATEMENT_SLOTS = [1, 2, 3, 4, 5, 6];
const RUBRIC_SLOTS = [1, 2, 3];
const SUBQ_SLOTS = [1, 2, 3, 4, 5, 6];
const SUBQ_OPTION_LETTERS = ["A", "B", "C", "D"];
// Coding: up to 10 tests per row (the editor allows 50; more than 10 is
// easier there), and one starter-code column per supported language.
const TEST_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const CODE_LANGUAGES = Object.keys(require("../../utils/codeRunner").LANGUAGES);

// One column set per type rather than one wide sheet with every type's
// columns crammed side by side — the topic picker on the import screen
// already established that "pick it once outside the file" beats "repeat it
// on every row", and the same trick works for type: no Type column at all,
// because the whole file is one type, chosen where the topic is.
const COMMON_HEADERS = ["Question", "Marks", "NegativeMarks", "Difficulty", "SkillType", "SolutionText", "Tags"];
// A passage's own Marks is never a column — it's always the sum of its
// SubQ{n}Marks below (see questionModel.js's pre-validate hook, reproduced
// for bulk import by sumPassageMarks above) — and NegativeMarks is per
// sub-question too, so neither common column applies to it.
const PASSAGE_COMMON_HEADERS = ["Question", "Difficulty", "SkillType", "SolutionText", "Tags"];
// Public-archive filing, same for every type — appended last so they don't
// crowd the type-specific columns a teacher fills in for every single row.
// All four are optional; a row with none of them is a normal batch-only
// question, same as before these columns existed.
const ARCHIVE_HEADERS = ["Authority", "Year", "PaperLabel", "IsPublic"];
const TYPE_HEADERS = {
  mcq: [...COMMON_HEADERS, ...OPTION_LETTERS.map((l) => `Option${l}`), "CorrectOption", ...ARCHIVE_HEADERS],
  mtf: [...COMMON_HEADERS, ...STATEMENT_SLOTS.flatMap((n) => [`Statement${n}`, `IsTrue${n}`]), ...ARCHIVE_HEADERS],
  written: [...COMMON_HEADERS, "ModelAnswer", "WordLimit", ...RUBRIC_SLOTS.flatMap((n) => [`RubricCriterion${n}`, `RubricMarks${n}`]), ...ARCHIVE_HEADERS],
  passage: [
    ...PASSAGE_COMMON_HEADERS,
    ...SUBQ_SLOTS.flatMap((n) => [
      `SubQ${n}`,
      `SubQ${n}Type`,
      `SubQ${n}Label`,
      ...SUBQ_OPTION_LETTERS.map((l) => `SubQ${n}Option${l}`),
      `SubQ${n}CorrectOption`,
      `SubQ${n}Marks`,
      `SubQ${n}NegativeMarks`,
      `SubQ${n}ModelAnswer`,
    ]),
    ...ARCHIVE_HEADERS,
  ],
  coding: [
    ...COMMON_HEADERS,
    "Languages",
    "TimeLimitMs",
    ...CODE_LANGUAGES.map((l) => `Starter_${l}`),
    ...TEST_SLOTS.flatMap((n) => [`Test${n}Input`, `Test${n}Output`, `Test${n}Hidden`]),
    ...ARCHIVE_HEADERS,
  ],
};

const TYPE_EXAMPLE_ROW = {
  mcq: {
    Question: "What is the SI unit of force?", Marks: 1, NegativeMarks: 0, Difficulty: "easy", SkillType: "recall",
    SolutionText: "Newton's second law defines force as mass times acceleration; its SI unit is the newton (N).",
    Tags: "board-exam",
    OptionA: "Newton", OptionB: "Joule", OptionC: "Watt", OptionD: "Pascal", CorrectOption: "A",
  },
  mtf: {
    Question: "Mark each statement about photosynthesis true or false.", Marks: 2, Tags: "revision", SkillType: "comprehension",
    Statement1: "Photosynthesis occurs in the mitochondria.", IsTrue1: "FALSE",
    Statement2: "Chlorophyll absorbs light energy.", IsTrue2: "TRUE",
    Statement3: "Oxygen is released as a byproduct.", IsTrue3: "TRUE",
    Statement4: "It only occurs at night.", IsTrue4: "FALSE",
  },
  written: {
    Question: "Explain Newton's third law of motion with an example.", Marks: 5, Tags: "reserved, exam-only", SkillType: "problemSolving",
    ModelAnswer: "For every action there is an equal and opposite reaction. Example: ...", WordLimit: 150,
    RubricCriterion1: "States the law correctly", RubricMarks1: 2,
    RubricCriterion2: "Gives a valid, relevant example", RubricMarks2: 2,
    RubricCriterion3: "Clarity of explanation", RubricMarks3: 1,
  },
  passage: {
    Question: "Read the passage below, then answer the questions that follow.\n\n\"...\"",
    Difficulty: "medium", SkillType: "comprehension", Tags: "reading-comprehension",
    SubQ1: "According to the passage, what is the main idea?",
    SubQ1OptionA: "Option A", SubQ1OptionB: "Option B", SubQ1OptionC: "Option C", SubQ1OptionD: "Option D",
    SubQ1CorrectOption: "A", SubQ1Marks: 1, SubQ1NegativeMarks: 0,
    SubQ2: "Which word best describes the tone?",
    SubQ2OptionA: "Option A", SubQ2OptionB: "Option B", SubQ2OptionC: "Option C", SubQ2OptionD: "Option D",
    SubQ2CorrectOption: "B", SubQ2Marks: 1, SubQ2NegativeMarks: 0,
    SubQ3: "Explain the author's argument in your own words.", SubQ3Type: "written", SubQ3Label: "গ",
    SubQ3Marks: 3, SubQ3ModelAnswer: "The author argues that ...",
  },
  coding: {
    Question: "Read two integers a and b on one line and print their sum.", Marks: 5, Difficulty: "easy",
    SkillType: "application", Tags: "basics, io",
    Languages: "python, cpp", TimeLimitMs: 2000,
    Starter_python: "a, b = map(int, input().split())\n# print the sum\n",
    Starter_cpp: "#include <iostream>\nint main() {\n  long long a, b;\n  std::cin >> a >> b;\n  // print the sum\n}\n",
    Test1Input: "2 3", Test1Output: "5", Test1Hidden: "FALSE",
    Test2Input: "-4 10", Test2Output: "6", Test2Hidden: "FALSE",
    Test3Input: "1000000000 1000000000", Test3Output: "2000000000", Test3Hidden: "TRUE",
  },
};

const TYPE_LABEL = { mcq: "Multiple choice", mtf: "True / false", written: "Written", passage: "Passage", coding: "Coding" };

const COMMON_NOTES = [
  ["Question", "Required."],
  ["Marks", "Number. Defaults to 1 if left blank."],
  ["NegativeMarks", "Number, stored as a positive value. Defaults to 0."],
  ["Difficulty", "easy, medium, or hard. Defaults to medium."],
  ["SkillType", `Optional. One of: ${SKILL_TYPES.map((s) => s.value).join(", ")}. Leave blank if unsure.`],
  ["SolutionText", "Optional explanation shown after a student answers."],
  ["Tags", "Optional, comma separated — e.g. \"reserved, exam-only\". For grouping and filtering later, not part of grading."],
];
// A passage row has no Marks/NegativeMarks columns at all — see
// PASSAGE_COMMON_HEADERS above — so its notes drop those two rows.
const PASSAGE_COMMON_NOTES = COMMON_NOTES.filter(([col]) => col !== "Marks" && col !== "NegativeMarks");
// Notes for ARCHIVE_HEADERS — kept separate from COMMON_NOTES so they can be
// placed last in the instructions sheet, after the type-specific columns,
// matching where these columns actually sit in the sheet.
const buildArchiveNotes = (authorityNames) => [
  ["Authority", authorityNames.length > 0
    ? `Optional. The exact name of an existing board/exam/book: ${authorityNames.join(", ")}. Several boards: separate with ";" (e.g. "Dhaka Board; Rajshahi Board"). Leave blank if this question isn't going in the public archive.`
    : "Optional. The exact name of an existing board/exam/book. None exist yet — add one in Settings first if you want to use this column."],
  ["Year", "Optional. Every year it appeared, comma-separated (e.g. \"2015, 2017, 2019\"). With several boards, give each board's years in the same order separated by \";\" (e.g. \"2015, 2017; 2018, 2020\")."],
  ["PaperLabel", "Optional free text, e.g. \"Physics 1st Paper\" or \"Ch. 3 Exercise\". One label for every board, or one per board separated by \";\"."],
  ["IsPublic", "TRUE to publish this question to the public archive under Authority above, FALSE or blank to keep it batch-only. There is no archive without a specific Authority — TRUE with Authority blank is rejected."],
];
const TYPE_NOTES = {
  mcq: [
    ["OptionA … OptionF", "Fill as many as you need, left to right, at least two. Leave the rest blank."],
    ["CorrectOption", "The letter (A–F) of the correct option — must match one you filled in."],
  ],
  mtf: [
    ["Statement1 … Statement6 / IsTrue1 … IsTrue6", "Fill pairs left to right, at least two. IsTrue must be TRUE or FALSE."],
    ["Marks", "Each statement is worth Marks ÷ number of statements: a right answer adds it, a wrong one takes it away."],
  ],
  written: [
    ["ModelAnswer", "Optional reference answer."],
    ["WordLimit", "Optional number."],
    ["RubricCriterion1-3 / RubricMarks1-3", "Optional grading rubric, up to 3 criteria. Needed for AI grading of this question."],
  ],
  passage: [
    ["Question", "The passage itself — the shared prompt every SubQ below is asked about."],
    ["SubQ1 … SubQ6", "Fill at least one. Each is graded on its own."],
    ["SubQ{n}Type", "mcq or written. Defaults to mcq."],
    ["SubQ{n}Label", "Optional label for a written question, e.g. ক or (a)."],
    ["SubQ{n}OptionA … SubQ{n}OptionD", "mcq only: at least two filled in."],
    ["SubQ{n}CorrectOption", "mcq only: the letter (A–D) of the correct option."],
    ["SubQ{n}Marks / SubQ{n}NegativeMarks", "Per sub-question — there's no single Marks column; the question's total is the sum of these. A written one needs Marks above 0."],
    ["SubQ{n}ModelAnswer", "written only, optional: reference answer used for grading."],
  ],
  coding: [
    ["Languages", `Required. The languages a student may answer in, comma separated. Any of: ${CODE_LANGUAGES.join(", ")}.`],
    ["TimeLimitMs", "Optional. Time allowed per test, in milliseconds, 500 to 10000. Defaults to 2000."],
    ["Starter_<language>", "Optional code the student starts from in that language. Leave blank for an empty editor."],
    ["Test1Input … Test10Input", "What the program reads on standard input. Can be blank."],
    ["Test1Output … Test10Output", "Required for every test you use: the exact expected output. Fill tests left to right, at least one."],
    ["Test1Hidden … Test10Hidden", "TRUE: hidden from the student, counted only at submit. FALSE or blank: shown, and the student can try it with Run."],
    ["Marks", "Shared equally between the tests. More than 10 tests: add them in the question editor."],
    ["Number-looking outputs", "Excel can change 1.50 to 1.5 or drop leading zeros. Type an apostrophe first ('1.50), or set the Output columns to Text."],
  ],
};

const buildTemplateInstructions = (type, authorityNames) => [
  ["Column", "Notes"],
  ...(type === "passage" ? PASSAGE_COMMON_NOTES : COMMON_NOTES),
  ...TYPE_NOTES[type],
  ...buildArchiveNotes(authorityNames),
  [],
  ["Topic is not a column here", type === "passage"
    ? "You choose one chapter for the whole file on the import screen — every question in it is filed there, with no topic (the chapter pool). Passage questions can only ever be chapter-pool."
    : "You choose one subject/topic — or a chapter, for the chapter pool — for the whole file on the import screen; every question in it is filed there."],
  ["Every row in this file is a " + TYPE_LABEL[type] + " question", "Uploading a different type is a separate file, with its own template."],
  ["Row limit", "At most 200 questions per import."],
];

const buildTemplateWorkbook = (type, authorityNames) => {
  const headers = TYPE_HEADERS[type];
  const wb = new ExcelJS.Workbook();

  // Excel worksheet names can't contain "/" (or *?:\[]), which "True / false"
  // does — sanitize rather than rename the user-facing label.
  const sheetName = TYPE_LABEL[type].replace(/[*?:\\/[\]]/g, "-");
  const sheet = wb.addWorksheet(sheetName);
  sheet.addRow(headers);
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8ECF3" } };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.addRow(headers.map((h) => TYPE_EXAMPLE_ROW[type][h] ?? ""));
  sheet.columns.forEach((col, i) => {
    const isWide = ["Question", "SolutionText", "ModelAnswer"].includes(headers[i]) || /^(SubQ\d+(ModelAnswer)?|Starter_.+)$/.test(headers[i]);
    col.width = isWide ? 42 : 16;
  });
  if (type === "coding") {
    TEST_SLOTS.forEach((n) => {
      const letter = sheet.getColumn(headers.indexOf(`Test${n}Hidden`) + 1).letter;
      sheet.dataValidations.add(`${letter}2:${letter}201`, { type: "list", allowBlank: true, formulae: ['"TRUE,FALSE"'] });
    });
    // Starter code and test data keep their line breaks.
    headers.forEach((h, i) => {
      if (/^(Starter_|Test\d+(Input|Output)$)/.test(h)) sheet.getColumn(i + 1).alignment = { wrapText: true, vertical: "top" };
    });
  }
  if (type === "mtf") {
    STATEMENT_SLOTS.forEach((n) => {
      const col = headers.indexOf(`IsTrue${n}`) + 1;
      const letter = sheet.getColumn(col).letter;
      sheet.dataValidations.add(`${letter}2:${letter}201`, { type: "list", allowBlank: true, formulae: ['"TRUE,FALSE"'] });
    });
  }
  // IsPublic is a TRUE/FALSE column on every type, same dropdown treatment as
  // mtf's IsTrue above.
  {
    const col = headers.indexOf("IsPublic") + 1;
    const letter = sheet.getColumn(col).letter;
    sheet.dataValidations.add(`${letter}2:${letter}201`, { type: "list", allowBlank: true, formulae: ['"TRUE,FALSE"'] });
  }
  // A comma-separated Excel list formula can't hold a name with a comma in
  // it — dropping those from the dropdown (not from the notes text) rather
  // than let one odd name silently break the whole list.
  const dropdownAuthorityNames = authorityNames.filter((n) => !n.includes(","));
  if (dropdownAuthorityNames.length > 0) {
    const col = headers.indexOf("Authority") + 1;
    const letter = sheet.getColumn(col).letter;
    // Suggestions only (showErrorMessage off) — a multi-board cell like
    // "Dhaka Board; Rajshahi Board" isn't one list entry but is valid.
    sheet.dataValidations.add(`${letter}2:${letter}201`, { type: "list", allowBlank: true, showErrorMessage: false, formulae: [`"${dropdownAuthorityNames.join(",")}"`] });
  }

  const info = wb.addWorksheet("Instructions");
  info.addRows(buildTemplateInstructions(type, authorityNames));
  info.getRow(1).font = { bold: true };
  info.getColumn(1).width = 40;
  info.getColumn(2).width = 76;
  info.getColumn(2).alignment = { wrapText: true };

  return wb;
};

const csvEscape = (value) => {
  const s = value === undefined || value === null ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const buildTemplateCsv = (type) => {
  const headers = TYPE_HEADERS[type];
  const rows = [headers, headers.map((h) => TYPE_EXAMPLE_ROW[type][h] ?? "")];
  return rows.map((row) => row.map(csvEscape).join(",")).join("\r\n");
};

//@desc   Download a blank template for the spreadsheet bulk importer
//@route  GET /api/questions/bulk/template?type=mcq|mtf|written&format=xlsx|csv
//@access Private
const getBulkTemplate = asyncHandler(async (req, res) => {
  const type = req.query.type;
  if (!TYPE_HEADERS[type]) {
    res.status(400);
    throw new Error("Choose a question type first: mcq, mtf, written, passage or coding.");
  }

  if (req.query.format === "csv") {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${type}-question-template.csv"`);
    res.send(buildTemplateCsv(type));
    return;
  }

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader("Content-Disposition", `attachment; filename="${type}-question-template.xlsx"`);
  const authorities = await ExamAuthority.find().select("name").sort("name");
  const wb = buildTemplateWorkbook(type, authorities.map((a) => a.name));
  await wb.xlsx.write(res);
  res.end();
});

// A small RFC4180-ish parser rather than a dependency: quoted fields,
// embedded commas/newlines, and "" as an escaped quote are the only things
// a spreadsheet's own CSV export actually produces, and that's all this
// needs to round-trip correctly.
const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ",") { pushField(); continue; }
    if (c === "\r") continue;
    if (c === "\n") { pushRow(); continue; }
    field += c;
  }
  // Last field/row, unless the file ended cleanly on a newline.
  if (field.length > 0 || row.length > 0) pushRow();

  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
};

// Both file formats land here as the same shape: an array of plain objects
// keyed by the template's headers, in whatever order the sheet actually had
// them (a teacher moving a column shouldn't break the import).
const parseSpreadsheet = async (file) => {
  const isCsv = /\.csv$/i.test(file.originalname || "") || file.mimetype.includes("csv");

  if (isCsv) {
    const text = file.buffer.toString("utf8").replace(/^﻿/, "");
    const [header, ...dataRows] = parseCsv(text);
    if (!header) return [];
    return dataRows.map((cells) =>
      header.reduce((acc, key, i) => {
        if (key) acc[key.trim()] = cells[i] !== undefined ? cells[i] : "";
        return acc;
      }, {})
    );
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(file.buffer);
  const sheet = wb.worksheets[0];
  if (!sheet) return [];

  const header = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
    header[colNumber] = String(cell.value ?? "").trim();
  });

  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj = {};
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const key = header[colNumber];
      if (!key) return;
      // A formula cell's .value is an object ({formula, result}); a date is
      // a real Date. Neither should reach the same string-parsing code a
      // plain typed cell goes through below.
      const v = cell.value;
      obj[key] = v && typeof v === "object" && "result" in v ? v.result : v;
    });
    rows.push(obj);
  });
  return rows;
};

const cell = (v) => (v === undefined || v === null ? "" : String(v).trim());
const truthy = (v) => /^(true|yes|1|t)$/i.test(cell(v));
const numberOr = (v, fallback) => {
  const s = cell(v);
  if (!s) return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
};

// One spreadsheet row → the same nested shape bulkCreateQuestions already
// validates (options[], statements[], rubric[]) — this is the only new
// translation step; everything downstream of it (COMMON/BY_TYPE/
// validateShape) is the exact code path the JSON import already runs
// through. `type` is passed in from the import request, not read off the
// row — a per-type template has no Type column any more.
const rowToQuestion = (row, type) => {
  const base = {
    type,
    question: cell(row.Question),
    marks: numberOr(row.Marks, 1),
    negativeMarks: numberOr(row.NegativeMarks, 0),
    difficulty: (cell(row.Difficulty) || "medium").toLowerCase(),
    skillType: normalizeSkillType(row.SkillType),
    solutionText: cell(row.SolutionText) || undefined,
    tags: cell(row.Tags)
      ? cell(row.Tags).split(",").map((t) => t.trim()).filter(Boolean)
      : undefined,
    // Authority is a name here, not yet an id — resolved against real
    // ExamAuthority documents by the caller (importQuestionsFromFile), which
    // has the DB lookup this pure function doesn't.
    // Several boards separated by ";", each with a matching ";" group of
    // comma-separated years — see parseSourceCells.
    sourceCells: parseSourceCells(cell(row.Authority), cell(row.Year), cell(row.PaperLabel)),
    isPublic: truthy(row.IsPublic),
  };

  if (type === "mcq") {
    const options = OPTION_LETTERS
      .map((l) => ({ key: l, text: cell(row[`Option${l}`]) }))
      .filter((o) => o.text);
    return { ...base, options, correctOption: cell(row.CorrectOption).toUpperCase() };
  }

  if (type === "mtf") {
    const statements = STATEMENT_SLOTS
      .map((n) => ({ text: cell(row[`Statement${n}`]), isTrue: truthy(row[`IsTrue${n}`]) }))
      .filter((s) => s.text);
    return { ...base, statements };
  }

  if (type === "written") {
    const rubric = RUBRIC_SLOTS
      .map((n) => ({ criterion: cell(row[`RubricCriterion${n}`]), marks: numberOr(row[`RubricMarks${n}`], 0) }))
      .filter((r) => r.criterion);
    return { ...base, rubric, modelAnswer: cell(row.ModelAnswer) || undefined, wordLimit: numberOr(row.WordLimit, undefined) };
  }

  if (type === "passage") {
    const subQuestions = SUBQ_SLOTS
      .map((n) => cell(row[`SubQ${n}Type`]).toLowerCase() === "written"
        ? {
          type: "written",
          question: cell(row[`SubQ${n}`]),
          label: cell(row[`SubQ${n}Label`]) || undefined,
          marks: numberOr(row[`SubQ${n}Marks`], 1),
          modelAnswer: cell(row[`SubQ${n}ModelAnswer`]) || undefined,
        }
        : {
        type: "mcq",
        question: cell(row[`SubQ${n}`]),
        options: SUBQ_OPTION_LETTERS
          .map((l) => ({ key: l, text: cell(row[`SubQ${n}Option${l}`]) }))
          .filter((o) => o.text),
        correctOption: cell(row[`SubQ${n}CorrectOption`]).toUpperCase(),
        marks: numberOr(row[`SubQ${n}Marks`], 1),
        negativeMarks: numberOr(row[`SubQ${n}NegativeMarks`], 0),
      })
      .filter((sq) => sq.question);
    // base.marks came from COMMON's Marks column, which a passage row
    // doesn't have (no such column in its template) — overwritten with the
    // real total right away, same as sumPassageMarks does again just before
    // insertMany below (insertMany itself won't run the model's own hook).
    return { ...base, marks: sumPassageMarks(subQuestions), subQuestions };
  }

  if (type === "coding") {
    // Excel keeps line breaks as \n; a CSV may carry \r\n.
    const text = (v) => (v === undefined || v === null ? "" : String(v).replace(/\r\n?/g, "\n"));
    const languages = [...new Set(cell(row.Languages).toLowerCase().split(/[,;\s]+/).filter(Boolean)
      .map((l) => ({ "c++": "cpp", "c#": "csharp", js: "javascript", ts: "typescript", py: "python", golang: "go" }[l] || l)))];
    const starterCode = CODE_LANGUAGES
      .map((l) => ({ language: l, code: text(row[`Starter_${l}`]) }))
      .filter((s) => s.code.trim() && languages.includes(s.language));
    const tests = TEST_SLOTS
      .map((n) => ({ input: text(row[`Test${n}Input`]), output: text(row[`Test${n}Output`]), hidden: truthy(row[`Test${n}Hidden`]) }))
      .filter((t) => t.input.trim() || t.output.trim());
    const ms = numberOr(row.TimeLimitMs, 2000);
    return { ...base, languages, starterCode, tests, timeLimitMs: Math.min(10000, Math.max(500, ms)) };
  }

  return base; // unknown type — validateShape below rejects it with a clear reason
};

//@desc   Bulk-create questions from an uploaded .xlsx/.csv file
//@route  POST /api/questions/bulk/import
//@access Private
const importQuestionsFromFile = asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400);
    throw new Error("Attach a .csv or .xlsx file in a field named 'file'.");
  }

  const { topicId, chapterId, type } = req.body;
  if (!TYPE_HEADERS[type]) {
    res.status(400);
    throw new Error("Choose a question type first: mcq, mtf, written, passage or coding.");
  }
  if (topicId && chapterId) {
    res.status(400);
    throw new Error("Choose a topic or a chapter, not both.");
  }
  // A passage row can only ever be chapter-pool — same rule as a single
  // question's resolveFiling and the JSON bulk import above.
  if (type === "passage" && topicId) {
    res.status(400);
    throw new Error("Passage questions can only be filed under a chapter, not a topic.");
  }
  if (!topicId && !chapterId) {
    res.status(400);
    throw new Error("Choose a topic, or a chapter for the chapter pool.");
  }

  let parentTopic = null;
  let parentChapter = null;
  if (topicId) {
    parentTopic = await Topic.findById(topicId);
    if (!parentTopic) {
      res.status(404);
      throw new Error("Topic not found.");
    }
  } else {
    parentChapter = await Chapter.findById(chapterId);
    if (!parentChapter) {
      res.status(404);
      throw new Error("Chapter not found.");
    }
  }

  const rawRows = await parseSpreadsheet(req.file);
  // A blank row — no Question — is normal spreadsheet clutter (a trailing
  // row, a gap left for readability) and not something a teacher typed
  // wrong, so it is dropped silently rather than reported.
  const dataRows = rawRows
    .map((row, i) => ({ row, sheetRow: i + 2 }))
    .filter(({ row }) => cell(row.Question));

  if (dataRows.length === 0) {
    res.status(400);
    throw new Error("No question rows found in that file.");
  }
  if (dataRows.length > 200) {
    res.status(400);
    throw new Error("Import at most 200 questions at a time.");
  }

  // Fetched once for the whole file rather than per row — a name typed in
  // the Authority column is resolved against this, case-insensitively, since
  // asking a teacher to type an ObjectId isn't reasonable.
  const authorities = await ExamAuthority.find().select("name");
  const authorityByName = new Map(authorities.map((a) => [a.name.trim().toLowerCase(), a._id]));

  const valid = [];
  const rejected = [];

  dataRows.forEach(({ row, sheetRow }, index) => {
    const mapped = rowToQuestion(row, type);

    if (!mapped.question) {
      rejected.push({ index, row: sheetRow, reason: "Missing question text." });
      return;
    }
    const problem = validateShape(mapped.type, mapped);
    if (problem) {
      rejected.push({ index, row: sheetRow, reason: problem });
      return;
    }

    if (mapped.sourceCells.error) {
      rejected.push({ index, row: sheetRow, reason: mapped.sourceCells.error });
      return;
    }
    const sourceRows = [];
    for (const group of mapped.sourceCells.groups) {
      const authorityId = authorityByName.get(group.name.toLowerCase());
      if (!authorityId) {
        rejected.push({ index, row: sheetRow, reason: `Authority "${group.name}" not found. Check spelling, or add it in Settings first.` });
        return;
      }
      sourceRows.push({ authority: authorityId, years: group.years, paperLabel: group.paperLabel });
    }
    mapped.sources = normalizeSources(sourceRows);
    // No generic "add to archive" — same rule as create/updateQuestion.
    if (mapped.isPublic && !hasSource(mapped)) {
      rejected.push({ index, row: sheetRow, reason: "IsPublic is TRUE but Authority is blank — pick a board/exam/book to add this to the archive." });
      return;
    }

    valid.push({
      ...pick(mapped, COMMON),
      ...(mapped.sources.length > 0 && { sources: mapped.sources }),
      ...pick(mapped, BY_TYPE[mapped.type]),
      ...(mapped.type === "passage" && { marks: sumPassageMarks(mapped.subQuestions) }),
      tags: normalizeTags(mapped.tags),
      type: mapped.type,
      topic: parentTopic ? parentTopic._id : null,
      chapter: parentTopic ? parentTopic.chapter : parentChapter._id,
      subject: parentTopic ? parentTopic.subject : parentChapter.subject,
      source: "import",
    });
  });

  if (valid.length === 0) {
    res.status(400);
    return res.json({ message: "No valid questions to import.", created: 0, rejected });
  }

  const created = await Question.insertMany(valid, { ordered: false });

  res.status(201).json({
    message: `Imported ${created.length} of ${dataRows.length}.`,
    created: created.length,
    rejected,
    questions: created,
  });
});

//@desc   Counts per topic for the bank sidebar and the content tree
//@route  GET /api/questions/stats
//@access Private
const getQuestionStats = asyncHandler(async (req, res) => {
  // Every status is counted, not just published. The delete checks on topics
  // and chapters count all questions, so a stat that excluded drafts would let
  // the interface show "no questions" on a node the server then refuses to
  // delete. `pending` is returned separately for anything that wants it.
  //
  // Grouping used to key the second stage purely on topic — for a
  // chapter-pool question (topic: null) that collapsed every pool question
  // on the whole platform into one `_id: null` bucket, with no way to tell
  // which chapter any of them actually sat under. Content.jsx (the
  // subject/chapter/topic tree) had no way to show "this chapter has 6
  // questions filed directly under it" for exactly that reason — the count
  // existed but wasn't attributable to a chapter. Keying on {topic, chapter}
  // instead fixes that: a topic's chapter is fixed for every one of its
  // questions, so real topic rows group identically to before, and pool
  // rows now come back one-per-chapter instead of one merged blob.
  const match = {};
  if (req.query.subject) {
    match.subject = new mongoose.Types.ObjectId(req.query.subject);
  }

  const stats = await Question.aggregate([
    { $match: match },
    {
      $group: {
        _id: { topic: "$topic", chapter: "$chapter", type: "$type", status: "$status" },
        count: { $sum: 1 },
      },
    },
    {
      $group: {
        _id: { topic: "$_id.topic", chapter: "$_id.chapter" },
        total: { $sum: "$count" },
        pending: {
          $sum: { $cond: [{ $eq: ["$_id.status", "pending_review"] }, "$count", 0] },
        },
        byType: { $push: { type: "$_id.type", count: "$count" } },
      },
    },
    {
      // Flatten back to the old shape for topic rows (`_id` is the topic id,
      // same as before) and add a distinguishable chapter-pool row shape
      // (`_id: null`, `chapter` set, `chapterPool: true`) instead of a
      // second incompatible response format.
      $project: {
        _id: { $ifNull: ["$_id.topic", null] },
        chapter: "$_id.chapter",
        chapterPool: { $eq: ["$_id.topic", null] },
        total: 1,
        pending: 1,
        byType: 1,
      },
    },
  ]);

  res.status(200).json(stats);
});

//@desc   Every tag currently in use, for the filter dropdown
//@route  GET /api/questions/tags
//@access Private
const getQuestionTags = asyncHandler(async (req, res) => {
  const tags = await Question.distinct("tags");
  res.status(200).json(tags.filter(Boolean).sort());
});

module.exports = {
  rescoreQuestionAttempts,
  applyModelAnswers,
  loadWithMedia,
  getQuestions,
  getQuestion,
  createQuestion,
  updateQuestion,
  deleteQuestion,
  bulkCreateQuestions,
  bulkMoveQuestions,
  bulkArchiveQuestions,
  getBulkTemplate,
  importQuestionsFromFile,
  getQuestionStats,
  getQuestionTags,
  validateShape,
};