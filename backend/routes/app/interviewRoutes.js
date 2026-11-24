const express = require("express");
const router = express.Router({ mergeParams: true });

const { getInterviewSettings, startSession, takeTurn, endSession, listSessions, getSession, deleteSession, unlockPack, speak } = require("../../controllers/app/interviewController");
const { aiLimiter } = require("../../middleware/rateLimit");

// Mounted under /api/app/batches/:batchId/interview by batchRoutes, behind
// studentProtect + batchAccess + requireFeature("aiAssist") +
// requireFeature("interview").

router.get("/settings", getInterviewSettings);
router.post("/start", aiLimiter, startSession);
router.post("/unlock", unlockPack);
router.post("/speak", aiLimiter, speak);
router.get("/sessions", listSessions);
router.get("/sessions/:id", getSession);
router.delete("/sessions/:id", deleteSession);
router.post("/sessions/:id/turn", aiLimiter, takeTurn);
router.post("/sessions/:id/end", endSession);

module.exports = router;
