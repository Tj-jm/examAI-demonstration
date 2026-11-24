const asyncHandler = require("express-async-handler");
const StudyPlan = require("../../models/studyPlanModel").Archive;
const AiConfig = require("../../models/aiConfigModel");
const { Question } = require("../../models/questionModel");
const Topic = require("../../models/topicModel");
const { outlineFor } = require("../../utils/courseOutline");
const { subjectIds } = require("../../utils/batchSubjects");
const aiService = require("../../ai/service");
const { AiCapReachedError } = aiService;
const { generateStudyPlan: buildStudyPlanPrompt } = require("../../ai/prompts");
const { buildStudyPlanSchema } = require("../../ai/schemas");
const { rankWeakTopics, untouchedChapterPools } = require("../../utils/weakTopics");
const { notify } = require("../../utils/notify");
const { skillTypeLabel, SKILL_TYPE_VALUES } = require("../../utils/skillTypes");

// The archive's own version of studyPlanController.js — same scheduling
// engine (weakest-topic-first coverage, skill-type streams, compression for
// short durations, trailing revision), ported almost unchanged, with two
// real differences:
//   - Every question query here is scoped by isPublic + this batch's own
//     archiveAuthorities (see archiveController.js's authorityFilter),
//     never Question.batches — the same "reuse the batch-scoped shape,
//     swap the visibility gate" pattern the rest of this module already
//     uses.
//   - There is no lecture-day concept — archive content has no lecture
//     library behind it at all. This needed no special-casing in
//     buildSchedule/topicStreams/examDay/revisionDay below (all already
//     lecture-optional: `topic.lecture ? 1 : 0`), only the removal of
//     untouchedTopics' own Lecture-matching step, which is the one place
//     studyPlanController.js actually populates that field.
// Everything else — buildSchedule's whole coverage/compression/slack
// policy, topicStreams' skill-type breakdown, drainStreams' packing — is
// unchanged from studyPlanController.js on purpose: verified, load-bearing
// logic, not worth re-deriving a second time where it already works.
//
// The plan itself is stored with batch: null — one shared archive-wide
// plan per student, same convention as PracticeAttempt/weak-topics: reached
// through whichever batch's archive door is open right now, not owned by
// it. Regenerating always scopes candidate topics to THIS door's own
// archiveAuthorities (matching how browsing/practicing already works) —
// nothing here recommends a topic the student has no way to reach.

const DISPLAY_SUMMARY_MAX = 320;
const stripMarkdown = (text) =>
  String(text || "")
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, ""))
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]*)\*\*/g, "$1")
    .replace(/(^|\s)\*([^*\s][^*]*?)\*(?=\s|$)/g, "$1$2")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "");
const trimSummary = (text, maxLen = DISPLAY_SUMMARY_MAX) => {
  const trimmed = stripMarkdown(text).trim();
  if (trimmed.length <= maxLen) return trimmed;
  const window = trimmed.slice(0, maxLen);
  const lastSentenceEnd = Math.max(window.lastIndexOf(". "), window.lastIndexOf("! "), window.lastIndexOf("? "));
  if (lastSentenceEnd > maxLen * 0.4) return window.slice(0, lastSentenceEnd + 1).trim();
  const lastSpace = window.lastIndexOf(" ");
  return (lastSpace > 0 ? window.slice(0, lastSpace) : window).trim();
};

const buildDeterministicSummary = (topics, durationDays) => {
  const [first, second] = topics;
  if (!first) return `Your ${durationDays}-day archive plan is ready — a mix of practice sessions built from your accuracy so far.`;

  const weakSkill = (first.skills || [])[0];
  const firstPart = weakSkill
    ? `${first.title} (especially ${skillTypeLabel(weakSkill.skillType).toLowerCase()}, ${weakSkill.accuracy}% over ${weakSkill.attempts} attempts)`
    : `${first.title} (${first.accuracy}% over ${first.attempts} attempts)`;

  const secondPart = second ? ` and ${second.title} (${second.accuracy}% accuracy)` : "";

  return `This ${durationDays}-day archive plan focuses first on your weakest spot, ${firstPart}${secondPart}, then works through the rest of your archive practice history.`;
};

const STRONG_ACCURACY = 80;

// Every archive topic with at least one practiceable public question that
// this batch's own archiveAuthorities actually grants — the archive
// equivalent of studyPlanController.js's allPublishedTopicCounts, scoped by
// isPublic + authority instead of Question.batches.
const allPublishedTopicCounts = (allowedAuthorities, subjects) =>
  Question.aggregate([
    { $match: { isPublic: true, status: "published", "sources.authority": { $in: allowedAuthorities }, subject: { $in: subjects }, topic: { $ne: null } } },
    { $group: { _id: "$topic", count: { $sum: 1 } } },
  ]);

// Same as studyPlanController.js's untouchedTopics, minus the Lecture-
// matching step — archive content has no lecture library to check against,
// so `lecture` is always null here rather than fetched.
const untouchedTopics = async (batch, allCounts, signalIds) => {
  const ids = allCounts.filter((r) => !signalIds.has(String(r._id))).map((r) => r._id);
  if (ids.length === 0) return [];

  const topics = await Topic.find({ _id: { $in: ids } })
    .populate("chapter", "title order")
    .select("title chapter order");
  // In the batch's outline order (utils/courseOutline.js).
  const ol = await outlineFor(batch);
  await ol.prime({ topics: topics.map((t) => t._id) });

  return topics
    .sort(ol.byTopic((t) => t._id))
    .map((topic) => ({
      _id: topic._id,
      chapterPool: false,
      title: topic.title,
      chapter: topic.chapter,
      accuracy: null,
      rawAccuracy: null,
      attempts: 0,
      skills: [],
      lecture: null,
    }));
};

const mergedTopicOrder = (signalTopics, untouched) => {
  const weak = signalTopics.filter((t) => t.accuracy < STRONG_ACCURACY);
  const strong = signalTopics.filter((t) => t.accuracy >= STRONG_ACCURACY);
  return [...weak, ...untouched, ...strong];
};

const VALID_DURATIONS = [3, 5, 7, 15, 30];
const resolveDuration = (value) => {
  const n = Number(value);
  return VALID_DURATIONS.includes(n) ? n : 7;
};

const MISC_SKILL = "none";
const SESSION_SIZE = 15;
const daysForCount = (count) => Math.max(1, Math.ceil(count / SESSION_SIZE));

// Same as studyPlanController.js's countEntryQuestions, scoped by isPublic
// + authority instead of Question.batches. Counted over exactly the types
// the archive practice modal serves, so a skill with nothing practiceable
// counts as 0 and never becomes a plan day.
const PRACTICE_TYPES = ["mcq", "mtf", "written", "passage"];
const countEntryQuestions = async (allowedAuthorities, topics, subjects) => {
  const type = { $in: PRACTICE_TYPES };
  const topicIds = topics.filter((t) => !t.chapterPool).map((t) => t._id);
  const chapterIds = topics.filter((t) => t.chapterPool).map((t) => t._id);

  const [bySkill, byMisc, byChapterSkill, byChapterMisc, mcqByTopic, mcqByChapter] = await Promise.all([
    topicIds.length
      ? Question.aggregate([
          { $match: { isPublic: true, status: "published", type, "sources.authority": { $in: allowedAuthorities }, subject: { $in: subjects }, topic: { $in: topicIds }, skillType: { $ne: null } } },
          { $group: { _id: { topic: "$topic", skillType: "$skillType" }, count: { $sum: 1 } } },
        ])
      : [],
    topicIds.length
      ? Question.aggregate([
          { $match: { isPublic: true, status: "published", type, "sources.authority": { $in: allowedAuthorities }, subject: { $in: subjects }, topic: { $in: topicIds }, skillType: null } },
          { $group: { _id: "$topic", count: { $sum: 1 } } },
        ])
      : [],
    chapterIds.length
      ? Question.aggregate([
          { $match: { isPublic: true, status: "published", type, "sources.authority": { $in: allowedAuthorities }, subject: { $in: subjects }, chapter: { $in: chapterIds }, topic: null, skillType: { $ne: null } } },
          { $group: { _id: { chapter: "$chapter", skillType: "$skillType" }, count: { $sum: 1 } } },
        ])
      : [],
    chapterIds.length
      ? Question.aggregate([
          { $match: { isPublic: true, status: "published", type, "sources.authority": { $in: allowedAuthorities }, subject: { $in: subjects }, chapter: { $in: chapterIds }, topic: null, skillType: null } },
          { $group: { _id: "$chapter", count: { $sum: 1 } } },
        ])
      : [],
    // Multiple-choice only, for sizing exam days (their paper is mcq).
    topicIds.length
      ? Question.aggregate([
          { $match: { isPublic: true, status: "published", type: "mcq", "sources.authority": { $in: allowedAuthorities }, subject: { $in: subjects }, topic: { $in: topicIds } } },
          { $group: { _id: "$topic", count: { $sum: 1 } } },
        ])
      : [],
    chapterIds.length
      ? Question.aggregate([
          { $match: { isPublic: true, status: "published", type: "mcq", "sources.authority": { $in: allowedAuthorities }, subject: { $in: subjects }, chapter: { $in: chapterIds }, topic: null } },
          { $group: { _id: "$chapter", count: { $sum: 1 } } },
        ])
      : [],
  ]);

  const groupBySkill = (rows, idKey) => {
    const map = new Map();
    for (const r of rows) {
      const id = String(r._id[idKey]);
      if (!map.has(id)) map.set(id, []);
      map.get(id).push({ skillType: r._id.skillType, count: r.count });
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => SKILL_TYPE_VALUES.indexOf(a.skillType) - SKILL_TYPE_VALUES.indexOf(b.skillType));
    }
    return map;
  };

  return {
    skillsByTopic: groupBySkill(bySkill, "topic"),
    skillsByChapter: groupBySkill(byChapterSkill, "chapter"),
    miscCounts: new Map(byMisc.map((r) => [String(r._id), r.count])),
    chapterMiscCounts: new Map(byChapterMisc.map((r) => [String(r._id), r.count])),
    mcqCounts: new Map([...mcqByTopic, ...mcqByChapter].map((r) => [String(r._id), r.count])),
  };
};

// Unchanged from studyPlanController.js — already lecture-optional
// (nothing here reads topic.lecture at all).
const topicStreams = (topic, counts) => {
  const skills = topic.chapterPool
    ? counts.skillsByChapter.get(String(topic._id)) || []
    : counts.skillsByTopic.get(String(topic._id)) || [];

  const streams = skills.map((s) => ({
    topic,
    skillType: s.skillType,
    note: `Practice ${skillTypeLabel(s.skillType)} questions in ${topic.title}.`,
    count: s.count,
    remaining: daysForCount(s.count),
  }));

  const miscCount = topic.chapterPool
    ? counts.chapterMiscCounts.get(String(topic._id)) || 0
    : counts.miscCounts.get(String(topic._id)) || 0;
  if (miscCount > 0) {
    streams.push({
      topic,
      skillType: skills.length > 0 ? MISC_SKILL : undefined,
      note: skills.length > 0
        ? `Round out ${topic.title} with everything outside the skills above.`
        : `Practice ${topic.title} — its questions aren't classified by skill yet.`,
      count: miscCount,
      remaining: daysForCount(miscCount),
    });
  }
  return streams;
};

const totalQuestionsForTopic = (topic, counts) =>
  topicStreams(topic, counts).reduce((sum, s) => sum + s.count, 0);

const drainStreams = (streams, entriesPerDay, maxDays) => {
  const days = [];
  for (let d = 0; d < maxDays; d += 1) {
    const active = streams.filter((s) => s.remaining > 0);
    if (active.length === 0) break;
    const picks = active.slice(0, entriesPerDay);
    for (const p of picks) p.remaining -= 1;
    const label = (p) => {
      if (p.skillType === undefined) return p.topic.title;
      const skill = p.skillType === MISC_SKILL ? "Miscellaneous" : skillTypeLabel(p.skillType);
      return `${p.topic.title} — ${skill}`;
    };
    days.push({
      kind: "practice",
      focus: picks.map(label).join(" + "),
      topics: picks.map((p) => ({
        topic: p.topic._id,
        chapterPool: p.topic.chapterPool,
        title: p.topic.title,
        note: p.note,
        skillType: p.skillType,
        lecture: p.topic.lecture ? { lecture: p.topic.lecture._id, title: p.topic.lecture.title } : undefined,
      })),
    });
  }
  return days;
};

// An exam day needs enough multiple-choice questions to be worth timing.
const EXAM_MIN_MCQ = 5;
const examFits = (topic, counts) => (counts.mcqCounts.get(String(topic._id)) || 0) >= EXAM_MIN_MCQ;
const EXAM_MAX_QUESTIONS = 20;
const EXAM_MINUTES_PER_QUESTION = 1.5;
const examDay = (topic, counts) => {
  // Never more than the topic's real multiple-choice questions.
  const questionCount = Math.min(EXAM_MAX_QUESTIONS, counts.mcqCounts.get(String(topic._id)) || 0);
  return {
    kind: "exam",
    focus: `Self-build exam — ${topic.title}`,
    topics: [{
      topic: topic._id,
      chapterPool: topic.chapterPool,
      title: topic.title,
      note: `A timed self-built paper covering ${topic.title} so far.`,
    }],
    exam: {
      topic: topic._id,
      chapterPool: topic.chapterPool,
      title: topic.title,
      questionCount,
      types: ["mcq"],
      durationMinutes: Math.max(10, Math.round(questionCount * EXAM_MINUTES_PER_QUESTION)),
    },
  };
};

const revisionDay = (topics) => ({
  kind: "revision",
  revision: true,
  focus: "Revision — everything so far, all at once",
  topics: topics.map((topic) => ({
    topic: topic._id,
    chapterPool: topic.chapterPool,
    title: topic.title,
    note: `Quick revisit of ${topic.title} to make sure it's sticking.`,
    lecture: topic.lecture ? { lecture: topic.lecture._id, title: topic.lecture.title } : undefined,
  })),
});

// Unchanged from studyPlanController.js — the whole coverage/compression/
// slack policy, verified there and reused byte-for-byte.
const buildSchedule = (topics, counts, durationDays) => {
  const hasRevisionDay = durationDays > 1;
  const revisionBaseline = hasRevisionDay ? 1 : 0;
  let budget = durationDays - revisionBaseline;

  const days = [];
  const fullyCovered = [];
  let compressFrom = -1;

  for (let i = 0; i < topics.length; i += 1) {
    const topic = topics[i];
    const streams = topicStreams(topic, counts);
    const practiceCost = streams.reduce((sum, s) => sum + s.remaining, 0);
    if (practiceCost === 0) continue;

    // Always 0 here — archive topics never carry a lecture — kept as a
    // named cost rather than deleted outright so this stays a byte-for-byte
    // structural match with studyPlanController.js's own budget arithmetic.
    const lectureCost = 0;
    const examCost = examFits(topic, counts) ? 1 : 0;

    if (examCost && budget >= lectureCost + practiceCost + examCost) {
      days.push(...drainStreams(streams, 1, practiceCost));
      days.push(examDay(topic, counts));
      budget -= lectureCost + practiceCost + examCost;
    } else if (budget >= lectureCost + practiceCost) {
      days.push(...drainStreams(streams, 1, practiceCost));
      budget -= lectureCost + practiceCost;
    } else if (budget >= practiceCost) {
      days.push(...drainStreams(streams, 1, practiceCost));
      budget -= practiceCost;
    } else {
      compressFrom = i;
      break;
    }
    fullyCovered.push(topic);
  }

  if (compressFrom !== -1 && budget > 0) {
    const remaining = topics.slice(compressFrom);
    const pooled = remaining.flatMap((t) => topicStreams(t, counts));
    const totalUnits = pooled.reduce((sum, s) => sum + s.remaining, 0);
    if (totalUnits > 0) {
      const entriesPerDay = Math.max(1, Math.ceil(totalUnits / budget));
      const packed = drainStreams(pooled, entriesPerDay, budget);
      days.push(...packed);
      fullyCovered.push(...remaining.filter((t) => totalQuestionsForTopic(t, counts) > 0));
      budget -= packed.length;
    }
  }

  const REVISION_EXTRA_CAP = 2;
  if (budget > 0 && fullyCovered.length > 0) {
    const secondPass = fullyCovered.flatMap((t) => topicStreams(t, counts).map((s) => ({ ...s, remaining: 1 })));
    const secondPassCost = secondPass.reduce((sum, s) => sum + s.remaining, 0);
    const practiceExtraTarget = Math.min(Math.floor(budget / 2), secondPassCost);
    const secondPassDays = drainStreams(secondPass, 1, practiceExtraTarget);
    days.push(...secondPassDays);
    budget -= secondPassDays.length;
  }

  const revisionExtra = fullyCovered.length > 0 ? Math.min(budget, REVISION_EXTRA_CAP) : 0;

  if (hasRevisionDay && fullyCovered.length > 0) {
    for (let i = 0; i < revisionBaseline + revisionExtra; i += 1) {
      days.push(revisionDay(fullyCovered));
    }
  }

  return days.map((d, i) => ({ ...d, day: i + 1 }));
};

const capacityDays = (topics, counts) => {
  let total = 0;
  for (const topic of topics) {
    const practiceCost = topicStreams(topic, counts).reduce((sum, s) => sum + s.remaining, 0);
    if (practiceCost === 0) continue;
    total += practiceCost + (topic.lecture ? 1 : 0) + (examFits(topic, counts) ? 1 : 0);
  }
  return total === 0 ? 0 : total + 1;
};

//@desc   This student's current archive study plan, if one has ever been
//        generated — shared across every batch's archive door (batch: null)
//@route  GET /api/app/batches/:batchId/archive/study-plan
//@access Private (student + batchAccess + this batch has archiveAuthorities)
const getStudyPlan = asyncHandler(async (req, res) => {
  const plan = await StudyPlan.findOne({ student: req.student._id, batch: req.batch._id });
  res.status(200).json({ plan });
});

// Shared by generateStudyPlan and getStudyPlanCapacity, scoped to this
// batch's own archiveAuthorities — candidate topics are always ones this
// door can actually reach, even though the plan document itself (and the
// weak-topic signal it's built from) is shared archive-wide.
const loadMergedTopics = async (studentId, batch) => {
  const allowedAuthorities = batch.archiveAuthorities || [];
  // Only the batch's ticked subjects (utils/batchSubjects.js).
  const subjects = subjectIds(batch);
  const ranked = await rankWeakTopics(studentId, batch._id, { subjects, archive: true });
  if (ranked.length === 0) return { ranked, topics: [], counts: null };

  const allCounts = await allPublishedTopicCounts(allowedAuthorities, subjects);
  const signalIds = new Set(ranked.filter((t) => !t.chapterPool).map((t) => String(t._id)));
  const untouched = [
    ...(await untouchedTopics(batch, allCounts, signalIds)),
    ...(await untouchedChapterPools(
      { isPublic: true, status: "published", "sources.authority": { $in: allowedAuthorities }, subject: { $in: subjects } },
      new Set(ranked.filter((t) => t.chapterPool).map((t) => String(t._id))),
    )),
  ];

  const topics = mergedTopicOrder(ranked, untouched);
  const counts = await countEntryQuestions(allowedAuthorities, topics, subjects);
  return { ranked, topics, counts };
};

//@desc   Whether this student has any archive practice history to build a
//        plan from, plus idealDays — same contract as
//        studyPlanController.js's getStudyPlanCapacity
//@route  GET /api/app/batches/:batchId/archive/study-plan/capacity
//@access Private (student + batchAccess + this batch has archiveAuthorities)
const getStudyPlanCapacity = asyncHandler(async (req, res) => {
  const { topics, counts } = await loadMergedTopics(req.student._id, req.batch);
  if (topics.length === 0) {
    res.status(200).json({ maxDays: 0, idealDays: 0 });
    return;
  }
  res.status(200).json({
    maxDays: VALID_DURATIONS[VALID_DURATIONS.length - 1],
    idealDays: capacityDays(topics, counts),
  });
});

//@desc   Generate (or regenerate) an archive study plan from this student's
//        own weak-topic accuracy across the whole archive
//@route  POST /api/app/batches/:batchId/archive/study-plan/generate
//@access Private (student + batchAccess + this batch has archiveAuthorities)
const generateStudyPlan = asyncHandler(async (req, res) => {
  const durationDays = resolveDuration(req.body?.durationDays);
  const { ranked, topics, counts } = await loadMergedTopics(req.student._id, req.batch);

  if (ranked.length === 0) {
    res.status(400);
    throw new Error("Practice a few archive topics first — this needs some history to know what to focus on.");
  }

  const days = buildSchedule(topics, counts, durationDays);

  if (days.length === 0) {
    res.status(502);
    throw new Error("Couldn't build a plan from your archive practice history. Try again.");
  }

  const coveredIds = new Set(
    days.filter((d) => !d.revision).flatMap((d) => d.topics.map((t) => String(t.topic)))
  );
  const covered = ranked.filter((t) => coveredIds.has(String(t._id)));
  const summaryTopics = covered.length > 0 ? covered : ranked.slice(0, 3);

  const config = await AiConfig.get();
  const built = buildStudyPlanPrompt({ topics: summaryTopics, language: req.body?.language, durationDays });

  let summary;
  try {
    const { data } = await aiService.generate({
      feature: "archive-study-plan",
      schema: buildStudyPlanSchema(),
      maxTokens: 3000,
      student: config.features.studyPlanFree ? null : req.student._id,
      batch: req.batch._id,
      ...built,
    });
    const trimmed = trimSummary(data.summary);
    summary = trimmed.length >= 20 ? trimmed : buildDeterministicSummary(summaryTopics, days.length);
  } catch (error) {
    if (error instanceof AiCapReachedError) throw error;
    summary = buildDeterministicSummary(summaryTopics, days.length);
  }

  const plan = await StudyPlan.findOneAndUpdate(
    { student: req.student._id, batch: req.batch._id },
    { summary, durationDays: days.length, requestedDays: durationDays, days, generatedAt: new Date() },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  await notify(req.student._id, "studyPlanReady", {
    title: "Your archive study plan is ready",
    body: summary,
    link: `/batches/${req.batch._id}/archive/study-plan`,
  });

  res.status(200).json({ plan });
});

//@desc   Check or uncheck a single day of the student's current archive plan
//@route  PATCH /api/app/batches/:batchId/archive/study-plan/days/:day/complete
//@access Private (student + batchAccess + this batch has archiveAuthorities)
const toggleStudyPlanDay = asyncHandler(async (req, res) => {
  const dayNumber = Number(req.params.day);
  const completed = Boolean(req.body?.completed);

  const plan = await StudyPlan.findOneAndUpdate(
    { student: req.student._id, batch: req.batch._id, "days.day": dayNumber },
    { $set: { "days.$.completed": completed } },
    { new: true }
  );

  if (!plan) {
    res.status(404);
    throw new Error("No archive study plan day found to update.");
  }

  res.status(200).json({ plan });
});

module.exports = { getStudyPlan, getStudyPlanCapacity, generateStudyPlan, toggleStudyPlanDay };
