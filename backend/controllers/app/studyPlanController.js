const asyncHandler = require("express-async-handler");
const StudyPlan = require("../../models/studyPlanModel");
const AiConfig = require("../../models/aiConfigModel");
const { Question } = require("../../models/questionModel");
const Topic = require("../../models/topicModel");
const Lecture = require("../../models/lectureModel");
const Batch = require("../../models/batchModel");
const { orderLectures } = require("../../utils/courseOutline");
const { batchQuestionScope, subjectIds } = require("../../utils/batchSubjects");
const aiService = require("../../ai/service");
const { AiCapReachedError } = aiService;
const { generateStudyPlan: buildStudyPlanPrompt } = require("../../ai/prompts");
const { buildStudyPlanSchema } = require("../../ai/schemas");
const { rankWeakTopics, untouchedChapterPools } = require("../../utils/weakTopics");
const { notify } = require("../../utils/notify");
const { skillTypeLabel, SKILL_TYPE_VALUES } = require("../../utils/skillTypes");

// The schema no longer sends a tight maxLength to the provider (that's what
// was cutting summaries off mid-word — see ai/schemas/index.js), so a
// display cap is enforced here instead, on a clean boundary rather than a
// hard character count. Cuts at the last sentence-ending punctuation at or
// before the target; falls back to the last whole word if the model wrote
// one long run-on sentence with none.
const DISPLAY_SUMMARY_MAX = 320;
// The prompt tells the model not to use markdown, and it mostly doesn't —
// but "mostly" still means **bold** and `code` show up as literal asterisks
// and backticks on screen, since the frontend renders this as plain text.
// Stripped here rather than trusted to the prompt alone.
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

// Written entirely in code from data already in hand — no model call, so it
// can't truncate, leak markdown, or fail for any of the reasons an LLM call
// can. This is the summary's guaranteed floor: generateStudyPlan always has
// something solid to show even when the AI call errors, times out, gets
// capped, or comes back unusable after retries. `topics` is the same
// weakest-first list the AI prompt is built from (summaryTopics below).
const buildDeterministicSummary = (topics, durationDays) => {
  const [first, second] = topics;
  if (!first) return `Your ${durationDays}-day plan is ready — a mix of practice sessions built from your accuracy so far.`;

  const weakSkill = (first.skills || [])[0];
  const firstPart = weakSkill
    ? `${first.title} (especially ${skillTypeLabel(weakSkill.skillType).toLowerCase()}, ${weakSkill.accuracy}% over ${weakSkill.attempts} attempts)`
    : `${first.title} (${first.accuracy}% over ${first.attempts} attempts)`;

  const secondPart = second ? ` and ${second.title} (${second.accuracy}% accuracy)` : "";

  return `This ${durationDays}-day plan focuses first on your weakest spot, ${firstPart}${secondPart}, then works through the rest of your practice history.`;
};

// Above this accuracy, a topic with real attempt history is "already fairly
// solid" — still worth a revisit, but not urgent the way a genuinely weak
// topic or a completely untouched one is. Used only to decide ordering
// (mergedTopicOrder), never to drop a topic from the plan.
const STRONG_ACCURACY = 80;

// Every topic in the batch with at least one practiceable published
// question — not just the ones with enough attempt history to show up in
// rankWeakTopics. {_id, count} per topic, same shape Question.aggregate's
// $group naturally returns.
const allPublishedTopicCounts = (batch) =>
  Question.aggregate([
    { $match: { ...batchQuestionScope(batch), status: "published", topic: { $ne: null } } },
    { $group: { _id: "$topic", count: { $sum: 1 } } },
  ]);

// A topic a student has never practiced enough of to show up in
// rankWeakTopics at all — mastering a batch means eventually covering these
// too, not only ever firefighting whatever's already flagged weak. Fetched
// and shaped to look like a rankWeakTopics row (accuracy/attempts null-ish,
// skills always empty, since there's no signal to break it down by) so
// mergedTopicOrder and topicStreams can treat every topic the same way.
//
// batchId, allCounts: allPublishedTopicCounts' own output — passed in
// rather than refetched, since the caller (loadMergedTopics) already
// fetched it to know which topics exist at all.
const untouchedTopics = async (batchId, allCounts, signalIds) => {
  const ids = allCounts.filter((r) => !signalIds.has(String(r._id))).map((r) => r._id);
  if (ids.length === 0) return [];

  const topics = await Topic.find({ _id: { $in: ids } })
    .populate("chapter", "title order")
    .select("title chapter order");

  // Same lecture-matching rule as rankWeakTopics (utils/weakTopics.js) —
  // duplicated locally rather than imported, since that util's own contract
  // (only ever returning topics with real attempt signal) is relied on by
  // the weak-topics report and personalized practice, and isn't safe to
  // change just for this.
  const topicIds = topics.map((t) => t._id);
  const chapterIds = [...new Set(topics.map((t) => t.chapter?._id).filter(Boolean).map(String))];
  const lectures = topicIds.length || chapterIds.length
    ? await Lecture.find({
        batches: batchId,
        isPublished: true,
        $or: [{ topic: { $in: topicIds } }, { chapter: { $in: chapterIds } }],
      }).select("title chapter topic order createdAt").lean()
    : [];
  // Untouched topics and their lectures in the batch's outline order.
  const batch = await Batch.findById(batchId).select("outline").lean();
  const ol = await orderLectures(batch, lectures);
  await ol.prime({ topics: topicIds });
  const lectureForTopic = (topic) => {
    const byTopic = lectures.find((l) => l.topic && String(l.topic) === String(topic._id));
    if (byTopic) return byTopic;
    return lectures.find((l) => !l.topic && topic.chapter && String(l.chapter) === String(topic.chapter._id));
  };

  return topics
    .sort(ol.byTopic((t) => t._id))
    .map((topic) => {
      const lecture = lectureForTopic(topic);
      return {
        _id: topic._id,
        chapterPool: false,
        title: topic.title,
        chapter: topic.chapter,
        accuracy: null,
        rawAccuracy: null,
        attempts: 0,
        skills: [],
        lecture: lecture ? { _id: lecture._id, title: lecture.title } : null,
      };
    });
};

// The actual coverage order every plan follows, regardless of duration:
// genuinely weak topics first (lowest accuracy, same order rankWeakTopics
// already returns), then untouched topics (no signal yet — never ignored,
// just not as urgent as a *known* weak spot), then topics the student's
// already fairly solid on, weakest-of-the-solid first. Every duration
// targets the WHOLE list, all the way through — a short plan doesn't cover
// less, it just packs the same full coverage into fewer, denser days (see
// buildSchedule's compression path).
const mergedTopicOrder = (signalTopics, untouched) => {
  const weak = signalTopics.filter((t) => t.accuracy < STRONG_ACCURACY);
  const strong = signalTopics.filter((t) => t.accuracy >= STRONG_ACCURACY);
  return [...weak, ...untouched, ...strong];
};

// The only lengths the student-app's picker offers. An unrecognised value
// (a stale client, a hand-crafted request) falls back to 7 rather than
// rejecting the request outright — there's nothing unsafe about an
// unexpected-but-valid plan length, so this isn't worth a 400 for.
const VALID_DURATIONS = [3, 5, 7, 15, 30];
const resolveDuration = (value) => {
  const n = Number(value);
  return VALID_DURATIONS.includes(n) ? n : 7;
};

// A miscellaneous entry's skillType — the same "none" sentinel convention
// already used everywhere else in this codebase for "explicitly nothing"
// (see lectureController.js's getLectures, buildPracticeExam's chapterIds).
// getPracticeQuestions reads it as "only questions with no skillType at
// all", never as "skip narrowing" (that's what leaving skillType out
// entirely already means, used below for the revision day).
const MISC_SKILL = "none";

// The same session size PracticeModal actually requests (limit: 15) — a
// skill's real day-allocation is sized against this, not a flat "1 day per
// skill" — a skill with 300 published questions can fill ~20 distinct
// fresh-question days on its own, while a skill with 5 only ever supports 1.
const SESSION_SIZE = 15;

// How many entries get packed onto one day is no longer a fixed constant —
// buildSchedule computes it per plan, per phase: 1 (a day is one clear,
// nameable session) whenever there's room, and only packed denser when a
// short duration has to fit the whole batch into fewer days than that.
//
// How many distinct days a pool of `count` published questions actually
// supports before a session would just be re-showing what a previous day
// already covered.
const daysForCount = (count) => Math.max(1, Math.ceil(count / SESSION_SIZE));

// Real published-question counts behind every potential schedule entry,
// broken down by skillType — built entirely from the CONTENT (the question
// bank), never from attempt history. rankWeakTopics' own skill breakdown
// (topic.skills) is attempt-gated (needs enough practice on that specific
// skill first) and is deliberately NOT used here — history's only job in
// this whole module is picking which topics are weak in the first place
// (rankWeakTopics' topic-level ranking, still used for that in
// mergedTopicOrder). Once a topic is chosen, how it's broken down by skill
// comes from what the bank actually has tagged for it, so a topic the
// student has barely touched still gets a real skill-wise breakdown from
// day one, instead of waiting on attempts that may never accumulate evenly
// across every skill.
//
// topics: the merged, weakest-first list (mergedTopicOrder's output). Real
// topics and chapter-pool topics are counted the same way, just grouped by
// `topic` or `chapter` respectively — a chapter-pool question can carry a
// skillType tag exactly like a topic one, so it gets the same breakdown.
//
// Counted over exactly the types the plan's practice modal serves
// (practiceTypes) — a skill whose only questions are ones practice would
// never serve counts as 0 and so never becomes a plan day.
const practiceTypes = (batch) => (batch.features?.aiAssist ? ["mcq", "mtf", "written", "passage"] : ["mcq", "mtf", "passage"]);

const countEntryQuestions = async (batch, topics) => {
  const batchId = batch._id;
  const type = { $in: practiceTypes(batch) };
  const topicIds = topics.filter((t) => !t.chapterPool).map((t) => t._id);
  const chapterIds = topics.filter((t) => t.chapterPool).map((t) => t._id);

  const [bySkill, byMisc, byChapterSkill, byChapterMisc, mcqByTopic, mcqByChapter] = await Promise.all([
    topicIds.length
      ? Question.aggregate([
          { $match: { ...batchQuestionScope(batch), status: "published", type, topic: { $in: topicIds }, skillType: { $ne: null } } },
          { $group: { _id: { topic: "$topic", skillType: "$skillType" }, count: { $sum: 1 } } },
        ])
      : [],
    // Miscellaneous bucket — a topic's questions with no skillType tag at
    // all, same "none" convention getPracticeQuestions reads (MISC_SKILL).
    topicIds.length
      ? Question.aggregate([
          { $match: { ...batchQuestionScope(batch), status: "published", type, topic: { $in: topicIds }, skillType: null } },
          { $group: { _id: "$topic", count: { $sum: 1 } } },
        ])
      : [],
    chapterIds.length
      ? Question.aggregate([
          { $match: { ...batchQuestionScope(batch), status: "published", type, chapter: { $in: chapterIds }, topic: null, skillType: { $ne: null } } },
          { $group: { _id: { chapter: "$chapter", skillType: "$skillType" }, count: { $sum: 1 } } },
        ])
      : [],
    chapterIds.length
      ? Question.aggregate([
          { $match: { ...batchQuestionScope(batch), status: "published", type, chapter: { $in: chapterIds }, topic: null, skillType: null } },
          { $group: { _id: "$chapter", count: { $sum: 1 } } },
        ])
      : [],
    // Multiple-choice only: an exam day's paper is mcq, so it's sized
    // (or left out) by these, not by every practice type.
    topicIds.length
      ? Question.aggregate([
          { $match: { ...batchQuestionScope(batch), status: "published", type: "mcq", topic: { $in: topicIds } } },
          { $group: { _id: "$topic", count: { $sum: 1 } } },
        ])
      : [],
    chapterIds.length
      ? Question.aggregate([
          { $match: { ...batchQuestionScope(batch), status: "published", type: "mcq", chapter: { $in: chapterIds }, topic: null } },
          { $group: { _id: "$chapter", count: { $sum: 1 } } },
        ])
      : [],
  ]);

  // Groups {_id: {<idKey>, skillType}, count} rows into id -> [{skillType,
  // count}], sorted by the taxonomy's own fixed order (recall before
  // application before analysis, ...) — a stable, content-only ordering
  // since there's no attempt-accuracy signal driving it here.
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

// One "stream" per skill actually present in a topic's published questions
// (taxonomy order — recall, comprehension, application, ...), plus a
// miscellaneous round-out stream for whatever's left untagged. Applies
// identically to every topic regardless of how it got chosen — weak,
// untouched, or already-strong, real topic or chapter-pool — since the
// breakdown is purely "what does the bank have", not "what has this
// student practiced enough of yet". Every stream carries how many distinct
// days of fresh questions it actually has behind it (`remaining`) and how
// many real questions back it (`count`, used to size a self-build exam) —
// a stream backed by 0 real questions is dropped entirely rather than
// reserving a day for something that can't serve anything.
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
      // Absent (comprehensive, not narrowed) when the topic has no skill
      // breakdown at all yet — there's no earlier skill-specific day to
      // "round out", so this IS the whole session. "none" (miscellaneous,
      // a deliberate narrowing) once real skill streams exist above it.
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

// An exam day needs enough multiple-choice questions to be worth timing.
const EXAM_MIN_MCQ = 5;
const examFits = (topic, counts) => (counts.mcqCounts.get(String(topic._id)) || 0) >= EXAM_MIN_MCQ;

// Turns a set of streams into day entries — no cycling, no padding.
// `entriesPerDay` streams get packed onto each day (1 whenever there's
// room to give every skill its own day; more only when a short duration
// has to fit the same total content into fewer days). Runs out and stops
// the moment every stream is exhausted, or `maxDays` is hit, whichever
// comes first.
const drainStreams = (streams, entriesPerDay, maxDays) => {
  const days = [];
  for (let d = 0; d < maxDays; d += 1) {
    const active = streams.filter((s) => s.remaining > 0);
    if (active.length === 0) break;
    const picks = active.slice(0, entriesPerDay);
    for (const p of picks) p.remaining -= 1;
    const label = (p) => {
      if (p.skillType === undefined) return p.topic.title; // comprehensive stream — the title alone already says it
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

const lectureDay = (topic) => ({
  kind: "lecture",
  focus: `Watch — ${topic.title}`,
  topics: [{
    topic: topic._id,
    chapterPool: topic.chapterPool,
    title: topic.title,
    note: `Watch the lecture on ${topic.title} before practicing it.`,
    lecture: { lecture: topic.lecture._id, title: topic.lecture.title },
  }],
});

// A self-build exam scoped to just this one topic — the same ephemeral,
// timed paper practiceExamController.js's buildPracticeExam already
// produces, just pre-filled instead of hand-assembled on the setup screen.
// Sized against what the topic actually has (never more than it can offer,
// never so few it isn't worth timing) — mcq only, so it can always
// auto-start with no grading-cost/aiAssist gate to check first (see
// buildPracticeExam's own written-question cost logic, which this
// deliberately avoids depending on).
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
    // No skillType at all — this is the one deliberately unnarrowed
    // session, the full topic pool, not a specific subset of it.
    lecture: topic.lecture ? { lecture: topic.lecture._id, title: topic.lecture.title } : undefined,
  })),
});

// The whole policy. Every duration targets the SAME full coverage list
// (`topics`, already weakest-first, whole batch) — only how densely it's
// packed into `durationDays` changes:
//
//   1. Per topic, in coverage order, spend from the day budget on
//      (lecture if it has one) + (its practice streams, one day each) +
//      (a self-build exam on it) — in that priority, and only as far as
//      the budget actually reaches. "Enough days" is decided per topic,
//      not on a fixed interval ("always availability", not "every N
//      days") — a topic gets its lecture/exam exactly when there's still
//      room for them, nothing more rigid than that.
//   2. The moment a topic doesn't even fit at full practice depth, every
//      remaining topic (this one included) switches to compression: their
//      streams get pooled and packed several-per-day, dense enough that
//      the WHOLE remaining list still fits in whatever budget is left.
//      No lecture, no exam days in this mode — there isn't room for the
//      mandatory part, let alone the extras.
//   3. Whatever budget is left over once the full list is covered (a
//      duration longer than the batch actually needs) is split between a
//      second, deeper practice pass on the topics just covered and extra
//      revision days — never all of it going to just one of the two.
//
// One day is always reserved up front for a trailing Revision day
// (skipped only when the whole plan is 1 day); the split above adds MORE
// revision beyond that baseline when there's slack, it never removes it.
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
    if (practiceCost === 0) continue; // nothing published for this topic yet — nothing to schedule

    const lectureCost = topic.lecture ? 1 : 0;
    const examCost = examFits(topic, counts) ? 1 : 0;

    if (examCost && budget >= lectureCost + practiceCost + examCost) {
      if (lectureCost) days.push(lectureDay(topic));
      days.push(...drainStreams(streams, 1, practiceCost));
      days.push(examDay(topic, counts));
      budget -= lectureCost + practiceCost + examCost;
    } else if (budget >= lectureCost + practiceCost) {
      if (lectureCost) days.push(lectureDay(topic));
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

  // Slack: the whole batch got covered with real days to spare. Split
  // between a second pass on what's covered (more practice, fresh
  // questions each day just like the first pass) and a few extra revision
  // days. Both are capped, deliberately: a thin batch (say one topic, a
  // handful of questions) run against a long duration has nothing left
  // that's actually worth repeating past a point, and stacking a dozen
  // literally-identical "Revision — everything so far" cards to eat the
  // rest of the budget is padding by another name — exactly what "no
  // cycling, no padding" already rules out for the main schedule above.
  // Once both are used up, whatever's left of `budget` simply goes
  // unspent — the plan honestly comes back shorter than requested (see
  // durationDays: days.length at the call site) rather than padded to fit.
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

// The full, uncompressed cost of covering the whole batch — every topic's
// lecture (if any) + full practice depth + a self-build exam, plus the
// baseline revision day. Not a cap on what's achievable (buildSchedule
// covers the whole batch at ANY duration via compression) — this is the
// point past which a longer duration stops adding real coverage and
// starts being pure slack (revision/second-pass practice instead).
const capacityDays = (topics, counts) => {
  let total = 0;
  for (const topic of topics) {
    const practiceCost = topicStreams(topic, counts).reduce((sum, s) => sum + s.remaining, 0);
    if (practiceCost === 0) continue;
    total += practiceCost + (topic.lecture ? 1 : 0) + (examFits(topic, counts) ? 1 : 0);
  }
  return total === 0 ? 0 : total + 1;
};

//@desc   The student's current study plan for this batch, if one has ever
//        been generated. Regenerating replaces it — there's no history to
//        page through, only ever "the current plan" or nothing yet.
//@route  GET /api/app/batches/:batchId/study-plan
//@access Private (student + batchAccess + features.studyPlan)
const getStudyPlan = asyncHandler(async (req, res) => {
  const plan = await StudyPlan.findOne({ student: req.student._id, batch: req.batch._id });
  // Tick days from real work here too, not only when the tutor is opened
  // (utils/tutor.js syncPlan), in the student's time zone.
  if (plan) {
    const Tutor = require("../../models/tutorModel");
    const tz = (await Tutor.findOne({ student: req.student._id, batch: req.batch._id }).select("timezone").lean())?.timezone || req.query.tz || "UTC";
    await require("../../utils/tutor").syncPlan(req.student._id, req.batch, plan, tz).catch(() => {});
  }
  res.status(200).json({ plan });
});

// Shared by generateStudyPlan and getStudyPlanCapacity — the student's
// weak-topic ranking, plus every untouched topic slotted in behind it
// (mergedTopicOrder), with real question counts for every one of them.
// Every duration targets this same full list now (see buildSchedule), so
// there's no per-duration slice anymore — one list, always the whole
// batch. `ranked` is returned too since generateStudyPlan's AI summary
// call still wants the raw weakest-first weak-topic list, not the merged
// one.
const loadMergedTopics = async (studentId, batch) => {
  const batchId = batch._id;
  // Chapter-pool entries only where the batch has chapter practice:
  // otherwise their Practice and exam buttons would be refused.
  const ranked = (await rankWeakTopics(studentId, batchId, { subjects: subjectIds(batch) }))
    .filter((t) => !t.chapterPool || batch.features?.practiceByChapter);
  if (ranked.length === 0) return { ranked, topics: [], counts: null };

  const allCounts = await allPublishedTopicCounts(batch);
  const signalIds = new Set(ranked.filter((t) => !t.chapterPool).map((t) => String(t._id)));
  const untouched = [
    ...(await untouchedTopics(batchId, allCounts, signalIds)),
    // Chapters with no topics, where the batch has chapter practice.
    ...(batch.features?.practiceByChapter
      ? await untouchedChapterPools({ ...batchQuestionScope(batch), status: "published" }, new Set(ranked.filter((t) => t.chapterPool).map((t) => String(t._id))))
      : []),
  ];

  // No lecture days or links when the batch doesn't include lectures.
  const topics = mergedTopicOrder(ranked, untouched).map((t) => (batch.features?.lectures === false ? { ...t, lecture: null } : t));
  const counts = await countEntryQuestions(batch, topics);
  return { ranked, topics, counts };
};

//@desc   Whether this student has any practice history to build a plan
//        from at all (maxDays: 0 when not — see DurationPicker), plus
//        idealDays: how long a plan needs to be to cover the whole batch
//        without compressing anything (every topic gets its own lecture,
//        practice, and exam day) — shown as a hint, not a cap. Every
//        duration the picker offers can build a full-coverage plan now
//        (buildSchedule packs tighter instead of covering less), so
//        nothing gets disabled once there's any history at all.
//@route  GET /api/app/batches/:batchId/study-plan/capacity
//@access Private (student + batchAccess + features.studyPlan)
// A plan is built from practice history and made of practice sessions,
// so it needs the batch's Practice feature.
const practiceOff = (batch) => batch.features?.practice === false;
const PRACTICE_OFF = "Study plans are built from your practice, and practice isn't part of this batch.";

const getStudyPlanCapacity = asyncHandler(async (req, res) => {
  if (practiceOff(req.batch)) {
    res.status(200).json({ maxDays: 0, idealDays: 0, reason: PRACTICE_OFF });
    return;
  }
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

//@desc   Generate (or regenerate) a 7-day plan from this student's own
//        weak-topic accuracy in this batch. Student-triggered only — no
//        automatic regeneration after grading — so this is also the one
//        and only place that meters cost for this feature.
//@route  POST /api/app/batches/:batchId/study-plan/generate
//@access Private (student + batchAccess + features.studyPlan + features.aiAssist)
const generateStudyPlan = asyncHandler(async (req, res) => {
  const durationDays = resolveDuration(req.body?.durationDays);
  if (practiceOff(req.batch)) {
    res.status(400);
    throw new Error(PRACTICE_OFF);
  }
  const { ranked, topics, counts } = await loadMergedTopics(req.student._id, req.batch);

  if (ranked.length === 0) {
    res.status(400);
    throw new Error("Practice a few topics first — this needs some history to know what to focus on.");
  }

  // The schedule itself — lecture/practice/exam days, which topic, which
  // day — is built deterministically here, not by the model (see
  // buildSchedule). Built BEFORE the AI call below on purpose: the AI
  // summary needs to know which topics actually ended up with a real day,
  // not just which ones were candidates. Every duration targets the whole
  // batch now, but a very short one can still end up compressed onto just
  // its first few topics if content is deep enough, so the summary must
  // only ever name what the schedule actually built, never the full
  // candidate list it started from.
  const days = buildSchedule(topics, counts, durationDays);

  // Every candidate topic had nothing practice can serve (questions not
  // assigned to this batch, or only types practice doesn't use here).
  if (days.length === 0) {
    res.status(400);
    throw new Error("There are no practice questions on your topics in this batch yet, so there's nothing to plan. Ask your teacher to add some.");
  }

  const coveredIds = new Set(
    days.filter((d) => !d.revision).flatMap((d) => d.topics.map((t) => String(t.topic)))
  );
  const covered = ranked.filter((t) => coveredIds.has(String(t._id)));
  // covered can come up empty only when the real days ended up entirely on
  // untouched topics (no accuracy data of their own, so never in `ranked`)
  // — falls back to the raw weakest-first list so the summary always has
  // something concrete to ground itself in, rather than an empty prompt.
  const summaryTopics = covered.length > 0 ? covered : ranked.slice(0, 3);

  const config = await AiConfig.get();
  const built = buildStudyPlanPrompt({ topics: summaryTopics, language: req.body?.language, durationDays });

  // The schedule above is the hard part, already built and correct — an
  // unavailable model, a daily cap hit, or a response that still won't
  // validate after retries used to throw all the way out of this handler
  // and hand the student nothing at all, discarding a perfectly good
  // schedule over a one-paragraph decoration. Now any of that just falls
  // back to buildDeterministicSummary instead, so a plan is never blocked
  // on the flakiest part of the request.
  let summary;
  try {
    // This call only writes the plan's one-paragraph overview now — a small,
    // reliable single-field response rather than the >100-line day array
    // that used to need retry logic and index-validation to trust at all.
    const { data } = await aiService.generate({
      feature: "study-plan",
      schema: buildStudyPlanSchema(),
      // The default 2000-token budget is plenty for a 320-char answer, but a
      // reasoning-family model spends part of any budget on hidden reasoning
      // before it writes a single visible character — leaving too little for
      // the actual summary and cutting it off mid-sentence even though
      // nothing about the JSON itself was large. Giving this call real
      // headroom up front avoids relying on generate()'s retry-with-more-room
      // path for something this should never need to retry.
      maxTokens: 3000,
      // A free plan skips assertWithinCaps' per-student branch entirely by
      // passing student: null — the same admin-exempt-call mechanism
      // question_generation/lecture-practice-generate already use (see
      // ai/service.js's assertWithinCaps and featureCosts.js's comment on
      // why those two keys aren't billable at all). batch is kept either
      // way, so the AI-usage dashboard's per-batch breakdown still
      // attributes the call correctly even when it didn't cost the student
      // anything.
      student: config.features.studyPlanFree ? null : req.student._id,
      batch: req.batch._id,
      ...built,
    });
    const trimmed = trimSummary(data.summary);
    // A summary that stripped down to almost nothing (all-markdown output,
    // say) is as unusable as a thrown error — same fallback either way.
    summary = trimmed.length >= 20 ? trimmed : buildDeterministicSummary(summaryTopics, days.length);
  } catch (error) {
    // AiCapReachedError is not a technical failure to paper over — it means
    // the daily free allowance is spent and there's no credit to cover this
    // call either. Falling back to a free summary here would silently
    // bypass that gate on every single generate, which is exactly why
    // credits were never actually being spent on this feature: the moment
    // a call needed to draw on a credit, it hit this catch and got a free
    // result instead. Everything else (truncation, a malformed response
    // even after retries, a provider outage, AI not configured at all)
    // still falls back — those are real technical failures, not a billing
    // boundary, and the schedule underneath is too good to throw away over
    // a flaky paragraph.
    if (error instanceof AiCapReachedError) throw error;
    summary = buildDeterministicSummary(summaryTopics, days.length);
  }

  const plan = await StudyPlan.findOneAndUpdate(
    { student: req.student._id, batch: req.batch._id },
    // durationDays stored is what actually got built, not what was
    // requested — no cycling or padding happens to force a match (see
    // buildSchedule's REVISION_EXTRA_CAP), so a student who picked 30 but
    // whose content is thin sees an honest shorter plan, never one quietly
    // stretched to 30 with duplicate revision days.
    { summary, durationDays: days.length, requestedDays: durationDays, days, generatedAt: new Date() },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  await notify(req.student._id, "studyPlanReady", {
    title: "Your study plan is ready",
    body: summary,
    link: `/batches/${req.batch._id}/study-plan`,
  });

  res.status(200).json({ plan });
});

//@desc   Check or uncheck a single day of the student's current plan.
//        Purely a student-kept marker, not derived from practice attempts
//        or lecture views — there's no reliable single signal for "did the
//        work" across a mix of watching, practicing, or studying offline,
//        so this stays an honor-system checkbox rather than an automatic one.
//@route  PATCH /api/app/batches/:batchId/study-plan/days/:day/complete
//@access Private (student + batchAccess + features.studyPlan)
const toggleStudyPlanDay = asyncHandler(async (req, res) => {
  const dayNumber = Number(req.params.day);
  const completed = Boolean(req.body?.completed);

  const plan = await StudyPlan.findOneAndUpdate(
    { student: req.student._id, batch: req.batch._id, "days.day": dayNumber },
    { $set: { "days.$.completed": completed, "days.$.autoDone": false } },
    { new: true }
  );

  if (!plan) {
    res.status(404);
    throw new Error("No study plan day found to update.");
  }

  res.status(200).json({ plan });
});

module.exports = { getStudyPlan, getStudyPlanCapacity, generateStudyPlan, toggleStudyPlanDay };
