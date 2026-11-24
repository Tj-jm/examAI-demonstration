const mongoose = require("mongoose");
const PracticeAttempt = require("../models/practiceAttemptModel");
const Submission = require("../models/submissionModel");
const { Question } = require("../models/questionModel");
const Topic = require("../models/topicModel");
const Chapter = require("../models/chapterModel");
const Lecture = require("../models/lectureModel");
const Batch = require("../models/batchModel");
const { orderLectures } = require("./courseOutline");
const { answerIsCorrect } = require("./answerScoring");

// Topics need at least this many attempts before their accuracy means
// anything — otherwise a single lucky or unlucky guess would show up as a
// misleading 0% or 100% "weak topic". Shared threshold so the weak-topics
// report, personalized practice, and the study plan can never quietly
// disagree on what counts as enough signal. The same bar applies to a
// chapter-pool chapter's own accuracy, below.
const MIN_ATTEMPTS_FOR_SIGNAL = 3;

// The skill-level breakdown gets its own, lower bar — a topic already
// cleared the bar above to count as "weak" at all, so this only decides
// whether that weakness can be pinned to one specific skill yet. Waiting
// for 3 attempts on every individual skill (recall, application, ...)
// before ever narrowing by skill means a topic can sit "weak" for a long
// time with its skill breakdown staying empty simply because attempts were
// spread across several skills rather than piled on one — exactly what was
// happening to the study plan's skill-wise scheduling. 2 is still enough to
// not be a single lucky/unlucky guess, just not as strict as the topic-level
// bar, which stays at 3 since it drives more (which topics count as weak at
// all across every caller, not just which skill to name within one).
const MIN_SKILL_ATTEMPTS_FOR_SIGNAL = 2;

// Exam performance, blended into the same signal — one row per graded
// (never disqualified, never still in progress) submission's answers,
// joined against Question for topic/chapter/skillType, turned into the same
// {total, correct} shape the PracticeAttempt aggregation below produces so
// the two sources merge as one in rankWeakTopics. Until this existed, an
// exam attempt was invisible to the weak-topics report, personalized
// practice, and the study plan alike — all three share rankWeakTopics, so
// this closes that gap for all of them at once, not just one caller.
// "disqualified" is a different status value than "graded" (see
// submissionModel.js), so a disqualified attempt is naturally excluded
// here too — no separate check needed.
//
// byChapter mirrors byTopic for a question filed only under a chapter
// (Question.topic === null, same chapter-pool convention as everywhere
// else in this codebase) — an exam built from chapter-pool questions used
// to be invisible here entirely (topic-only grouping, see the comment that
// used to sit on the `if (!question.topic) continue` line this replaces).
// No chapter-level skill breakdown: skillType classification only ever
// mattered per topic, and a chapter-pool question skipping the skill pass
// is the same "not classified yet" fallback the topic path already has for
// an unclassified question — nothing downstream requires this to exist.
const examTopicStats = async (studentId, batchId) => {
  const byTopic = new Map();
  const bySkill = new Map();
  const byChapter = new Map();

  const submissions = await Submission.find({ student: studentId, batch: batchId, status: "graded" })
    .select("answers");
  if (submissions.length === 0) return { byTopic, bySkill, byChapter };

  const questionIds = [...new Set(submissions.flatMap((s) => s.answers.map((a) => String(a.question))))];
  const questions = await Question.find({ _id: { $in: questionIds } })
    .select("topic chapter skillType marks rubric type");
  const qMap = new Map(questions.map((q) => [String(q._id), q]));

  const bump = (map, key) => {
    if (!map.has(key)) map.set(key, { total: 0, correct: 0 });
    return map.get(key);
  };

  for (const submission of submissions) {
    for (const answer of submission.answers) {
      const question = qMap.get(String(answer.question));
      if (!question) continue;

      const correct = answerIsCorrect(answer, question);
      if (correct === null) continue;

      if (question.topic) {
        const topicId = String(question.topic);
        const topicRow = bump(byTopic, topicId);
        topicRow.total += 1;
        if (correct) topicRow.correct += 1;

        if (question.skillType) {
          const skillRow = bump(bySkill, `${topicId}:${question.skillType}`);
          skillRow.total += 1;
          if (correct) skillRow.correct += 1;
        }
      } else if (question.chapter) {
        const chapterRow = bump(byChapter, String(question.chapter));
        chapterRow.total += 1;
        if (correct) chapterRow.correct += 1;
      }
    }
  }

  return { byTopic, bySkill, byChapter };
};

// The per-topic accuracy ranking behind the weak-topics report,
// personalized practice, and the study plan — pulled out here so a third
// caller doesn't mean a third hand-copied aggregation slowly drifting out
// of sync with the other two. Sorts weakest-first by RAW accuracy (rounding
// for display happens after sorting, so a rounding tie never changes
// ranking order). Returns [] when there isn't enough attempt history yet —
// every caller already treats that as "nothing to show".
//
// Chapter-pool attempts (Question.topic === null, PracticeAttempt.chapter
// set instead) used to simply fall out of this ranking — a batch practicing
// entirely through chapter-pool tiles (features.practiceByChapter) built up
// real attempt history that the weak-topics report, personalized practice
// and the study plan could never see, so those three stayed empty forever
// no matter how much the student practiced. Every entry this now returns
// carries a `chapterPool` flag so a caller can tell a chapter-level entry
// from a topic-level one apart — its `_id` is a Chapter id, not a Topic id,
// which matters for anything building a practice-session link (see
// PracticeSession.jsx's own "chapter:<id>" route convention).
//
// `subjects`, when given, keeps only topics and chapters in those subjects —
// the batch's ticked subjects (utils/batchSubjects.js), so a weak topic a
// student can no longer practise isn't suggested.
const rankWeakTopics = async (studentId, batchId, { subjects, archive = false } = {}) => {
  // The archive's attempts are kept apart (PracticeAttempt.Archive).
  const Attempts = archive ? PracticeAttempt.Archive : PracticeAttempt;
  const [practiceTopicStats, practiceSkillStats, examStats, practiceChapterStats] = await Promise.all([
    // topic: { $ne: null } excludes chapter-pool attempts — without it they
    // all group into one _id: null bucket, which then merges into
    // topicTotals below as the literal string "null" (String(null)) once it
    // crosses MIN_ATTEMPTS_FOR_SIGNAL. That string then hit Topic.find's
    // `_id: { $in: [...] }` and Mongoose threw a CastError trying to parse
    // "null" as an ObjectId — surfacing to the student as a bare "Resource
    // not found." with no indication it was chapter-pool practice history
    // that triggered it. Chapter-pool attempts are already correctly
    // aggregated on their own below (practiceChapterStats) — this was pure
    // double-counted noise that only existed to crash.
    Attempts.aggregate([
      { $match: { student: studentId, batch: batchId, topic: { $ne: null } } },
      { $group: { _id: "$topic", total: { $sum: 1 }, correct: { $sum: { $cond: ["$isCorrect", 1, 0] } } } },
    ]),
    // A second, finer-grained pass: accuracy by topic *and* skillType, not
    // just topic. Joined against Question rather than stored on the attempt
    // itself, so a question classified after the attempt was made still
    // counts — the classification lives on the question, the attempt just
    // points at it. An attempt on a question with no skillType yet (still
    // the common case for an older bank) simply doesn't match the $ne: null
    // below and drops out of this pass only — it still counts in the
    // topic-level pass above. Same topic: { $ne: null } exclusion as above,
    // for the same reason (a chapter-pool attempt has no topic to key this
    // pass's skill breakdown by).
    Attempts.aggregate([
      { $match: { student: studentId, batch: batchId, topic: { $ne: null } } },
      { $lookup: { from: "questions", localField: "question", foreignField: "_id", as: "q" } },
      { $unwind: "$q" },
      { $match: { "q.skillType": { $ne: null } } },
      {
        $group: {
          _id: { topic: "$topic", skillType: "$q.skillType" },
          total: { $sum: 1 },
          correct: { $sum: { $cond: ["$isCorrect", 1, 0] } },
        },
      },
    ]),
    archive ? { byTopic: new Map(), bySkill: new Map(), byChapter: new Map() } : examTopicStats(studentId, batchId),
    // The chapter-pool half of the first aggregation above — grouped by
    // `chapter` instead of `topic`, and matched to only the attempts that
    // actually have no topic, so a normal topic-filed attempt (chapter set
    // or not, it doesn't matter for those) never double-counts here.
    Attempts.aggregate([
      { $match: { student: studentId, batch: batchId, topic: null, chapter: { $ne: null } } },
      { $group: { _id: "$chapter", total: { $sum: 1 }, correct: { $sum: { $cond: ["$isCorrect", 1, 0] } } } },
    ]),
  ]);

  // Merge practice-derived and exam-derived counts into one total/correct
  // per topic (and per topic+skill) before the signal-strength bar is
  // applied — an exam attempt can push a topic over MIN_ATTEMPTS_FOR_SIGNAL
  // just as a practice attempt would, and the merged accuracy reflects
  // both sources together, not whichever happened to reach the threshold
  // first. Same merge, same reasoning, for chapters just below.
  const topicTotals = new Map();
  const bumpTotal = (map, key, total, correct) => {
    if (!map.has(key)) map.set(key, { total: 0, correct: 0 });
    const row = map.get(key);
    row.total += total;
    row.correct += correct;
  };
  for (const s of practiceTopicStats) bumpTotal(topicTotals, String(s._id), s.total, s.correct);
  for (const [topicId, row] of examStats.byTopic) bumpTotal(topicTotals, topicId, row.total, row.correct);

  const chapterTotals = new Map();
  for (const s of practiceChapterStats) bumpTotal(chapterTotals, String(s._id), s.total, s.correct);
  for (const [chapterId, row] of examStats.byChapter) bumpTotal(chapterTotals, chapterId, row.total, row.correct);

  const skillTotals = new Map();
  for (const s of practiceSkillStats) {
    bumpTotal(skillTotals, `${s._id.topic}:${s._id.skillType}`, s.total, s.correct);
  }
  for (const [key, row] of examStats.bySkill) bumpTotal(skillTotals, key, row.total, row.correct);

  // Belt-and-braces: a stray non-ObjectId key here (the "null" bucket above
  // was one concrete way that used to happen, and it's the kind of bug that
  // silently reappears) would otherwise crash Topic/Chapter.find's `_id: {
  // $in }` with a CastError and take down the whole feature for every
  // caller (weak-topics report, personalized practice, the study plan)
  // instead of just quietly dropping the one bad entry.
  const isRealId = (id) => mongoose.Types.ObjectId.isValid(id);

  const stats = [...topicTotals.entries()]
    .filter(([topicId, row]) => row.total >= MIN_ATTEMPTS_FOR_SIGNAL && isRealId(topicId))
    .map(([topicId, row]) => ({ _id: topicId, total: row.total, correct: row.correct }));

  const chapterStats = [...chapterTotals.entries()]
    .filter(([chapterId, row]) => row.total >= MIN_ATTEMPTS_FOR_SIGNAL && isRealId(chapterId))
    .map(([chapterId, row]) => ({ _id: chapterId, total: row.total, correct: row.correct }));

  if (stats.length === 0 && chapterStats.length === 0) return [];

  const skillStats = [...skillTotals.entries()]
    .filter(([, row]) => row.total >= MIN_SKILL_ATTEMPTS_FOR_SIGNAL)
    .map(([key, row]) => {
      const sep = key.lastIndexOf(":");
      return {
        _id: { topic: key.slice(0, sep), skillType: key.slice(sep + 1) },
        total: row.total,
        correct: row.correct,
      };
    });

  const [topics, chapterPoolChapters] = await Promise.all([
    Topic.find({ _id: { $in: stats.map((s) => s._id) } })
      .populate("chapter", "title")
      .select("title chapter subject"),
    Chapter.find({ _id: { $in: chapterStats.map((s) => s._id) } }).select("title subject"),
  ]);

  const byId = new Map(topics.map((t) => [String(t._id), t]));
  const chapterById = new Map(chapterPoolChapters.map((c) => [String(c._id), c]));

  // A weak topic's own lecture, for callers (the study plan) that want to
  // suggest rewatching material rather than only more practice. Topic-
  // specific lectures win; a chapter-general one (no topic narrowing) is the
  // fallback so a chapter that was never split into per-topic lectures still
  // has something to point at — and is also the *only* kind of lecture a
  // chapter-pool entry can ever match, since it has no topic of its own.
  const topicChapterIds = topics.map((t) => t.chapter?._id).filter(Boolean);
  const topicIds = topics.map((t) => t._id);
  const chapterPoolChapterIds = chapterPoolChapters.map((c) => c._id);
  // Deduplicated — a chapter can show up here both because a weak topic
  // belongs to it and because it also has its own chapter-pool entry.
  const allChapterIds = [...new Set([...topicChapterIds, ...chapterPoolChapterIds].map(String))];

  const lectures = allChapterIds.length || topicIds.length
    ? await Lecture.find({
        batches: batchId,
        isPublished: true,
        $or: [{ topic: { $in: topicIds } }, { chapter: { $in: allChapterIds } }],
      })
        .select("title chapter topic order createdAt")
        .lean()
    : [];
  // The first lecture for a topic is the first in the batch's outline order.
  if (lectures.length) await orderLectures(await Batch.findById(batchId).select("outline").lean(), lectures);

  const lectureForTopic = (topic) => {
    const byTopic = lectures.find((l) => l.topic && String(l.topic) === String(topic._id));
    if (byTopic) return byTopic;
    return lectures.find(
      (l) => !l.topic && topic.chapter && String(l.chapter) === String(topic.chapter._id)
    );
  };

  const lectureForChapter = (chapterId) =>
    lectures.find((l) => !l.topic && String(l.chapter) === String(chapterId));

  // Skill rows regrouped under their topic, weakest first — same raw-
  // accuracy-before-rounding sort discipline as the topic list itself.
  const skillsByTopic = new Map();
  for (const s of skillStats) {
    const topicId = String(s._id.topic);
    if (!skillsByTopic.has(topicId)) skillsByTopic.set(topicId, []);
    skillsByTopic.get(topicId).push({
      skillType: s._id.skillType,
      accuracy: s.correct / s.total,
      attempts: s.total,
    });
  }

  const topicRows = stats
    .map((s) => ({
      topic: byId.get(String(s._id)),
      accuracy: s.correct / s.total,
      attempts: s.total,
      skills: (skillsByTopic.get(String(s._id)) || []).sort((a, b) => a.accuracy - b.accuracy),
    }))
    .filter((r) => r.topic)
    .map((r) => {
      const lecture = lectureForTopic(r.topic);
      return {
        _id: r.topic._id,
        chapterPool: false,
        title: r.topic.title,
        chapter: r.topic.chapter,
        accuracy: Math.round(r.accuracy * 100),
        rawAccuracy: r.accuracy,
        attempts: r.attempts,
        // Absent (empty array) is the normal, expected state for a topic
        // whose questions aren't classified yet — every caller treats a
        // topic with no skills breakdown exactly like one predating this
        // field entirely, no separate "unclassified" branch needed anywhere.
        skills: r.skills.map((sk) => ({
          skillType: sk.skillType,
          accuracy: Math.round(sk.accuracy * 100),
          attempts: sk.attempts,
        })),
        // null (not absent) when nothing matched — same additive discipline
        // as `skills`, so a caller that doesn't care about lectures just
        // never looks at this key.
        lecture: lecture ? { _id: lecture._id, title: lecture.title } : null,
      };
    });

  const chapterRows = chapterStats
    .map((s) => ({
      chapter: chapterById.get(String(s._id)),
      accuracy: s.correct / s.total,
      attempts: s.total,
    }))
    .filter((r) => r.chapter)
    .map((r) => {
      const lecture = lectureForChapter(r.chapter._id);
      return {
        _id: r.chapter._id,
        chapterPool: true,
        title: r.chapter.title,
        // Self-referential rather than absent — a caller that already
        // expects every row to carry `chapter: { _id, title }` (the study
        // plan's chapter-linking, say) works unmodified against a
        // chapter-pool row: the chapter this row is about IS the chapter
        // it points to.
        chapter: { _id: r.chapter._id, title: r.chapter.title },
        accuracy: Math.round(r.accuracy * 100),
        rawAccuracy: r.accuracy,
        attempts: r.attempts,
        // No skill breakdown for a chapter-pool row — see the comment on
        // examTopicStats above for why that's never computed here.
        skills: [],
        lecture: lecture ? { _id: lecture._id, title: lecture.title } : null,
      };
    });

  const allowed = subjects ? new Set(subjects.map((x) => String(x?._id || x))) : null;
  const kept = (row) => {
    if (!allowed) return true;
    const doc = row.chapterPool ? chapterById.get(String(row._id)) : byId.get(String(row._id));
    return Boolean(doc && allowed.has(String(doc.subject)));
  };
  return [...topicRows, ...chapterRows].filter(kept).sort((a, b) => a.rawAccuracy - b.rawAccuracy);
};

// Chapters whose questions have no topic, not practised yet: shaped like a
// rankWeakTopics chapter-pool row, so a study plan covers them too (topics
// aren't required). `match` scopes the questions (batch or archive).
const untouchedChapterPools = async (match, signalIds) => {
  const rows = await Question.aggregate([
    { $match: { ...match, topic: null, chapter: { $ne: null } } },
    { $group: { _id: "$chapter" } },
  ]);
  const ids = rows.map((r) => r._id).filter((id) => !signalIds.has(String(id)));
  if (!ids.length) return [];
  const chapters = await Chapter.find({ _id: { $in: ids } }).select("title order").sort({ order: 1, title: 1 }).lean();
  return chapters.map((c) => ({
    _id: c._id, chapterPool: true, title: c.title, chapter: { _id: c._id, title: c.title },
    accuracy: null, rawAccuracy: null, attempts: 0, skills: [], lecture: null,
  }));
};

module.exports = { rankWeakTopics, untouchedChapterPools, MIN_ATTEMPTS_FOR_SIGNAL };
