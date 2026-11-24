const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const AiConfig = require("../../models/aiConfigModel");
const { Assignment, AssignmentSubmission } = require("../../models/assignmentModel");
const { staffBatchIds } = require("../../utils/staffBatchIds");
const { toAbsoluteUrl } = require("../../utils/mediaUrl");

//@desc   AI checking: a suggested grade and feedback for one hand-in
//@route  POST /api/grading/assignments/submissions/:subId/ai-check
//@access Private (owner, admin, teacher and grader on the batch)
const aiCheck = asyncHandler(async (req, res) => {
  const config = await AiConfig.get();
  if (!config.features?.assignmentChecking) { res.status(403); throw new Error("AI checking for assignments is switched off. Turn it on in Settings → AI → Features."); }
  if (!mongoose.isValidObjectId(req.params.subId)) { res.status(404); throw new Error("Hand-in not found."); }
  const submission = await AssignmentSubmission.findById(req.params.subId);
  if (!submission) { res.status(404); throw new Error("Hand-in not found."); }
  const ids = await staffBatchIds(req.user);
  if (ids && !ids.some((id) => String(id) === String(submission.batch))) { res.status(403); throw new Error("You are not assigned to this batch."); }
  if (submission.status === "draft") { res.status(409); throw new Error("This hasn't been handed in yet."); }
  if (!submission.text?.trim() && !submission.files?.length) { res.status(400); throw new Error("This hand-in is empty."); }
  const assignment = await Assignment.findById(submission.assignment);
  try {
    const suggestion = await require("../../ai/assignmentCheck").checkSubmission({
      assignment, submission, toUrl: (u) => toAbsoluteUrl(req, u), by: "check", user: req.user._id,
    });
    res.status(200).json(suggestion);
  } catch (error) {
    res.status(502);
    throw new Error(error.message || "Couldn't check this with AI right now.");
  }
});

module.exports = { aiCheck };
