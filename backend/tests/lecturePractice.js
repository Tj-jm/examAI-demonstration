// "Ace this lecture" questions made with AI (controllers/admin/lectureController.js):
// the type asked for, and that they stay in the lecture's quiz, out of batch
// practice (bank questions picked in still show there). Lecture pictures get
// permanent links (utils/noteImages.js). Also the Submissions page's tabs
// (controllers/admin/submissionsController.js). The AI call is stubbed.
// Needs TEST_MONGO_URL (a throwaway database).

process.env.NODE_ENV = "test";
const mongoose = require("mongoose");

let passed = 0;
let failed = 0;
const check = (label, ok, detail) => {
  if (ok) { passed += 1; console.log(`  ok    ${label}`); }
  else { failed += 1; console.log(`  FAIL  ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`); }
};
const run = (fn, req) => new Promise((resolve) => {
  const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
  fn({ query: {}, params: {}, body: {}, ...req }, res, (e) => resolve({ code: res.code >= 400 ? res.code : 500, err: e?.message }));
});

const mcq = (n) => ({ type: "mcq", question: `Q${n}?`, options: ["A", "B", "C", "D"].map((key) => ({ key, text: key })), correctOption: "A", solutionText: "A.", difficulty: "easy", skillType: "recall" });
const mtf = (n) => ({ type: "mtf", question: `S${n}`, statements: [{ text: "x", isTrue: true }, { text: "y", isTrue: false }, { text: "z", isTrue: true }], solutionText: "x.", difficulty: "easy", skillType: "recall" });

(async () => {
  if (!process.env.TEST_MONGO_URL) { console.log("TEST_MONGO_URL not set, skipped."); process.exit(0); }
  await mongoose.connect(process.env.TEST_MONGO_URL);
  if (/test|lect/i.test(mongoose.connection.name)) await mongoose.connection.db.dropDatabase();
  const Batch = require("../models/batchModel");
  const Subject = require("../models/subjectModel");
  const Chapter = require("../models/chapterModel");
  const Topic = require("../models/topicModel");
  const Lecture = require("../models/lectureModel");
  const Student = require("../models/studentModel");
  const User = require("../models/userModel");
  const Exam = require("../models/examModel");
  const Submission = require("../models/submissionModel");
  const AiConfig = require("../models/aiConfigModel");
  const aiService = require("../ai/service");
  const lectures = require("../controllers/admin/lectureController");
  const practice = require("../controllers/app/practiceController");
  const subs = require("../controllers/admin/submissionsController");

  let reply = [];
  let lastPrompt = "";
  aiService.generate = async (args) => { lastPrompt = args.prompt; return { data: { questions: reply }, usage: { model: "stub" } }; };
  const config = await AiConfig.get();
  config.features.questionGeneration = true;
  await config.save();

  const owner = await User.create({ name: "Owner", email: "o@example.com", password: "Passw0rd!x", role: "owner" });
  const subject = await Subject.create({ title: "Physics" });
  const chapter = await Chapter.create({ title: "Motion", subject: subject._id });
  const topic = await Topic.create({ title: "Speed", chapter: chapter._id, subject: subject._id });
  const batch = await Batch.create({
    name: "Class 9", accessType: "free", program: new mongoose.Types.ObjectId(), subjects: [subject._id],
    features: { aiAssist: true, lecturePracticeGeneration: true, practice: true },
  });
  // Filed at the chapter only: the case that used to vanish from practice.
  const lecture = await Lecture.create({ title: "Motion 1", subject: subject._id, chapter: chapter._id, bodyMarkdown: "Speed is distance over time.", batches: [batch._id], isPublished: true });
  const gen = (body) => run(lectures.generatePracticeQuestions, { user: owner, params: { id: String(lecture._id) }, body: { batchId: String(batch._id), count: 4, ...body } });

  console.log("ace this lecture: AI questions");
  const topicLecture = await Lecture.create({ title: "Motion 2", subject: subject._id, chapter: chapter._id, topic: topic._id, bodyMarkdown: "Speed.", batches: [batch._id], isPublished: true });
  const genFor = (lec, body) => run(lectures.generatePracticeQuestions, { user: owner, params: { id: String(lec._id) }, body: { batchId: String(batch._id), count: 4, ...body } });
  reply = [mcq(1), mtf(2), mcq(3)];
  let out = await genFor(topicLecture, { types: "mcq" });
  check("multiple choice only: the prompt asks for it", /Every question must be multiple-choice/.test(lastPrompt));
  check("a stray true/false is dropped", out.code === 200 && out.body.created.length === 2 && out.body.created.every((q) => q.type === "mcq"), out);
  reply = [mtf(4), mtf(5), mtf(6)];
  out = await gen({ types: "mtf" });
  check("true/false only", out.code === 200 && out.body.created.length === 3 && out.body.created.every((q) => q.type === "mtf"), out);
  reply = [mcq(7), mcq(8), mcq(9)];
  out = await gen({ types: "mtf" });
  check("nothing of the type asked for: an error, nothing saved", out.code === 502, out);

  // A bank question picked into the quiz, same topic.
  const { Question } = require("../models/questionModel");
  const bankQ = await Question.create({ ...mcq(10), subject: subject._id, chapter: chapter._id, topic: topic._id, batches: [batch._id], status: "published" });
  await run(lectures.setPracticeQuestions, { user: owner, params: { id: String(topicLecture._id) }, body: { batchId: String(batch._id), questionIds: [String(bankQ._id), ...(await Lecture.findById(topicLecture._id)).practiceQuestionSets[0].questions.map(String)] } });

  const student = await Student.create({ name: "Sam", email: "sam@example.com", password: "Passw0rd!x", isProfileComplete: true });
  const fresh = await Batch.findById(batch._id);
  out = await run(practice.getPracticeQuestions, { student, batch: fresh, query: { topic: String(topic._id) } });
  check("batch practice serves the bank question only, not the AI ones", out.code === 200 && out.body.questions.length === 1 && String(out.body.questions[0]._id) === String(bankQ._id), out.body.questions?.map((q) => q.question));
  const app = require("../controllers/app/lectureController");
  out = await run(app.getPracticeQuestions, { student, batch: fresh, params: { id: String(topicLecture._id) } });
  check("the lecture's quiz still has all of them", out.code === 200 && out.body.questions.length === 3, out.body);

  // Made before the rule: put back to lecture-only at start.
  await Question.updateMany({ source: "ai" }, { $set: { isForPractice: true } });
  const changed = await require("../utils/lectureQuiz").markAiLectureQuestions();
  check("older AI lecture questions are taken out of batch practice", changed === 5 && (await Question.countDocuments({ source: "ai", isForPractice: false })) === 5, changed);
  check("the bank question is left alone", (await Question.findById(bankQ._id)).isForPractice !== false);

  console.log("\nlecture pictures");
  const { stableImages } = require("../utils/noteImages");
  const k = "a".repeat(32);
  const md = [`![a](http://admin.example.com/media/questions/${k}.png)`, `![b](https://bucket.s3.amazonaws.com/questions/${k}.png?X-Amz-Signature=abc&X-Amz-Expires=3600)`, `![c](/media/lectures/${k}.jpg)`, "![d](https://example.org/pic.png)", `![e](/api/stream/file/lectures/${k}.png)`].join("\n");
  const fixedMd = stableImages(md).split("\n");
  check("admin address, signed link and /media all become permanent links", fixedMd[0] === `![a](/api/stream/file/questions/${k}.png)` && fixedMd[1] === `![b](/api/stream/file/questions/${k}.png)` && fixedMd[2] === `![c](/api/stream/file/lectures/${k}.jpg)`, fixedMd);
  check("other sites' pictures and permanent links are untouched", fixedMd[3] === "![d](https://example.org/pic.png)" && fixedMd[4] === `![e](/api/stream/file/lectures/${k}.png)`);
  topicLecture.bodyMarkdown = `Notes\n\n![fig](http://localhost:5174/media/questions/${k}.png)`;
  await topicLecture.save();
  check("saving a lecture fixes its pictures", (await Lecture.findById(topicLecture._id)).bodyMarkdown.includes(`(/api/stream/file/questions/${k}.png)`));

  console.log("\nsubmissions page tabs");
  const exam = await Exam.create({ title: "Physics", durationMinutes: 60, batches: [batch._id], isPublished: true });
  let attempt = 0;
  const make = (status, extra = {}) => { attempt += 1; return Submission.create({ exam: exam._id, student: student._id, batch: batch._id, attempt, status, submittedAt: new Date(), answers: [], ...extra }); };
  await make("in_progress");
  await make("submitted");
  await make("grading");
  await make("graded", { referral: { requested: true, reason: "x", requestedAt: new Date() } });
  await make("graded");
  await make("abandoned");
  await make("disqualified");
  out = await run(subs.getSubmissions, { user: owner, query: { view: "marking" } });
  check("waiting for marks: submitted and grading", out.code === 200 && out.body.total === 2 && out.body.submissions.every((s) => ["submitted", "grading"].includes(s.status)), out.body);
  check("counts for every tab", out.body.counts.all === 7 && out.body.counts.live === 1 && out.body.counts.done === 2 && out.body.counts.regrade === 1 && out.body.counts.void === 2, out.body.counts);
  out = await run(subs.getSubmissions, { user: owner, query: { view: "regrade" } });
  check("regrade asked", out.body.total === 1 && out.body.submissions[0].referral?.requested === true, out.body);
  out = await run(subs.getSubmissions, { user: owner, query: { status: "abandoned" } });
  check("a raw status still works", out.body.total === 1, out.body);

  await mongoose.disconnect();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
