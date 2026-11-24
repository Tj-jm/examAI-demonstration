const express = require("express");
const router = express.Router({ mergeParams: true });

const {
  getPurchases,
  deletePurchase,
} = require("../../controllers/admin/studentController");

const { protect, allow } = require("../../middleware/adminAuth");

router.use(protect);

router.get("/", getPurchases);
router.delete("/:id", allow("owner", "admin"), deletePurchase);

module.exports = router;
