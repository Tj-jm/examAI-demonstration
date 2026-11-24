const asyncHandler = require("express-async-handler");
const User = require("../../models/userModel");
const { generateToken, clearToken } = require("../../utils/generateToken");
const { generateUniqueIdentifier } = require("../../utils/generateOtp");

const LOGIN_MAX_ATTEMPTS = 6;
const LOGIN_LOCK_MINUTES = 15;

//@desc   Whether the install still needs its first account
//@route  GET /api/auth/setup-state
//@access Public
const getSetupState = asyncHandler(async (req, res) => {
  const count = await User.estimatedDocumentCount();
  res.status(200).json({ needsSetup: count === 0 });
});

//@desc   Create the owner account. Only works while no users exist.
//@route  POST /api/auth/setup
//@access Public, self-closing
const createOwner = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;

  // Public registration does not exist. This endpoint stops responding the
  // moment an account is created, so there is no window to escalate through.
  const count = await User.estimatedDocumentCount();
  if (count > 0) {
    res.status(403);
    throw new Error("This install is already set up.");
  }

  if (!name || !email || !password) {
    res.status(400);
    throw new Error("Name, email and password are required.");
  }

  const user = await User.create({
    name,
    email,
    password,
    role: "owner",
    sessionId: generateUniqueIdentifier(),
  });

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

//@desc   Log in
//@route  POST /api/auth/login
//@access Public
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400);
    throw new Error("Email and password are required.");
  }

  const user = await User.findOne({ email: String(email).toLowerCase() }).select(
    "+password"
  );

  // One message for both branches so the response cannot be used to work out
  // which addresses have accounts.
  if (!user || !user.isActive) {
    res.status(401);
    throw new Error("Those credentials did not match.");
  }

  if (user.isLocked()) {
    res.status(429);
    throw new Error("Too many attempts. Try again in a few minutes.");
  }

  const ok = await user.matchPassword(password);

  if (!ok) {
    user.loginAttempts += 1;
    if (user.loginAttempts >= LOGIN_MAX_ATTEMPTS) {
      user.lockedUntil = Date.now() + LOGIN_LOCK_MINUTES * 60 * 1000;
    }
    await user.save();
    res.status(401);
    throw new Error("Those credentials did not match.");
  }

  // Rotating sessionId is what enforces one active session per account.
  user.loginAttempts = 0;
  user.lockedUntil = undefined;
  user.sessionId = generateUniqueIdentifier();
  user.lastActiveAt = new Date();
  user.logins = [...(user.logins || []), { at: new Date(), ip: String(req.ip || "").slice(0, 60), agent: String(req.get("user-agent") || "").slice(0, 200) }].slice(-10);
  await user.save();

  generateToken(res, {
    id: user._id,
    sessionId: user.sessionId,
    role: user.role,
    audience: "user",
  });

  res.status(200).json({
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  });
});

//@desc   Log out
//@route  POST /api/auth/logout
//@access Private
const logout = asyncHandler(async (req, res) => {
  await User.updateOne(
    { _id: req.user._id },
    { sessionId: generateUniqueIdentifier() }
  );

  clearToken(res, "user");
  res.status(200).json({ message: "Signed out." });
});

//@desc   Current session
//@route  GET /api/auth/me
//@access Private
const getMe = asyncHandler(async (req, res) => {
  res.status(200).json({
    _id: req.user._id,
    name: req.user.name,
    email: req.user.email,
    role: req.user.role,
    mustChangePassword: req.user.mustChangePassword,
    prefs: req.user.prefs,
    off: req.user.duty?.off || [],
    away: req.user.away?.until && req.user.away.until > new Date() ? req.user.away : null,
  });
});

//@desc   Change your own password
//@route  PUT /api/auth/password
//@access Private
const changeOwnPassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    res.status(400);
    throw new Error("Current and new password are required.");
  }

  // The target is always the session holder. Nothing is read from the body
  // that could point this at another account.
  const user = await User.findById(req.user._id).select("+password");

  if (!(await user.matchPassword(currentPassword))) {
    res.status(401);
    throw new Error("Your current password is incorrect.");
  }

  user.password = newPassword;
  user.mustChangePassword = false;
  user.sessionId = generateUniqueIdentifier();
  await user.save();

  // Changing a password ends every session, including this one.
  clearToken(res, "user");
  res.status(200).json({ message: "Password changed. Sign in again." });
});

module.exports = {
  getSetupState,
  createOwner,
  login,
  logout,
  getMe,
  changeOwnPassword,
};
