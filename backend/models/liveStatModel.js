const mongoose = require("mongoose");

// A sample of the in-app live classes every few minutes while any is live
// (utils/liveMonitor.js record()), for the Performance page's history.
// Kept 90 days.
const liveStatSchema = new mongoose.Schema({
  at: { type: Date, default: Date.now },
  rooms: { type: Number, default: 0 },
  people: { type: Number, default: 0 },
  students: { type: Number, default: 0 },
  // LiveKit's own CPU use (%), when its metrics are on; else null.
  cpu: { type: Number, default: null },
});

liveStatSchema.index({ at: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });

module.exports = mongoose.model("LiveStat", liveStatSchema);
