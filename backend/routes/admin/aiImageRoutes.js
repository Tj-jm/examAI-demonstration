const express = require("express");
const router = express.Router();

const { picture, diagram } = require("../../controllers/admin/aiImageController");
const { protect } = require("../../middleware/adminAuth");
const { aiLimiter } = require("../../middleware/rateLimit");

router.use(protect, require("../../middleware/adminAuth").featureOff("ai", { writesOnly: true }));
router.post("/picture", aiLimiter, picture);
router.post("/diagram", aiLimiter, diagram);

module.exports = router;
