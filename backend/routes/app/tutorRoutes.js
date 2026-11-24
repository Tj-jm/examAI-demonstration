const express = require("express");
const router = express.Router({ mergeParams: true });
const { getToday, updateTutor } = require("../../controllers/app/tutorController");

// Mounted under /api/app/batches/:batchId/tutor behind studentProtect +
// batchAccess + requireFeature("agentTutor") (batchRoutes.js).
router.route("/").get(getToday).put(updateTutor);

module.exports = router;
