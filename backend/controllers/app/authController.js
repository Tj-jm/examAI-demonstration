const asyncHandler = require("express-async-handler");
const { suspensionMessage } = require("../../utils/conduct");
const { parsePhoneNumberFromString } = require("libphonenumber-js");
const Student = require("../../models/studentModel");
const AppSettings = require("../../models/appSettingsModel");
const { generateOtp, generateUniqueIdentifier } = require("../../utils/generateOtp");
const { generateToken, clearToken, withSessionToken } = require("../../utils/generateToken");
const email = require("../../adapters/email");
const sms = require("../../adapters/sms");
const phoneCountries = require("../../utils/phoneCountries");

// Registration is three steps — request a code, verify it, set a name and
// password — because a student typing a wrong number should not be able to
// claim someone else's inbox, and a verified-but-abandoned signup should not
// block that identifier forever (studentModel expires those after 7 days).

const LOGIN_MAX_ATTEMPTS = 6;
const LOGIN_LOCK_MINUTES = 15;
const OTP_MAX_ATTEMPTS = 5;

// Echoing the live OTP back in the response body is only ever meant for
// local development with no SMS/email provider configured. Gating it on
// NODE_ENV !== "production" alone is not safe: NODE_ENV defaults to unset
// (falsy, so "not production") on a server nobody bothered to configure,
// which is exactly the kind of accidental deployment this needs to fail
// closed on. DEV_OTP_ECHO must be turned on deliberately.
const isDevOtpEchoEnabled = () => process.env.DEV_OTP_ECHO === "true" && process.env.NODE_ENV !== "production";

// Normalises the request body to one of {email} or {phoneNumber}, validated
// and checked against what the institution currently offers — the same
// two-layer check (offered vs. actually deliverable) settingsController uses
// when an admin changes this setting, applied here on the way in too, since
// the setting can change between when a student loads the form and submits it.
const resolveIdentifier = async (body) => {
  const settings = await AppSettings.get();
  const offered = settings.studentAuth.identifier;

  if (body.email) {
    if (offered === "phone") {
      const error = new Error("This institution signs up students by phone number.");
      error.statusCode = 400;
      throw error;
    }
    const value = String(body.email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      const error = new Error("That does not look like a valid email address.");
      error.statusCode = 400;
      throw error;
    }
    if (!email.configured()) {
      const error = new Error("Email sign-up is not available right now.");
      error.statusCode = 503;
      throw error;
    }
    return { field: "email", value };
  }

  if (body.phoneNumber) {
    if (offered === "email") {
      const error = new Error("This institution signs up students by email.");
      error.statusCode = 400;
      throw error;
    }
    // The number as typed after the country picked beside it (a leading
    // 0 is fine), or a full international number starting with +.
    const raw = String(body.phoneNumber).trim();
    const allowed = phoneCountries.offered(settings.studentAuth);
    const country = phoneCountries.valid([body.phoneCountry])[0] || allowed[0].code;
    const parsed = parsePhoneNumberFromString(raw, raw.startsWith("+") ? undefined : country);
    if (!parsed || !parsed.isValid()) {
      const error = new Error("That does not look like a valid phone number.");
      error.statusCode = 400;
      throw error;
    }
    if (!allowed.some((c) => c.dial === parsed.countryCallingCode)) {
      const error = new Error("Phone numbers from that country aren't accepted here.");
      error.statusCode = 400;
      throw error;
    }
    if (!sms.configured()) {
      const error = new Error("Phone sign-up is not available right now.");
      error.statusCode = 503;
      throw error;
    }
    return { field: "phoneNumber", value: parsed.number };
  }

  const error = new Error("Send an email address or a phone number.");
  error.statusCode = 400;
  throw error;
};

const PURPOSE_COPY = {
  register: { subject: "Your verification code", label: "verification" },
  reset: { subject: "Your password reset code", label: "password reset" },
  login: { subject: "Your login code", label: "login" },
};

const sendOtp = async (field, value, otp, purpose = "register", optIn) => {
  const { subject, label } = PURPOSE_COPY[purpose] || PURPOSE_COPY.register;
  const message = `${subject.replace("Your ", "Your ExamAI ")} is ${otp}. It expires in 5 minutes.`;
  if (field === "email") {
    const settings = await require("../../models/appSettingsModel").get();
    await email.send(value, subject, message, require("../../utils/emailLayout").render(settings, {
      title: subject, text: `Enter this ${label} code in the app. It works for 5 minutes.`, code: String(otp).replace(/^(\d{3})(\d{3})$/, "$1 $2"),
      note: "Didn't ask for it? You can ignore this email.", preheader: `${subject}: ${otp}`,
    }));
  } else {
    await sms.send(value, message, { code: otp, optIn });
  }
};

//@desc   Start (or resume) registration — sends an otp to the given identifier
//@route  POST /api/app/auth/register
//@access Public
const register = asyncHandler(async (req, res) => {
  const { field, value } = await resolveIdentifier(req.body);

  let student = await Student.findOne({ [field]: value });

  if (student && student.isProfileComplete) {
    res.status(409);
    throw new Error("An account already exists for that. Log in instead.");
  }

  if (!student) {
    student = new Student({ [field]: value });
  } else {
    // Reused doc from an earlier, unfinished signup — the 7-day sweep TTL
    // is keyed off expiresAt, which was only ever set once at that first
    // attempt. Without this, retrying on day 6 still gets swept on day 7
    // (measured from the abandoned attempt, not the retry).
    student.expiresAt = new Date();
  }

  if (field === "phoneNumber" && sms.whatsappCodes()) {
    student.whatsappOptIn = req.body.whatsapp === true;
    if (!student.whatsappOptIn && !sms.smsReady()) {
      res.status(400);
      throw new Error("Codes are sent on WhatsApp here. Tick the WhatsApp box to get yours.");
    }
  }

  const otp = generateOtp();
  await student.setOtp(otp);
  await student.save();

  let sendError = null;
  try {
    await sendOtp(field, value, otp, "register", student.whatsappOptIn);
  } catch (error) {
    // In production this is fatal — a student with no working way to
    // receive the code cannot register. Outside production, the code is
    // already generated and saved above regardless of whether it went
    // anywhere, so the failure is surfaced as a warning alongside the code
    // itself rather than blocking the whole flow — a broken SMTP config
    // during development shouldn't mean nobody can test signup at all.
    if (process.env.NODE_ENV === "production") {
      res.status(502);
      throw new Error(`Could not send the verification code: ${error.message}`);
    }
    sendError = error.message;
  }

  res.status(200).json({
    message: `A verification code was sent to your ${field === "email" ? "email" : "phone"}.`,
    field,
    ...(sendError ? { devSendError: sendError } : {}),
    // Requires an explicit opt-in on top of non-production — lets the whole
    // signup flow be tested with no SMS/email provider configured at all,
    // without every non-production deployment (which, absent NODE_ENV being
    // set at all, is the default) echoing live OTPs to any caller.
    ...(isDevOtpEchoEnabled() ? { devOtp: otp } : {}),
  });
});

//@desc   Verify the code sent by register
//@route  POST /api/app/auth/verify-otp
//@access Public
const verifyOtp = asyncHandler(async (req, res) => {
  const { field, value } = await resolveIdentifier(req.body);
  const { otp } = req.body;

  const student = await Student.findOne({ [field]: value }).select("+otpHash");

  if (!student) {
    res.status(404);
    throw new Error("No signup in progress for that. Request a code first.");
  }

  if (student.otpLockedUntil && student.otpLockedUntil > Date.now()) {
    res.status(429);
    throw new Error("Too many wrong codes. Request a new one in a few minutes.");
  }

  const ok = await student.verifyOtp(otp);

  if (!ok) {
    student.otpAttempts += 1;
    if (student.otpAttempts >= OTP_MAX_ATTEMPTS) {
      student.otpLockedUntil = Date.now() + 15 * 60 * 1000;
    }
    await student.save();
    res.status(400);
    throw new Error("That code is wrong or has expired.");
  }

  student.isOtpVerified = true;
  student.clearOtp();
  await student.save();

  res.status(200).json({ message: "Verified.", field, alreadyHasProfile: student.isProfileComplete });
});

//@desc   Finish registration with a name and password, after otp verification
//@route  POST /api/app/auth/complete-profile
//@access Public
const completeProfile = asyncHandler(async (req, res) => {
  const { field, value } = await resolveIdentifier(req.body);
  const { name, password } = req.body;

  if (!name || !name.trim()) {
    res.status(400);
    throw new Error("A name is required.");
  }
  if (!password || password.length < 8) {
    res.status(400);
    throw new Error("A password of at least 8 characters is required.");
  }

  const student = await Student.findOne({ [field]: value });

  if (!student) {
    res.status(404);
    throw new Error("No signup in progress for that.");
  }
  if (student.isProfileComplete) {
    res.status(400);
    throw new Error("This account is already set up. Log in instead.");
  }
  if (!student.isOtpVerified) {
    res.status(400);
    throw new Error("Verify your code first.");
  }

  student.name = name.trim();
  student.password = password;
  student.isProfileComplete = true;
  // Otherwise isOtpVerified stays true forever (it's only ever set here and
  // in verifyOtp) and, since an admin-created student is inserted already
  // profile-incomplete with no OTP step at all, an attacker who knows or
  // guesses the identifier could call this endpoint unauthenticated and set
  // their own password on someone else's account.
  student.isOtpVerified = false;
  student.sessionId = generateUniqueIdentifier();
  await student.save();
  // A lead from the interest form who has now signed up (utils/leads.js).
  require("../../utils/leads").markJoined(student).catch(() => {});

  const token = generateToken(res, { id: student._id, sessionId: student.sessionId, role: "student", audience: "student" });

  res.status(201).json(withSessionToken(req, shape(student), token));
});

//@desc   Log in with an identifier and password
//@route  POST /api/app/auth/login
//@access Public
const login = asyncHandler(async (req, res) => {
  const byId = req.body.studentId !== undefined;
  if (byId && (await AppSettings.get()).institution?.studentIdLogin !== true) {
    res.status(400);
    throw new Error("Logging in with a student ID isn't switched on here.");
  }
  const { field, value } = byId
    ? { field: "studentId", value: String(req.body.studentId || "").trim().toUpperCase() }
    : await resolveIdentifier(req.body);
  const { password } = req.body;

  const student = value ? await Student.findOne({ [field]: value }).select("+password") : null;

  // Same message whether the identifier is unknown or the password is wrong
  // — confirming which one it was is a free account-enumeration oracle.
  const reject = () => {
    res.status(401);
    throw new Error(byId ? "Incorrect student ID or password." : "Incorrect email/phone or password.");
  };

  if (!student || !student.isProfileComplete) return reject();

  if (student.isLocked()) {
    res.status(429);
    throw new Error(`Too many attempts. Try again in a few minutes.`);
  }

  const ok = await student.matchPassword(password);

  if (!ok) {
    student.loginAttempts += 1;
    if (student.loginAttempts >= LOGIN_MAX_ATTEMPTS) {
      student.lockedUntil = Date.now() + LOGIN_LOCK_MINUTES * 60 * 1000;
    }
    await student.save();
    return reject();
  }

  if (suspensionMessage(student)) {
    res.status(403);
    throw new Error(suspensionMessage(student));
  }

  student.loginAttempts = 0;
  student.lockedUntil = undefined;
  // A fresh sessionId invalidates any session already open elsewhere —
  // studentAuth.js checks this on every request.
  student.sessionId = generateUniqueIdentifier();
  await student.save();

  const token = generateToken(res, { id: student._id, sessionId: student.sessionId, role: "student", audience: "student" });

  res.status(200).json(withSessionToken(req, shape(student), token));
});

//@desc   Log out
//@route  POST /api/app/auth/logout
//@access Private (student)
const logout = asyncHandler(async (req, res) => {
  req.student.sessionId = undefined;
  await req.student.save();
  clearToken(res, "student");
  res.status(200).json({ message: "Logged out." });
});

//@desc   The signed-in student
//@route  GET /api/app/auth/me
//@access Private (student)
const me = asyncHandler(async (req, res) => {
  res.status(200).json(shape(req.student));
});

const shape = (student) => ({
  _id: student._id,
  name: student.name,
  email: student.email,
  phoneNumber: student.phoneNumber,
  studentId: student.studentId || "",
  isProfileComplete: student.isProfileComplete,
  state: student.state || "",
  billing: { name: student.billing?.name || "", taxId: student.billing?.taxId || "" },
  deletionScheduledFor: student.deletionScheduledFor || null,
});

//@desc   Request a password reset code — always responds the same way
//        whether or not the account exists, so this can't be used to check
//        which emails/numbers have an account here
//@route  POST /api/app/auth/forgot-password
//@access Public
const forgotPassword = asyncHandler(async (req, res) => {
  const { field, value } = await resolveIdentifier(req.body);
  const label = field === "email" ? "email" : "phone number";

  const student = await Student.findOne({ [field]: value, isProfileComplete: true });

  // Same tradeoff as requestLoginOtp above: telling a visitor outright that
  // there's nothing to reset (and pointing them at signup instead) costs
  // nothing — no OTP goes out — and is more useful than a vague hedge, at
  // the price of a small, already rate-limited enumeration surface.
  if (!student) {
    res.status(200).json({ exists: false, message: `No account found for that ${label}.` });
    return;
  }

  const otp = generateOtp();
  await student.setOtp(otp);
  await student.save();

  let sendError = null;
  try {
    await sendOtp(field, value, otp, "reset", student.whatsappOptIn === true);
  } catch (error) {
    // Fatal in production, a dev-only warning otherwise, alongside the code
    // shown regardless.
    if (process.env.NODE_ENV === "production") {
      res.status(502);
      throw new Error(`Could not send the reset code: ${error.message}`);
    }
    sendError = error.message;
  }

  res.status(200).json({
    exists: true,
    message: "A code was sent.",
    ...(sendError ? { devSendError: sendError } : {}),
    ...(isDevOtpEchoEnabled() ? { devOtp: otp } : {}),
  });
});

//@desc   Verify a password reset code
//@route  POST /api/app/auth/verify-reset-otp
//@access Public
const verifyResetOtp = asyncHandler(async (req, res) => {
  const { field, value } = await resolveIdentifier(req.body);
  const { otp } = req.body;

  const student = await Student.findOne({ [field]: value, isProfileComplete: true }).select("+otpHash");

  if (!student) {
    res.status(404);
    throw new Error("No reset in progress for that. Request a code first.");
  }

  if (student.otpLockedUntil && student.otpLockedUntil > Date.now()) {
    res.status(429);
    throw new Error("Too many wrong codes. Request a new one in a few minutes.");
  }

  const ok = await student.verifyOtp(otp);

  if (!ok) {
    student.otpAttempts += 1;
    if (student.otpAttempts >= OTP_MAX_ATTEMPTS) {
      student.otpLockedUntil = Date.now() + 15 * 60 * 1000;
    }
    await student.save();
    res.status(400);
    throw new Error("That code is wrong or has expired.");
  }

  student.markResetVerified();
  await student.save();

  res.status(200).json({ message: "Verified." });
});

//@desc   Set a new password, after verify-reset-otp
//@route  POST /api/app/auth/reset-password
//@access Public
const resetPassword = asyncHandler(async (req, res) => {
  const { field, value } = await resolveIdentifier(req.body);
  const { newPassword } = req.body;

  if (!newPassword || newPassword.length < 8) {
    res.status(400);
    throw new Error("A password of at least 8 characters is required.");
  }

  const student = await Student.findOne({ [field]: value, isProfileComplete: true }).select("+isResetVerified");

  if (!student || !student.isResetVerified) {
    res.status(400);
    throw new Error("Verify a reset code first.");
  }

  student.password = newPassword;
  student.isResetVerified = false;
  // A fresh sessionId here also signs out anywhere else this account is
  // logged in — appropriate after a reset, since the old password (and
  // whatever session relied on it) should not still be trusted.
  student.sessionId = generateUniqueIdentifier();
  await student.save();

  const token = generateToken(res, { id: student._id, sessionId: student.sessionId, role: "student", audience: "student" });

  res.status(200).json(withSessionToken(req, shape(student), token));
});

//@desc   Request a one-time code to log in with, instead of a password
//@route  POST /api/app/auth/login-otp/request
//@access Public
const requestLoginOtp = asyncHandler(async (req, res) => {
  if ((await AppSettings.get()).studentAuth?.codeLogin === false) {
    res.status(400);
    throw new Error("Logging in with a code isn't switched on here. Use your password.");
  }
  const { field, value } = await resolveIdentifier(req.body);
  const label = field === "email" ? "email" : "phone number";

  const student = await Student.findOne({ [field]: value, isProfileComplete: true });

  // Unlike password login (an unlimited-attempts brute-force target, so it
  // must never confirm which accounts exist) and unlike register (which
  // already tells a genuine visitor "you have an account, log in instead"),
  // this step is a good place to point a not-yet-registered visitor at
  // signup rather than hide behind a vague "if an account exists" message —
  // it costs nothing (no OTP is generated or sent below) and it's already
  // rate-limited by otpLimiter, so the enumeration exposure is small next to
  // the conversion this saves.
  if (!student || !student.isActive) {
    res.status(200).json({ exists: false, message: `No account found for that ${label}.` });
    return;
  }

  const otp = generateOtp();
  await student.setOtp(otp);
  await student.save();

  let sendError = null;
  try {
    await sendOtp(field, value, otp, "login", student.whatsappOptIn === true);
  } catch (error) {
    if (process.env.NODE_ENV === "production") {
      res.status(502);
      throw new Error(`Could not send the code: ${error.message}`);
    }
    sendError = error.message;
  }

  res.status(200).json({
    exists: true,
    message: "A code was sent.",
    ...(sendError ? { devSendError: sendError } : {}),
    ...(isDevOtpEchoEnabled() ? { devOtp: otp } : {}),
  });
});

//@desc   Verify a login code and log in
//@route  POST /api/app/auth/login-otp/verify
//@access Public
const loginWithOtp = asyncHandler(async (req, res) => {
  if ((await AppSettings.get()).studentAuth?.codeLogin === false) {
    res.status(400);
    throw new Error("Logging in with a code isn't switched on here. Use your password.");
  }
  const { field, value } = await resolveIdentifier(req.body);
  const { otp } = req.body;

  const student = await Student.findOne({ [field]: value, isProfileComplete: true }).select("+otpHash");

  // Same generic message as a wrong password would give — a code request
  // already confirmed an account might exist, but this step still should
  // not distinguish "no account" from "wrong code" beyond what's necessary.
  const reject = () => {
    res.status(400);
    throw new Error("That code is wrong or has expired.");
  };

  if (!student) return reject();

  if (student.otpLockedUntil && student.otpLockedUntil > Date.now()) {
    res.status(429);
    throw new Error("Too many wrong codes. Request a new one in a few minutes.");
  }

  const ok = await student.verifyOtp(otp);

  if (!ok) {
    student.otpAttempts += 1;
    if (student.otpAttempts >= OTP_MAX_ATTEMPTS) {
      student.otpLockedUntil = Date.now() + 15 * 60 * 1000;
    }
    await student.save();
    return reject();
  }

  if (suspensionMessage(student)) {
    res.status(403);
    throw new Error(suspensionMessage(student));
  }

  student.clearOtp();
  student.loginAttempts = 0;
  student.lockedUntil = undefined;
  student.sessionId = generateUniqueIdentifier();
  await student.save();

  const token = generateToken(res, { id: student._id, sessionId: student.sessionId, role: "student", audience: "student" });

  res.status(200).json(withSessionToken(req, shape(student), token));
});

//@desc   Edit my profile: name, state, billing name and tax number
//@route  PUT /api/app/auth/profile
//@access Private (student)
const updateProfile = asyncHandler(async (req, res) => {
  const student = req.student;
  const { name, state, billing } = req.body || {};
  if (name !== undefined) {
    const clean = String(name).trim();
    if (clean.length < 2 || clean.length > 80) {
      res.status(400);
      throw new Error("Your name needs 2 to 80 characters.");
    }
    student.name = clean;
  }
  if (state !== undefined) student.state = String(state).trim().slice(0, 60);
  if (billing) {
    student.set("billing.name", String(billing.name || "").trim().slice(0, 120));
    student.set("billing.taxId", String(billing.taxId || "").trim().slice(0, 40));
  }
  await student.save();
  res.status(200).json(shape(student));
});

module.exports = {
  updateProfile,
  register, verifyOtp, completeProfile, login, logout, me,
  forgotPassword, verifyResetOtp, resetPassword,
  requestLoginOtp, loginWithOtp,
};
