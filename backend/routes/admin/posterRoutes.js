const express = require("express");
const router = express.Router();
const c = require("../../controllers/admin/posterController");
const { protect, allow } = require("../../middleware/adminAuth");

// Posts and posters for social media: owner and admin only.
router.use(protect, allow("owner", "admin"));

router.get("/options", c.posterOptions);
router.get("/top-scorers", c.getTopScorers);
router.post("/write", c.writePoster);
router.post("/background", c.posterBackground);
router.post("/voice", c.posterVoice);

module.exports = router;
