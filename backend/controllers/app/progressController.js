const asyncHandler = require("express-async-handler");
const progress = require("../../utils/progress");

//@desc   The student's progress in this batch: level, skills, exams, standing, topics, activity, badges
//@route  GET /api/app/batches/:batchId/progress?tz=
//@access Private (student + batchAccess)
const getProgress = asyncHandler(async (req, res) => {
  const tz = String(req.query.tz || "").slice(0, 60) || undefined;
  res.status(200).json(await progress.forStudent(req.student._id, req.batch._id, {
    timezone: tz,
    features: { exams: req.batch.hasFeature?.("exams") ?? true, practice: req.batch.hasFeature?.("practice") ?? true },
  }));
});

module.exports = { getProgress };
