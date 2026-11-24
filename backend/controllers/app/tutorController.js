const asyncHandler = require("express-async-handler");
const AiConfig = require("../../models/aiConfigModel");
const tutor = require("../../utils/tutor");

// The student's daily tutor (agents → tutor), per batch.
const assertOn = async (res) => {
  const a = (await AiConfig.get()).agents || {};
  if (!a.enabled || !a.tutor?.enabled) {
    res.status(403);
    throw new Error("The tutor isn't available right now.");
  }
};

//@desc   Today's plan, progress, streak and sprint
//@route  GET /api/app/batches/:batchId/tutor?tz=
//@access Private (student + batchAccess + features.agentTutor)
const getToday = asyncHandler(async (req, res) => {
  await assertOn(res);
  const tz = String(req.query.tz || "").slice(0, 60) || undefined;
  res.status(200).json(await tutor.today(req.student._id, req.batch._id, { timezone: tz }));
});

//@desc   Turn the tutor on or off, or set an exam to sprint towards
//@route  PUT /api/app/batches/:batchId/tutor  { enabled, sprintDate, sprintLabel, sprintExamId }
//@access Private (student + batchAccess + features.agentTutor)
const updateTutor = asyncHandler(async (req, res) => {
  await assertOn(res);
  try {
    await tutor.update(req.student._id, req.batch._id, req.body || {});
  } catch (err) {
    res.status(err.statusCode || 400);
    throw err;
  }
  res.status(200).json(await tutor.today(req.student._id, req.batch._id, {}));
});

module.exports = { getToday, updateTutor };
