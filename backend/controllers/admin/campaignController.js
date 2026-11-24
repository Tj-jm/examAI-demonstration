const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Campaign = require("../../models/campaignModel");
const Batch = require("../../models/batchModel");
const campaigns = require("../../utils/campaigns");

// Campaigns (utils/campaigns.js) and automations (utils/automations.js,
// campaigns with kind "automation"): owner and admin only.

const EDITABLE = ["draft", "scheduled", "active", "paused"];

// The fields a campaign takes from a request, cleaned.
const fieldsFrom = (body = {}) => {
  const out = {};
  if (body.name !== undefined) out.name = String(body.name || "").trim().slice(0, 120);
  if (body.audience) {
    const a = body.audience;
    out.audience = {
      kind: Campaign.AUDIENCES.includes(a.kind) ? a.kind : "all",
      batch: a.batch && mongoose.isValidObjectId(String(a.batch)) ? a.batch : null,
      days: Math.min(365, Math.max(1, Math.round(Number(a.days) || 7))),
    };
  }
  if (body.trigger) {
    const t = body.trigger;
    out.trigger = {
      type: Campaign.TRIGGERS.includes(t.type) ? t.type : "trialEnding",
      days: Math.min(365, Math.max(1, Math.round(Number(t.days) || 2))),
      hours: Math.min(168, Math.max(1, Math.round(Number(t.hours) || 3))),
      batch: t.batch && mongoose.isValidObjectId(String(t.batch)) ? t.batch : null,
    };
  }
  if (body.channels) {
    out.channels = { app: Boolean(body.channels.app), sms: Boolean(body.channels.sms), email: Boolean(body.channels.email) };
  }
  for (const [k, n] of [["title", 120], ["message", 1000], ["couponCode", 40]]) {
    if (body[k] !== undefined) out[k] = String(body[k] || "").trim().slice(0, n);
  }
  if (body.link !== undefined) {
    const link = String(body.link || "").trim().slice(0, 300) || "/";
    // A page in the student app, never another site.
    out.link = link.startsWith("/") && !link.startsWith("//") ? link : `/${link.replace(/^\/+/, "")}`;
  }
  return out;
};

// What's needed before a campaign can go out.
const problemWith = (c) => {
  if (!c.name) return "Give the campaign a name.";
  if (!c.message) return "Write the message.";
  if (!c.channels?.app && !c.channels?.sms && !c.channels?.email) return "Pick at least one way to send it.";
  if (c.kind !== "automation" && c.audience?.kind === "batch" && !c.audience.batch) return "Pick the batch.";
  return null;
};

//@desc   Campaigns, newest first, with sales credited to each
//@route  GET /api/campaigns?page=&status=
const listCampaigns = asyncHandler(async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = 20;
  const query = { kind: req.query.kind === "automation" ? "automation" : { $ne: "automation" } };
  if (Campaign.STATUSES.includes(req.query.status)) query.status = req.query.status;
  const [rows, total] = await Promise.all([
    Campaign.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate("audience.batch", "name").lean(),
    Campaign.countDocuments(query),
  ]);
  const sales = await campaigns.salesFor(rows.map((c) => c._id));
  res.status(200).json({
    campaigns: rows.map((c) => ({ ...c, sales: sales[String(c._id)] || [] })),
    total, page, pages: Math.max(1, Math.ceil(total / limit)),
  });
});

//@desc   One campaign
//@route  GET /api/campaigns/:id
const getCampaign = asyncHandler(async (req, res) => {
  const c = await Campaign.findById(req.params.id).populate("audience.batch", "name").lean();
  if (!c) { res.status(404); throw new Error("Campaign not found."); }
  const sales = await campaigns.salesFor([c._id]);
  res.status(200).json({ ...c, sales: sales[String(c._id)] || [] });
});

//@desc   New campaign (a draft), or a new automation (paused), optionally
//        from a preset (utils/automations.js PRESETS)
//@route  POST /api/campaigns
const createCampaign = asyncHandler(async (req, res) => {
  const automation = req.body.kind === "automation";
  const preset = automation ? require("../../utils/automations").PRESETS[req.body.preset] : null;
  const fields = { ...(preset ? fieldsFrom(preset) : {}), ...fieldsFrom(req.body) };
  if (automation) {
    fields.kind = "automation";
    fields.status = "paused";
  }
  if (!fields.name) { res.status(400); throw new Error("Give the campaign a name."); }
  if (fields.audience?.batch && !(await Batch.exists({ _id: fields.audience.batch }))) { res.status(400); throw new Error("That batch wasn't found."); }
  const c = await Campaign.create({ ...fields, createdBy: req.user._id });
  res.status(201).json(c);
});

//@desc   Edit a draft or scheduled campaign
//@route  PUT /api/campaigns/:id
const updateCampaign = asyncHandler(async (req, res) => {
  const c = await Campaign.findById(req.params.id);
  if (!c) { res.status(404); throw new Error("Campaign not found."); }
  if (!EDITABLE.includes(c.status)) { res.status(409); throw new Error("A campaign that has started sending can't be changed. Duplicate it instead."); }
  Object.assign(c, fieldsFrom(req.body));
  if (c.kind === "automation" && c.status === "active") {
    const problem = problemWith(c);
    if (problem) { res.status(400); throw new Error(problem); }
  }
  if (c.audience?.batch && !(await Batch.exists({ _id: c.audience.batch }))) { res.status(400); throw new Error("That batch wasn't found."); }
  await c.save();
  res.status(200).json(c);
});

//@desc   Who it would reach and how, before sending. Takes unsaved fields.
//@route  POST /api/campaigns/estimate
const estimateCampaign = asyncHandler(async (req, res) => {
  const base = req.body.id && mongoose.isValidObjectId(req.body.id) ? (await Campaign.findById(req.body.id).lean()) || {} : {};
  const merged = { ...base, ...fieldsFrom(req.body) };
  if ((req.body.kind || merged.kind) === "automation") {
    // Who it would message if it ran now (those it already reached are skipped then).
    const list = await require("../../utils/automations").candidates(merged.trigger || {});
    return res.status(200).json({ ...(await campaigns.estimate(merged, [...new Set(list.map((c) => c.student))])), automation: true });
  }
  res.status(200).json(await campaigns.estimate(merged));
});

//@desc   Send now, or schedule for `at`
//@route  POST /api/campaigns/:id/send { at? }
const sendCampaign = asyncHandler(async (req, res) => {
  const c = await Campaign.findById(req.params.id);
  if (!c) { res.status(404); throw new Error("Campaign not found."); }
  if (c.kind === "automation") { res.status(400); throw new Error("An automation sends by itself: switch it on instead."); }
  if (!["draft", "scheduled"].includes(c.status)) { res.status(409); throw new Error("This campaign has already been sent."); }
  const problem = problemWith(c);
  if (problem) { res.status(400); throw new Error(problem); }

  if (req.body.at) {
    const at = new Date(req.body.at);
    if (Number.isNaN(at.getTime()) || at.getTime() < Date.now() - 60000) { res.status(400); throw new Error("Pick a time in the future."); }
    c.status = "scheduled";
    c.scheduledAt = at;
    await c.save();
    return res.status(200).json(c);
  }
  if (!(await campaigns.start(c._id))) { res.status(409); throw new Error("This campaign is already sending."); }
  res.status(200).json(await Campaign.findById(c._id));
});

//@desc   Switch an automation on or off
//@route  POST /api/campaigns/:id/toggle { on }
const toggleAutomation = asyncHandler(async (req, res) => {
  const c = await Campaign.findById(req.params.id);
  if (!c || c.kind !== "automation") { res.status(404); throw new Error("Automation not found."); }
  if (req.body.on) {
    const problem = problemWith(c);
    if (problem) { res.status(400); throw new Error(problem); }
  }
  c.status = req.body.on ? "active" : "paused";
  if (req.body.on && !c.startedAt) c.startedAt = new Date();
  await c.save();
  res.status(200).json(c);
});

//@desc   Stop a scheduled or sending campaign
//@route  POST /api/campaigns/:id/cancel
const cancelCampaign = asyncHandler(async (req, res) => {
  const c = await Campaign.findOneAndUpdate(
    { _id: req.params.id, status: { $in: ["scheduled", "sending"] } },
    { $set: { status: "cancelled", finishedAt: new Date(), heartbeatAt: null } },
    { new: true }
  );
  if (!c) { res.status(409); throw new Error("Only a scheduled or sending campaign can be stopped."); }
  res.status(200).json(c);
});

//@desc   A new draft with the same audience and message
//@route  POST /api/campaigns/:id/duplicate
const duplicateCampaign = asyncHandler(async (req, res) => {
  const c = await Campaign.findById(req.params.id).lean();
  if (!c) { res.status(404); throw new Error("Campaign not found."); }
  const copy = await Campaign.create({
    name: `${c.name} (copy)`.slice(0, 120), audience: c.audience, channels: c.channels,
    kind: c.kind, trigger: c.trigger, status: c.kind === "automation" ? "paused" : "draft",
    title: c.title, message: c.message, link: c.link, couponCode: c.couponCode, createdBy: req.user._id,
  });
  res.status(201).json(copy);
});

//@desc   Delete a draft (or a cancelled one that sent nothing)
//@route  DELETE /api/campaigns/:id
const deleteCampaign = asyncHandler(async (req, res) => {
  const c = await Campaign.findById(req.params.id);
  if (!c) { res.status(404); throw new Error("Campaign not found."); }
  const unsent = c.kind === "automation" ? !(c.stats?.recipients > 0) : ["draft", "scheduled"].includes(c.status) || (c.status === "cancelled" && !c.startedAt);
  if (!unsent) {
    res.status(409);
    throw new Error("A campaign that sent messages is kept for its numbers.");
  }
  await c.deleteOne();
  res.status(200).json({ ok: true });
});

module.exports = {
  listCampaigns, getCampaign, createCampaign, updateCampaign, estimateCampaign,
  sendCampaign, cancelCampaign, duplicateCampaign, deleteCampaign, toggleAutomation,
};
