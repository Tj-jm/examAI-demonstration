const mongoose = require("mongoose");

// A running balance, one document per student+batch — checked and
// decremented on every AI call once the batch's free daily allowance is
// used up. No expiry and no forfeiture on access lapsing: a purchased
// credit is a credit until it's spent, full stop. That's a deliberate,
// simple default — a paying student losing what they bought because a
// subscription happened to lapse is a support complaint waiting to happen,
// and "credits never expire" is far easier to explain than any window.
const aiCreditSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
      index: true,
    },
    // Unset means a general balance — checked as a fallback for AI calls
    // on any batch, after that batch's own balance (if any) is used up.
    // The {student:1, batch:1} unique index below still does the right
    // thing with batch unset: MongoDB treats null as a real value for
    // uniqueness purposes, so a student can still only have one general
    // balance document, exactly like one balance document per batch.
    batch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Batch",
    },
    balance: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true }
);

aiCreditSchema.index({ student: 1, batch: 1 }, { unique: true });

module.exports = mongoose.model("AiCredit", aiCreditSchema);
