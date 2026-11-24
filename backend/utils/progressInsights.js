const PracticeAttempt = require("../models/practiceAttemptModel");
const Submission = require("../models/submissionModel");
const Student = require("../models/studentModel");
const { studentExamIds } = require("./excludeStudentExams");

// The deeper half of "My progress", added on top of utils/progress.js:
// skill map, where the student stands in the batch, exam journey, study
// days, badges and short plain-words notes. Called with what progress.js
// already loaded, so nothing is read twice for the student.
//
// The batch side (best score per exam per student, the spread of exam
// averages, time per question) is the same for everyone in the batch, so
// it is built once per batch and kept for PROGRESS_CACHE_MS.

const BATCH_TTL_MS = Number(process.env.PROGRESS_CACHE_MS ?? 10 * 60 * 1000);
const HEATMAP_DAYS = 16 * 7;
const LIVE = { deletedAt: null, isActive: { $ne: false } };

const buildBatch = async (batchId) => {
  const excluded = new Set((await studentExamIds()).map(String));
  const timed = { batch: batchId, timeSpentMs: { $gt: 1000, $lt: 600000 } };
  const [timeRow, timedCount, submissions] = await Promise.all([
    PracticeAttempt.aggregate([{ $match: timed }, { $group: { _id: null, ms: { $sum: "$timeSpentMs" } } }]),
    PracticeAttempt.countDocuments(timed),
    Submission.find({ batch: batchId, status: "graded" }).select("student exam marks totalMarks").lean(),
  ]);

  // Exam scores only count for accounts that still exist, so a deleted or
  // deactivated student never shows up in the spread or the averages.
  const live = new Set(
    (await Student.find({ _id: { $in: [...new Set(submissions.map((s) => String(s.student)))] }, ...LIVE }).select("_id").lean())
      .map((s) => String(s._id))
  );

  const best = new Map(); // student -> exam -> best percent
  for (const s of submissions) {
    const sid = String(s.student);
    if (!live.has(sid) || excluded.has(String(s.exam)) || !(s.totalMarks > 0)) continue;
    const p = (s.marks / s.totalMarks) * 100;
    if (!best.has(sid)) best.set(sid, new Map());
    const mine = best.get(sid);
    const key = String(s.exam);
    if (!mine.has(key) || mine.get(key) < p) mine.set(key, p);
  }

  const examSums = new Map();
  const averages = [];
  for (const [sid, exams] of best) {
    let sum = 0;
    for (const [examId, p] of exams) {
      sum += p;
      const row = examSums.get(examId) || { sum: 0, n: 0 };
      row.sum += p;
      row.n += 1;
      examSums.set(examId, row);
    }
    averages.push({ student: sid, avg: sum / exams.size });
  }
  averages.sort((a, b) => b.avg - a.avg);

  return {
    examAvg: new Map([...examSums].map(([k, v]) => [k, { avg: v.sum / v.n, n: v.n }])),
    averages,
    avgSeconds: timedCount && timeRow[0] ? timeRow[0].ms / timedCount / 1000 : null,
    excluded,
  };
};

const batchCache = new Map();
const batchStats = async (batchId) => {
  const key = String(batchId);
  const hit = batchCache.get(key);
  if (BATCH_TTL_MS > 0 && hit && Date.now() - hit.at < BATCH_TTL_MS) return hit.data;
  const data = await buildBatch(batchId);
  if (BATCH_TTL_MS > 0) batchCache.set(key, { at: Date.now(), data });
  return data;
};
const clearCache = () => batchCache.clear();

const longestRun = (sortedDays) => {
  let best = 0;
  let run = 0;
  let prev = null;
  for (const d of sortedDays) {
    const t = Date.parse(`${d}T00:00:00Z`);
    run = prev !== null && t - prev === 86400000 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }
  return best;
};

// ctx: what utils/progress.js loaded and worked out for the student.
// Adds a badge quest to ctx.quests; returns the extra page sections.
const build = async (ctx) => {
  const { sid, bid, tz, features, attempts, graded, lectureCount, lecturesDone, allDays, dayCounts, dayKey, skills, allTopics, weakSkill, quests, pct } = ctx;
  const batch = await batchStats(bid);

  // ---- exams: best attempt per exam, in the order they were first sat
  const bestByExam = new Map();
  for (const s of graded) {
    if (!s.exam || batch.excluded.has(String(s.exam._id)) || !(s.totalMarks > 0)) continue;
    const p = (s.marks / s.totalMarks) * 100;
    const key = String(s.exam._id);
    const at = s.submittedAt || s.gradedAt;
    const row = bestByExam.get(key) || { examId: key, title: s.exam.title, you: p, date: at };
    row.you = Math.max(row.you, p);
    if (at && (!row.date || at < row.date)) row.date = at;
    bestByExam.set(key, row);
  }
  const exams = [...bestByExam.values()]
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(-12)
    .map((e) => ({
      ...e,
      you: Math.round(e.you),
      batch: batch.examAvg.get(e.examId) ? Math.round(batch.examAvg.get(e.examId).avg) : null,
      takers: batch.examAvg.get(e.examId)?.n || 0,
    }));

  // ---- standing in the batch, by average exam score
  let standing = null;
  const idx = batch.averages.findIndex((r) => r.student === String(sid));
  if (idx >= 0) {
    const of = batch.averages.length;
    const mine = batch.averages[idx].avg;
    const bins = Array.from({ length: 10 }, () => 0);
    for (const r of batch.averages) bins[Math.min(9, Math.floor(r.avg / 10))] += 1;
    standing = {
      rank: batch.averages.filter((r) => r.avg > mine).length + 1,
      of,
      avg: Math.round(mine),
      batchAvg: Math.round(batch.averages.reduce((s, r) => s + r.avg, 0) / of),
      beats: of > 1 ? Math.round((batch.averages.filter((r) => r.avg < mine).length / (of - 1)) * 100) : null,
      bins,
      myBin: Math.min(9, Math.floor(mine / 10)),
    };
  }

  // ---- study days: the last 16 weeks
  const today = dayKey(new Date(), tz);
  const days = [];
  for (let i = HEATMAP_DAYS - 1; i >= 0; i -= 1) {
    const d = dayKey(new Date(Date.parse(`${today}T12:00:00Z`) - i * 86400000), "UTC");
    days.push({ day: d, count: dayCounts.get(d) || 0 });
  }
  const activity = { days, bestStreak: longestRun([...allDays].sort()), activeDays: allDays.size };

  // ---- streaks inside the answers
  let hotRun = 0;
  let run = 0;
  for (const a of attempts) {
    run = a.isCorrect ? run + 1 : 0;
    hotRun = Math.max(hotRun, run);
  }
  const last50 = attempts.slice(-50);
  const last50Acc = last50.length === 50 ? pct(last50.filter((a) => a.isCorrect).length, 50) : null;

  // ---- badges
  const examsOn = features.exams !== false;
  const comeback = exams.some((e, i) => i > 0 && e.you - exams[i - 1].you >= 15);
  const masterTopic = allTopics.reduce((m, t) => (t.accuracy >= 90 ? Math.max(m, t.attempts) : m), 0);
  const skillsAt70 = skills.filter((s) => s.you !== null && s.you >= 70 && s.attempts >= 5).length;
  const badge = (key, title, desc, value, goal, show = true) => show && ({
    key, title, desc, earned: value >= goal, value: Math.min(value, goal), goal,
  });
  const badges = [
    badge("first_steps", "First steps", "Answer 10 practice questions", attempts.length, 10),
    badge("century", "Century", "Answer 100 practice questions", attempts.length, 100),
    badge("marathon", "Marathon", "Answer 500 practice questions", attempts.length, 500),
    badge("hot_streak", "Hot streak", "Get 10 answers right in a row", hotRun, 10),
    badge("sharp", "Sharp", "80% right over your last 50 questions", last50Acc !== null && last50Acc >= 80 ? 1 : 0, 1),
    badge("on_fire", "On fire", "Study 7 days in a row", activity.bestStreak, 7),
    badge("regular", "Regular", "Study on 30 different days", activity.activeDays, 30),
    badge("topic_master", "Topic master", "90% or more in a topic, 10+ answers", masterTopic, 10),
    badge("all_rounder", "All-rounder", "70% or more in 4 skills", skillsAt70, 4),
    badge("debut", "Debut", "Finish your first exam", graded.length, 1, examsOn),
    badge("comeback", "Comeback", "Beat your last exam by 15 points", comeback ? 1 : 0, 1, examsOn),
    badge("podium", "Podium", "Top 3 in a batch of 5 or more", standing && standing.of >= 5 && standing.rank <= 3 ? 1 : 0, 1, examsOn),
    badge("bookworm", "Bookworm", "Finish 10 lectures", lecturesDone, Math.min(10, Math.max(1, lectureCount)), lectureCount > 0),
  ].filter(Boolean);

  const nextBadge = badges.filter((b) => !b.earned && b.goal > 1).sort((a, b) => b.value / b.goal - a.value / a.goal)[0];
  if (nextBadge) {
    quests.push({ kind: "badge", badge: nextBadge.key, title: `Unlock ${nextBadge.title}`, detail: `${nextBadge.desc}. ${nextBadge.value} of ${nextBadge.goal} done.`, link: null });
  }

  // ---- plain-words notes
  const notes = [];
  const rated = skills.filter((s) => s.you !== null);
  if (rated.length >= 2) {
    const top = rated.slice().sort((a, b) => b.you - a.you)[0];
    notes.push({ tone: "good", text: `Best skill: ${top.label}, ${top.you}%.` });
  }
  if (weakSkill && weakSkill.batch !== null && weakSkill.batch - weakSkill.you >= 5) {
    notes.push({ tone: "warn", text: `${weakSkill.label} is ${weakSkill.batch - weakSkill.you} points below the batch.` });
  }
  if (exams.length >= 3) {
    const last = exams.slice(-3);
    const change = last[2].you - last[0].you;
    if (Math.abs(change) >= 5) notes.push({ tone: change > 0 ? "good" : "warn", text: `Last 3 exams: ${change > 0 ? "up" : "down"} ${Math.abs(change)} points.` });
  }
  const weekAgo = Date.now() - 7 * 86400000;
  const twoWeeks = Date.now() - 14 * 86400000;
  const thisWeek = attempts.filter((a) => new Date(a.createdAt) >= weekAgo).length;
  const lastWeek = attempts.filter((a) => new Date(a.createdAt) >= twoWeeks && new Date(a.createdAt) < weekAgo).length;
  if (thisWeek && lastWeek && Math.abs(thisWeek - lastWeek) >= 5) {
    const diff = thisWeek - lastWeek;
    notes.push({ tone: diff > 0 ? "good" : "info", text: `${thisWeek} questions this week, ${diff > 0 ? `${diff} more` : `${-diff} fewer`} than last week.` });
  }
  const timed = attempts.filter((a) => a.timeSpentMs > 1000 && a.timeSpentMs < 600000);
  const mySeconds = timed.length >= 5 ? timed.reduce((s, a) => s + a.timeSpentMs, 0) / timed.length / 1000 : null;
  if (mySeconds !== null && batch.avgSeconds) {
    const r = mySeconds / batch.avgSeconds;
    if (r <= 0.8) notes.push({ tone: "good", text: `You answer faster than the batch (${Math.round(mySeconds)}s vs ${Math.round(batch.avgSeconds)}s).` });
    else if (r >= 1.25) notes.push({ tone: "info", text: `You take longer than the batch (${Math.round(mySeconds)}s vs ${Math.round(batch.avgSeconds)}s). Fine if you're getting them right.` });
  }

  return {
    skills,
    exams,
    standing,
    activity,
    badges,
    notes,
    speed: { seconds: mySeconds !== null ? Math.round(mySeconds) : null, batchSeconds: batch.avgSeconds ? Math.round(batch.avgSeconds) : null },
  };
};

module.exports = { build, clearCache };
