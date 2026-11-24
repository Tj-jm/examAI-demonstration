const express = require("express");
const router = express.Router();
const { protect, allow } = require("../../middleware/adminAuth");
const c = require("../../controllers/admin/gradebookController");

// Mounted at /api/grading/gradebook (under /api/grading so teacher accounts
// reach it through the role gate). Graders are refused in the controller.
router.use(protect, allow("owner", "admin", "teacher"));

router.get("/:batchId", c.getGradebook);
router.put("/:batchId/settings", c.updateSettings);
router.put("/:batchId/remarks/:studentId", c.saveRemark);

module.exports = router;
