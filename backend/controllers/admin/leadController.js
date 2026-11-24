const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Lead = require("../../models/leadModel");
const AppSettings = require("../../models/appSettingsModel");
const sms = require("../../adapters/sms");
const email = require("../../adapters/email");
const { interested } = require("../../utils/leads");

// Leads (admin Leads page): interest-form sign-ups and students who looked
// at plans without buying. Owner and admin only.

const STATUSES = ["new", "contacted", "joined", "lost"];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const filterOf = (q) => {
  const filter = {};
  if (STATUSES.includes(q.status)) filter.status = q.status;
  if (mongoose.isValidObjectId(q.batch)) filter.batch = q.batch;
  const search = String(q.search || "").trim().slice(0, 80);
  if (search) {
    const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ name: rx }, { phone: rx }, { email: rx }];
  }
  return filter;
};

//@desc   Leads, newest first, with counts by status
//@route  GET /api/leads?status=&batch=&search=&page=
//@access Private (owner, admin)
const listLeads = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = 30;
  const filter = filterOf(req.query);
  const [leads, total, counts] = await Promise.all([
    Lead.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate("batch", "name").populate("student", "name").lean(),
    Lead.countDocuments(filter),
    Lead.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]),
  ]);
  res.status(200).json({
    leads, total, page, pages: Math.max(1, Math.ceil(total / limit)),
    counts: Object.fromEntries(STATUSES.map((s) => [s, counts.find((c) => c._id === s)?.n || 0])),
  });
});

//@desc   Change a lead's status or notes
//@route  PUT /api/leads/:id
//@access Private (owner, admin)
const updateLead = asyncHandler(async (req, res) => {
  const lead = await Lead.findById(req.params.id);
  if (!lead) {
    res.status(404);
    throw new Error("Lead not found.");
  }
  if (STATUSES.includes(req.body.status)) {
    lead.status = req.body.status;
    if (req.body.status === "contacted" && !lead.contactedAt) lead.contactedAt = new Date();
  }
  if (req.body.notes !== undefined) lead.notes = String(req.body.notes || "").slice(0, 2000);
  await lead.save();
  res.status(200).json(lead);
});

//@desc   Delete a lead
//@route  DELETE /api/leads/:id
//@access Private (owner, admin)
const deleteLead = asyncHandler(async (req, res) => {
  await Lead.deleteOne({ _id: req.params.id });
  res.status(200).json({ ok: true });
});

//@desc   Send an SMS or email to chosen leads; marks them contacted
//@route  POST /api/leads/message
//@access Private (owner, admin)
const messageLeads = asyncHandler(async (req, res) => {
  const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).filter((id) => mongoose.isValidObjectId(id)).slice(0, 500);
  const channel = req.body.channel === "email" ? "email" : "sms";
  const text = String(req.body.text || "").trim().slice(0, 1000);
  const subject = String(req.body.subject || "").trim().slice(0, 120);
  if (!ids.length || !text) {
    res.status(400);
    throw new Error("Pick some leads and write the message.");
  }
  const adapter = channel === "email" ? email : sms;
  if (!adapter.configured()) {
    res.status(400);
    throw new Error(channel === "email" ? "Email isn't set up yet." : "SMS isn't set up yet.");
  }
  const settings = await AppSettings.get();
  const leads = await Lead.find({ _id: { $in: ids } });
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const lead of leads) {
    const to = channel === "email" ? lead.email : lead.phone;
    if (!to) { skipped += 1; continue; }
    const body = text.replace(/\{name\}/g, (lead.name || "").split(" ")[0] || "there");
    try {
      if (channel === "email") {
        const brand = settings.siteName || "";
        await email.send(to, subject || brand || "Hello", body,
          require("../../utils/emailLayout").render(settings, { title: subject || "", text: body, preheader: body.slice(0, 110) }));
      } else {
        await sms.send(to, body);
      }
      lead.messages += 1;
      if (lead.status === "new") lead.status = "contacted";
      if (!lead.contactedAt) lead.contactedAt = new Date();
      await lead.save();
      sent += 1;
    } catch {
      failed += 1;
    }
  }
  res.status(200).json({ sent, skipped, failed });
});

//@desc   Leads as a CSV file
//@route  GET /api/leads/export?status=&batch=&search=
//@access Private (owner, admin)
const exportLeads = asyncHandler(async (req, res) => {
  const leads = await Lead.find(filterOf(req.query)).sort({ createdAt: -1 }).limit(20000).populate("batch", "name").lean();
  const cell = (v) => {
    const s = String(v ?? "");
    // Spreadsheet formulas from a public form are a known trick: neutralise.
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const rows = [["Date", "Name", "Phone", "Email", "Course", "Message", "Status", "Notes", "Referral code"]]
    .concat(leads.map((l) => [l.createdAt?.toISOString().slice(0, 10), l.name, l.phone, l.email, l.batch?.name || "", l.message, l.status, l.notes, l.ref]));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="leads.csv"');
  res.status(200).send(`﻿${rows.map((r) => r.map(cell).join(",")).join("\n")}`);
});

//@desc   Signed-in students who opened a batch's plans and haven't bought
//@route  GET /api/leads/interested?days=&batch=&page=
//@access Private (owner, admin)
const getInterested = asyncHandler(async (req, res) => {
  const days = Math.min(60, Math.max(1, Number(req.query.days) || 14));
  res.status(200).json(await interested({ days, batch: req.query.batch, page: Math.max(1, Number(req.query.page) || 1) }));
});

module.exports = { listLeads, updateLead, deleteLead, messageLeads, exportLeads, getInterested };
