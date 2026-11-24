const express = require("express");
const router = express.Router();

const {
  getBatchPlans,
  previewCoupon,
  startCheckout,
  verifyCheckout,
  getMyPurchases,
  getPurchase,
  getAiCreditPlans,
  getGeneralAiCreditPlans,
  previewAiCreditCoupon,
  startAiCreditCheckout,
} = require("../../controllers/app/purchaseController");

const { studentProtect } = require("../../middleware/studentAuth");

// The webhook route is mounted separately, directly in app.js, ahead of the
// json() body parser it cannot use — see the comment there.

const { salesOpen } = require("../../middleware/salesOpen");

router.use(studentProtect);

router.get("/", getMyPurchases);
router.get("/batches/:batchId/plans", salesOpen, getBatchPlans);
router.get("/batches/:batchId/coupon-preview", salesOpen, previewCoupon);
router.post("/checkout", salesOpen, startCheckout);
router.get("/verify/:sessionId", verifyCheckout);

router.get("/batches/:batchId/ai-credit-plans", salesOpen, getAiCreditPlans);
router.get("/ai-credit-plans", salesOpen, getGeneralAiCreditPlans);
router.get("/ai-credits/coupon-preview", salesOpen, previewAiCreditCoupon);
router.post("/ai-credits/checkout", salesOpen, startAiCreditCheckout);

router.get("/referrals", require("../../controllers/app/referralController").getMyReferrals);

// Single-segment wildcard — must stay last among the GET routes above, or
// it greedily matches a literal path like /ai-credit-plans as if "id" were
// "ai-credit-plans".
router.get("/:id", getPurchase);

module.exports = router;
