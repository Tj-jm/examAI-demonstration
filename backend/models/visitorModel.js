const mongoose = require("mongoose");

// One browser or app install (a random id the student app keeps on the
// device, utils/visitors.js). Where it first came from is kept for good, so
// a sale weeks later still credits the ad or post that brought them.
// Linked to the student once they sign in. Nothing personal before that:
// no IP, no name. Dropped 180 days after the last visit.
const visitorSchema = new mongoose.Schema(
  {
    _id: { type: String },
    firstAt: { type: Date, default: Date.now },
    lastAt: { type: Date, default: Date.now },
    sessions: { type: Number, default: 0 },
    source: { type: String, default: "Direct" },
    campaign: { type: String, default: "" },
    coupon: { type: String, default: "" },
    landing: { type: String, default: "/" },
    device: { type: String, default: "desktop" },
    // From utils/geo.js; the IP itself is never kept.
    country: { type: String, default: "" },
    region: { type: String, default: "" },
    city: { type: String, default: "" },
    // Funnel pages reached on any visit: "register", "plans".
    steps: { type: [String], default: [] },
    student: { type: mongoose.Schema.Types.ObjectId, ref: "Student", default: null },
  },
  { versionKey: false }
);

visitorSchema.index({ firstAt: -1 });
visitorSchema.index({ lastAt: 1 }, { expireAfterSeconds: 180 * 86400 });

module.exports = mongoose.model("Visitor", visitorSchema);
