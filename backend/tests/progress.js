// "My progress": levels, skills against the batch, exam journey, standing,
// topic map, streaks, badges and next steps, from real attempts.
process.env.PROGRESS_CACHE_MS = "0";
const { levelFor, stepFor } = require("../utils/progress");

let passed = 0;
let failed = 0;
const check = (label, ok, detail) => {
  if (ok) { passed += 1; console.log(`  ok    ${label}`); }
  else { failed += 1; console.log(`  FAIL  ${label}`, detail === undefined ? "" : JSON.stringify(detail)); }
};

(async () => {
  check("level 1 at 0 XP, a Rookie", levelFor(0).level === 1 && levelFor(0).title === "Rookie" && levelFor(0).need === stepFor(1));
  const l = levelFor(stepFor(1) + stepFor(2) + 5);
  const named = levelFor(stepFor(1) + stepFor(2), ["Cadet", "", "Ranger"]);
  check("admin level names replace the defaults, blanks keep them", named.title === "Learner" && levelFor(0, ["Cadet"]).title === "Cadet" && named.nextTitle === "Ranger", named);
  check("XP carries over between levels", l.level === 3 && l.into === 5 && l.title === "Learner" && l.nextTitle === "Explorer", l);

  if (!process.env.TEST_MONGO_URL) {
    console.log("database: skipped (set TEST_MONGO_URL to run)");
  } else {
    const mongoose = require("mongoose");
    await mongoose.connect(process.env.TEST_MONGO_URL);
    if (/test/.test(mongoose.connection.name)) await mongoose.connection.db.dropDatabase();
    const Batch = require("../models/batchModel");
    const Program = require("../models/programModel");
    const Subject = require("../models/subjectModel");
    const Chapter = require("../models/chapterModel");
    const Topic = require("../models/topicModel");
    const Exam = require("../models/examModel");
    const Submission = require("../models/submissionModel");
    const Student = require("../models/studentModel");
    const PracticeAttempt = require("../models/practiceAttemptModel");
    const { Question } = require("../models/questionModel");
    const progress = require("../utils/progress");
    const ctl = require("../controllers/app/progressController");

    const program = await Program.create({ title: "PR test" });
    const subject = await Subject.create({ title: "Physics PR", name: "Physics PR" });
    const chapter = await Chapter.create({ title: "Optics PR", name: "Optics PR", subject: subject._id });
    const lenses = await Topic.create({ title: "Lenses", name: "Lenses", chapter: chapter._id, subject: subject._id });
    const mirrors = await Topic.create({ title: "Mirrors", name: "Mirrors", chapter: chapter._id, subject: subject._id });
    const batch = await Batch.create({ name: "PR Batch", program: program._id, isActive: true, subjects: [subject._id], features: { practice: true, exams: true } });
    const mk = (topic, skillType) => Question.create({
      type: "mcq", question: `${topic.title} ${skillType}?`, options: [{ key: "A", text: "x" }, { key: "B", text: "y" }], correctOption: "A",
      marks: 1, status: "published", subject: subject._id, chapter: chapter._id, topic: topic._id, skillType,
    });
    const qL = await mk(lenses, "recall");
    const qM = await mk(mirrors, "analysis");
    const st = (n, extra = {}) => Student.create({ name: `${n} PR`, email: `${n.toLowerCase()}${Date.now()}@pr.io`, password: "x".repeat(12), ...extra });
    const me = await st("Me");
    const peer = await st("Peer");
    const gone = await st("Gone", { deletedAt: new Date() });

    const day = 86400000;
    const attempt = (student, q, ok, ago) => ({ student: student._id, batch: batch._id, question: q._id, topic: q.topic, chapter: q.chapter, isCorrect: ok, timeSpentMs: 20000, createdAt: new Date(Date.now() - ago) });
    const rows = [];
    for (let i = 0; i < 12; i += 1) rows.push(attempt(me, qL, true, (i % 3) * day + 1000));
    for (let i = 0; i < 4; i += 1) rows.push(attempt(me, qM, i === 0, 3 * day + 2000));
    for (let i = 0; i < 6; i += 1) rows.push(attempt(peer, qL, i < 3, day));
    for (let i = 0; i < 6; i += 1) rows.push(attempt(peer, qM, i < 5, day));
    await PracticeAttempt.insertMany(rows);

    const e1 = await Exam.create({ title: "Mock 1", durationMinutes: 30, questions: [qL._id], batches: [batch._id], isPublished: true });
    const e2 = await Exam.create({ title: "Mock 2", durationMinutes: 30, questions: [qL._id], batches: [batch._id], isPublished: true });
    const sub = (s, exam, marks, ago) => Submission.create({ exam: exam._id, student: s._id, batch: batch._id, status: "graded", marks, totalMarks: 10, submittedAt: new Date(Date.now() - ago), answers: [] });
    await sub(me, e1, 4, 10 * day);
    await sub(me, e2, 7, 5 * day);
    await sub(peer, e1, 8, 10 * day);
    await sub(peer, e2, 6, 5 * day);
    await sub(gone, e1, 10, 10 * day);
    await sub(gone, e2, 10, 5 * day);

    const p = await progress.forStudent(me._id, batch._id, { timezone: "Asia/Dhaka" });
    check("counts practice questions, accuracy and time", p.stats.questions === 16 && p.stats.accuracy === 81 && p.speed.seconds === 20 && p.speed.batchSeconds === 20, { stats: p.stats, speed: p.speed });
    const recall = p.skills.find((s) => s.skill === "recall");
    const analysis = p.skills.find((s) => s.skill === "analysis");
    check("skills: you against the pooled batch", recall.you === 100 && recall.batch === 83 && analysis.you === 25 && analysis.batch === 60, { recall, analysis });
    check("skills with no answers stay empty", p.skills.find((s) => s.skill === "application").you === null);
    check("exam journey in date order with the batch average", p.exams.length === 2 && p.exams[0].title === "Mock 1" && p.exams[0].you === 40 && p.exams[0].batch === 60 && p.exams[1].batch === 65, p.exams);
    check("standing leaves out deleted accounts", p.standing && p.standing.of === 2 && p.standing.rank === 2 && p.standing.beats === 0 && p.standing.avg === 55, p.standing);
    check("spread of scores has one bar per 10 points", p.standing.bins.length === 10 && p.standing.bins[5] === 1 && p.standing.bins[7] === 1 && p.standing.myBin === 5, p.standing.bins);
    const topics = p.topics[0]?.topics || [];
    const tl = topics.find((t) => t.title === "Lenses");
    const tm = topics.find((t) => t.title === "Mirrors");
    check("topic map grouped under the chapter", p.topics.length === 1 && p.topics[0].title === "Optics PR" && topics.length === 2, p.topics);
    check("topic levels: mastered and weak", tl?.level === "mastered" && tm?.level === "weak" && tm.batch === 60, { tl, tm });
    check("streak counts today and the days before", p.stats.streak === 4 && p.activity.bestStreak === 4, { streak: p.stats.streak, best: p.activity.bestStreak });
    check("heatmap covers 16 weeks", p.activity.days.length === 112 && p.activity.days[111].count > 0);
    const earned = new Set(p.badges.filter((b) => b.earned).map((b) => b.key));
    check("badges earned from real work", ["first_steps", "hot_streak", "topic_master", "debut", "comeback"].every((k) => earned.has(k)) && !earned.has("century") && !earned.has("podium"), [...earned]);
    check("no lecture badge when the batch has no lectures", !p.badges.some((b) => b.key === "bookworm"));
    check("first quest fixes the weakest topic", p.quests[0]?.kind === "topic" && p.quests[0].link === `/batches/${batch._id}/practice/${mirrors._id}`, p.quests);
    check("XP and level follow the work", p.level.xp > 0 && p.level.level >= 2, p.level);
    check("plain notes name the best skill", p.notes.some((n) => n.text === "Best skill: Recall / Definition, 100%."), p.notes);

    const AppSettings = require("../models/appSettingsModel");
    const settingsCtl = require("../controllers/admin/settingsController");
    const sres = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await settingsCtl.updateSettings({ body: { studentUi: { levelTitles: ["  Cadet  ", "x".repeat(40)] } }, user: { role: "owner" } }, sres, (e) => { throw e; });
    AppSettings.clearCache?.();
    const saved = (await AppSettings.get()).studentUi.levelTitles;
    check("saved level names are trimmed, cut to 24 and padded to 8", saved.length === 8 && saved[0] === "Cadet" && saved[1].length === 24 && saved[7] === "", saved);
    const renamed = await progress.forStudent(me._id, batch._id, {});
    check("the progress page uses the saved names", renamed.level.title === levelFor(renamed.level.xp, saved).title && renamed.level.title !== levelFor(renamed.level.xp).title, renamed.level);

    const fresh = await st("Fresh");
    const empty = await progress.forStudent(fresh._id, batch._id, {});
    check("a new student gets an empty, valid page", empty.stats.questions === 0 && empty.standing === null && empty.exams.length === 0 && empty.level.level === 1 && empty.topics.length === 0, empty.stats);

    const res = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await ctl.getProgress({ student: me, batch: await Batch.findById(batch._id), query: { tz: "UTC" } }, res, (e) => { throw e; });
    check("the route answers for the student", res.code === 200 && res.body.stats.questions === 16);
    const offBatch = await Batch.findById(batch._id);
    offBatch.features.exams = false;
    await ctl.getProgress({ student: me, batch: offBatch, query: {} }, res, (e) => { throw e; });
    check("exam badges hide when the batch has no exams", !res.body.badges.some((b) => b.key === "debut"));

    await mongoose.disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
