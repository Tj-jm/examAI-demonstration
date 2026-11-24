const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Please add a name"],
      trim: true,
    },

    // Purely internal — an admin-only label shown in staff-facing reports
    // (the doubt queue's "resolved by" column, solved-doubt history,
    // payment summaries) as an alternative to this person's real name.
    // Never read anywhere a student can see it: this exists for privacy
    // (a doubt solver's real name need not reach a student) and for
    // institutions that want payroll-facing records under a different
    // label than the login name. Falls back to name wherever it's used,
    // via the same identifierOrName() helper everywhere rather than each
    // call site repeating `user.identifier || user.name`.
    identifier: {
      type: String,
      default: null,
      trim: true,
    },

    email: {
      type: String,
      required: [true, "Please add an email"],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, "Please add a password"],
      minlength: [8, "Password must be at least 8 characters"],
      select: false,
    },
    // replaces the isAdmin boolean. owner is the install owner and cannot be
    // demoted or deleted by another account.
    role: {
      type: String,
      enum: ["owner", "admin", "teacher", "grader", "doubtSolver", "representative"],
      default: "teacher",
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // Soft-delete, deliberately never a real document removal. A staff
    // member's id shows up as gradedByUser on a Submission's answer, or as
    // resolvedBy/decidedBy on a Doubt — those records must go on
    // resolving that reference correctly (the name, the identifier) for
    // as long as the doubt/submission itself exists, even after the
    // account is "deleted". Hard-deleting the User document would either
    // orphan those references (a dangling id, nothing to populate) or
    // require touching every read path that ever populates a staff
    // reference — this avoids both: the document stays, isDeleted just
    // marks it, and every existing populate("...", "name identifier")
    // keeps working unchanged, only now able to also select isDeleted to
    // show a "(deleted)" tag where staff identity is displayed.
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    sessionId: String,
    lastActiveAt: Date,

    // Set on an account created with a password nobody actually chose (the
    // seed script's randomly generated owner password — see seed/index.js).
    // Surfaced on login/me so a client can prompt for a change; not
    // enforced server-side by blocking other routes, since doing that
    // without a client that actually offers a change-password screen would
    // just lock the account out with no way back in.
    mustChangePassword: {
      type: Boolean,
      default: false,
    },

    // ---------- login throttle ----------
    // Mirrors studentModel's per-account lockout — IP-based authLimiter
    // alone doesn't stop a distributed attempt (rotating IPs) against one
    // known admin email.
    loginAttempts: {
      type: Number,
      default: 0,
    },
    lockedUntil: Date,

    // ---------- public profile ----------
    // What students and visitors see about a teacher: on the landing page's
    // teachers section, in a batch's details and on its home page. Never
    // the email or anything else above. Only an owner or admin edits it
    // (Team page); utils/teacherProfile.js shapes it.
    profile: {
      photo: { type: mongoose.Schema.Types.ObjectId, ref: "Media", default: null },
      headline: { type: String, trim: true, maxlength: 120, default: "" },
      subjects: { type: [String], default: [] },
      qualifications: { type: String, trim: true, maxlength: 300, default: "" },
      experienceYears: { type: Number, min: 0, max: 80, default: null },
      bio: { type: String, trim: true, maxlength: 2000, default: "" },
      // Off hides them from students and visitors everywhere.
      public: { type: Boolean, default: true },
    },

    // ---------- class pay ----------
    // What this person is paid for the live classes they take (Payslips →
    // Class pay, utils/classPay.js): by the hour or by the class, one rate in
    // the app's default currency whatever the batch or date. rate 0: not
    // paid for classes. overtime: paid for a class's whole real length;
    // otherwise capped at its scheduled length plus the grace in
    // settings.classPay.
    classPay: {
      mode: { type: String, enum: ["hour", "class"], default: "hour" },
      rate: { type: Number, min: 0, default: 0 },
      overtime: { type: Boolean, default: false },
    },
    // ---------- their own account (My profile, utils/staffSelf.js) ----------
    // Contact and pay-out details, set by the person themselves. Never
    // shown to students.
    phone: { type: String, trim: true, maxlength: 30, default: "" },
    payout: {
      method: { type: String, enum: ["none", "bkash", "nagad", "rocket", "bank"], default: "none" },
      account: { type: String, trim: true, maxlength: 60, default: "" },
      holder: { type: String, trim: true, maxlength: 80, default: "" },
      bank: { type: String, trim: true, maxlength: 80, default: "" },
      branch: { type: String, trim: true, maxlength: 80, default: "" },
    },
    // How the admin panel looks and alerts for them.
    prefs: {
      theme: { type: String, enum: ["system", "light", "dark"], default: "system" },
      fontScale: { type: Number, min: 80, max: 130, default: 100 },
      alerts: { type: Boolean, default: true }, // sound and desktop alert when new work arrives
      sound: { type: Boolean, default: true },
      quietFrom: { type: String, default: "" }, // "22:00"
      quietTo: { type: String, default: "" }, // "08:00"
    },
    // On leave: nothing new is assigned to them until this date.
    away: {
      until: { type: Date, default: null },
      note: { type: String, trim: true, maxlength: 200, default: "" },
    },
    // Set by an admin (Team): what this person is responsible for, their
    // weekly goal (in their role's unit: scripts, doubts, …) and
    // features turned off for them.
    duty: {
      note: { type: String, trim: true, maxlength: 1000, default: "" },
      goal: { type: Number, min: 0, max: 10000, default: 0 },
      off: { type: [String], default: [] }, // "ai", "claimScripts", "doubts"
    },
    // Days they used the panel ("2026-11-11"), the last 60: their streak.
    activeDays: { type: [String], default: [] },
    // Their last sign-ins.
    logins: {
      type: [{ _id: false, at: Date, ip: String, agent: String }],
      default: [],
    },
    // When this person last opened each admin page with a badge
    // (controllers/admin/badgeController.js): anything newer shows as new.
    badgeSeen: { type: Map, of: Date, default: undefined },
  },
  { timestamps: true }
);

userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

userSchema.methods.isLocked = function () {
  return Boolean(this.lockedUntil && this.lockedUntil > Date.now());
};

// The original hook called next() without returning, then fell through and
// re-hashed an already-hashed password on every save. Rotating sessionId on
// login and logout triggers a save, so that fired twice per session.
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) {
    return next();
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  return next();
});

// The one place "what do we call this person in an internal report" gets
// decided, so every admin-facing display (doubt queue, solved-doubt
// history, payment summaries) reads the same value the same way rather
// than each screen repeating `user.identifier || user.name` and risking
// one of them forgetting the fallback.
userSchema.methods.identifierOrName = function () {
  return this.identifier || this.name;
};

module.exports = mongoose.model("User", userSchema);
