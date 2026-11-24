const express = require("express");
const router = express.Router();

const {
  saveAnswer, logViolation, uploadAnswerImage, submitExam, getSubmission, listSubmissions, requestExamReview, runCode,
} = require("../../controllers/app/submissionController");
const { studentProtect } = require("../../middleware/studentAuth");
const { uploadImage } = require("../../middleware/upload");

router.use(studentProtect);

router.get("/", listSubmissions);
router.get("/:id", getSubmission);
router.put("/:id/answer", saveAnswer);
router.post("/:id/violation", logViolation);
router.post("/:id/answer-image", uploadImage, uploadAnswerImage);
router.post("/:id/submit", submitExam);
router.post("/:id/run-code", require("../../middleware/rateLimit").codeRunLimiter, runCode);
router.post("/:id/referral", requestExamReview);

module.exports = router;
