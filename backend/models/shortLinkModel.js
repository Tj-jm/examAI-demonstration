const mongoose = require("mongoose");
const crypto = require("crypto");

// A short link is just a stored (batch, coupon, target) triple behind a
// short random code — everything past the redirect is the exact same
// pipeline a hand-typed coupon or a long ?ref= link already goes through
// (see ReferralLinkButton.jsx and PlanPicker.jsx/AiCredits.jsx's ?ref=
// handling). This is not a new discount mechanism, just a shorter way to
// hand someone a link that already worked.
const shortLinkSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
    },
    batch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Batch",
      required: true,
      default: null,
    },
    couponCode: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    // Which page the code should land on — an AI-credits-only coupon has
    // to go to the AI credits page, or it would just be rejected there as
    // invalid the moment it's previewed. See couponModel.js's products
    // field and ReferralLinkButton.jsx, which makes the same choice for a
    // plain (non-shortened) referral link.
    target: {
      type: String,
      enum: ["subscribe", "aiCredits"],
      default: "subscribe",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    clicks: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

// 6 hex characters — 16^6, over 16 million combinations, plenty for a
// handful of promotional links without a meaningful collision risk. Always
// lowercase by construction, unlike a coupon code (deliberately uppercase
// everywhere else in this system), so retyping a short link in the wrong
// case never breaks it.
const generateCode = () => crypto.randomBytes(4).toString("hex").slice(0, 6);

// Idempotent — the same (batch, coupon, target) combination always
// resolves to the same code, so clicking "copy" again for a link already
// generated returns that same short code rather than minting a new one
// (and a new click counter) every time.
shortLinkSchema.statics.findOrCreate = async function ({ batch = null, couponCode, target, createdBy }) {
  const normalizedTarget = target === "aiCredits" ? target : "subscribe";
  const existing = await this.findOne({ batch, couponCode, target: normalizedTarget });
  if (existing) return existing;

  // A collision is extremely unlikely at 16 million combinations, but
  // retried rather than assumed away — correctness here costs nothing and
  // a silent failure would be a broken link handed to real students.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await this.create({ code: generateCode(), batch, couponCode, target: normalizedTarget, createdBy });
    } catch (err) {
      if (err.code !== 11000) throw err; // only retry a duplicate-key collision
    }
  }
  throw new Error("Could not generate a unique short code — try again.");
};

module.exports = mongoose.model("ShortLink", shortLinkSchema);
