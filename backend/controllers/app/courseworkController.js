const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const { Assignment, AssignmentSubmission } = require("../../models/assignmentModel");
const storage = require("../../adapters/storage");
const { preparePhoto } = require("../../utils/photo");
const { assertOwnMediaUrl, recordStudentUpload } = require("../../utils/mediaUrl");

// Assignments, for a student in the batch (models/assignmentModel.js).

const visible = (req) => ({
  batch: req.batch._id,
  isPublished: true,
  $or: [{ opensAt: null }, { opensAt: { $lte: new Date() } }],
});

// What a student sees of their own work: the grade only once returned.
const shapeMine = (sub) => {
  if (!sub) return null;
  const returned = sub.status === "graded" && sub.returned;
  return {
    _id: sub._id,
    status: returned ? "graded" : sub.status === "graded" ? "submitted" : sub.status,
    text: sub.text,
    files: sub.files,
    submittedAt: sub.submittedAt,
    latePenalty: sub.latePenalty,
    ...(returned ? { marks: sub.marks, finalMarks: sub.finalMarks, feedback: sub.feedback, rubricScores: sub.rubricScores, gradedAt: sub.gradedAt } : {}),
  };
};

const shapeAssignment = (a, sub, now = Date.now()) => ({
  _id: a._id,
  title: a.title,
  instructions: a.instructions,
  attachments: a.attachments,
  category: a.category,
  dueAt: a.dueAt,
  closesAt: a.closesAt(),
  allowLate: a.allowLate,
  lateDays: a.lateDays,
  latePenalty: a.latePenalty,
  submissionType: a.submissionType,
  maxFiles: a.maxFiles,
  maxMarks: a.maxMarks,
  rubric: (a.rubric || []).map((r) => ({ criterion: r.criterion, marks: r.marks })),
  open: now <= a.closesAt().getTime(),
  mine: shapeMine(sub),
});

//@desc   This batch's assignments with my status
//@route  GET /api/app/batches/:batchId/assignments
//@access Private (student + batchAccess + features.assignments)
const listAssignments = asyncHandler(async (req, res) => {
  const items = await Assignment.find(visible(req)).sort({ dueAt: -1 }).limit(300);
  const subs = await AssignmentSubmission.find({ student: req.student._id, assignment: { $in: items.map((a) => a._id) } });
  const byId = new Map(subs.map((s) => [String(s.assignment), s]));
  const now = Date.now();
  const shaped = items.map((a) => shapeAssignment(a, byId.get(String(a._id)), now));
  // To do first (soonest due), then handed in, then past.
  const rank = (a) => (a.mine && a.mine.status !== "draft" ? 1 : a.open ? 0 : 2);
  shaped.sort((x, y) => rank(x) - rank(y) || (rank(x) === 0 ? new Date(x.dueAt) - new Date(y.dueAt) : new Date(y.dueAt) - new Date(x.dueAt)));
  res.status(200).json({ assignments: shaped.map(({ instructions, attachments, rubric, ...rest }) => rest) });
});

const loadVisible = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) { res.status(404); throw new Error("Assignment not found."); }
  const a = await Assignment.findOne({ _id: req.params.id, ...visible(req) });
  if (!a) { res.status(404); throw new Error("Assignment not found."); }
  return a;
};

//@desc   One assignment with my work
//@route  GET /api/app/batches/:batchId/assignments/:id
const getAssignment = asyncHandler(async (req, res) => {
  const a = await loadVisible(req, res);
  const sub = await AssignmentSubmission.findOne({ assignment: a._id, student: req.student._id });
  res.status(200).json(shapeAssignment(a, sub));
});

const cleanFiles = async (files, studentId, max) => {
  const list = Array.isArray(files) ? files.slice(0, max) : [];
  const out = [];
  for (const f of list) {
    if (!f?.url) continue;
    await assertOwnMediaUrl(f.url, studentId, "assignment file");
    out.push({ url: String(f.url), name: String(f.name || "").slice(0, 200), type: String(f.type || "").slice(0, 100) });
  }
  return out;
};

const editable = (res, a, sub) => {
  if (sub?.status === "graded") { res.status(409); throw new Error("This has been graded, so it can't be changed."); }
  if (Date.now() > a.closesAt().getTime()) { res.status(409); throw new Error(a.allowLate ? "The late window has closed." : "The due date has passed."); }
};

//@desc   Save my work without handing it in (or update it before grading)
//@route  PUT /api/app/batches/:batchId/assignments/:id/submission  { text, files }
const saveSubmission = asyncHandler(async (req, res) => {
  const a = await loadVisible(req, res);
  let sub = await AssignmentSubmission.findOne({ assignment: a._id, student: req.student._id });
  editable(res, a, sub);
  if (!sub) sub = new AssignmentSubmission({ assignment: a._id, batch: a.batch, student: req.student._id });
  if (req.body.text !== undefined && a.submissionType !== "files") sub.text = String(req.body.text || "").slice(0, 50000);
  if (req.body.files !== undefined && a.submissionType !== "text") sub.files = await cleanFiles(req.body.files, req.student._id, a.maxFiles);
  await sub.save();
  res.status(200).json(shapeMine(sub));
});

//@desc   Hand it in (again, until it's graded or closed)
//@route  POST /api/app/batches/:batchId/assignments/:id/submit
const submitAssignment = asyncHandler(async (req, res) => {
  const a = await loadVisible(req, res);
  const sub = await AssignmentSubmission.findOne({ assignment: a._id, student: req.student._id });
  editable(res, a, sub);
  const hasText = Boolean(sub?.text?.trim());
  const hasFiles = Boolean(sub?.files?.length);
  if (!sub || (!hasText && !hasFiles)) { res.status(400); throw new Error("Add your answer or a file first."); }
  if (a.submissionType === "text" && !hasText) { res.status(400); throw new Error("This one needs a written answer."); }
  if (a.submissionType === "files" && !hasFiles) { res.status(400); throw new Error("This one needs a file."); }
  const now = new Date();
  sub.status = "submitted";
  sub.submittedAt = now;
  sub.latePenalty = a.penaltyFor(now);
  await sub.save();
  // The assignment agent (Pro) drafts a grade for staff to check.
  try { require("../../agents/assignment").onSubmitted(sub._id); } catch { /* not in this edition */ }
  res.status(200).json(shapeMine(sub));
});

//@desc   Upload a file for my work
//@route  POST /api/app/batches/:batchId/assignments/:id/upload  (file)
const uploadAssignmentFile = asyncHandler(async (req, res) => {
  const a = await loadVisible(req, res);
  if (a.submissionType === "text") { res.status(400); throw new Error("This one takes a written answer, not files."); }
  if (!req.file) { res.status(400); throw new Error("No file was received."); }
  const stored = await storage.store("assignments", await preparePhoto(req.file));
  await recordStudentUpload(stored.key, req.student._id, "assignments");
  res.status(200).json({ url: await storage.urlFor(stored.key, stored.driver), name: req.file.originalname || "", type: req.file.mimetype || "" });
});

module.exports = { listAssignments, getAssignment, saveSubmission, submitAssignment, uploadAssignmentFile, shapeMine };
