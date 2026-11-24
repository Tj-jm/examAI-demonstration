const asyncHandler = require("express-async-handler");
const AiConfig = require("../../models/aiConfigModel");
const { getUsageSnapshot } = require("../../ai/usage");

//@desc   This student's AI usage on this batch — today's free calls used
//        and left, plus both credit pools (batch-specific and general).
//        Built from the exact same helpers assertWithinCaps uses to
//        actually enforce the cap, so this meter can never show "you're
//        fine" the moment before a call gets blocked, or vice versa.
//@route  GET /api/app/batches/:batchId/ai-usage
//@access Private (student + batchAccess)
const getAiUsage = asyncHandler(async (req, res) => {
  const config = await AiConfig.get();
  const snapshot = await getUsageSnapshot({
    student: req.student._id,
    batch: req.batch._id,
    config,
  });

  res.status(200).json(snapshot);
});

module.exports = { getAiUsage };
