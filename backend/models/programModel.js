const mongoose = require("mongoose");
const cacheInvalidation = require("../utils/cacheInvalidation");
const tags = require("../utils/cacheTags");

const programSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Please add a program title"],
      trim: true,
    },
    // Markdown, rendered through SafeMarkdown — same convention as
    // Batch.description and Notice.bodyMarkdown. Shown in the course
    // catalogue's "view more" modal, above that batch's own description.
    description: String,
    // A banner/cover photo for the course catalogue card and its "view
    // more" modal — separate from icon/iconColor below, which is the
    // small badge shown in compact lists (Batches admin page, program
    // pickers). A themed placeholder stands in when this is unset, same
    // convention as Notice.coverImage.
    image: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Media",
    },
    icon: String,
    iconColor: {
      type: String,
      default: "#14161A",
    },
    order: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Writes here drop the cached reads built from them (utils/cacheInvalidation.js).
programSchema.plugin(cacheInvalidation, { tags: () => [tags.BATCHES, tags.LANDING] });

module.exports = mongoose.model("Program", programSchema);
