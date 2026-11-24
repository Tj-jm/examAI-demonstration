const express = require("express");
const router = express.Router();
const { protect, allow } = require("../../middleware/adminAuth");
const c = require("../../controllers/admin/progressReportController");

// Mounted at /api/grading/progress-reports (teacher accounts reach it
// through the role gate). Teachers manage their own batches'
// schedules; settings, Send now and resend are checked for owner/admin in
// the controller.
router.use(protect, allow("owner", "admin", "teacher"));

router.route("/settings").get(c.getSettings).put(c.updateSettings);
router.get("/batches", c.listBatches);
router.route("/batch/:id").get(c.getBatch).put(c.updateBatch);
router.post("/batch/:id/send-now", c.sendNow);
router.get("/log", c.getLog);
router.post("/log/:id/resend", c.resend);

module.exports = router;
