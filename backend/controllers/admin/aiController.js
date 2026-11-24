const asyncHandler = require("express-async-handler");
const { questionText, fullQuestionText } = require("../../utils/questionText");
const { shape: shapeMedia } = require("./mediaController");
const AiConfig = require("../../models/aiConfigModel");
const AiUsage = require("../../models/aiUsageModel");
const Topic = require("../../models/topicModel");
const Chapter = require("../../models/chapterModel");
const { Question } = require("../../models/questionModel");
const QuestionAudit = require("../../models/questionAuditModel");
const ai = require("../../ai/service");
const schemas = require("../../ai/schemas");
const prompts = require("../../ai/prompts");
const { isGradingCapable } = require("./aiConfigController");

//@desc   Generate questions from text
//@route  POST /api/ai/generate-questions
//@access Private
const generateQuestions = asyncHandler(async (req, res) => {
  const config = await AiConfig.get();

  if (!config.features.questionGeneration) {
    res.status(403);
    throw new Error("Question generation is switched off in AI settings.");
  }

  const { topicId, chapterId, sourceText, count = 5, types = ["mcq"], difficulty = "medium", language } = req.body;

  if (!sourceText || String(sourceText).trim().length < 50) {
    res.status(400);
    throw new Error("Provide at least a paragraph of source material to generate from.");
  }

  if (count > 20) {
    res.status(400);
    throw new Error("Generate at most 20 questions at a time.");
  }

  if (topicId && chapterId) {
    res.status(400);
    throw new Error("Choose a topic or a chapter, not both.");
  }
  if (!topicId && !chapterId) {
    res.status(400);
    throw new Error("Choose a topic, or a chapter for the chapter pool.");
  }
  // A passage question can only ever be chapter-pool — same rule as a
  // single question's resolveFiling (questionController.js) and both bulk
  // import paths. Generating it topic-anchored would produce a batch the
  // server would then refuse to save.
  if (types.includes("passage") && topicId) {
    res.status(400);
    throw new Error("Passage questions can only be filed under a chapter, not a topic — choose a chapter to generate them.");
  }

  // Filing every generated question under a topic, or (chapter pool) a
  // chapter directly — same two paths bulkCreateQuestions resolves, just
  // for the whole generated batch rather than per row.
  let topic = null;
  let chapter = null;
  if (topicId) {
    topic = await Topic.findById(topicId)
      .populate("chapter", "title")
      .populate("subject", "title");
    if (!topic) {
      res.status(404);
      throw new Error("Topic not found.");
    }
  } else {
    chapter = await Chapter.findById(chapterId).populate("subject", "title");
    if (!chapter) {
      res.status(404);
      throw new Error("Chapter not found.");
    }
  }

  const { system, prompt } = prompts.generateQuestions({
    sourceText: String(sourceText).slice(0, 12000),
    // Blank rather than omitted when generating for the chapter pool — the
    // prompt itself drops the "Topic:" line entirely when this is empty
    // (see ai/prompts/index.js), rather than sending a topic name that
    // doesn't exist for these questions.
    topicTitle: topic ? topic.title : "",
    chapterTitle: topic ? topic.chapter.title : chapter.title,
    subjectTitle: topic ? topic.subject.title : chapter.subject.title,
    count,
    types,
    difficulty,
    language,
  });

  const { data, usage, attempts } = await ai.generate({
    feature: "question_generation",
    schema: schemas.questionBatch,
    // Only the types asked for, so the grammar the model is constrained by
    // does not also cover branches nobody wanted.
    onlyTypes: types,
    system,
    prompt,
    maxTokens: Math.min(600 * count, 8000),
    user: req.user._id,
  });

  // Generated questions land as pending_review. Nothing a model wrote reaches
  // a student without a person approving it.
  const created = await Question.insertMany(
    data.questions.map((q) => ({
      ...q,
      // insertMany skips document middleware entirely, so a generated
      // passage never runs the model's own pre("validate") hook that sums
      // subQuestions into marks (same gap bulkCreateQuestions/
      // importQuestionsFromFile hit, see questionController.js) —
      // reproduced here rather than left to insertMany.
      ...(q.type === "passage" && {
        marks: (q.subQuestions || []).reduce((sum, sq) => sum + (Number(sq.marks) || 0), 0),
      }),
      topic: topic ? topic._id : null,
      chapter: topic ? topic.chapter._id : chapter._id,
      subject: topic ? topic.subject._id : chapter.subject._id,
      status: "pending_review",
      source: "ai",
      aiMeta: {
        model: usage.model,
        promptVersion: prompts.VERSION,
        sourceRef: String(sourceText).slice(0, 120),
      },
    })),
    { ordered: false }
  );

  res.status(201).json({
    message: `Generated ${created.length} question${created.length === 1 ? "" : "s"} for review.`,
    questions: created,
    attempts,
    tokens: usage.promptTokens + usage.completionTokens,
  });
});

//@desc   Generate new questions styled after a curated set of real ones
//        ("bank" questions) — a style/format anchor, not a source excerpt.
//        The output is new content, never a copy of the examples: useful
//        for expanding an archive topic beyond what real past papers cover,
//        without reproducing anyone's copyrighted exam text verbatim.
//@route  POST /api/ai/generate-from-bank
//@access Private
const generateFromBank = asyncHandler(async (req, res) => {
  const config = await AiConfig.get();

  if (!config.features.questionGeneration) {
    res.status(403);
    throw new Error("Question generation is switched off in AI settings.");
  }

  const { exampleQuestionIds, topicId, chapterId, count = 5, types = ["mcq"], difficulty = "medium", language } = req.body;

  if (!Array.isArray(exampleQuestionIds) || exampleQuestionIds.length === 0) {
    res.status(400);
    throw new Error("Select at least one example question to model new ones on.");
  }
  if (exampleQuestionIds.length > 10) {
    res.status(400);
    throw new Error("Select at most 10 example questions.");
  }
  if (count > 20) {
    res.status(400);
    throw new Error("Generate at most 20 questions at a time.");
  }
  if (topicId && chapterId) {
    res.status(400);
    throw new Error("Choose a topic or a chapter, not both.");
  }
  if (!topicId && !chapterId) {
    res.status(400);
    throw new Error("Choose a topic, or a chapter for the chapter pool.");
  }
  if (types.includes("passage") && topicId) {
    res.status(400);
    throw new Error("Passage questions can only be filed under a chapter, not a topic — choose a chapter to generate them.");
  }

  const examples = await Question.find({ _id: { $in: exampleQuestionIds } }).select("type question options correctOption statements");
  if (examples.length === 0) {
    res.status(404);
    throw new Error("None of the selected example questions could be found.");
  }

  let topic = null;
  let chapter = null;
  if (topicId) {
    topic = await Topic.findById(topicId)
      .populate("chapter", "title")
      .populate("subject", "title");
    if (!topic) {
      res.status(404);
      throw new Error("Topic not found.");
    }
  } else {
    chapter = await Chapter.findById(chapterId).populate("subject", "title");
    if (!chapter) {
      res.status(404);
      throw new Error("Chapter not found.");
    }
  }

  const { system, prompt } = prompts.generateFromBank({
    examples,
    subjectTitle: topic ? topic.subject.title : chapter.subject.title,
    chapterTitle: topic ? topic.chapter.title : chapter.title,
    topicTitle: topic ? topic.title : "",
    count,
    types,
    difficulty,
    language,
  });

  const { data, usage, attempts } = await ai.generate({
    feature: "question_generation",
    schema: schemas.questionBatch,
    onlyTypes: types,
    system,
    prompt,
    maxTokens: Math.min(600 * count, 8000),
    user: req.user._id,
  });

  const created = await Question.insertMany(
    data.questions.map((q) => ({
      ...q,
      ...(q.type === "passage" && {
        marks: (q.subQuestions || []).reduce((sum, sq) => sum + (Number(sq.marks) || 0), 0),
      }),
      topic: topic ? topic._id : null,
      chapter: topic ? topic.chapter._id : chapter._id,
      subject: topic ? topic.subject._id : chapter.subject._id,
      status: "pending_review",
      source: "ai",
      aiMeta: {
        model: usage.model,
        promptVersion: prompts.VERSION,
        // Provenance: which real questions this batch was styled on, not a
        // source excerpt — same field generateQuestions uses for its own
        // provenance, just a different shape of reference.
        sourceRef: `bank:${examples.map((e) => e._id).join(",")}`,
      },
    })),
    { ordered: false }
  );

  res.status(201).json({
    message: `Generated ${created.length} question${created.length === 1 ? "" : "s"} for review.`,
    questions: created,
    attempts,
    tokens: usage.promptTokens + usage.completionTokens,
  });
});

//@desc   Write a model answer and rubric for a written question under a
//        passage, for the question editor
//@route  POST /api/ai/model-answer { passage, question, marks }
//@access Private
const writeModelAnswer = asyncHandler(async (req, res) => {
  const config = await AiConfig.get();
  if (!config.features.solutionBackfill) {
    res.status(403);
    throw new Error("Writing solutions with AI is switched off in AI settings.");
  }
  const { passage = "", question = "", marks = 1 } = req.body || {};
  if (!String(question).trim()) {
    res.status(400);
    throw new Error("Write the question first.");
  }
  const { system, prompt } = prompts.writeModelAnswer({ passage: String(passage).slice(0, 6000), question: String(question).slice(0, 2000), marks: Number(marks) || 1 });
  const { data } = await ai.generate({
    feature: "solution_backfill",
    schema: require("zod").z.object({
      modelAnswer: require("zod").z.string().min(1),
      rubric: require("zod").z.array(require("zod").z.object({ criterion: require("zod").z.string().min(1), marks: require("zod").z.number().min(0) })).min(1).max(6),
    }),
    system,
    prompt,
    maxTokens: 1200,
    user: req.user._id,
  });
  res.status(200).json(data);
});

// A coding solution is written in Python when it's allowed, else the first
// allowed language, by its display name (C++, not cpp).
const solutionLanguage = (languages = []) => {
  const { LANGUAGES } = require("../../utils/codeRunner");
  const key = languages.includes("python") ? "python" : languages[0] || "python";
  return LANGUAGES[key]?.label || key;
};

// "idea" then the program in a code block. A model that wrapped the code in
// fences anyway has them taken off first, so there is exactly one block.
const codingSolutionText = ({ idea, code }, languages = []) => {
  const key = languages.includes("python") ? "python" : languages[0] || "";
  const body = String(code).trim().replace(/^```[\w+#.-]*[^\S\n]*\n?/, "").replace(/\n?```\s*$/, "").trim();
  if (!body) throw new Error("The AI didn't write the code. Try again.");
  return `${String(idea || "").trim()}\n\n\`\`\`${key}\n${body}\n\`\`\``.trim();
};

//@desc   Starter code for a coding question, for the question editor: reads
//        the input, leaves the solving to the student
//@route  POST /api/ai/coding-starter { question, languages, tests }
//@access Private
const writeCodingStarter = asyncHandler(async (req, res) => {
  const config = await AiConfig.get();
  if (!config.features.solutionBackfill) {
    res.status(403);
    throw new Error("Writing solutions with AI is switched off in AI settings.");
  }
  const { LANGUAGES } = require("../../utils/codeRunner");
  const { question = "", tests = [] } = req.body || {};
  const languages = (Array.isArray(req.body?.languages) ? req.body.languages : []).filter((l) => LANGUAGES[l]).slice(0, 12);
  if (!String(question).trim()) {
    res.status(400);
    throw new Error("Write the question first.");
  }
  if (!languages.length) {
    res.status(400);
    throw new Error("Pick at least one language first.");
  }
  const z = require("zod").z;
  const { system, prompt } = prompts.codingStarter({
    question: String(question).slice(0, 4000),
    languages,
    tests: (Array.isArray(tests) ? tests : []).slice(0, 3).map((t) => ({ input: String(t?.input || "").slice(0, 1000), output: String(t?.output || "").slice(0, 1000), hidden: Boolean(t?.hidden) })),
  });
  const { data } = await ai.generate({
    feature: "coding_starter",
    schema: z.object({ starterCode: z.array(z.object({ language: z.string(), code: z.string() })).min(1) }),
    system,
    prompt,
    maxTokens: 400 + 350 * languages.length,
    user: req.user._id,
  });
  const starterCode = data.starterCode
    .map((s) => ({ language: String(s.language).toLowerCase().replace("c++", "cpp").replace("c#", "csharp"), code: s.code }))
    .filter((s) => languages.includes(s.language) && s.code.trim());
  res.status(200).json({ starterCode });
});

//@desc   Write solutions for questions that have none
//@route  POST /api/ai/backfill-solutions
//@access Private
const backfillSolutions = asyncHandler(async (req, res) => {
  const config = await AiConfig.get();

  if (!config.features.solutionBackfill) {
    res.status(403);
    throw new Error("Solution backfill is switched off in AI settings.");
  }

  const { questionIds } = req.body;

  if (!Array.isArray(questionIds) || questionIds.length === 0) {
    res.status(400);
    throw new Error("Send the ids of the questions to backfill.");
  }

  if (questionIds.length > 25) {
    res.status(400);
    throw new Error("Backfill at most 25 questions at a time.");
  }

  const questions = await Question.find({ _id: { $in: questionIds } })
    .populate("topic", "title")
    .populate("subject", "title");

  const written = [];
  const failed = [];

  // Sequential rather than parallel: a burst of concurrent requests trips rate
  // limits on hosted providers and exhausts context on local ones.
  for (const question of questions) {
    try {
      const { system, prompt } = prompts.writeSolution({
        question: fullQuestionText(question, { withAnswers: true }),
        options: question.options,
        correctOption: question.correctOption,
        passage: question.type === "passage",
        subjectTitle: question.subject ? question.subject.title : "",
        topicTitle: question.topic ? question.topic.title : "",
        matchLanguage: config.languages?.solutions !== false,
        coding: question.type === "coding" ? { language: solutionLanguage(question.languages), tests: question.tests } : null,
      });

      const isCoding = question.type === "coding";
      const { data: raw } = await ai.generate({
        feature: "solution_backfill",
        schema: isCoding ? schemas.codingSolution : schemas.solution,
        system,
        prompt,
        maxTokens: question.type === "passage" ? 2000 : question.type === "coding" ? 2500 : 400,
        user: req.user._id,
      });
      const data = isCoding ? { solutionText: codingSolutionText(raw, question.languages) } : raw;

      // Lands in pendingSolutionText, not solutionText. A question can
      // already be published — a model writing straight onto what students
      // see, with no person in between, is exactly what the review queue
      // exists to prevent for freshly generated questions, and a solution is
      // no different.
      question.pendingSolutionText = data.solutionText;
      question.solutionStatus = "pending_review";
      question.aiMeta = {
        ...(question.aiMeta || {}),
        model: config.model,
        promptVersion: prompts.VERSION,
      };
      await question.save();

      written.push({ _id: question._id, pendingSolutionText: data.solutionText });
    } catch (error) {
      failed.push({ _id: question._id, reason: error.message });
    }
  }

  res.status(200).json({
    message: `Wrote ${written.length} solution${written.length === 1 ? "" : "s"} for review.`,
    written,
    failed,
  });
});

//@desc   Classify skillType for questions that have none
//@route  POST /api/ai/backfill-skill-types
//@access Private
const backfillSkillTypes = asyncHandler(async (req, res) => {
  const config = await AiConfig.get();

  if (!config.features.skillTypeBackfill) {
    res.status(403);
    throw new Error("AI skill classification is switched off in AI settings.");
  }

  const { questionIds } = req.body;

  if (!Array.isArray(questionIds) || questionIds.length === 0) {
    res.status(400);
    throw new Error("Send the ids of the questions to classify.");
  }

  if (questionIds.length > 25) {
    res.status(400);
    throw new Error("Classify at most 25 questions at a time.");
  }

  const questions = await Question.find({ _id: { $in: questionIds } })
    .populate("topic", "title")
    .populate("subject", "title");

  const written = [];
  const failed = [];

  // Sequential, same reasoning as backfillSolutions above — a burst of
  // concurrent calls trips rate limits on hosted providers.
  for (const question of questions) {
    try {
      const { system, prompt } = prompts.classifySkillType({
        question: fullQuestionText(question, { withAnswers: true }),
        options: question.options,
        statements: question.statements,
        correctOption: question.correctOption,
        subjectTitle: question.subject ? question.subject.title : "",
        topicTitle: question.topic ? question.topic.title : "",
      });

      const { data } = await ai.generate({
        feature: "skill_type_backfill",
        schema: schemas.skillTypeSuggestion,
        system,
        prompt,
        maxTokens: 60,
        user: req.user._id,
      });

      // Written straight onto the live field, unlike backfillSolutions'
      // pendingSolutionText — a skillType tag is an internal taxonomy label
      // an admin filters/reads by, not content shown to a student, and it's
      // a one-click re-run to fix if wrong. No review queue needed for that.
      question.skillType = data.skillType;
      question.aiMeta = {
        ...(question.aiMeta || {}),
        model: config.model,
        promptVersion: prompts.VERSION,
      };
      await question.save();

      written.push({ _id: question._id, skillType: data.skillType });
    } catch (error) {
      failed.push({ _id: question._id, reason: error.message });
    }
  }

  res.status(200).json({
    message: `Classified ${written.length} question${written.length === 1 ? "" : "s"}.`,
    written,
    failed,
  });
});

// A rewritten question text cut back to this question's own field.
const ownText = (question, text) => {
  let t = String(text);
  if (question.type === "passage") t = t.split(/\n+\s*Questions on this passage:/)[0];
  if (question.context) {
    const ctx = question.context.trim();
    const at = t.indexOf(ctx);
    if (at >= 0) t = t.slice(at + ctx.length);
    else {
      // The stem came back edited: drop everything up to the part's label.
      const label = question.partLabel ? `(${question.partLabel})` : null;
      const cut = label ? t.indexOf(label) : -1;
      if (cut >= 0) t = t.slice(cut);
    }
    t = t.trim();
    if (question.partLabel && t.startsWith(`(${question.partLabel})`)) t = t.slice(question.partLabel.length + 2);
  }
  return t.trim() || question.question;
};

//@desc   Review a question for errors
//@route  POST /api/ai/review-question/:id
//@access Private
const reviewQuestion = asyncHandler(async (req, res) => {
  const config = await AiConfig.get();

  if (!config.features.qualityChecks) {
    res.status(403);
    throw new Error("Quality checks are switched off in AI settings.");
  }

  const question = await Question.findById(req.params.id);

  if (!question) {
    res.status(404);
    throw new Error("Question not found.");
  }

  const { system, prompt } = prompts.reviewQuestion({
    question: fullQuestionText(question, { withAnswers: true }),
    type: question.type,
    options: question.options,
    correctOption: question.correctOption,
    statements: question.statements,
    solutionText: question.solutionText,
    difficulty: question.difficulty,
    skillType: question.skillType,
  });

  const { data } = await ai.generate({
    feature: "quality_check",
    schema: schemas.qualityReview,
    system,
    prompt,
    maxTokens: 600,
    user: req.user._id,
  });

  // The AI saw the whole question (a part's stem in front of it, a passage
  // with its questions after it); a fix to the text must be this question's
  // own text only, or applying it copies the rest in.
  if (data.fix?.question) data.fix.question = ownText(question, data.fix.question);

  res.status(200).json({
    questionId: question._id,
    ...data,
    // The model reviews; it never edits. A flagged question is a prompt for a
    // person to look, not an instruction to change anything — applying the
    // fix goes through the normal updateQuestion endpoint, same as
    // QuestionAudit.jsx's pool-audit fixes.
    clean: data.issues.length === 0,
  });
});

// One call's worth of questions is capped rather than chunked — chunking
// would mean duplicate detection only ever sees one chunk at a time and
// misses a pair split across chunks. A topic or one chapter's pool rarely
// exceeds this in practice; when it does, the response says so and an admin
// narrows the filter (by topic, or by a search term first) rather than the
// server silently doing a partial, misleading pass.
const MAX_AUDIT_POOL = 60;

//@desc   Reviews every question in a topic or chapter pool at once — flags
//        errors (with an optional fix) the same way reviewQuestion does per
//        question, plus near-duplicate groups only visible with the whole
//        pool in view together. Reviews only; nothing is written until an
//        admin applies a fix through the normal question-edit endpoint.
//@route  POST /api/ai/audit-pool
//@access Private
const auditQuestionPool = asyncHandler(async (req, res) => {
  const config = await AiConfig.get();

  if (!config.features.qualityChecks) {
    res.status(403);
    throw new Error("Quality checks are switched off in AI settings.");
  }

  const { chapter, topic, questionIds } = req.body;
  // A hand-picked selection (the bank's own checkbox multi-select) is a
  // third way to scope an audit, alongside a topic or a chapter pool — the
  // same three grains Questions.jsx already lets an admin filter or select
  // by, so this doesn't introduce a new mental model, just a new entry
  // point into the same endpoint.
  const hasSelection = Array.isArray(questionIds) && questionIds.length > 0;
  if (!chapter && !topic && !hasSelection) {
    res.status(400);
    throw new Error("Choose a topic, a chapter pool, or select specific questions to audit.");
  }

  // Rejected questions are dead weight here — a duplicate of a rejected
  // question isn't a real duplicate, and a wrong-answer flag on one nobody
  // will ever assign helps no one. Applies to a manual selection too: a
  // rejected id in the selection is silently dropped rather than audited.
  let query;
  if (hasSelection) {
    query = { _id: { $in: questionIds }, status: { $ne: "rejected" } };
  } else {
    // Same "chapter=<id> + topic=none" convention as getReviewQueue/
    // getQuestions above.
    const filing = {};
    if (chapter) filing.chapter = chapter;
    if (topic === "none") filing.topic = null;
    else if (topic) filing.topic = topic;
    query = { ...filing, status: { $ne: "rejected" }, ...Question.IN_BANK };
  }

  const totalInPool = await Question.countDocuments(query);
  if (totalInPool === 0) {
    const empty = await QuestionAudit.create({
      chapter: hasSelection ? undefined : chapter || undefined,
      topic: hasSelection ? undefined : topic === "none" ? "none" : topic || undefined,
      selectionCount: hasSelection ? questionIds.length : undefined,
      createdBy: req.user._id,
      reviewed: 0,
      totalInPool: 0,
      truncated: false,
      issues: [],
      duplicateGroups: [],
    });
    return res.status(200).json(empty);
  }

  const pool = await Question.find(query)
    .select("question type options correctOption statements difficulty")
    .limit(MAX_AUDIT_POOL);
  const truncated = totalInPool > MAX_AUDIT_POOL;

  const { system, prompt } = prompts.auditQuestionPool({
    questions: pool.map((q, index) => ({
      index,
      type: q.type,
      question: questionText(q),
      options: q.options,
      correctOption: q.correctOption,
      statements: q.statements,
      difficulty: q.difficulty,
    })),
  });

  const { data } = await ai.generate({
    feature: "quality_check",
    schema: schemas.poolAudit,
    system,
    prompt,
    // Each flagged issue can carry a full rewrite (question + options) —
    // 50 tokens a question cut small selections off mid-JSON every time.
    maxTokens: Math.min(1500 + pool.length * 250, 8000),
    user: req.user._id,
  });

  // The model only ever saw a numbered list, never a Mongo _id — resolved
  // back here, and anything out of range (a hallucinated index) is dropped
  // rather than trusted.
  const at = (i) => pool[i];

  const issues = (data.issues || [])
    .filter((issue) => at(issue.index))
    .map((issue) => ({
      questionId: at(issue.index)._id,
      preview: at(issue.index).question,
      type: at(issue.index).type,
      kind: issue.kind,
      severity: issue.severity,
      detail: issue.detail,
      fix: issue.fix || null,
    }));

  const duplicateGroups = (data.duplicateGroups || [])
    .map((group) => ({
      reason: group.reason,
      questions: [...new Set(group.indices)]
        .filter((i) => at(i))
        .map((i) => ({ _id: at(i)._id, question: at(i).question, type: at(i).type })),
    }))
    .filter((group) => group.questions.length >= 2);

  // Persisted rather than handed straight back — this is what lets the
  // frontend send the admin to a dedicated results page (audit-pool/:id)
  // instead of holding the run in component state, where a reload or an
  // accidental navigation away would throw away a run that already cost a
  // real AI call.
  const audit = await QuestionAudit.create({
    chapter: hasSelection ? undefined : chapter || undefined,
    topic: hasSelection ? undefined : topic === "none" ? "none" : topic || undefined,
    selectionCount: hasSelection ? questionIds.length : undefined,
    createdBy: req.user._id,
    reviewed: pool.length,
    totalInPool,
    truncated,
    issues,
    duplicateGroups,
  });

  res.status(200).json(audit);
});

//@desc   A previously run audit, by id — how the results page survives a
//        reload instead of holding the run only in component state.
//@route  GET /api/ai/audit-pool/:id
//@access Private
const getAuditPool = asyncHandler(async (req, res) => {
  const audit = await QuestionAudit.findById(req.params.id).populate("chapter", "title");

  if (!audit) {
    res.status(404);
    throw new Error("Audit not found.");
  }

  // topic is stored as Mixed (a real id, the literal "none", or unset — see
  // questionAuditModel.js), so it can't carry a schema `ref` for populate to
  // use. Resolved by hand, and only when it's actually an id to look up.
  let topicTitle = null;
  if (audit.topic && audit.topic !== "none") {
    const topicDoc = await Topic.findById(audit.topic).select("title");
    topicTitle = topicDoc?.title || null;
  }

  res.status(200).json({ ...audit.toObject(), topicTitle });
});

//@desc   Marks one issue or duplicate group as decided (applied/dismissed),
//        so that decision survives a reload too — mirrors the review
//        queue's decide-by-id pattern, just written onto the audit document
//        itself instead of onto the question.
//@route  PUT /api/ai/audit-pool/:id
//@access Private
const auditPoolDecision = asyncHandler(async (req, res) => {
  const { itemType, index, status } = req.body;

  if (!["issue", "duplicate"].includes(itemType)) {
    res.status(400);
    throw new Error("itemType must be 'issue' or 'duplicate'.");
  }
  const validStatuses = itemType === "issue" ? ["open", "applied", "dismissed"] : ["open", "dismissed"];
  if (!validStatuses.includes(status)) {
    res.status(400);
    throw new Error(`status must be one of: ${validStatuses.join(", ")}.`);
  }

  const audit = await QuestionAudit.findById(req.params.id);
  if (!audit) {
    res.status(404);
    throw new Error("Audit not found.");
  }

  const list = itemType === "issue" ? audit.issues : audit.duplicateGroups;
  const item = list[index];
  if (!item) {
    res.status(404);
    throw new Error("No such item in this audit.");
  }
  item.status = status;
  await audit.save();

  res.status(200).json(audit);
});

//@desc   Every audit run that still has an undecided issue or duplicate
//        group — the permanent queue behind the sidebar's "Audits" badge,
//        same idea as the Review queue's badge: it stays until each item
//        is applied or dismissed, not until the tab that ran it is still
//        open. Opening a flagged question and navigating back no longer
//        loses anything, because this list is what "still needs a look" was
//        always meant to be, not the one run currently on screen.
//@route  GET /api/ai/audit-pool?page=&limit=
//@access Private
const getOpenAudits = asyncHandler(async (req, res) => {
  const query = { $or: [{ "issues.status": "open" }, { "duplicateGroups.status": "open" }] };
  const page = Number(req.query.page) || 1;
  const limit = Math.min(Number(req.query.limit) || 30, 100);

  const [audits, total, sumAgg] = await Promise.all([
    QuestionAudit.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("chapter", "title"),
    QuestionAudit.countDocuments(query),
    // The sidebar badge (Shell.jsx) needs the true open-issue count across
    // every audit, not just whichever page is currently being viewed — a
    // sum computed from the paginated list above would silently shrink to
    // "however many happen to be on this page" the moment there's more
    // than one page of open audits.
    QuestionAudit.aggregate([
      { $match: query },
      {
        $project: {
          openIssues: { $size: { $filter: { input: "$issues", as: "i", cond: { $eq: ["$$i.status", "open"] } } } },
          openDuplicateGroups: { $size: { $filter: { input: "$duplicateGroups", as: "g", cond: { $eq: ["$$g.status", "open"] } } } },
        },
      },
      { $group: { _id: null, sum: { $sum: { $add: ["$openIssues", "$openDuplicateGroups"] } } } },
    ]),
  ]);

  // topic is Mixed (see questionAuditModel.js), so it carries no schema ref
  // for populate to use — resolved by hand, and batched into one query
  // rather than one findById per audit in the list.
  const topicIds = audits.map((a) => a.topic).filter((t) => t && t !== "none");
  const topics = topicIds.length
    ? await Topic.find({ _id: { $in: topicIds } }).select("title")
    : [];
  const topicTitleById = new Map(topics.map((t) => [String(t._id), t.title]));

  const result = audits.map((audit) => ({
    _id: audit._id,
    chapter: audit.chapter,
    topic: audit.topic,
    topicTitle: audit.topic && audit.topic !== "none" ? topicTitleById.get(String(audit.topic)) || null : null,
    selectionCount: audit.selectionCount,
    createdAt: audit.createdAt,
    openIssues: audit.issues.filter((i) => i.status === "open").length,
    openDuplicateGroups: audit.duplicateGroups.filter((g) => g.status === "open").length,
  }));

  res.status(200).json({
    audits: result,
    total,
    page,
    pages: Math.ceil(total / limit),
    openItemsTotal: sumAgg[0]?.sum || 0,
  });
});

//@desc   Questions waiting for a person to approve them
//@route  GET /api/ai/review-queue
//@access Private
const getReviewQueue = asyncHandler(async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Math.min(Number(req.query.limit) || 20, 100);

  // Same "chapter=<id> + topic=none" convention as questionController's
  // getQuestions — { topic: null } matches every chapter-pool question
  // under that chapter, since chapter-pool questions never carry a topic.
  const filing = {};
  if (req.query.chapter) filing.chapter = req.query.chapter;
  if (req.query.topic === "none") filing.topic = null;
  else if (req.query.topic) filing.topic = req.query.topic;

  const query = { status: "pending_review", ...filing };

  // A question that already published can still get an AI solution proposed
  // for it later — that does not go through `status`, so it is fetched
  // separately here rather than missed entirely. Its own page/limit
  // (solutionsPage/solutionsLimit) rather than sharing `page`/`limit` above
  // — the two lists scroll independently in the UI, so paging one should
  // never silently move the other.
  const solutionQuery = { solutionStatus: "pending_review", ...filing };
  const solutionsPage = Number(req.query.solutionsPage) || 1;
  const solutionsLimit = Math.min(Number(req.query.solutionsLimit) || 30, 100);

  const [questions, total, solutions, solutionsTotal] = await Promise.all([
    Question.find(query)
      .populate("topic", "title")
      .populate("chapter", "title")
      // Figures cut out of a document are part of what a reviewer checks.
      .populate("questionImage")
      .populate("solutionImage")
      .populate("options.image")
      .sort({ createdAt: 1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Question.countDocuments(query),
    Question.find(solutionQuery)
      .populate("topic", "title")
      .populate("chapter", "title")
      .sort({ updatedAt: 1 })
      .skip((solutionsPage - 1) * solutionsLimit)
      .limit(solutionsLimit),
    Question.countDocuments(solutionQuery),
  ]);

  // Media documents hold a storage key, not a url — resolved here, the same
  // way questionController's list does.
  const withImages = await Promise.all(
    questions.map(async (q) => {
      const doc = q.toObject();
      if (doc.questionImage) doc.questionImage = await shapeMedia(doc.questionImage);
      if (doc.solutionImage) doc.solutionImage = await shapeMedia(doc.solutionImage);
      if (Array.isArray(doc.options)) {
        doc.options = await Promise.all(
          doc.options.map(async (o) => ({ ...o, image: o.image ? await shapeMedia(o.image) : null }))
        );
      }
      return doc;
    })
  );

  res.status(200).json({
    questions: withImages,
    total,
    page,
    pages: Math.ceil(total / limit),
    solutions,
    solutionsTotal,
    solutionsPage,
    solutionsPages: Math.ceil(solutionsTotal / solutionsLimit),
  });
});

//@desc   Approve or reject generated questions
//@route  PUT /api/ai/review-queue
//@access Private
const reviewQueueDecision = asyncHandler(async (req, res) => {
  const { ids, decision } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400);
    throw new Error("Send the ids you are deciding on.");
  }

  if (!["approve", "reject"].includes(decision)) {
    res.status(400);
    throw new Error("Decision must be approve or reject.");
  }

  if (decision === "reject") {
    const result = await Question.deleteMany({ _id: { $in: ids }, status: "pending_review" });
    res.status(200).json({ message: `Rejected ${result.deletedCount}.`, count: result.deletedCount });
    return;
  }

  const result = await Question.updateMany(
    { _id: { $in: ids }, status: "pending_review" },
    {
      status: "published",
      publishedAt: new Date(),
      "aiMeta.reviewedBy": req.user._id,
      "aiMeta.reviewedAt": new Date(),
    }
  );

  res.status(200).json({
    message: `Approved ${result.modifiedCount}.`,
    count: result.modifiedCount,
  });
});

//@desc   Reject every pending question in one go — the "Reject all" action on
//        the review page. Deliberately a separate route from
//        reviewQueueDecision rather than a flag on it, so the route itself can
//        be gated: deciding one question is any staff member's judgement, and
//        clearing a whole page in a single click is an owner/admin decision.
//        It is also the only review action that cannot be undone — rejecting
//        deletes the question outright instead of filing it as a draft — so
//        it is enforced at the route and not merely hidden in the UI.
//@route  PUT /api/ai/review-queue/reject-all
//@access Private (owner/admin)
const reviewQueueRejectAll = asyncHandler(async (req, res) => {
  const { ids } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400);
    throw new Error("Send the ids you are rejecting.");
  }

  // The same guard as the single-question path: only what is still waiting can
  // be rejected, so a tab left open from before an approval cannot delete a
  // question that has since gone live.
  const result = await Question.deleteMany({ _id: { $in: ids }, status: "pending_review" });

  res.status(200).json({
    message: `Rejected ${result.deletedCount}.`,
    count: result.deletedCount,
  });
});

//@desc   Approve or reject an AI-written solution proposed for a question
//@route  PUT /api/ai/review-solutions
//@access Private
const solutionReviewDecision = asyncHandler(async (req, res) => {
  const { ids, decision } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400);
    throw new Error("Send the ids you are deciding on.");
  }

  if (!["approve", "reject"].includes(decision)) {
    res.status(400);
    throw new Error("Decision must be approve or reject.");
  }

  if (decision === "reject") {
    // The question's own solutionText, if it had one before, is untouched —
    // rejecting a proposed rewrite is not the same as deleting the solution.
    const result = await Question.updateMany(
      { _id: { $in: ids }, solutionStatus: "pending_review" },
      { $set: { solutionStatus: "none" }, $unset: { pendingSolutionText: "" } }
    );
    res.status(200).json({
      message: `Rejected ${result.modifiedCount} solution${result.modifiedCount === 1 ? "" : "s"}.`,
      count: result.modifiedCount,
    });
    return;
  }

  // One at a time rather than updateMany: the value being copied,
  // pendingSolutionText, is different per document, so there is no single
  // $set that works across all of them at once.
  const questions = await Question.find({ _id: { $in: ids }, solutionStatus: "pending_review" });

  let count = 0;
  for (const question of questions) {
    question.solutionText = question.pendingSolutionText;
    question.pendingSolutionText = undefined;
    question.solutionStatus = "none";
    question.aiMeta = {
      ...(question.aiMeta || {}),
      reviewedBy: req.user._id,
      reviewedAt: new Date(),
    };
    await question.save();
    count += 1;
  }

  res.status(200).json({
    message: `Approved ${count} solution${count === 1 ? "" : "s"}.`,
    count,
  });
});

//@desc   Token and cost usage
//@route  GET /api/ai/usage
//@access Private, admin
const getUsage = asyncHandler(async (req, res) => {
  const days = Math.min(Number(req.query.days) || 30, 365);
  const since = new Date(Date.now() - days * 86400000);

  const [byFeature, byDay, totals, byStudent] = await Promise.all([
    AiUsage.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: "$feature",
          calls: { $sum: 1 },
          tokens: { $sum: { $add: ["$promptTokens", "$completionTokens"] } },
          cost: { $sum: "$estimatedCostUsd" },
          failures: { $sum: { $cond: ["$ok", 0, 1] } },
        },
      },
      { $sort: { cost: -1 } },
    ]),
    AiUsage.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          calls: { $sum: 1 },
          cost: { $sum: "$estimatedCostUsd" },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    AiUsage.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: null,
          calls: { $sum: 1 },
          tokens: { $sum: { $add: ["$promptTokens", "$completionTokens"] } },
          cost: { $sum: "$estimatedCostUsd" },
          failures: { $sum: { $cond: ["$ok", 0, 1] } },
          avgLatencyMs: { $avg: "$latencyMs" },
        },
      },
    ]),
    // Per-student breakdown — the gap that made a cap-reached complaint
    // impossible to investigate before this: there was no way to see who
    // was actually calling the AI a lot, only the platform-wide total.
    // Capped at 200 rather than paginated properly, since this is a
    // diagnostic view for "who's using this a lot", not a browsable report.
    AiUsage.aggregate([
      { $match: { createdAt: { $gte: since }, student: { $ne: null } } },
      {
        $group: {
          _id: { student: "$student", batch: "$batch" },
          calls: { $sum: 1 },
          cost: { $sum: "$estimatedCostUsd" },
          failures: { $sum: { $cond: ["$ok", 0, 1] } },
          creditPaidCalls: { $sum: { $cond: ["$paidWithCredit", 1, 0] } },
        },
      },
      { $sort: { calls: -1 } },
      { $limit: 200 },
      { $lookup: { from: "students", localField: "_id.student", foreignField: "_id", as: "student" } },
      { $lookup: { from: "batches", localField: "_id.batch", foreignField: "_id", as: "batch" } },
      { $unwind: { path: "$student", preserveNullAndEmptyArrays: true } },
      { $unwind: { path: "$batch", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          studentId: "$_id.student",
          batchId: "$_id.batch",
          calls: 1,
          cost: 1,
          failures: 1,
          creditPaidCalls: 1,
          studentName: "$student.name",
          studentEmail: "$student.email",
          studentPhone: "$student.phoneNumber",
          batchName: "$batch.name",
        },
      },
    ]),
  ]);

  res.status(200).json({
    days,
    totals: totals.length > 0 ? totals[0] : { calls: 0, tokens: 0, cost: 0, failures: 0 },
    byFeature,
    byDay,
    byStudent,
  });
});

module.exports = {
  generateQuestions,
  generateFromBank,
  backfillSolutions,
  writeCodingStarter,
  writeModelAnswer,
  backfillSkillTypes,
  reviewQuestion,
  auditQuestionPool,
  getAuditPool,
  auditPoolDecision,
  getOpenAudits,
  getReviewQueue,
  reviewQueueDecision,
  reviewQueueRejectAll,
  solutionReviewDecision,
  getUsage,
  isGradingCapable,
};
