const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const { latestYear } = require("../../utils/archiveSources");
const AiConfig = require("../../models/aiConfigModel");
const PredictedPaper = require("../../models/predictedPaperModel");
const ExamAuthority = require("../../models/examAuthorityModel");
const Subject = require("../../models/subjectModel");
const Topic = require("../../models/topicModel");
const Chapter = require("../../models/chapterModel");
const Exam = require("../../models/examModel");
const { Question } = require("../../models/questionModel");
const ai = require("../../ai/service");
const prompts = require("../../ai/prompts");
const schemas = require("../../ai/schemas");

// "Predicted next paper": for one board + subject, read which topics the
// archive's real past papers covered year by year, have the model weigh the
// topics for the next paper, then fill that shape with real archive
// questions plus new AI-written ones styled on each topic's real questions.
// AI questions land in Review as pending_review like any other generated
// question; the paper only becomes an Exam once they are all approved.
//
// Runs in the background (several AI calls — a prediction plus one
// generation per topic) and the detail page polls, same as document ingest.
// Unlike ingest's in-memory jobs, progress lives on the document itself.

const VALID_TYPES = ["mcq", "mtf", "written"];
const MAX_EXAMPLES = 5;
const MAX_PER_CALL = 10;

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// Largest-remainder split of `total` across weights — counts always sum to
// exactly `total`, and a zero weight always gets zero.
const allocate = (weights, total) => {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (w / sum) * total);
  const counts = raw.map(Math.floor);
  let left = total - counts.reduce((a, b) => a + b, 0);
  raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .filter(({ i }) => weights[i] > 0)
    .sort((a, b) => b.frac - a.frac)
    .forEach(({ i }) => {
      if (left > 0) {
        counts[i] += 1;
        left -= 1;
      }
    });
  return counts;
};

// Prefer recent years without always handing back the same newest questions:
// take a pool a few times larger than needed from the newest end, then shuffle.
// "Recent" is the newest year the question appeared on this paper's board.
const pickReal = (pool, need, authorityId) =>
  shuffle([...pool].sort((a, b) => latestYear(b, authorityId) - latestYear(a, authorityId)).slice(0, Math.max(need * 3, need))).slice(0, need);

const run = async (paperId, userId) => {
  const paper = await PredictedPaper.findById(paperId).populate("authority", "name").populate("subject", "title");
  const { count, realShare, types, difficulty } = paper.params;
  const warnings = [];

  const authorityId = new mongoose.Types.ObjectId(String(paper.authority._id));
  const archiveMatch = {
    "sources.authority": authorityId,
    subject: new mongoose.Types.ObjectId(String(paper.subject._id)),
    isPublic: true,
    status: "published",
    type: { $in: types },
  };

  // Topic × year table. A chapter-pool question (no topic) is grouped under
  // its chapter so it still counts.
  const rows = await Question.aggregate([
    // One row per appearance: a question that appeared on this board in
    // five different years counts once in each of those years.
    { $match: archiveMatch },
    { $unwind: "$sources" },
    { $match: { "sources.authority": authorityId } },
    { $unwind: "$sources.years" },
    { $group: { _id: { topic: "$topic", chapter: "$chapter", year: "$sources.years" }, count: { $sum: 1 } } },
  ]);

  if (rows.length === 0) {
    throw new Error("No published archive questions with a year were found for this board and subject.");
  }

  const groups = new Map();
  for (const row of rows) {
    const key = row._id.topic ? `t:${row._id.topic}` : `c:${row._id.chapter}`;
    if (!groups.has(key)) groups.set(key, { topic: row._id.topic || null, chapter: row._id.chapter, byYear: {} });
    groups.get(key).byYear[row._id.year] = (groups.get(key).byYear[row._id.year] || 0) + row.count;
  }

  const topicDocs = await Topic.find({ _id: { $in: [...groups.values()].map((g) => g.topic).filter(Boolean) } }).select("title");
  const chapterDocs = await Chapter.find({ _id: { $in: [...groups.values()].map((g) => g.chapter).filter(Boolean) } }).select("title");
  const topicTitle = new Map(topicDocs.map((t) => [String(t._id), t.title]));
  const chapterTitle = new Map(chapterDocs.map((c) => [String(c._id), c.title]));

  const list = [...groups.values()].map((g, index) => ({
    ...g,
    index,
    chapterTitle: chapterTitle.get(String(g.chapter)) || "",
    title: g.topic ? topicTitle.get(String(g.topic)) || "Untitled topic" : `${chapterTitle.get(String(g.chapter)) || "Chapter"} (chapter pool)`,
  }));
  const years = [...new Set(rows.map((r) => r._id.year))].sort((a, b) => a - b);

  const { system, prompt } = prompts.predictNextPaper({
    authorityName: paper.authority.name,
    subjectTitle: paper.subject.title,
    years,
    topics: list,
  });

  const { data } = await ai.generate({
    feature: "question_generation",
    schema: schemas.paperPrediction,
    system,
    prompt,
    maxTokens: Math.min(800 + list.length * 90, 6000),
    user: userId,
  });

  const byIndex = new Map();
  for (const t of data.topics || []) {
    if (list[t.index] && !byIndex.has(t.index)) byIndex.set(t.index, t);
  }

  // A model that returned nothing usable still leaves a sensible paper:
  // weigh topics by how often they have appeared.
  let weights = list.map((t) => byIndex.get(t.index)?.share || 0);
  if (weights.every((w) => w <= 0)) {
    warnings.push("The AI gave no usable topic weights, so topics were weighted by how often they appeared.");
    weights = list.map((t) => Object.values(t.byYear).reduce((a, b) => a + b, 0));
  }
  const perTopic = allocate(weights, count);

  const questions = [];
  const topics = [];

  for (const t of list) {
    const n = perTopic[t.index];
    const prediction = byIndex.get(t.index);

    const scope = t.topic ? { topic: t.topic } : { chapter: t.chapter, topic: null };
    const pool = n > 0 ? await Question.find({ ...archiveMatch, ...scope }).select("_id sources type question options correctOption statements") : [];

    const wantReal = Math.round(n * realShare);
    const real = pickReal(pool, Math.min(wantReal, pool.length), authorityId);
    let aiNeeded = n - real.length;

    let aiIds = [];
    if (aiNeeded > 0) {
      const examples = shuffle(pool).slice(0, MAX_EXAMPLES);
      const genTypes = [...new Set(examples.map((q) => q.type))].filter((ty) => types.includes(ty));
      const subjectTitle = paper.subject.title;
      const chTitle = t.chapterTitle || t.title;

      while (aiNeeded > 0) {
        const batch = Math.min(aiNeeded, MAX_PER_CALL);
        try {
          const gen = prompts.generateFromBank({
            examples,
            subjectTitle,
            chapterTitle: chTitle,
            topicTitle: t.topic ? t.title : "",
            count: batch,
            types: genTypes.length ? genTypes : types,
            difficulty,
          });
          const { data: out, usage } = await ai.generate({
            feature: "question_generation",
            schema: schemas.questionBatch,
            onlyTypes: genTypes.length ? genTypes : types,
            system: gen.system,
            prompt: gen.prompt,
            maxTokens: Math.min(600 * batch, 8000),
            user: userId,
          });

          const topicDoc = t.topic ? await Topic.findById(t.topic).select("chapter subject") : null;
          const created = await Question.insertMany(
            out.questions.slice(0, batch).map((q) => ({
              ...q,
              topic: t.topic || null,
              chapter: topicDoc ? topicDoc.chapter : t.chapter,
              subject: topicDoc ? topicDoc.subject : paper.subject._id,
              status: "pending_review",
              source: "ai",
              aiMeta: {
                model: usage.model,
                promptVersion: prompts.VERSION,
                sourceRef: `predicted:${paper._id}`,
              },
            })),
            { ordered: false }
          );
          aiIds = aiIds.concat(created.map((q) => q._id));
        } catch (error) {
          warnings.push(`${t.title}: could not write ${batch} new question${batch === 1 ? "" : "s"} (${error.message}).`);
        }
        aiNeeded -= batch;
      }
    }

    real.forEach((q) => questions.push({ question: q._id, origin: "real", topicIndex: topics.length }));
    aiIds.forEach((id) => questions.push({ question: id, origin: "ai", topicIndex: topics.length }));

    topics.push({
      topic: t.topic,
      chapter: t.chapter,
      title: t.title,
      likelihood: prediction?.likelihood || "low",
      share: prediction?.share || 0,
      reason: prediction?.reason || "",
      yearsSeen: years.filter((y) => t.byYear[y]).map((y) => ({ year: y, count: t.byYear[y] })),
      realCount: real.length,
      aiCount: aiIds.length,
    });
  }

  if (questions.length === 0) {
    throw new Error(warnings[0] || "No questions could be added to this paper.");
  }

  // Most likely topics first, so the paper reads like the prediction.
  const rank = { high: 0, medium: 1, low: 2 };
  const order = topics
    .map((t, i) => ({ i, r: rank[t.likelihood] ?? 3, s: t.share }))
    .sort((a, b) => a.r - b.r || b.s - a.s)
    .map(({ i }) => i);
  const position = new Map(order.map((i, pos) => [i, pos]));

  paper.summary = data.summary;
  paper.years = years;
  paper.predictedYear = years[years.length - 1] + 1;
  paper.topics = order.map((i) => topics[i]);
  paper.questions = questions
    .map((q) => ({ ...q, topicIndex: position.get(q.topicIndex) }))
    .sort((a, b) => a.topicIndex - b.topicIndex);
  paper.warnings = warnings;
  paper.status = "ready";
  await paper.save();
};

// Both ways of sharing a paper (Exam, archive set) need every AI-written
// question approved or rejected first. Rejected ones were deleted, so they
// simply drop out of `docs`.
const assertReviewed = async (paper, res) => {
  const ids = paper.questions.map((q) => q.question);
  const docs = await Question.find({ _id: { $in: ids } }).select("status marks topic");
  const byId = new Map(docs.map((d) => [String(d._id), d]));

  const pending = docs.filter((d) => d.status !== "published").length;
  if (pending > 0) {
    res.status(400);
    throw new Error(`${pending} AI-written question${pending === 1 ? " is" : "s are"} still waiting in Review. Approve or reject ${pending === 1 ? "it" : "them"} first.`);
  }
  if (docs.length === 0) {
    res.status(400);
    throw new Error("Every question on this paper was rejected.");
  }
  return { ids, docs, byId };
};

//@desc   Start a predicted-paper run (background; poll GET /:id)
//@route  POST /api/ai/predicted-paper
//@access Private
const createPredictedPaper = asyncHandler(async (req, res) => {
  const config = await AiConfig.get();
  if (!config.features.questionGeneration) {
    res.status(403);
    throw new Error("Question generation is switched off in AI settings.");
  }

  const { authority, subject, difficulty = "medium" } = req.body;
  const count = Math.round(Number(req.body.count) || 25);
  const realShare = req.body.realShare === undefined ? 0.6 : Number(req.body.realShare);
  const types = (Array.isArray(req.body.types) && req.body.types.length ? req.body.types : ["mcq"]).filter((t) => VALID_TYPES.includes(t));

  if (!authority || !subject) {
    res.status(400);
    throw new Error("Choose a board/exam and a subject.");
  }
  if (count < 5 || count > 60) {
    res.status(400);
    throw new Error("A predicted paper can have 5 to 60 questions.");
  }
  if (!(realShare >= 0 && realShare <= 1)) {
    res.status(400);
    throw new Error("The share of real questions must be between 0 and 100%.");
  }
  if (types.length === 0) {
    res.status(400);
    throw new Error("Choose at least one question type.");
  }
  if (!["easy", "medium", "hard"].includes(difficulty)) {
    res.status(400);
    throw new Error("Difficulty must be easy, medium or hard.");
  }

  const [authorityDoc, subjectDoc] = await Promise.all([
    ExamAuthority.findById(authority).select("_id"),
    Subject.findById(subject).select("_id"),
  ]);
  if (!authorityDoc || !subjectDoc) {
    res.status(404);
    throw new Error("That board/exam or subject was not found.");
  }

  const paper = await PredictedPaper.create({
    authority,
    subject,
    createdBy: req.user._id,
    params: { count, realShare, types, difficulty },
  });

  start(paper, req.user._id);
  res.status(202).json(paper);
});

// Not awaited: the page polls.
const start = (paper, userId) => {
  run(paper._id, userId).catch(async (error) => {
    await PredictedPaper.updateOne({ _id: paper._id }, { status: "failed", error: error.message });
  });
};

// A run killed by a restart stays "generating" forever; past this it counts as stuck.
const STUCK_MS = 30 * 60 * 1000;
const isStuck = (paper) => paper.status === "generating" && Date.now() - new Date(paper.updatedAt).getTime() > STUCK_MS;

// AI questions a run wrote that nobody approved yet. A failed run never
// lists them on the paper, so they are found by their sourceRef.
const dropUnapprovedAi = (paperId) =>
  Question.deleteMany({ "aiMeta.sourceRef": `predicted:${paperId}`, status: { $ne: "published" } });

//@desc   Run a failed (or stuck) predicted paper again with the same settings
//@route  POST /api/ai/predicted-paper/:id/retry
//@access Private
const retryPredictedPaper = asyncHandler(async (req, res) => {
  const config = await AiConfig.get();
  if (!config.features.questionGeneration) {
    res.status(403);
    throw new Error("Question generation is switched off in AI settings.");
  }
  const paper = await PredictedPaper.findById(req.params.id);
  if (!paper) {
    res.status(404);
    throw new Error("Predicted paper not found.");
  }
  if (paper.status !== "failed" && !isStuck(paper)) {
    res.status(400);
    throw new Error("Only a failed paper can be retried.");
  }

  await dropUnapprovedAi(paper._id);
  paper.set({ status: "generating", error: undefined, warnings: [], topics: [], questions: [], summary: undefined });
  await paper.save();
  start(paper, req.user._id);
  res.status(202).json(paper);
});

//@desc   Delete a predicted paper. Its unapproved AI questions go with it;
//        approved questions and any exam made from it stay.
//@route  DELETE /api/ai/predicted-paper/:id
//@access Private
const deletePredictedPaper = asyncHandler(async (req, res) => {
  const paper = await PredictedPaper.findById(req.params.id);
  if (!paper) {
    res.status(404);
    throw new Error("Predicted paper not found.");
  }
  if (paper.status === "generating" && !isStuck(paper)) {
    res.status(409);
    throw new Error("This paper is still being made. Wait for it to finish or fail.");
  }

  const { deletedCount } = await dropUnapprovedAi(paper._id);
  await paper.deleteOne();
  res.status(200).json({ message: "Predicted paper deleted.", questionsDeleted: deletedCount });
});

//@desc   Past predicted-paper runs
//@route  GET /api/ai/predicted-paper
//@access Private
const getPredictedPapers = asyncHandler(async (req, res) => {
  const papers = await PredictedPaper.find()
    .select("authority subject status params predictedYear createdAt updatedAt exam error sharedAsSet")
    .populate("authority", "name shortName")
    .populate("subject", "title")
    .sort({ createdAt: -1 })
    .limit(50);
  res.status(200).json({ papers });
});

//@desc   One predicted paper, with its questions and their review status
//@route  GET /api/ai/predicted-paper/:id
//@access Private
const getPredictedPaper = asyncHandler(async (req, res) => {
  const paper = await PredictedPaper.findById(req.params.id)
    .populate("authority", "name shortName")
    .populate("subject", "title")
    .populate("questions.question", "question type status sources marks options correctOption statements");

  if (!paper) {
    res.status(404);
    throw new Error("Predicted paper not found.");
  }

  const out = paper.toObject();
  // A question rejected in Review is deleted — populate leaves null behind.
  out.questions = out.questions.filter((q) => q.question);
  out.pendingReview = out.questions.filter((q) => q.question.status === "pending_review").length;
  res.status(200).json(out);
});

//@desc   Turn a ready predicted paper into a real (unpublished) Exam
//@route  POST /api/ai/predicted-paper/:id/exam
//@access Private
const createExamFromPrediction = asyncHandler(async (req, res) => {
  const paper = await PredictedPaper.findById(req.params.id)
    .populate("authority", "name shortName")
    .populate("subject", "title");

  if (!paper) {
    res.status(404);
    throw new Error("Predicted paper not found.");
  }
  if (paper.status === "exam_created" && paper.exam) {
    return res.status(200).json({ examId: paper.exam });
  }
  if (paper.status !== "ready") {
    res.status(400);
    throw new Error("This paper isn't ready yet.");
  }

  const { ids, docs, byId } = await assertReviewed(paper, res);

  // Rejected questions were deleted — keep the paper's order, minus those.
  const ordered = ids.filter((id) => byId.has(String(id)));

  const totalMarks = ordered.reduce((sum, id) => sum + (byId.get(String(id)).marks || 1), 0);
  const board = paper.authority.shortName || paper.authority.name;

  const exam = await Exam.create({
    title: `Predicted ${board} ${paper.subject.title} ${paper.predictedYear || ""}`.trim(),
    description: paper.summary,
    subjects: [paper.subject._id],
    topics: [...new Set(docs.map((d) => d.topic && String(d.topic)).filter(Boolean))],
    questions: ordered,
    batches: [],
    mode: "mock",
    durationMinutes: Math.max(10, Math.round(totalMarks)),
    source: "ai",
  });

  paper.exam = exam._id;
  paper.status = "exam_created";
  await paper.save();

  res.status(201).json({ examId: exam._id });
});

//@desc   Share (or stop sharing) a predicted paper as an archive practice set
//@route  PUT /api/ai/predicted-paper/:id/share
//@access Private
const setShared = asyncHandler(async (req, res) => {
  const paper = await PredictedPaper.findById(req.params.id);

  if (!paper) {
    res.status(404);
    throw new Error("Predicted paper not found.");
  }

  const shared = Boolean(req.body.shared);
  if (shared) {
    if (!["ready", "exam_created"].includes(paper.status)) {
      res.status(400);
      throw new Error("This paper isn't ready yet.");
    }
    await assertReviewed(paper, res);
    if (!paper.sharedAsSet) paper.sharedAt = new Date();
  }

  paper.sharedAsSet = shared;
  await paper.save();
  res.status(200).json({ sharedAsSet: paper.sharedAsSet, sharedAt: paper.sharedAt });
});

module.exports = {
  setShared,
  retryPredictedPaper,
  deletePredictedPaper,
  createPredictedPaper,
  getPredictedPapers,
  getPredictedPaper,
  createExamFromPrediction,
  // exported for tests
  allocate,
};
