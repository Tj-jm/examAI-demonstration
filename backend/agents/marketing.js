const AgentRun = require("../models/agentRunModel");
const Campaign = require("../models/campaignModel");
const Batch = require("../models/batchModel");
const Lead = require("../models/leadModel");
const Submission = require("../models/submissionModel");
const AppSettings = require("../models/appSettingsModel");

// The marketing agent's weekly pass (jobs/agents.js, or "Run now"). Looks
// at who could be won now and proposes, for staff to approve in the inbox:
//   - a campaign to students whose trial ends this week, per batch
//   - a campaign to students whose access ran out recently, per batch
//   - a campaign to students who signed up but never bought
//   - a campaign to students who've gone quiet
//   - switching on an automation that would have caught these by itself
// Each message is written by AI from the facts (a plain template if AI
// isn't set up). The summary also points at new leads and recent results
// worth a poster. Nothing is sent without approval unless the mode says so.

const WEEK_MS = 6 * 86400000;
const MAX_STEPS = 8;

const DEFAULTS = { enabled: false, mode: "ask", minAudience: 5, channels: { app: true, sms: false, email: false } };

const TEMPLATES = {
  trialEnding: (b) => ({ title: "Your free trial ends soon", message: `{name}, your free trial${b ? ` of ${b}` : ""} ends this week. Pick a plan to keep your lectures, practice and progress.` }),
  expired: (b) => ({ title: "Pick up where you left off", message: `{name}, your access${b ? ` to ${b}` : ""} ended recently. Renew any time and carry on from where you stopped.` }),
  neverBought: () => ({ title: "Find your course", message: "{name}, thanks for signing up. Have a look at the courses open now; many start with a free trial." }),
  inactive: () => ({ title: "Ready for a quick practice?", message: "{name}, it's been a while. A 10-minute practice today gets you back on track." }),
};

const AUTOMATION_FOR = { trialEnding: "trialEnding", expired: "accessExpired", neverBought: "noPurchase", inactive: "inactive" };

// The text: AI over the facts, or the template.
const writeMessage = async ({ audience, batchName, prompt, sms, automation, owner }) => {
  try {
    const AiConfig = require("../models/aiConfigModel");
    if (!(await AiConfig.get()).features.writingHelp) throw new Error("off");
    const ai = require("../ai/service");
    const { writingTask } = require("../ai/writing");
    const { schema, system, prompt: p } = writingTask("campaign", {
      prompt, audience, batchName, sms, automation, siteName: (await AppSettings.get()).siteName, language: "en",
    });
    const { data } = await ai.generate({ feature: "agent-marketing", schema, system, prompt: p, maxTokens: 800, user: owner._id, wrapLatex: false });
    return data;
  } catch {
    return null;
  }
};

const sweep = async ({ force = false } = {}) => {
  const engine = require("./engine");
  const campaigns = require("../utils/campaigns");
  const s = await engine.settings();
  const raw = s.marketing?.toObject?.() || s.marketing || {};
  const cfg = { ...DEFAULTS, ...raw, channels: { ...DEFAULTS.channels, ...(raw.channels || {}) } };
  if (!s.enabled || !cfg.enabled) return { skipped: "off" };
  const settings = await AppSettings.get();
  if (settings.institution?.sales === false) return { skipped: "sales are off" };
  const owner = await engine.actingOwner();
  if (!owner) return { skipped: "no owner account" };
  // Once a week, unless run by hand.
  if (!force && await AgentRun.exists({ agent: "marketing", createdAt: { $gte: new Date(Date.now() - WEEK_MS) } })) return { skipped: "ran this week" };

  const since = new Date(Date.now() - WEEK_MS);
  // Not again what was sent, scheduled or proposed this week.
  const recent = await Campaign.find({ kind: "once", status: { $in: ["scheduled", "sending", "sent"] }, updatedAt: { $gte: since } }).select("audience").lean();
  const proposed = await AgentRun.find({ agent: "marketing", createdAt: { $gte: since } }).select("steps.args.audience").lean();
  const done = new Set([
    ...recent.map((c) => `${c.audience?.kind}:${c.audience?.batch || ""}`),
    ...proposed.flatMap((r) => r.steps.map((st) => `${st.args?.audience?.kind}:${st.args?.audience?.batch || ""}`)),
  ]);
  const active = new Set((await Campaign.find({ kind: "automation", status: "active" }).select("trigger.type").lean()).map((a) => a.trigger?.type));

  const batches = await Batch.find({ isActive: { $ne: false }, accessType: { $ne: "free" } }).select("name").lean();
  const ideas = []; // { audience, label, count, batchName }
  for (const b of batches) {
    for (const [kind, days, label] of [["trialEnding", 7, "Free trial ends this week"], ["expired", 14, "Access ran out in the last 2 weeks"]]) {
      const audience = { kind, batch: String(b._id), days };
      if (done.has(`${kind}:${b._id}`)) continue;
      const count = (await campaigns.audienceIds(audience)).length;
      if (count >= cfg.minAudience) ideas.push({ audience, label: `${label} · ${b.name}`, count, batchName: b.name });
    }
  }
  for (const [kind, days, label] of [["neverBought", 7, "Signed up, never bought"], ["inactive", 14, "No activity for 2 weeks"]]) {
    const audience = { kind, days };
    if (done.has(`${kind}:`)) continue;
    const count = (await campaigns.audienceIds(audience)).length;
    if (count >= cfg.minAudience) ideas.push({ audience, label, count, batchName: null });
  }
  ideas.sort((a, b) => b.count - a.count);

  const steps = [];
  const sms = Boolean(cfg.channels.sms);
  for (const idea of ideas.slice(0, MAX_STEPS - 2)) {
    const kind = idea.audience.kind;
    const written = await writeMessage({
      audience: kind, batchName: idea.batchName, sms, owner,
      prompt: `${idea.label}. ${idea.count} students. Encourage them to ${kind === "inactive" ? "come back and practise" : kind === "neverBought" ? "look at the courses and start a free trial" : "pick a plan"}. No discount unless staff add one.`,
    }) || TEMPLATES[kind](idea.batchName);
    steps.push({
      tool: "send_campaign",
      title: `Campaign: ${idea.label}`,
      args: {
        name: `${idea.label} (${new Date().toISOString().slice(0, 10)})`.slice(0, 120),
        audience: idea.audience,
        audienceLabel: idea.label,
        recipients: idea.count,
        channels: cfg.channels,
        title: written.title,
        message: written.message,
        link: idea.audience.batch ? `/purchases/${idea.audience.batch}` : kind === "inactive" ? "/" : "/purchases",
        couponCode: "",
      },
    });
  }

  // Automations that would catch these every week by themselves.
  const missing = [...new Set(ideas.map((i) => AUTOMATION_FOR[i.audience.kind]))].filter((t) => t && !active.has(t));
  if (active.size === 0 && !missing.includes("checkoutAbandoned")) missing.unshift("checkoutAbandoned");
  const { PRESETS } = require("../utils/automations");
  for (const preset of missing.slice(0, MAX_STEPS - steps.length)) {
    if (proposed.some((r) => r.steps.some((st) => st.args?.preset === preset))) continue;
    const p = PRESETS[preset];
    steps.push({
      tool: "start_automation",
      title: `Automation: ${p.name}`,
      args: {
        preset,
        reason: `Sends by itself to each student when it applies, so you don't have to do this by hand each week.`,
        channels: cfg.channels,
        title: p.title,
        message: p.message,
      },
    });
  }

  // Also worth knowing, nothing to approve.
  const [newLeads, recentExams] = await Promise.all([
    Lead.countDocuments({ status: "new" }),
    Submission.distinct("exam", { status: "graded", gradedAt: { $gte: since } }),
  ]);
  const notes = [];
  if (newLeads) notes.push(`${newLeads} lead${newLeads === 1 ? "" : "s"} from the interest form haven't been contacted yet (Leads).`);
  if (recentExams.length) notes.push(`${recentExams.length} exam${recentExams.length === 1 ? " was" : "s were"} graded this week; a top scorers poster could go on Facebook (Posters).`);

  if (!steps.length) {
    if (!notes.length) return { skipped: "nothing to propose" };
    const run = await engine.startPrepared({ agent: "marketing", user: owner, request: "Weekly marketing check", reply: `Nothing to send this week. ${notes.join(" ")}`, steps: [] });
    return { runs: [run?._id] };
  }
  const total = ideas.slice(0, MAX_STEPS - 2).reduce((n, i) => n + i.count, 0);
  const run = await engine.startPrepared({
    agent: "marketing",
    user: owner,
    request: "Weekly marketing check",
    reply: [
      steps.some((st) => st.tool === "send_campaign") ? `${steps.filter((st) => st.tool === "send_campaign").length} campaign${steps.filter((st) => st.tool === "send_campaign").length === 1 ? "" : "s"} to about ${total} students who could buy now. Edit the text if you like, then approve the ones to send.` : "",
      steps.some((st) => st.tool === "start_automation") ? "Switching on the suggested automations would catch these students every week by themselves." : "",
      ...notes,
    ].filter(Boolean).join(" "),
    steps,
  });
  return { runs: [run?._id] };
};

module.exports = { sweep };
