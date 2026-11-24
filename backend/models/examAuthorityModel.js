const mongoose = require("mongoose");
const cacheInvalidation = require("../utils/cacheInvalidation");
const tags = require("../utils/cacheTags");

// Replaces the hardcoded 11-value Bengali board enum on the question models.
// A Bangladesh install seeds the education boards, an Indian install seeds
// CBSE/ICSE/state boards, a US install seeds AP/SAT. Same feature, data-driven.

const examAuthoritySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Please add an authority name"],
      trim: true,
    },
    shortName: String,
    region: String,
    // Lets a textbook ("NCTB Physics 2nd Paper") be an Authority too, so
    // the public archive's "browse by board" and "browse by book" share
    // one taxonomy and one picker instead of a separate book model.
    type: {
      type: String,
      enum: ["board_exam", "entrance_exam", "textbook", "question_bank"],
      default: "board_exam",
    },
    order: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },

    // Same shape as Batch.icon — "preset" points at a lucide icon name from
    // the shared ICON_PRESETS grid, "custom" points at an uploaded image url.
    icon: {
      kind: { type: String, enum: ["preset", "custom"], default: "preset" },
      value: { type: String, default: "Landmark" },
    },
  },
  { timestamps: true }
);

// Writes here drop the cached reads built from them (utils/cacheInvalidation.js).
examAuthoritySchema.plugin(cacheInvalidation, { tags: () => [tags.ARCHIVE] });

module.exports = mongoose.model("ExamAuthority", examAuthoritySchema);
