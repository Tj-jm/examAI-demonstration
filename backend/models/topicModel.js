const mongoose = require("mongoose");
const cacheInvalidation = require("../utils/cacheInvalidation");
const tags = require("../utils/cacheTags");

const topicSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Please add a topic title"],
      trim: true,
    },
    subTitle: String,
    chapter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Chapter",
      required: [true, "Please add a chapter"],
      index: true,
    },
    subject: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subject",
      required: true,
      index: true,
    },
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

topicSchema.index({ chapter: 1, order: 1 });

// Writes here drop the cached reads built from them (utils/cacheInvalidation.js).
topicSchema.plugin(cacheInvalidation, { tags: () => [tags.TAXONOMY] });

module.exports = mongoose.model("Topic", topicSchema);
