const asyncHandler = require("express-async-handler");
const Invite = require("../../models/inviteModel");
const User = require("../../models/userModel");
const { generateToken } = require("../../utils/generateToken");
const { generateUniqueIdentifier } = require("../../utils/generateOtp");

// The link points at the admin panel, which is served at /admin on a
// single-origin install. CLIENT_URL_ADMIN only exists for split-origin setups.
const inviteUrl = (token) => {
  const base = process.env.CLIENT_URL_ADMIN || "/admin";
  return `${base.replace(/\/$/, "")}/accept-invite?token=${token}`;
};

// "owner" is deliberately not invitable — there is exactly one, set up
// once, and it can't be created or reassigned through this flow.
const INVITABLE_ROLES = ["admin", "teacher", "doubtSolver", "representative"];

//@desc   Invite a teacher or admin
//@route  POST /api/invites
//@access Private, admin
const createInvite = asyncHandler(async (req, res) => {
  const { name, email, role } = req.body;

  if (!name || !email) {
    res.status(400);
    throw new Error("A name and email are required.");
  }

  const normalised = String(email).toLowerCase().trim();

  const exists = await User.findOne({ email: normalised });
  if (exists) {
    res.status(409);
    throw new Error("Someone already has an account with that email.");
  }

  // Re-inviting replaces the old link rather than leaving two valid tokens.
  await Invite.deleteMany({ email: normalised, acceptedAt: { $exists: false } });

  const { invite, token } = await Invite.issue({
    email: normalised,
    name,
    role: INVITABLE_ROLES.includes(role) ? role : "teacher",
    invitedBy: req.user._id,
  });

  // TODO: hand to the sms/email adapter once it exists. Until then the admin
  // copies the link, which is also the fallback whenever email is unconfigured.
  const url = inviteUrl(token);

  res.status(201).json({
    _id: invite._id,
    name: invite.name,
    email: invite.email,
    role: invite.role,
    expiresAt: invite.expiresAt,
    // returned once, at creation, and never retrievable again
    inviteUrl: url,
  });
});

//@desc   List pending invites
//@route  GET /api/invites
//@access Private, admin
const getInvites = asyncHandler(async (req, res) => {
  const invites = await Invite.find({ acceptedAt: { $exists: false } })
    .populate("invitedBy", "name")
    .sort({ createdAt: -1 });

  res.status(200).json(
    invites.map((i) => ({
      _id: i._id,
      name: i.name,
      email: i.email,
      role: i.role,
      invitedBy: i.invitedBy ? i.invitedBy.name : null,
      expiresAt: i.expiresAt,
      isExpired: i.expiresAt < new Date(),
      createdAt: i.createdAt,
    }))
  );
});

//@desc   Issue a fresh link for a pending invite
//@route  POST /api/invites/:id/resend
//@access Private, admin
const resendInvite = asyncHandler(async (req, res) => {
  const existing = await Invite.findById(req.params.id);

  if (!existing || existing.acceptedAt) {
    res.status(404);
    throw new Error("Invite not found.");
  }

  // A new token is issued rather than the old one reused, because the old one
  // was never stored in a recoverable form.
  await existing.deleteOne();

  const { invite, token } = await Invite.issue({
    email: existing.email,
    name: existing.name,
    role: existing.role,
    invitedBy: req.user._id,
  });

  res.status(200).json({
    _id: invite._id,
    email: invite.email,
    expiresAt: invite.expiresAt,
    inviteUrl: inviteUrl(token),
  });
});

//@desc   Revoke a pending invite
//@route  DELETE /api/invites/:id
//@access Private, admin
const revokeInvite = asyncHandler(async (req, res) => {
  const invite = await Invite.findById(req.params.id);

  if (!invite) {
    res.status(404);
    throw new Error("Invite not found.");
  }

  await invite.deleteOne();
  res.status(200).json({ message: "Invite revoked." });
});

//@desc   Look up an invite by token so the accept screen can show who it is for
//@route  GET /api/invites/verify?token=...
//@access Public
const verifyInvite = asyncHandler(async (req, res) => {
  const { token } = req.query;

  if (!token) {
    res.status(400);
    throw new Error("This link is missing its token.");
  }

  const invite = await Invite.findOne({
    tokenHash: Invite.hashToken(token),
    acceptedAt: { $exists: false },
    expiresAt: { $gt: new Date() },
  });

  if (!invite) {
    res.status(404);
    throw new Error("This invite link is invalid or has expired.");
  }

  // Name and email only. The token holder already knows both.
  res.status(200).json({
    name: invite.name,
    email: invite.email,
    role: invite.role,
  });
});

//@desc   Accept an invite and set a password
//@route  POST /api/invites/accept
//@access Public, token-bearing
const acceptInvite = asyncHandler(async (req, res) => {
  const { token, password } = req.body;

  if (!token || !password) {
    res.status(400);
    throw new Error("A token and password are required.");
  }

  const invite = await Invite.findOne({
    tokenHash: Invite.hashToken(token),
    acceptedAt: { $exists: false },
    expiresAt: { $gt: new Date() },
  });

  if (!invite) {
    res.status(404);
    throw new Error("This invite link is invalid or has expired.");
  }

  // Guards the window between the invite being issued and accepted.
  const exists = await User.findOne({ email: invite.email });
  if (exists) {
    await invite.deleteOne();
    res.status(409);
    throw new Error("An account with that email already exists. Try signing in.");
  }

  // Role comes from the invite, never from the request body.
  const user = await User.create({
    name: invite.name,
    email: invite.email,
    password,
    role: invite.role,
    sessionId: generateUniqueIdentifier(),
  });

  invite.acceptedAt = new Date();
  await invite.save();

  generateToken(res, {
    id: user._id,
    sessionId: user.sessionId,
    role: user.role,
    audience: "user",
  });

  res.status(201).json({
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
  });
});

module.exports = {
  createInvite,
  getInvites,
  resendInvite,
  revokeInvite,
  verifyInvite,
  acceptInvite,
};
