const express = require("express");
const router = express.Router();

const { getBadges, markSeen } = require("../../controllers/admin/badgeController");
const { protect } = require("../../middleware/adminAuth");

router.use(protect);

router.get("/", getBadges);
router.post("/seen", markSeen);

module.exports = router;
