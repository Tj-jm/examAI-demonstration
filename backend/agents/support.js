const { z } = require("zod");
const AgentRun = require("../models/agentRunModel");
const guide = require("./supportGuide");
const Batch = require("../models/batchModel");

// The support agent's pass (jobs/agents.js): drafts an answer to each
// escalated doubt on batches that allow it, and a reply to each new support
// ticket the admin's policy text covers. Staff edit and approve each one in
// the inbox; tickets the policy doesn't cover are listed for a person.
const MAX = 15;

const ticketSchema = z.object({
  needsPerson: z.boolean(),
  reason: z.string().max(300).optional(),
  reply: z.string().max(5000).optional(),
  resolve: z.boolean().optional(),
  // When a person is needed: a line staff could add to the policy so the
  // next ticket like it gets answered (empty when it truly needs a person).
  policyHint: z.string().max(300).optional(),
});

// Answers what POLICY or the app guide covers or clearly implies, in its
// own words; staff approve every draft, so it errs towards drafting. Only
// decisions, money, account changes and investigations go to a person.
const ticketPrompt = ({ siteName, knowledge, ticket }) => ({
  system: [
    `You draft replies for ${siteName}'s support team. Staff read and approve every draft before it is sent.`,
    "Answer from POLICY (the institution's own rules, which win on any conflict) and APP GUIDE (how the app works). Use what they state or clearly imply, in your own words; the student's wording won't match theirs, so match on meaning. Practical how-to steps from the guide are always fine.",
    "Never promise or grant refunds, payments, extensions, extra attempts, grade changes or account changes, and never invent rules, prices or dates.",
    "Set needsPerson to true (with a short reason, no reply) only when the answer needs one of those decisions, an investigation of this student's own account, payment or results, or facts neither text gives. Then, if a rule written into POLICY would have let you answer, put that rule as one short line in policyHint.",
    "Write warmly and briefly, in the student's language. Return JSON only.",
  ].join(" "),
  prompt: `POLICY:\n${knowledge || "(none)"}\n\nAPP GUIDE:\n${guide}\n\nTICKET (${ticket.category}): ${ticket.subject}\n${ticket.messages.map((m) => `${m.from === "staff" ? "Staff" : "Student"}: ${m.text}`).join("\n")}\n\nReturn { "needsPerson": false, "reply": "...", "resolve": false } or { "needsPerson": true, "reason": "...", "policyHint": "..." }. Set resolve true only when the reply fully settles the question.`,
});

// force ("Run now"): look again at what was already checked and left for
// a person, e.g. after the policy text was changed.
const sweep = async ({ force = false } = {}) => {
  const engine = require("./engine");
  const ai = require("../ai/service");
  const s = await engine.settings();
  const cfg = s.support || {};
  if (!s.enabled || !cfg.enabled) return { skipped: "off" };
  const owner = await engine.actingOwner();
  if (!owner) return { skipped: "no owner account" };

  const open = await AgentRun.find({ agent: "support", status: { $in: ["awaiting", "running"] } }).select("steps").lean();
  const busy = new Set(open.flatMap((r) => r.steps.filter((st) => ["pending", "approved", "running"].includes(st.status)).map((st) => String(st.args?.doubtId || st.args?.ticketId))));
  const steps = [];
  const forPeople = [];
  const notes = [];
  const found = { doubts: 0, tickets: 0 };
  let drafted = 0;
  // Seen before and nothing new since: not sent to the AI again.
  const fresh = (doc, since) => force || !doc.agentCheckedAt || doc.agentCheckedAt < since;

  if (cfg.doubts !== false) {
    const Doubt = require("../models/doubtModel");
    const { solveDoubt } = require("../ai/prompts");
    const { doubtSolution } = require("../ai/schemas");
    const { toAbsoluteUrl } = require("../utils/mediaUrl");
    const batches = await Batch.find({ "features.agentSupport": true }).select("_id").lean();
    if (!batches.length) notes.push("Doubts: no batch allows the support agent yet (Batch → What is included → Support agent)");
    const doubts = batches.length
      ? await Doubt.find({ status: "escalated", batch: { $in: batches.map((b) => b._id) } }).sort({ escalatedAt: 1, createdAt: 1 }).limit(MAX * 2).populate("student", "name")
      : [];
    found.doubts = doubts.length;
    for (const d of doubts) {
      if (steps.length >= MAX || busy.has(String(d._id)) || !fresh(d, d.escalatedAt || d.createdAt)) continue;
      await Doubt.updateOne({ _id: d._id }, { $set: { agentCheckedAt: new Date() } });
      try {
        const host = { protocol: (process.env.PUBLIC_URL || "http://localhost").split("://")[0], get: () => (process.env.PUBLIC_URL || "http://localhost:5000").split("://")[1]?.split("/")[0] };
        const { data } = await ai.generate({
          feature: "agent-support", schema: doubtSolution, user: owner._id, batch: d.batch,
          imageUrl: d.questionImage ? toAbsoluteUrl(host, d.questionImage) : undefined,
          ...solveDoubt({ question: d.question || "(see the attached image)", topicTitle: undefined, regenerate: true }),
        });
        if (data.abusive) { forPeople.push(`a doubt from ${d.student?.name || "a student"} looks abusive`); continue; }
        drafted += 1;
        steps.push({
          tool: "answer_doubt",
          title: `Answer ${d.student?.name || "a student"}'s doubt`,
          args: { doubtId: String(d._id), batchId: String(d.batch), studentName: d.student?.name || "A student", question: d.question || "(image)", answer: data.answer },
        });
      } catch {
        forPeople.push(`couldn't draft an answer for ${d.student?.name || "a student"}'s doubt`);
      }
    }
  }

  if (cfg.tickets !== false) {
    const Ticket = require("../models/supportTicketModel");
    const AppSettings = require("../models/appSettingsModel");
    const siteName = (await AppSettings.get()).siteName || "ExamAI";
    // Open = waiting on staff (a staff reply makes it "waiting" on the student).
    const tickets = (await Ticket.find({ status: "open" }).sort({ lastActivityAt: 1 }).limit(MAX * 2).populate("student", "name"))
      .filter((t) => t.messages.at(-1)?.from === "student");
    found.tickets = tickets.length;
    // The app guide covers how-to questions, so an empty policy no longer
    // stops it; the policy adds the institution's own rules.
    for (const t of tickets) {
      if (steps.length >= MAX || busy.has(String(t._id)) || !fresh(t, t.lastActivityAt)) continue;
      await Ticket.updateOne({ _id: t._id }, { $set: { agentCheckedAt: new Date() } });
      try {
        const { data } = await ai.generate({ feature: "agent-support", schema: ticketSchema, user: owner._id, maxTokens: 1200, ...ticketPrompt({ siteName, knowledge: cfg.knowledge, ticket: t }) });
        if (data.needsPerson || !data.reply) {
          const hint = data.policyHint?.trim();
          forPeople.push(`“${t.subject}” (${t.student?.name || "a student"}): ${data.reason || "needs a person"}${hint ? ` (to answer these yourself, add to the policy: “${hint}”)` : ""}`);
          continue;
        }
        drafted += 1;
        steps.push({
          tool: "reply_ticket",
          title: `Reply to ${t.student?.name || "a student"}`,
          args: { ticketId: String(t._id), studentName: t.student?.name || "A student", subject: t.subject, reply: data.reply, resolve: Boolean(data.resolve) },
        });
      } catch {
        forPeople.push(`couldn't draft a reply to “${t.subject}”`);
      }
    }
  }

  if (cfg.tickets === false) notes.push("Support tickets are switched off for the agent");
  if (cfg.doubts === false) notes.push("Doubts are switched off for the agent");
  if (!steps.length) return { drafted: 0, forPeople, notes, found, run: null };
  const run = await engine.startPrepared({
    agent: "support",
    user: owner,
    request: "Support drafts",
    reply: `Drafted ${drafted} answer${drafted === 1 ? "" : "s"}. Read and edit each one before sending.${forPeople.length ? ` Left for a person: ${forPeople.slice(0, 5).join("; ")}${forPeople.length > 5 ? ` and ${forPeople.length - 5} more` : ""}.` : ""}`,
    steps,
  });
  return { drafted, forPeople, notes, found, run: run?._id };
};

module.exports = { sweep };
