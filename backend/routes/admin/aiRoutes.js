const express = require("express");
const router = express.Router({ mergeParams: true });

const {
  generateQuestions,
  generateFromBank,
  backfillSolutions,
  backfillSkillTypes,
  reviewQuestion,
  auditQuestionPool,
  getAuditPool,
  auditPoolDecision,
  getOpenAudits,
  getReviewQueue,
  reviewQueueDecision,
  reviewQueueRejectAll,
  solutionReviewDecision,
  getUsage,
} = require("../../controllers/admin/aiController");

const {
  getGeneralCreditPlans,
  createGeneralCreditPlan,
  updateGeneralCreditPlan,
  deleteGeneralCreditPlan,
} = require("../../controllers/admin/aiCreditController");

const {
  getLocalModels,
  pullModel,
  getPullStatus,
} = require("../../controllers/admin/localModelController");

const {
  getEmbeddedModels,
  getPullStatus: getEmbeddedPullStatus,
  pullModel: pullEmbeddedModel,
  deleteEmbeddedModel,
  stopEmbeddedModel,
} = require("../../controllers/admin/embeddedModelController");

const {
  preview,
  generateFromDocument,
  transcribeDocument,
  questionsFromText,
  getJobStatus,
  getJobs,
  cancelJob,
  getDocuments,
  deleteDocument,
} = require("../../controllers/admin/ingestController");

const {
  createPredictedPaper,
  getPredictedPapers,
  getPredictedPaper,
  createExamFromPrediction,
  setShared: setPredictedPaperShared,
  retryPredictedPaper,
  deletePredictedPaper,
} = require("../../controllers/admin/predictedPaperController");
const { protect, allow } = require("../../middleware/adminAuth");
const { uploadDocument, uploadPageFile } = require("../../middleware/upload");
const { aiLimiter } = require("../../middleware/rateLimit");

router.use(protect, require("../../middleware/adminAuth").featureOff("ai", { writesOnly: true }));

// The connection settings and test are in aiConfigRoutes.js.

// Managing what is installed on the host is an owner concern.
router.get("/local/models", allow("owner", "admin"), getLocalModels);
router.post("/local/pull", allow("owner", "admin"), pullModel);
router.get("/local/pull-status", allow("owner", "admin"), getPullStatus);

// Same, for the embedded (in-process, no separate server) provider — a
// distinct set of routes rather than reusing /local/* above, since these
// download from Hugging Face into this server's own disk rather than
// proxying to an Ollama-compatible address.
router.get("/embedded/models", allow("owner", "admin"), getEmbeddedModels);
router.post("/embedded/pull", allow("owner", "admin"), pullEmbeddedModel);
router.get("/embedded/pull-status", allow("owner", "admin"), getEmbeddedPullStatus);
router.post("/embedded/stop", allow("owner", "admin"), stopEmbeddedModel);
router.delete("/embedded/models/:id", allow("owner", "admin"), deleteEmbeddedModel);

router.get("/usage", allow("owner", "admin"), getUsage);

// What students asked the course documents (document chat), mostly to see
// what the notes don't cover.
router.get("/doc-chat/questions", allow("owner", "admin", "teacher"), require("../../controllers/admin/docChatAdminController").getDocChatQuestions);

// General AI credit packs — not tied to any one batch, same access level
// as pricing everywhere else: an admin decision, not a teaching one.
router
  .route("/credit-plans")
  .get(allow("owner", "admin"), getGeneralCreditPlans)
  .post(allow("owner", "admin"), createGeneralCreditPlan);
router
  .route("/credit-plans/:planId")
  .put(allow("owner", "admin"), updateGeneralCreditPlan)
  .delete(allow("owner", "admin"), deleteGeneralCreditPlan);

// Anything that spends money is rate limited on top of the global limiter.
router.post("/generate-questions", aiLimiter, generateQuestions);
router.post("/generate-from-bank", aiLimiter, generateFromBank);

// Generating from a whole document. Preview costs nothing and is not limited
// the same way, because reading a file is local work.
router.post("/ingest/preview", uploadDocument, preview);
router.post("/ingest/generate", aiLimiter, uploadDocument, generateFromDocument);
router.post("/ingest/transcribe", aiLimiter, uploadPageFile, transcribeDocument);
router.post("/ingest/from-text", aiLimiter, questionsFromText);
router.get("/ingest/status/:jobId", getJobStatus);
// Runs keep going on the server while the admin works elsewhere; these let
// any page show them and stop one.
router.get("/ingest/jobs", getJobs);
router.post("/ingest/jobs/:jobId/cancel", cancelJob);

// The library of previously ingested documents, so a second batch of
// questions from the same source does not need the file re-uploaded.
router.get("/documents", getDocuments);
router.delete("/documents/:id", deleteDocument);
router.post("/backfill-solutions", aiLimiter, backfillSolutions);
router.post("/model-answer", aiLimiter, require("../../controllers/admin/aiController").writeModelAnswer);
router.post("/coding-starter", aiLimiter, require("../../controllers/admin/aiController").writeCodingStarter);
router.post("/backfill-skill-types", aiLimiter, backfillSkillTypes);
router.post("/review-question/:id", aiLimiter, reviewQuestion);

router
  .route("/predicted-paper")
  .get(getPredictedPapers)
  .post(aiLimiter, createPredictedPaper);
router.route("/predicted-paper/:id").get(getPredictedPaper).delete(deletePredictedPaper);
router.post("/predicted-paper/:id/retry", aiLimiter, retryPredictedPaper);
router.post("/predicted-paper/:id/exam", createExamFromPrediction);
router.put("/predicted-paper/:id/share", setPredictedPaperShared);

router.get("/audit-pool", getOpenAudits);
router.post("/audit-pool", aiLimiter, auditQuestionPool);
router
  .route("/audit-pool/:id")
  .get(getAuditPool)
  .put(auditPoolDecision);

router
  .route("/review-queue")
  .get(getReviewQueue)
  .put(reviewQueueDecision);

// Clearing the whole page at once, as opposed to deciding one question at a
// time. Its own route so the owner/admin gate is visible here next to the
// ungated single-decision route above, rather than hidden inside a controller.
router.put("/review-queue/reject-all", allow("owner", "admin"), reviewQueueRejectAll);

router.put("/review-solutions", solutionReviewDecision);

module.exports = router;
