const express = require("express");
const router = express.Router({ mergeParams: true });

const {
  getSetupState,
  createOwner,
  login,
  logout,
  getMe,
  changeOwnPassword,
} = require("../../controllers/admin/authController");

const { protect } = require("../../middleware/adminAuth");
const self = require("../../controllers/admin/staffSelfController");
const { uploadImage } = require("../../middleware/upload");
const { authLimiter } = require("../../middleware/rateLimit");

router
  .get("/setup-state", getSetupState)
  .post("/setup", authLimiter, createOwner)
  .post("/login", authLimiter, login)
  .post("/logout", protect, logout)
  .get("/me", protect, getMe)
  .put("/password", protect, authLimiter, changeOwnPassword)
  // My profile, settings and home (controllers/admin/staffSelfController.js).
  .get("/self", protect, self.getSelf)
  .put("/self", protect, self.updateSelf)
  .post("/self/photo", protect, uploadImage, self.uploadPhoto)
  .get("/self/home", protect, self.home);

module.exports = router;
