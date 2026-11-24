const express = require("express");
const router = express.Router({ mergeParams: true });

const {
  createDoubt, regenerateDoubt, escalateDoubt, requestReview, getMyDoubts, getDoubt, uploadDoubtImage, getDoubtQuota,
} = require("../../controllers/app/doubtController");
const { uploadImage } = require("../../middleware/upload");

// Mounted under /api/app/batches/:batchId/doubts by batchRoutes, behind
// studentProtect + batchAccess + requireFeature("doubtSolving") already
// applied there.

router.get("/", getMyDoubts);
router.get("/quota", getDoubtQuota);
router.post("/", createDoubt);
router.post("/upload-image", uploadImage, uploadDoubtImage);
router.get("/:id", getDoubt);
router.post("/:id/regenerate", regenerateDoubt);
router.post("/:id/escalate", escalateDoubt);
router.post("/:id/request-review", requestReview);

module.exports = router;
