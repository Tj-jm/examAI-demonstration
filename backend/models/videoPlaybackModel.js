const mongoose = require("mongoose");

// "One device at a time" for protected videos (Settings → Student app):
// which player a student last started a protected video on. The newest
// start wins; another player's key requests are refused while this one is
// fresh. Rows expire on their own.
const videoPlaybackSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true, unique: true },
  player: { type: String, required: true },
  at: { type: Date, default: Date.now, expires: 3 * 60 * 60 },
});

module.exports = mongoose.model("VideoPlayback", videoPlaybackSchema);
