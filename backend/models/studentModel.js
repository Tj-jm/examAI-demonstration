const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

// Signup identifier is email or phone depending on SMS_PROVIDER. Neither is
// hardcoded to a country, and the old Bangladesh-only phone regex is gone —
// format validation happens in the adapter with libphonenumber.

const studentSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: function () {
        return this.isProfileComplete;
      },
      trim: true,
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      sparse: true,
      unique: true,
    },
    phoneNumber: {
      type: String,
      trim: true,
      sparse: true,
      unique: true,
    },
    // Agreed at sign-up to codes and messages on WhatsApp (asked only when
    // codes can go by WhatsApp; adapters/sms).
    whatsappOptIn: { type: Boolean },
    // For tax invoices (utils/invoice.js): the student's state or province
    // (asked when the GST split is on) and an optional business to bill.
    state: { type: String, trim: true, maxlength: 60 },
    billing: {
      name: { type: String, trim: true, maxlength: 120 },
      taxId: { type: String, trim: true, maxlength: 40 },
    },
    // An institution's own ID (roll or registration number), set by staff
    // or the import. Logs in with a password when Settings → Institution →
    // Student ID login is on. Stored upper-case so "cs-01" finds "CS-01".
    studentId: {
      type: String,
      trim: true,
      uppercase: true,
      sparse: true,
      unique: true,
    },
    // A parent or guardian, for progress reports (utils/progressReports.js).
    // Set by staff, the import, or the student. optOut stops the reports to
    // them without losing the contact.
    guardian: {
      name: { type: String, trim: true, maxlength: 80, default: "" },
      relation: { type: String, trim: true, maxlength: 40, default: "" },
      phone: { type: String, trim: true, maxlength: 20, default: "" },
      email: { type: String, trim: true, lowercase: true, maxlength: 120, default: "" },
      optOut: { type: Boolean, default: false },
    },
    password: {
      type: String,
      required: function () {
        return this.isProfileComplete;
      },
      minlength: [8, "Password must be at least 8 characters"],
      select: false,
    },

    // ---------- otp ----------
    otpHash: {
      type: String,
      select: false,
    },
    otpExpiresAt: Date,
    isOtpVerified: {
      type: Boolean,
      default: false,
    },
    // Separate from isOtpVerified on purpose — completeProfile only checks
    // isOtpVerified and has no isProfileComplete guard of its own, so if
    // password-reset set that same flag, verifying a reset code would leave
    // completeProfile callable and able to overwrite an existing account's
    // name and password. Two flags for two purposes, sharing the one otpHash
    // underneath, keeps the flows from being able to unlock each other.
    isResetVerified: {
      type: Boolean,
      default: false,
      select: false,
    },
    otpAttempts: {
      type: Number,
      default: 0,
    },
    otpLockedUntil: Date,

    // ---------- login throttle ----------
    loginAttempts: {
      type: Number,
      default: 0,
    },
    lockedUntil: Date,

    isProfileComplete: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // Conduct (admin → Conduct): AI features paused, or the account
    // suspended, until this time. A permanent suspension is isActive: false.
    aiPausedUntil: { type: Date, default: null },
    suspendedUntil: { type: Date, default: null },
    // Deletion requested: erased on/after this date (DeletionRequest).
    deletionScheduledFor: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    sessionId: String,
    // Last request, kept to within an hour (middleware/studentAuth.js);
    // campaigns use it to find students who've gone quiet.
    lastSeenAt: { type: Date, default: null },
    // Said no to offers and announcements (campaigns): from the account
    // page or an email's unsubscribe link.
    marketingOptOut: { type: Boolean, default: false },

    // incomplete signups are swept after 7 days. cleared once the profile is
    // finished (see pre-save below).
    expiresAt: {
      type: Date,
      default: Date.now,
      expires: 604800,
    },
  },
  { timestamps: true }
);

studentSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

studentSchema.pre("save", async function (next) {
  if (this.isProfileComplete) {
    this.expiresAt = undefined;
  }

  // sparse: true on email/phoneNumber's unique index only excludes documents
  // where the field is genuinely missing — it does not treat an empty
  // string as "not set". Two students both saved with phoneNumber: "" are,
  // as far as that index is concerned, two documents sharing the same real
  // value, and the second one fails with a duplicate-key error that reads
  // as "phoneNumber is already in use" even though neither student ever
  // entered a number. Undefined is what actually opts a document out.
  if (this.email === "") this.email = undefined;
  if (this.phoneNumber === "") this.phoneNumber = undefined;

  // An ID from the pattern (Settings → Institution), once the profile is
  // complete. Never changes after; clearing it by hand doesn't bring it back.
  if (!this.studentId && this.isProfileComplete && this.name
    && (this.isNew || this.isModified("isProfileComplete"))) {
    const { currentPattern, nextStudentId } = require("../utils/studentIdPattern");
    const pattern = await currentPattern().catch(() => "");
    if (pattern) this.studentId = await nextStudentId(pattern, this);
  }

  if (!this.isModified("password")) {
    return next();
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  return next();
});

// OTPs are hashed like passwords. The original stored them in plaintext and
// verified with speakeasy against a secret that was overwritten each time.
studentSchema.methods.setOtp = async function (otp, ttlMinutes = 5) {
  const salt = await bcrypt.genSalt(10);
  this.otpHash = await bcrypt.hash(otp, salt);
  this.otpExpiresAt = Date.now() + ttlMinutes * 60 * 1000;
  this.otpAttempts = 0;
  this.isOtpVerified = false;
};

studentSchema.methods.verifyOtp = async function (otp) {
  if (!this.otpHash || !this.otpExpiresAt) return false;
  if (this.otpExpiresAt < Date.now()) return false;
  return await bcrypt.compare(otp, this.otpHash);
};

// Called instead of "isOtpVerified = true" when the code being checked was
// for a password reset, not registration — see isResetVerified's comment
// for why these stay two separate flags on top of the one shared otpHash.
studentSchema.methods.markResetVerified = function () {
  this.isResetVerified = true;
  this.clearOtp();
};

studentSchema.methods.clearOtp = function () {
  this.otpHash = undefined;
  this.otpExpiresAt = undefined;
  this.otpAttempts = 0;
};

studentSchema.methods.isLocked = function () {
  return Boolean(this.lockedUntil && this.lockedUntil > Date.now());
};

studentSchema.methods.validateSession = function (sessionId) {
  return Boolean(sessionId) && this.sessionId === sessionId;
};

module.exports = mongoose.model("Student", studentSchema);
