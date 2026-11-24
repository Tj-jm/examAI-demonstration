const express = require("express");
const router = express.Router();
const { protect, allow } = require("../../middleware/adminAuth");
const c = require("../../controllers/admin/performanceController");

// Settings → Performance. Mounted at /api/performance.
router.use(protect, allow("owner", "admin"));

router.route("/").get(c.getSettings).put(c.updateSettings);
router.get("/status", c.getStatus);
router.get("/live", c.getLive);
router.get("/live/history", c.getLiveHistory);
router.post("/cache/clear", c.clearCache);
router.get("/saved", c.listSaved);
router.post("/saved/:id/approve", c.approveSaved);
router.post("/saved/:id/reject", c.rejectSaved);
router.post("/saved/:id/add-to-bank", c.addSavedToBank);
router.delete("/saved/:id", c.deleteSaved);

module.exports = router;
