const express = require("express");
const router = express.Router();

const {
  register,
  verifyOtp,
  completeProfile,
  login,
  logout,
  me,
  forgotPassword,
  verifyResetOtp,
  resetPassword,
  requestLoginOtp,
  loginWithOtp,
} = require("../../controllers/app/authController");

const { studentProtect } = require("../../middleware/studentAuth");
const { authLimiter, otpLimiter } = require("../../middleware/rateLimit");

router.post("/register", otpLimiter, register);
router.post("/verify-otp", authLimiter, verifyOtp);
router.post("/complete-profile", authLimiter, completeProfile);
router.post("/login", authLimiter, login);

// Both send a message — same cost-abuse surface as register, same limiter.
router.post("/forgot-password", otpLimiter, forgotPassword);
router.post("/verify-reset-otp", authLimiter, verifyResetOtp);
router.post("/reset-password", authLimiter, resetPassword);

router.post("/login-otp/request", otpLimiter, requestLoginOtp);
router.post("/login-otp/verify", authLimiter, loginWithOtp);

router.post("/logout", studentProtect, logout);
router.get("/me", studentProtect, me);
router.put("/profile", studentProtect, require("../../controllers/app/authController").updateProfile);

module.exports = router;
