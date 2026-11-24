// Gradebook: weighted categories, scales, missing work, ranking, what
// students see, and who may open it.
// Database checks need TEST_MONGO_URL (a throwaway database).

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
  const { computeRow, rankRows, letterFor, settingsFor, SCALES } = require("../utils/gradebook");
  console.log("the maths");
  const items = [
    { id: "e1", category: "Exams", max: 50, closed: true },
    { id: "e2", category: "Exams", max: 50, closed: true },
    { id: "a1", category: "Assignments", max: 10, closed: true },
    { id: "a2", category: "Assignments", max: 10, closed: false },
  ];
  const settings = settingsFor({ gradebook: { categories: [{ name: "Exams", weight: 60 }, { name: "Assignments", weight: 40 }] } });
  let row = computeRow(items, { e1: { marks: 40, max: 50, status: "graded" }, e2: { marks: 30, max: 50, status: "graded" }, a1: { marks: 9, max: 10, status: "graded" } }, settings);
  // Exams 70%, Assignments 90%: 0.6*70 + 0.4*90 = 78.
  check("weighted: 60% exams at 70, 40% assignments at 90 = 78", row.overall === 78 && row.categories.Exams.pct === 70 && row.letter === "C", row);
  row = computeRow(items, { e1: { marks: 40, max: 50, status: "graded" } }, settings);
  check("an empty category doesn't drag the grade down", row.overall === 80 && row.categories.Assignments.pct === null, row);
  row = computeRow(items, { e1: { marks: 40, max: 50, status: "graded" } }, { ...settings, missingAsZero: true });
  // Exams: 40/100 (e2 closed, missing) = 40; Assignments: a1 closed missing 0/10 = 0, a2 still open, skipped. 0.6*40 + 0 = 24.
  check("missing as zero: closed work counts 0, open work doesn't", row.overall === 24 && row.categories.Assignments.max === 10, row);
  row = computeRow(items, { e1: { status: "pending" } }, settings);
  check("work still being marked doesn't count yet", row.overall === null && row.letter === null);
  row = computeRow([...items, { id: "x", category: "Labs", max: 20, closed: true }], { x: { marks: 10, max: 20, status: "graded" } }, settings);
  check("only an unweighted category has marks: a plain total", row.overall === 50 && row.categories.Labs.weight === 0, row);
  row = computeRow([{ id: "e1", category: "Exams", max: 50, excluded: true }], { e1: { marks: 0, max: 50, status: "graded" } }, settings);
  check("an excluded item never counts", row.overall === null);
  check("GPA 5 scale: 80 is A+ (5), 79.9 is A (4), 32 is F", letterFor(SCALES.gpa5, 80).letter === "A+" && letterFor(SCALES.gpa5, 79.9).points === 4 && letterFor(SCALES.gpa5, 32).letter === "F");
  const rows = [{ overall: 90 }, { overall: 80 }, { overall: 90 }, { overall: null }];
  const n = rankRows(rows);
  check("ties share a rank: 90, 90, 80 rank 1, 1, 3", n === 3 && rows[0].rank === 1 && rows[2].rank === 1 && rows[1].rank === 3 && rows[3].rank === null, rows);
  check("defaults: Exams 60 / Assignments 40, A–F", settingsFor({}).categories.length === 2 && settingsFor({}).scale[0].letter === "A");

  if (!process.env.TEST_MONGO_URL) { console.log("TEST_MONGO_URL not set, database checks skipped."); console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0); }
  await mongoose.connect(process.env.TEST_MONGO_URL);
  if (/test|grade/i.test(mongoose.connection.name)) await mongoose.connection.db.dropDatabase();
  const Batch = require("../models/batchModel");
  const Student = require("../models/studentModel");
  const User = require("../models/userModel");
  const Purchase = require("../models/purchaseModel");
  const Exam = require("../models/examModel");
  const Submission = require("../models/submissionModel");
  const { Assignment, AssignmentSubmission } = require("../models/assignmentModel");
  const staff = require("../controllers/admin/gradebookController");
  const app = require("../controllers/app/gradesController");

  const owner = await User.create({ name: "Owner", email: "o@example.com", password: "Passw0rd!x", role: "owner" });
  const teacher = await User.create({ name: "Teach", email: "t@example.com", password: "Passw0rd!x", role: "teacher" });
  const grader = await User.create({ name: "Grade", email: "g@example.com", password: "Passw0rd!x", role: "grader" });
  const batch = await Batch.create({ name: "Class 8", accessType: "free", program: new mongoose.Types.ObjectId(), teachers: [teacher._id], graders: [grader._id] });
  const other = await Batch.create({ name: "Class 9", accessType: "free", program: new mongoose.Types.ObjectId() });
  const s1 = await Student.create({ name: "Rafi", email: "r@example.com", password: "Passw0rd!x", isProfileComplete: true, studentId: "C8-01" });
  const s2 = await Student.create({ name: "Nadia", email: "n@example.com", password: "Passw0rd!x", isProfileComplete: true });
  for (const s of [s1, s2]) await Purchase.create({ student: s._id, batch: batch._id, plan: { label: "Grant", price: 0, isInfinite: true }, provider: "manual", status: "complete" });

  const exam = await Exam.create({ title: "Term test", durationMinutes: 60, batches: [batch._id], isPublished: true, isActive: false, opensAt: new Date(Date.now() - 86400000) });
  await Submission.create({ exam: exam._id, student: s1._id, batch: batch._id, status: "graded", marks: 30, totalMarks: 50, attempt: 1 });
  await Submission.create({ exam: exam._id, student: s1._id, batch: batch._id, status: "graded", marks: 40, totalMarks: 50, attempt: 2 });
  await Submission.create({ exam: exam._id, student: s2._id, batch: batch._id, status: "graded", marks: 45, totalMarks: 50, attempt: 1 });
  const essay = await Assignment.create({ batch: batch._id, title: "Essay", dueAt: new Date(Date.now() - 3600000), maxMarks: 10, isPublished: true });
  await AssignmentSubmission.create({ assignment: essay._id, batch: batch._id, student: s1._id, status: "graded", finalMarks: 9, returned: false, submittedAt: new Date() });
  await AssignmentSubmission.create({ assignment: essay._id, batch: batch._id, student: s2._id, status: "graded", finalMarks: 5, returned: true, submittedAt: new Date() });
  await Assignment.create({ batch: batch._id, title: "Draft", dueAt: new Date(), maxMarks: 10 });

  console.log("\nstaff");
  let out = await run(staff.getGradebook, { user: grader, params: { batchId: String(batch._id) } });
  check("graders get no gradebook", out.code === 403);
  out = await run(staff.getGradebook, { user: teacher, params: { batchId: String(other._id) } });
  check("a teacher can't open another batch's gradebook", out.code === 403);
  out = await run(staff.getGradebook, { user: teacher, params: { batchId: String(batch._id) } });
  const rafi = out.body.rows?.find((r) => r.student.name === "Rafi");
  // Exams: best attempt 40/50 = 80; Essay 9/10 = 90 (staff see it before it's returned): 0.6*80 + 0.4*90 = 84.
  check("best attempt counts, staff see unreturned grades: 84", out.code === 200 && rafi.overall === 84 && rafi.cells[String(exam._id)].marks === 40, rafi);
  check("drafts aren't gradebook items", out.body.items.length === 2 && !out.body.items.some((i) => i.title === "Draft"));
  check("class averages per item", out.body.items.find((i) => i.kind === "exam").average === 85, out.body.items);

  out = await run(staff.updateSettings, { user: teacher, params: { batchId: String(batch._id) }, body: { scale: [{ letter: "P", min: 50 }] } });
  check("a scale without a 0% row is refused", out.code === 400, out);
  out = await run(staff.updateSettings, { user: teacher, params: { batchId: String(batch._id) }, body: { categories: [{ name: "Exams", weight: 50 }, { name: "Exams", weight: 10 }, { name: "Assignments", weight: 50 }], scale: SCALES.gpa5, published: false, showRank: true, overrides: [{ ref: String(essay._id), category: "Homework" }] } });
  const saved = await Batch.findById(batch._id);
  check("settings saved, duplicate category names dropped", out.code === 200 && saved.gradebook.categories.length === 2 && saved.gradebook.scale[0].letter === "A+", saved.gradebook);
  out = await run(staff.getGradebook, { user: owner, params: { batchId: String(batch._id) } });
  check("an override moves an item to another category, flagged as unweighted", out.body.items.find((i) => i.kind === "assignment").category === "Homework" && out.body.unweighted.includes("Homework"), out.body.unweighted);
  out = await run(staff.saveRemark, { user: teacher, params: { batchId: String(batch._id), studentId: String(s1._id) }, body: { text: "Steady progress." } });
  check("remark saved", out.code === 200);

  console.log("\nstudents");
  out = await run(app.getMyGrades, { student: s1, batch });
  check("nothing until published", out.body.published === false);
  await run(staff.updateSettings, { user: teacher, params: { batchId: String(batch._id) }, body: { published: true, overrides: [] } });
  out = await run(app.getMyGrades, { student: s1, batch: await Batch.findById(batch._id) });
  // Rafi's essay isn't returned yet, so only the exam counts: 80 (A+).
  check("a student sees only returned grades", out.body.published && out.body.row.overall === 80 && out.body.row.cells[String(essay._id)].status === "pending", out.body.row);
  check("rank shown when switched on, with the remark", out.body.row.rank === 1 && out.body.classSize === 2 && out.body.remark === "Steady progress.", out.body);
  check("a student never sees the class's rows", out.body.rows === undefined && !JSON.stringify(out.body).includes("Nadia"));

  await mongoose.disconnect();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
