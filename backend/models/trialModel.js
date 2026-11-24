const mongoose = require("mongoose");
const cacheInvalidation = require("../utils/cacheInvalidation");
const { studentAccessTags } = require("../utils/cacheTags");

const trialSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
      index: true,
    },
    batch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Batch",
      required: true,
      index: true,
    },
    startDate: {
      type: Date,
      default: Date.now,
    },
    endDate: {
      type: Date,
      required: true,
    },
  },
  { timestamps: true }
);

// one trial per student per batch, enforced in the database rather than by a
// findOne check that can race
trialSchema.index({ student: 1, batch: 1 }, { unique: true });

// Writes here drop the cached reads built from them (utils/cacheInvalidation.js).
trialSchema.plugin(cacheInvalidation, { tags: studentAccessTags });

module.exports = mongoose.model("Trial", trialSchema);
