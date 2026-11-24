const mongoose = require("mongoose");
const crypto = require("crypto");

// An admin never types a colleague's password. They create an invite, hand
// over the link, and the teacher sets their own credential.
//
// The raw token is returned exactly once at creation and never stored. What is
// stored is a SHA-256 of it, so a database dump does not yield working invite
// links.

const inviteSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    role: {
      type: String,
      enum: ["admin", "teacher", "doubtSolver", "representative"],
      default: "teacher",
    },
    tokenHash: {
      type: String,
      required: true,
      index: true,
    },
    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    acceptedAt: Date,
    // set when the invite was shown as a copyable link rather than emailed
    deliveredBy: {
      type: String,
      enum: ["email", "link"],
      default: "link",
    },
  },
  { timestamps: true }
);

// Unaccepted invites disappear on their own rather than lingering as valid
// credentials. TTL fires on expiresAt.
inviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

inviteSchema.statics.hashToken = function (raw) {
  return crypto.createHash("sha256").update(String(raw)).digest("hex");
};

inviteSchema.statics.issue = async function ({ email, name, role, invitedBy, ttlHours = 72 }) {
  const raw = crypto.randomBytes(32).toString("hex");

  const invite = await this.create({
    email,
    name,
    role,
    invitedBy,
    tokenHash: this.hashToken(raw),
    expiresAt: new Date(Date.now() + ttlHours * 3600000),
  });

  return { invite, token: raw };
};

module.exports = mongoose.model("Invite", inviteSchema);
