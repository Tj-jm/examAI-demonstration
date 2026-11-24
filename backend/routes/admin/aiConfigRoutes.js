const express = require("express");
const router = express.Router();

const { getConfig, updateConfig, testConnection } = require("../../controllers/admin/aiConfigController");
const { protect, allow } = require("../../middleware/adminAuth");

// Settings → AI. Mounted at /api/ai beside aiRoutes.js.
router.use(protect);

// Credentials and spending limits are an owner concern, not a teaching one.
router
  .route("/config")
  .get(allow("owner", "admin"), getConfig)
  .put(allow("owner", "admin"), updateConfig);

router.post("/test", allow("owner", "admin"), testConnection);

module.exports = router;
