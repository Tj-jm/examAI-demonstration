// Saved AI results served again (utils/aiReuse.pro.js): each admin mode,
// what the student is charged, approval, and retiring on a question edit.
// Needs TEST_MONGO_URL (a throwaway database).
process.env.NODE_ENV = "test";
process.env.SETTINGS_CACHE_MS = "0";
const mongoose = require("mongoose");

let passed = 0;
let failed = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { passed += 1; console.log(`  ok    ${label}`); }
  else { failed += 1; console.log(`  FAIL  ${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  if (!process.env.TEST_MONGO_URL) { console.log("TEST_MONGO_URL not set, skipped."); process.exit(0); }
  await mongoose.connect(process.env.TEST_MONGO_URL);
  const { Question, Mcq } = require("../models/questionModel");
  const Perf = require("../models/performanceSettingsModel");
  const AiUsage = require("../models/aiUsageModel");
  const Saved = require("../models/savedAiResultModel.pro");
  // The daily-allowance sum uses $ifNull, which some MongoDB-compatible
  // test servers lack; it isn't what's under test here.
  require("../ai/usage").sumCostToday = async () => 0;
  const reuse = require("../utils/aiReuse.pro");
  await Promise.all([Question.deleteMany({}), Perf.deleteMany({}), AiUsage.deleteMany({}), Saved.deleteMany({})]);

  const setReuse = async (values) => {
    const s = await Perf.get();
    for (const [k, v] of Object.entries(values)) s.set(`reuse.${k}`, v);
    await s.save();
  };

  const q = await Mcq.create({
    subject: new mongoose.Types.ObjectId(), chapter: new mongoose.Types.ObjectId(),
    question: "What is 2 + 2?", options: [{ key: "A", text: "3" }, { key: "B", text: "4" }], correctOption: "B",
  });
  const [a, b, c, d] = [1, 2, 3, 4].map(() => new mongoose.Types.ObjectId());

  let calls = 0;
  const gen = () => { calls += 1; return Promise.resolve({ data: { questions: [`set ${calls}`] }, usage: { model: "m", promptTokens: 10, completionTokens: 10 } }); };
  const ask = (student, question = q) => reuse.similar({ question, feature: "practice-similar", student, batch: null, generate: gen, makeSet: gen });
  const lastUsage = async () => AiUsage.findOne({}).sort({ createdAt: -1, _id: -1 }).lean();

  console.log("similar questions: mix");
  await setReuse({ similar: "mix", poolSize: 3, servesPerSet: 50, approval: "auto", savedCharge: "reduced" });
  check("first ask makes a set", [await ask(a), calls], [{ questions: ["set 1"] }, 1]);
  check("the same student asking again gets a new set", [await ask(a), calls], [{ questions: ["set 2"] }, 2]);
  check("another student is served a saved set, no AI call", [(await ask(b)).questions[0].startsWith("set"), calls], [true, 2]);
  await wait(50);
  const u = await lastUsage();
  check("…billed at the saved price, marked reused", [u.feature, u.reused, u.featureCost], ["practice-similar-saved", true, 1]);
  check("…and served a set it hasn't seen next", [(await ask(b)).questions[0].startsWith("set"), calls], [true, 2]);
  check("a third new set fills the pool", [await ask(b), calls], [{ questions: ["set 3"] }, 3]);
  await ask(c); await ask(c); await ask(c);
  check("a full pool serves seen sets rather than make more… for a new student", calls, 3);
  check("pool holds three", await Saved.countDocuments({ kind: "similar" }), 3);

  console.log("\nsimilar questions: top-up after servesPerSet");
  await Saved.deleteMany({}); calls = 0;
  await setReuse({ servesPerSet: 1 });
  await ask(a); // set 1, served once
  await ask(b); // served set 1 → every set used once → top-up
  await wait(300);
  check("a background set is made once every set is used", [calls, await Saved.countDocuments({ kind: "similar", status: "active" })], [2, 2]);

  console.log("\nsimilar questions: fresh and saved");
  await Saved.deleteMany({}); calls = 0;
  await setReuse({ similar: "fresh", servesPerSet: 50 });
  await ask(a); await ask(b);
  check("fresh: every ask calls the AI and nothing is kept", [calls, await Saved.countDocuments({})], [2, 0]);
  await setReuse({ similar: "saved" });
  await ask(a); await ask(a); await ask(b);
  check("saved: only the first ask calls the AI", calls, 3);

  console.log("\napproval");
  await Saved.deleteMany({}); calls = 0;
  await setReuse({ similar: "mix", approval: "review" });
  await ask(a);
  check("a new set waits for review", (await Saved.findOne({})).status, "pending_review");
  await ask(b);
  check("…so the next student gets fresh AI", calls, 2);
  await Saved.updateMany({}, { $set: { status: "active" } });
  await ask(c);
  check("approved sets are served", calls, 2);

  console.log("\ncharges");
  await setReuse({ savedCharge: "free" });
  await ask(d); await wait(50);
  check("free: nothing charged", (await lastUsage()).featureCost, 0);
  await setReuse({ savedCharge: "full" });
  await ask(d); await wait(50);
  check("full: the normal price", [(await lastUsage()).feature, (await lastUsage()).featureCost], ["practice-similar", 2]);

  console.log("\nan edited question gets new results");
  await setReuse({ savedCharge: "reduced", approval: "auto" });
  calls = 0;
  q.question = "What is 3 + 3?";
  await q.save();
  await ask(new mongoose.Types.ObjectId());
  check("old sets aren't served for the edited question", calls, 1);
  const retired = await reuse.retireStale();
  check("…and are retired", [retired > 0, await Saved.countDocuments({ status: "retired" }) > 0], [true, true]);
  q.difficulty = "hard";
  await q.save();
  await ask(new mongoose.Types.ObjectId());
  check("a change that isn't content (difficulty) keeps them", calls, 1);

  console.log("\nhints");
  await Saved.deleteMany({});
  let hintCalls = 0;
  const hintGen = (level) => () => { hintCalls += 1; return Promise.resolve({ hint: `hint ${level} #${hintCalls}`, usage: { model: "m" } }); };
  const hint = (student, level, previousHints) =>
    reuse.hint({ question: q, level, previousHints, feature: "practice-hint", student, batch: null, generate: hintGen(level) });
  const h1 = await hint(a, 1, []);
  check("hint 1 is made once…", [await hint(b, 1, []), hintCalls], [h1, 1]);
  const h2 = await hint(a, 2, [h1]);
  check("hint 2 follows the saved hint 1 and is kept", [await hint(b, 2, [h1]), hintCalls], [h2, 2]);
  await hint(c, 2, ["a hint this student got elsewhere"]);
  check("a different hint 1 gets a fresh hint 2, not saved", [hintCalls, (await Saved.findOne({ kind: "hint" })).hints.length], [3, 2]);
  await setReuse({ hints: "fresh" });
  await hint(d, 1, []);
  check("hints: fresh always asks", hintCalls, 4);

  console.log("\nexplanations");
  let exCalls = 0;
  const exGen = () => { exCalls += 1; return Promise.resolve({ data: { explanation: `why #${exCalls}` }, usage: { model: "m" } }); };
  const explain = (student, selectedOption) =>
    reuse.explanation({ question: q, answer: { selectedOption }, feature: "practice-explain", student, batch: null, generate: exGen });
  const eA = await explain(a, "A");
  check("the same wrong answer is explained once", [await explain(b, "A"), exCalls], [eA, 1]);
  await explain(c, "C");
  check("another wrong answer gets its own", exCalls, 2);
  await setReuse({ explanations: "fresh" });
  await explain(d, "A");
  check("explanations: fresh always asks", exCalls, 3);

  await Promise.all([Question.deleteMany({}), Perf.deleteMany({}), AiUsage.deleteMany({}), Saved.deleteMany({})]);
  await mongoose.disconnect();
  console.log(`\n${"-".repeat(50)}\n${passed} passed, ${failed} failed`);
  console.log(failed === 0 ? "PASS" : "FAIL");
  process.exit(failed === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
