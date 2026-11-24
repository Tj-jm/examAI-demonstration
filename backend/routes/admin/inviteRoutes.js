const express = require("express");
const router = express.Router({ mergeParams: true });

const {
  createInvite,
  getInvites,
  resendInvite,
  revokeInvite,
  verifyInvite,
  acceptInvite,
} = require("../../controllers/admin/inviteController");

const { protect, allow } = require("../../middleware/adminAuth");
const { authLimiter } = require("../../middleware/rateLimit");

// Public, token-bearing. Rate limited because the token is the only secret
// standing between a caller and a staff account.
router
  .get("/verify", authLimiter, verifyInvite)
  .post("/accept", authLimiter, acceptInvite);

// Everything below requires an admin session.
router.use(protect, allow("owner", "admin"));

router
  .route("/")
  .get(getInvites)
  .post(createInvite);

router.post("/:id/resend", resendInvite);
router.delete("/:id", revokeInvite);

module.exports = router;
