const asyncHandler = require("express-async-handler");
const { questionText, fullQuestionText } = require("../../utils/questionText");
const { subjectIds, subjectScope, inBatchSubjects } = require("../../utils/batchSubjects");
const { outlineFor, chapterOrderOf } = require("../../utils/courseOutline");
const cache = require("../../utils/cache");
const tags = require("../../utils/cacheTags");
const mongoose = require("mongoose");
const { Question } = require("../../models/questionModel");
const { loadQuestionsInOrder } = require("../../utils/loadQuestionsInOrder");
const Topic = require("../../models/topicModel");
const Chapter = require("../../models/chapterModel");
const Subject = require("../../models/subjectModel");
const ExamAuthority = require("../../models/examAuthorityModel");
const PracticeAttempt = require("../../models/practiceAttemptModel").Archive;
const PracticeFavorite = require("../../models/practiceFavoriteModel").Archive;
const PredictedPaper = require("../../models/predictedPaperModel");
const { forTaking, shapeField } = require("../../utils/shapeQuestion");
const { rankWeakTopics } = require("../../utils/weakTopics");
const { SKILL_TYPE_VALUES } = require("../../utils/skillTypes");
const { sourceMatch } = require("../../utils/archiveSources");
const aiService = require("../../ai/service");
const { explainMistake, generateSimilarQuestions, gradeWrittenPractice } = require("../../ai/prompts");
const { explanation: explanationSchema, similarQuestions: similarQuestionsSchema, gradedAnswer: gradedAnswerSchema } = require("../../ai/schemas");
const { toAbsoluteUrl, assertOwnMediaUrl } = require("../../utils/mediaUrl");
const { sanitizeReasoning } = require("../../ai/leakGuard");
const { reconcileRubricMarks } = require("../../utils/rubricMarks");
const { partOf } = require("../../utils/passageParts");

// Same cap as batch practice's written answers (practiceController.js).
const { MAX_ANSWER_IMAGES } = require("../../utils/practiceAnswerImages");
const { handwritingMode, practiceHandwriting, withNote } = require("../../utils/handwriting");
const { parseHintRequest, hintTargetFor, generateHintWithUsage } = require("../../utils/hints");
const aiReuse = require("../../utils/aiReuse.pro");
const similarSource = require("../../utils/similarSource");
const AiConfig = require("../../models/aiConfigModel");
const { getUsageSnapshot } = require("../../ai/usage");

// The public archive's own practice loop — same shapes and rendering as
// batch practice (controllers/app/practiceController.js), reused wherever
// possible, but scoped by Question.isPublic instead of Question.batches
// membership.
//
// Mounted at /:batches/:batchId/archive (see routes/app/archiveRoutes.js) —
// a batch "presents" the archive by picking one or more ExamAuthority ids
// (Batch.archiveAuthorities), so every query here is additionally
// restricted to that batch's own list. The content itself stays the one
// shared, global pool (Question.isPublic) — nothing here is duplicated or
// owned per batch, only which slice of it a given batch's students can
// reach.
//
// Deliberately still its own tracking bucket, not the batch's: every write
// below uses batch: null (PracticeAttempt/weak-topics), the same "archive
// is its own scope, not 'unset'" convention PracticeAttempt/
// PracticeFavorite/StudyPlan's schemas were relaxed for — reached through
// a batch's door, but not folded into that batch's own progress data. AI
// calls pass batch: null too — ai/service.js's quota layer already treats
// that as its own bucket, not a bypass.

const VALID_TYPES = ["mcq", "mtf", "written", "passage"];

// A predicted paper an admin shared as a "Predicted set"
// (predictedPaperController.js's setShared) is visible to every batch whose
// archive includes its board.
const sharedSetScope = (req) => ({
  sharedAsSet: true,
  authority: { $in: (req.batch.archiveAuthorities || []).map((id) => new mongoose.Types.ObjectId(String(id))) },
});

// Every question-fetching handler below needs this same restriction, and
// getting it wrong would leak archive content a batch was never given
// access to — pulled out once rather than repeated per handler.
//
// Returns real ObjectId instances, not strings: Question.find() casts a
// string automatically, but Question.aggregate() (getTopics) does not — a
// plain-string $in silently matched zero documents there even though the
// authority was genuinely assigned to the batch.
//
// A question can carry several boards, each with its own years (see
// utils/archiveSources.js). With a year, the match requires that year on
// the same board entry, not on any board.
//
// It also keeps to the batch's ticked subjects (utils/batchSubjects.js); a
// requested subject outside them matches nothing.
const subjectFor = (req, requestedSubject) => {
  if (!requestedSubject) return subjectScope(req.batch).subject;
  if (!mongoose.isValidObjectId(requestedSubject) || !inBatchSubjects(req.batch, requestedSubject)) return { $in: [] };
  return new mongoose.Types.ObjectId(String(requestedSubject));
};

const authorityFilter = (req, requestedAuthority, year, requestedSubject) => {
  const allowed = (req.batch.archiveAuthorities || []).map((id) => String(id));
  const subject = subjectFor(req, requestedSubject);
  if (requestedAuthority && allowed.includes(String(requestedAuthority))) {
    return { ...sourceMatch(requestedAuthority, year), subject };
  }
  return { ...sourceMatch(allowed.length ? allowed : [new mongoose.Types.ObjectId()], year), subject };
};

// The lookup every single-question archive endpoint (attempt, explain, hint,
// similar, favorite) goes through. A normal archive question must be public
// and from one of this batch's boards. A question on a shared predicted set
// is reachable too — its AI-written questions are deliberately not public
// (they aren't real past-paper questions and must not show up when browsing
// the archive), so access comes through the set instead.
const archiveQuestionFilter = async (req, id) => {
  if (!mongoose.isValidObjectId(id)) return { _id: null };
  const onSharedSet = await PredictedPaper.exists({ ...sharedSetScope(req), "questions.question": id });
  return onSharedSet
    ? { _id: id, status: "published" }
    : { _id: id, isPublic: true, status: "published", ...authorityFilter(req) };
};

//@desc   Filter options for this batch's archive — only boards, years and
//        subjects that lead to at least one public question. Each list is
//        worked out with the student's other current choices applied, so a
//        board with no questions never shows, and after picking a board
//        only that board's years do.
//@route  GET /api/app/batches/:batchId/archive/filters?authority=...&year=...&subject=...
//@access Private (student + batchAccess + this batch has archiveAuthorities)
const buildGetFilters = async (req) => {
  const allowed = (req.batch.archiveAuthorities || []).map((id) => String(id));
  const allowedIds = allowed.map((id) => new mongoose.Types.ObjectId(id));
  const authority = allowed.includes(String(req.query.authority)) ? String(req.query.authority) : null;
  const year = Number.isInteger(Number(req.query.year)) && Number(req.query.year) > 0 ? Number(req.query.year) : null;
  const subject = mongoose.isValidObjectId(req.query.subject) ? new mongoose.Types.ObjectId(req.query.subject) : null;

  const base = { isPublic: true, status: "published" };

  const [authorityRows, yearRows, subjectIds] = await Promise.all([
    // Boards: this batch's boards with a question, in the chosen year.
    Question.aggregate([
      { $match: { ...base, ...authorityFilter(req, null, year, subject) } },
      { $unwind: "$sources" },
      { $match: { "sources.authority": { $in: allowedIds }, ...(year && { "sources.years": year }) } },
      { $group: { _id: "$sources.authority" } },
    ]),
    // Years: recorded against the chosen board (or any of this batch's).
    Question.aggregate([
      { $match: { ...base, ...authorityFilter(req, authority, null, subject) } },
      { $unwind: "$sources" },
      { $match: { "sources.authority": authority ? new mongoose.Types.ObjectId(authority) : { $in: allowedIds } } },
      { $unwind: "$sources.years" },
      { $group: { _id: "$sources.years" } },
    ]),
    // Subjects: with a question on the chosen board and year.
    Question.distinct("subject", { isPublic: true, status: "published", ...authorityFilter(req, authority, year) }),
  ]);

  const [authorities, subjects] = await Promise.all([
    ExamAuthority.find({ _id: { $in: authorityRows.map((r) => r._id) } }).sort({ order: 1, name: 1 }),
    Subject.find({ _id: { $in: subjectIds } }).sort({ order: 1, title: 1 }),
  ]);

  return JSON.parse(JSON.stringify({
    authorities,
    subjects,
    years: yearRows.map((r) => r._id).filter((y) => y != null).sort((a, b) => b - a),
  }));
};

const getFilters = asyncHandler(async (req, res) => {
  // The same for every student with this batch's boards and this
  // filter: cached until a question, board or topic changes.
  const key = `archive:filters:${[...(req.batch.archiveAuthorities || []).map(String)].sort().join(",")}:${req.query.authority || ""}:${req.query.year || ""}:${req.query.subject || ""}`;
  res.status(200).json(await cache.wrap(key, [tags.ARCHIVE, tags.TAXONOMY, tags.BATCHES], () => buildGetFilters(req), { group: "archive" }));
});

//@desc   Topics (and chapter-pool chapters) with at least one public
//        question matching the current filter set, within this batch's
//        assigned boards/exams/books
//@route  GET /api/app/batches/:batchId/archive/topics?authority=...&year=...&subject=...&types=mcq,mtf
//@access Private (student + batchAccess + this batch has archiveAuthorities)
const buildGetTopics = async (req) => {
  const { authority, year, subject } = req.query;
  const types = (req.query.types ? req.query.types.split(",") : VALID_TYPES).filter((t) => VALID_TYPES.includes(t));

  // The subject comes back from authorityFilter as an ObjectId (aggregate()
  // doesn't auto-cast the way find() does).
  const baseMatch = { isPublic: true, status: "published", ...authorityFilter(req, authority, year, subject) };
  const [allCounts, filteredCounts] = await Promise.all([
    Question.aggregate([{ $match: baseMatch }, { $group: { _id: "$topic", count: { $sum: 1 } } }]),
    Question.aggregate([
      { $match: { ...baseMatch, type: { $in: types.length ? types : VALID_TYPES } } },
      { $group: { _id: "$topic", count: { $sum: 1 } } },
    ]),
  ]);

  const topics = await Topic.find({ _id: { $in: allCounts.map((c) => c._id).filter(Boolean) } })
    .populate("chapter", "title")
    .select("title chapter order");

  const countByTopic = new Map(filteredCounts.map((c) => [String(c._id), c.count]));

  const [allChapterCounts, filteredChapterCounts] = await Promise.all([
    Question.aggregate([{ $match: { ...baseMatch, topic: null } }, { $group: { _id: "$chapter", count: { $sum: 1 } } }]),
    Question.aggregate([
      { $match: { ...baseMatch, topic: null, type: { $in: types.length ? types : VALID_TYPES } } },
      { $group: { _id: "$chapter", count: { $sum: 1 } } },
    ]),
  ]);
  const chapters = await Chapter.find({ _id: { $in: allChapterCounts.map((c) => c._id) } }).select("title");
  const countByChapter = new Map(filteredChapterCounts.map((c) => [String(c._id), c.count]));

  // Same order and groups as the rest of this batch (utils/courseOutline.js).
  const ol = await outlineFor(req.batch);
  await ol.prime({ topics: topics.map((t) => t._id), chapters: chapters.map((c) => c._id) });

  return JSON.parse(JSON.stringify({
    topics: topics
      .sort(ol.byTopic((t) => t._id))
      .map((t) => ({ _id: t._id, title: t.title, chapter: t.chapter, group: ol.group(t.chapter?._id), questionCount: countByTopic.get(String(t._id)) || 0 })),
    chapterPools: chapters
      .sort(ol.byChapter((c) => c._id))
      .map((c) => ({ _id: c._id, title: c.title, group: ol.group(c._id), questionCount: countByChapter.get(String(c._id)) || 0 })),
    groups: ol.groups,
    chapterOrder: chapterOrderOf(ol, topics, chapters),
  }));
};

const getTopics = asyncHandler(async (req, res) => {
  // The same for every student of this batch with this filter (the order
  // and groups are the batch's own outline): cached until a question,
  // board, topic or the batch changes.
  const key = `archive:topics:${req.batch._id}:${[...(req.batch.archiveAuthorities || []).map(String)].sort().join(",")}:${req.query.authority || ""}:${req.query.year || ""}:${req.query.subject || ""}:${req.query.types || ""}`;
  res.status(200).json(await cache.wrap(key, [tags.ARCHIVE, tags.TAXONOMY, tags.BATCHES], () => buildGetTopics(req), { group: "archive" }));
});

//@desc   A batch of archive questions for one topic or chapter-pool,
//        optionally narrowed by authority/year/skillType — mirrors
//        practiceController.getPracticeQuestions, minus skillType
//        auto-narrowing. skillType is exact ("none" = untagged questions):
//        only that skill's questions, however few, never the whole topic.
//@route  GET /api/app/batches/:batchId/archive/questions?topic=...&chapter=...&authority=...&year=...&skillType=...&limit=10
//@access Private (student + batchAccess + this batch has archiveAuthorities)
const getQuestions = asyncHandler(async (req, res) => {
  const { topic, chapter, authority, year, skillType } = req.query;
  const limit = Math.min(Number(req.query.limit) || 10, 100);
  const types = (req.query.types ? req.query.types.split(",") : VALID_TYPES).filter((t) => VALID_TYPES.includes(t));

  if (!topic && !chapter) {
    res.status(400);
    throw new Error("A topic or chapter is required.");
  }
  if (topic && chapter) {
    res.status(400);
    throw new Error("Choose a topic or a chapter, not both.");
  }

  const query = {
    isPublic: true,
    status: "published",
    type: { $in: types.length ? types : VALID_TYPES },
    ...authorityFilter(req, authority, year),
    ...(chapter ? { chapter, topic: null } : { topic }),
  };
  const skillTypeApplied = skillType === "none" || SKILL_TYPE_VALUES.includes(skillType);
  if (skillTypeApplied) query.skillType = skillType === "none" ? null : skillType;
  const skillEcho = { skillTypeApplied, skillType: skillTypeApplied ? skillType : null };

  // Ids only; the chosen few are loaded in full below.
  const all = await Question.find(query).select("_id").lean();
  if (all.length === 0) {
    res.status(200).json({ questions: [], ...skillEcho });
    return;
  }

  // Same fresh-before-mastered weighting as batch practice — a student's
  // own archive attempts (batch: null) are what "mastered" means here.
  const attempts = await PracticeAttempt.find({
    student: req.student._id,
    batch: req.batch._id,
    question: { $in: all.map((q) => q._id) },
    isCorrect: true,
  }).select("question");
  const masteredIds = new Set(attempts.map((a) => String(a.question)));

  const fresh = all.filter((q) => !masteredIds.has(String(q._id)));
  const mastered = all.filter((q) => masteredIds.has(String(q._id)));
  const shuffle = (arr) => [...arr].sort(() => Math.random() - 0.5);
  const picked = [...shuffle(fresh), ...shuffle(mastered)].slice(0, limit);
  const shuffled = await loadQuestionsInOrder(picked.map((q) => q._id));

  res.status(200).json({ questions: await Promise.all(shuffled.map(forTaking)), ...skillEcho });
});

//@desc   Predicted papers an admin shared as practice sets, for this
//        batch's boards
//@route  GET /api/app/batches/:batchId/archive/predicted
//@access Private (student + batchAccess + this batch has archiveAuthorities)
const getPredictedSets = asyncHandler(async (req, res) => {
  const papers = await PredictedPaper.find(sharedSetScope(req))
    .select("authority subject predictedYear questions sharedAt")
    .populate("authority", "name shortName")
    .populate("subject", "title")
    .sort({ sharedAt: -1 });

  // Count only questions that still exist and are published.
  const ids = papers.flatMap((p) => p.questions.map((q) => q.question));
  const live = new Set((await Question.find({ _id: { $in: ids }, status: "published" }).select("_id")).map((q) => String(q._id)));

  const sets = papers
    .map((p) => ({
      _id: p._id,
      title: `Predicted ${p.authority?.shortName || p.authority?.name || ""} ${p.subject?.title || ""} ${p.predictedYear || ""}`.replace(/\s+/g, " ").trim(),
      authority: p.authority,
      subject: p.subject,
      predictedYear: p.predictedYear,
      questionCount: p.questions.filter((q) => live.has(String(q.question))).length,
    }))
    .filter((s) => s.questionCount > 0);

  res.status(200).json({ sets });
});

//@desc   One shared predicted set's questions, in paper order, for taking
//@route  GET /api/app/batches/:batchId/archive/predicted/:id/questions
//@access Private (student + batchAccess + this batch has archiveAuthorities)
const getPredictedSetQuestions = asyncHandler(async (req, res) => {
  const paper = mongoose.isValidObjectId(req.params.id)
    ? await PredictedPaper.findOne({ _id: req.params.id, ...sharedSetScope(req) }).select("questions")
    : null;

  if (!paper) {
    res.status(404);
    throw new Error("This predicted set isn't available.");
  }

  const ids = paper.questions.map((q) => q.question);
  const docs = await Question.find({ _id: { $in: ids }, status: "published" });
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  const ordered = ids.map((id) => byId.get(String(id))).filter(Boolean);

  res.status(200).json({ questions: await Promise.all(ordered.map(forTaking)) });
});

//@desc   Answer one archive question — scored and explained immediately
//@route  POST /api/app/batches/:batchId/archive/questions/:id/attempt
//@access Private (student + batchAccess + this batch has archiveAuthorities)
const submitAttempt = asyncHandler(async (req, res) => {
  const { selectedOption, statementAnswers, subAnswers, timeSpentMs } = req.body;

  const question = await Question.findOne(await archiveQuestionFilter(req, req.params.id));
  if (!question) {
    res.status(404);
    throw new Error("Question not found in this batch's archive.");
  }

  await question.populate(["solutionImage", "solutionVideo", "solutionPdf", "solutionAttachments"]);

  // A written question has no single correct answer to self-grade against —
  // reveal the printed solution directly (like flipping to the answer key
  // of a real past-paper book) instead of recording a right/wrong
  // PracticeAttempt that doesn't apply here. No AI grading in this pass.
  if (question.type === "written") {
    res.status(200).json({
      isCorrect: null,
      solutionText: question.solutionText,
      solutionImage: await shapeField(question.solutionImage),
      solutionVideo: await shapeField(question.solutionVideo),
      solutionPdf: await shapeField(question.solutionPdf),
      solutionAttachments: await Promise.all((question.solutionAttachments || []).map(shapeField)),
      similar: await similarSource.offered(req.batch, question),
    });
    return;
  }

  // A passage is several independently-graded mcq sub-questions answered
  // together — the overall isCorrect is "every sub-question correct",
  // matching how getQuestions already treats isCorrect: true as "mastered".
  if (question.type === "passage") {
    const answers = subAnswers || [];
    // Written questions under it are checked one by one with AI (grade-written).
    const subResults = question.subQuestions.map((sq, i) => ({ sq, i })).filter(({ sq }) => sq.type !== "written").map(({ sq, i }) => {
      const given = answers.find((a) => a.index === i)?.selectedOption;
      return { index: i, selectedOption: given, correctOption: sq.correctOption, isCorrect: given === sq.correctOption };
    });
    const correctCount = subResults.filter((r) => r.isCorrect).length;
    const allCorrect = correctCount === subResults.length;

    const previous = await PracticeAttempt.findOne({ student: req.student._id, batch: req.batch._id, question: question._id }).sort({ createdAt: -1 });

    await PracticeAttempt.create({
      student: req.student._id,
      batch: req.batch._id,
      question: question._id,
      chapter: question.chapter,
      subAnswers: subResults.map(({ index, selectedOption: so, isCorrect }) => ({ index, selectedOption: so, isCorrect })),
      isCorrect: allCorrect,
      timeSpentMs: timeSpentMs || 0,
      seenCount: (previous?.seenCount || 0) + 1,
    });

    res.status(200).json({
      isCorrect: allCorrect,
      correctCount,
      totalCount: subResults.length,
      subResults,
      solutionText: question.solutionText,
      solutionImage: await shapeField(question.solutionImage),
      solutionVideo: await shapeField(question.solutionVideo),
      solutionPdf: await shapeField(question.solutionPdf),
      solutionAttachments: await Promise.all((question.solutionAttachments || []).map(shapeField)),
      similar: await similarSource.offered(req.batch, question),
    });
    return;
  }

  let isCorrect;
  if (question.type === "mcq") {
    isCorrect = selectedOption === question.correctOption;
  } else {
    isCorrect = (statementAnswers || []).length === question.statements.length &&
      (statementAnswers || []).every((s) => question.statements[s.index]?.isTrue === s.value);
  }

  const previous = await PracticeAttempt.findOne({ student: req.student._id, batch: req.batch._id, question: question._id }).sort({ createdAt: -1 });

  await PracticeAttempt.create({
    student: req.student._id,
    batch: req.batch._id,
    question: question._id,
    topic: question.topic || undefined,
    chapter: question.topic ? undefined : question.chapter,
    selectedOption,
    statementAnswers,
    isCorrect,
    timeSpentMs: timeSpentMs || 0,
    seenCount: (previous?.seenCount || 0) + 1,
  });

  res.status(200).json({
    isCorrect,
    correctOption: question.type === "mcq" ? question.correctOption : undefined,
    statements: question.type === "mtf" ? question.statements : undefined,
    solutionText: question.solutionText,
    solutionImage: await shapeField(question.solutionImage),
    solutionVideo: await shapeField(question.solutionVideo),
    solutionPdf: await shapeField(question.solutionPdf),
    solutionAttachments: await Promise.all((question.solutionAttachments || []).map(shapeField)),
    similar: await similarSource.offered(req.batch, question),
  });
});

//@desc   Why a wrong archive answer was wrong
//@route  POST /api/app/batches/:batchId/archive/questions/:id/explain
//@access Private (student + batchAccess + this batch has archiveAuthorities)
const explainAttempt = asyncHandler(async (req, res) => {
  // Admin-wide "Explain mistakes to students" switch (AI settings), on top
  // of the batch switches the route already checks.
  if (!(await AiConfig.get()).features.studentExplanations) {
    res.status(403);
    throw new Error("Explanations are switched off.");
  }

  const { selectedOption, statementAnswers } = req.body;

  const question = await Question.findOne(await archiveQuestionFilter(req, req.params.id))
    .populate("topic", "title")
    .populate("chapter", "title");

  if (!question) {
    res.status(404);
    throw new Error("Question not found in this batch's archive.");
  }
  if (question.type === "written" || question.type === "passage") {
    res.status(400);
    throw new Error("This question type doesn't have a single answer to explain against.");
  }

  const prompt = explainMistake({
    matchLanguage: (await AiConfig.get()).languages?.explanations !== false,
    question: questionText(question),
    topicTitle: question.topic?.title || question.chapter?.title || "this topic",
    ...(question.type === "mcq"
      ? { options: question.options, correctOption: question.correctOption, selectedOption }
      : { statements: question.statements, studentAnswers: statementAnswers || [] }),
  });

  // The same wrong answer explained before is served again when the admin
  // allows it (utils/aiReuse.pro.js).
  const data = await aiReuse.explanation({
    question, answer: { selectedOption, statementAnswers },
    feature: "archive-explain", student: req.student._id, batch: req.batch._id,
    generate: () => aiService.generate({ feature: "archive-explain", schema: explanationSchema, student: req.student._id, batch: req.batch._id, ...prompt }),
  });

  res.status(200).json(data);
});

//@desc   One escalating hint on an archive question the student hasn't
//        answered yet (up to 3). Stateless: the client sends which level it
//        wants and the hints it already has — a tampered level only spends
//        the student's own AI quota. Logic lives in utils/hints.js.
//@route  POST /api/app/batches/:batchId/archive/questions/:id/hint
//@access Private (student + batchAccess + this batch has archiveAuthorities)
const getHint = asyncHandler(async (req, res) => {
  const { level, previousHints } = parseHintRequest(req.body);

  const question = await Question.findOne(await archiveQuestionFilter(req, req.params.id))
    .populate("topic", "title")
    .populate("chapter", "title");

  if (!question) {
    res.status(404);
    throw new Error("Question not found in this batch's archive.");
  }
  // A passage is hinted one sub-question at a time (req.body.subIndex).
  // A saved hint chain is served when the admin allows it (utils/aiReuse.pro.js).
  const target = hintTargetFor(question, req.body.subIndex);
  const hint = await aiReuse.hint({
    question, subIndex: question.type === "passage" ? req.body.subIndex : undefined, level, previousHints,
    feature: "archive-hint", student: req.student._id, batch: req.batch._id,
    generate: () => generateHintWithUsage({ question: target, level, previousHints, student: req.student._id, batch: req.batch._id, feature: "archive-hint" }),
  });
  res.status(200).json({ level, hint });
});

//@desc   AI-graded answer to a written archive question — the archive's
//        version of batch practice's grade-written: a mark against the
//        question's rubric plus feedback, then the printed solution too.
//        Billed to the archive's shared pool (batch: null) as
//        "archive-grade-written". Photos are allowed when the batch has
//        writtenAnswerImages on, same as batch practice.
//@route  POST /api/app/batches/:batchId/archive/questions/:id/grade-written
//@access Private (student + batchAccess + archiveAuthorities + features.archiveAiAssist)
const gradeWrittenAttempt = asyncHandler(async (req, res) => {
  const { answerText, answerImages } = req.body;

  let question = await Question.findOne(await archiveQuestionFilter(req, req.params.id))
    .populate("topic", "title")
    .populate("chapter", "title");

  if (!question) {
    res.status(404);
    throw new Error("Question not found in this batch's archive.");
  }
  // A passage's written question is checked as that part, one AI check
  // (and one credit) each (utils/passageParts.js).
  const doc = question;
  if (question.type === "passage" && req.body.subIndex !== undefined && req.body.subIndex !== null) {
    question = partOf(question, Number(req.body.subIndex)) || question;
  }
  if (question.type !== "written") {
    res.status(400);
    throw new Error("This isn't a written question.");
  }

  const hasImages = Boolean(req.batch.features?.writtenAnswerImages) && Array.isArray(answerImages) && answerImages.length > 0;
  if ((!answerText || !answerText.trim()) && !hasImages) {
    res.status(400);
    throw new Error("Write an answer, or attach an image, before checking it.");
  }
  if (hasImages && answerImages.length > MAX_ANSWER_IMAGES) {
    res.status(400);
    throw new Error(`No more than ${MAX_ANSWER_IMAGES} images per answer.`);
  }
  if (hasImages) {
    for (const image of answerImages) {
      await assertOwnMediaUrl(image, req.student._id, "answer image");
    }
  }
  if (!question.rubric || question.rubric.length === 0) {
    res.status(400);
    throw new Error("This question has no marking rubric set up yet, so it can't be auto-graded. Show the solution instead.");
  }

  const prompt = gradeWrittenPractice({
    question: questionText(question),
    rubric: question.rubric,
    modelAnswer: question.modelAnswer,
    studentAnswer: answerText?.trim() || "(No typed answer — see the attached image.)",
    totalMarks: question.marks,
    images: hasImages ? answerImages.length : 0,
  });

  const { data } = await aiService.generate({
    feature: "archive-grade-written",
    schema: gradedAnswerSchema,
    student: req.student._id,
    batch: req.batch._id,
    imageUrls: hasImages ? answerImages.map((u) => toAbsoluteUrl(req, u)) : undefined,
    ...prompt,
  });

  // Built from the rubric rows the model marked, not its bare total, then
  // the handwriting check on its photos (utils/handwriting.js).
  const check = practiceHandwriting(
    data,
    reconcileRubricMarks({ rubric: question.rubric, totalMarks: question.marks, data }).marks,
    hasImages ? await handwritingMode("practice") : "off",
  );
  const { marks } = check;

  const previous = await PracticeAttempt.findOne({ student: req.student._id, batch: req.batch._id, question: question._id }).sort({ createdAt: -1 });
  await PracticeAttempt.create({
    student: req.student._id,
    batch: req.batch._id,
    question: question._id,
    topic: question.topic?._id || undefined,
    chapter: question.topic ? undefined : question.chapter?._id,
    answerText,
    answerImages: hasImages ? answerImages : undefined,
    marksAwarded: marks,
    isCorrect: marks >= question.marks * 0.6,
    seenCount: (previous?.seenCount || 0) + 1,
  });

  // Graded, so the printed solution comes with it — the archive always
  // showed it for written questions, and grading shouldn't take that away.
  await doc.populate(["solutionImage", "solutionVideo", "solutionPdf", "solutionAttachments"]);

  res.status(200).json({
    marks,
    totalMarks: question.marks,
    feedback: withNote(sanitizeReasoning(data.reasoning, question.modelAnswer), check.note),
    notHandwritten: check.source,
    transcript: hasImages ? data.transcript || null : null,
    solutionText: question.solutionText,
    // A passage's written question: its own correct answer, shown under the mark.
    ...(question.subIndex !== undefined && { modelAnswer: question.modelAnswer || "" }),
    solutionImage: await shapeField(doc.solutionImage),
    solutionVideo: await shapeField(doc.solutionVideo),
    solutionPdf: await shapeField(doc.solutionPdf),
    solutionAttachments: await Promise.all((doc.solutionAttachments || []).map(shapeField)),
    similar: await similarSource.offered(req.batch, question),
  });
});

//@desc   Ephemeral AI-generated similar questions for one archive question
//@route  POST /api/app/batches/:batchId/archive/questions/:id/similar
//@access Private (student + batchAccess + this batch has archiveAuthorities)
const getSimilarQuestions = asyncHandler(async (req, res) => {
  const question = await Question.findOne(await archiveQuestionFilter(req, req.params.id))
    .populate("topic", "title")
    .populate("chapter", "title");

  if (!question) {
    res.status(404);
    throw new Error("Question not found in this batch's archive.");
  }

  const prompt = generateSimilarQuestions({
    type: question.type,
    question: questionText(question),
    options: question.options,
    statements: question.statements,
    correctAnswer: question.type === "mcq" ? question.correctOption : undefined,
    topicTitle: question.topic?.title || question.chapter?.title,
  });

  // A saved set when the admin allows it
  // (utils/aiReuse.pro.js); background top-ups bill nobody.
  const data = await similarSource.similarFor({
    batch: req.batch, chargeBatch: null, question, student: req.student._id, feature: "archive-similar",
    ai: () => aiReuse.similar({
      question, feature: "archive-similar", student: req.student._id, batch: req.batch._id,
      generate: () => aiService.generate({ feature: "archive-similar", schema: similarQuestionsSchema, student: req.student._id, batch: req.batch._id, ...prompt }),
      makeSet: () => aiService.generate({ feature: "archive-similar", schema: similarQuestionsSchema, ...prompt }),
    }),
  }).catch((e) => { if (e.statusCode) res.status(e.statusCode); throw e; });

  res.status(200).json({ questions: data.questions });
});

//@desc   This student's own accuracy per topic across ALL archive activity
//        (batch: null) — deliberately not restricted to this batch's own
//        archiveAuthorities, since the tracking bucket itself is shared
//        across every batch's archive door, same ranking rankWeakTopics
//        already does per batch
//@route  GET /api/app/batches/:batchId/archive/weak-topics
//@access Private (student + batchAccess + this batch has archiveAuthorities)
const getWeakTopics = asyncHandler(async (req, res) => {
  const ranked = await rankWeakTopics(req.student._id, req.batch._id, { subjects: subjectIds(req.batch), archive: true });
  res.status(200).json({ topics: ranked, readyForPersonalized: ranked.length > 0 });
});

//@desc   A practice set pulled from this student's weakest archive topics,
//        mixed together — the archive's own "personalized" alternative to
//        picking one topic, same idea as practiceController.js's
//        getPersonalizedQuestions, scoped by isPublic/archiveAuthorities and
//        the shared batch: null tracking bucket instead of batch membership
//@route  GET /api/app/batches/:batchId/archive/personalized?limit=10
//@access Private (student + batchAccess + this batch has archiveAuthorities)
const getPersonalizedQuestions = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 10, 100);
  const types = (req.query.types ? req.query.types.split(",") : VALID_TYPES).filter((t) => VALID_TYPES.includes(t));

  const ranked = await rankWeakTopics(req.student._id, req.batch._id, { subjects: subjectIds(req.batch), archive: true });

  if (ranked.length === 0) {
    res.status(200).json({ questions: [], message: "Practice a few archive topics first — this needs some history to know what to focus on." });
    return;
  }

  // ranked is already weakest-first across topics and chapter-pool chapters
  // together (see utils/weakTopics.js) — the top 3 overall, then split back
  // out by kind for the query below, same slice practiceController.js's
  // version takes. No practiceByChapter-style feature gate here — the
  // archive treats chapter pools as first-class everywhere else
  // (getTopics/getQuestions), so this doesn't gate them either.
  const weakest = ranked.slice(0, 3);
  const weakestTopicIds = weakest.filter((r) => !r.chapterPool).map((r) => r._id);
  const weakestChapterIds = weakest.filter((r) => r.chapterPool).map((r) => r._id);

  const filters = [];
  if (weakestTopicIds.length) filters.push({ topic: { $in: weakestTopicIds } });
  if (weakestChapterIds.length) filters.push({ chapter: { $in: weakestChapterIds }, topic: null });

  const all = filters.length
    ? await Question.find({
        isPublic: true,
        status: "published",
        type: { $in: types.length ? types : VALID_TYPES },
        ...authorityFilter(req),
        $or: filters,
      })
    : [];

  if (all.length === 0) {
    res.status(200).json({ questions: [], message: "No archive questions available in your weakest topics right now." });
    return;
  }

  const attempts = await PracticeAttempt.find({
    student: req.student._id,
    batch: req.batch._id,
    question: { $in: all.map((q) => q._id) },
    isCorrect: true,
  }).select("question");
  const masteredIds = new Set(attempts.map((a) => String(a.question)));

  const fresh = all.filter((q) => !masteredIds.has(String(q._id)));
  const pool = fresh.length >= limit ? fresh : all;
  const shuffled = [...pool].sort(() => Math.random() - 0.5).slice(0, limit);

  res.status(200).json({ questions: await Promise.all(shuffled.map(forTaking)) });
});

//@desc   This student's AI usage on the archive — today's free calls used
//        and left, plus both credit pools. Same shape as
//        aiUsageController.js's getAiUsage, but with batch fixed to null:
//        every archive AI call (explain/similar/study-plan/exam-insight)
//        is logged and billed with batch: null, not this door's batch id
//        (see this file's own header comment), so the meter has to read
//        that exact same scope or it would show a number that never
//        matches what a call here actually draws down.
//@route  GET /api/app/batches/:batchId/archive/ai-usage
//@access Private (student + batchAccess + this batch has archiveAuthorities)
const getAiUsage = asyncHandler(async (req, res) => {
  const config = await AiConfig.get();
  const snapshot = await getUsageSnapshot({ student: req.student._id, batch: req.batch._id, config });
  res.status(200).json(snapshot);
});

//@desc   Add or remove an archive favorite in one call — the frontend
//        doesn't need to know current state before acting, just flip it
//@route  POST /api/app/batches/:batchId/archive/favorites/:questionId
//@access Private (student + batchAccess + this batch has archiveAuthorities)
const toggleFavorite = asyncHandler(async (req, res) => {
  const question = await Question.findOne(await archiveQuestionFilter(req, req.params.questionId));
  if (!question) {
    res.status(404);
    throw new Error("Question not found in this batch's archive.");
  }

  const existing = await PracticeFavorite.findOne({ student: req.student._id, batch: req.batch._id, question: question._id });
  if (existing) {
    await existing.deleteOne();
    res.status(200).json({ favorited: false });
    return;
  }

  await PracticeFavorite.create({ student: req.student._id, batch: req.batch._id, question: question._id });
  res.status(200).json({ favorited: true });
});

//@desc   Just the question ids this student has favorited across the whole
//        archive — shared across every batch's archive door, not restricted
//        to this batch's own archiveAuthorities, same reasoning as
//        getWeakTopics above: batch: null is already the one shared scope,
//        so a bookmark saved through one batch's door still shows up
//        through another
//@route  GET /api/app/batches/:batchId/archive/favorites/ids
//@access Private (student + batchAccess + this batch has archiveAuthorities)
const getFavoriteIds = asyncHandler(async (req, res) => {
  const favorites = await PracticeFavorite.find({ student: req.student._id, batch: req.batch._id }).select("question");
  res.status(200).json({ ids: favorites.map((f) => String(f.question)) });
});

//@desc   Favorited archive questions, shaped for taking — the archive's
//        "My favorites" mode
//@route  GET /api/app/batches/:batchId/archive/favorites?limit=10
//@access Private (student + batchAccess + this batch has archiveAuthorities)
const getFavoriteQuestions = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 10, 100);

  const favorites = await PracticeFavorite.find({ student: req.student._id, batch: req.batch._id })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate("question");

  // A favorited question can later be unpublished or made non-public again
  // — filtered out here rather than left to error further down. One from a
  // predicted set stays while that set is still shared with this batch.
  const sharedIds = new Set(
    (await PredictedPaper.find(sharedSetScope(req)).select("questions.question"))
      .flatMap((p) => p.questions.map((q) => String(q.question)))
  );
  const questions = await Promise.all(
    favorites
      .filter((f) => f.question && f.question.status === "published" && (f.question.isPublic || sharedIds.has(String(f.question._id))))
      .map((f) => forTaking(f.question))
  );

  res.status(200).json({ questions });
});

module.exports = {
  getFilters,
  getTopics,
  getQuestions,
  getPredictedSets,
  getPredictedSetQuestions,
  submitAttempt,
  getHint,
  gradeWrittenAttempt,
  explainAttempt,
  getSimilarQuestions,
  getWeakTopics,
  getPersonalizedQuestions,
  getAiUsage,
  toggleFavorite,
  getFavoriteIds,
  getFavoriteQuestions,
};
