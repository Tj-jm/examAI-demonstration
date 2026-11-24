const { z } = require("zod");
const AgentRun = require("../models/agentRunModel");
const AiConfig = require("../models/aiConfigModel");
const Batch = require("../models/batchModel");
const { tools: COPILOT_TOOLS } = require("./tools/copilot");
const { tools: STUDENT_TOOLS } = require("./tools/students");
const { tools: PAYMENT_TOOLS } = require("./tools/payments");
const { tools: CAMPAIGN_TOOLS } = require("./tools/marketing.copilot");
const { tools: SETTINGS_TOOLS } = require("./tools/settings.copilot");
const { tools: OPS_TOOLS } = require("./tools/ops.copilot");
const { tools: GRADING_TOOLS } = require("./tools/grading");
const { tools: AFTER_CLASS_TOOLS } = require("./tools/afterClass");
const { tools: AT_RISK_TOOLS } = require("./tools/atRisk");
const { tools: SUPPORT_TOOLS } = require("./tools/support");
const { tools: ASSIGNMENT_TOOLS } = require("./tools/assignment");
const { tools: MARKETING_TOOLS } = require("./tools/marketing");

// The agent engine. A request becomes a plan (a short list of steps, each
// one of the agent's tools with its arguments); each step runs when the
// approval mode allows it or once a person approves it. Planning and
// running happen in the background; the admin page polls the run.

// Background agents (scheduled) have no chat: they prepare their own plan
// and act as the owner, within the batches that allow them.
const AGENTS = {
  copilot: { label: "Admin copilot", tools: { ...COPILOT_TOOLS, ...STUDENT_TOOLS, ...PAYMENT_TOOLS, ...CAMPAIGN_TOOLS, ...SETTINGS_TOOLS, ...OPS_TOOLS }, batchFeature: "agentCopilot" },
  grading: { label: "Grading agent", tools: GRADING_TOOLS, batchFeature: "agentGrading", background: true },
  afterClass: { label: "After-class agent", tools: AFTER_CLASS_TOOLS, batchFeature: "agentAfterClass", background: true },
  atRisk: { label: "At-risk students", tools: AT_RISK_TOOLS, batchFeature: "agentAtRisk", background: true },
  support: { label: "Support agent", tools: SUPPORT_TOOLS, batchFeature: "agentSupport", background: true },
  assignment: { label: "Assignment agent", tools: ASSIGNMENT_TOOLS, batchFeature: "agentAssignments", background: true },
  // Not per batch: proposes campaigns across the whole platform.
  marketing: { label: "Marketing agent", tools: MARKETING_TOOLS, batchFeature: null, background: true },
};

const planSchema = z.object({
  reply: z.string().min(1).max(1200),
  needsInfo: z.boolean().optional(),
  steps: z.array(z.object({
    tool: z.string(),
    title: z.string().max(160),
    // Arguments as a JSON object in a string: works the same with every AI
    // provider, and each tool checks them with its own schema.
    args: z.string().max(6000),
  })).max(12),
});

// Settings and permissions -------------------------------------------------

const settings = async () => (await AiConfig.get()).agents || {};

// Why this person can't use this agent right now, or null.
const blockedFor = async (user, agent = "copilot") => {
  const s = await settings();
  if (!s.enabled) return "Agents are switched off. Turn them on in Settings → AI → Agents.";
  if (!s[agent]?.enabled) return `The ${AGENTS[agent].label.toLowerCase()} is switched off in Settings → AI → Agents.`;
  // Only owner and admin, whatever the setting says: other roles can't
  // create exams or notices themselves (middleware/representativeGate.js).
  if (!["owner", "admin"].includes(user.role) || !(s[agent].roles || ["owner", "admin"]).includes(user.role)) {
    return "Your role can't use the copilot. An owner can allow admins in Settings → AI → Agents.";
  }
  if (agent === "copilot" && s.dailyRunsPerUser > 0) {
    const since = new Date(); since.setHours(0, 0, 0, 0);
    const n = await AgentRun.countDocuments({ user: user._id, agent, createdAt: { $gte: since } })
      + (await AgentRun.find({ user: user._id, agent, retries: { $gte: since } }).select("retries").lean())
        .reduce((sum, r) => sum + r.retries.filter((d) => d >= since).length, 0);
    if (n >= s.dailyRunsPerUser) return `You've reached today's limit of ${s.dailyRunsPerUser} requests.`;
  }
  return null;
};

// The batches this person's agent may act on: the agent switched on for
// the batch, and for a teacher, only batches they teach.
const allowedBatches = async (user, agent = "copilot") => {
  if (!AGENTS[agent].batchFeature) return [];
  const q = { [`features.${AGENTS[agent].batchFeature}`]: true, isActive: { $ne: false } };
  if (user?.role === "teacher") q.teachers = user._id;
  return Batch.find(q).select("name program subjects graders teachers").populate("program", "title").lean();
};

// Context handed to tools: names for descriptions, step results, checks.
const buildCtx = async (run, user) => {
  const Subject = require("../models/subjectModel");
  const Chapter = require("../models/chapterModel");
  const batches = await allowedBatches(user, run.agent);
  const batchMap = new Map(batches.map((b) => [String(b._id), b]));
  const allBatchNames = new Map((await Batch.find({}).select("name").lean()).map((b) => [String(b._id), b.name]));
  const subjects = new Map((await Subject.find({}).select("title").lean()).map((s) => [String(s._id), s.title]));
  const chapters = new Map((await Chapter.find({}).select("title").lean()).map((c) => [String(c._id), c.title]));
  return {
    user,
    timezone: run.timezone || "UTC",
    batchName: (bid) => allBatchNames.get(String(bid)) || "unknown batch",
    subjectName: (sid) => subjects.get(String(sid)) || "a subject",
    chapterName: (cid) => chapters.get(String(cid)) || "a chapter",
    resolve(ref, key) {
      const m = /^step:(\d+)$/.exec(String(ref));
      if (!m) return String(ref);
      const prior = run.steps[Number(m[1]) - 1];
      if (!prior || prior.status !== "done" || !prior.result?.[key]) throw new Error(`Step ${m[1]} hasn't produced that yet.`);
      return prior.result[key];
    },
    canAct: (bid) => batchMap.has(String(bid)),
    async assertBatches(ids) {
      for (const b of ids || []) {
        if (!batchMap.has(String(b))) {
          throw Object.assign(new Error(`The copilot isn't allowed to act on ${allBatchNames.get(String(b)) || "that batch"}. Switch it on for the batch (Batch → Features), and teachers can only act on batches they teach.`), { statusCode: 403 });
        }
      }
    },
  };
};

// Planning -------------------------------------------------------------------

const offsetOf = (tz) => {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName");
    return (part?.value || "GMT").replace("GMT", "") || "+00:00";
  } catch {
    return "+00:00";
  }
};

// What the model knows about this platform: the batches it may act on and
// the syllabus with how many questions the bank has.
const describeWorld = async (user, agent) => {
  const { Question } = require("../models/questionModel");
  const Subject = require("../models/subjectModel");
  const Chapter = require("../models/chapterModel");
  const batches = await allowedBatches(user, agent);
  const subjectIds = [...new Set(batches.flatMap((b) => (b.subjects || []).map(String)))];
  const subjects = await Subject.find(subjectIds.length ? { _id: { $in: subjectIds } } : {}).select("title").sort({ order: 1, title: 1 }).limit(40).lean();
  const chapters = await Chapter.find({ subject: { $in: subjects.map((s) => s._id) } }).select("title subject").sort({ order: 1, title: 1 }).limit(400).lean();
  const counts = await Question.aggregate([
    { $match: { status: "published", chapter: { $in: chapters.map((c) => c._id) } } },
    { $group: { _id: { chapter: "$chapter", type: "$type" }, n: { $sum: 1 } } },
  ]);
  const byChapter = {};
  for (const c of counts) {
    const k = String(c._id.chapter);
    byChapter[k] = byChapter[k] || {};
    byChapter[k][c._id.type] = c.n;
  }
  const subjectTitle = new Map(subjects.map((s) => [String(s._id), s.title]));
  const lines = [];
  lines.push("BATCHES YOU MAY ACT ON (id | name | program | subjects):");
  if (!batches.length) lines.push("(none — the copilot is not switched on for any batch this person can manage)");
  for (const b of batches) {
    const subs = (b.subjects || []).map((x) => subjectTitle.get(String(x))).filter(Boolean).join(", ") || "-";
    lines.push(`${b._id} | ${b.name} | ${b.program?.title || "-"} | ${subs}`);
  }
  // Batches it may NOT act on, by name only, so it can explain instead of
  // asking for an id.
  const allowedIds = new Set(batches.map((b) => String(b._id)));
  const blockedQ = { isActive: { $ne: false } };
  if (user?.role === "teacher") blockedQ.teachers = user._id;
  const blocked = (await Batch.find(blockedQ).select("name").lean()).filter((b) => !allowedIds.has(String(b._id)));
  if (blocked.length) {
    lines.push("", "OTHER BATCHES (the copilot is NOT switched on for these; you cannot act on them):");
    lines.push(blocked.map((b) => b.name).join(" | "));
  }
  // So a notice's button can open a live class or exam.
  if (agent === "copilot" && batches.length) {
    const LiveClass = require("../models/liveClassModel");
    const Exam = require("../models/examModel");
    const ids = batches.map((b) => b._id);
    const name = new Map(batches.map((b) => [String(b._id), b.name]));
    const live = await LiveClass.find({ batch: { $in: ids }, scheduledAt: { $gte: new Date(Date.now() - 6 * 3600000), $lte: new Date(Date.now() + 30 * 86400000) } })
      .select("title batch scheduledAt").sort({ scheduledAt: 1 }).limit(40).lean();
    if (live.length) {
      lines.push("", "UPCOMING LIVE CLASSES (id | title | batch id | batch | starts UTC):");
      for (const l of live) lines.push(`${l._id} | ${l.title} | ${l.batch} | ${name.get(String(l.batch)) || "-"} | ${new Date(l.scheduledAt).toISOString()}`);
    }
    const exams = await Exam.find({ batches: { $in: ids }, createdByStudent: null })
      .select("title mode batches opensAt closesAt liveHours isPublished isActive createdAt").sort({ createdAt: -1 }).limit(60).lean();
    if (exams.length) {
      lines.push("", "EXAMS (id | title | mode | state | batch ids):");
      for (const e of exams) {
        const state = [e.isPublished ? "published" : "draft", e.isActive ? "on" : "off", e.opensAt ? `opens ${new Date(e.opensAt).toISOString()}` : "", e.closesAt ? `closes ${new Date(e.closesAt).toISOString()}` : "", e.liveHours ? `${e.liveHours}h window` : ""].filter(Boolean).join(", ");
        lines.push(`${e._id} | ${e.title} | ${e.mode} | ${state} | ${(e.batches || []).map(String).filter((b) => name.has(b)).join(", ")}`);
      }
    }
  }
  // Grading that needs an admin (owners and admins only): scripts stuck
  // part-marked, and who could take them over.
  if (agent === "copilot" && ["owner", "admin"].includes(user?.role) && batches.length) {
    const Submission = require("../models/submissionModel");
    const flow = require("../utils/gradingFlow");
    const g = await flow.gradingSettings();
    const stuckIds = await flow.idsWhere({ status: "grading", batch: { $in: batches.map((b) => b._id) } }, (x) => flow.isStuck(x, g.stuckHours));
    const stuck = await Submission.find({ _id: { $in: stuckIds } })
      .select("batch exam heldBy progressAt answers.gradedAt answers.questionType answers.marksAwarded")
      .populate("exam", "title").populate("heldBy", "name identifier").limit(30).lean();
    lines.push("", `GRADING STUCK: scripts part-marked with no progress for ${g.stuckHours}h+ (submissionId | batch | exam | marked/written | held by | last progress). Tell the admin about these when relevant; reopen_script hands one back:`);
    if (!stuck.length) lines.push("(none)");
    for (const x of stuck) {
      const w = x.answers.filter((a) => a.questionType === "written");
      const done = w.filter((a) => a.marksAwarded !== null && a.marksAwarded !== undefined).length;
      const last = flow.lastProgress(x);
      lines.push(`${x._id} | ${batches.find((b) => String(b._id) === String(x.batch))?.name || x.batch} | ${x.exam?.title || "-"} | ${done}/${w.length} | ${x.heldBy ? x.heldBy.identifier || x.heldBy.name : "-"} | ${last ? last.toISOString().slice(0, 16) : "-"}`);
    }
    const User = require("../models/userModel");
    const staffIds = [...new Set(batches.flatMap((b) => [...(b.graders || []), ...(b.teachers || [])].map(String)))];
    const staff = await User.find({ _id: { $in: staffIds }, isActive: { $ne: false }, isDeleted: { $ne: true } }).select("name identifier role").lean();
    lines.push("", "GRADING STAFF per batch (batchId | userId name role, …):");
    for (const b of batches) {
      const ids = new Set([...(b.graders || []), ...(b.teachers || [])].map(String));
      const list = staff.filter((u) => ids.has(String(u._id))).map((u) => `${u._id} ${u.identifier || u.name} ${u.role}`);
      if (list.length) lines.push(`${b._id} | ${list.join(", ")}`);
    }
  }
  // What each batch can actually use: questions assigned to it (the batch's
  // Content tab), whatever subject they're filed under.
  const perBatch = await Question.aggregate([
    { $match: { status: "published", ...Question.IN_BANK, batches: { $in: batches.map((b) => b._id) } } },
    { $unwind: "$batches" },
    { $match: { batches: { $in: batches.map((b) => b._id) } } },
    { $group: { _id: { batch: "$batches", type: "$type" }, n: { $sum: 1 } } },
  ]);
  lines.push("", "QUESTIONS ASSIGNED TO EACH BATCH (batchId | published, by type; passage = a passage with multiple-choice and/or written questions under it):");
  for (const b of batches) {
    const mine = perBatch.filter((r) => String(r._id.batch) === String(b._id)).map((r) => `${r._id.type}:${r.n}`).join(" ");
    lines.push(`${b._id} | ${mine || "none assigned"}`);
  }
  lines.push("", "SYLLABUS (subject → chapters, with published questions in the bank by type):");
  for (const s of subjects) {
    lines.push(`SUBJECT ${s._id} | ${s.title}`);
    for (const c of chapters.filter((x) => String(x.subject) === String(s._id))) {
      const n = byChapter[String(c._id)] || {};
      const bank = Object.entries(n).map(([t, v]) => `${t}:${v}`).join(" ") || "no questions";
      lines.push(`  CHAPTER ${c._id} | ${c.title} | ${bank}`);
    }
  }
  return lines.join("\n");
};

// The copilot's tools by area. A request with many tools to choose from
// first picks its drawers (pickDrawers), then plans with only those.
const DRAWERS = { exams: "Exams", notices: "Notices", classes: "Live classes and schedule", grading: "Grading and conduct", questions: "Question bank", students: "Students", payments: "Payments and coupons", marketing: "Marketing", settings: "Settings", lectures: "Lectures", batches: "Batches and pricing", payroll: "Payroll" };
const PICK_ABOVE = 40;

const toolLine = ([name, t]) => {
      const shape = Object.entries(t.schema.shape)
        .filter(([k]) => !(t.internal || []).includes(k))
        .map(([k, v]) => `${k}${v.isOptional() ? "?" : ""}`)
        .join(", ");
      return `- ${name} (${t.label}; ${t.risk === "publish" ? "students see it" : t.risk === "staff" ? "changes staff work" : "draft only"}): args { ${shape} }`;
};

const toolCatalogue = (agent, drawers = null) => {
  const entries = Object.entries(AGENTS[agent].tools).filter(([, t]) => !drawers || !t.drawer || drawers.includes(t.drawer));
  const groups = new Map();
  for (const e of entries) {
    const key = e[1].drawer || "other";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  if (groups.size === 1) return entries.map(toolLine).join("\n");
  return [...groups].map(([k, list]) => `[${DRAWERS[k] || "Other"}]\n${list.map(toolLine).join("\n")}`).join("\n");
};

// The drawers a request needs: all of them while the tools are few; past
// PICK_ABOVE, one short AI call chooses (falls back to all on any failure).
const pickDrawers = async (run, user) => {
  const tools = Object.values(AGENTS[run.agent].tools);
  if (tools.length <= PICK_ABOVE) return null;
  const present = [...new Set(tools.map((t) => t.drawer).filter(Boolean))];
  try {
    const ai = require("../ai/service");
    const { data } = await ai.generate({
      feature: `agent-${run.agent}`, user: user._id, maxTokens: 200,
      schema: z.object({ drawers: z.array(z.string()).max(present.length) }),
      system: "Pick the areas of an admin panel a staff instruction needs. Return JSON only.",
      prompt: `AREAS: ${present.map((d) => `${d} (${DRAWERS[d] || d})`).join(", ")}\n\nINSTRUCTION:\n${run.request}\n\nReturn { "drawers": ["area", ...] } using area keys.`,
    });
    const picked = data.drawers.filter((d) => present.includes(d));
    return picked.length ? picked : null;
  } catch {
    return null;
  }
};

// The next 14 days, so "Friday" or "next Sunday" never needs asking.
const calendar = (tz) => {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, weekday: "long", year: "numeric", month: "2-digit", day: "2-digit" });
  const days = [];
  for (let i = 0; i < 14; i += 1) {
    const p = Object.fromEntries(fmt.formatToParts(new Date(Date.now() + i * 86400000)).map((x) => [x.type, x.value]));
    days.push(`${p.weekday} ${p.year}-${p.month}-${p.day}${i === 0 ? " (today)" : ""}`);
  }
  return days.join("\n");
};

const planPrompt = ({ request, world, catalogue, now, offset, timezone, errors, history, days, done }) => ({
  system: [
    "You are the admin copilot of ExamAI, a platform coaching centres use to run exams, lectures and classes.",
    "You turn a staff member's instruction into a short plan of tool calls. You never invent ids: use only ids listed in the context.",
    "If the instruction is missing something you need and can't reasonably assume (for example which batch, when there are several), set needsInfo to true, ask one short question in reply, and return no steps.",
    "When the INSTRUCTION ends with lines starting \"Then:\", those are follow-ups in a chat: keep your earlier plan and change only what they ask.",
    "Under EARLIER TRIES the staff member has edited the request to answer you. Read the new INSTRUCTION fresh: never repeat an earlier answer word for word. If it still lacks something, ask for that exact thing differently, or assume a sensible default and go ahead.",
    "Name a student in the student field exactly as the staff member did (name, email, phone or student ID): the server finds them. Never ask the person for ids: match batches, subjects and chapters by name (ignore case, spaces and dashes; \"Math-1\", \"math 1\" and \"MATH1\" are the same).",
    "If the batch they name is under OTHER BATCHES, set needsInfo to true and reply that the copilot isn't switched on for that batch: turn on \"Admin copilot\" in that batch's Access & pricing → What is included.",
    "If they name a batch that appears nowhere, say you can't find it and list the batch names you can act on.",
    "You can only do what the tools in the catalogue do: create an exam, add questions to it, write its description, publish it, close or unpublish it (now or at a time), post a notice (with a cover picture, a button linking to a page or a web address, and how long it stays up), schedule a live class, move the classes and exams in a time span, copy a week's exams, classes and notices to a later week, assign bank questions to batches, hand out waiting scripts to graders, write new questions with AI for a chapter, warn students with many conduct flags, and for one student: give access to a batch (for some days or for life), change their name, email, phone, student ID or whether they can sign in, and set a new password; record a payment a student made by hand for one of a batch's plans (named as on the batch); make a coupon, and switch a coupon on or off or change its discount, uses or expiry; draft a campaign (in-app, SMS, email) to an audience, send it now or at a time, and switch an automation on or off; change the site name and how the student app looks (home screen, batch page, page position, sign-in page, notices, course list, lecture list styles); publish or hide lectures (by title); add lectures or exams (by title) to batches or take them out and change a lecture's title or description; change a batch's name, whether it's open, free or paid, and its trial days; add or change a batch's price plan; make a payslip for a team member from their work in a period (draft or issued) and mark their latest payslip paid. If the whole request is something else (editing lectures, batches, coupons, payments, settings and so on), set needsInfo to true, return no steps, and reply that you can't do that yet, listing those things. If only part of it is outside them, plan the parts you can and say in reply what you left out.",
    "Dates: a weekday on its own (\"Friday\", \"next Sunday\") means the next one after now, using the calendar below; never ask which date it is. Only ask about a date when the instruction gives none and one is required.",
    "Fill sensible defaults rather than asking: a title made from the instruction (e.g. \"Math-1 mock test\"), a duration that fits the mode.",
    "Only publish, post notices or schedule classes when the instruction asks for students to see or be told something.",
    "Reply in the language the staff member wrote in. Return JSON only.",
  ].join(" "),
  prompt: `Now: ${now} (${timezone}, UTC${offset}). Write every date as ISO 8601 with that offset, e.g. 2026-10-09T20:00:00${offset}.

CALENDAR:
${days}

TOOLS:
${catalogue}

Notes on tools:
- create_exam returns an examId. Later steps refer to it as "step:N" (N = that step's number, starting at 1), e.g. add_questions { "exam": "step:1", ... }.
- add_questions picks published questions at random within the scope; chapterIds narrows it. Pick chapters by matching names in the syllabus below. "Any chapter" or no chapter given: leave out subjectId and chapterIds, so every question assigned to the batch counts, whatever subject it is filed under. Check there are enough using QUESTIONS ASSIGNED TO EACH BATCH (and the syllabus counts when chapters are named); if not, say so in reply. A "passage" question is one item in that count, whatever mix of multiple-choice and written questions sits under it.
- mode: quiz (short), test (normal), mock (full mock exam). A new mock needs opensAt and liveHours (how long it stays open); "now" or no time given means it opens now.
- publish_exam when asked to publish, open, make live, or have it open at a time. For a new exam with a time, use openNow true after create_exam with opensAt: students can only start it from opensAt.
- Opening an existing exam (from EXAMS, matched by name): publish_exam { exam: its id, openNow: true, opensAt (left out = now), hours (how long it stays open, if said) }. "Open X for 5 hours now" = openNow true, hours 5. Never ask for a start time when they said now or gave none.
- Closing: create_exam closesAt (any mode: students can't start it after) and unpublishAt (hidden from students after). For an existing or just-made exam use close_exam / unpublish_exam with at (left out = now).
- post_notice: durationHours when asked for how long it stays up ("for 3 days" = 72), counted from publishFrom or posting.
- post_notice button: linkLabel (short, e.g. "Join now") and link, both or neither. link is one of: "step:N" (a live class or exam made earlier in this plan: the button opens it), a page in the student app for one of the notice's batches ("/batches/<batchId>/live-classes/<liveClassId>", "/batches/<batchId>/live-classes", "/batches/<batchId>/exams/<examId>", "/batches/<batchId>/exams", "/batches/<batchId>"), or a web address the staff member gave (https://…). Use ids from UPCOMING LIVE CLASSES / EXAMS below. Never make up a web address.
- post_notice: give picture (one line: what a cover picture for it shows, no words in the picture) when asked for a picture, or for an announcement that suits one (an event, a result, a holiday). It is only made when AI pictures are switched on.
- shift_schedule moves everything not started yet whose start falls in [from, to): minutes > 0 later, < 0 earlier. "Holiday on Friday, move it to Saturday" = from Friday 00:00, to Saturday 00:00, minutes 1440. "Push tomorrow's classes by 2 hours" = tomorrow's day, minutes 120, include ["classes"].
- copy_schedule copies what was scheduled in [from, to) days later (default 7): "same as last week" = from 7 days ago 00:00 to today 00:00, days 7. publish true only when asked to publish or make them live too; otherwise exams copy as drafts. Notices and classes are always scheduled.
- assign_questions adds published bank questions to batches (their Content tab). Needs subjectId, chapterIds or topicIds; types and difficulty narrow it.
- split_grading hands written scripts nobody has started to graders evenly. graderIds from GRADING STAFF for that batch, matched by name. exam (optional) limits it to one exam.
- generate_questions writes new questions with AI for one chapter (topicId optional, never with passage), styled on its published ones, sent to Review. batchIds: the batches to assign them to once approved. At most 20 per step; for more, add more steps.
- warn_flagged warns every student with at least minFlags exam flags and/or abusive messages in the last sinceDays days, each message written from their record. note: what the staff member wants said.
- draft_campaign makes a draft (nothing sent). To send it, add send_campaign { campaign: "step:N" } (at: a time, or left out for now). Only send when asked to send or schedule.
- Students, coupons, campaigns and automations are named in their fields as the staff member wrote them; the server finds them and shows staff what changes.
- write_exam_description writes the rules screen from the exam's real settings. Use it after add_questions when asked for a description, or for an existing exam. Put anything the staff member said about topics or materials in note.

${world}

${done?.length ? `ALREADY DONE (steps 1-${done.length}; plan only what comes after, numbering new steps from ${done.length + 1}; refer to these as step:N; they can't be undone, so if a change touches one, add a step that fixes it when a tool can, else say it can't be changed):\n${done.map((d, i) => `${i + 1}. ${d.title}${d.result?.summary ? ` — ${d.result.summary}` : ""}`).join("\n")}\n\n` : ""}${history?.length ? `EARLIER TRIES OF THIS REQUEST (the staff member edited it after these):\n${history.map((h) => `- They wrote: ${h.request}\n  You answered: ${h.reply || h.error || "nothing"}${h.plan ? `\n  Your plan was: ${h.plan}` : ""}`).join("\n")}\n\n` : ""}INSTRUCTION:
${request}
${errors ? `\nYour previous plan had these problems; fix them:\n${errors}\n` : ""}
Return: { "reply": "one or two sentences saying what you will do (or your question)", "needsInfo": false, "steps": [ { "tool": "create_exam", "title": "short human title", "args": "{...JSON object...}" } ] }`,
});

// Checks each planned step; returns { steps, errors }.
const checkPlan = (agent, planned, offset = 0) => {
  const tools = AGENTS[agent].tools;
  const steps = [];
  const errors = [];
  planned.forEach((s, i) => {
    const tool = tools[s.tool];
    if (!tool) { errors.push(`Step ${i + 1}: there is no tool "${s.tool}".`); return; }
    let args;
    try { args = JSON.parse(s.args || "{}"); } catch { errors.push(`Step ${i + 1}: args is not valid JSON.`); return; }
    // Fields only the server sets (a made picture's id) never come from the plan.
    if (args && typeof args === "object") for (const k of tool.internal || []) delete args[k];
    // Fields a tool can fill itself (a missing title, say) instead of failing.
    if (tool.fill && args && typeof args === "object") args = tool.fill(args, s);
    const parsed = tool.schema.safeParse(args);
    if (!parsed.success) {
      errors.push(`Step ${i + 1} (${s.tool}): ${parsed.error.issues.map((x) => `${x.path.join(".") || "args"} ${x.message}`).join("; ")}`);
      return;
    }
    for (const [k, v] of Object.entries(parsed.data)) {
      const m = typeof v === "string" && /^step:(\d+)$/.exec(v);
      if (m && Number(m[1]) > i + offset) errors.push(`Step ${i + offset + 1}: ${k} refers to a later step.`);
    }
    steps.push({ tool: s.tool, title: s.title || tool.label, args: parsed.data, risk: tool.risk });
  });
  return { steps, errors };
};

const plan = async (run, user) => {
  const ai = require("../ai/service");
  const tz = run.timezone || "UTC";
  const now = new Date().toLocaleString("en-GB", { timeZone: tz, weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
  // Steps already done (a follow-up to a run that did some work) stay.
  const done = run.steps.filter((s) => s.status === "done").map((s) => (s.toObject ? s.toObject() : s));
  const drawers = await pickDrawers(run, user);
  const base = {
    done, request: run.request, world: await describeWorld(user, run.agent), catalogue: toolCatalogue(run.agent, drawers),
    now, offset: offsetOf(tz), timezone: tz, history: (run.history || []).slice(-3), days: calendar(tz),
  };
  let errors = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data } = await ai.generate({ feature: `agent-${run.agent}`, schema: planSchema, user: user._id, maxTokens: 2500, ...planPrompt({ ...base, errors }) });
    if (data.needsInfo || !data.steps.length) {
      run.reply = data.reply;
      run.chat.push({ from: "agent", text: data.reply, at: new Date() });
      run.steps = done;
      run.status = "needs_info";
      return;
    }
    const checked = checkPlan(run.agent, data.steps, done.length);
    if (!checked.errors.length) {
      run.reply = data.reply;
      run.chat.push({ from: "agent", text: data.reply, at: new Date() });
      run.steps = done;
      run.steps = [...done, ...(await prepareSteps(run, checked.steps, user))];
      run.drawers = [...new Set(run.steps.map((s) => AGENTS[run.agent].tools[s.tool]?.drawer).filter(Boolean))];
      const batchIds = new Set();
      for (const s of run.steps) for (const b of AGENTS[run.agent].tools[s.tool]?.batchesOf?.(s.args) || []) batchIds.add(String(b));
      run.batches = [...batchIds];
      return;
    }
    errors = checked.errors.join("\n");
  }
  throw new Error(`The copilot couldn't make a workable plan: ${errors}`);
};

// Work a step can do before anyone decides on it, so they see the result
// first (a notice's picture). Done in order; a step that can't keeps its args.
const prepareSteps = async (run, steps, user) => {
  const tools = AGENTS[run.agent].tools;
  if (!steps.some((s) => tools[s.tool]?.prepare)) return steps;
  const ctx = await buildCtx(run, user);
  for (const s of steps) {
    if (!tools[s.tool]?.prepare) continue;
    try { s.args = await tools[s.tool].prepare(s.args, ctx); } catch { /* left as planned */ }
  }
  return steps;
};

// Running ----------------------------------------------------------------------

const needsApproval = (run, step) => run.mode === "ask" || (run.mode === "safe" && step.risk !== "safe");

// The fields of a tool's arguments staff can fill in on the form view.
// Batches, the exam and the syllabus get pickers (choicesFor); other ids
// (a script, a grader, a picture) stay as the plan made them.
const PICKER = {
  batchIds: "batches", batchId: "batch", exam: "exam", subjectId: "subject", chapterIds: "chapters", topicIds: "topics",
  chapterId: "chapter", topicId: "topic", graderIds: "graders",
};
const SKIP_FIELD = /(Id|Ids)$|^(picture|coverImage)$/;
const fieldsOf = (schema) => {
  const out = [];
  // A refined object (ZodEffects) keeps its fields one level down.
  const shape = schema.shape || schema._def.schema?.shape || {};
  for (const [key, raw] of Object.entries(shape)) {
    // A script's batch comes with the script.
    if (PICKER[key] && !(key === "batchId" && shape.submissionId)) {
      out.push({ key, kind: PICKER[key], optional: raw.isOptional() });
      continue;
    }
    if (SKIP_FIELD.test(key)) continue;
    let t = raw;
    let optional = false;
    for (;;) {
      const k = t._def.typeName;
      if (k === "ZodOptional" || k === "ZodNullable" || k === "ZodDefault") { optional = true; t = t._def.innerType; }
      else if (k === "ZodEffects") t = t._def.schema;
      else break;
    }
    const k = t._def.typeName;
    let field = null;
    if (k === "ZodEnum") field = { kind: "enum", options: t._def.values };
    else if (k === "ZodArray" && t._def.type._def.typeName === "ZodEnum") field = { kind: "multi", options: t._def.type._def.values };
    else if (k === "ZodNumber") field = { kind: "number" };
    else if (k === "ZodBoolean") field = { kind: "bool" };
    else if (k === "ZodString") field = { kind: /(At|From)$|^at$/.test(key) ? "date" : /markdown|body|description|message|answer|reply|text/i.test(key) ? "long" : "text" };
    if (field) out.push({ key, optional, ...field });
  }
  return out;
};

// A step that depends on one that was rejected, failed or skipped can't run.
const dependsOnDead = (run, step) =>
  Object.values(step.args || {}).some((v) => {
    const m = typeof v === "string" && /^step:(\d+)$/.exec(v);
    return m && ["rejected", "failed", "skipped"].includes(run.steps[Number(m[1]) - 1]?.status);
  });

// Runs every step it may, in order, until one needs a person or all are done.
const advance = async (runId) => {
  const User = require("../models/userModel");
  const run = await AgentRun.findById(runId);
  if (!run || ["done", "failed", "cancelled", "needs_info"].includes(run.status)) return run;
  const user = await User.findById(run.user);
  if (!user) { run.status = "failed"; run.error = "The person who asked no longer has an account."; await run.save(); return run; }
  const ctx = await buildCtx(run, user);
  const tools = AGENTS[run.agent].tools;

  for (const step of run.steps) {
    if (["done", "rejected", "skipped", "failed"].includes(step.status)) continue;
    if (dependsOnDead(run, step)) { step.status = "skipped"; step.error = "Depends on a step that didn't run."; continue; }
    if (step.status === "pending" && needsApproval(run, step)) {
      run.status = "awaiting";
      await run.save();
      return run;
    }
    step.status = "running";
    run.status = "running";
    await run.save();
    try {
      const tool = tools[step.tool];
      await ctx.assertBatches(tool.batchesOf?.(step.args) || []);
      step.result = await tool.run(step.args, ctx);
      step.status = "done";
    } catch (err) {
      step.status = "failed";
      step.error = err.message;
    }
    step.finishedAt = new Date();
    run.markModified("steps");
    await run.save();
    if (step.status === "failed") {
      for (const s of run.steps) if (["pending", "approved"].includes(s.status)) { s.status = "skipped"; s.error = "Stopped after an earlier step failed."; }
      run.status = "failed";
      run.error = `Step “${step.title}” failed: ${step.error}`;
      await run.save();
      return run;
    }
  }
  run.status = "done";
  await run.save();
  return run;
};

// Entry points -------------------------------------------------------------

// The account background agents act as: the first active owner.
const actingOwner = async () => {
  const User = require("../models/userModel");
  return User.findOne({ role: "owner", isDeleted: { $ne: true }, isActive: { $ne: false } }).sort({ createdAt: 1 });
};

// A background agent's prepared plan: steps already worked out in code.
const startPrepared = async ({ agent, request, reply, steps, user }) => {
  const s = await settings();
  const tools = AGENTS[agent].tools;
  const checked = [];
  const batchIds = new Set();
  for (const step of steps) {
    const tool = tools[step.tool];
    const args = tool.schema.parse(step.args);
    checked.push({ tool: step.tool, title: step.title || tool.label, args, risk: tool.risk });
    for (const b of tool.batchesOf?.(args) || []) batchIds.add(String(b));
  }
  const run = await AgentRun.create({
    agent, user: user._id, request, reply, mode: s[agent]?.mode || "safe", status: "running",
    steps: checked, batches: [...batchIds],
  });
  return advance(run._id);
};

const start = async ({ user, request, timezone, agent = "copilot", form = false }) => {
  const s = await settings();
  const run = await AgentRun.create({
    agent, user: user._id, request: String(request).trim().slice(0, 2000), timezone: timezone || "UTC",
    mode: form ? "ask" : s[agent]?.mode || "safe", form, status: "planning",
    chat: [{ from: "staff", text: String(request).trim().slice(0, 2000), at: new Date() }],
  });
  planLater(run._id, user);
  return run;
};

// Planning calls the AI and can take a while: done in the background.
const planLater = (runId, user) => {
  setImmediate(async () => {
    const fresh = await AgentRun.findById(runId);
    if (!fresh) return;
    try {
      await plan(fresh, user);
      if (fresh.status === "planning") fresh.status = "running";
      await fresh.save();
      if (fresh.status === "running") await advance(fresh._id);
    } catch (err) {
      fresh.status = "failed";
      fresh.error = err.message;
      await fresh.save().catch(() => {});
    }
  });
};

// A copilot request that asked a question or couldn't be planned, edited
// and asked again in place. Not once a step has run: that work is real.
const canRetry = (run) =>
  run.agent === "copilot" && (run.status === "needs_info" || ((run.status === "failed" || run.status === "cancelled") && !run.steps.some((s) => ["done", "running"].includes(s.status))));

const retry = async (run, request, user) => {
  if (!canRetry(run)) throw Object.assign(new Error("Only a request that asked a question or stopped before doing anything can be asked again."), { statusCode: 409 });
  run.history.push({ request: run.request, reply: run.reply, error: run.error, at: new Date() });
  if (run.history.length > 10) run.history = run.history.slice(-10);
  run.retries.push(new Date());
  run.request = String(request).trim().slice(0, 2000);
  run.chat.push({ from: "staff", text: run.request, at: new Date() });
  run.status = "planning";
  run.reply = undefined;
  run.error = undefined;
  run.steps = [];
  run.batches = [];
  run.mode = run.form ? "ask" : (await settings()).copilot?.mode || "safe";
  await run.save();
  planLater(run._id, user);
  return run;
};

// A follow-up in the chat: the plan is remade with the message added.
// Work already done stays; steps not yet run are replaced.
const canRevise = (run) =>
  run.agent === "copilot" && !run.form && ["awaiting", "needs_info", "done", "failed", "cancelled"].includes(run.status)
  && !run.steps.some((s) => ["running", "approved"].includes(s.status));

const revise = async (run, message, user) => {
  if (!canRevise(run)) throw Object.assign(new Error("It's still working. Wait for it to finish, then ask again."), { statusCode: 409 });
  const text = String(message).trim().slice(0, 600);
  const plan = run.steps.map((s, i) => `${i + 1}. ${s.title} [${s.status}]`).join("; ");
  run.history.push({ request: run.request, reply: run.reply, error: run.error, plan, at: new Date() });
  if (run.history.length > 10) run.history = run.history.slice(-10);
  run.retries.push(new Date());
  run.chat.push({ from: "staff", text, at: new Date() });
  run.request = `${run.request}\nThen: ${text}`.slice(-2000);
  run.steps = run.steps.filter((s) => s.status === "done");
  run.status = "planning";
  run.reply = undefined;
  run.error = undefined;
  run.mode = (await settings()).copilot?.mode || "safe";
  run.markModified("steps");
  await run.save();
  planLater(run._id, user);
  return run;
};

// Deleting from the page: still active work is cancelled first.
const HIDE_FOR_MS = 30 * 86400000;
const hide = async (run) => {
  if (["planning", "running"].includes(run.status)) throw Object.assign(new Error("It's still working. Cancel it first, or wait for it to finish."), { statusCode: 409 });
  if (run.status === "awaiting") await cancel(run);
  run.hidden = true;
  run.deleteAfter = new Date(Date.now() + HIDE_FOR_MS);
  await run.save();
  return run;
};

// rejectIds: steps turned down in the same go (the form view's unticked ones).
const decide = async (run, stepIds, approve, user, rejectIds = []) => {
  for (const step of run.steps) {
    if (step.status !== "pending") continue;
    const no = rejectIds.includes(String(step._id));
    if (!no && !stepIds.includes(String(step._id))) continue;
    step.status = approve && !no ? "approved" : "rejected";
    step.decidedBy = user._id;
    step.decidedAt = new Date();
  }
  run.status = "running";
  run.markModified("steps");
  await run.save();
  setImmediate(() => advance(run._id).catch(() => {}));
  return run;
};

// Staff may change a waiting step's editable fields (a drafted answer, say)
// before approving it. The tool's own schema checks the result.
const editStep = async (run, stepId, patch) => {
  const step = run.steps.id(stepId);
  if (!step || step.status !== "pending") throw Object.assign(new Error("Only a step waiting for a decision can be changed."), { statusCode: 409 });
  const tool = AGENTS[run.agent].tools[step.tool];
  const allowed = run.form ? fieldsOf(tool.schema).map((f) => f.key) : tool.editable || [];
  const next = { ...step.args };
  for (const [k, v] of Object.entries(patch || {})) {
    if (!allowed.includes(k)) continue;
    // On the form an emptied field means "leave it out".
    if (run.form && (v === null || v === "")) delete next[k];
    else next[k] = v;
  }
  const parsed = tool.schema.safeParse(next);
  if (!parsed.success) throw Object.assign(new Error(parsed.error.issues.map((x) => `${x.path.join(".")} ${x.message}`).join("; ")), { statusCode: 400 });
  step.args = parsed.data;
  // A batch changed on the form: the request now belongs to those batches.
  if (run.form) {
    const ids = new Set();
    for (const s of run.steps) for (const b of AGENTS[run.agent].tools[s.tool]?.batchesOf?.(s.args) || []) ids.add(String(b));
    run.batches = [...ids];
  }
  run.markModified("steps");
  await run.save();
  return run;
};

// What the form view's pickers offer: the batches this person may act on,
// exams in them (and those the plan makes), and the syllabus.
const choicesFor = async (run, user) => {
  const Exam = require("../models/examModel");
  const Subject = require("../models/subjectModel");
  const Chapter = require("../models/chapterModel");
  const Topic = require("../models/topicModel");
  const User = require("../models/userModel");
  const batches = await allowedBatches(user, run.agent);
  const ids = batches.map((b) => b._id);
  const staffIds = [...new Set(batches.flatMap((b) => [...(b.graders || []), ...(b.teachers || [])].map(String)))];
  const [exams, subjects, chapters, topics, staff] = await Promise.all([
    Exam.find({ batches: { $in: ids } }).select("title").sort({ createdAt: -1 }).limit(100).lean(),
    Subject.find({}).select("title").sort({ title: 1 }).lean(),
    Chapter.find({}).select("title subject").sort({ order: 1 }).lean(),
    Topic.find({}).select("title chapter").sort({ order: 1 }).limit(5000).lean(),
    User.find({ _id: { $in: staffIds }, isActive: { $ne: false }, isDeleted: { $ne: true } }).select("name role").sort({ name: 1 }).lean(),
  ]);
  const planned = run.steps
    .map((s, i) => (s.tool === "create_exam" ? { _id: `step:${i + 1}`, title: `New: ${s.args.title}` } : null))
    .filter(Boolean);
  return {
    batches: batches.map((b) => ({ _id: b._id, title: b.name })),
    exams: [...planned, ...exams],
    subjects,
    chapters,
    topics,
    graders: staff.map((u) => ({ _id: u._id, title: `${u.name} (${u.role})` })),
  };
};

const labelKey = (k) => k || "args";

// The form view's preview: what a step would act on with these settings
// (the questions it draws from, the classes it moves...), before it runs.
const previewStep = async (run, stepId, args, user) => {
  const step = run.steps.id(stepId);
  const tool = step && AGENTS[run.agent].tools[step.tool];
  if (!tool?.preview) throw Object.assign(new Error("This step has no preview."), { statusCode: 400 });
  const ctx = await buildCtx(run, user);
  // Checked like a real edit, and only ever about batches this person may act on.
  const parsed = tool.schema.safeParse({ ...step.args, ...(args && typeof args === "object" ? args : {}) });
  if (!parsed.success) throw Object.assign(new Error(parsed.error.issues.map((x) => `${labelKey(x.path.join("."))} ${x.message}`).join("; ")), { statusCode: 400 });
  const a = { ...parsed.data };
  const extra = Array.isArray(args?.batchIds) ? args.batchIds : a.batchIds;
  if (extra) a.batchIds = extra.filter((b) => typeof b === "string" && ctx.canAct(b));
  if (a.batchId && !ctx.canAct(a.batchId)) throw Object.assign(new Error("The copilot isn't allowed to act on that batch."), { statusCode: 403 });
  const out = await tool.preview(a, ctx, run);
  const items = out.items || [];
  return { summary: out.summary, warn: Boolean(out.warn), total: items.length, items: items.slice(0, 40) };
};

// Remake or remove the picture of a waiting step (a notice's cover).
const stepPicture = async (run, stepId, change, user) => {
  const step = run.steps.id(stepId);
  if (!step || step.status !== "pending") throw Object.assign(new Error("Only a step waiting for a decision can be changed."), { statusCode: 409 });
  const tool = AGENTS[run.agent].tools[step.tool];
  if (!tool.changePicture) throw Object.assign(new Error("This step has no picture."), { statusCode: 400 });
  const next = await tool.changePicture({ ...step.args }, await buildCtx(run, user), change || {});
  const parsed = tool.schema.safeParse(next);
  if (!parsed.success) throw Object.assign(new Error(parsed.error.issues.map((x) => `${x.path.join(".")} ${x.message}`).join("; ")), { statusCode: 400 });
  step.args = parsed.data;
  run.markModified("steps");
  await run.save();
  return run;
};

const cancel = async (run) => {
  for (const s of run.steps) if (["pending", "approved"].includes(s.status)) s.status = "skipped";
  run.status = "cancelled";
  run.markModified("steps");
  await run.save();
  return run;
};

// For the admin page: steps with human-readable descriptions.
const shape = async (run, user) => {
  const ctx = await buildCtx(run, user);
  const tools = AGENTS[run.agent].tools;
  const o = run.toObject();
  delete o.retries;
  return {
    ...o,
    choices: run.form && run.status === "awaiting" ? await choicesFor(run, user) : undefined,
    agentLabel: AGENTS[run.agent].label,
    canRetry: canRetry(run),
    canRevise: canRevise(run),
    drawers: (run.drawers || []).map((d) => DRAWERS[d] || d),
    steps: await Promise.all(o.steps.map(async (s) => {
      let detail = "";
      try { detail = tools[s.tool]?.describe(s.args, ctx) || ""; } catch { detail = ""; }
      const editable = tools[s.tool]?.editable || [];
      let link = null;
      try { link = tools[s.tool]?.linkOf?.(s.args) || null; } catch { link = null; }
      let image = null;
      try { image = (await tools[s.tool]?.imageOf?.(s.args)) || null; } catch { image = null; }
      const fields = run.form && tools[s.tool] ? fieldsOf(tools[s.tool].schema) : undefined;
      const hasPreview = Boolean(tools[s.tool]?.preview);
      let changes = null;
      try { changes = tools[s.tool]?.changesOf?.(s.args) || null; } catch { changes = null; }
      // A password typed for a student is never sent back to the page.
      const args = s.args?.password ? { ...s.args, password: "••••••" } : s.args;
      return { ...s, args, changes, drawer: DRAWERS[tools[s.tool]?.drawer] || null, detail, editable, fields, hasPreview, link, image, hasPicture: Boolean(tools[s.tool]?.changePicture), needsApproval: s.status === "pending" && needsApproval(run, s) };
    })),
  };
};

module.exports = { AGENTS, DRAWERS, revise, canRevise, editStep, stepPicture, previewStep, start, retry, canRetry, hide, startPrepared, actingOwner, advance, decide, cancel, shape, blockedFor, allowedBatches, checkPlan, plan, settings };
