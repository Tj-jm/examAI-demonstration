const express = require("express");
const router = express.Router({ mergeParams: true });

const {
  getQuestions,
  getQuestion,
  createQuestion,
  updateQuestion,
  deleteQuestion,
  bulkCreateQuestions,
  bulkMoveQuestions,
  bulkArchiveQuestions,
  getBulkTemplate,
  importQuestionsFromFile,
  getQuestionStats,
  getQuestionTags,
  rescoreQuestionAttempts,
  applyModelAnswers,
} = require("../../controllers/admin/questionController");

const { protect } = require("../../middleware/adminAuth");
const { uploadSpreadsheet } = require("../../middleware/upload");

router.use(protect);

// Declared before /:id so "stats" and "bulk" are not read as ids.
router.get("/stats", getQuestionStats);
router.get("/tags", getQuestionTags);
router.get("/bulk/template", getBulkTemplate);
router.post("/bulk/import", uploadSpreadsheet, importQuestionsFromFile);
router.put("/bulk/move", bulkMoveQuestions);
router.put("/bulk/archive", bulkArchiveQuestions);
router.post("/bulk/model-answers", applyModelAnswers);
router.post("/bulk", bulkCreateQuestions);

router
  .route("/")
  .get(getQuestions)
  .post(createQuestion);

router.post("/:id/rescore", rescoreQuestionAttempts);

router
  .route("/:id")
  .get(getQuestion)
  .put(updateQuestion)
  .delete(deleteQuestion);

module.exports = router;
