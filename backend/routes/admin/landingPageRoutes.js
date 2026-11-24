const express = require("express");
const router = express.Router();

const { getLandingPage, updateSections } = require("../../controllers/admin/landingPageController");
const { protect, allow } = require("../../middleware/adminAuth");

// Owner/admin only, deliberately not the looser "any staff" default — the
// customHtml section type renders raw markup directly on the public
// landing page (see publicController.js's getPublicLandingPage and
// student-app's CustomHtmlSection), unfiltered by design. A compromised
// account with access here is a compromised public page, not just a
// compromised admin panel — narrower access than usual is the point.
router.use(protect, allow("owner", "admin"));

router.get("/", getLandingPage);
router.put("/", updateSections);

module.exports = router;
