const jwt = require("jsonwebtoken");
const asyncHandler = require("express-async-handler");
const Student = require("../models/studentModel");
const { readToken, clearToken } = require("../utils/generateToken");
const { suspensionMessage } = require("../utils/conduct");

// 440 is used for "session ended, log in again" so the client interceptor can
// distinguish it from a 401 on a route the student simply cannot reach.

//@desc Verify a student session
const studentProtect = asyncHandler(async (req, res, next) => {
  const token = readToken(req, "student");

  if (!token) {
    res.status(401);
    throw new Error("Not authorised. No session found.");
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    clearToken(res, "student");
    res.status(440);
    throw new Error(
      error.name === "TokenExpiredError"
        ? "Your session expired. Log in again."
        : "Your session is invalid. Log in again."
    );
  }

  // The original had this check commented out, which meant a token issued to
  // one audience would satisfy the other.
  if (decoded.aud !== "student") {
    res.status(403);
    throw new Error("This endpoint is for student accounts.");
  }

  const student = await Student.findById(decoded.id);

  if (!student || !student.isActive) {
    clearToken(res, "student");
    res.status(440);
    throw new Error("Your session is no longer valid. Log in again.");
  }

  // Suspended by staff (admin → Conduct) for a while.
  const suspended = suspensionMessage(student);
  if (suspended) {
    clearToken(res, "student");
    res.status(440);
    throw new Error(suspended);
  }

  // single active session — a new login elsewhere invalidates this one
  if (!student.validateSession(decoded.sessionId)) {
    clearToken(res, "student");
    res.status(440);
    throw new Error("You were signed in on another device.");
  }

  req.student = student;
  // At most one write an hour; straight to the collection, so it doesn't
  // drop cached reads like a real profile change.
  const now = Date.now();
  if (!student.lastSeenAt || now - student.lastSeenAt.getTime() > 3600000) {
    Student.collection.updateOne({ _id: student._id }, { $set: { lastSeenAt: new Date(now) } }).catch(() => {});
  }
  return next();
});

studentProtect.isAuthGuard = true;

module.exports = { studentProtect };
