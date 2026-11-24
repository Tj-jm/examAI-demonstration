const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Batch = require("../../models/batchModel");
require("../../models/programModel"); // populated below
const Student = require("../../models/studentModel");
const GradeRemark = require("../../models/gradeRemarkModel");
const AppSettings = require("../../models/appSettingsModel");
const { staffBatchIds } = require("../../utils/staffBatchIds");
const { roster } = require("../../utils/roster");
const { buildGradebook, SCALES, DEFAULT_CATEGORIES } = require("../../utils/gradebook");
const { cleanSignatures } = require("../../utils/certificates");
const { resolveOwnMediaKey } = require("../../utils/mediaUrl");

// The gradebook for staff: owners and admins anywhere, teachers on their own
// batches. Graders mark anonymously, so they get no gradebook.

const loadBatch = async (req, res) => {
  if (req.user.role === "grader") { res.status(403); throw new Error("Graders don't see the gradebook."); }
  const { batchId } = req.params;
  if (!mongoose.isValidObjectId(batchId)) { res.status(404); throw new Error("Batch not found."); }
  const ids = await staffBatchIds(req.user);
  if (ids && !ids.some((id) => String(id) === String(batchId))) { res.status(403); throw new Error("You are not assigned to this batch."); }
  const batch = await Batch.findById(batchId).select("name program gradebook").populate("program", "name");
  if (!batch) { res.status(404); throw new Error("Batch not found."); }
  return batch;
};

const remarksFor = async (batchId) => {
  const list = await GradeRemark.find({ batch: batchId }).select("student text").lean();
  return Object.fromEntries(list.map((r) => [String(r.student), r.text]));
};

//@desc   A batch's gradebook: every student on its register, every graded item
//@route  GET /api/grading/gradebook/:batchId
const getGradebook = asyncHandler(async (req, res) => {
  const batch = await loadBatch(req, res);
  const students = await roster(batch._id);
  const book = await buildGradebook(batch, students);
  const settings = await AppSettings.get();
  res.json({
    batch: { _id: batch._id, name: batch.name, program: batch.program?.name || null },
    ...book,
    remarks: await remarksFor(batch._id),
    brand: { name: settings.siteName || "", logo: settings.logo || null },
    presets: { scales: SCALES, categories: DEFAULT_CATEGORIES },
  });
});

const clean = (s, max) => String(s || "").trim().slice(0, max);

//@desc   Categories, weights, scale, item overrides, publishing
//@route  PUT /api/grading/gradebook/:batchId/settings
const updateSettings = asyncHandler(async (req, res) => {
  const batch = await loadBatch(req, res);
  const b = req.body || {};
  const g = batch.gradebook || {};
  if (Array.isArray(b.categories)) {
    const seen = new Set();
    g.categories = b.categories
      .map((c) => ({ name: clean(c.name, 40), weight: Math.max(0, Math.min(100, Number(c.weight) || 0)) }))
      .filter((c) => c.name && !seen.has(c.name) && seen.add(c.name))
      .slice(0, 12);
  }
  if (Array.isArray(b.scale)) {
    const rows = b.scale
      .map((r) => ({
        letter: clean(r.letter, 6),
        min: Math.max(0, Math.min(100, Number(r.min) || 0)),
        points: r.points === "" || r.points === null || r.points === undefined ? null : Math.max(0, Math.min(10, Number(r.points) || 0)),
      }))
      .filter((r) => r.letter)
      .slice(0, 15);
    if (rows.length && !rows.some((r) => r.min === 0)) { res.status(400); throw new Error("The scale needs a row starting at 0%, so every score gets a grade."); }
    g.scale = rows;
  }
  if (Array.isArray(b.overrides)) {
    g.overrides = b.overrides
      .filter((o) => mongoose.isValidObjectId(o.ref) && (o.category || o.excluded))
      .map((o) => ({ ref: o.ref, category: clean(o.category, 40) || null, excluded: Boolean(o.excluded) }))
      .slice(0, 500);
  }
  for (const k of ["missingAsZero", "published", "showRank"]) if (b[k] !== undefined) g[k] = Boolean(b[k]);
  if (b.term !== undefined) g.term = clean(b.term, 80);
  if (b.signedBy !== undefined) g.signedBy = clean(b.signedBy, 80);
  if (Array.isArray(b.signatures)) {
    g.signatures = cleanSignatures(b.signatures, resolveOwnMediaKey);
    // The list now says who signs; the old single line would only come back
    // if the list were emptied.
    g.signedBy = "";
  }
  batch.gradebook = g;
  batch.markModified("gradebook");
  await batch.save();
  res.json({ ok: true });
});

//@desc   A teacher's remark on one student's report card
//@route  PUT /api/grading/gradebook/:batchId/remarks/:studentId
const saveRemark = asyncHandler(async (req, res) => {
  const batch = await loadBatch(req, res);
  const { studentId } = req.params;
  if (!mongoose.isValidObjectId(studentId) || !(await Student.exists({ _id: studentId }))) { res.status(404); throw new Error("Student not found."); }
  const text = clean(req.body?.text, 1000);
  await GradeRemark.findOneAndUpdate(
    { batch: batch._id, student: studentId },
    { text, by: req.user._id },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  res.json({ ok: true, text });
});

module.exports = { getGradebook, updateSettings, saveRemark };
