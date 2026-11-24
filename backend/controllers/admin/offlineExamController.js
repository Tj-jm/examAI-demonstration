const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Batch = require("../../models/batchModel");
const Exam = require("../../models/examModel");
const Submission = require("../../models/submissionModel");
const { staffBatchIds } = require("../../utils/staffBatchIds");
const { roster } = require("../../utils/roster");
const { notify } = require("../../utils/notify");

// Offline exams: sat on paper at the centre, marks entered on a sheet of the
// batch's students (admin pages/offline/OfflineMarks.jsx). Each one is an
// Exam with `offline` set (no questions, never taken in the app) and each
// student's mark a graded Submission with `offline` set, so it counts in
// results, the gradebook and reports like any other exam. Absent: an
// abandoned submission (no score, nothing counted).
// Owners and admins anywhere, teachers on their own batches.

const loadBatch = async (req, res) => {
  if (req.user.role === "grader") { res.status(403); throw new Error("Graders can't enter offline marks."); }
  const { batchId } = req.params;
  if (!mongoose.isValidObjectId(batchId)) { res.status(404); throw new Error("Batch not found."); }
  const ids = await staffBatchIds(req.user);
  if (ids && !ids.some((id) => String(id) === String(batchId))) { res.status(403); throw new Error("You are not assigned to this batch."); }
  const batch = await Batch.findById(batchId).select("name");
  if (!batch) { res.status(404); throw new Error("Batch not found."); }
  return batch;
};

const loadExam = async (req, res, batch) => {
  if (!mongoose.isValidObjectId(req.params.examId)) { res.status(404); throw new Error("Offline exam not found."); }
  const exam = await Exam.findOne({ _id: req.params.examId, batches: batch._id, offline: { $ne: null } });
  if (!exam) { res.status(404); throw new Error("Offline exam not found."); }
  return exam;
};

const studentsOf = async (batchId) => (await roster(batchId)).map((s) => ({
  _id: s._id,
  name: s.name,
  studentId: s.studentId || "",
  phone: String(s.phoneNumber || "").replace(/\D/g, "").slice(-4),
  email: s.email || "",
}));

const examMeta = (e) => ({
  _id: e._id,
  title: e.title,
  date: e.offline.date,
  fullMarks: e.offline.fullMarks,
  passMarks: e.offline.passMarks,
  parts: e.offline.parts || [],
  log: (e.offline.log || []).slice(-20),
});

const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

// The sheet's header and rows, checked. Throws a 400 naming the first
// problem (a row's student by name).
const readSheet = (body, students, res) => {
  const fail = (msg) => { res.status(400); throw new Error(msg); };
  const title = String(body.title || "").trim().slice(0, 200);
  if (!title) fail("Give the exam a name.");
  const date = new Date(body.date);
  if (Number.isNaN(date.getTime())) fail("Give the exam's date.");
  const fullMarks = num(body.fullMarks);
  if (!(fullMarks > 0) || fullMarks > 100000) fail("Give the full marks.");
  const passMarks = num(body.passMarks);
  if (passMarks !== null && (!(passMarks >= 0) || passMarks > fullMarks)) fail("The pass mark must be between 0 and the full marks.");
  const parts = (Array.isArray(body.parts) ? body.parts : []).slice(0, 50).map((p, i) => ({
    label: String(p?.label || `Q${i + 1}`).trim().slice(0, 40) || `Q${i + 1}`,
    max: num(p?.max),
  }));
  for (const p of parts) if (p.max !== null && !(p.max >= 0)) fail(`${p.label}: give its marks or leave them empty.`);
  const names = new Map(students.map((s) => [String(s._id), s.name]));
  const rows = [];
  for (const r of Array.isArray(body.rows) ? body.rows : []) {
    const id = String(r?.student || "");
    if (!names.has(id)) continue; // no longer on the register
    const name = names.get(id);
    const absent = Boolean(r.absent);
    const marks = num(r.marks);
    const partMarks = parts.map((_, j) => num(r.parts?.[j]));
    if (!absent) {
      if (marks === null) continue; // left blank: no submission
      if (!(marks >= 0) || marks > fullMarks) fail(`${name}: the mark must be between 0 and ${fullMarks}.`);
      partMarks.forEach((m, j) => {
        if (m !== null && (!(m >= 0) || (parts[j].max !== null && m > parts[j].max))) fail(`${name}, ${parts[j].label}: the mark must be between 0 and ${parts[j].max ?? "its maximum"}.`);
      });
    }
    rows.push({ student: id, absent, marks: absent ? null : marks, parts: absent ? [] : partMarks, remark: String(r.remark || "").trim().slice(0, 300) });
  }
  if (!rows.length) fail("Enter at least one student's mark (or mark them absent).");
  return { title, date, fullMarks, passMarks, parts, rows };
};

// Each row as the student's submission: created, or changed in place.
// Returns how many were new or changed, and the new graded ones (to tell).
const writeRows = async (exam, batch, sheet, userId) => {
  const existing = new Map((await Submission.find({ exam: exam._id, batch: batch._id })).map((s) => [String(s.student), s]));
  let changed = 0;
  const graded = [];
  for (const r of sheet.rows) {
    const status = r.absent ? "abandoned" : "graded";
    const offline = { absent: r.absent, remark: r.remark, parts: r.parts, enteredBy: userId };
    const sub = existing.get(r.student);
    if (sub) {
      const same = sub.status === status && sub.marks === r.marks && sub.totalMarks === sheet.fullMarks
        && (sub.offline?.remark || "") === r.remark && JSON.stringify(sub.offline?.parts || []) === JSON.stringify(r.parts);
      if (same) continue;
      Object.assign(sub, { status, marks: r.marks, totalMarks: sheet.fullMarks, offline, submittedAt: sheet.date, startedAt: sheet.date });
      await sub.save();
      changed += 1;
      continue;
    }
    const sub2 = await Submission.create({
      exam: exam._id, student: r.student, batch: batch._id, attempt: 1, status,
      marks: r.marks, totalMarks: sheet.fullMarks, answers: [], offline,
      startedAt: sheet.date, submittedAt: sheet.date,
    });
    changed += 1;
    if (status === "graded") graded.push(sub2);
  }
  return { changed, graded };
};

const tell = async (subs, title) => {
  for (const s of subs) {
    await notify(s.student, "examGraded", { title: "Your exam result is out", body: `${title} (offline)`, link: `/submissions/${s._id}` }).catch(() => {});
  }
};

//@desc   The batch's register and its offline exams
//@route  GET /api/grading/offline-exams/:batchId
const listOffline = asyncHandler(async (req, res) => {
  const batch = await loadBatch(req, res);
  const [students, exams] = await Promise.all([
    studentsOf(batch._id),
    Exam.find({ batches: batch._id, offline: { $ne: null } }).sort({ "offline.date": -1 }),
  ]);
  const counts = await Submission.aggregate([
    { $match: { exam: { $in: exams.map((e) => e._id) } } },
    { $group: { _id: "$exam", n: { $sum: 1 } } },
  ]);
  const byExam = new Map(counts.map((c) => [String(c._id), c.n]));
  res.json({ batch: { _id: batch._id, name: batch.name }, students, exams: exams.map((e) => ({ ...examMeta(e), entered: byExam.get(String(e._id)) || 0 })) });
});

//@desc   One offline exam's sheet: its details and every entered row
//@route  GET /api/grading/offline-exams/:batchId/:examId
const getOffline = asyncHandler(async (req, res) => {
  const batch = await loadBatch(req, res);
  const exam = await loadExam(req, res, batch);
  const subs = await Submission.find({ exam: exam._id, batch: batch._id }).select("student status marks offline").lean();
  res.json({
    exam: examMeta(exam),
    rows: subs.map((s) => ({ student: s.student, absent: s.status === "abandoned", marks: s.marks, parts: s.offline?.parts || [], remark: s.offline?.remark || "" })),
  });
});

//@desc   Create an offline exam from a filled sheet; each student's result
//        is published at once
//@route  POST /api/grading/offline-exams/:batchId
const createOffline = asyncHandler(async (req, res) => {
  const batch = await loadBatch(req, res);
  const sheet = readSheet(req.body, await studentsOf(batch._id), res);
  const exam = await Exam.create({
    title: sheet.title,
    batches: [batch._id],
    questions: [],
    mode: "test",
    durationMinutes: 60, // required by the model; not used offline
    isPublished: true,
    isActive: true,
    opensAt: sheet.date,
    closesAt: sheet.date,
    offline: { date: sheet.date, fullMarks: sheet.fullMarks, passMarks: sheet.passMarks, parts: sheet.parts, createdBy: req.user._id, log: [{ at: new Date(), by: req.user._id, note: `Created with ${sheet.rows.length} rows` }] },
  });
  const { graded } = await writeRows(exam, batch, sheet, req.user._id);
  if (req.body.notify !== false) tell(graded, exam.title);
  res.status(201).json({ exam: examMeta(exam), saved: sheet.rows.length });
});

//@desc   Change an offline exam's details or marks (new rows added, changed
//        ones updated; a row emptied is left as it was)
//@route  PUT /api/grading/offline-exams/:batchId/:examId
const updateOffline = asyncHandler(async (req, res) => {
  const batch = await loadBatch(req, res);
  const exam = await loadExam(req, res, batch);
  const sheet = readSheet(req.body, await studentsOf(batch._id), res);
  exam.title = sheet.title;
  exam.opensAt = sheet.date;
  exam.closesAt = sheet.date;
  Object.assign(exam.offline, { date: sheet.date, fullMarks: sheet.fullMarks, passMarks: sheet.passMarks, parts: sheet.parts });
  const { changed, graded } = await writeRows(exam, batch, sheet, req.user._id);
  exam.offline.log = [...(exam.offline.log || []), { at: new Date(), by: req.user._id, note: `Edited: ${changed} row${changed === 1 ? "" : "s"} changed` }].slice(-100);
  exam.markModified("offline");
  await exam.save();
  if (req.body.notify !== false) tell(graded, exam.title);
  res.json({ exam: examMeta(exam), changed });
});

//@desc   Delete an offline exam and every result entered for it
//@route  DELETE /api/grading/offline-exams/:batchId/:examId
const deleteOffline = asyncHandler(async (req, res) => {
  const batch = await loadBatch(req, res);
  if (!["owner", "admin"].includes(req.user.role)) { res.status(403); throw new Error("Only an owner or admin can delete an offline exam."); }
  const exam = await loadExam(req, res, batch);
  await Submission.deleteMany({ exam: exam._id });
  await exam.deleteOne();
  res.json({ ok: true });
});

module.exports = { listOffline, getOffline, createOffline, updateOffline, deleteOffline };
