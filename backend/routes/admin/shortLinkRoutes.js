const express = require("express");
const router = express.Router();

const { createShortLink, getShortLinksForCoupon } = require("../../controllers/admin/shortLinkController");
const { protect, allow } = require("../../middleware/adminAuth");

router.use(protect, allow("owner", "admin", "representative"));

router.get("/", getShortLinksForCoupon);
router.post("/", createShortLink);

module.exports = router;
