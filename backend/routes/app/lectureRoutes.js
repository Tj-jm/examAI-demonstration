const express = require("express");
const router = express.Router({ mergeParams: true });

const { getLectures, getLecture, updateProgress, summarizeLecture, summarizeLectureAttachments, getPracticeQuestions } = require("../../controllers/app/lectureController");
const { requireFeature } = require("../../middleware/batchAccess");

// Mounted under /api/app/batches/:batchId/lectures by batchRoutes, behind
// studentProtect + batchAccess + requireFeature("lectures") already applied
// there — nothing here needs to repeat those checks.

router.get("/", getLectures);
router.get("/:id", getLecture);
router.put("/:id/progress", updateProgress);
router.post("/:id/summarize", requireFeature("aiAssist"), summarizeLecture);
router.post("/:id/summarize-attachments", requireFeature("aiAssist"), summarizeLectureAttachments);
// requireFeature("practice") rather than aiAssist — reading an already
// generated/assigned practice set needs the platform's practice feature on,
// same as an exam needs features.exams; aiAssist only gates the admin-side
// generation step (lectureController.js's generatePracticeQuestions), not
// viewing what's already there, same split lecture-summarize's own cache
// makes between generating and reading.
router.get("/:id/practice", requireFeature("practice"), getPracticeQuestions);

module.exports = router;
