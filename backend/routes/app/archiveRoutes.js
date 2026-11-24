const express = require("express");
const router = express.Router({ mergeParams: true });

const asyncHandler = require("express-async-handler");
const { requireFeature } = require("../../middleware/batchAccess");
const { uploadImage } = require("../../middleware/upload");
const { uploadPracticeAnswerImage } = require("../../controllers/app/practiceController");
const {
  getFilters,
  getTopics,
  getQuestions,
  submitAttempt,
  explainAttempt,
  getHint,
  gradeWrittenAttempt,
  getPredictedSets,
  getPredictedSetQuestions,
  getSimilarQuestions,
  getWeakTopics,
  getPersonalizedQuestions,
  getAiUsage,
  toggleFavorite,
  getFavoriteIds,
  getFavoriteQuestions,
} = require("../../controllers/app/archiveController");
const {
  getStudyPlan,
  getStudyPlanCapacity,
  generateStudyPlan,
  toggleStudyPlanDay,
} = require("../../controllers/app/archiveStudyPlanController");
const {
  getRecord,
  buildArchiveExam,
  submitArchiveExam,
  getArchiveExamInsight,
} = require("../../controllers/app/archivePracticeExamController");

// Mounted at /:batchId/archive by batchRoutes.js, already behind
// studentProtect + batchAccess. The batch must have at least one board/exam
// /book assigned (Batch.archiveAuthorities) — that list IS the "is this on"
// switch for this module, not a separate boolean.
router.use(
  asyncHandler(async (req, res, next) => {
    if (!req.batch.archiveAuthorities || req.batch.archiveAuthorities.length === 0) {
      res.status(403);
      throw new Error("The archive is not available for this batch.");
    }
    next();
  })
);

router.get("/filters", getFilters);
router.get("/topics", getTopics);
router.get("/favorites/ids", getFavoriteIds);
router.get("/favorites", getFavoriteQuestions);
router.post("/favorites/:questionId", toggleFavorite);
router.get("/questions", getQuestions);
router.get("/predicted", getPredictedSets);
router.get("/predicted/:id/questions", getPredictedSetQuestions);
router.post("/questions/:id/attempt", submitAttempt);
router.post("/questions/:id/explain", requireFeature("archiveAiAssist"), explainAttempt);
router.post("/questions/:id/hint", requireFeature("archiveAiAssist"), getHint);
router.post("/questions/:id/grade-written", requireFeature("archiveAiAssist"), gradeWrittenAttempt);
router.post("/questions/:id/similar", requireFeature("archiveAiAssist"), getSimilarQuestions);
router.get("/weak-topics", getWeakTopics);
router.get("/personalized", getPersonalizedQuestions);
router.get("/ai-usage", getAiUsage);

router.get("/study-plan", getStudyPlan);
router.get("/study-plan/capacity", getStudyPlanCapacity);
router.post("/study-plan/generate", requireFeature("archiveAiAssist"), requireFeature("archiveStudyPlan"), generateStudyPlan);
router.patch("/study-plan/days/:day/complete", toggleStudyPlanDay);

router.get("/exam-record", getRecord);
router.post("/exam", buildArchiveExam);
router.post("/exam/submit", submitArchiveExam);
// Same upload as batch practice (checks writtenAnswerImages itself) — the
// archive router just doesn't sit behind features.practice.
router.post("/upload-answer-image", uploadImage, uploadPracticeAnswerImage);
router.post("/exam/insight", requireFeature("archiveAiAssist"), requireFeature("archiveExamInsight"), getArchiveExamInsight);

module.exports = router;
