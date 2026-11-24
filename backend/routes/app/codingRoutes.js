const express = require("express");
const router = express.Router({ mergeParams: true });
const { listProblems, getProblem, saveDraft, runProblem, submitProblem } = require("../../controllers/app/codingController");
const { codeRunLimiter } = require("../../middleware/rateLimit");

// Mounted under /api/app/batches/:batchId/coding behind studentProtect,
// batchAccess and requireFeature("codingPractice") (batchRoutes.js).
router.get("/", listProblems);
router.post("/run", codeRunLimiter, runProblem);
router.get("/:questionId", getProblem);
router.put("/:questionId/draft", saveDraft);
router.post("/:questionId/submit", codeRunLimiter, submitProblem);

module.exports = router;
