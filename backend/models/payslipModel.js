const mongoose = require("mongoose");

// A team member's pay for one period (utils/teamPay.js works out the lines;
// controllers/admin/payslipController.js). The lines are frozen when the
// payslip is made, so later changes to rates or marks never rewrite it.
//
//   draft     -> an admin is still editing it; the member can't see it
//   issued    -> the member can see it; waiting to be paid
//   paid      -> an admin recorded the payment (method, reference, proof)
//   confirmed -> the member said they received it
//   disputed  -> the member said something is wrong; an admin can pay again
//               or fix and re-issue
const lineSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["grading", "doubts", "sales", "classes", "bonus", "deduction", "other"], default: "other" },
    label: { type: String, trim: true, maxlength: 200 },
    quantity: { type: Number, default: null },
    rate: { type: Number, default: null },
    // Negative for a deduction.
    amount: { type: Number, required: true },
  },
  { _id: false }
);

const payslipSchema = new mongoose.Schema(
  {
    number: { type: String, unique: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    // Snapshots, so a renamed or deleted account still reads right.
    name: String,
    role: String,
    periodFrom: Date,
    periodTo: Date,
    currency: { type: String, required: true, uppercase: true, trim: true },
    lines: { type: [lineSchema], default: [] },
    total: { type: Number, default: 0 },
    note: { type: String, trim: true, maxlength: 2000 },
    status: { type: String, enum: ["draft", "issued", "paid", "confirmed", "disputed"], default: "draft", index: true },
    issuedAt: Date,
    payment: {
      method: { type: String, trim: true, maxlength: 60 },
      reference: { type: String, trim: true, maxlength: 120 },
      paidAt: Date,
      proofUrl: String,
      by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    },
    confirmedAt: Date,
    dispute: {
      note: { type: String, trim: true, maxlength: 2000 },
      at: Date,
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

payslipSchema.pre("validate", function () {
  this.total = Math.round(this.lines.reduce((n, l) => n + (Number(l.amount) || 0), 0) * 100) / 100;
});

// PS-2026-0001: year, then a count within that year.
payslipSchema.pre("save", async function () {
  if (this.number) return;
  const year = new Date().getFullYear();
  const prefix = `PS-${year}-`;
  const last = await this.constructor.findOne({ number: { $regex: `^${prefix}` } }).sort({ number: -1 }).select("number").lean();
  const n = last ? Number(last.number.slice(prefix.length)) + 1 : 1;
  this.number = `${prefix}${String(n).padStart(4, "0")}`;
});

module.exports = mongoose.model("Payslip", payslipSchema);
