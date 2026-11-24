const express = require("express");
const router = express.Router({ mergeParams: true });

const { ask, listThreads, getThread, deleteThread, getChatSettings, unlockPack, uploadChatImage } = require("../../controllers/app/docChatController");
const { aiLimiter } = require("../../middleware/rateLimit");
const { uploadImage } = require("../../middleware/upload");

// Mounted under /api/app/batches/:batchId/chat by batchRoutes, behind
// studentProtect + batchAccess + requireFeature("aiAssist") +
// requireFeature("docChat").

router.get("/settings", getChatSettings);
router.post("/", aiLimiter, ask);
router.post("/unlock", unlockPack);
router.post("/upload-image", uploadImage, uploadChatImage);
router.get("/threads", listThreads);
router.get("/threads/:id", getThread);
router.delete("/threads/:id", deleteThread);

module.exports = router;
