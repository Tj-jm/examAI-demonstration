const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const { Assignment, AssignmentSubmission } = require("../../models/assignmentModel");
const Batch = require("../../models/batchModel");
const storage = require("../../adapters/storage");
const { staffBatchIds } = require("../../utils/staffBatchIds");
const { roster, rosterIds } = require("../../utils/roster");
const { notify } = require("../../utils/notify");

// Assignments for staff: owners and admins anywhere, teachers and graders
// on their own batches. Teachers set them; graders only grade.

const round2 = (n) => Math.round(n * 100) / 100;

const assertBatch = async (req, res, batchId) => {
  if (!mongoose.isValidObjectId(batchId)) { res.status(400); throw new Error("Choose a batch."); }
  const ids = await staffBatchIds(req.user);
  if (ids && !ids.some((id) => String(id) === String(batchId))) { res.status(403); throw new Error("You are not assigned to this batch."); }
};

const loadAssignment = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) { res.status(404); throw new Error("Assignment not found."); }
  const a = await Assignment.findById(req.params.id);
  if (!a) { res.status(404); throw new Error("Assignment not found."); }
  await assertBatch(req, res, a.batch);
  return a;
};

const canSet = (req, res) => {
  if (req.user.role === "grader") { res.status(403); throw new Error("Graders grade assignments; teachers set them."); }
};

const FIELDS = ["title", "instructions", "attachments", "category", "opensAt", "dueAt", "allowLate", "lateDays", "latePenalty", "submissionType", "maxFiles", "maxMarks", "rubric", "markingNotes"];
const apply = (a, body) => {
  for (const k of FIELDS) if (body[k] !== undefined) a[k] = body[k];
  if (Array.isArray(a.rubric) && a.rubric.length) {
    // The rubric's rows are the marks.
    a.maxMarks = a.rubric.reduce((sum, r) => sum + (Number(r.marks) || 0), 0);
  }
};

const announce = async (a) => {
  const batch = await Batch.findById(a.batch).select("name").lean();
  await notify(await rosterIds(a.batch), "assignmentNew", {
    title: `New assignment: ${a.title}`,
    body: `${batch?.name || ""} · due ${new Date(a.dueAt).toUTCString().slice(0, 22)}`,
    link: `/batches/${a.batch}/assignments/${a._id}`,
  }).catch(() => {});
};

//@desc   Assignments on a batch, with hand-in counts
//@route  GET /api/grading/assignments?batch=
const listAssignments = asyncHandler(async (req, res) => {
  const ids = await staffBatchIds(req.user);
  const query = {};
  if (req.query.batch) { await assertBatch(req, res, req.query.batch); query.batch = req.query.batch; }
  else if (ids) query.batch = { $in: ids };
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const [items, total] = await Promise.all([
    Assignment.find(query).sort({ dueAt: -1 }).skip((page - 1) * limit).limit(limit).populate("batch", "name").lean(),
    Assignment.countDocuments(query),
  ]);
  const counts = await AssignmentSubmission.aggregate([
    { $match: { assignment: { $in: items.map((a) => a._id) } } },
    { $group: { _id: { a: "$assignment", s: "$status", r: "$returned" }, n: { $sum: 1 } } },
  ]);
  const tally = {};
  for (const c of counts) {
    const t = (tally[String(c._id.a)] ||= { submitted: 0, graded: 0, returned: 0 });
    if (c._id.s === "submitted") t.submitted += c.n;
    if (c._id.s === "graded") { t.graded += c.n; if (c._id.r) t.returned += c.n; }
  }
  res.status(200).json({
    assignments: items.map((a) => ({ ...a, counts: tally[String(a._id)] || { submitted: 0, graded: 0, returned: 0 } })),
    total, page, pages: Math.max(1, Math.ceil(total / limit)),
  });
});

//@desc   Set an assignment
//@route  POST /api/grading/assignments
const createAssignment = asyncHandler(async (req, res) => {
  canSet(req, res);
  await assertBatch(req, res, req.body.batch);
  const a = new Assignment({ batch: req.body.batch, createdBy: req.user._id });
  apply(a, req.body);
  if (req.body.isPublished) { a.isPublished = true; a.publishedAt = new Date(); }
  await a.validate().catch((e) => { res.status(400); throw new Error(Object.values(e.errors || {})[0]?.message || e.message); });
  await a.save();
  if (a.isPublished) await announce(a);
  res.status(201).json(a);
});

//@desc   One assignment (with marking notes)
//@route  GET /api/grading/assignments/:id
const getAssignment = asyncHandler(async (req, res) => {
  const a = await loadAssignment(req, res);
  await a.populate("batch", "name");
  res.status(200).json(a);
});

//@desc   Change an assignment; publishing tells the batch
//@route  PUT /api/grading/assignments/:id
const updateAssignment = asyncHandler(async (req, res) => {
  canSet(req, res);
  const a = await loadAssignment(req, res);
  apply(a, req.body);
  let published = false;
  if (req.body.isPublished === true && !a.isPublished) { a.isPublished = true; a.publishedAt = new Date(); published = true; }
  if (req.body.isPublished === false) a.isPublished = false;
  await a.validate().catch((e) => { res.status(400); throw new Error(Object.values(e.errors || {})[0]?.message || e.message); });
  await a.save();
  if (published) await announce(a);
  res.status(200).json(a);
});

//@desc   Delete an assignment and its hand-ins
//@route  DELETE /api/grading/assignments/:id
const deleteAssignment = asyncHandler(async (req, res) => {
  canSet(req, res);
  const a = await loadAssignment(req, res);
  const graded = await AssignmentSubmission.countDocuments({ assignment: a._id, status: "graded" });
  if (graded && req.query.force !== "true") {
    res.status(409);
    throw new Error(`${graded} hand-ins are already graded. Delete anyway to remove them and their grades.`);
  }
  await AssignmentSubmission.deleteMany({ assignment: a._id });
  await a.deleteOne();
  res.status(200).json({ ok: true });
});

//@desc   Upload a file for the assignment itself (a worksheet)
//@route  POST /api/grading/assignments/upload  (file)
const uploadAttachment = asyncHandler(async (req, res) => {
  canSet(req, res);
  if (!req.file) { res.status(400); throw new Error("No file was received."); }
  const stored = await storage.store("assignments", req.file);
  res.status(200).json({ url: await storage.urlFor(stored.key, stored.driver), name: req.file.originalname || "", type: req.file.mimetype || "" });
});

//@desc   Everyone in the batch and what they handed in
//@route  GET /api/grading/assignments/:id/submissions
const listSubmissions = asyncHandler(async (req, res) => {
  const a = await loadAssignment(req, res);
  const [students, subs] = await Promise.all([
    roster(a.batch),
    AssignmentSubmission.find({ assignment: a._id }).lean(),
  ]);
  const byStudent = new Map(subs.map((s) => [String(s.student), s]));
  const anonymous = req.user.role === "grader";
  const rows = students.map((st, i) => {
    const s = byStudent.get(String(st._id));
    return {
      student: anonymous ? { _id: st._id, name: `Student ${i + 1}` } : st,
      submission: s ? { _id: s._id, status: s.status, submittedAt: s.submittedAt, latePenalty: s.latePenalty, finalMarks: s.finalMarks, returned: s.returned, hasAi: s.ai?.marks !== null && s.ai?.marks !== undefined } : null,
    };
  });
  // Hand-ins from students no longer in the batch still count.
  for (const s of subs) {
    if (!students.some((st) => String(st._id) === String(s.student))) {
      rows.push({ student: { _id: s.student, name: anonymous ? "Former student" : "(left the batch)" }, submission: { _id: s._id, status: s.status, submittedAt: s.submittedAt, latePenalty: s.latePenalty, finalMarks: s.finalMarks, returned: s.returned } });
    }
  }
  res.status(200).json({ assignment: { _id: a._id, title: a.title, maxMarks: a.maxMarks, dueAt: a.dueAt, rubric: a.rubric }, rows });
});

const loadSubmission = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.subId)) { res.status(404); throw new Error("Hand-in not found."); }
  const sub = await AssignmentSubmission.findById(req.params.subId);
  if (!sub) { res.status(404); throw new Error("Hand-in not found."); }
  const a = await Assignment.findById(sub.assignment);
  await assertBatch(req, res, sub.batch);
  return { sub, a };
};

//@desc   One hand-in, to grade
//@route  GET /api/grading/assignments/submissions/:subId
const getSubmission = asyncHandler(async (req, res) => {
  const { sub, a } = await loadSubmission(req, res);
  await sub.populate("student", req.user.role === "grader" ? "_id" : "name email phoneNumber studentId");
  res.status(200).json({ submission: sub, assignment: a });
});

//@desc   Grade a hand-in (and return it to the student, or not yet)
//@route  PUT /api/grading/assignments/submissions/:subId  { rubricScores, marks, feedback, returned }
const gradeSubmission = asyncHandler(async (req, res) => {
  const { sub, a } = await loadSubmission(req, res);
  if (sub.status === "draft") { res.status(409); throw new Error("This hasn't been handed in yet."); }
  let marks;
  if (a.rubric?.length) {
    const scores = Array.isArray(req.body.rubricScores) ? req.body.rubricScores : [];
    if (scores.length !== a.rubric.length) { res.status(400); throw new Error("Score every rubric row."); }
    sub.rubricScores = a.rubric.map((row, i) => ({
      marks: Math.min(Math.max(0, Number(scores[i]?.marks) || 0), row.marks),
      comment: String(scores[i]?.comment || "").slice(0, 2000),
    }));
    marks = sub.rubricScores.reduce((sum, r) => sum + r.marks, 0);
  } else {
    marks = Number(req.body.marks);
    if (!Number.isFinite(marks) || marks < 0 || marks > a.maxMarks) { res.status(400); throw new Error(`Marks are from 0 to ${a.maxMarks}.`); }
  }
  const wasReturned = sub.returned;
  sub.marks = round2(marks);
  sub.finalMarks = round2(marks * (1 - (sub.latePenalty || 0) / 100));
  sub.feedback = String(req.body.feedback || "").slice(0, 10000);
  sub.status = "graded";
  sub.gradedBy = req.user._id;
  sub.gradedAt = new Date();
  if (req.body.returned !== undefined) sub.returned = Boolean(req.body.returned);
  await sub.save();
  if (sub.returned && !wasReturned) {
    await notify(sub.student, "assignmentGraded", {
      title: `Graded: ${a.title}`, body: `${sub.finalMarks} / ${a.maxMarks}`, link: `/batches/${sub.batch}/assignments/${a._id}`,
    }).catch(() => {});
  }
  res.status(200).json(sub);
});

//@desc   Return every graded hand-in on an assignment to its student
//@route  POST /api/grading/assignments/:id/return-all
const returnAll = asyncHandler(async (req, res) => {
  const a = await loadAssignment(req, res);
  const subs = await AssignmentSubmission.find({ assignment: a._id, status: "graded", returned: false }).select("student finalMarks");
  await AssignmentSubmission.updateMany({ _id: { $in: subs.map((s) => s._id) } }, { $set: { returned: true } });
  for (const s of subs) {
    await notify(s.student, "assignmentGraded", { title: `Graded: ${a.title}`, body: `${s.finalMarks} / ${a.maxMarks}`, link: `/batches/${a.batch}/assignments/${a._id}` }).catch(() => {});
  }
  res.status(200).json({ returned: subs.length });
});

module.exports = {
  listAssignments, createAssignment, getAssignment, updateAssignment, deleteAssignment, uploadAttachment,
  listSubmissions, getSubmission, gradeSubmission, returnAll,
};
