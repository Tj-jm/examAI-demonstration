const mongoose = require("mongoose");

// Someone who joined a public webinar from its link, without an account.
// They watch, ask questions and answer polls. A host who removes one bans
// them: their device, phone and email can't come back into that webinar.
const webinarGuestSchema = new mongoose.Schema(
  {
    liveClass: { type: mongoose.Schema.Types.ObjectId, ref: "LiveClass", required: true, index: true },
    name: { type: String, trim: true, maxlength: 60, required: true },
    phone: { type: String, trim: true, maxlength: 20, default: "" },
    email: { type: String, trim: true, lowercase: true, maxlength: 120, default: "" },
    verified: { type: Boolean, default: false },
    device: { type: String, maxlength: 64, default: "" },
    ip: { type: String, maxlength: 64, default: "" },
    banned: { type: Boolean, default: false },
    lead: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", default: null },
    // A one-time code, while one is waiting (verified webinars).
    otpHash: { type: String, default: null, select: false },
    otpExpires: { type: Date, default: null },
    otpAttempts: { type: Number, default: 0 },
    joinedAt: { type: Date, default: null },
  },
  { timestamps: true }
);
webinarGuestSchema.index({ liveClass: 1, device: 1 });
webinarGuestSchema.index({ liveClass: 1, banned: 1 });

module.exports = mongoose.model("WebinarGuest", webinarGuestSchema);
