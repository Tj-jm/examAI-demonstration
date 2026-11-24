const express = require("express");
const router = express.Router();

const { write } = require("../../controllers/admin/aiWritingController");
const { protect } = require("../../middleware/adminAuth");
const { aiLimiter } = require("../../middleware/rateLimit");

// Any staff member who can write the content can ask for a draft of it,
// same as notices and lectures themselves.
router.use(protect, require("../../middleware/adminAuth").featureOff("ai", { writesOnly: true }));
router.post("/", aiLimiter, write);

module.exports = router;
