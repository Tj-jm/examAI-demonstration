const express = require("express");
const router = express.Router();
const { getStatus, createRun, getRuns, getRun, decide, cancelRun, sweepNow, editStep, stepPicture, previewStep, retryRun, reviseRun, deleteRun, clearRuns } = require("../../controllers/admin/agentController");
const { protect } = require("../../middleware/adminAuth");

router.use(protect);

router.get("/status", getStatus);
router.route("/runs").get(getRuns).post(createRun);
router.post("/runs/clear", clearRuns);
router.route("/runs/:id").get(getRun).delete(deleteRun);
router.post("/runs/:id/retry", retryRun);
router.post("/runs/:id/revise", reviseRun);
router.post("/runs/:id/decide", decide);
router.post("/runs/:id/cancel", cancelRun);
router.post("/sweep/:agent", sweepNow);
router.put("/runs/:id/steps/:stepId", editStep);
router.post("/runs/:id/steps/:stepId/picture", stepPicture);
router.post("/runs/:id/steps/:stepId/preview", previewStep);

module.exports = router;
