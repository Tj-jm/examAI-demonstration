// Starting, resuming and timing out exam attempts (app/examController
// startExam), and closing a timed-out attempt with its saved answers the
// next time it's looked at. The student is told, rather than a new attempt
// silently starting at full time.

process.env.NODE_ENV = "test";
const mongoose = require("mongoose");

let passed = 0;
let failed = 0;
const check = (label, ok, detail) => {
  if (ok) { passed += 1; console.log(`  ok    ${label}`); }
  else { failed += 1; console.log(`  FAIL  ${label}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 300)}` : ""}`); }
};

const run = async () => {
  await mongoose.connect(process.env.TEST_MONGO_URL || "mongodb://127.0.0.1:27017/examai_test_attempts");
  await mongoose.connection.db.dropDatabase();
  const Exam = require("../models/examModel");
  const Submission = require("../models/submissionModel");
  const { startExam } = require("../controllers/app/examController");
  const { submitExam, getSubmission, logViolation } = require("../controllers/app/submissionController");
  const { awaySummary } = require("../utils/conduct");

  const call = (body = {}) => new Promise((resolve) => {
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ code: this.statusCode, body: b }); } };
    startExam({ params: { id: String(exam._id) }, body, student: { _id: studentId }, batch: { _id: batchId } }, res,
      (err) => resolve({ code: res.statusCode >= 400 ? res.statusCode : 500, body: { message: err?.message } }));
  });

  const asStudent = (fn, id, body = {}) => new Promise((resolve) => {
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ code: this.statusCode, body: b }); } };
    fn({ params: { id: String(id) }, body, student: { _id: studentId } }, res,
      (err) => resolve({ code: res.statusCode >= 400 ? res.statusCode : 500, body: { message: err?.message } }));
  });

  const studentId = new mongoose.Types.ObjectId();
  const batchId = new mongoose.Types.ObjectId();
  const exam = await Exam.create({ title: "Timer test", durationMinutes: 10, questions: [], batches: [batchId], isPublished: true, isActive: true, attemptsAllowed: 2 });

  console.log("\nstart and resume");
  const first = await call();
  check("starts attempt 1 with the server's time", first.code === 201 && Number.isFinite(first.body.serverNow), first);
  check("says whether the calculator is allowed (off unless the exam or batch allows it)", first.body.calculator === false, first.body.calculator);
  const again = await call();
  check("coming back resumes the same attempt", again.code === 200 && String(again.body.submissionId) === String(first.body.submissionId), again.body);

  console.log("\ntimed out");
  await Submission.updateOne({ _id: first.body.submissionId }, { $set: { startedAt: new Date(Date.now() - 60 * 60000) } });
  const late = await call();
  check("a timed-out attempt doesn't roll into a new one; the student is told", late.code === 409 && late.body.code === "ATTEMPT_TIMED_OUT" && late.body.nextAttempt === 2 && late.body.attemptsLeft === 1, late);
  const closed = await Submission.findById(first.body.submissionId);
  check("…and the old attempt is scored with what was saved, as of the deadline", closed.status === "graded" && closed.submittedAt.getTime() === closed.startedAt.getTime() + 10 * 60000 + exam.bufferSeconds * 1000, closed.status);
  const lateSubmit = await asStudent(submitExam, first.body.submissionId);
  check("an auto-submit arriving after that just gets the result", lateSubmit.code === 200 && lateSubmit.body.status === "graded", lateSubmit);
  check("…and no new attempt was made yet", (await Submission.countDocuments({ exam: exam._id })) === 1);
  const second = await call({ newAttempt: true });
  check("starting the next attempt on purpose works, at full time", second.code === 201 && String(second.body.submissionId) !== String(first.body.submissionId), second);

  console.log("\nlast attempt timed out");
  await Submission.updateOne({ _id: second.body.submissionId }, { $set: { startedAt: new Date(Date.now() - 60 * 60000) } });
  const none = await call();
  check("with no attempts left it says the attempt ran out of time", none.code === 403 && /ran out of time/.test(none.body.message), none);

  console.log("\nclosed when the result is opened");
  const exam2 = await Exam.create({ title: "Grace test", durationMinutes: 10, scriptGraceMinutes: 30, questions: [], batches: [batchId], isPublished: true, isActive: true, attemptsAllowed: 2 });
  const sub = await Submission.create({ exam: exam2._id, student: studentId, batch: batchId, attempt: 1, status: "in_progress", startedAt: new Date(Date.now() - 60 * 60000), answers: [] });
  const result = await asStudent(getSubmission, sub._id);
  check("opening an overdue attempt's result scores it", result.code === 200 && result.body.status === "graded", result.body);

  console.log("\nscript grace window");
  const written = { question: new mongoose.Types.ObjectId(), questionType: "written" };
  const graced = await Submission.create({ exam: exam2._id, student: studentId, batch: batchId, attempt: 2, status: "in_progress", startedAt: new Date(Date.now() - 20 * 60000), answers: [written] });
  const resume = await new Promise((resolve) => {
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ code: this.statusCode, body: b }); } };
    startExam({ params: { id: String(exam2._id) }, body: {}, student: { _id: studentId }, batch: { _id: batchId } }, res, (err) => resolve({ code: 500, body: { message: err?.message } }));
  });
  check("coming back inside the script grace window resumes, not closes", resume.code === 200 && String(resume.body.submissionId) === String(graced._id), resume);

  console.log("\ntime away");
  await asStudent(logViolation, graced._id, { type: "left-exam" });
  await Submission.updateOne({ _id: graced._id }, { $set: { "violations.0.at": new Date(Date.now() - 95000) } });
  const back = await asStudent(logViolation, graced._id, { type: "back" });
  const away = await Submission.findById(graced._id);
  check("leaving the exam page is flagged, and coming back stamps it", back.body.logged === true && away.violations[0].type === "left-exam" && away.violations[0].backAt, away.violations);
  check("the conduct note says how long", /Away from the exam 1 time, 1 min 35 s in all, left the exam page once\./.test(awaySummary(away.violations)), awaySummary(away.violations));
  check("never coming back is said too", /once without coming back/.test(awaySummary([{ type: "tab-hidden", at: new Date() }])));

  console.log("\nseveral attempts, submitted normally");
  const multi = await Exam.create({ title: "Three tries", durationMinutes: 10, awayMode: "off", questions: [], batches: [batchId], isPublished: true, isActive: true, attemptsAllowed: 3 });
  const learner = new mongoose.Types.ObjectId();
  const startAs = (body = {}) => new Promise((resolve) => {
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ code: this.statusCode, body: b }); } };
    startExam({ params: { id: String(multi._id) }, body, student: { _id: learner }, batch: { _id: batchId } }, res,
      (err) => resolve({ code: res.statusCode >= 400 ? res.statusCode : 500, body: { message: err?.message } }));
  });
  const submitAs = (id) => new Promise((resolve) => {
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ code: this.statusCode, body: b }); } };
    submitExam({ params: { id: String(id) }, body: {}, student: { _id: learner } }, res, (err) => resolve({ code: 500, body: { message: err?.message } }));
  });
  const ids = [];
  for (let n = 1; n <= 3; n += 1) {
    const s1 = await startAs();
    const again1 = await startAs();
    const done = await submitAs(s1.body.submissionId);
    ids.push(String(s1.body.submissionId));
    check(`attempt ${n}: starts fresh, resumes the same one, submits`, s1.code === 201 && String(again1.body.submissionId) === String(s1.body.submissionId)
      && done.body.status === "graded" && (await Submission.findById(s1.body.submissionId)).attempt === n, { s1: s1.code, done: done.body });
  }
  check("each attempt is its own submission", new Set(ids).size === 3);
  const fourth = await startAs();
  check("after the last attempt: no attempts remaining", fourth.code === 403 && /No attempts remaining/.test(fourth.body.message), fourth);
  const resubmit = await submitAs(ids[0]);
  check("submitting an old attempt again changes nothing", resubmit.code === 200 && resubmit.body.status === "graded" && (await Submission.countDocuments({ exam: multi._id })) === 3);

  console.log("\naway limit");
  const AppSettings = require("../models/appSettingsModel");
  const settings = await AppSettings.get();
  settings.conduct = { ...(settings.conduct?.toObject?.() || settings.conduct || {}), awayMode: "submit", awayMinutes: 3 };
  await settings.save();
  const defaulted = await Exam.create({ title: "Default away", durationMinutes: 30, questions: [], batches: [batchId], isPublished: true, isActive: true });
  check("a new exam takes the away limit from Conduct settings", defaulted.awayMode === "submit" && defaulted.awayMinutes === 3, { mode: defaulted.awayMode, min: defaulted.awayMinutes });
  const kept = await Exam.create({ title: "Own away", durationMinutes: 30, awayMode: "off", questions: [], batches: [batchId], isPublished: true, isActive: true });
  check("…unless the exam sets its own", kept.awayMode === "off");

  const awayAttempt = async (examDoc, minutesAway, back, student = new mongoose.Types.ObjectId()) => {
    const left = new Date(Date.now() - minutesAway * 60000);
    return Submission.create({
      exam: examDoc._id, student, batch: batchId, attempt: 1, status: "in_progress",
      startedAt: new Date(Date.now() - 20 * 60000), answers: [],
      violations: [{ type: "left-exam", at: left, backAt: back ? new Date() : null }],
    });
  };
  const { closeIfOverdue } = require("../utils/finishAttempt");
  const short = await awayAttempt(defaulted, 2, true);
  check("away less than the limit: the attempt stays open", (await closeIfOverdue(short, defaulted)) === false && short.status === "in_progress");
  const long = await awayAttempt(defaulted, 5, true);
  const longEnd = await closeIfOverdue(long, defaulted);
  const longDoc = await Submission.findById(long._id);
  check("submit mode: away too long scores what was saved, as of leaving + limit", longEnd === "away" && longDoc.status === "graded" && longDoc.awayEnd?.mode === "submit"
    && Math.abs(longDoc.submittedAt - (long.violations[0].at.getTime() + 3 * 60000)) < 1000, { end: longEnd, status: longDoc.status, awayEnd: longDoc.awayEnd });
  const strict = await Exam.create({ title: "Strict", durationMinutes: 30, awayMode: "abandon", awayMinutes: 3, questions: [], batches: [batchId], isPublished: true, isActive: true });
  const gone = await awayAttempt(strict, 6, false, studentId);
  await closeIfOverdue(gone, strict);
  const goneDoc = await Submission.findById(gone._id);
  check("abandon mode: never came back, attempt abandoned with zero", goneDoc.status === "abandoned" && goneDoc.awayEnd?.mode === "abandon" && goneDoc.awayEnd.back === false, { status: goneDoc.status, awayEnd: goneDoc.awayEnd });
  const seen = await asStudent(getSubmission, gone._id);
  check("…and the student is told why", /away from the exam for more than 3 minutes\. It scores zero/.test(seen.body.message), seen.body);

  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
  console.log("\n" + "-".repeat(50));
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("PASS");
};

run().catch((e) => { console.error(e); process.exit(1); });
