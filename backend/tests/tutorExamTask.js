// The daily "Take <exam>" task (utils/tutor.js): attempts count per exam,
// not per batch, so one taken through another batch the exam is also in
// means no task; and an abandoned attempt that used the last try marks the
// task done instead of leaving "Go" on an exam with nothing left.
// Needs TEST_MONGO_URL (a throwaway database).

process.env.NODE_ENV = "test";
const mongoose = require("mongoose");

let passed = 0;
let failed = 0;
const check = (label, ok, detail) => {
  if (ok) { passed += 1; console.log(`  ok    ${label}`); }
  else { failed += 1; console.log(`  FAIL  ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`); }
};

(async () => {
  if (!process.env.TEST_MONGO_URL) { console.log("TEST_MONGO_URL not set, skipped."); process.exit(0); }
  await mongoose.connect(process.env.TEST_MONGO_URL);
  if (/test|tutor/i.test(mongoose.connection.name)) await mongoose.connection.db.dropDatabase();
  const Batch = require("../models/batchModel");
  const Student = require("../models/studentModel");
  const Exam = require("../models/examModel");
  const Submission = require("../models/submissionModel");
  const Tutor = require("../models/tutorModel");
  const tutor = require("../utils/tutor");

  const features = { exams: true, practice: false, lectures: false };
  const a = await Batch.create({ name: "A", accessType: "free", program: new mongoose.Types.ObjectId(), features });
  const b = await Batch.create({ name: "B", accessType: "free", program: new mongoose.Types.ObjectId(), features });
  const q = { _id: new mongoose.Types.ObjectId() }; // only needs to be non-empty
  const mk = (title, extra = {}) => Exam.create({ title, durationMinutes: 40, batches: [a._id, b._id], questions: [q._id], isPublished: true, isActive: true, ...extra });
  const examTasks = async (s, batch) => (await tutor.today(s._id, batch._id)).tasks.filter((t) => t.kind === "exam");
  const sub = (s, exam, batch, status, attempt = 1) => Submission.create({ exam: exam._id, student: s._id, batch: batch._id, attempt, status, submittedAt: new Date(), answers: [] });

  console.log("taken through another batch");
  const s1 = await Student.create({ name: "One", email: "one@example.com", password: "Passw0rd!x", isProfileComplete: true });
  const e1 = await mk("Notice exam");
  await sub(s1, e1, a, "submitted");
  let tasks = await examTasks(s1, b);
  check("no task to take it again in the other batch", !tasks.some((t) => String(t.refId) === String(e1._id)), tasks);

  console.log("\nabandoned");
  const s2 = await Student.create({ name: "Two", email: "two@example.com", password: "Passw0rd!x", isProfileComplete: true });
  tasks = await examTasks(s2, a);
  check("an open exam is today's task", tasks.length === 1 && String(tasks[0].refId) === String(e1._id) && !tasks[0].done, tasks);
  await sub(s2, e1, a, "abandoned");
  tasks = await examTasks(s2, a);
  check("its only attempt abandoned: done, not Go", tasks.length === 1 && tasks[0].done === true, tasks);

  const s3 = await Student.create({ name: "Three", email: "three@example.com", password: "Passw0rd!x", isProfileComplete: true });
  await Exam.updateOne({ _id: e1._id }, { $set: { attemptsAllowed: 2 } });
  await Tutor.deleteMany({});
  tasks = await examTasks(s3, a);
  await sub(s3, e1, a, "abandoned");
  tasks = await examTasks(s3, a);
  check("abandoned with a try left: still to do", tasks.length === 1 && !tasks[0].done, tasks);

  await mongoose.disconnect();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
