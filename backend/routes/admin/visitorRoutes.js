const express = require("express");
const router = express.Router();
const c = require("../../controllers/admin/visitorController");
const { protect, allow } = require("../../middleware/adminAuth");

// Visitors: owner and admin only.
router.use(protect, allow("owner", "admin"));

router.get("/", c.getVisitors);
router.post("/location", c.setLocation);

module.exports = router;
