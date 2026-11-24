const jwt = require("jsonwebtoken");
const asyncHandler = require("express-async-handler");
const User = require("../models/userModel");
const { COOKIE_NAMES, clearToken } = require("../utils/generateToken");

// The original wrote lastActive to Mongo on every authenticated request. With
// polling for AI job status that becomes a write per poll, so this throttles
// to once every five minutes and never blocks the request on it.
const ACTIVITY_WRITE_INTERVAL_MS = 5 * 60 * 1000;

//@desc Verify an admin/teacher session
const protect = asyncHandler(async (req, res, next) => {
  const token = req.cookies[COOKIE_NAMES.user];

  if (!token) {
    res.status(401);
    throw new Error("Not authorised. No session found.");
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    clearToken(res, "user");
    res.status(401);
    throw new Error(
      error.name === "TokenExpiredError"
        ? "Your session expired. Log in again."
        : "Your session is invalid. Log in again."
    );
  }

  if (decoded.aud !== "user") {
    res.status(403);
    throw new Error("This endpoint is for staff accounts.");
  }

  const user = await User.findOne({
    _id: decoded.id,
    sessionId: decoded.sessionId,
  });

  if (!user || !user.isActive) {
    clearToken(res, "user");
    res.status(401);
    throw new Error("Your session is no longer valid. Log in again.");
  }

  req.user = user;

  const last = user.lastActiveAt ? user.lastActiveAt.getTime() : 0;
  if (Date.now() - last > ACTIVITY_WRITE_INTERVAL_MS) {
    const day = new Date().toISOString().slice(0, 10);
    const stamp = (user.activeDays || []).includes(day) ? {} : { $push: { activeDays: { $each: [day], $slice: -60 } } };
    User.updateOne({ _id: user._id }, { lastActiveAt: new Date(), ...stamp }).catch(() => {});
  }

  return next();
});

//@desc Restrict a route to specific roles
// usage: router.delete("/:id", protect, allow("owner", "admin"), deleteUser)
const allow = (...roles) => {
  const guard = asyncHandler(async (req, res, next) => {
    if (!req.user) {
      res.status(401);
      throw new Error("Not authorised.");
    }

    if (!roles.includes(req.user.role)) {
      res.status(403);
      throw new Error("You do not have permission to do that.");
    }

    return next();
  });

  guard.isRoleGuard = true;
  guard.roles = roles;
  return guard;
};

// Tagged so tests/routeAudit.js can prove every route is guarded. Handler
// names are useless for this: express-async-handler renames everything it
// wraps to 'asyncUtilWrap'.
protect.isAuthGuard = true;

// A feature an admin turned off for this person (Team → duty.off):
// "ai", "claimScripts", "doubts". writesOnly lets them still
// read (lists, queues) and stops only the doing.
const featureOff = (key, { writesOnly = false } = {}) => (req, res, next) => {
  if (writesOnly && req.method === "GET") return next();
  if (req.user && !["owner", "admin"].includes(req.user.role) && (req.user.duty?.off || []).includes(key)) {
    res.status(403);
    return next(new Error("An admin has turned this off for your account."));
  }
  return next();
};

module.exports = { protect, allow, featureOff };
