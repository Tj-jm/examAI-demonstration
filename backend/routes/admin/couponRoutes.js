const express = require("express");
const router = express.Router();

const {
  getCoupons, getCoupon, createCoupon, updateCoupon, deleteCoupon,
} = require("../../controllers/admin/couponController");
const { protect, allow } = require("../../middleware/adminAuth");

// Owner and admin only — coupons touch pricing and discounts, and
// attaching one to a representative is a commercial arrangement, not
// day-to-day content. Same tier as earnings, not the looser "any staff"
// default most content routes use.
router.use(protect, allow("owner", "admin"));

router.route("/").get(getCoupons).post(createCoupon);
router.route("/:id").get(getCoupon).put(updateCoupon).delete(deleteCoupon);

module.exports = router;
