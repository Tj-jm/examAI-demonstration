const { z } = require("zod");
const mongoose = require("mongoose");
const { call } = require("../invoke");

// What the admin copilot can do. Each tool is a thin wrapper around the
// handler an admin's own click would use (agents/invoke.js), so the agent
// can never do more than the person who asked could.
//
// risk "safe": a draft, nothing students see yet. "publish": students see
// it or are notified. Settings → AI → Agents decides which need approval.

const id = z.string().refine((v) => mongoose.isValidObjectId(v), "not a valid id");
// An exam made earlier in the same plan ("step:1") or an existing exam's id.
const examRef = z.string().refine((v) => /^step:\d+$/.test(v) || mongoose.isValidObjectId(v), "an exam id or step:N");
const isoDate = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "an ISO date");

const when = (iso, tz) => {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return new Date(iso).toISOString();
  }
};
const hoursText = (h) => (h % 24 === 0 ? `${h / 24} day${h === 24 ? "" : "s"}` : `${h} hour${h === 1 ? "" : "s"}`);
const names = (ids, ctx) => (ids || []).map((b) => ctx.batchName(b)).join(", ");

const handlers = () => ({
  exam: require("../../controllers/admin/examController"),
  assignment: require("../../controllers/admin/assignmentController"),
  notice: require("../../controllers/admin/noticeController"),
  live: require("../../controllers/admin/liveClassController"),
});

// A notice button pointing at a live class or exam made earlier in the plan:
// its page in the student app, under the notice's first batch.
const linkToStep = (a, ctx) => {
  const batch = a.batchIds[0];
  try {
    return `/batches/${batch}/live-classes/${ctx.resolve(a.link, "liveClassId")}`;
  } catch {
    return `/batches/${batch}/exams/${ctx.resolve(a.link, "examId")}`;
  }
};

// The exam a step names, after checking the staff member may touch it.
const examFor = async (a, ctx) => {
  const Exam = require("../../models/examModel");
  const examId = ctx.resolve(a.exam, "examId");
  const exam = await Exam.findById(examId).select("batches title");
  if (!exam) throw new Error("That exam no longer exists.");
  await ctx.assertBatches(exam.batches);
  return { exam, examId, h: handlers() };
};

// The questions add_questions draws from, by type: published, not already
// in the exam, matching the scope. Questions assigned to the exam's batches
// only; a batch with none assigned falls back to the shared bank.
const questionPool = async (a, { batches = [], examId = null, already = [] }) => {
  const Exam = require("../../models/examModel");
  const { Question } = require("../../models/questionModel");
  const query = { status: "published", _id: { $nin: already }, ...Question.IN_BANK };
  if (a.subjectId) query.subject = a.subjectId;
  if (a.chapterIds?.length) query.chapter = { $in: a.chapterIds };
  if (a.topicIds?.length) query.topic = { $in: a.topicIds };
  if (a.difficulty && a.difficulty !== "mixed") query.difficulty = a.difficulty;
  const assigned = batches.length
    ? await Question.exists({ status: "published", ...Question.IN_BANK, batches: { $in: batches } })
    : null;
  query.$or = assigned
    ? [{ batches: { $in: batches } }]
    : [{ batches: { $size: 0 } }, { batches: { $exists: false } }];
  if (a.notUsedInDays) {
    const since = new Date(Date.now() - a.notUsedInDays * 86400000);
    const recent = await Exam.find({ _id: { $ne: examId }, createdAt: { $gte: since } }).select("questions").lean();
    const used = recent.flatMap((e) => e.questions || []);
    if (used.length) query._id.$nin = [...already, ...used];
  }
  const types = a.types?.length ? a.types : ["mcq", "mtf", "written", "passage"];
  const available = {};
  for (const t of types) available[t] = await Question.find({ ...query, type: t }).select("_id question type").lean();
  return { types, available, fromBatch: Boolean(assigned) };
};

const tools = {
  create_exam: {
    label: "Create a draft exam",
    risk: "safe",
    schema: z.object({
      title: z.string().min(2).max(160),
      mode: z.enum(["quiz", "test", "mock"]).default("test"),
      durationMinutes: z.number().int().min(1).max(600),
      batchIds: z.array(id).min(1).max(20),
      opensAt: isoDate.nullable().optional(),
      liveHours: z.number().min(1).max(720).nullable().optional(),
      closesAt: isoDate.nullable().optional(),
      unpublishAt: isoDate.nullable().optional(),
      description: z.string().max(2000).optional(),
      attemptsAllowed: z.number().int().min(1).max(20).optional(),
      shuffleQuestions: z.boolean().optional(),
    }),
    // The planner sometimes leaves these out; they have obvious answers.
    fill: (a, step) => ({
      ...a,
      title: a.title || step.title || `${a.mode === "mock" ? "Mock exam" : a.mode === "quiz" ? "Quiz" : "Test"}`,
      durationMinutes: a.durationMinutes || (a.liveHours ? Math.min(600, Math.round(a.liveHours * 60)) : a.mode === "quiz" ? 15 : 60),
    }),
    batchesOf: (a) => a.batchIds,
    describe: (a, ctx) =>
      `“${a.title}” · ${a.mode} · ${a.durationMinutes} min · for ${names(a.batchIds, ctx)}${a.opensAt ? ` · opens ${when(a.opensAt, ctx.timezone)}` : ""}${a.closesAt ? ` · closes ${when(a.closesAt, ctx.timezone)}` : ""}${a.unpublishAt ? ` · unpublished ${when(a.unpublishAt, ctx.timezone)}` : ""}`,
    async run(a, ctx) {
      const h = handlers();
      const exam = await call(h.exam.createExam, {
        user: ctx.user,
        body: {
          title: a.title, mode: a.mode, durationMinutes: a.durationMinutes, description: a.description,
          opensAt: a.opensAt || undefined, liveHours: a.liveHours || undefined,
          closesAt: a.closesAt || undefined, unpublishAt: a.unpublishAt || undefined,
          attemptsAllowed: a.attemptsAllowed, shuffleQuestions: a.shuffleQuestions,
        },
      });
      for (const b of a.batchIds) {
        await call(h.assignment.assignToBatch, { user: ctx.user, params: { id: b, kind: "exams" }, body: { ids: [String(exam._id)] } });
      }
      return { examId: String(exam._id), summary: `Draft exam “${exam.title}” created.`, link: `/exams/${exam._id}` };
    },
  },

  add_questions: {
    label: "Add questions from the bank",
    risk: "safe",
    schema: z.object({
      exam: examRef,
      count: z.number().int().min(1).max(100),
      types: z.array(z.enum(["mcq", "mtf", "written", "passage"])).min(1).optional(),
      subjectId: id.optional(),
      chapterIds: z.array(id).max(30).optional(),
      topicIds: z.array(id).max(50).optional(),
      difficulty: z.enum(["easy", "medium", "hard", "mixed"]).optional(),
      // Skip questions used in any exam made in the last N days.
      notUsedInDays: z.number().int().min(0).max(730).optional(),
    }),
    describe: (a, ctx) => {
      const scope = [
        a.chapterIds?.length ? a.chapterIds.map((c) => ctx.chapterName(c)).join(", ") : a.subjectId ? ctx.subjectName(a.subjectId) : "the batch's questions",
        a.difficulty && a.difficulty !== "mixed" ? a.difficulty : null,
        a.types?.length ? a.types.join("/").toUpperCase() : null,
        a.notUsedInDays ? `not used in ${a.notUsedInDays} days` : null,
      ].filter(Boolean).join(" · ");
      return `${a.count} questions from ${scope}`;
    },
    // args.batchIds: the batches of an exam this plan makes, as the form has them.
    async preview(a, ctx, run) {
      const Exam = require("../../models/examModel");
      let batches = [];
      let already = [];
      let examId = null;
      const m = /^step:(\d+)$/.exec(String(a.exam));
      if (m) batches = (Array.isArray(a.batchIds) ? a.batchIds : run.steps[Number(m[1]) - 1]?.args?.batchIds) || [];
      else {
        const exam = await Exam.findById(a.exam).select("batches questions").lean();
        if (exam) { batches = exam.batches || []; already = exam.questions || []; examId = exam._id; }
      }
      batches = batches.filter((b) => ctx.canAct(b));
      const { types, available, fromBatch } = await questionPool(a, { batches, examId, already });
      const byType = types.map((t) => `${t} ${available[t].length}`).join(", ");
      const total = types.reduce((n, t) => n + available[t].length, 0);
      return {
        summary: `${total} available (${byType}) from ${fromBatch ? "the batch's assigned questions" : "the shared bank (nothing assigned to the batch)"}${total < (Number(a.count) || 0) ? `: fewer than the ${a.count} asked` : ""}.`,
        warn: total < (Number(a.count) || 0),
        items: types.flatMap((t) => available[t]).map((q) => ({ tag: q.type, text: String(q.question || "").replace(/\s+/g, " ").slice(0, 160) })),
      };
    },
    async run(a, ctx) {
      const Exam = require("../../models/examModel");
      const { allocateTypes } = require("../../ai/prompts");
      const examId = ctx.resolve(a.exam, "examId");
      const exam = await Exam.findById(examId);
      if (!exam) throw new Error("That exam no longer exists.");
      await ctx.assertBatches(exam.batches);

      const { types, available } = await questionPool(a, { batches: exam.batches, examId: exam._id, already: exam.questions });
      // Split the count across the types that have questions at all.
      const usable = types.filter((t) => available[t].length);
      const targets = allocateTypes(a.count, usable.length ? usable : types);
      const picked = [];
      const byType = {};
      for (const [t, n] of Object.entries(targets)) {
        const pool = [...available[t]].sort(() => Math.random() - 0.5).slice(0, n);
        byType[t] = pool.length;
        picked.push(...pool.map((q) => String(q._id)));
      }
      // Top up from types that had more, if one ran short.
      if (picked.length < a.count) {
        const chosen = new Set(picked);
        for (const t of usable) {
          for (const q of [...available[t]].sort(() => Math.random() - 0.5)) {
            if (picked.length >= a.count) break;
            if (!chosen.has(String(q._id))) { picked.push(String(q._id)); chosen.add(String(q._id)); byType[t] = (byType[t] || 0) + 1; }
          }
        }
      }
      if (!picked.length) throw new Error("No published questions match that scope.");
      await call(handlers().exam.addQuestions, { user: ctx.user, params: { id: examId }, body: { questionIds: picked } });
      const short = a.count - picked.length;
      return {
        examId,
        added: picked.length,
        byType,
        summary: `Added ${picked.length} question${picked.length === 1 ? "" : "s"}${short > 0 ? ` (the bank only had ${picked.length} that fit)` : ""}.`,
        link: `/exams/${examId}`,
      };
    },
  },

  write_exam_description: {
    label: "Write an exam's description",
    risk: "safe",
    schema: z.object({
      exam: examRef,
      note: z.string().max(600).optional(),
      language: z.enum(["en", "bn"]).optional(),
    }),
    describe: (a) => `Write the rules students see before they start${a.note ? `, adding: ${a.note}` : ""}`,
    async run(a, ctx) {
      const Exam = require("../../models/examModel");
      const ai = require("../../ai/service");
      const { writingTask } = require("../../ai/writing");
      const { examInput } = require("../../controllers/admin/aiWritingController");
      const examId = ctx.resolve(a.exam, "examId");
      const exam = await Exam.findById(examId).select("batches title");
      if (!exam) throw new Error("That exam no longer exists.");
      await ctx.assertBatches(exam.batches);
      const task = writingTask("examDescription", { exam: await examInput({ examId }), prompt: a.note, language: a.language || "en" });
      const { data } = await ai.generate({ feature: "write-examDescription", ...task, maxTokens: 1500, user: ctx.user._id, wrapLatex: false });
      await call(handlers().exam.updateExam, { user: ctx.user, params: { id: examId }, body: { description: data.description } });
      return { examId, summary: `Description written for “${exam.title}”.`, link: `/exams/${examId}` };
    },
  },

  publish_exam: {
    label: "Publish an exam",
    risk: "publish",
    schema: z.object({
      exam: examRef,
      openNow: z.boolean().optional(),
      // When it opens (left out with openNow: now) and how many hours it stays open.
      opensAt: isoDate.nullable().optional(),
      hours: z.number().min(0.25).max(720).nullable().optional(),
    }),
    describe: (a, ctx) =>
      `${a.openNow ? (a.opensAt ? `Publish it and open it ${when(a.opensAt, ctx.timezone)}` : "Publish and open it to students now") : "Publish it to students"}${a.hours ? ` · open for ${a.hours} hour${a.hours === 1 ? "" : "s"}` : ""}`,
    async run(a, ctx) {
      const Exam = require("../../models/examModel");
      const examId = ctx.resolve(a.exam, "examId");
      const exam = await Exam.findById(examId).select("batches title mode opensAt closesAt liveHours");
      if (!exam) throw new Error("That exam no longer exists.");
      await ctx.assertBatches(exam.batches);
      const h = handlers();
      // Opening (again): restart its window from the chosen time, so an old
      // opensAt / closesAt / mock window doesn't keep it shut.
      if (a.openNow && (a.opensAt || a.hours || exam.opensAt || exam.closesAt)) {
        const start = a.opensAt ? new Date(a.opensAt) : new Date();
        const timing = { opensAt: start };
        if (a.hours) {
          timing.closesAt = new Date(start.getTime() + a.hours * 3600000);
          if (exam.mode === "mock") timing.liveHours = a.hours;
        } else if (exam.closesAt && exam.closesAt <= start) {
          timing.closesAt = null;
        }
        await call(h.exam.updateExam, { user: ctx.user, params: { id: examId }, body: timing });
      }
      await call(h.exam.setPublished, { user: ctx.user, params: { id: examId }, body: { isPublished: true } });
      if (a.openNow) await call(h.exam.setActive, { user: ctx.user, params: { id: examId }, body: { isActive: true } });
      return { examId, summary: `“${exam.title}” is published${a.openNow ? " and open" : ""}.`, link: `/exams/${examId}` };
    },
  },

  close_exam: {
    label: "Close an exam",
    risk: "publish",
    // at: close then; left out: close now.
    schema: z.object({ exam: examRef, at: isoDate.optional() }),
    describe: (a, ctx) => (a.at ? `Close it at ${when(a.at, ctx.timezone)}` : "Close it now: students can't start it"),
    async run(a, ctx) {
      const { exam, examId, h } = await examFor(a, ctx);
      if (a.at) await call(h.exam.updateExam, { user: ctx.user, params: { id: examId }, body: { closesAt: a.at } });
      else await call(h.exam.setActive, { user: ctx.user, params: { id: examId }, body: { isActive: false } });
      return { examId, summary: a.at ? `“${exam.title}” closes ${when(a.at, ctx.timezone)}.` : `“${exam.title}” is closed.`, link: `/exams/${examId}` };
    },
  },

  unpublish_exam: {
    label: "Unpublish an exam",
    risk: "publish",
    // at: unpublish then (jobs/examSchedule.js); left out: unpublish now.
    schema: z.object({ exam: examRef, at: isoDate.optional() }),
    describe: (a, ctx) => (a.at ? `Unpublish it at ${when(a.at, ctx.timezone)}` : "Unpublish it now: students no longer see it"),
    async run(a, ctx) {
      const { exam, examId, h } = await examFor(a, ctx);
      if (a.at) await call(h.exam.updateExam, { user: ctx.user, params: { id: examId }, body: { unpublishAt: a.at } });
      else await call(h.exam.setPublished, { user: ctx.user, params: { id: examId }, body: { isPublished: false } });
      return { examId, summary: a.at ? `“${exam.title}” is unpublished ${when(a.at, ctx.timezone)}.` : `“${exam.title}” is unpublished.`, link: `/exams/${examId}` };
    },
  },

  post_notice: {
    label: "Post a notice to batches",
    risk: "publish",
    schema: z.object({
      title: z.string().min(2).max(160),
      bodyMarkdown: z.string().min(1).max(5000),
      batchIds: z.array(id).min(1).max(20),
      publishFrom: isoDate.nullable().optional(),
      // How long it stays up, from publishFrom (or posting). Unset: no end.
      durationHours: z.number().min(1).max(8760).nullable().optional(),
      // A button under the notice: both or neither. A web address or an
      // app path like /batches/…
      linkLabel: z.string().trim().max(40).nullable().optional(),
      link: z.string().trim().max(500).refine((v) => !v || /^(https?:\/\/|\/|step:\d+$)/.test(v), "a web address (https://…), an app path (/…) or step:N").nullable().optional(),
      // A cover picture to make with AI (when AI pictures are on): what it
      // shows. Made when the plan is ready, so staff see it before approving.
      picture: z.string().max(300).optional(),
      coverImage: id.nullable().optional(),
    }),
    // Set by the server only (the picture made from `picture`), never by the plan.
    internal: ["coverImage"],
    // Staff can set the button and how long it stays up before approving.
    editable: ["linkLabel", "link", "durationHours"],
    batchesOf: (a) => a.batchIds,
    describe: (a, ctx) =>
      `“${a.title}” to ${names(a.batchIds, ctx)}${a.publishFrom ? ` · from ${when(a.publishFrom, ctx.timezone)}` : ""}` +
      `${a.durationHours ? ` · up for ${hoursText(a.durationHours)}` : ""}${a.linkLabel && a.link ? ` · button “${a.linkLabel}”` : ""}${a.coverImage ? " · with a cover picture" : ""}`,
    // After planning: make the picture to review. A failure only leaves it out.
    async prepare(a, ctx) {
      if (!a.picture || a.coverImage) return a;
      const aiPicture = require("../../utils/aiPicture");
      if (!(await aiPicture.enabled())) {
        const { picture, ...rest } = a;
        return rest;
      }
      try {
        const media = await aiPicture.make({ prompt: a.picture, purpose: "notice", user: ctx.user._id });
        return { ...a, coverImage: String(media._id) };
      } catch {
        return a;
      }
    },
    // Remake (optionally from a new description) or remove the picture of a waiting step.
    async changePicture(a, ctx, { action, prompt }) {
      if (action === "remove") return { ...a, coverImage: null };
      const description = String(prompt || a.picture || "").trim().slice(0, 300);
      if (!description) throw Object.assign(new Error("Describe the picture first."), { statusCode: 400 });
      const media = await require("../../utils/aiPicture").make({ prompt: description, purpose: "notice", user: ctx.user._id });
      return { ...a, picture: description, coverImage: String(media._id) };
    },
    async imageOf(a) {
      if (!a.coverImage) return null;
      const Media = require("../../models/mediaModel");
      const media = await Media.findById(a.coverImage);
      return media ? (await require("../../controllers/admin/mediaController").shape(media)).url || null : null;
    },
    async run(a, ctx) {
      if (Boolean(a.link) !== Boolean(a.linkLabel)) throw new Error("The button needs both a label and a link, or neither.");
      const start = a.publishFrom ? new Date(a.publishFrom).getTime() : Date.now();
      const link = a.link && /^step:\d+$/.test(a.link) ? linkToStep(a, ctx) : a.link;
      const notice = await call(handlers().notice.createNotice, {
        user: ctx.user,
        body: {
          title: a.title, bodyMarkdown: a.bodyMarkdown, noticeType: "batch", batches: a.batchIds, isPublished: true, publishFrom: a.publishFrom || null,
          publishUntil: a.durationHours ? new Date(start + a.durationHours * 3600000) : null,
          ...(link && a.linkLabel ? { link, linkLabel: a.linkLabel } : {}),
          ...(a.coverImage ? { coverImage: a.coverImage } : {}),
        },
      });
      return { noticeId: String(notice._id), summary: `Notice “${notice.title}” posted${a.coverImage ? " with its picture" : ""}.`, link: `/notices/${notice._id}/edit` };
    },
  },

  schedule_live_class: {
    label: "Schedule a live class",
    risk: "publish",
    schema: z.object({
      batchId: id,
      title: z.string().min(2).max(160),
      scheduledAt: isoDate,
      durationMinutes: z.number().int().min(10).max(600).default(60),
      provider: z.enum(["livekit", "zoom", "manual"]).optional(),
      joinUrl: z.string().url().optional(),
      mode: z.enum(["class", "webinar"]).optional(),
      description: z.string().max(2000).optional(),
    }),
    batchesOf: (a) => [a.batchId],
    describe: (a, ctx) => `“${a.title}” for ${ctx.batchName(a.batchId)} · ${when(a.scheduledAt, ctx.timezone)} · ${a.durationMinutes} min`,
    async run(a, ctx) {
      const adapter = require("../../adapters/liveClass");
      const configured = adapter.list().filter((p) => p.configured).map((p) => p.name);
      const provider = a.provider && configured.includes(a.provider) ? a.provider : ["livekit", "zoom"].find((p) => configured.includes(p));
      if (!provider) throw new Error("No live class provider is set up. Add LiveKit or Zoom, or give a join link.");
      const lc = await call(handlers().live.createLiveClass, {
        user: ctx.user,
        body: { batch: a.batchId, title: a.title, description: a.description, scheduledAt: a.scheduledAt, durationMinutes: a.durationMinutes, provider, joinUrl: a.joinUrl, mode: a.mode },
      });
      return { liveClassId: String(lc._id), summary: `Live class “${lc.title}” scheduled.`, link: `/live-classes/${lc._id}/edit` };
    },
  },
  reopen_script: {
    label: "Reopen a part-marked script for grading",
    risk: "staff",
    schema: z.object({
      submissionId: id,
      batchId: id,
      // Omit to put it back for anyone on the batch.
      graderId: id.optional(),
      why: z.string().max(300).optional(),
    }),
    batchesOf: (a) => [a.batchId],
    linkOf: (a) => `/grading/${a.submissionId}`,
    describe: (a, ctx) => `Throw away the marking so far on this script in ${ctx.batchName(a.batchId)} and give it to ${a.graderId ? "the grader chosen" : "anyone on the batch"}${a.why ? ` — ${a.why}` : ""}. AI suggestions stay.`,
    run: (a, ctx) => require("./grading").reopenRun(a, ctx, { refuseIfStarted: false }),
  },

  shift_schedule: {
    label: "Move classes and exams",
    risk: "publish",
    // Everything not started yet in [from, to) moves by minutes (negative =
    // earlier). "Friday to Saturday" = Friday's day, 1440.
    schema: z.object({
      batchIds: z.array(id).min(1).max(20),
      from: isoDate,
      to: isoDate,
      minutes: z.number().int().min(-20160).max(20160).refine((v) => v !== 0, "not 0"),
      include: z.array(z.enum(["exams", "classes"])).min(1).optional(),
    }),
    batchesOf: (a) => a.batchIds,
    describe: (a, ctx) => `${(a.include || ["exams", "classes"]).join(" and ")} in ${names(a.batchIds, ctx)} from ${when(a.from, ctx.timezone)} to ${when(a.to, ctx.timezone)}, moved ${a.minutes > 0 ? "later" : "earlier"} by ${shiftText(Math.abs(a.minutes))}`,
    async preview(a, ctx) {
      const { exams, classes } = await scheduledIn(a);
      const move = (d) => when(new Date(new Date(d).getTime() + a.minutes * 60000), ctx.timezone);
      const items = [
        ...exams.map((e) => ({ tag: "exam", text: `${e.title}: ${when(e.opensAt, ctx.timezone)} → ${move(e.opensAt)}` })),
        ...classes.map((c) => ({ tag: "class", text: `${c.title}: ${when(c.scheduledAt, ctx.timezone)} → ${move(c.scheduledAt)}` })),
      ];
      return { summary: `${exams.length} exam${exams.length === 1 ? "" : "s"} and ${classes.length} class${classes.length === 1 ? "" : "es"} not started yet in that time.`, warn: !items.length, items };
    },
    async run(a, ctx) {
      const h = handlers();
      const { exams, classes } = await scheduledIn(a);
      const by = (d) => (d ? new Date(new Date(d).getTime() + a.minutes * 60000) : undefined);
      let moved = 0;
      const skipped = [];
      for (const e of exams) {
        try {
          await ctx.assertBatches(e.batches);
          await call(h.exam.updateExam, { user: ctx.user, params: { id: String(e._id) }, body: { opensAt: by(e.opensAt), closesAt: by(e.closesAt), unpublishAt: by(e.unpublishAt) } });
          moved += 1;
        } catch (err) { skipped.push(`${e.title} (${err.message})`); }
      }
      for (const c of classes) {
        try {
          await call(h.live.updateLiveClass, { user: ctx.user, params: { id: String(c._id) }, body: { scheduledAt: by(c.scheduledAt) } });
          moved += 1;
        } catch (err) { skipped.push(`${c.title} (${err.message})`); }
      }
      if (!moved && !skipped.length) throw new Error("Nothing not yet started in that time.");
      return { summary: `Moved ${moved}.${skipped.length ? ` Not moved: ${skipped.join("; ")}.` : ""}` };
    },
  },

  copy_schedule: {
    label: "Copy a week's exams, classes and notices",
    risk: "publish",
    // What was scheduled in [from, to), copied `days` later. Exams copy as
    // drafts unless publish is true (then only the ones that were published).
    schema: z.object({
      batchIds: z.array(id).min(1).max(20),
      from: isoDate,
      to: isoDate,
      days: z.number().int().min(1).max(60).default(7),
      include: z.array(z.enum(["exams", "classes", "notices"])).min(1).optional(),
      publish: z.boolean().optional(),
    }),
    batchesOf: (a) => a.batchIds,
    describe: (a, ctx) => `${(a.include || ["exams", "classes", "notices"]).join(", ")} in ${names(a.batchIds, ctx)} from ${when(a.from, ctx.timezone)} to ${when(a.to, ctx.timezone)}, copied ${a.days} day${a.days === 1 ? "" : "s"} later${a.publish ? " · exams published like the originals" : " · exams as drafts"}`,
    async preview(a, ctx) {
      const { exams, classes, notices } = await toCopy(a);
      const later = (d) => when(new Date(new Date(d).getTime() + a.days * 86400000), ctx.timezone);
      const items = [
        ...exams.map((e) => ({ tag: "exam", text: `${e.title} → ${later(e.opensAt)}` })),
        ...classes.map((c) => ({ tag: "class", text: `${c.title} → ${later(c.scheduledAt)}` })),
        ...notices.map((n) => ({ tag: "notice", text: `${n.title} → ${later(n.publishFrom || n.createdAt)}` })),
      ];
      return { summary: `${exams.length} exam${exams.length === 1 ? "" : "s"}, ${classes.length} class${classes.length === 1 ? "" : "es"}, ${notices.length} notice${notices.length === 1 ? "" : "s"} to copy.`, warn: !items.length, items };
    },
    async run(a, ctx) {
      const h = handlers();
      const { exams, classes, notices } = await toCopy(a);
      const later = (d) => (d ? new Date(new Date(d).getTime() + a.days * 86400000) : undefined);
      const mine = new Set(a.batchIds.map(String));
      let made = 0;
      const failed = [];
      for (const e of exams) {
        try {
          const copy = await call(h.exam.duplicateExam, { user: ctx.user, params: { id: String(e._id) }, body: { title: e.title } });
          const cid = String(copy._id);
          await call(h.exam.updateExam, { user: ctx.user, params: { id: cid }, body: { opensAt: later(e.opensAt), closesAt: later(e.closesAt), unpublishAt: later(e.unpublishAt) } });
          for (const b of (e.batches || []).map(String).filter((b) => mine.has(b))) {
            await call(h.assignment.assignToBatch, { user: ctx.user, params: { id: b, kind: "exams" }, body: { ids: [cid] } });
          }
          if (a.publish && e.isPublished) {
            await call(h.exam.setPublished, { user: ctx.user, params: { id: cid }, body: { isPublished: true } });
            if (e.isActive) await call(h.exam.setActive, { user: ctx.user, params: { id: cid }, body: { isActive: true } });
          }
          made += 1;
        } catch (err) { failed.push(`${e.title} (${err.message})`); }
      }
      for (const c of classes) {
        try {
          await call(h.live.createLiveClass, {
            user: ctx.user,
            body: {
              batch: String(c.batch), title: c.title, description: c.description, scheduledAt: later(c.scheduledAt), durationMinutes: c.durationMinutes,
              provider: c.provider, joinUrl: c.provider === "manual" ? c.joinUrl : undefined, mode: c.mode, teachers: c.teachers,
            },
          });
          made += 1;
        } catch (err) { failed.push(`${c.title} (${err.message})`); }
      }
      for (const n of notices) {
        try {
          const start = n.publishFrom || n.createdAt;
          await call(h.notice.createNotice, {
            user: ctx.user,
            body: {
              title: n.title, bodyMarkdown: n.bodyMarkdown, noticeType: n.noticeType, batches: (n.batches || []).map(String).filter((b) => mine.has(b)),
              coverImage: n.coverImage || undefined, icon: n.icon, link: n.link, linkLabel: n.linkLabel, pushText: n.pushText,
              isPublished: true, publishFrom: later(start), publishUntil: n.publishUntil ? later(n.publishUntil) : undefined,
            },
          });
          made += 1;
        } catch (err) { failed.push(`${n.title} (${err.message})`); }
      }
      if (!made && !failed.length) throw new Error("Nothing was scheduled in that time.");
      return { summary: `Copied ${made}.${failed.length ? ` Not copied: ${failed.join("; ")}.` : ""}` };
    },
  },

  assign_questions: {
    label: "Assign bank questions to batches",
    risk: "publish",
    // Published questions matching the filter that the batch lacks. At least
    // a subject, chapter or topic, so it never means the whole bank.
    schema: z.object({
      batchIds: z.array(id).min(1).max(20),
      subjectId: id.optional(),
      chapterIds: z.array(id).max(30).optional(),
      topicIds: z.array(id).max(50).optional(),
      types: z.array(z.enum(["mcq", "mtf", "written", "passage"])).min(1).optional(),
      difficulty: z.enum(["easy", "medium", "hard"]).optional(),
    }),
    batchesOf: (a) => a.batchIds,
    describe: (a, ctx) => `${a.types?.length ? a.types.join("/").toUpperCase() : "All"} published questions from ${a.chapterIds?.length ? a.chapterIds.map((c) => ctx.chapterName(c)).join(", ") : ctx.subjectName(a.subjectId)}${a.difficulty ? ` (${a.difficulty})` : ""} to ${names(a.batchIds, ctx)}`,
    async preview(a, ctx) {
      if (!narrowed(a)) return { summary: "Pick a subject, chapters or topics.", warn: true, items: [] };
      const per = await missingPer(a);
      return {
        summary: per.map((p) => `${ctx.batchName(p.batch)}: ${p.ids.length} to add`).join(" · ") || "No batches.",
        warn: per.every((p) => !p.ids.length),
        items: [],
      };
    },
    async run(a, ctx) {
      if (!narrowed(a)) throw new Error("Pick a subject, chapters or topics, so it never assigns the whole bank.");
      const h = handlers();
      const per = await missingPer(a);
      const lines = [];
      for (const p of per) {
        for (let i = 0; i < p.ids.length; i += 500) {
          await call(h.assignment.assignToBatch, { user: ctx.user, params: { id: String(p.batch), kind: "questions" }, body: { ids: p.ids.slice(i, i + 500).map(String) } });
        }
        lines.push(`${ctx.batchName(p.batch)}: ${p.ids.length}`);
      }
      return { summary: `Assigned ${lines.join(", ")}.` };
    },
  },

  split_grading: {
    label: "Hand out scripts to graders",
    risk: "staff",
    // Scripts nobody has started or holds, shared out evenly, oldest first.
    schema: z.object({
      batchId: id,
      exam: examRef.optional(),
      graderIds: z.array(id).min(1).max(20),
      limit: z.number().int().min(1).max(500).optional(),
    }),
    batchesOf: (a) => [a.batchId],
    describe: (a, ctx) => `${a.limit ? `Up to ${a.limit}` : "All"} unstarted scripts in ${ctx.batchName(a.batchId)}${a.exam ? " for that exam" : ""}, shared evenly between ${a.graderIds.length} grader${a.graderIds.length === 1 ? "" : "s"}`,
    async preview(a, ctx) {
      const subs = await unstartedScripts(a, ctx);
      const each = Math.floor(subs.length / a.graderIds.length);
      const extra = subs.length % a.graderIds.length;
      return { summary: `${subs.length} script${subs.length === 1 ? "" : "s"} waiting that nobody has started: about ${each}${extra ? `-${each + 1}` : ""} each.`, warn: !subs.length, items: [] };
    },
    async run(a, ctx) {
      const flow = require("../../utils/gradingFlow");
      const Batch = require("../../models/batchModel");
      const Submission = require("../../models/submissionModel");
      if (!flow.isPrivileged(ctx.user)) throw new Error("Only an owner or admin can hand out scripts.");
      const batch = await Batch.findById(a.batchId).select("teachers graders");
      const graders = [];
      for (const g of a.graderIds) {
        const staff = await flow.assertAssignable(g, batch);
        if (!staff) throw new Error("One of the graders isn't active or assigned to this batch.");
        graders.push(staff);
      }
      const subs = await unstartedScripts(a, ctx);
      if (!subs.length) throw new Error("No unstarted scripts are waiting.");
      const count = new Map();
      let i = 0;
      for (const s of subs) {
        const g = graders[i % graders.length];
        const r = await Submission.updateOne(
          { _id: s._id, status: "grading", heldBy: null },
          { $set: { heldBy: g._id, heldSince: new Date(), heldAssigned: true } },
        );
        if (r.modifiedCount) { count.set(g, (count.get(g) || 0) + 1); i += 1; }
      }
      return { summary: `Handed out ${i}: ${[...count].map(([g, n]) => `${g.name} ${n}`).join(", ")}.`, link: "/grading" };
    },
  },

  generate_questions: {
    label: "Write new questions with AI",
    risk: "safe",
    // Styled on the chapter's own published questions; they go to Review and,
    // when batchIds are given, are already assigned there once approved.
    schema: z.object({
      chapterId: id,
      topicId: id.optional(),
      types: z.array(z.enum(["mcq", "mtf", "written", "passage"])).min(1),
      count: z.number().int().min(1).max(20),
      difficulty: z.enum(["easy", "medium", "hard"]).optional(),
      language: z.enum(["en", "bn"]).optional(),
      batchIds: z.array(id).max(20).optional(),
    }),
    batchesOf: (a) => a.batchIds || [],
    describe: (a, ctx) => `${a.count} ${a.types.join("/").toUpperCase()} for ${ctx.chapterName(a.chapterId)}, to Review${a.batchIds?.length ? ` · for ${names(a.batchIds, ctx)} once approved` : ""}`,
    async preview(a) {
      const { Question } = require("../../models/questionModel");
      const n = await Question.countDocuments({ chapter: a.chapterId, status: "published", ...Question.IN_BANK });
      return { summary: n ? `Styled on ${Math.min(n, 5)} of the chapter's ${n} published questions. They go to Review first.` : "This chapter has no published questions to style new ones on.", warn: !n, items: [] };
    },
    async run(a, ctx) {
      const { Question } = require("../../models/questionModel");
      const base = { chapter: a.chapterId, status: "published", ...Question.IN_BANK };
      let examples = await Question.find({ ...base, type: { $in: a.types } }).select("_id").sort({ createdAt: -1 }).limit(5).lean();
      if (!examples.length) examples = await Question.find(base).select("_id").sort({ createdAt: -1 }).limit(5).lean();
      if (!examples.length) throw new Error("This chapter has no published questions to style new ones on. Use Generate from text instead.");
      // A passage can only be filed under a chapter.
      const topicId = a.types.includes("passage") ? null : a.topicId || null;
      const out = await call(require("../../controllers/admin/aiController").generateFromBank, {
        user: ctx.user,
        body: {
          exampleQuestionIds: examples.map((q) => String(q._id)), ...(topicId ? { topicId } : { chapterId: a.chapterId }),
          count: a.count, types: a.types, difficulty: a.difficulty || "medium", language: a.language,
        },
      });
      const ids = (out.questions || []).map((q) => q._id);
      if (a.batchIds?.length && ids.length) await Question.updateMany({ _id: { $in: ids } }, { $addToSet: { batches: { $each: a.batchIds } } });
      return { summary: `${out.message || `Generated ${ids.length}.`} Approve them in Review.`, link: "/review" };
    },
  },

  warn_flagged: {
    label: "Warn students with many flags",
    risk: "publish",
    // Students with at least minFlags exam flags / abusive messages in the
    // last sinceDays and no warning since. Each gets their own message,
    // written by AI from their record (or the note as is, when AI writing is off).
    schema: z.object({
      minFlags: z.number().int().min(1).max(100).default(3),
      sinceDays: z.number().int().min(1).max(365).default(7),
      kinds: z.array(z.enum(["examViolation", "abuse"])).min(1).optional(),
      note: z.string().max(800).optional(),
      language: z.enum(["en", "bn"]).optional(),
      max: z.number().int().min(1).max(50).default(30),
    }),
    describe: (a) => `Students with ${a.minFlags}+ ${(a.kinds || ["examViolation", "abuse"]).map((k) => (k === "abuse" ? "abusive messages" : "exam flags")).join(" or ")} in the last ${a.sinceDays} day${a.sinceDays === 1 ? "" : "s"} (up to ${a.max}), each sent a warning written from their record${a.note ? `, saying: ${a.note}` : ""}`,
    async preview(a, ctx) {
      if (!["owner", "admin"].includes(ctx.user.role)) return { summary: "Only an owner or admin can warn students.", warn: true, items: [] };
      const list = await flaggedStudents(a);
      return { summary: `${list.length} student${list.length === 1 ? "" : "s"} to warn.`, warn: !list.length, items: list.map((s) => ({ tag: `${s.n} flag${s.n === 1 ? "" : "s"}`, text: s.name })) };
    },
    async run(a, ctx) {
      if (!["owner", "admin"].includes(ctx.user.role)) throw new Error("Only an owner or admin can warn students.");
      const conduct = require("../../controllers/admin/conductController");
      const AiConfig = require("../../models/aiConfigModel");
      const aiOn = (await AiConfig.get()).features.writingHelp;
      if (!aiOn && !a.note) throw new Error("Write with AI is off: add the warning text as a note.");
      const list = await flaggedStudents(a);
      if (!list.length) throw new Error("Nobody matches.");
      let sent = 0;
      const failed = [];
      for (const s of list) {
        try {
          let message = a.note;
          if (aiOn) {
            const { writingTask } = require("../../ai/writing");
            const { conductFacts } = require("../../controllers/admin/aiWritingController");
            const ai = require("../../ai/service");
            const task = writingTask("conductMessage", { action: "warn", facts: await conductFacts({ studentId: String(s._id) }), prompt: a.note, language: a.language || "en" });
            message = (await ai.generate({ feature: "write-conductMessage", ...task, maxTokens: 800, user: ctx.user._id, wrapLatex: false })).data.message;
          }
          await call(conduct.actOnStudent, { user: ctx.user, params: { id: String(s._id) }, body: { action: "warn", message } });
          sent += 1;
        } catch (err) { failed.push(`${s.name} (${err.message})`); }
      }
      return { summary: `Warned ${sent}.${failed.length ? ` Not sent: ${failed.join("; ")}.` : ""}`, link: "/conduct" };
    },
  },
};

// Not yet started in [from, to): exams by opening time, scheduled classes.
const scheduledIn = async (a) => {
  const Exam = require("../../models/examModel");
  const LiveClass = require("../../models/liveClassModel");
  const include = a.include || ["exams", "classes"];
  const now = new Date();
  const from = new Date(Math.max(new Date(a.from).getTime(), now.getTime()));
  const to = new Date(a.to);
  const [exams, classes] = await Promise.all([
    include.includes("exams")
      ? Exam.find({ batches: { $in: a.batchIds }, createdByStudent: null, opensAt: { $gte: from, $lt: to } }).select("title batches opensAt closesAt unpublishAt").sort({ opensAt: 1 }).lean()
      : [],
    include.includes("classes")
      ? LiveClass.find({ batch: { $in: a.batchIds }, status: "scheduled", scheduledAt: { $gte: from, $lt: to } }).select("title scheduledAt").sort({ scheduledAt: 1 }).lean()
      : [],
  ]);
  return { exams, classes };
};

// What was scheduled in [from, to), to copy.
const toCopy = async (a) => {
  const Exam = require("../../models/examModel");
  const LiveClass = require("../../models/liveClassModel");
  const Notice = require("../../models/noticeModel");
  const include = a.include || ["exams", "classes", "notices"];
  const range = { $gte: new Date(a.from), $lt: new Date(a.to) };
  const [exams, classes, notices] = await Promise.all([
    include.includes("exams") ? Exam.find({ batches: { $in: a.batchIds }, createdByStudent: null, opensAt: range }).sort({ opensAt: 1 }).lean() : [],
    include.includes("classes") ? LiveClass.find({ batch: { $in: a.batchIds }, status: { $ne: "cancelled" }, scheduledAt: range }).sort({ scheduledAt: 1 }).lean() : [],
    include.includes("notices")
      ? Notice.find({ batches: { $in: a.batchIds }, noticeType: { $ne: "general" }, $or: [{ publishFrom: range }, { publishFrom: null, createdAt: range }] }).sort({ createdAt: 1 }).lean()
      : [],
  ]);
  return { exams, classes, notices };
};

const narrowed = (a) => Boolean(a.subjectId || a.chapterIds?.length || a.topicIds?.length);

// For each batch: matching published questions it doesn't have yet.
const missingPer = async (a) => {
  const { Question } = require("../../models/questionModel");
  const q = { status: "published", ...Question.IN_BANK };
  if (a.subjectId) q.subject = a.subjectId;
  if (a.chapterIds?.length) q.chapter = { $in: a.chapterIds };
  if (a.topicIds?.length) q.topic = { $in: a.topicIds };
  if (a.types?.length) q.type = { $in: a.types };
  if (a.difficulty) q.difficulty = a.difficulty;
  const out = [];
  for (const b of a.batchIds) {
    const ids = (await Question.find({ ...q, batches: { $ne: b } }).select("_id").limit(5000).lean()).map((x) => x._id);
    out.push({ batch: b, ids });
  }
  return out;
};

// Scripts waiting in the batch that nobody holds, has claimed or marked.
const unstartedScripts = async (a, ctx) => {
  const flow = require("../../utils/gradingFlow");
  const Submission = require("../../models/submissionModel");
  const q = { batch: a.batchId, status: "grading", heldBy: null };
  if (a.exam) {
    const examId = ctx.resolve(a.exam, "examId");
    q.exam = examId;
  }
  const subs = await Submission.find(q).select("answers claimedBy claimedAt submittedAt").sort({ submittedAt: 1 }).limit(a.limit || 500);
  return subs.filter((s) => !s.claimedBy && flow.isUntouched(s));
};

// Students over the flag count in the window, not warned since it began.
const flaggedStudents = async (a) => {
  const ConductEvent = require("../../models/conductEventModel");
  const Student = require("../../models/studentModel");
  const since = new Date(Date.now() - a.sinceDays * 86400000);
  const kinds = a.kinds || ["examViolation", "abuse"];
  const rows = await ConductEvent.aggregate([
    { $match: { kind: { $in: kinds }, status: { $ne: "dismissed" }, createdAt: { $gte: since } } },
    { $group: { _id: "$student", n: { $sum: { $cond: [{ $eq: ["$kind", "examViolation"] }, { $ifNull: ["$count", 1] }, 1] } } } },
    { $match: { n: { $gte: a.minFlags } } },
    { $sort: { n: -1 } },
  ]);
  const warned = new Set((await ConductEvent.find({ kind: "warning", createdAt: { $gte: since }, student: { $in: rows.map((r) => r._id) } }).select("student").lean()).map((e) => String(e.student)));
  const keep = rows.filter((r) => !warned.has(String(r._id))).slice(0, a.max);
  const students = await Student.find({ _id: { $in: keep.map((r) => r._id) }, deletedAt: null }).select("name").lean();
  const name = new Map(students.map((s) => [String(s._id), s.name]));
  return keep.filter((r) => name.has(String(r._id))).map((r) => ({ _id: r._id, n: r.n, name: name.get(String(r._id)) }));
};

const shiftText = (m) => (m % 1440 === 0 ? `${m / 1440} day${m === 1440 ? "" : "s"}` : m % 60 === 0 ? `${m / 60} hour${m === 60 ? "" : "s"}` : `${m} minutes`);

// Drawers: the copilot's tools by area, so a request looks only at the
// tools of the areas it touches (agents/engine.js).
const DRAWER_OF = {
  exams: ["create_exam", "add_questions", "write_exam_description", "publish_exam", "close_exam", "unpublish_exam"],
  notices: ["post_notice"],
  classes: ["schedule_live_class", "shift_schedule", "copy_schedule"],
  grading: ["reopen_script", "split_grading", "warn_flagged"],
  questions: ["assign_questions", "generate_questions"],
};
for (const [drawer, names] of Object.entries(DRAWER_OF)) for (const n of names) if (tools[n]) tools[n].drawer = drawer;

module.exports = { tools, questionPool };
