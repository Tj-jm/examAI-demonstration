const mongoose = require("mongoose");

// A message sent to a chosen group of students by in-app notification, SMS
// and/or email, now or at a set time (utils/campaigns.js). Clicks and the
// sales that follow them are counted (campaignDeliveryModel.js,
// Purchase.campaign).
const AUDIENCES = ["all", "batch", "neverBought", "trialEnding", "expired", "inactive"];
const STATUSES = ["draft", "scheduled", "sending", "sent", "failed", "cancelled", "active", "paused"];
// Automations (utils/automations.js): sent by themselves to each student
// the moment the trigger applies to them.
const TRIGGERS = ["trialEnding", "checkoutAbandoned", "accessExpiring", "accessExpired", "inactive", "noPurchase"];

const campaignSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, "Give the campaign a name"], trim: true, maxlength: 120 },
    // "once": sent to an audience now or at a set time. "automation": sent
    // to each student when the trigger applies (status active or paused).
    kind: { type: String, enum: ["once", "automation"], default: "once", index: true },
    trigger: {
      type: { type: String, enum: TRIGGERS, default: "trialEnding" },
      // trialEnding / accessExpiring: this many days before. accessExpired,
      // inactive, noPurchase: this many days after.
      days: { type: Number, min: 1, max: 365, default: 2 },
      // checkoutAbandoned: this many hours after a checkout that didn't finish.
      hours: { type: Number, min: 1, max: 168, default: 3 },
      // Only for this batch (trialEnding, checkoutAbandoned, access*).
      batch: { type: mongoose.Schema.Types.ObjectId, ref: "Batch", default: null },
    },
    audience: {
      kind: { type: String, enum: AUDIENCES, default: "all" },
      // The batch for "batch"; narrows trialEnding, expired and inactive.
      batch: { type: mongoose.Schema.Types.ObjectId, ref: "Batch", default: null },
      // trialEnding: ends within this many days. expired: ended within
      // this many days. inactive: nothing done for this many days.
      days: { type: Number, min: 1, max: 365, default: 7 },
    },
    channels: {
      app: { type: Boolean, default: true },
      sms: { type: Boolean, default: false },
      email: { type: Boolean, default: false },
    },
    // Notification title and email subject.
    title: { type: String, trim: true, maxlength: 120, default: "" },
    // The text. {name} becomes the student's first name.
    message: { type: String, trim: true, maxlength: 1000, default: "" },
    // A page in the student app, e.g. /purchases or /purchases/<batch>.
    link: { type: String, trim: true, maxlength: 300, default: "/purchases" },
    // Added to the message as "Code: X" when set.
    couponCode: { type: String, trim: true, uppercase: true, maxlength: 40, default: "" },

    status: { type: String, enum: STATUSES, default: "draft", index: true },
    scheduledAt: { type: Date, default: null, index: true },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    // Set while sending; a stale one means the sender died and the run is picked up again.
    heartbeatAt: { type: Date, default: null },
    // Times a stopped send was picked up again; after 3 it's marked failed.
    restarts: { type: Number, default: 0 },
    error: { type: String, default: "" },

    stats: {
      recipients: { type: Number, default: 0 },
      app: { type: Number, default: 0 },
      sms: { type: Number, default: 0 },
      smsParts: { type: Number, default: 0 },
      email: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      skipped: { type: Number, default: 0 },
      clicks: { type: Number, default: 0 },
    },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

campaignSchema.statics.AUDIENCES = AUDIENCES;
campaignSchema.statics.STATUSES = STATUSES;
campaignSchema.statics.TRIGGERS = TRIGGERS;

module.exports = mongoose.model("Campaign", campaignSchema);
