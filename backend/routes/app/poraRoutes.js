const express = require("express");
const router = express.Router({ mergeParams: true });

const { deleteSession, getPoraSettings, startSession, takeTurn, endSession, listSessions, getSession, unlockPack, speak } = require("../../controllers/app/poraController");
const { aiLimiter } = require("../../middleware/rateLimit");

// Mounted under /api/app/batches/:batchId/pora by batchRoutes, behind
// studentProtect + batchAccess + requireFeature("aiAssist") +
// requireFeature("poraDhora").

router.get("/settings", getPoraSettings);
router.post("/start", aiLimiter, startSession);
router.post("/unlock", unlockPack);
router.post("/speak", aiLimiter, speak);
router.get("/sessions", listSessions);
router.get("/sessions/:id", getSession);
router.delete("/sessions/:id", deleteSession);
router.post("/sessions/:id/turn", aiLimiter, takeTurn);
router.post("/sessions/:id/end", endSession);

module.exports = router;
