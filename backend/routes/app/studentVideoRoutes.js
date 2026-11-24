const express = require("express");
const router = express.Router({ mergeParams: true });

const { requestVideo, listVideos, getVideo, deleteVideo } = require("../../controllers/app/studentVideoController");
const { aiLimiter } = require("../../middleware/rateLimit");

// Mounted under /api/app/batches/:batchId/videos by batchRoutes, behind
// studentProtect + batchAccess + requireFeature("aiAssist") +
// requireFeature("studentVideos").

router.get("/", listVideos);
router.post("/", aiLimiter, requestVideo);
router.get("/:id", getVideo);
router.delete("/:id", deleteVideo);

module.exports = router;
