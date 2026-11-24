const { z } = require("zod");
const mongoose = require("mongoose");
const { call } = require("../invoke");
const { routeTool, findOne } = require("./routeTool");

// Copilot tools for the Marketing drawer: a campaign drafted, then sent
// (now or at a time); an automation switched on or off.

const id = z.string().refine((v) => mongoose.isValidObjectId(v), "not a valid id");
const isoDate = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "an ISO date");
const Campaign = () => require("../../models/campaignModel");
const handlers = () => require("../../controllers/admin/campaignController");
const when = (iso, tz) => { try { return new Date(iso).toLocaleString("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return iso; } };

const AUDIENCES = ["all", "batch", "neverBought", "trialEnding", "expired", "inactive"];
const AUDIENCE_TEXT = { all: "Every student", batch: "One batch", neverBought: "Never bought", trialEnding: "Trial ending", expired: "Access ended", inactive: "Inactive" };
const channelText = (c) => ["app", "sms", "email"].filter((k) => c?.[k]).map((k) => (k === "app" ? "In app" : k.toUpperCase())).join(" + ") || "In app";

const tools = {
  draft_campaign: {
    label: "Draft a campaign",
    drawer: "marketing",
    risk: "safe",
    // audience: who gets it; batchId with "batch"; days for inactive / trialEnding / expired.
    // {name} in message becomes each student's first name. link: a page in the student app.
    schema: z.object({
      name: z.string().min(2).max(120), audience: z.enum(AUDIENCES), batchId: id.optional(), days: z.number().int().min(1).max(365).optional(),
      title: z.string().min(2).max(120), message: z.string().min(2).max(1000), link: z.string().max(300).optional(), couponCode: z.string().max(40).optional(),
      sms: z.boolean().optional(), email: z.boolean().optional(),
    }),
    editable: ["title", "message"],
    batchesOf: (a) => (a.batchId ? [a.batchId] : []),
    describe: (a) => `${AUDIENCE_TEXT[a.audience]}${a.days ? ` (${a.days} days)` : ""} · ${channelText({ app: true, sms: a.sms, email: a.email })}\n“${a.title}” — ${a.message}${a.couponCode ? `\nCode: ${a.couponCode}` : ""}`,
    async run(a, ctx) {
      if (!["owner", "admin"].includes(ctx.user.role)) throw Object.assign(new Error("Only owner or admin can do this."), { statusCode: 403 });
      if (a.batchId) await ctx.assertBatches([a.batchId]);
      const c = await call(handlers().createCampaign, {
        user: ctx.user,
        body: {
          kind: "once", name: a.name, title: a.title, message: a.message, link: a.link || "/purchases", couponCode: a.couponCode || "",
          audience: { kind: a.audience, batch: a.batchId || null, days: a.days }, channels: { app: true, sms: Boolean(a.sms), email: Boolean(a.email) },
        },
      });
      return { campaignId: String(c._id), summary: `Draft “${a.name}” is ready.`, link: "/campaigns" };
    },
  },

  send_campaign: routeTool({
    label: "Send a campaign",
    drawer: "marketing",
    risk: "publish",
    roles: ["owner", "admin"],
    // campaign: "step:N" (drafted earlier in this plan) or a draft's name. at: send then; left out: now.
    schema: z.object({ campaign: z.string().min(2).max(120), at: isoDate.optional() }),
    async load(a, ctx) {
      let c;
      if (/^step:\d+$/.test(a.campaign)) {
        try { c = await Campaign().findById(ctx.resolve(a.campaign, "campaignId")).lean(); } catch { c = null; }
        if (!c) return { id: a.campaign, name: "the drafted campaign", link: "/campaigns", before: { status: "Draft" }, pendingStep: true };
      } else {
        c = await findOne(Campaign(), a.campaign, { base: { kind: "once", status: { $in: ["draft", "scheduled"] } }, select: "name status audience", what: "draft campaign" });
      }
      return { campaign: c, id: c._id, name: c.name, link: "/campaigns", before: { status: c.status === "scheduled" ? "Scheduled" : "Draft" } };
    },
    after: (a, ctx) => ({ status: a.at ? `Sends ${when(a.at, "UTC")} UTC` : "Sends now" }),
    labels: { status: "Status" },
    apply: (a, ctx, { campaign }) => call(handlers().sendCampaign, { user: ctx.user, params: { id: String(campaign._id) }, body: a.at ? { at: a.at } : {} }),
    summary: (a, { campaign }) => (a.at ? `“${campaign.name}” is scheduled.` : `“${campaign.name}” is sending.`),
  }),

  switch_automation: routeTool({
    label: "Switch an automation on or off",
    drawer: "marketing",
    risk: "publish",
    roles: ["owner", "admin"],
    // automation: its name, or a preset key (trialEnding, checkoutAbandoned, accessExpiring, accessExpired, inactive, noPurchase).
    schema: z.object({ automation: z.string().min(2).max(120), on: z.boolean() }),
    async load(a) {
      const { PRESETS } = require("../../utils/automations");
      const preset = PRESETS[a.automation];
      const c = preset
        ? await Campaign().findOne({ kind: "automation", "trigger.type": preset.trigger.type }).sort({ createdAt: 1 }).lean()
        : await findOne(Campaign(), a.automation, { base: { kind: "automation" }, select: "name status trigger", what: "automation" });
      return { campaign: c, preset: c ? null : a.automation, id: c?._id || `preset:${a.automation}`, name: c?.name || preset?.name, link: "/campaigns", before: { on: c ? c.status === "active" : "Not set up" } };
    },
    after: (a) => ({ on: a.on }),
    labels: { on: "On" },
    async apply(a, ctx, { campaign, preset }) {
      let c = campaign;
      if (!c) {
        if (!a.on) return null;
        c = await call(handlers().createCampaign, { user: ctx.user, body: { kind: "automation", preset } });
      }
      return call(handlers().toggleAutomation, { user: ctx.user, params: { id: String(c._id) }, body: { on: a.on } });
    },
    summary: (a, { name }) => `“${name}” is ${a.on ? "on" : "off"}.`,
  }),
};

module.exports = { tools };
