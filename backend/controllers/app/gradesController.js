const asyncHandler = require("express-async-handler");
const Batch = require("../../models/batchModel");
require("../../models/programModel"); // populated below
const GradeRemark = require("../../models/gradeRemarkModel");
const AppSettings = require("../../models/appSettingsModel");
const { roster } = require("../../utils/roster");
const { buildGradebook, settingsFor } = require("../../utils/gradebook");

// A student's own grades and report card in a batch, once the batch's
// gradebook is published (Gradebook → Settings).

//@desc   My grades in this batch
//@route  GET /api/app/batches/:batchId/grades
//@access Private (student, batchAccess)
const getMyGrades = asyncHandler(async (req, res) => {
  const batch = await Batch.findById(req.batch._id).select("name program gradebook").populate("program", "name");
  const settings = settingsFor(batch);
  if (!settings.published) return res.json({ published: false });

  // Rank needs the whole class; otherwise only this student is worked out.
  const me = { _id: req.student._id, name: req.student.name, studentId: req.student.studentId };
  const students = settings.showRank ? await roster(batch._id) : [me];
  if (!students.some((s) => String(s._id) === String(me._id))) students.push(me);
  const book = await buildGradebook(batch, students, { forStudent: true });
  const row = book.rows.find((r) => String(r.student._id) === String(me._id));
  const remark = await GradeRemark.findOne({ batch: batch._id, student: me._id }).select("text").lean();
  const app = await AppSettings.get();

  res.json({
    published: true,
    batch: { _id: batch._id, name: batch.name, program: batch.program?.name || null },
    brand: { name: app.siteName || "", logo: app.logo || null },
    settings: { categories: settings.categories, scale: settings.scale, term: settings.term, signedBy: settings.signedBy, signatures: settings.signatures, showRank: settings.showRank },
    items: book.items.filter((i) => !i.excluded).map(({ id, kind, title, category, max, date }) => ({ id, kind, title, category, max, date })),
    row: { ...row, rank: settings.showRank ? row.rank : null },
    classSize: settings.showRank ? book.ranked : null,
    remark: remark?.text || "",
  });
});

module.exports = { getMyGrades };
