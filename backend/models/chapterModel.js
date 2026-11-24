const mongoose = require("mongoose");
const cacheInvalidation = require("../utils/cacheInvalidation");
const tags = require("../utils/cacheTags");

const chapterSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Please add a chapter title"],
      trim: true,
    },
    subTitle: String,
    subject: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subject",
      required: [true, "Please add a subject"],
      index: true,
    },
    // free-text grouping label. was the hardcoded first/second paper split.
    section: String,
    order: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

chapterSchema.index({ subject: 1, order: 1 });

// Writes here drop the cached reads built from them (utils/cacheInvalidation.js).
chapterSchema.plugin(cacheInvalidation, { tags: () => [tags.TAXONOMY] });

module.exports = mongoose.model("Chapter", chapterSchema);
