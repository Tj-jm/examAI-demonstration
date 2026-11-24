const mongoose = require("mongoose");
const PracticeAttempt = require("../models/practiceAttemptModel");
const Submission = require("../models/submissionModel");
const LectureProgress = require("../models/lectureProgressModel");
const Lecture = require("../models/lectureModel");
const Topic = require("../models/topicModel");
const Chapter = require("../models/chapterModel");
const Batch = require("../models/batchModel");
const { outlineFor, compareKeys } = require("./courseOutline");
const { inBatchSubjects } = require("./batchSubjects");
const AppSettings = require("../models/appSettingsModel");
const { Question } = require("../models/questionModel");
const { answerIsCorrect } = require("./answerScoring");
const { SKILL_TYPES } = require("./skillTypes");
const { levelBands } = require("./levelTitles");
const insights = require("./progressInsights");

// "My progress": one student's results in one batch. This file is the core
// of the page: the progress card (level, XP, stats), next quests and the
// topic map. utils/progressInsights.js adds the rest (skill map, rank,
// exam journey, study days, badges, notes) when it is present.
//
// Read-only and deterministic: no AI calls, nothing stored. Every number
// comes from practice attempts, graded exams and lecture progress.
//
// Per-topic and per-skill accuracy for the whole batch is the same for
// every student, so it is built once per batch and kept for BATCH_TTL_MS.
// Aggregations here only $match and $group with $sum, so they run on
// MongoDB and on the FerretDB used in tests alike.

const BATCH_TTL_MS = Number(process.env.PROGRESS_CACHE_MS ?? 10 * 60 * 1000);
const MIN_TOPIC = 3;
const MIN_SKILL = 2;

const pct = (c, t) => (t > 0 ? Math.round((c / t) * 100) : null);
const bump = (map, key, ok) => {
  if (!map.has(key)) map.set(key, { total: 0, correct: 0 });
  const row = map.get(key);
  row.total += 1;
  if (ok) row.correct += 1;
};
const bumpBy = (map, key, total, correct) => {
  if (!map.has(key)) map.set(key, { total: 0, correct: 0 });
  const row = map.get(key);
  row.total += total;
  row.correct += correct;
};

// The calendar day (YYYY-MM-DD) a moment falls on in the student's zone.
const dayKey = (date, tz) => {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
};

const questionInfo = async (ids) => {
  const list = ids.length
    ? await Question.find({ _id: { $in: [...new Set(ids.map(String))] } }).select("topic chapter skillType marks rubric type").lean()
    : [];
  return new Map(list.map((q) => [String(q._id), q]));
};

// Where one answer counts: its topic (or chapter, for a chapter-pool
// question) and its skill.
const placeOf = (q) => ({
  topicKey: q.topic ? `t:${q.topic}` : q.chapter ? `c:${q.chapter}` : null,
  skill: q.skillType || null,
});

// A short per-batch cache: batchId -> { at, data }.
const cached = (build) => {
  const entries = new Map();
  const get = async (batchId) => {
    const key = String(batchId);
    const hit = entries.get(key);
    if (BATCH_TTL_MS > 0 && hit && Date.now() - hit.at < BATCH_TTL_MS) return hit.data;
    const data = await build(batchId);
    if (BATCH_TTL_MS > 0) entries.set(key, { at: Date.now(), data });
    return data;
  };
  get.clear = () => entries.clear();
  return get;
};

// ---------------------------------------------------------------- batch side

// Pooled accuracy per topic and per skill across the batch, practice and
// exams together.
const batchAccuracy = cached(async (batchId) => {
  const [practiceGroups, submissions] = await Promise.all([
    PracticeAttempt.aggregate([
      { $match: { batch: batchId } },
      { $group: { _id: { q: "$question", c: "$isCorrect" }, n: { $sum: 1 } } },
    ]),
    Submission.find({ batch: batchId, status: "graded" }).select("answers.question answers.marksAwarded").lean(),
  ]);
  const qMap = await questionInfo([
    ...practiceGroups.map((g) => g._id.q),
    ...submissions.flatMap((s) => (s.answers || []).map((a) => a.question)),
  ]);
  const byTopic = new Map();
  const bySkill = new Map();
  for (const g of practiceGroups) {
    const q = qMap.get(String(g._id.q));
    if (!q) continue;
    const { topicKey, skill } = placeOf(q);
    const correct = g._id.c ? g.n : 0;
    if (topicKey) bumpBy(byTopic, topicKey, g.n, correct);
    if (skill) bumpBy(bySkill, skill, g.n, correct);
  }
  for (const s of submissions) {
    for (const a of s.answers || []) {
      const q = qMap.get(String(a.question));
      if (!q) continue;
      const ok = answerIsCorrect(a, q);
      if (ok === null) continue;
      const { topicKey, skill } = placeOf(q);
      if (topicKey) bump(byTopic, topicKey, ok);
      if (skill) bump(bySkill, skill, ok);
    }
  }
  return { byTopic, bySkill };
});

const clearCache = () => {
  batchAccuracy.clear();
  insights?.clearCache();
};

// ---------------------------------------------------------------- levels

// XP needed to go from level L to L+1 grows slowly, so early levels come
// fast and later ones still feel reachable.
const stepFor = (level) => 120 + 60 * (level - 1);
const levelFor = (xp, names) => {
  let level = 1;
  let left = xp;
  while (left >= stepFor(level)) {
    left -= stepFor(level);
    level += 1;
  }
  const bands = levelBands(names);
  const next = bands.find((b) => b.from > level);
  return {
    level,
    xp,
    into: left,
    need: stepFor(level),
    title: [...bands].reverse().find((b) => level >= b.from).title,
    nextTitle: next?.title || null,
    nextTitleAt: next?.from || null,
  };
};

const XP = { correct: 10, wrong: 4, exam: 30, lecture: 20, day: 5 };

// Days in a row up to today (or yesterday, if today has nothing yet).
const currentRun = (days, tz) => {
  const today = dayKey(new Date(), tz);
  const step = (d) => dayKey(new Date(Date.parse(`${d}T12:00:00Z`) - 86400000), "UTC");
  let d = days.has(today) ? today : step(today);
  let n = 0;
  while (days.has(d)) {
    n += 1;
    d = step(d);
  }
  return n;
};

// ---------------------------------------------------------------- student side

const forStudent = async (studentId, batchId, { timezone, features = {}, levelNames } = {}) => {
  const tz = timezone || "UTC";
  const sid = new mongoose.Types.ObjectId(String(studentId));
  const bid = new mongoose.Types.ObjectId(String(batchId));

  const [batch, attempts, subs, lectureRows, lectureCount] = await Promise.all([
    batchAccuracy(bid),
    PracticeAttempt.find({ student: sid, batch: bid }).select("question isCorrect timeSpentMs createdAt").sort({ createdAt: 1 }).lean(),
    Submission.find({ student: sid, batch: bid, status: { $in: ["submitted", "grading", "graded"] } })
      .select("exam status marks totalMarks submittedAt gradedAt answers.question answers.marksAwarded")
      .populate("exam", "title")
      .lean(),
    LectureProgress.find({ student: sid, batch: bid }).select("completedAt lastWatchedAt").lean(),
    Lecture.countDocuments({ batches: bid, isPublished: true }),
  ]);
  const graded = subs.filter((s) => s.status === "graded");

  const qMap = await questionInfo([
    ...attempts.map((a) => a.question),
    ...graded.flatMap((s) => (s.answers || []).map((a) => a.question)),
  ]);

  // Accuracy per topic and skill, practice and exams together.
  const myTopic = new Map();
  const mySkill = new Map();
  for (const a of attempts) {
    const q = qMap.get(String(a.question));
    if (!q) continue;
    const { topicKey, skill } = placeOf(q);
    if (topicKey) bump(myTopic, topicKey, a.isCorrect);
    if (skill) bump(mySkill, skill, a.isCorrect);
  }
  for (const s of graded) {
    for (const a of s.answers || []) {
      const q = qMap.get(String(a.question));
      if (!q) continue;
      const ok = answerIsCorrect(a, q);
      if (ok === null) continue;
      const { topicKey, skill } = placeOf(q);
      if (topicKey) bump(myTopic, topicKey, ok);
      if (skill) bump(mySkill, skill, ok);
    }
  }
  const correct = attempts.filter((a) => a.isCorrect).length;

  const skills = SKILL_TYPES.map(({ value, label }) => {
    const me = mySkill.get(value);
    const all = batch.bySkill.get(value);
    return {
      skill: value,
      label,
      you: me && me.total >= MIN_SKILL ? pct(me.correct, me.total) : null,
      batch: all && all.total >= MIN_SKILL ? pct(all.correct, all.total) : null,
      attempts: me?.total || 0,
    };
  });

  // ---- topic map, grouped by chapter
  const topicIds = [];
  const chapterIds = [];
  for (const key of myTopic.keys()) {
    if (key.startsWith("t:")) topicIds.push(key.slice(2));
    else chapterIds.push(key.slice(2));
  }
  const [allTopicDocs, allChapterDocs, batchDoc] = await Promise.all([
    topicIds.length ? Topic.find({ _id: { $in: topicIds } }).select("title chapter subject").lean() : [],
    chapterIds.length ? Chapter.find({ _id: { $in: chapterIds } }).select("title subject").lean() : [],
    Batch.findById(bid).select("outline subjects").lean(),
  ]);
  // The map only shows what the student can still practise: topics in the
  // batch's ticked subjects (utils/batchSubjects.js). Overall stats above
  // keep every attempt.
  const topicDocs = allTopicDocs.filter((t) => inBatchSubjects(batchDoc, t.subject));
  const chapterDocs = allChapterDocs.filter((c) => inBatchSubjects(batchDoc, c.subject));
  const parentIds = [...new Set(topicDocs.map((t) => String(t.chapter)).filter(Boolean))];
  const parents = parentIds.length ? await Chapter.find({ _id: { $in: parentIds } }).select("title").lean() : [];
  const chapterTitle = new Map([...parents, ...chapterDocs].map((c) => [String(c._id), c.title]));

  const levelOf = (acc, n) => (n < MIN_TOPIC ? "new" : acc >= 85 && n >= 8 ? "mastered" : acc >= 70 ? "strong" : acc >= 50 ? "learning" : "weak");
  const topicRow = (key, title, id, chapterPool) => {
    const me = myTopic.get(key);
    const all = batch.byTopic.get(key);
    const accuracy = pct(me.correct, me.total);
    return {
      _id: id,
      title,
      chapterPool,
      accuracy,
      attempts: me.total,
      batch: all && all.total >= MIN_TOPIC ? pct(all.correct, all.total) : null,
      level: levelOf(accuracy, me.total),
      link: `/batches/${batchId}/practice/${chapterPool ? `chapter:${id}` : id}`,
    };
  };
  const groups = new Map();
  const add = (chapterId, row) => {
    const k = chapterId || "other";
    if (!groups.has(k)) groups.set(k, { _id: chapterId || null, title: chapterTitle.get(String(chapterId)) || "Other", topics: [] });
    groups.get(k).topics.push(row);
  };
  for (const t of topicDocs) add(t.chapter ? String(t.chapter) : null, topicRow(`t:${t._id}`, t.title, String(t._id), false));
  for (const c of chapterDocs) add(String(c._id), topicRow(`c:${c._id}`, `${c.title} (whole chapter)`, String(c._id), true));
  // Chapters and topics in the batch's outline order, each chapter with
  // its named group (utils/courseOutline.js).
  const ol = await outlineFor(batchDoc);
  await ol.prime({ topics: topicIds, chapters: [...parentIds, ...chapterIds] });
  const rowKey = (r) => (r.chapterPool ? [...ol.chapterKey(r._id), -1] : ol.topicKey(r._id));
  const topics = [...groups.values()]
    .map((g) => ({ ...g, group: g._id ? ol.group(g._id) : null, topics: g.topics.sort((a, b) => compareKeys(rowKey(a), rowKey(b))) }))
    .sort((a, b) => (!a._id ? 1 : !b._id ? -1 : compareKeys(ol.chapterKey(a._id), ol.chapterKey(b._id))));
  const allTopics = topics.flatMap((g) => g.topics);

  // ---- study days: practice, exams and lectures
  const dayCounts = new Map();
  const tick = (date) => {
    if (!date) return;
    const d = dayKey(new Date(date), tz);
    dayCounts.set(d, (dayCounts.get(d) || 0) + 1);
  };
  attempts.forEach((a) => tick(a.createdAt));
  subs.forEach((s) => tick(s.submittedAt));
  lectureRows.forEach((l) => tick(l.completedAt || l.lastWatchedAt));
  const allDays = new Set(dayCounts.keys());
  const streak = currentRun(allDays, tz);

  // ---- XP and level
  const lecturesDone = lectureRows.filter((l) => l.completedAt).length;
  const xp = correct * XP.correct
    + (attempts.length - correct) * XP.wrong
    + graded.reduce((s, x) => s + XP.exam + (x.totalMarks > 0 ? Math.round((x.marks / x.totalMarks) * 50) : 0), 0)
    + lecturesDone * XP.lecture
    + allDays.size * XP.day;
  const names = levelNames ?? (await AppSettings.get().catch(() => null))?.studentUi?.levelTitles;

  const examPercents = graded.filter((s) => s.totalMarks > 0).map((s) => (s.marks / s.totalMarks) * 100);
  const result = {
    level: levelFor(xp, names),
    stats: {
      questions: attempts.length,
      accuracy: pct(correct, attempts.length),
      examsTaken: graded.length,
      examAvg: examPercents.length ? Math.round(examPercents.reduce((s, p) => s + p, 0) / examPercents.length) : null,
      lecturesDone,
      lectureCount,
      streak,
    },
    topics,
    quests: [],
  };

  // ---- what to do next
  const weakSkill = skills
    .filter((s) => s.you !== null && s.you < 75)
    .sort((a, b) => (a.you - (a.batch ?? a.you)) - (b.you - (b.batch ?? b.you)) || a.you - b.you)[0];
  const weakTopic = allTopics
    .filter((t) => t.level === "weak" || t.level === "learning")
    .sort((a, b) => a.accuracy - b.accuracy)[0];
  const quests = [];
  if (weakTopic && features.practice !== false) {
    quests.push({ kind: "topic", title: `Fix ${weakTopic.title}`, detail: `You're at ${weakTopic.accuracy}%${weakTopic.batch !== null ? `, batch ${weakTopic.batch}%` : ""}. Get it to 70%.`, link: weakTopic.link, xp: 10 * XP.correct });
  }
  if (weakSkill && features.practice !== false) {
    quests.push({ kind: "skill", title: `Train ${weakSkill.label}`, detail: `Your weakest skill: ${weakSkill.you}%${weakSkill.batch !== null ? ` (batch ${weakSkill.batch}%)` : ""}.`, link: `/batches/${batchId}/practice`, xp: 10 * XP.correct });
  }

  if (insights) {
    Object.assign(result, await insights.build({
      sid, bid, tz, features, attempts, subs, graded, lectureCount, lecturesDone, allDays, dayCounts,
      dayKey, skills, allTopics, weakSkill, quests, pct,
    }));
  }

  if (streak === 0 && attempts.length && features.practice !== false) {
    quests.push({ kind: "streak", title: "Start a new streak", detail: "Answer a few questions today.", link: `/batches/${batchId}/practice`, xp: XP.day });
  }
  result.quests = quests.slice(0, 3);
  return result;
};

module.exports = { forStudent, levelFor, stepFor, clearCache, dayKey };
