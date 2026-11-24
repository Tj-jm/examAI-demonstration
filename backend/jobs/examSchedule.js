const cron = require("node-cron");
const shared = require("../utils/shared");
const Exam = require("../models/examModel");

// Unpublishes exams whose unpublishAt has passed. Checked every minute, so a
// missed tick (restart, deploy) is caught on the next one. Saved one by one
// so the model's hooks (cache, leaderboard) run.
const checkExamSchedule = async () => {
  const due = await Exam.find({ isPublished: true, unpublishAt: { $ne: null, $lte: new Date() } });
  for (const exam of due) {
    exam.isPublished = false;
    exam.unpublishAt = undefined;
    await exam.save();
  }
};

// Called once from server.js. With several servers, one runs each check.
const runChecked = () =>
  shared
    .runOnce("examSchedule", 50 * 1000, checkExamSchedule)
    .catch((err) => console.error("Exam schedule check failed:", err));

const start = () => {
  runChecked();
  cron.schedule("* * * * *", runChecked);
};

module.exports = { start, checkExamSchedule };
