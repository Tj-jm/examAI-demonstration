const express = require("express");
const router = express.Router({ mergeParams: true });

const { getExams, getExamRules, startExam } = require("../../controllers/app/examController");

// Mounted under /api/app/batches/:batchId/exams by batchRoutes, behind
// studentProtect + batchAccess + requireFeature("exams") already applied
// there.
//
// Building a student's own practice paper used to live here as POST
// /custom — it now lives entirely under /practice-exams (see
// practiceExamRoutes.js), since it no longer creates an Exam at all and had
// nothing left in common with the routes on this file once it stopped
// sharing their pipeline.

router.get("/", getExams);
router.get("/:id", getExamRules);
router.post("/:id/start", startExam);

module.exports = router;
