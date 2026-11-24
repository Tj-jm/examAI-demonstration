// The kept-current leaderboard (utils/leaderboard.js, Pro): after each kind
// of change, the board matches the from-scratch database query. Runs with
// Redis when TEST_REDIS_URL is set (a sorted set per batch), and again
// without (a cache dropped on each change). Needs TEST_MONGO_URL.
process.env.NODE_ENV = "test";
process.env.SETTINGS_CACHE_MS = "0";
const { execFileSync } = require("child_process");

if (!process.env.TEST_MONGO_URL) { console.log("TEST_MONGO_URL not set, skipped."); process.exit(0); }

// The parent runs both modes as children: the Redis connection is chosen
// when the app's modules load.
if (!process.env.LB_MODE) {
  let bad = 0;
  for (const mode of ["memory", ...(process.env.TEST_REDIS_URL ? ["redis"] : [])]) {
    console.log(`\n== ${mode} ==`);
    const env = { ...process.env, LB_MODE: mode, REDIS_PREFIX: `examai-lbtest-${process.pid}:` };
    if (mode === "redis") env.REDIS_URL = process.env.TEST_REDIS_URL;
    else delete env.REDIS_URL;
    try { execFileSync(process.execPath, [__filename], { stdio: "inherit", env }); } catch { bad += 1; }
  }
  if (!process.env.TEST_REDIS_URL) console.log("\nredis: skipped (set TEST_REDIS_URL to run)");
  process.exit(bad ? 1 : 0);
}

const mongoose = require("mongoose");
let passed = 0;
let failed = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { passed += 1; console.log(`  ok    ${label}`); }
  else { failed += 1; console.log(`  FAIL  ${label}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await mongoose.connect(process.env.TEST_MONGO_URL.replace(/\/[^/]*$/, `/lb_${process.env.LB_MODE}`));
  const Submission = require("../models/submissionModel");
  const Exam = require("../models/examModel");
  const Perf = require("../models/performanceSettingsModel");
  const leaderboard = require("../utils/leaderboard");
  // The ranking query in plain JS (the same rules, per student via
  // computeOne): the test database lacks $multiply.
  const jsCompute = async (batchId) => {
    const students = await Submission.distinct("student", { batch: batchId, status: "graded" });
    const out = [];
    for (const s of students) {
      const one = await leaderboard.computeOne(batchId, s);
      if (one) out.push({ _id: s, ...one });
    }
    return out.sort((a, b) => b.avgPercent - a.avgPercent || String(b._id).localeCompare(String(a._id)));
  };
  leaderboard._useCompute(jsCompute);
  await Promise.all([Submission.deleteMany({}), Exam.collection.deleteMany({}), Perf.deleteMany({})]);
  await Perf.create({ singleton: "performance", leaderboard: "live" });

  const id = () => new mongoose.Types.ObjectId();
  const batch = id();
  const [e1, e2, e3] = [id(), id(), id()];
  const [s1, s2, s3, s4] = [id(), id(), id(), id()];
  const add = (student, exam, marks, status = "graded", attempt = 1) =>
    Submission.collection.insertOne({ batch, exam, student, status, marks, totalMarks: 20, attempt, answers: [] });

  await add(s1, e1, 18); await add(s1, e2, 10);
  await add(s2, e1, 12); await add(s2, e1, 16, "graded", 2); // retake: the best counts
  await add(s3, e2, 20);
  await add(s4, e1, 5, "in_progress");

  // Board vs a from-scratch query, as the student sees them.
  const view = (b) => ({
    top: b.top.map((r) => [String(r._id), Math.round(r.avgPercent * 10) / 10, r.examsCount, r.rank]),
    me: b.me && [b.me.rank, Math.round(b.me.avgPercent * 10) / 10, b.me.examsCount],
    total: b.total,
  });
  const truth = async (student) => {
    const rows = await jsCompute(batch);
    const ranked = rows.map((r, i) => ({ ...r, rank: i + 1 }));
    return view({ top: ranked.slice(0, 10), me: ranked.find((r) => String(r._id) === String(student)) || null, total: ranked.length });
  };
  const same = async (label, student = s1) => {
    await wait(30);
    check(label, view(await leaderboard.read(batch, student)), await truth(student));
  };

  await same("first view is built from the database");
  check("best attempt per exam, averaged; attempts in progress don't count", (await leaderboard.read(batch, s2)).me.avgPercent, 80);

  const sub = await Submission.findOne({ student: s4 });
  sub.status = "graded";
  sub.marks = 19;
  await sub.save();
  await same("a submission graded (saved) joins the board at once", s4);

  const s3sub = await Submission.findOne({ student: s3 });
  s3sub.marks = 2;
  await s3sub.save();
  await same("a regrade moves the student at once", s3);

  const answers = await Submission.findOne({ student: s1, exam: e2 });
  answers.answers = [];
  answers.lastSavedAt = new Date();
  await Submission.updateOne({ _id: answers._id }, { $set: { lastSavedAt: new Date() } });
  await same("an autosave changes nothing");

  await Submission.updateMany({ batch, student: s2 }, { $set: { marks: 20 } });
  await same("a bulk update in the batch is picked up", s2);

  await Submission.deleteMany({ student: s1 });
  await same("deleted submissions leave the board", s1);
  check("…a student with nothing graded has no standing", (await leaderboard.read(batch, s1)).me, null);

  await Exam.collection.insertOne({ _id: e3, title: "t", createdByStudent: s3 });
  await add(s3, e3, 20);
  await Submission.updateOne({ student: s3, exam: e3 }, { $set: { marks: 20 } });
  await same("a student's own practice paper never counts", s3);

  await Perf.updateOne({}, { $set: { leaderboard: "periodic", leaderboardMinutes: 5 } });
  const before = view(await leaderboard.read(batch, s2));
  await Submission.collection.updateMany({ student: s2 }, { $set: { marks: 0 } }); // no hooks
  check("periodic: a change waits for the next refresh", view(await leaderboard.read(batch, s2)), before);

  await Promise.all([Submission.deleteMany({}), Exam.collection.deleteMany({}), Perf.deleteMany({})]);
  await mongoose.disconnect();
  if (require("../utils/shared").redis) await require("../utils/shared").close?.();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
