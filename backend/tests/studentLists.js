// The student's live class and exam lists: order and filter chips.
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
  fn(req, res, (e) => resolve({ code: res.code, err: e?.message }));
});

(async () => {
  if (!process.env.TEST_MONGO_URL) { console.log("TEST_MONGO_URL not set, skipped."); process.exit(0); }
  await mongoose.connect(process.env.TEST_MONGO_URL);
  if (/test|lists/i.test(mongoose.connection.name)) await mongoose.connection.db.dropDatabase();
  const LiveClass = require("../models/liveClassModel");
  const Exam = require("../models/examModel");
  const Submission = require("../models/submissionModel");
  const Batch = require("../models/batchModel");
  const { getLiveClasses } = require("../controllers/app/liveClassController");
  const { getExams } = require("../controllers/app/examController");

  const batch = await Batch.create({ name: "Lists", accessType: "free", program: new mongoose.Types.ObjectId() });
  const h = 3600000;
  const now = Date.now();
  const lc = (title, at, status) => LiveClass.collection.insertOne({ title, batch: batch._id, scheduledAt: new Date(now + at), durationMinutes: 60, status, provider: "livekit", mode: "class", secured: false, registrants: [], recordings: [] });
  await lc("Old ended", -72 * h, "ended");
  await lc("Yesterday ended", -24 * h, "ended");
  await lc("Never started", -30 * h, "scheduled");
  await lc("Next week", 168 * h, "scheduled");
  await lc("Tomorrow", 24 * h, "scheduled");
  await lc("Now", -0.2 * h, "live");
  const req = (query) => ({ params: { batchId: String(batch._id) }, query });

  console.log("\nlive classes");
  let out = await run(getLiveClasses, req({}));
  const titles = out.body.liveClasses.map((l) => l.title);
  check("live now first, then upcoming soonest first, then past newest first", titles.join("|") === "Now|Tomorrow|Next week|Yesterday ended|Never started|Old ended", titles);
  check("counts for the chips", JSON.stringify(out.body.counts) === JSON.stringify({ all: 6, live: 1, upcoming: 2, past: 3 }), out.body.counts);
  out = await run(getLiveClasses, req({ filter: "upcoming" }));
  check("upcoming filter", out.body.liveClasses.map((l) => l.title).join("|") === "Tomorrow|Next week");
  out = await run(getLiveClasses, req({ filter: "past", limit: 2, page: 2 }));
  check("past filter pages across the whole list", out.body.liveClasses.map((l) => l.title).join("|") === "Old ended" && out.body.pages === 2, out.body);
  out = await run(getLiveClasses, req({ filter: "nonsense" }));
  check("an unknown filter shows everything", out.body.filter === "all" && out.body.liveClasses.length === 6);
  out = await run(getLiveClasses, req({ filter: "past" }));
  check("a class that never started counts as past", out.body.liveClasses.some((l) => l.title === "Never started" && l.phase === "past"));
  // Nothing tells the server a Zoom or link class ended unless someone does.
  await LiveClass.collection.insertMany([
    { title: "Zoom left on", batch: batch._id, scheduledAt: new Date(now - 6 * h), durationMinutes: 60, status: "live", provider: "zoom", registrants: [], recordings: [] },
    { title: "Zoom running late", batch: batch._id, scheduledAt: new Date(now - 2 * h), durationMinutes: 60, status: "live", provider: "zoom", registrants: [], recordings: [] },
  ]);
  out = await run(getLiveClasses, req({}));
  const phase = (t) => out.body.liveClasses.find((l) => l.title === t)?.phase;
  check("a link class still marked live 3+ hours after its end counts as past", phase("Zoom left on") === "past");
  check("one running an hour over is still live", phase("Zoom running late") === "live");
  await LiveClass.deleteMany({ title: /^Zoom / });

  console.log("\nexams");
  const student = { _id: new mongoose.Types.ObjectId() };
  const q = new mongoose.Types.ObjectId();
  const ex = (title, extra) => Exam.collection.insertOne({ title, batches: [batch._id], isPublished: true, isActive: true, createdByStudent: null, mode: "test", durationMinutes: 30, attemptsAllowed: 1, questions: [q], createdAt: new Date(), ...extra });
  await ex("Open one", {});
  await ex("Later", { opensAt: new Date(now + 48 * h) });
  await ex("Inactive", { isActive: false });
  const taken = await ex("Taken", {});
  await Submission.collection.insertOne({ exam: taken.insertedId, student: student._id, batch: batch._id, status: "graded", attempt: 1, answers: [], marks: 5, totalMarks: 10 });
  const names = async (filter) => (await run(getExams, { batch, student, query: filter ? { filter } : {} })).body;
  const all = await names();
  check("all exams with counts", all.exams.length === 4 && JSON.stringify(all.counts) === JSON.stringify({ all: 4, open: 1, upcoming: 1, taken: 1, closed: 1 }), all.counts);
  check("open: can start now", (await names("open")).exams.map((e) => e.title).join() === "Open one");
  check("upcoming: opens later", (await names("upcoming")).exams.map((e) => e.title).join() === "Later");
  check("taken: has an attempt", (await names("taken")).exams.map((e) => e.title).join() === "Taken");
  check("closed: window closed", (await names("closed")).exams.map((e) => e.title).join() === "Inactive");

  await mongoose.disconnect();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
