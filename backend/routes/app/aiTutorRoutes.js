const express = require("express");
const router = express.Router({ mergeParams: true });

const { getTutorSettings, startSession, takeTurn, endSession, listSessions, getSession, deleteSession, unlockPack, uploadAnswerImage } = require("../../controllers/app/aiTutorController");
const { uploadImage } = require("../../middleware/upload");
const { aiLimiter } = require("../../middleware/rateLimit");

// Mounted under /api/app/batches/:batchId/tutoring by batchRoutes, behind
// studentProtect + batchAccess + requireFeature("aiAssist") +
// requireFeature("aiTutor").

router.get("/settings", getTutorSettings);
router.post("/start", aiLimiter, startSession);
router.post("/unlock", unlockPack);
router.post("/upload-image", uploadImage, uploadAnswerImage);
router.get("/sessions", listSessions);
router.get("/sessions/:id", getSession);
router.delete("/sessions/:id", deleteSession);
router.post("/sessions/:id/turn", aiLimiter, takeTurn);
router.post("/sessions/:id/end", endSession);

module.exports = router;
