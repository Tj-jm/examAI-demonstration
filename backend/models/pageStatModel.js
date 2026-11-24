const mongoose = require("mongoose");

// Page views per page and day (utils/visitors.js). Ids other than a
// course's are folded to ":id" so one row covers every lecture or exam.
// Kept 180 days.
const pageStatSchema = new mongoose.Schema(
  {
    day: { type: String, required: true },
    path: { type: String, required: true },
    views: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now, expires: 180 * 86400 },
  },
  { versionKey: false }
);

pageStatSchema.index({ day: 1, path: 1 }, { unique: true });

module.exports = mongoose.model("PageStat", pageStatSchema);
