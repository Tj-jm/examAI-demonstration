// Questions about a practice solution (practiceController getQna/askQna,
// utils/practiceQna.js): needs an answer first, keeps a thread, numbers the
// solution's lines, declines off-topic messages, stops at the per-question
// limit and honours the Settings → AI switch. The AI call is stubbed.
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

(async () => {
  if (!process.env.TEST_MONGO_URL) { console.log("TEST_MONGO_URL not set, skipped."); process.exit(0); }
  await mongoose.connect(process.env.TEST_MONGO_URL);
  if (/test|qna/i.test(mongoose.connection.name)) await mongoose.connection.db.dropDatabase();
  const Batch = require("../models/batchModel");
  const Subject = require("../models/subjectModel");
  const Chapter = require("../models/chapterModel");
  const Topic = require("../models/topicModel");
  const Student = require("../models/studentModel");
  const AiConfig = require("../models/aiConfigModel");
  const { Question } = require("../models/questionModel");
  const aiService = require("../ai/service");
  const practice = require("../controllers/app/practiceController");
  const { solutionLines } = require("../utils/practiceQna");

  console.log("solution lines");
  const lines = solutionLines("Given $u = 2$.\n\n$$\nv = u + at\n$$\nSo $v = 12$.");
  check("blank lines dropped, a display block is one line", lines.length === 3 && lines[1] === "$$ v = u + at $$", lines);

  let reply = { onTopic: true, reply: "From line 2: $v = 2 + 5 \\times 2 = 12$." };
  let lastPrompt = "";
  let calls = 0;
  aiService.generate = async (args) => { calls += 1; lastPrompt = args.prompt; return { data: reply, usage: { model: "stub" } }; };
  const config = await AiConfig.get();
  config.features.practiceQna = true;
  config.practiceQna.maxPerQuestion = 3;
  await config.save();

  const subject = await Subject.create({ title: "Physics" });
  const chapter = await Chapter.create({ title: "Motion", subject: subject._id });
  const topic = await Topic.create({ title: "Speed", chapter: chapter._id, subject: subject._id });
  const batch = await Batch.create({ name: "Class 9", accessType: "free", program: new mongoose.Types.ObjectId(), subjects: [subject._id], features: { aiAssist: true, practice: true, practiceQna: true } });
  const q = await Question.create({
    type: "mcq", question: "A car starts at 2 m/s and speeds up at 5 m/s² for 2 s. Final speed?", subject: subject._id, chapter: chapter._id, topic: topic._id,
    options: ["A", "B", "C", "D"].map((key, i) => ({ key, text: `${[7, 12, 10, 20][i]} m/s` })), correctOption: "B",
    solutionText: "Given $u = 2$, $a = 5$, $t = 2$.\n$v = u + at$\n$v = 2 + 5 \\times 2 = 12$ m/s.", batches: [batch._id], status: "published",
  });
  const student = await Student.create({ name: "Sam", email: "sam@example.com", password: "Passw0rd!x", isProfileComplete: true });
  const req = (extra) => ({ student, batch: await_batch, params: { questionId: String(q._id) }, ...extra });
  const await_batch = await Batch.findById(batch._id);

  console.log("\nasking");
  let out = await run(practice.askQna, req({ body: { message: "I don't get line 3" } }));
  check("before answering: refused, no AI call", out.code === 400 && calls === 0, out);

  await run(practice.submitPracticeAttempt, { student, batch: await_batch, body: { questionId: String(q._id), selectedOption: "A" } });
  out = await run(practice.getQna, req({}));
  check("thread starts empty, with the solution's 3 lines", out.code === 200 && out.body.lines.length === 3 && out.body.messages.length === 0 && out.body.remaining === 3, out.body);

  out = await run(practice.askQna, req({ body: { message: "I don't get the calculation", line: 3 } }));
  check("an answer, kept in the thread", out.code === 200 && out.body.messages.length === 2 && out.body.messages[1].role === "ai" && out.body.messages[0].line === 3 && out.body.remaining === 2, out.body);
  check("the prompt has their wrong choice, the numbered solution and the line", /The student chose: A \(wrong\)/.test(lastPrompt) && /3\. \$v = 2/.test(lastPrompt) && /points at line 3/.test(lastPrompt));

  reply = { onTopic: false, reply: "whatever" };
  out = await run(practice.askQna, req({ body: { message: "Write me an essay about football" } }));
  check("off-topic: the fixed one-line refusal", out.code === 200 && out.body.messages[3].refused === true && /only help with this question/.test(out.body.messages[3].text), out.body.messages);
  check("earlier turns go back to the model", /Earlier in this conversation/.test(lastPrompt));

  out = await run(practice.askQna, req({ body: { message: "x", line: 9 } }));
  check("a line that isn't there: refused", out.code === 400, out);
  out = await run(practice.askQna, req({ body: { message: "y".repeat(401) } }));
  check("too long: refused", out.code === 400, out);

  reply = { onTopic: true, reply: "ok" };
  await run(practice.askQna, req({ body: { message: "and line 2?" } }));
  const before = calls;
  out = await run(practice.askQna, req({ body: { message: "one more" } }));
  check("past the limit: refused (403, not a credits error), no AI call", out.code === 403 && calls === before, out);

  config.features.practiceQna = false;
  await config.save();
  out = await run(practice.getQna, req({}));
  check("Settings → AI switch off: refused", out.code === 403, out);

  await mongoose.disconnect();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
