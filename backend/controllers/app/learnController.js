const asyncHandler = require("express-async-handler");
const { questionText, fullQuestionText } = require("../../utils/questionText");
const mongoose = require("mongoose");
const { Question } = require("../../models/questionModel");
const Topic = require("../../models/topicModel");
const Chapter = require("../../models/chapterModel");
const LearnCard = require("../../models/learnCardModel");
const { shapeField } = require("../../utils/shapeQuestion");
const { outlineFor, chapterOrderOf } = require("../../utils/courseOutline");
const { batchQuestionScope } = require("../../utils/batchSubjects");

// Learn mode for written questions: study cards. The question shows, the
// student thinks it through, reveals the model answer and rates how it
// went. Cards come back on a Leitner schedule (models/learnCardModel.js).
// No AI. Every written question is a card. The answer shown is the
// solution, else the model answer, else none.

const DAY = 86400000;
// Days until a card in each box is due again.
const BOX_DAYS = [0, 1, 3, 7, 16, 35];

const learnable = (batch) => ({
  ...batchQuestionScope(batch),
  status: "published",
  type: "written",
});

const isDue = (card, now) => !card || new Date(card.dueAt).getTime() <= now;

//@desc   Topics (and whole chapters) that have study cards, with how many are due
//@route  GET /api/app/batches/:batchId/practice/learn/topics
//@access Private (student + batchAccess + features.practice)
const getLearnTopics = asyncHandler(async (req, res) => {
  const questions = await Question.find(learnable(req.batch)).select("topic chapter").lean();
  const cards = await LearnCard.find({ student: req.student._id, batch: req.batch._id, question: { $in: questions.map((q) => q._id) } })
    .select("question dueAt box").lean();
  const cardOf = new Map(cards.map((c) => [String(c.question), c]));
  const now = Date.now();

  const tally = new Map(); // "t:<id>" or "c:<id>" → { total, due, learned }
  for (const q of questions) {
    const key = q.topic ? `t:${q.topic}` : `c:${q.chapter}`;
    if (!tally.has(key)) tally.set(key, { total: 0, due: 0, learned: 0 });
    const t = tally.get(key);
    const card = cardOf.get(String(q._id));
    t.total += 1;
    if (isDue(card, now)) t.due += 1;
    if (card && card.box >= 3) t.learned += 1;
  }
  const ids = (prefix) => [...tally.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(2));

  const [topics, chapters] = await Promise.all([
    Topic.find({ _id: { $in: ids("t:") } }).populate("chapter", "title").select("title chapter").lean(),
    Chapter.find({ _id: { $in: ids("c:") } }).select("title").lean(),
  ]);
  const ol = await outlineFor(req.batch);
  await ol.prime({ topics: topics.map((t) => t._id), chapters: chapters.map((c) => c._id) });

  const stat = (key) => tally.get(key);
  const all = [...tally.values()];
  res.status(200).json({
    topics: topics.sort(ol.byTopic((t) => t._id)).map((t) => ({
      _id: t._id, title: t.title, chapter: t.chapter, group: ol.group(t.chapter?._id),
      questionCount: stat(`t:${t._id}`).total, ...stat(`t:${t._id}`),
    })),
    chapterPools: chapters.sort(ol.byChapter((c) => c._id)).map((c) => ({
      _id: c._id, title: c.title, group: ol.group(c._id),
      questionCount: stat(`c:${c._id}`).total, ...stat(`c:${c._id}`),
    })),
    groups: ol.groups,
    chapterOrder: chapterOrderOf(ol, topics, chapters),
    total: all.reduce((n, t) => n + t.total, 0),
    due: all.reduce((n, t) => n + t.due, 0),
    learned: all.reduce((n, t) => n + t.learned, 0),
    // When nothing is due: when the next card comes back.
    nextDueAt: cards.map((c) => new Date(c.dueAt)).filter((d) => d.getTime() > now).sort((a, b) => a - b)[0] || null,
  });
});

//@desc   Study cards for a topic, a whole chapter ("chapter:<id>"), "due" (everything due) or "all" (every card, due first)
//@route  GET /api/app/batches/:batchId/practice/learn/cards/:scope
//@access Private (student + batchAccess + features.practice)
const getLearnCards = asyncHandler(async (req, res) => {
  const { scope } = req.params;
  const match = learnable(req.batch);
  if (scope.startsWith("chapter:")) {
    const id = scope.slice(8);
    if (!mongoose.isValidObjectId(id)) { res.status(400); throw new Error("Unknown chapter."); }
    Object.assign(match, { chapter: id, topic: null });
  } else if (scope !== "due" && scope !== "all") {
    if (!mongoose.isValidObjectId(scope)) { res.status(400); throw new Error("Unknown topic."); }
    match.topic = scope;
  }

  const questions = await Question.find(match)
    .select("question questionImage modelAnswer solutionText solutionImage solutionVideo solutionAttachments rubric marks topic chapter")
    .populate(["questionImage", "solutionImage", "solutionVideo", "solutionAttachments"])
    .populate("topic", "title")
    .populate("chapter", "title")
    .lean();
  const cards = await LearnCard.find({ student: req.student._id, batch: req.batch._id, question: { $in: questions.map((q) => q._id) } }).lean();
  const cardOf = new Map(cards.map((c) => [String(c.question), c]));
  const now = Date.now();

  // Due cards first (oldest due first, new ones after reviews), then the
  // rest by when they come due, so a topic can always be gone through.
  const rows = questions
    .map((q) => ({ q, card: cardOf.get(String(q._id)) || null }))
    .filter((r) => scope !== "due" || isDue(r.card, now));
  const rank = (r) => (isDue(r.card, now) ? (r.card ? 0 : 1) : 2);
  rows.sort((a, b) => rank(a) - rank(b) || new Date(a.card?.dueAt || 0) - new Date(b.card?.dueAt || 0));

  res.status(200).json({
    cards: await Promise.all(rows.map(async ({ q, card }) => ({
      _id: q._id,
      question: questionText(q),
      questionImage: await shapeField(q.questionImage),
      modelAnswer: q.modelAnswer,
      solutionText: q.solutionText,
      solutionImage: await shapeField(q.solutionImage),
      solutionVideo: await shapeField(q.solutionVideo),
      solutionAttachments: await Promise.all((q.solutionAttachments || []).map(shapeField)),
      keyPoints: (q.rubric || []).map((r) => ({ criterion: r.criterion, marks: r.marks })),
      marks: q.marks,
      where: q.topic?.title || q.chapter?.title || "",
      box: card?.box ?? null,
      due: isDue(card, now),
      dueAt: card?.dueAt || null,
    }))),
  });
});

//@desc   Rate a study card: again, partly or good
//@route  POST /api/app/batches/:batchId/practice/learn/cards/:questionId/rate
//@access Private (student + batchAccess + features.practice)
const rateLearnCard = asyncHandler(async (req, res) => {
  const { rating } = req.body || {};
  if (!["again", "partly", "good"].includes(rating)) { res.status(400); throw new Error("Rate it again, partly or good."); }
  if (!mongoose.isValidObjectId(req.params.questionId)) { res.status(400); throw new Error("Unknown question."); }
  const question = await Question.exists({ _id: req.params.questionId, ...learnable(req.batch) });
  if (!question) { res.status(404); throw new Error("That card isn't in this batch."); }

  const key = { student: req.student._id, batch: req.batch._id, question: req.params.questionId };
  const card = (await LearnCard.findOne(key)) || new LearnCard(key);
  // again: back to the start, seen again in ten minutes. partly: same box,
  // back tomorrow. good: up a box.
  if (rating === "again") card.box = 0;
  else if (rating === "good") card.box = Math.min(5, (card.box || 0) + 1);
  const wait = rating === "again" ? 10 * 60000 : rating === "partly" ? DAY : BOX_DAYS[card.box] * DAY;
  card.dueAt = new Date(Date.now() + wait);
  card.lastRating = rating;
  card.reviews = (card.reviews || 0) + 1;
  await card.save();
  res.status(200).json({ box: card.box, dueAt: card.dueAt });
});

module.exports = { getLearnTopics, getLearnCards, rateLearnCard };
