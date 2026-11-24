const asyncHandler = require("express-async-handler");
const { questionText, fullQuestionText } = require("../../utils/questionText");
const cache = require("../../utils/cache");
const tags = require("../../utils/cacheTags");
const { Question } = require("../../models/questionModel");
const { loadQuestionsInOrder } = require("../../utils/loadQuestionsInOrder");
const AiConfig = require("../../models/aiConfigModel");
const Topic = require("../../models/topicModel");
const Chapter = require("../../models/chapterModel");
const PracticeAttempt = require("../../models/practiceAttemptModel");
const PracticeFavorite = require("../../models/practiceFavoriteModel");
const { forTaking, shapeField } = require("../../utils/shapeQuestion");
const { rankWeakTopics } = require("../../utils/weakTopics");
const aiService = require("../../ai/service");
const { explainMistake, gradeWrittenPractice, generateSimilarQuestions, practiceFollowUp } = require("../../ai/prompts");
const { explanation: explanationSchema, gradedAnswer: gradedAnswerSchema, similarQuestions: similarQuestionsSchema, practiceFollowUp: practiceFollowUpSchema } = require("../../ai/schemas");
const PracticeQna = require("../../models/practiceQnaModel");
const { solutionLines, describe: describeForQna, MAX_MESSAGE: QNA_MAX_MESSAGE, HISTORY: QNA_HISTORY, REFUSAL: QNA_REFUSAL } = require("../../utils/practiceQna");
const storage = require("../../adapters/storage");
const { toAbsoluteUrl, assertOwnMediaUrl, recordStudentUpload } = require("../../utils/mediaUrl");
const { outlineFor, chapterOrderOf } = require("../../utils/courseOutline");
const { batchQuestionScope, subjectIds } = require("../../utils/batchSubjects");
const { parseHintRequest, hintTargetFor, generateHintWithUsage } = require("../../utils/hints");
const aiReuse = require("../../utils/aiReuse.pro");
const similarSource = require("../../utils/similarSource");
const { sanitizeReasoning } = require("../../ai/leakGuard");
const { reconcileRubricMarks } = require("../../utils/rubricMarks");
const { partOf } = require("../../utils/passageParts");
const { preparePhoto, hasCameraData } = require("../../utils/photo");

const { MAX_ANSWER_IMAGES } = require("../../utils/practiceAnswerImages");
const { handwritingMode, practiceHandwriting, withNote } = require("../../utils/handwriting");

// Passage (a shared stem with several mcq sub-questions) is always
// chapter-pool (no topic), so it only turns up where chapter practice is on.
// Coding has its own section (coding practice), not topic practice.
const VALID_TYPES = ["mcq", "mtf", "written", "passage"];

// The study plan's miscellaneous-bucket sentinel (studyPlanModel.js) —
// "questions with no skillType tag at all", not a real skill value.
const MISC_SKILL = "none";

// Shared by getPracticeQuestions and getPersonalizedQuestions — a written
// question is only ever gradable by AI, so it's never trusted from the
// client alone, in case aiAssist got switched off after the page loaded,
// or the request was crafted directly. Same precaution buildPracticeExam
// already takes when building a custom paper. Requesting nothing valid at
// all falls back to every gradable type, same as picking every checkbox.
const DEFAULT_TYPES = VALID_TYPES;
const resolveTypes = (batch, requested) => {
  const parsed = requested ? requested.split(",").filter((t) => VALID_TYPES.includes(t)) : DEFAULT_TYPES;
  const types = parsed.length > 0 ? parsed : DEFAULT_TYPES;
  return batch.features?.aiAssist ? types : types.filter((t) => t !== "written");
};

// Practice draws on the same explicit batches[] assignment questions
// already carry for exams — a question does not need to sit inside an exam
// to be practiceable, it only needs to be assigned to the batch directly.

//@desc   Topics with practiceable questions in this batch, and how many —
//        optionally filtered to a set of question types, since "how many
//        questions" means something different once written is excluded
//        (AI off for this batch) or deselected by choice.
//        Also narrowed by skillType when one is picked ("none" = never
//        tagged), with a per-skill count so the picker can show only the
//        skills this batch actually has.
//@route  GET /api/app/batches/:batchId/practice/topics?types=mcq,mtf&skillType=recall
//@access Private (student + batchAccess + features.practice)
const getTopics = asyncHandler(async (req, res) => {
  const types = resolveTypes(req.batch, req.query.types);
  const skillType = req.query.skillType ? String(req.query.skillType) : "";
  // The same for every student of the batch: cached until a question,
  // topic or the batch changes (utils/cache.js).
  const key = `practice:topics:${req.batch._id}:${[...types].sort().join(",")}:${req.batch.features?.practiceByChapter ? 1 : 0}:${skillType}`;
  const body = await cache.wrap(key, [tags.QUESTIONS, tags.TAXONOMY, tags.BATCHES], () => buildTopics(req.batch, types, skillType), { group: "practice" });
  res.status(200).json(body);
});

const buildTopics = async (batch, types, skillType) => {
  const skill = skillType ? { skillType: skillType === MISC_SKILL ? null : skillType } : {};

  // Two counts, not one — which topics exist at all (any type, so a topic
  // that happens to be all-written doesn't vanish from the list the
  // moment written is excluded) versus how many of each topic's questions
  // match the current filter (which can genuinely be zero). Collapsing
  // these into one type-filtered aggregation would make that topic
  // disappear entirely instead of showing "0 questions available" —
  // confusing on its own, and actively misleading once a student has
  // deliberately deselected a type and gets no explanation for a topic
  // just quietly not being there anymore.
  const [allCounts, filteredCounts] = await Promise.all([
    Question.aggregate([
      { $match: { ...batchQuestionScope(batch), status: "published" } },
      { $group: { _id: "$topic", count: { $sum: 1 } } },
    ]),
    Question.aggregate([
      { $match: { ...batchQuestionScope(batch), status: "published", type: { $in: types }, ...skill } },
      { $group: { _id: "$topic", count: { $sum: 1 } } },
    ]),
  ]);

  // Per-skill counts for the picker, over everything practiceable here
  // with the current types (chapter-pool questions only when that's on).
  const skillCounts = await Question.aggregate([
    {
      $match: {
        ...batchQuestionScope(batch), status: "published", type: { $in: types },
        ...(batch.features?.practiceByChapter ? {} : { topic: { $ne: null } }),
      },
    },
    { $group: { _id: "$skillType", count: { $sum: 1 } } },
  ]);
  const skills = [];
  for (const c of skillCounts) {
    const value = c._id || MISC_SKILL;
    const found = skills.find((x) => x.skillType === value);
    if (found) found.count += c.count;
    else skills.push({ skillType: value, count: c.count });
  }

  const topics = await Topic.find({ _id: { $in: allCounts.map((c) => c._id) } })
    .populate("chapter", "title")
    // Subject lets the student narrow a multi-subject batch's list.
    .populate("subject", "title")
    .select("title chapter subject order")
    .lean();

  const countByTopic = new Map(filteredCounts.map((c) => [String(c._id), c.count]));

  // Chapter-pool tiles — one per chapter that has chapter-pool questions
  // (Question.topic === null under it), same shape/gating logic as the
  // topic list above, just grouped by $chapter with topic pinned to null.
  // Returned as a separate array rather than folded into `topics`: a
  // chapter and a topic id come from different collections and could in
  // principle collide, and keeping them apart means the client never has
  // to guess which kind of id it's looking at.
  let chapterPools = [];
  if (batch.features?.practiceByChapter) {
    const [allChapterCounts, filteredChapterCounts] = await Promise.all([
      Question.aggregate([
        { $match: { ...batchQuestionScope(batch), status: "published", topic: null } },
        { $group: { _id: "$chapter", count: { $sum: 1 } } },
      ]),
      Question.aggregate([
        { $match: { ...batchQuestionScope(batch), status: "published", topic: null, type: { $in: types }, ...skill } },
        { $group: { _id: "$chapter", count: { $sum: 1 } } },
      ]),
    ]);

    const chapters = await Chapter.find({ _id: { $in: allChapterCounts.map((c) => c._id) } }).select("title subject").populate("subject", "title").lean();
    const countByChapter = new Map(filteredChapterCounts.map((c) => [String(c._id), c.count]));

    chapterPools = chapters.map((c) => ({ _id: c._id, title: c.title, subject: c.subject, questionCount: countByChapter.get(String(c._id)) || 0 }));
  }

  // The batch's outline decides the order (utils/courseOutline.js); each
  // tile carries its named group, and subjects carry their outline rank as
  // `order` for the subject chips.
  const ol = await outlineFor(batch);
  await ol.prime({ topics: topics.map((t) => t._id), chapters: chapterPools.map((c) => c._id) });
  const subjectIds = [...new Set([...topics, ...chapterPools].map((x) => x.subject && String(x.subject._id)).filter(Boolean))];
  await ol.prime({ subjects: subjectIds });
  subjectIds.sort(ol.bySubject((id) => id));
  const withRank = (subject) => subject && { ...subject, order: subjectIds.indexOf(String(subject._id)) };

  return JSON.parse(JSON.stringify({
    topics: topics
      .sort(ol.byTopic((t) => t._id))
      .map((t) => ({ _id: t._id, title: t.title, chapter: t.chapter, subject: withRank(t.subject), group: ol.group(t.chapter?._id), questionCount: countByTopic.get(String(t._id)) || 0 })),
    chapterPools: chapterPools
      .sort(ol.byChapter((c) => c._id))
      .map((c) => ({ ...c, subject: withRank(c.subject), group: ol.group(c._id) })),
    groups: ol.groups,
    // Every chapter on this list (topic or whole-chapter tiles), in outline
    // order, for the chapter cards.
    chapterOrder: chapterOrderOf(ol, topics, chapterPools),
    skills,
  }));
};

//@desc   A batch of practice questions for one topic, optionally narrowed to
//        one skillType (e.g. the study plan's "practice this specific
//        skill" modal). An explicit skillType is exact: only that skill's
//        questions, however few, and none at all if it has none.
//@route  GET /api/app/batches/:batchId/practice/questions?topic=...&limit=10&skillType=...
//@access Private (student + batchAccess + features.practice)
const getPracticeQuestions = asyncHandler(async (req, res) => {
  const { topic, chapter, skillType } = req.query;
  const limit = Math.min(Number(req.query.limit) || 10, 100);
  const autoSkill = req.query.autoSkill === "true";

  if (!topic && !chapter) {
    res.status(400);
    throw new Error("A topic or chapter is required.");
  }
  if (topic && chapter) {
    res.status(400);
    throw new Error("Choose a topic or a chapter, not both.");
  }
  if (chapter && !req.batch.features?.practiceByChapter) {
    res.status(403);
    throw new Error("Chapter-pool practice is not enabled for this batch.");
  }

  const types = resolveTypes(req.batch, req.query.types);
  // Chapter-pool path mirrors the topic path exactly, just scoped by
  // chapter with topic pinned to null — same convention as every other
  // chapter-pool query in this codebase (questionController.js's
  // getQuestions, aiController.js's getReviewQueue).
  const baseQuery = chapter
    ? { ...batchQuestionScope(req.batch), status: "published", chapter, topic: null, type: { $in: types } }
    : { ...batchQuestionScope(req.batch), status: "published", topic, type: { $in: types } };

  // autoSkill opts a caller into picking the weakest skill for them when
  // they didn't ask for one specifically — the study plan's practice modal
  // uses this for a day whose topic never got a skill grounded (no
  // breakdown existed yet when the plan was generated, say). Reuses the
  // exact same weakest-first skill ranking the study plan itself is built
  // from (utils/weakTopics.js), rather than a second, looser "just pick
  // any skill" heuristic — a topic with no chapter-pool and no skill
  // breakdown of its own (not enough attempts yet, see
  // MIN_ATTEMPTS_FOR_SIGNAL) simply gets no auto-pick, same as if autoSkill
  // had never been sent.
  let effectiveSkillType = skillType;
  if (!effectiveSkillType && autoSkill && topic) {
    const ranked = await rankWeakTopics(req.student._id, req.batch._id, { subjects: subjectIds(req.batch) });
    const entry = ranked.find((r) => !r.chapterPool && String(r._id) === String(topic));
    if (entry?.skills?.length > 0) effectiveSkillType = entry.skills[0].skillType;
  }

  let all = [];
  let skillTypeApplied = false;

  if (effectiveSkillType) {
    // "none" is the miscellaneous-bucket sentinel (see studyPlanModel.js) —
    // same "none" -> null convention already used for topic/chapter
    // filtering elsewhere in this codebase. Mongo's `skillType: null`
    // matches both an explicit null and a missing field, which is exactly
    // "never tagged with a skill" for a question written before skillType
    // classification existed at all.
    const skillFilter = effectiveSkillType === MISC_SKILL ? null : effectiveSkillType;
    const bySkill = await Question.find({ ...baseQuery, skillType: skillFilter }).select("_id").lean();
    // An explicitly requested skill is exact — never padded or swapped for
    // the whole topic. Only an auto-picked skill with nothing left to serve
    // falls back to the full topic, since the caller never asked for it.
    if (bySkill.length > 0 || skillType) {
      all = bySkill;
      skillTypeApplied = true;
    }
  }

  if (!skillTypeApplied) {
    all = await Question.find(baseQuery).select("_id").lean();
  }

  if (all.length === 0) {
    res.status(200).json({ questions: [], skillTypeApplied, skillType: skillTypeApplied ? effectiveSkillType : null });
    return;
  }

  // Weighted toward questions this student has not already answered
  // correctly — practice that only ever re-serves what's already mastered
  // is not practice.
  //
  // Fresh questions always come first, mastered ones only fill out
  // whatever's left below the limit — not "only prefer fresh if there
  // happen to be at least `limit` of them". That all-or-nothing version
  // silently gave up on the preference entirely the moment a caller asked
  // for more than the topic's unmastered pool actually had (exactly what a
  // caller asking for "everything" — limit near the pool's own size — does
  // by definition), which made a big `limit` and "no rotation at all" the
  // same request. This degrades gracefully at every pool size instead: a
  // small topic still eventually reruns the same handful of questions
  // (nothing else exists to serve), but a topic with real headroom keeps
  // surfacing whatever's still unmastered before ever repeating.
  const attempts = await PracticeAttempt.find({
    student: req.student._id,
    question: { $in: all.map((q) => q._id) },
    isCorrect: true,
  }).select("question");
  const masteredIds = new Set(attempts.map((a) => String(a.question)));

  const fresh = all.filter((q) => !masteredIds.has(String(q._id)));
  const mastered = all.filter((q) => masteredIds.has(String(q._id)));
  const shuffle = (arr) => [...arr].sort(() => Math.random() - 0.5);
  const picked = [...shuffle(fresh), ...shuffle(mastered)].slice(0, limit);
  // The pool above is ids only; the full questions are loaded just for these.
  const shuffled = await loadQuestionsInOrder(picked.map((q) => q._id));

  res.status(200).json({
    questions: await Promise.all(shuffled.map(forTaking)),
    // Lets the caller tell the student "practicing application questions"
    // versus quietly having served the whole topic instead — the modal uses
    // this to drop its skill badge rather than claim a narrowing that didn't
    // actually happen.
    skillTypeApplied,
    // The skill actually used — echoed back so a caller that only sent
    // autoSkill (no explicit skillType) can still show "practicing X" using
    // whatever was auto-picked, not just the value it originally sent.
    skillType: skillTypeApplied ? effectiveSkillType : null,
  });
});

//@desc   Answer one practice question — scored and explained immediately,
//        unlike an exam
//@route  POST /api/app/batches/:batchId/practice/attempt
//@access Private (student + batchAccess + features.practice)
const submitPracticeAttempt = asyncHandler(async (req, res) => {
  const { questionId, selectedOption, statementAnswers, subAnswers, timeSpentMs } = req.body;

  const question = await Question.findOne({ _id: questionId, ...batchQuestionScope(req.batch), status: "published" });
  if (!question) {
    res.status(404);
    throw new Error("Question not found in this batch.");
  }
  if (question.type === "coding") {
    res.status(400);
    throw new Error("Coding problems are answered in coding practice.");
  }
  if (question.type === "written") {
    res.status(400);
    throw new Error("Written questions are not self-graded — use an exam or the grading queue for these.");
  }

  // A passage is several independently-graded mcq sub-questions answered
  // together — overall isCorrect means every sub-question right. Same
  // scoring as the archive's own passage branch (archiveController.js).
  if (question.type === "passage") {
    const given = Array.isArray(subAnswers) ? subAnswers : [];
    // Written questions under it are checked one by one with AI (grade-written).
    const subResults = question.subQuestions.map((sq, i) => ({ sq, i })).filter(({ sq }) => sq.type !== "written").map(({ sq, i }) => {
      const selected = given.find((a) => a.index === i)?.selectedOption;
      return { index: i, selectedOption: selected, correctOption: sq.correctOption, isCorrect: selected === sq.correctOption };
    });
    const correctCount = subResults.filter((r) => r.isCorrect).length;
    const allCorrect = correctCount === subResults.length;

    const previousPassage = await PracticeAttempt.findOne({ student: req.student._id, question: question._id }).sort({ createdAt: -1 });

    await PracticeAttempt.create({
      student: req.student._id,
      batch: req.batch._id,
      question: question._id,
      topic: question.topic || undefined,
      chapter: question.topic ? undefined : question.chapter,
      subAnswers: subResults.map(({ index, selectedOption: so, isCorrect }) => ({ index, selectedOption: so, isCorrect })),
      isCorrect: allCorrect,
      timeSpentMs: timeSpentMs || 0,
      seenCount: (previousPassage?.seenCount || 0) + 1,
    });

    await question.populate(["solutionImage", "solutionVideo", "solutionPdf", "solutionAttachments"]);

    res.status(200).json({
      isCorrect: allCorrect,
      correctCount,
      totalCount: subResults.length,
      subResults,
      similar: await similarSource.offered(req.batch, question),
      solutionText: question.solutionText,
      solutionImage: await shapeField(question.solutionImage),
      solutionVideo: await shapeField(question.solutionVideo),
      solutionPdf: await shapeField(question.solutionPdf),
      solutionAttachments: await Promise.all((question.solutionAttachments || []).map(shapeField)),
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

  const previous = await PracticeAttempt.findOne({ student: req.student._id, question: question._id }).sort({ createdAt: -1 });

  await PracticeAttempt.create({
    student: req.student._id,
    batch: req.batch._id,
    question: question._id,
    // A chapter-pool question has no topic (see questionModel.js) — logged
    // by chapter instead, same duality PracticeAttempt's schema now allows.
    topic: question.topic || undefined,
    chapter: question.topic ? undefined : question.chapter,
    selectedOption,
    statementAnswers,
    isCorrect,
    timeSpentMs: timeSpentMs || 0,
    seenCount: (previous?.seenCount || 0) + 1,
  });

  // Same media fields forReview sends after a graded exam (shapeQuestion.js)
  // — a practice question has exactly the same solution to show, just
  // immediately instead of after grading, and it was missing every kind but
  // text here despite the model carrying all of them.
  await question.populate(["solutionImage", "solutionVideo", "solutionPdf", "solutionAttachments"]);

  res.status(200).json({
    isCorrect,
    correctOption: question.type === "mcq" ? question.correctOption : undefined,
    statements: question.type === "mtf" ? question.statements : undefined,
    solutionText: question.solutionText,
    solutionImage: await shapeField(question.solutionImage),
    solutionVideo: await shapeField(question.solutionVideo),
    solutionPdf: await shapeField(question.solutionPdf),
    solutionAttachments: await Promise.all((question.solutionAttachments || []).map(shapeField)),
    // Whether "Practice 5 similar" is offered for it (utils/similarSource.js).
    similar: await similarSource.offered(req.batch, question),
  });
});

//@desc   One escalating hint (up to 3) on a practice question the student
//        hasn't answered yet — never the answer itself. Same tutor as the
//        archive's (utils/hints.js), billed to this batch as practice-hint.
//        Gated by aiAssist on the route.
//@route  POST /api/app/batches/:batchId/practice/hint
//@access Private (student + batchAccess + features.practice + features.aiAssist)
const getHint = asyncHandler(async (req, res) => {
  const { level, previousHints } = parseHintRequest(req.body);

  const question = await Question.findOne({ _id: req.body.questionId, ...batchQuestionScope(req.batch), status: "published" })
    .populate("topic", "title")
    .populate("chapter", "title");

  if (!question) {
    res.status(404);
    throw new Error("Question not found in this batch.");
  }
  // A passage is hinted one sub-question at a time (req.body.subIndex).
  // A saved hint chain is served when the admin allows it (utils/aiReuse.pro.js).
  const target = hintTargetFor(question, req.body.subIndex);
  const hint = await aiReuse.hint({
    question, subIndex: question.type === "passage" ? req.body.subIndex : undefined, level, previousHints,
    feature: "practice-hint", student: req.student._id, batch: req.batch._id,
    generate: () => generateHintWithUsage({ question: target, level, previousHints, student: req.student._id, batch: req.batch._id, feature: "practice-hint" }),
  });
  res.status(200).json({ level, hint });
});

//@desc   Why a wrong practice answer was wrong — generated fresh against
//        this specific answer, not a canned explanation. Gated by the
//        batch's own aiAssist flag, same as every other AI-facing route.
//@route  POST /api/app/batches/:batchId/practice/explain
//@access Private (student + batchAccess + features.practice + features.aiAssist)
const explainAttempt = asyncHandler(async (req, res) => {
  // Admin-wide "Explain mistakes to students" switch (AI settings), on top
  // of the batch switches the route already checks.
  if (!(await AiConfig.get()).features.studentExplanations) {
    res.status(403);
    throw new Error("Explanations are switched off.");
  }

  const { questionId, selectedOption, statementAnswers } = req.body;

  const question = await Question.findOne({ _id: questionId, ...batchQuestionScope(req.batch), status: "published" })
    .populate("topic", "title")
    .populate("chapter", "title");

  if (!question) {
    res.status(404);
    throw new Error("Question not found in this batch.");
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
    feature: "practice-explain", student: req.student._id, batch: req.batch._id,
    generate: () => aiService.generate({ feature: "practice-explain", schema: explanationSchema, student: req.student._id, batch: req.batch._id, ...prompt }),
  });

  res.status(200).json(data);
});

// ------------------------------------------------------------- follow-ups

// Shared by getQna/askQna: the global switch, the question (in this batch)
// and the student's latest answer to it here. Asking needs an answer first.
const qnaContext = async (req, res) => {
  const config = await AiConfig.get();
  if (!config.features?.practiceQna) {
    res.status(403);
    throw new Error("Questions about solutions are switched off.");
  }
  const question = await Question.findOne({ _id: req.params.questionId, ...batchQuestionScope(req.batch), status: "published" })
    .populate("topic", "title")
    .populate("chapter", "title");
  if (!question) {
    res.status(404);
    throw new Error("Question not found in this batch.");
  }
  const attempt = await PracticeAttempt.findOne({ student: req.student._id, batch: req.batch._id, question: question._id }).sort({ createdAt: -1 });
  const limit = Math.max(1, Number(config.practiceQna?.maxPerQuestion) || 5);
  return { question, attempt, limit };
};

const qnaView = (thread, lines, limit) => {
  const messages = thread?.messages || [];
  const asked = messages.filter((m) => m.role === "student").length;
  return { lines, messages, asked, limit, remaining: Math.max(0, limit - asked) };
};

//@desc   The follow-up thread on one answered practice question, and the
//        solution's numbered lines to point at
//@route  GET /api/app/batches/:batchId/practice/qna/:questionId
//@access Private (student + batchAccess + features.practice + aiAssist + practiceQna)
const getQna = asyncHandler(async (req, res) => {
  const { question, limit } = await qnaContext(req, res);
  const thread = await PracticeQna.findOne({ student: req.student._id, batch: req.batch._id, question: question._id }).lean();
  res.json(qnaView(thread, solutionLines(question.solutionText), limit));
});

//@desc   Ask about a step of an answered practice question ("I don't get
//        line 4"). The AI only elaborates this question's solution; an
//        off-topic message gets a one-line refusal. Billed as practice-qna.
//@route  POST /api/app/batches/:batchId/practice/qna/:questionId { message, line? }
//@access Private (student + batchAccess + features.practice + aiAssist + practiceQna)
const askQna = asyncHandler(async (req, res) => {
  const { question, attempt, limit } = await qnaContext(req, res);
  if (!attempt) {
    res.status(400);
    throw new Error("Answer the question first, then ask about its solution.");
  }
  const message = String(req.body.message || "").trim();
  if (!message) {
    res.status(400);
    throw new Error("Write what you didn't follow.");
  }
  if (message.length > QNA_MAX_MESSAGE) {
    res.status(400);
    throw new Error(`Keep it to ${QNA_MAX_MESSAGE} characters: one step or line at a time.`);
  }
  const lines = solutionLines(question.solutionText);
  const line = req.body.line === undefined || req.body.line === null || req.body.line === "" ? null : Number(req.body.line);
  if (line !== null && !(Number.isInteger(line) && line >= 1 && line <= lines.length)) {
    res.status(400);
    throw new Error("That line isn't in the solution.");
  }

  const thread = (await PracticeQna.findOne({ student: req.student._id, batch: req.batch._id, question: question._id }))
    || new PracticeQna({ student: req.student._id, batch: req.batch._id, question: question._id, messages: [] });
  if (thread.messages.filter((m) => m.role === "student").length >= limit) {
    // 403, not 429: more credits wouldn't help here.
    res.status(403);
    throw new Error(`That's the ${limit} questions allowed on this one. Ask a teacher through Doubts if it's still unclear.`);
  }

  const { data } = await aiService.generate({
    feature: "practice-qna",
    schema: practiceFollowUpSchema,
    student: req.student._id,
    batch: req.batch._id,
    ...practiceFollowUp({
      topicTitle: question.topic?.title || question.chapter?.title || "this topic",
      ...describeForQna(question, attempt),
      lines,
      history: thread.messages.slice(-QNA_HISTORY).map((m) => ({ role: m.role, text: m.text })),
      message,
      line,
      matchLanguage: (await AiConfig.get()).languages?.qna !== false,
    }),
  });

  const refused = data.onTopic === false;
  thread.messages.push({ role: "student", text: message, line });
  thread.messages.push({ role: "ai", text: refused ? QNA_REFUSAL : String(data.reply).trim(), refused });
  await thread.save();
  res.json(qnaView(thread.toObject(), lines, limit));
});

//@desc   AI-graded practice for a written question — a real mark against
//        the question's own rubric plus feedback addressed to the student,
//        not the canned "not self-graded" rejection the plain attempt
//        endpoint still gives written questions.
//@route  POST /api/app/batches/:batchId/practice/grade-written
//@access Private (student + batchAccess + features.practice + features.aiAssist)
const gradeWrittenAttempt = asyncHandler(async (req, res) => {
  const { questionId, answerText, answerImages } = req.body;

  let question = await Question.findOne({ _id: questionId, ...batchQuestionScope(req.batch), status: "published" })
    .populate("topic", "title")
    .populate("chapter", "title");

  if (!question) {
    res.status(404);
    throw new Error("Question not found in this batch.");
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

  const hasImages = req.batch.features?.writtenAnswerImages && answerImages?.length > 0;
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
    throw new Error("This question has no marking rubric set up yet, so it can't be auto-graded.");
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
    feature: "practice-grade-written",
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

  await PracticeAttempt.create({
    student: req.student._id,
    batch: req.batch._id,
    question: question._id,
    topic: question.topic?._id,
    chapter: question.topic ? undefined : question.chapter?._id,
    answerText,
    answerImages: hasImages ? answerImages : undefined,
    marksAwarded: marks,
    isCorrect: marks >= question.marks * 0.6,
    seenCount: (await PracticeAttempt.countDocuments({ student: req.student._id, question: question._id })) + 1,
  });

  // Graded, so the printed solution comes with it, as for every other
  // question type once it's answered (and as the archive does).
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
    // Whether "Practice 5 similar" is offered for it (utils/similarSource.js).
    similar: await similarSource.offered(req.batch, question),
  });
});

//@desc   Upload one image to attach to a written practice answer — gated
//        by this batch's writtenAnswerImages toggle. No submission to
//        attach to the way an exam has (see submissionController.js's
//        version of this); the client just holds the returned url in
//        local state and sends it along with the actual grade-written
//        call above.
//@route  POST /api/app/batches/:batchId/practice/upload-answer-image
//@access Private (student + batchAccess + features.practice)
const uploadPracticeAnswerImage = asyncHandler(async (req, res) => {
  if (!req.batch.features?.writtenAnswerImages) {
    res.status(403);
    throw new Error("Image attachments are not enabled for this batch.");
  }

  if (!req.file) {
    res.status(400);
    throw new Error("No file was received.");
  }

  // A page from the in-app drawing pad is stored apart, so its url shows a
  // teacher it was drawn in the app (Grading's "Drawn in app" tag).
  const folder = req.query.drawn === "1" ? "answer-drawings" : "answer-images";
  // A photo with no camera data (a screenshot, a saved image) is marked
  // for the teacher. Drawn pages and in-app camera shots have none by
  // nature, so they're not.
  const noCamera = folder === "answer-images" && req.query.camera !== "1" && !(await hasCameraData(req.file));
  const stored = await storage.store(folder, await preparePhoto(req.file));
  await recordStudentUpload(stored.key, req.student._id, folder, { noCamera });
  const url = await storage.urlFor(stored.key, stored.driver);

  res.status(201).json({ url, noCamera });
});

//@desc   This student's own accuracy per topic in this batch, weakest
//        first — topics with too few attempts to mean anything are left
//        out rather than shown with a misleading 0% or 100%
//@route  GET /api/app/batches/:batchId/practice/weak-topics
//@access Private (student + batchAccess + features.practice)
const getWeakTopics = asyncHandler(async (req, res) => {
  const ranked = await rankWeakTopics(req.student._id, req.batch._id, { subjects: subjectIds(req.batch) });

  res.status(200).json({
    topics: ranked,
    readyForPersonalized: ranked.length > 0,
  });
});

//@desc   A practice set pulled from this student's weakest topics, mixed
//        together — the personalized alternative to picking one topic
//@route  GET /api/app/batches/:batchId/practice/personalized?limit=10
//@access Private (student + batchAccess + features.practice)
const getPersonalizedQuestions = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 10, 100);

  const ranked = await rankWeakTopics(req.student._id, req.batch._id, { subjects: subjectIds(req.batch) });

  if (ranked.length === 0) {
    res.status(200).json({ questions: [], message: "Practice a few topics first — this needs some history to know what to focus on." });
    return;
  }

  // ranked is already weakest-first across topics and chapter-pool chapters
  // together (see utils/weakTopics.js) — the top 3 overall, then split back
  // out by kind for the query below. A chapter-pool entry only ever
  // contributes questions when the batch still has that practice mode on;
  // if it was switched off after the accuracy history was built, its
  // chapter is silently dropped here rather than serving questions a
  // student can no longer otherwise reach.
  const weakest = ranked.slice(0, 3);
  const weakestTopicIds = weakest.filter((r) => !r.chapterPool).map((r) => r._id);
  const weakestChapterIds = req.batch.features?.practiceByChapter
    ? weakest.filter((r) => r.chapterPool).map((r) => r._id)
    : [];

  const filters = [];
  if (weakestTopicIds.length) filters.push({ topic: { $in: weakestTopicIds } });
  if (weakestChapterIds.length) filters.push({ chapter: { $in: weakestChapterIds }, topic: null });

  const all = filters.length
    ? await Question.find({
        ...batchQuestionScope(req.batch),
        status: "published",
        $or: filters,
        type: { $in: resolveTypes(req.batch, req.query.types) },
      })
    : [];

  if (all.length === 0) {
    res.status(200).json({ questions: [], message: "No practice questions available in your weakest topics right now." });
    return;
  }

  const attempts = await PracticeAttempt.find({
    student: req.student._id,
    question: { $in: all.map((q) => q._id) },
    isCorrect: true,
  }).select("question");
  const masteredIds = new Set(attempts.map((a) => String(a.question)));

  const fresh = all.filter((q) => !masteredIds.has(String(q._id)));
  const pool = fresh.length >= limit ? fresh : all;
  const shuffled = [...pool].sort(() => Math.random() - 0.5).slice(0, limit);

  res.status(200).json({ questions: await Promise.all(shuffled.map(forTaking)) });
});

//@desc   5 AI-generated multiple-choice questions built around whatever
//        question the student is stuck on — same skill with different
//        numbers, or the same concept from another angle. Ephemeral: not
//        saved as real questions, just returned for the modal to render.
//@route  POST /api/app/batches/:batchId/practice/similar
//@access Private (student + batchAccess + features.practice + features.aiAssist)
const getSimilarQuestions = asyncHandler(async (req, res) => {
  const { questionId } = req.body;

  const question = await Question.findOne({ _id: questionId, ...batchQuestionScope(req.batch), status: "published" })
    .populate("topic", "title")
    .populate("chapter", "title");

  if (!question) {
    res.status(404);
    throw new Error("Question not found in this batch.");
  }

  const prompt = generateSimilarQuestions({
    type: question.type,
    question: questionText(question),
    options: question.options,
    statements: question.statements,
    correctAnswer: question.type === "mcq" ? question.correctOption : question.type === "written" ? question.modelAnswer : undefined,
    solutionText: question.type === "written" ? (question.rubric || []).map((r) => r.criterion).join("; ") : undefined,
    topicTitle: question.topic?.title || question.chapter?.title,
  });

  // A saved set when the admin allows it
  // (utils/aiReuse.pro.js); background top-ups bill nobody.
  const data = await similarSource.similarFor({
    batch: req.batch, question, student: req.student._id, feature: "practice-similar",
    ai: () => aiReuse.similar({
      question, feature: "practice-similar", student: req.student._id, batch: req.batch._id,
      generate: () => aiService.generate({ feature: "practice-similar", schema: similarQuestionsSchema, student: req.student._id, batch: req.batch._id, ...prompt }),
      makeSet: () => aiService.generate({ feature: "practice-similar", schema: similarQuestionsSchema, ...prompt }),
    }),
  }).catch((e) => { if (e.statusCode) res.status(e.statusCode); throw e; });

  res.status(200).json({ questions: data.questions });
});

//@desc   Add or remove a favorite in one call — the frontend doesn't need
//        to know current state before acting, just flip it
//@route  POST /api/app/batches/:batchId/practice/favorites/:questionId
//@access Private (student + batchAccess + features.practice)
const toggleFavorite = asyncHandler(async (req, res) => {
  const question = await Question.findOne({ _id: req.params.questionId, ...batchQuestionScope(req.batch), status: "published" });
  if (!question) {
    res.status(404);
    throw new Error("Question not found in this batch.");
  }

  const existing = await PracticeFavorite.findOne({ student: req.student._id, question: question._id });
  if (existing) {
    await existing.deleteOne();
    res.status(200).json({ favorited: false });
    return;
  }

  await PracticeFavorite.create({ student: req.student._id, batch: req.batch._id, question: question._id });
  res.status(200).json({ favorited: true });
});

//@desc   Just the question ids a student has favorited in this batch — for
//        the star toggle to know its own state without pulling every
//        question in full
//@route  GET /api/app/batches/:batchId/practice/favorites/ids
//@access Private (student + batchAccess + features.practice)
const getFavoriteIds = asyncHandler(async (req, res) => {
  const favorites = await PracticeFavorite.find({ student: req.student._id, batch: req.batch._id }).select("question");
  res.status(200).json({ ids: favorites.map((f) => String(f.question)) });
});

//@desc   Favorited questions, shaped for taking — the "My favorites"
//        practice mode
//@route  GET /api/app/batches/:batchId/practice/favorites
//@access Private (student + batchAccess + features.practice)
const getFavoriteQuestions = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 10, 100);

  const favorites = await PracticeFavorite.find({ student: req.student._id, batch: req.batch._id })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate("question");

  // A favorited question can later be unpublished or removed from the
  // batch — filtered out here rather than left to error further down.
  const questions = await Promise.all(
    favorites
      .filter((f) => f.question && f.question.status === "published" && f.question.batches.some((b) => String(b) === String(req.batch._id)))
      .map((f) => forTaking(f.question))
  );

  res.status(200).json({ questions });
});

module.exports = {
  getTopics, getPracticeQuestions, submitPracticeAttempt, explainAttempt, getHint, gradeWrittenAttempt, uploadPracticeAnswerImage,
  getQna, askQna,
  getWeakTopics, getPersonalizedQuestions, getSimilarQuestions,
  toggleFavorite, getFavoriteIds, getFavoriteQuestions,
};
