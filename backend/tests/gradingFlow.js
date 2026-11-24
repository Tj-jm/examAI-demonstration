// Grading rules (utils/gradingFlow.js and controllers/admin/gradingController.js):
// one grader can't overwrite another's mark; by-script pay holds a script
// for its first grader; a regrade goes to its first marker for a while and
// keeps their credit; reopening; stuck scripts; queue filters; pay counts.
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
  if (/test|grad/i.test(mongoose.connection.name)) await mongoose.connection.db.dropDatabase();
  const Batch = require("../models/batchModel");
  const Student = require("../models/studentModel");
  const User = require("../models/userModel");
  const Exam = require("../models/examModel");
  const Submission = require("../models/submissionModel");
  const AppSettings = require("../models/appSettingsModel");
  const c = require("../controllers/admin/gradingController");

  const owner = await User.create({ name: "Owner", email: "o@example.com", password: "Passw0rd!x", role: "owner" });
  const g1 = await User.create({ name: "Grader One", email: "g1@example.com", password: "Passw0rd!x", role: "grader" });
  const g2 = await User.create({ name: "Grader Two", email: "g2@example.com", password: "Passw0rd!x", role: "grader" });
  const teacher = await User.create({ name: "Teach", email: "t@example.com", password: "Passw0rd!x", role: "teacher" });
  const batch = await Batch.create({ name: "Class 9", accessType: "free", program: new mongoose.Types.ObjectId(), graders: [g1._id, g2._id], teachers: [teacher._id] });
  const exam = await Exam.create({ title: "Physics", durationMinutes: 60, batches: [batch._id], isPublished: true });
  let n = 0;
  const script = async (extra = {}) => {
    n += 1;
    const st = await Student.create({ name: `Student ${n}`, email: `s${n}@example.com`, password: "Passw0rd!x", isProfileComplete: true });
    return Submission.create({
      exam: exam._id, student: st._id, batch: batch._id, status: "grading", submittedAt: new Date(),
      answers: [1, 2, 3].map(() => ({ question: new mongoose.Types.ObjectId(), questionType: "written", answerText: "x" })),
      ...extra,
    });
  };
  const mark = (user, sub, i, marks) => run(c.gradeAnswer, { user, params: { id: String(sub._id), answerId: String(sub.answers[i]._id) }, body: { marks } });
  const setMode = async (grading) => { const s = await AppSettings.get(); s.grading = { ...(s.grading?.toObject?.() || {}), ...grading }; await s.save(); };

  console.log("one grader's mark is theirs");
  let sub = await script();
  let out = await mark(g1, sub, 0, 3);
  check("grader 1 marks an answer", out.code === 200, out);
  await run(c.releaseClaim, { user: g1, params: { id: String(sub._id) } });
  out = await mark(g2, sub, 0, 5);
  check("grader 2 can't change it", out.code === 403, out);
  out = await mark(g2, sub, 1, 4);
  check("by question: grader 2 may mark the rest", out.code === 200, out);
  out = await mark(owner, sub, 0, 2);
  check("an admin can change it", out.code === 200, out);
  sub = await Submission.findById(sub._id);
  check("the answer now credits the admin", String(sub.answers[0].gradedByUser) === String(owner._id));

  console.log("\nby script: the first grader holds it");
  await setMode({ payMode: "script" });
  sub = await script();
  out = await mark(g1, sub, 0, 3);
  sub = await Submission.findById(sub._id);
  check("first mark makes grader 1 the holder", out.code === 200 && String(sub.heldBy) === String(g1._id), sub.heldBy);
  await run(c.releaseClaim, { user: g1, params: { id: String(sub._id) } });
  out = await run(c.claimSubmission, { user: g2, params: { id: String(sub._id) } });
  check("grader 2 can't claim it", out.code === 409, out);
  out = await mark(g2, sub, 1, 4);
  check("grader 2 can't mark it", out.code === 409, out);
  out = await run(c.getQueue, { user: g2, query: {} });
  check("it isn't in grader 2's queue", out.code === 200 && !out.body.submissions.some((x) => String(x._id) === String(sub._id)), out.body);
  await mark(g1, sub, 1, 4);
  out = await mark(g1, sub, 2, 5);
  sub = await Submission.findById(sub._id);
  check("finished: credited to grader 1, hold released", sub.status === "graded" && String(sub.credit.by) === String(g1._id) && !sub.heldBy, sub);
  out = await run(c.getMyGradingStats, { user: g1, query: {} });
  check("pay by script: 1 script; answers still counted (3: one went to the admin)", out.body.payMode === "script" && out.body.count === 1 && out.body.scripts === 1 && out.body.answers === 3, out.body);

  const held = await script();
  await mark(g1, held, 0, 1);
  await User.updateOne({ _id: g1._id }, { isActive: false });
  out = await mark(g2, held, 1, 2);
  check("holder deactivated: someone else can carry on", out.code === 200, out);
  await User.updateOne({ _id: g1._id }, { isActive: true });

  console.log("\nstuck scripts and reopening");
  const stuck = await script();
  await mark(g2, stuck, 0, 2);
  await Submission.updateOne({ _id: stuck._id }, { progressAt: new Date(Date.now() - 30 * 3600 * 1000), "answers.1.aiMarks": 3 });
  out = await run(c.getQueue, { user: owner, query: { state: "stuck" } });
  check("part-marked with no progress for 24h+: stuck", out.body.stuck >= 1 && out.body.submissions.some((x) => String(x._id) === String(stuck._id) && x.stuck), out.body);
  out = await run(c.reopenSubmission, { user: g1, params: { id: String(stuck._id) }, body: {} });
  check("a grader can't reopen", out.code === 403, out);
  out = await run(c.reopenSubmission, { user: owner, params: { id: String(stuck._id) }, body: { graderId: String(g1._id) } });
  let s2 = await Submission.findById(stuck._id);
  check("reopened to grader 1: marks gone, AI suggestion kept, held for them", out.code === 200 && s2.answers.every((a) => a.marksAwarded === null) && s2.answers[1].aiMarks === 3 && String(s2.heldBy) === String(g1._id) && s2.heldAssigned, s2);
  out = await mark(g2, s2, 0, 1);
  check("assigned: grader 2 can't mark it", out.code === 409, out);

  console.log("\nregrades");
  await setMode({ payMode: "question", regradeHours: 48 });
  sub = await script();
  await mark(g1, sub, 0, 2);
  await mark(g1, sub, 1, 2);
  await mark(g1, sub, 2, 2);
  sub = await Submission.findById(sub._id);
  const firstAt = sub.answers[0].gradedAt;
  await Submission.updateOne({ _id: sub._id }, { referral: { requested: true, reason: "Recheck Q1", questionIds: [sub.answers[0].question], requestedAt: new Date() } });
  out = await run(c.decideReferral, { user: owner, params: { id: String(sub._id) }, body: { approve: true } });
  sub = await Submission.findById(sub._id);
  check("approved: Q1 reopened, first marker's credit kept", out.code === 200 && sub.answers[0].marksAwarded === null && String(sub.answers[0].gradedByUser) === String(g1._id) && sub.answers[0].regradeOf.marks === 2, sub.answers[0]);
  let before = (await run(c.getMyGradingStats, { user: g1, query: {} })).body.answers;
  out = await mark(g2, sub, 0, 5);
  check("the regrade is grader 1's for now (the lock works)", out.code === 403, out);
  out = await mark(g1, sub, 0, 3);
  sub = await Submission.findById(sub._id);
  let after = (await run(c.getMyGradingStats, { user: g1, query: {} })).body.answers;
  check("grader 1 regrades: same credit, original date", out.code === 200 && sub.status === "graded" && after === before && +sub.answers[0].gradedAt === +firstAt, { before, after });

  sub = await script();
  await mark(g1, sub, 0, 2); await mark(g1, sub, 1, 2); await mark(g1, sub, 2, 2);
  await Submission.updateOne({ _id: sub._id }, { referral: { requested: true, reason: "x", questionIds: [sub.answers[0].question], requestedAt: new Date() } });
  await run(c.decideReferral, { user: owner, params: { id: String(sub._id) }, body: { approve: true } });
  await Submission.updateOne({ _id: sub._id }, { "referral.routeUntil": new Date(Date.now() - 1000) });
  before = (await run(c.getMyGradingStats, { user: g1, query: {} })).body.answers;
  out = await mark(g2, sub, 0, 4);
  after = (await run(c.getMyGradingStats, { user: g1, query: {} })).body.answers;
  check("time's up: grader 2 may regrade, and the credit moves to them", out.code === 200 && after === before - 1, { before, after, out });

  sub = await script();
  await mark(g1, sub, 0, 2); await mark(g1, sub, 1, 2); await mark(g1, sub, 2, 2);
  await Submission.updateOne({ _id: sub._id }, { referral: { requested: true, reason: "x", questionIds: [sub.answers[0].question], requestedAt: new Date() } });
  out = await run(c.decideReferral, { user: owner, params: { id: String(sub._id) }, body: { approve: true, route: String(teacher._id) } });
  sub = await Submission.findById(sub._id);
  check("sent to a chosen person", out.code === 200 && sub.referral.routeMode === "grader" && String(sub.referral.routeTo) === String(teacher._id));
  out = await mark(g1, sub, 0, 4);
  check("then even the first marker can't", out.code === 403, out);
  await User.updateOne({ _id: teacher._id }, { isDeleted: true, isActive: false });
  out = await mark(g1, sub, 0, 4);
  check("that person deleted: open to anyone", out.code === 200, out);

  console.log("\nqueue filters");
  out = await run(c.getQueue, { user: owner, query: { q: "Student 1" } });
  check("by student name", out.body.submissions.every((x) => /Student 1/.test(x.student?.name || "")), out.body.submissions.map((x) => x.student?.name));
  out = await run(c.getQueue, { user: owner, query: { state: "partial" } });
  check("part-marked only", out.body.submissions.length >= 1 && out.body.submissions.every((x) => x.writtenCount > x.pendingCount && x.pendingCount > 0), out.body.submissions);
  out = await run(c.getQueue, { user: g2, query: { state: "partial", q: "nobody" } });
  check("graders' filters are ignored", out.code === 200 && out.body.submissions.length >= 1);

  await mongoose.disconnect();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
