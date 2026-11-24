const express = require("express");
const router = express.Router();

const {
  getMyPerformance, listRepresentatives, getPerformanceFor, getAllPerformance,
} = require("../../controllers/admin/representativeController");
const { protect, allow } = require("../../middleware/adminAuth");

router.use(protect);

// A representative's own view. Restricted to that role specifically —
// not just "authenticated" — so an owner or admin browsing this URL by
// hand gets a clear 403 rather than a confusing empty page (they have no
// coupons of their own, since representative and owner/admin are mutually
// exclusive roles).
router.get("/me/coupons", allow("representative"), getMyPerformance);

// Everything below is owner/admin oversight of representatives generally —
// deliberately behind the same tighter pairing coupons themselves use, not
// the looser "any staff" default.
router.get("/", allow("owner", "admin"), listRepresentatives);
// Declared before /:id/coupons — otherwise "summary" would be read as an
// :id value and 404 against a representative that doesn't exist.
router.get("/summary", allow("owner", "admin"), getAllPerformance);
router.get("/:id/coupons", allow("owner", "admin"), getPerformanceFor);

module.exports = router;
