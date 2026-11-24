// "Newest first" in the Questions list sorts by when a question went live
// (publishedAt), not when it was written — an AI question approved today is
// new today. These run the model's own hooks without a database.

process.env.NODE_ENV = "test";

const mongoose = require("mongoose");
const { Question } = require("../models/questionModel");

const base = { question: "x", subject: new mongoose.Types.ObjectId(), chapter: new mongoose.Types.ObjectId() };

let passed = 0;
let failed = 0;
const check = (label, ok, detail) => {
  if (ok) { passed += 1; console.log(`  ok    ${label}`); }
  else { failed += 1; console.log(`  FAIL  ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`); }
};

const runSave = (doc) => new Promise((resolve, reject) => Question.schema.s.hooks.execPre("save", doc, [{}], (err) => (err ? reject(err) : resolve())));
const runInsertMany = (docs) => new Promise((resolve, reject) => Question.hooks.execPre("insertMany", Question, [docs], (err) => (err ? reject(err) : resolve())));

(async () => {
  console.log("\nsave hook");
  {
    const q = new Question({ ...base });
    await runSave(q);
    check("a new published question gets a publish time", q.publishedAt instanceof Date);
  }
  {
    const q = new Question({ ...base, status: "pending_review" });
    await runSave(q);
    check("a pending question has none", !q.publishedAt);
    q.isNew = false; // as after its first save
    q.status = "published";
    await runSave(q);
    check("publishing it later sets one", q.publishedAt instanceof Date);
  }
  {
    const when = new Date("2020-01-01");
    const q = new Question({ ...base, publishedAt: when });
    await runSave(q);
    check("an existing publish time is kept", q.publishedAt.getTime() === when.getTime());
  }

  console.log("\ninsertMany hook");
  {
    const docs = [{ question: "a" }, { question: "b", status: "published" }, { question: "c", status: "pending_review" }];
    await runInsertMany(docs);
    check("default and published rows get a publish time", docs[0].publishedAt instanceof Date && docs[1].publishedAt instanceof Date);
    check("pending rows don't", !docs[2].publishedAt);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  console.log(failed ? "FAIL" : "PASS");
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
