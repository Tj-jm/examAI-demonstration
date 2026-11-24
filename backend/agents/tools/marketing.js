const { z } = require("zod");
const mongoose = require("mongoose");

// The marketing agent's actions (agents/marketing.js): send a campaign it
// proposed, or switch on an automation. Staff can edit the text in the
// inbox before approving.
const id = z.string().refine((v) => mongoose.isValidObjectId(v), "not a valid id");
const AUDIENCES = ["all", "batch", "neverBought", "trialEnding", "expired", "inactive"];
const TRIGGERS = ["trialEnding", "checkoutAbandoned", "accessExpiring", "accessExpired", "inactive", "noPurchase"];

const channels = z.object({ app: z.boolean(), sms: z.boolean(), email: z.boolean() });

const tools = {
  send_campaign: {
    label: "Send a campaign",
    risk: "publish",
    editable: ["message"],
    schema: z.object({
      name: z.string().min(1).max(120),
      audience: z.object({ kind: z.enum(AUDIENCES), batch: id.nullable().optional(), days: z.number().int().min(1).max(365).optional() }),
      audienceLabel: z.string().max(200),
      recipients: z.number().int().min(0),
      channels,
      title: z.string().min(1).max(120),
      message: z.string().min(1).max(1000),
      link: z.string().max(300),
      couponCode: z.string().max(40).optional().default(""),
    }),
    batchesOf: () => [],
    describe: (a) => `${a.audienceLabel}: about ${a.recipients} student${a.recipients === 1 ? "" : "s"} · ${["app", "sms", "email"].filter((k) => a.channels[k]).join(", ")}`,
    async run(a, ctx) {
      const Campaign = require("../../models/campaignModel");
      const campaigns = require("../../utils/campaigns");
      if (!a.channels.app && !a.channels.sms && !a.channels.email) throw new Error("Pick at least one way to send it.");
      const c = await Campaign.create({
        name: a.name,
        kind: "once",
        audience: { kind: a.audience.kind, batch: a.audience.batch || null, days: a.audience.days || 7 },
        channels: a.channels,
        title: a.title,
        message: a.message,
        link: a.link || "/purchases",
        couponCode: (a.couponCode || "").toUpperCase(),
        createdBy: ctx?.user?._id,
      });
      await campaigns.start(c._id);
      return { summary: `Sending "${a.name}" now.`, campaignId: String(c._id), link: `/campaigns/${c._id}` };
    },
  },
  start_automation: {
    label: "Switch on an automation",
    risk: "publish",
    editable: ["message"],
    schema: z.object({
      preset: z.enum(TRIGGERS),
      reason: z.string().max(300),
      channels,
      title: z.string().min(1).max(120),
      message: z.string().min(1).max(1000),
    }),
    batchesOf: () => [],
    describe: (a) => a.reason,
    async run(a, ctx) {
      const Campaign = require("../../models/campaignModel");
      const { PRESETS } = require("../../utils/automations");
      const preset = PRESETS[a.preset];
      // Already one running for this trigger: nothing to add.
      if (await Campaign.exists({ kind: "automation", status: "active", "trigger.type": a.preset })) {
        return { summary: `A "${preset.name}" automation is already on.` };
      }
      const c = await Campaign.create({
        kind: "automation",
        name: preset.name,
        trigger: preset.trigger,
        channels: a.channels,
        title: a.title,
        message: a.message,
        link: preset.link,
        status: "active",
        createdBy: ctx?.user?._id,
      });
      return { summary: `"${preset.name}" is on. It checks every hour.`, campaignId: String(c._id), link: `/automations/${c._id}` };
    },
  },
};

module.exports = { tools };
