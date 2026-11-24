const Batch = require("../models/batchModel");

// Shared by every controller that needs "which batches can this staff
// account actually touch" — owner/admin see every batch (null means "no
// restriction"), a teacher or grader only ever sees batches they're
// assigned to (the teachers array or graders array respectively). Started
// life duplicated inside gradingController.js; pulled out here once
// submissionsController.js needed the exact same rule, rather than letting
// a second hand-copied version quietly drift out of sync with the first —
// the same "one calculation, every caller" discipline this codebase already
// applies to buildPerformance/countResolved elsewhere.
const staffBatchIds = async (user) => {
  if (["owner", "admin"].includes(user.role)) return null; // null means "no restriction"
  const field = user.role === "grader" ? "graders" : "teachers";
  return Batch.find({ [field]: user._id }).distinct("_id");
};

module.exports = { staffBatchIds };
