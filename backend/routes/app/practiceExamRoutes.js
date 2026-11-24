const express = require("express");
const router = express.Router({ mergeParams: true });

const { getRecord, buildPracticeExam, submitPracticeExam, getPracticeExamInsight } = require("../../controllers/app/practiceExamController");
const { aiLimiter } = require("../../middleware/rateLimit");

// Mounted under /api/app/batches/:batchId/practice-exams by batchRoutes,
// behind studentProtect + batchAccess + requireFeature("practice") already
// applied there — the same gate the topic-drill practice routes sit behind,
// since this is the same feature from the student's point of view.

router.get("/record", getRecord);
router.post("/", buildPracticeExam);
router.post("/submit", submitPracticeExam);
router.post("/insight", aiLimiter, getPracticeExamInsight);

module.exports = router;
