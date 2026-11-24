const express = require("express");
const router = express.Router();

const {
  listPayslips, listPeople, previewPayslip, createPayslip, updatePayslip, issuePayslip, payPayslip, deletePayslip, uploadProof,
  myPayslips, getPayslip, confirmPayslip, disputePayslip, getClassPay, myClassPay, setClassRate,
} = require("../../controllers/admin/payslipController");
const { protect, allow } = require("../../middleware/adminAuth");
const { uploadImage } = require("../../middleware/upload");

router.use(protect);

const admin = allow("owner", "admin");

// Any team member: their own payslips. Declared before /:id.
router.get("/mine", myPayslips);
router.get("/class-pay/mine", myClassPay);

// Class pay (utils/classPay.js): rates and what each teacher's classes earned.
router.get("/class-pay", admin, getClassPay);
router.put("/class-pay/rates/:userId", admin, setClassRate);

router.get("/", admin, listPayslips);
router.get("/people", admin, listPeople);
router.get("/preview", admin, previewPayslip);
router.post("/upload-proof", admin, uploadImage, uploadProof);
router.post("/", admin, createPayslip);

// The controller checks a member only reaches their own.
router.get("/:id", getPayslip);
router.post("/:id/confirm", confirmPayslip);
router.post("/:id/dispute", disputePayslip);

router.put("/:id", admin, updatePayslip);
router.post("/:id/issue", admin, issuePayslip);
router.post("/:id/pay", admin, payPayslip);
router.delete("/:id", admin, deletePayslip);

module.exports = router;
