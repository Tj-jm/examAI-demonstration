const mongoose = require("mongoose");

// One student's copy of a campaign: which channels reached them, and when
// they first opened its link. Unique per campaign, student and key, so a
// resumed send never messages anyone twice for the same reason.
const campaignDeliverySchema = new mongoose.Schema(
  {
    campaign: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", required: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true },
    // An automation can reach the same student again for a new reason (a
    // second trial, access running out again): the key says which.
    // "" for a one-off campaign.
    key: { type: String, default: "" },
    channels: [
      {
        _id: false,
        channel: { type: String, enum: ["app", "sms", "email"] },
        status: { type: String, enum: ["sent", "failed", "skipped"] },
        error: { type: String, default: "" },
      },
    ],
    clickedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

campaignDeliverySchema.index({ campaign: 1, student: 1, key: 1 }, { unique: true });
// Attribution: the latest campaign a student clicked (utils/campaigns.js).
campaignDeliverySchema.index({ student: 1, clickedAt: -1 });

module.exports = mongoose.model("CampaignDelivery", campaignDeliverySchema);
