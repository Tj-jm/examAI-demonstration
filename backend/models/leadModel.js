const mongoose = require("mongoose");

// Someone who left their name and number on the landing page's interest
// form (controllers/app/leadController.js). Staff follow up from the
// Leads page; a lead who later signs up is marked joined on its own.
const leadSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, maxlength: 80, default: "" },
    phone: { type: String, trim: true, maxlength: 20, default: "" },
    email: { type: String, trim: true, lowercase: true, maxlength: 120, default: "" },
    batch: { type: mongoose.Schema.Types.ObjectId, ref: "Batch", default: null },
    message: { type: String, trim: true, maxlength: 500, default: "" },
    // Where they filled it in, and a referral code they arrived with.
    source: { type: String, trim: true, maxlength: 40, default: "landing" },
    ref: { type: String, trim: true, uppercase: true, maxlength: 40, default: "" },
    status: { type: String, enum: ["new", "contacted", "joined", "lost"], default: "new", index: true },
    notes: { type: String, trim: true, maxlength: 2000, default: "" },
    student: { type: mongoose.Schema.Types.ObjectId, ref: "Student", default: null },
    contactedAt: { type: Date, default: null },
    joinedAt: { type: Date, default: null },
    // Messages staff sent from the Leads page.
    messages: { type: Number, default: 0 },
  },
  { timestamps: true }
);

leadSchema.index({ phone: 1 }, { partialFilterExpression: { phone: { $type: "string", $gt: "" } } });
leadSchema.index({ email: 1 }, { partialFilterExpression: { email: { $type: "string", $gt: "" } } });
leadSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Lead", leadSchema);
