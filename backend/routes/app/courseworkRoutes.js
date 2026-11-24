const express = require("express");
const router = express.Router({ mergeParams: true });
const { uploadImage } = require("../../middleware/upload");
const {
  listAssignments, getAssignment, saveSubmission, submitAssignment, uploadAssignmentFile,
} = require("../../controllers/app/courseworkController");

// Mounted under /api/app/batches/:batchId/assignments by batchRoutes, behind
// studentProtect + batchAccess + requireFeature("assignments").
router.get("/", listAssignments);
router.get("/:id", getAssignment);
router.put("/:id/submission", saveSubmission);
router.post("/:id/submit", submitAssignment);
router.post("/:id/upload", uploadImage, uploadAssignmentFile);

module.exports = router;
