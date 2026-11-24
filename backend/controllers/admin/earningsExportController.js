const asyncHandler = require("express-async-handler");
const ExcelJS = require("exceljs");
const Purchase = require("../../models/purchaseModel");
const { buildMatch, getSummaryData } = require("./earningsController");

// Re-runs the exact same summary logic the on-screen dashboard uses
// (buildMatch, then getSummaryData) rather than re-deriving the numbers a
// second way — an export that disagreed with the screen it was exported
// from would be a worse bug than either one being wrong alone, since
// nobody would know which to trust.

const addTable = (sheet, headers, rows) => {
  const headerRow = sheet.addRow(headers);
  headerRow.font = { bold: true };
  rows.forEach((row) => sheet.addRow(row));

  sheet.columns.forEach((col, index) => {
    const values = sheet.getColumn(index + 1).values.map((v) => String(v ?? ""));
    col.width = Math.max(12, ...values.map((v) => v.length + 2));
  });
};

//@desc   The same summary the dashboard shows, as a downloadable .xlsx —
//        five sheets: Summary, By batch, AI packs, By provider, and every
//        individual transaction the filter matched.
//@route  GET /api/admin/earnings/export
//@access Private (owner, admin)
const exportEarnings = asyncHandler(async (req, res) => {
  const match = await buildMatch(req.query);
  const { currencyTotals, byBatch, aiPacks, byProvider } = await getSummaryData(match);

  // A hard ceiling, not a page size — the dashboard itself never paginates
  // (it only ever shows aggregated totals), so there is no existing page
  // size to reuse here. 20,000 rows is generous for any date range an
  // admin would realistically pull in one export; a filter wide enough to
  // exceed it is a report worth narrowing by date first.
  const transactions = await Purchase.find(match)
    .populate("student", "name email")
    .populate("batch", "name")
    .sort({ createdAt: -1 })
    .limit(20000);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ExamAI";
  workbook.created = new Date();

  const summarySheet = workbook.addWorksheet("Summary");
  addTable(
    summarySheet,
    ["Currency", "Batch revenue", "AI pack revenue", "Total", "Transactions"],
    currencyTotals.map((r) => [r.currency, r.batchTotal, r.aiTotal, r.grandTotal, r.count])
  );
  [2, 3, 4].forEach((n) => { summarySheet.getColumn(n).numFmt = "#,##0.00"; });

  const batchSheet = workbook.addWorksheet("By batch");
  addTable(
    batchSheet,
    ["Batch", "Currency", "Total", "Transactions"],
    byBatch.map((r) => [r.batchName, r.currency, r.total, r.count])
  );
  batchSheet.getColumn(3).numFmt = "#,##0.00";

  const aiSheet = workbook.addWorksheet("AI packs");
  addTable(
    aiSheet,
    ["Batch", "Currency", "Total", "Credits sold", "Transactions"],
    aiPacks.map((r) => [r.batchName, r.currency, r.total, r.credits, r.count])
  );
  aiSheet.getColumn(3).numFmt = "#,##0.00";

  const providerSheet = workbook.addWorksheet("By provider");
  addTable(
    providerSheet,
    ["Provider", "Currency", "Total", "Transactions"],
    byProvider.map((r) => [r.provider, r.currency, r.total, r.count])
  );
  providerSheet.getColumn(3).numFmt = "#,##0.00";

  const txSheet = workbook.addWorksheet("Transactions");
  addTable(
    txSheet,
    ["Date", "Student", "Email", "Batch", "Kind", "Plan", "Currency", "Amount paid", "Discount", "Provider", "Status"],
    transactions.map((p) => [
      p.createdAt,
      p.student?.name || "(deleted student)",
      p.student?.email || "",
      p.batch?.name || (p.kind === "ai-credits" ? "General" : "(deleted batch)"),
      p.kind,
      p.plan?.label || "",
      p.currency,
      p.amountPaid,
      p.discountAmount || 0,
      p.provider,
      p.status,
    ])
  );
  txSheet.getColumn(1).numFmt = "yyyy-mm-dd hh:mm";
  txSheet.getColumn(8).numFmt = "#,##0.00";
  txSheet.getColumn(9).numFmt = "#,##0.00";

  // Tax invoices, for the tax return (utils/invoice.js).
  const invoiced = transactions.filter((p) => p.invoice?.number);
  if (invoiced.length) {
    const invoiceSheet = workbook.addWorksheet("Tax invoices");
    addTable(
      invoiceSheet,
      ["Invoice", "Date", "Student", "Batch", "Currency", "Net", "Tax", "Rate %", "Total", "Tax", "Credit note"],
      invoiced.map((p) => [
        p.invoice.number,
        p.invoice.issuedAt,
        p.student?.name || "(deleted student)",
        p.batch?.name || (p.kind === "ai-credits" ? "General" : "(deleted batch)"),
        p.currency,
        p.invoice.net,
        p.invoice.tax,
        p.invoice.rate,
        p.amountPaid,
        p.invoice.label,
        p.invoice.creditNote || "",
      ])
    );
    invoiceSheet.getColumn(2).numFmt = "yyyy-mm-dd";
    [6, 7, 9].forEach((n) => { invoiceSheet.getColumn(n).numFmt = "#,##0.00"; });
  }

  const filename = `earnings-${new Date().toISOString().slice(0, 10)}.xlsx`;
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

  await workbook.xlsx.write(res);
  res.end();
});

module.exports = { exportEarnings };
