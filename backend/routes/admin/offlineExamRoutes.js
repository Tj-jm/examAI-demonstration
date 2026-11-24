const express = require("express");
const router = express.Router();
const c = require("../../controllers/admin/offlineExamController");
const { protect, allow } = require("../../middleware/adminAuth");

// Offline exam marks. Mounted at /api/grading/offline-exams (under
// /api/grading so teacher accounts reach it); teachers on their own batches.
router.use(protect, allow("owner", "admin", "teacher"));

router.get("/:batchId", c.listOffline);
router.post("/:batchId", express.json({ limit: "2mb" }), c.createOffline);
router.get("/:batchId/:examId", c.getOffline);
router.put("/:batchId/:examId", express.json({ limit: "2mb" }), c.updateOffline);
router.delete("/:batchId/:examId", c.deleteOffline);

module.exports = router;
