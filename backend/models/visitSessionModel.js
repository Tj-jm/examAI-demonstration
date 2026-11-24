const mongoose = require("mongoose");

// One visit: pages opened without a 30-minute break (utils/visitors.js).
// Where this visit came from can differ from the visitor's first source.
// Kept 180 days.
const visitSessionSchema = new mongoose.Schema(
  {
    _id: { type: String },
    visitor: { type: String, required: true },
    startedAt: { type: Date, default: Date.now },
    lastAt: { type: Date, default: Date.now },
    day: { type: String, required: true }, // YYYY-MM-DD in the institution's time zone
    source: { type: String, default: "Direct" },
    device: { type: String, default: "desktop" },
    // From utils/geo.js; the IP itself is never kept.
    country: { type: String, default: "" },
    region: { type: String, default: "" },
    city: { type: String, default: "" },
    landing: { type: String, default: "/" },
    views: { type: Number, default: 0 },
    student: { type: mongoose.Schema.Types.ObjectId, ref: "Student", default: null },
  },
  { versionKey: false }
);

visitSessionSchema.index({ startedAt: -1 });
visitSessionSchema.index({ startedAt: 1 }, { expireAfterSeconds: 180 * 86400 });

module.exports = mongoose.model("VisitSession", visitSessionSchema);
