const mongoose = require("mongoose");
const cacheInvalidation = require("../utils/cacheInvalidation");
const tags = require("../utils/cacheTags");

// Deliberately its own collection rather than a list embedded in
// LandingPage's "updates" section content — this is the one section type
// whose content is naturally a growing list of individually-dated items an
// admin adds to over time (like Notice), not a single fixed blob of text
// (like about's body). The section itself just holds a heading; this model
// holds what actually shows underneath it.
const updateSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Give this update a title."],
      trim: true,
    },
    body: {
      type: String,
      default: "",
      trim: true,
    },
    // Optional — "read more" pointing anywhere, an external post, a batch
    // page, a purchase link. null means the update is just text, no link.
    link: {
      type: String,
      default: null,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    publishedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// Writes here drop the cached reads built from them (utils/cacheInvalidation.js).
updateSchema.plugin(cacheInvalidation, { tags: () => [tags.LANDING] });

module.exports = mongoose.model("Update", updateSchema);
