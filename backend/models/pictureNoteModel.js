const mongoose = require("mongoose");

// What a stored picture shows, as read once by a vision model
// (utils/pictureNotes.js), so the video lesson script writer can pick
// pictures by what they really show and zoom into a part of one. Keyed by
// the file in storage; a picture is read again only if reading failed a
// while ago.
const pictureNoteSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    driver: { type: String, default: null },
    desc: { type: String, default: "" },
    // Parts of the picture worth zooming into, in % of it.
    regions: {
      type: [{ _id: false, id: String, label: String, x: Number, y: Number, w: Number, h: Number }],
      default: [],
    },
    failedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PictureNote", pictureNoteSchema);
