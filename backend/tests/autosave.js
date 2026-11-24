// Buffered exam autosave (utils/autosave.js, Pro with Redis): saves held in
// Redis are never lost — handed in, resumed or written by the flusher —
// the same saves are refused as before, and the database sees far fewer
// writes. Then the sweeper closing attempts whose time is up.
// Needs TEST_MONGO_URL and TEST_REDIS_URL.
process.env.NODE_ENV = "test";
process.env.SETTINGS_CACHE_MS = "0";
if (!process.env.TEST_MONGO_URL || !process.env.TEST_REDIS_URL) {
  console.log("TEST_MONGO_URL and TEST_REDIS_URL are needed, skipped.");
  process.exit(0);
}
process.env.REDIS_URL = process.env.TEST_REDIS_URL;
process.env.REDIS_PREFIX = `examai-astest-${process.pid}:`;
const mongoose = require("mongoose");

let passed = 0;
let failed = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { passed += 1; console.log(`  ok    ${label}`); }
  else { failed += 1; console.log(`  FAIL  ${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
};

(async () => {
  await mongoose.connect(process.env.TEST_MONGO_URL.replace(/\/[^/]*$/, "/autosave_test"));
  await mongoose.connection.db.dropDatabase();
  const Exam = require("../models/examModel");
  const Submission = require("../models/submissionModel");
  const Perf = require("../models/performanceSettingsModel");
  const { Mcq } = require("../models/questionModel");
  const autosave = require("../utils/autosave");
  const { startExam } = require("../controllers/app/examController");
  const { saveAnswer, submitExam } = require("../controllers/app/submissionController");
  await Perf.create({ singleton: "performance", autosave: "buffered" });

  const studentId = new mongoose.Types.ObjectId();
  const batchId = new mongoose.Types.ObjectId();
  const base = { subject: new mongoose.Types.ObjectId(), chapter: new mongoose.Types.ObjectId(), options: [{ key: "A", text: "a" }, { key: "B", text: "b" }], marks: 1 };
  const [q1, q2] = await Mcq.create([{ ...base, question: "One?", correctOption: "A" }, { ...base, question: "Two?", correctOption: "B" }]);
  const exam = await Exam.create({ title: "Buffer", durationMinutes: 30, questions: [q1._id, q2._id], batches: [batchId], isPublished: true, isActive: true, attemptsAllowed: 5 });

  const call = (fn, req) => new Promise((resolve) => {
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ code: this.statusCode, body: b }); } };
    fn({ body: {}, student: { _id: studentId }, batch: { _id: batchId, features: {} }, ...req }, res, (err) => resolve({ code: res.statusCode >= 400 ? res.statusCode : 500, body: { message: err?.message } }));
  });
  const start = (body = {}) => call(startExam, { params: { id: String(exam._id) }, body });
  const save = (id, body, student = studentId) => call(saveAnswer, { params: { id: String(id) }, body, student: { _id: student } });
  const stored = async (id) => (await Submission.findById(id).lean()).answers.map((a) => a.selectedOption);

  console.log("held, then written");
  const s1 = (await start()).body.submissionId;
  check("a save is accepted", (await save(s1, { questionId: String(q1._id), selectedOption: "A", timeSpentMs: 1000 })).body, { saved: true });
  await save(s1, { questionId: String(q1._id), timeSpentMs: 500 });
  check("…and held, not yet in the database", await stored(s1), [null, null]);
  await autosave.flushAll();
  check("the writer puts it in the database", await stored(s1), ["A", null]);
  check("…time spent adds up", (await Submission.findById(s1).lean()).answers[0].timeSpentMs, 1500);

  console.log("\nnever lost");
  await save(s1, { questionId: String(q2._id), selectedOption: "B" });
  const resumed = await start();
  check("coming back to the exam writes held answers first", [resumed.code, await stored(s1)], [200, ["A", "B"]]);
  await save(s1, { questionId: String(q1._id), selectedOption: "B" });
  const submitted = await call(submitExam, { params: { id: String(s1) } });
  const done = await Submission.findById(s1).lean();
  check("handing in right after a save scores that save", [submitted.body.status, done.answers.map((a) => a.selectedOption), done.marks], ["graded", ["B", "B"], 1]);
  check("a save after handing in is refused", (await save(s1, { questionId: String(q1._id), selectedOption: "A" })).code, 400);

  console.log("\nthe same refusals as before");
  const s2 = (await start({ newAttempt: true })).body.submissionId;
  check("someone else's attempt", (await save(s2, { questionId: String(q1._id), selectedOption: "A" }, new mongoose.Types.ObjectId())).code, 404);
  check("a question not in the attempt", (await save(s2, { questionId: String(new mongoose.Types.ObjectId()), selectedOption: "A" })).code, 400);
  check("a value that isn't an answer", (await save(s2, { questionId: String(q1._id), selectedOption: { not: "an option" } })).code, 400);
  check("images when the batch doesn't allow them", (await save(s2, { questionId: String(q1._id), answerImages: ["/x.png"] })).code, 403);
  await Submission.updateOne({ _id: s2 }, { $set: { startedAt: new Date(Date.now() - 2 * 3600000) } });
  require("../utils/shared").redis.del(`${process.env.REDIS_PREFIX}as:m:${s2}`);
  check("past the deadline", (await save(s2, { questionId: String(q1._id), selectedOption: "A" })).code, 400);

  console.log("\nthe sweeper");
  await autosave.sweep();
  check("an attempt whose time is up is closed and scored without anyone looking", (await Submission.findById(s2).lean()).status, "graded");

  console.log("\ndatabase writes: buffered vs direct");
  let writes = 0;
  mongoose.set("debug", (coll, method) => { if (coll === "submissions" && /update|save|insert|replace/i.test(method)) writes += 1; });
  const s3 = (await start({ newAttempt: true })).body.submissionId;
  writes = 0;
  for (let i = 0; i < 100; i += 1) await save(s3, { questionId: String(q1._id), selectedOption: i % 2 ? "A" : "B", timeSpentMs: 100 });
  await autosave.flushAll();
  const bufferedWrites = writes;
  await Perf.updateOne({}, { $set: { autosave: "direct" } });
  writes = 0;
  for (let i = 0; i < 100; i += 1) await save(s3, { questionId: String(q2._id), selectedOption: i % 2 ? "A" : "B", timeSpentMs: 100 });
  const directWrites = writes;
  mongoose.set("debug", false);
  console.log(`        100 saves: ${bufferedWrites} database write(s) buffered, ${directWrites} direct`);
  check("buffered: one write for a hundred saves", bufferedWrites, 1);
  check("direct: a write per save", directWrites, 100);
  check("…and both kept every answer and all the time", [await stored(s3), (await Submission.findById(s3).lean()).answers.map((a) => a.timeSpentMs)], [["A", "A"], [10000, 10000]]);

  const shared = require("../utils/shared");
  const keys = await shared.redis.keys(`${process.env.REDIS_PREFIX}*`);
  if (keys.length) await shared.redis.del(...keys);
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
  console.log(`\n${passed} passed, ${failed} failed`);
  console.log(failed === 0 ? "PASS" : "FAIL");
  process.exit(failed === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
