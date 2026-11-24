const mongoose = require("mongoose");

// Tax invoices (Settings → Branding → Receipt details → Tax invoices). Once
// turned on, every paid purchase gets the next number in an unbroken
// sequence for its financial year, and the tax inside its price (prices
// include tax). A refund gets a credit note number from its own sequence.

const counterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } }, { versionKey: false });
const Counter = mongoose.models.InvoiceCounter || mongoose.model("InvoiceCounter", counterSchema);

// "2026" for a calendar year; "2026-27" when the year starts in another
// month (India April, Bangladesh July).
const yearLabel = (date, startMonth = 1) => {
  const d = new Date(date);
  const m = d.getMonth() + 1;
  const y = m >= startMonth ? d.getFullYear() : d.getFullYear() - 1;
  return startMonth === 1 ? String(y) : `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
};

const nextNumber = async (prefix, year) => {
  const key = `${prefix}-${year}`;
  const { seq } = await Counter.findOneAndUpdate({ _id: key }, { $inc: { seq: 1 } }, { upsert: true, new: true });
  return `${key}-${String(seq).padStart(5, "0")}`;
};

const round = (n) => Math.round(n * 100) / 100;

const same = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

// Fills purchase.invoice (and its credit note) in place; the caller saves.
const assign = async (purchase) => {
  const AppSettings = require("../models/appSettingsModel");
  const info = (await AppSettings.get()).receiptInfo || {};
  const tax = info.tax || {};
  if (!tax.enabled) return;
  const now = new Date();

  if (purchase.status === "complete" && (purchase.amountPaid || 0) > 0 && !purchase.invoice?.number) {
    const rate = Math.max(0, Number(tax.rate) || 0);
    const total = purchase.amountPaid;
    const taxAmount = round((total * rate) / (100 + rate));
    const Student = require("../models/studentModel");
    const buyer = await Student.findById(purchase.student).select("name email phoneNumber state billing").lean();
    // GST: half CGST and half SGST inside the home state, else all IGST.
    const local = tax.gstSplit && same(buyer?.state, tax.homeState);
    const parts = !tax.gstSplit ? [] : local
      ? [{ label: "CGST", rate: rate / 2, amount: round(taxAmount / 2) }, { label: "SGST", rate: rate / 2, amount: round(taxAmount - round(taxAmount / 2)) }]
      : [{ label: "IGST", rate, amount: taxAmount }];
    purchase.invoice = {
      parts,
      buyer: {
        name: buyer?.billing?.name || buyer?.name || "",
        contact: buyer?.email || buyer?.phoneNumber || "",
        taxId: buyer?.billing?.taxId || "",
        state: buyer?.state || "",
      },
      sellerState: tax.gstSplit ? tax.homeState || "" : "",
      number: await nextNumber(tax.prefix || "INV", yearLabel(now, tax.yearStartMonth)),
      issuedAt: now,
      label: tax.label || "VAT",
      rate,
      net: round(total - taxAmount),
      tax: taxAmount,
      taxId: info.taxId || "",
    };
  }
  if (purchase.status === "refunded" && purchase.invoice?.number && !purchase.invoice.creditNote) {
    purchase.invoice.creditNote = await nextNumber(`${tax.prefix || "INV"}-CN`, yearLabel(now, tax.yearStartMonth));
    purchase.invoice.creditNoteAt = now;
  }
};

module.exports = { assign, yearLabel };
