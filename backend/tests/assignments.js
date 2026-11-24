// Assignments: setting, handing in, late work, grading, what students see,
// AI checking's limits and the assignment agent.
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
  fn({ query: {}, params: {}, body: {}, ...req }, res, (e) => resolve({ code: res.code, err: e?.message }));
});

(async () => {
  const { reconcile, buildPrompt } = require("../ai/assignmentCheck");
  console.log("AI checking stays inside the rubric");
  const rubricA = { maxMarks: 10, rubric: [{ criterion: "Method", marks: 6 }, { criterion: "Answer", marks: 4 }] };
  let r = reconcile(rubricA, { rubric: [{ marks: 9, comment: "" }, { marks: 3, comment: "" }], marks: 99 });
  check("each row capped at its own marks, total is their sum", r.rubricScores[0].marks === 6 && r.marks === 9, r);
  r = reconcile({ maxMarks: 10, rubric: [] }, { marks: 14 });
  check("a single mark capped at the maximum", r.marks === 10);
  const p = buildPrompt({ assignment: { title: "Lab", maxMarks: 5, rubric: [], instructions: "Do it", markingNotes: "Key: 42" }, submission: { text: "My work", files: [{ url: "/media/assignments/a.jpg", type: "image/jpeg" }, { url: "/media/assignments/b.pdf", type: "application/pdf", name: "report.pdf" }] } });
  check("photos go to the model, other files are named as unread", p.imageUrls.length === 1 && /report\.pdf/.test(p.prompt) && /Key: 42/.test(p.prompt));

  if (!process.env.TEST_MONGO_URL) { console.log("TEST_MONGO_URL not set, database checks skipped."); console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0); }
  await mongoose.connect(process.env.TEST_MONGO_URL);
  if (/test|assign/i.test(mongoose.connection.name)) await mongoose.connection.db.dropDatabase();
  const Batch = require("../models/batchModel");
  const Student = require("../models/studentModel");
  const User = require("../models/userModel");
  const Purchase = require("../models/purchaseModel");
  const { Assignment, AssignmentSubmission } = require("../models/assignmentModel");
  const staff = require("../controllers/admin/courseworkController");
  const app = require("../controllers/app/courseworkController");

  const owner = await User.create({ name: "Owner", email: "o@example.com", password: "Passw0rd!x", role: "owner" });
  const teacher = await User.create({ name: "Teach", email: "t@example.com", password: "Passw0rd!x", role: "teacher" });
  const grader = await User.create({ name: "Grade", email: "g@example.com", password: "Passw0rd!x", role: "grader" });
  const batch = await Batch.create({ name: "Class 8", accessType: "free", program: new mongoose.Types.ObjectId(), teachers: [teacher._id], graders: [grader._id] });
  const other = await Batch.create({ name: "Class 9", accessType: "free", program: new mongoose.Types.ObjectId() });
  const s1 = await Student.create({ name: "Rafi", email: "r@example.com", password: "Passw0rd!x", isProfileComplete: true });
  const s2 = await Student.create({ name: "Nadia", email: "n@example.com", password: "Passw0rd!x", isProfileComplete: true });
  for (const s of [s1, s2]) await Purchase.create({ student: s._id, batch: batch._id, plan: { label: "Grant", price: 0, isInfinite: true }, provider: "manual", status: "complete" });

  console.log("\nsetting work");
  let out = await run(staff.createAssignment, { user: teacher, body: { batch: other._id, title: "X", dueAt: new Date(Date.now() + 86400000), maxMarks: 5 } });
  check("a teacher can't set work for another batch", out.code === 403, out);
  out = await run(staff.createAssignment, { user: grader, body: { batch: batch._id, title: "X", dueAt: new Date(Date.now() + 86400000), maxMarks: 5 } });
  check("a grader can't set work", out.code === 403, out);
  out = await run(staff.createAssignment, {
    user: teacher,
    body: { batch: batch._id, title: "Essay", dueAt: new Date(Date.now() - 30 * 3600000), allowLate: true, lateDays: 3, latePenalty: 10, maxMarks: 99, rubric: [{ criterion: "Ideas", marks: 6 }, { criterion: "Writing", marks: 4 }], markingNotes: "secret", isPublished: true },
  });
  const essay = out.body;
  check("set with a rubric: the rubric decides the marks", out.code === 201 && essay.maxMarks === 10, out);
  const hidden = await Assignment.create({ batch: batch._id, title: "Draft one", dueAt: new Date(Date.now() + 86400000), maxMarks: 5 });

  console.log("\nstudents");
  const sreq = (student, extra = {}) => ({ student, batch, params: { id: String(essay._id), ...(extra.params || {}) }, body: extra.body || {} });
  out = await run(app.listAssignments, { student: s1, batch });
  check("students see published work only", out.body.assignments.length === 1 && out.body.assignments[0].title === "Essay", out.body);
  out = await run(app.getAssignment, sreq(s1));
  check("marking notes never reach students", out.code === 200 && out.body.markingNotes === undefined && out.body.open === true, out.body);
  out = await run(app.getAssignment, { student: s1, batch, params: { id: String(hidden._id) } });
  check("an unpublished assignment can't be opened", out.code === 404);
  out = await run(app.submitAssignment, sreq(s1));
  check("can't hand in nothing", out.code === 400, out);
  await run(app.saveSubmission, sreq(s1, { body: { text: "My essay on rivers." } }));
  out = await run(app.submitAssignment, sreq(s1));
  check("handed in 30 hours late: 20% off (two days started)", out.code === 200 && out.body.status === "submitted" && out.body.latePenalty === 20, out.body);

  console.log("\ngrading");
  const sub = await AssignmentSubmission.findOne({ student: s1._id });
  out = await run(staff.listSubmissions, { user: grader, params: { id: String(essay._id) } });
  check("graders see students anonymously", out.code === 200 && out.body.rows.every((row) => /^Student \d/.test(row.student.name) && !row.student.email), out.body);
  check("the roster lists everyone, handed in or not", out.body.rows.length === 2);
  out = await run(staff.gradeSubmission, { user: grader, params: { subId: String(sub._id) }, body: { rubricScores: [{ marks: 9 }, { marks: 3, comment: "Neat" }], feedback: "Good", returned: false } });
  check("rubric rows capped; late penalty applied to the total", out.code === 200 && out.body.marks === 9 && out.body.finalMarks === 7.2, out.body);
  out = await run(app.getAssignment, sreq(s1));
  check("not returned yet: the student sees 'handed in', no grade", out.body.mine.status === "submitted" && out.body.mine.finalMarks === undefined, out.body.mine);
  out = await run(staff.returnAll, { user: teacher, params: { id: String(essay._id) } });
  check("return all", out.body.returned === 1);
  out = await run(app.getAssignment, sreq(s1));
  check("returned: the student sees the grade and feedback", out.body.mine.status === "graded" && out.body.mine.finalMarks === 7.2 && out.body.mine.feedback === "Good");
  out = await run(app.saveSubmission, sreq(s1, { body: { text: "changed" } }));
  check("graded work can't be changed", out.code === 409, out);

  console.log("\nthe assignment agent");
  const AiConfig = require("../models/aiConfigModel");
  const cfg = await AiConfig.get();
  cfg.agents.enabled = true; cfg.agents.assignment.enabled = true; await cfg.save();
  await Batch.updateOne({ _id: batch._id }, { "features.agentAssignments": true });
  await run(app.saveSubmission, sreq(s2, { body: { text: "Rivers flow." } }));
  await run(app.submitAssignment, sreq(s2));
  // The AI call, faked: the agent's own logic is what's tested.
  const service = require("../ai/service");
  service.generate = async () => ({ data: { rubric: [{ marks: 5, comment: "ok" }, { marks: 2, comment: "ok" }], marks: 7, feedback: "Decent", reasoning: "r" } });
  const agent = require("../agents/assignment");
  out = await agent.sweep();
  const s2sub = await AssignmentSubmission.findOne({ student: s2._id });
  check("suggests a grade for the new hand-in, kept off the grade", out.checked === 1 && s2sub.ai.marks === 7 && s2sub.ai.by === "agent" && s2sub.marks === null, out);
  check("and prepares one apply step for approval", Boolean(out.run));
  const AgentRun = require("../models/agentRunModel");
  const prepared = await AgentRun.findById(out.run);
  check("the step is the suggestion", prepared?.steps?.[0]?.tool === "apply_assignment_grade" && prepared.steps[0].args.marks === 7, prepared?.steps?.[0]);
  out = await agent.sweep();
  check("a hand-in waiting in an open request isn't checked twice", out.checked === 0 && !out.run, out);
  await AgentRun.updateOne({ _id: prepared._id }, { $set: { status: "done", "steps.0.status": "rejected" } });
  out = await agent.sweep();
  check("a suggestion staff turned down isn't offered again", out.checked === 0 && !out.run, out);
  await AssignmentSubmission.updateOne({ _id: s2sub._id }, { $set: { submittedAt: new Date(Date.now() + 1000) } });
  out = await agent.sweep();
  check("until the student hands in again", out.checked === 1 && Boolean(out.run), out);

  const soon = await Assignment.create({ batch: batch._id, title: "Worksheet", dueAt: new Date(Date.now() + 5 * 3600000), maxMarks: 5, isPublished: true });
  await AssignmentSubmission.create({ assignment: soon._id, batch: batch._id, student: s1._id, status: "submitted", text: "done", submittedAt: new Date() });
  const Notification = require("../models/notificationModel");
  out = await agent.reminders();
  const notes = await Notification.find({ type: "assignmentReminder" }).lean();
  check("reminds only who hasn't handed in, once", out.reminded === 1 && notes.length === 1 && String(notes[0].student) === String(s2._id), { out, n: notes.length });
  out = await agent.reminders();
  check("not again", out.reminded === 0);

  await mongoose.disconnect();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
