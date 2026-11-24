const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const crypto = require("crypto");
const Lecture = require("../../models/lectureModel");
const DocChunk = require("../../models/docChunkModel");
const AiConfig = require("../../models/aiConfigModel");
const AiUsage = require("../../models/aiUsageModel");
const AiCredit = require("../../models/aiCreditModel");
const PoraSession = require("../../models/poraSessionModel");
const PoraPack = require("../../models/poraPackModel");
const aiService = require("../../ai/service");
const tts = require("../../ai/tts");
const prompts = require("../../ai/prompts");
const schemas = require("../../ai/schemas");
const docText = require("../../utils/docText");

// Oral Quiz: an AI teacher asks a student about one lecture, out loud or in
// text, follows up, marks each answer, and writes a short report.
//
// Billing works like course chat (docChatController.js): with free daily
// questions set, a main question is counted when the student first answers
// it, from today's free ones, then from a pack bought with AI credits. The
// AI calls themselves are then already paid (prepaid). Follow-ups, hints,
// skips and the report are free. A failed AI call gives the question back.
// With no daily limit, every AI call is charged like any other.

const MATERIAL_CHARS = 14000;
const MAX_HINTS = 3;
const FEATURE = "pora-dhora";

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const settingsOf = (config) => {
  const s = config.poraDhora || {};
  return {
    dailyQuestions: s.dailyQuestions ?? 10,
    packSize: s.packSize ?? 10,
    packCost: s.packCost || 2,
    packCarryOver: Boolean(s.packCarryOver),
    questionsPerSession: s.questionsPerSession || 5,
    followUps: s.followUps ?? 1,
    layout: s.layout || "call",
    layoutSwitch: s.layoutSwitch !== false,
    speak: s.speak !== false,
    teacherName: s.teacherName || "",
  };
};

const packOffer = (s) => (s.packSize > 0 ? { packSize: s.packSize, packCost: s.packCost } : null);

const allowance = async (student, batch, s) => {
  const doc = await PoraPack.findOne({ student, batch }).lean();
  const day = today();
  const packLive = s.packCarryOver || doc?.packDay === day;
  return { usedToday: doc?.day === day ? doc.usedToday || 0 : 0, remaining: packLive ? doc?.remaining || 0 : 0 };
};

const countFree = async (student, batch) => {
  const day = today();
  const bumped = await PoraPack.updateOne({ student, batch, day }, { $inc: { usedToday: 1 } });
  if (!bumped.matchedCount) await PoraPack.updateOne({ student, batch }, { $set: { day, usedToday: 1 } }, { upsert: true });
};

const limitMessage = (s, offer) =>
  offer
    ? `You've used today's ${s.dailyQuestions} free Oral Quiz questions. Unlock ${offer.packSize} more for ${offer.packCost} AI credit${offer.packCost === 1 ? "" : "s"}, or come back tomorrow.`
    : `You've answered today's ${s.dailyQuestions} Oral Quiz questions. It resets tomorrow.`;

const assertEnabled = async () => {
  const config = await AiConfig.get();
  if (!config.features.poraDhora) {
    throw Object.assign(new Error("Oral Quiz is switched off."), { statusCode: 403 });
  }
  return config;
};

// The lecture's material as numbered excerpts: the same set every turn of a
// session (in lecture order, spread across it when it is long).
const materialOf = async (lectureId) => {
  const chunks = await DocChunk.find({ lecture: lectureId }).sort({ order: 1 }).select("text source page").lean();
  let picked = chunks;
  const total = chunks.reduce((n, c) => n + c.text.length, 0);
  if (total > MATERIAL_CHARS) {
    const avg = total / chunks.length;
    const want = Math.max(1, Math.floor(MATERIAL_CHARS / avg));
    const step = chunks.length / want;
    picked = Array.from({ length: want }, (_, i) => chunks[Math.floor(i * step)]);
  }
  return picked.map((chunk, i) => ({
    n: i + 1,
    chunk,
    label: chunk.source.kind === "notes" ? `Notes${chunk.source.title && chunk.source.title !== "Notes" ? ` · ${chunk.source.title}` : ""}` : `${chunk.source.title || "File"}${chunk.page ? ` · p.${chunk.page}` : ""}`,
    text: chunk.text,
  }));
};

// The material's language: Bangla when Bangla letters are a good part of
// its letters (formulas and terms stay Latin in Bangla-medium notes).
const languageOf = (excerpts) => {
  const text = excerpts.map((e) => e.text).join(" ");
  const bn = (text.match(/[\u0980-\u09FF]/g) || []).length;
  const en = (text.match(/[A-Za-z]/g) || []).length;
  return bn > en * 0.4 ? "Bangla" : "English";
};

// Notes as plain reading text: no pictures, heading marks, bullets, bold or
// link syntax. Maths ($...$) stays for the app to render.
const readable = (text) => String(text || "")
  .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
  .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
  .replace(/^\s{0,3}#{1,6}\s.*$/gm, " ")
  .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, "")
  .replace(/\*\*|__/g, "")
  .replace(/\s+/g, " ")
  .trim();

// The sentence holding the quoted line and its neighbours, cut at sentence
// ends (never inside a formula), for the page layout.
const passageAround = (text, quote) => {
  const clean = readable(text);
  const maths = [];
  const masked = clean.replace(/\$\$[\s\S]+?\$\$|\$[^$]+?\$/g, (m) => `\u0000${maths.push(m) - 1}\u0000`);
  const unmask = (x) => x.replace(/\u0000(\d+)\u0000/g, (_, i) => maths[i]);
  const sentences = masked.split(/(?<=[.!?।])\s+/).map(unmask);
  const q = readable(quote).toLowerCase().slice(0, 40);
  let at = q ? sentences.findIndex((x) => x.toLowerCase().includes(q)) : 0;
  if (at < 0) at = 0;
  let from = at;
  let to = at + 1;
  const len = () => sentences.slice(from, to).join(" ").length;
  while (len() < 450 && (from > 0 || to < sentences.length)) {
    if (to < sentences.length && len() + sentences[to].length <= 520) to += 1;
    else if (from > 0 && len() + sentences[from - 1].length <= 520) from -= 1;
    else break;
  }
  return `${from > 0 ? "… " : ""}${sentences.slice(from, to).join(" ")}${to < sentences.length ? " …" : ""}`;
};

const shapeSession = (s, { full = true } = {}) => ({
  _id: s._id,
  lecture: s.lecture,
  lectureTitle: s.lectureTitle,
  language: s.language || "English",
  status: s.status,
  asked: s.asked,
  limit: s.limit,
  hintsLeft: Math.max(0, MAX_HINTS - (s.hints || 0)),
  marks: s.marks,
  score: s.report?.score ?? null,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
  ...(full ? { turns: s.turns, report: s.report || null } : {}),
});

// One AI teacher turn. Throws on failure; the caller gives back what it took.
const teacherTurn = async ({ req, config, s, session, excerpts, studentTurn, prepaid }) => {
  const { system, prompt } = prompts.poraTurn({
    title: session.lectureTitle,
    excerpts,
    turns: session.turns.slice(-24),
    studentTurn,
    asked: session.asked,
    limit: session.limit,
    followUpsLeft: Math.max(0, s.followUps - session.followUpsNow),
    teacherName: s.teacherName,
    language: session.language || "English",
  });
  const { data } = await aiService.generate({
    feature: FEATURE,
    schema: schemas.poraTurn,
    wrapLatex: false,
    student: req.student._id,
    batch: req.batch._id,
    system,
    prompt,
    maxTokens: 700,
    prepaid,
  });
  return data;
};

// Applies the teacher's turn to the session (the student's turn is already on it).
const applyTurn = (session, data, studentTurn, excerpts, s) => {
  const q = session.asked;
  let next = data.next;
  if (studentTurn?.kind === "hint") next = "hint";
  else if (next === "hint") next = "followUp";
  if (next === "followUp" && session.followUpsNow >= s.followUps) next = "question";
  if (next === "followUp" && studentTurn?.kind === "skip") next = "question";
  if (next === "question" && session.asked >= session.limit) next = "finish";
  if (!studentTurn) next = "question";

  if (studentTurn && studentTurn.kind !== "hint") {
    const verdict = studentTurn.kind === "skip" ? "skipped" : ["correct", "partial", "wrong"].includes(data.verdict) ? data.verdict : "partial";
    const marks = verdict === "skipped" ? 0 : Math.round(Math.min(10, Math.max(0, Number(data.marks) || (verdict === "correct" ? 8 : verdict === "partial" ? 5 : 1))));
    // A follow-up's answer settles the question's mark.
    session.marks[q - 1] = marks;
    session.markModified("marks");
    session.turns.push({ role: "teacher", kind: "feedback", text: String(data.feedback || "").trim() || (verdict === "correct" ? "Good." : verdict === "skipped" ? "Alright, let's move on." : "Not quite."), q, verdict });
  }

  if (next === "finish") {
    session.turns.push({ role: "teacher", kind: "closing", text: data.say, q });
    return "finish";
  }

  const turn = { role: "teacher", kind: next, text: data.say, q: next === "question" ? q + 1 : q };
  if (next === "question" || next === "followUp") {
    const ex = excerpts[(Number(data.excerpt) || 0) - 1];
    if (ex && data.quote && docText.quoteIn(data.quote, ex.text)) {
      turn.quote = readable(data.quote);
      turn.passage = passageAround(ex.text, turn.quote);
      turn.sourceTitle = ex.label;
    }
  }
  session.turns.push(turn);
  if (next === "question") {
    session.asked += 1;
    session.followUpsNow = 0;
  } else if (next === "followUp") session.followUpsNow += 1;
  else if (next === "hint") session.hints += 1;
  return next;
};

const finishSession = async ({ req, session, prepaid }) => {
  session.status = "done";
  session.endedAt = new Date();
  const marks = session.marks.filter((m) => typeof m === "number");
  const score = marks.length ? Math.round((marks.reduce((a, b) => a + b, 0) / (session.limit * 10)) * 100) : 0;
  let report = { score, criteria: [], strengths: [], weaknesses: [], remark: "" };
  if (marks.length) {
    try {
      const { system, prompt } = prompts.poraReport({ title: session.lectureTitle, turns: session.turns.slice(-60), marks, language: session.language || "English" });
      const { data } = await aiService.generate({
        feature: FEATURE,
        schema: schemas.poraReport,
        wrapLatex: false,
        student: req.student._id,
        batch: req.batch._id,
        system,
        prompt,
        maxTokens: 600,
        prepaid,
      });
      report = { score, ...data };
    } catch {
      // The marks still stand without the written part.
    }
  }
  session.report = report;
};

//@desc   Oral Quiz settings and today's allowance
//@route  GET /api/app/batches/:batchId/pora/settings
const getPoraSettings = asyncHandler(async (req, res) => {
  const config = await AiConfig.get();
  const s = settingsOf(config);
  const [{ usedToday, remaining }, credits, voice] = await Promise.all([
    allowance(req.student._id, req.batch._id, s),
    AiCredit.find({ student: req.student._id, batch: { $in: [req.batch._id, null] } }).select("batch balance").lean(),
    tts.status(),
  ]);
  res.status(200).json({
    enabled: Boolean(config.features.poraDhora),
    freePerDay: s.dailyQuestions,
    usedToday,
    packRemaining: remaining,
    availableToday: s.dailyQuestions ? Math.max(0, s.dailyQuestions - usedToday) + remaining : null,
    offer: packOffer(s),
    credits: { batch: credits.find((c) => c.batch)?.balance || 0, general: credits.find((c) => !c.batch)?.balance || 0 },
    questionsPerSession: s.questionsPerSession,
    layout: s.layout,
    layoutSwitch: s.layoutSwitch,
    voice: s.speak && voice.ready,
    teacherName: s.teacherName,
    maxHints: MAX_HINTS,
  });
});

//@desc   Start (or resume) a session on a lecture
//@route  POST /api/app/batches/:batchId/pora/start
const startSession = asyncHandler(async (req, res) => {
  const config = await assertEnabled();
  const s = settingsOf(config);
  const lectureId = req.body.lectureId;
  if (!mongoose.isValidObjectId(lectureId)) {
    res.status(400);
    throw new Error("Pick a lecture first.");
  }
  const lecture = await Lecture.findOne({ _id: lectureId, batches: req.batch._id, isPublished: true }).select("title docIndex").lean();
  if (!lecture) {
    res.status(404);
    throw new Error("Lecture not found in this batch.");
  }

  const open = await PoraSession.findOne({ student: req.student._id, batch: req.batch._id, lecture: lecture._id, status: "active" });
  if (open && !req.body.fresh) {
    res.status(200).json({ session: shapeSession(open), resumed: true });
    return;
  }

  if (!lecture.docIndex?.status || lecture.docIndex.status === "none") {
    require("../../utils/docIndex").indexMissing([lecture._id]).catch(() => {});
  }
  const excerpts = await materialOf(lecture._id);
  if (!excerpts.length) {
    res.status(409);
    throw new Error(lecture.docIndex?.status === "indexing" || !lecture.docIndex?.status || lecture.docIndex.status === "none"
      ? "This lecture's notes are still being prepared. Try again in a minute."
      : "This lecture has no notes or readable files to be asked about yet.");
  }

  const capped = s.dailyQuestions > 0;
  if (capped) {
    const { usedToday, remaining } = await allowance(req.student._id, req.batch._id, s);
    if (usedToday >= s.dailyQuestions && remaining < 1) {
      const offer = packOffer(s);
      res.status(429).json({ message: limitMessage(s, offer), limitReached: true, offer });
      return;
    }
  }

  if (open) {
    open.status = "done";
    open.endedAt = new Date();
    await open.save();
  }
  const session = new PoraSession({
    student: req.student._id,
    batch: req.batch._id,
    lecture: lecture._id,
    lectureTitle: lecture.title,
    limit: s.questionsPerSession,
    language: languageOf(excerpts),
  });
  const data = await teacherTurn({ req, config, s, session, excerpts, studentTurn: null, prepaid: capped });
  applyTurn(session, data, null, excerpts, s);
  await session.save();
  res.status(201).json({ session: shapeSession(session) });
});

//@desc   The student answers, skips, or asks for a hint
//@route  POST /api/app/batches/:batchId/pora/sessions/:id/turn
const takeTurn = asyncHandler(async (req, res) => {
  const config = await assertEnabled();
  const s = settingsOf(config);
  const session = mongoose.isValidObjectId(req.params.id)
    ? await PoraSession.findOne({ _id: req.params.id, student: req.student._id, batch: req.batch._id })
    : null;
  if (!session) {
    res.status(404);
    throw new Error("Session not found.");
  }
  if (session.status !== "active") {
    res.status(409);
    throw new Error("This session has ended.");
  }
  const kind = ["answer", "skip", "hint"].includes(req.body.kind) ? req.body.kind : "answer";
  const text = String(req.body.text || "").trim().slice(0, 1500);
  if (kind === "answer" && !text) {
    res.status(400);
    throw new Error("Say your answer first.");
  }
  if (kind === "hint" && session.hints >= MAX_HINTS) {
    res.status(400);
    throw new Error("No hints left in this session.");
  }
  const last = [...session.turns].reverse().find((t) => t.role === "teacher");
  if (last?.kind === "closing") {
    res.status(409);
    throw new Error("This session has ended.");
  }

  // A main question is counted on its first answer.
  const capped = s.dailyQuestions > 0;
  const q = session.asked;
  let took = null; // "free" | "pack"
  if (capped && kind === "answer" && session.paidQ < q) {
    const { usedToday } = await allowance(req.student._id, req.batch._id, s);
    if (usedToday < s.dailyQuestions) took = "free";
    else {
      const taken = await PoraPack.findOneAndUpdate(
        { student: req.student._id, batch: req.batch._id, remaining: { $gte: 1 }, ...(s.packCarryOver ? {} : { packDay: today() }) },
        { $inc: { remaining: -1 } }
      );
      if (!taken) {
        const offer = packOffer(s);
        res.status(429).json({ message: limitMessage(s, offer), limitReached: true, offer });
        return;
      }
      took = "pack";
    }
  }

  const studentTurn = { role: "student", kind, text: kind === "skip" ? "(skipped)" : kind === "hint" ? "(hint please)" : text, q };
  const excerpts = await materialOf(session.lecture);
  let data;
  try {
    data = await teacherTurn({ req, config, s, session, excerpts, studentTurn, prepaid: capped });
  } catch (error) {
    if (took === "pack") await PoraPack.updateOne({ student: req.student._id, batch: req.batch._id }, { $inc: { remaining: 1 } });
    throw error;
  }
  if (took === "free") await countFree(req.student._id, req.batch._id);
  if (took) session.paidQ = q;

  session.turns.push(studentTurn);
  const next = applyTurn(session, data, studentTurn, excerpts, s);
  if (next === "finish") await finishSession({ req, session, prepaid: capped });
  await session.save();
  res.status(200).json({ session: shapeSession(session) });
});

//@desc   End a session now, with a report on what was answered
//@route  POST /api/app/batches/:batchId/pora/sessions/:id/end
const endSession = asyncHandler(async (req, res) => {
  const config = await AiConfig.get();
  const s = settingsOf(config);
  const session = mongoose.isValidObjectId(req.params.id)
    ? await PoraSession.findOne({ _id: req.params.id, student: req.student._id, batch: req.batch._id })
    : null;
  if (!session) {
    res.status(404);
    throw new Error("Session not found.");
  }
  if (session.status === "active") {
    // Only questions actually answered count toward the score.
    session.limit = Math.max(1, session.marks.filter((m) => typeof m === "number").length);
    await finishSession({ req, session, prepaid: s.dailyQuestions > 0 });
    await session.save();
  }
  res.status(200).json({ session: shapeSession(session) });
});

//@desc   The student's sessions in this batch (optionally one lecture's)
//@route  GET /api/app/batches/:batchId/pora/sessions?lecture=
const listSessions = asyncHandler(async (req, res) => {
  const filter = { student: req.student._id, batch: req.batch._id };
  if (mongoose.isValidObjectId(req.query.lecture)) filter.lecture = req.query.lecture;
  const sessions = await PoraSession.find(filter).sort({ updatedAt: -1 }).limit(30).select("-turns");
  res.status(200).json({ sessions: sessions.map((x) => shapeSession(x, { full: false })) });
});

//@desc   One session
//@route  GET /api/app/batches/:batchId/pora/sessions/:id
const getSession = asyncHandler(async (req, res) => {
  const session = mongoose.isValidObjectId(req.params.id)
    ? await PoraSession.findOne({ _id: req.params.id, student: req.student._id, batch: req.batch._id })
    : null;
  if (!session) {
    res.status(404);
    throw new Error("Session not found.");
  }
  res.status(200).json(shapeSession(session));
});

//@desc   Delete one of the student's sessions
//@route  DELETE /api/app/batches/:batchId/pora/sessions/:id
const deleteSession = asyncHandler(async (req, res) => {
  const result = mongoose.isValidObjectId(req.params.id)
    ? await PoraSession.deleteOne({ _id: req.params.id, student: req.student._id, batch: req.batch._id })
    : { deletedCount: 0 };
  if (!result.deletedCount) {
    res.status(404);
    throw new Error("Session not found.");
  }
  res.status(200).json({ deleted: true });
});

//@desc   Buy more Oral Quiz questions with AI credits (this batch's first)
//@route  POST /api/app/batches/:batchId/pora/unlock
const unlockPack = asyncHandler(async (req, res) => {
  const config = await assertEnabled();
  const s = settingsOf(config);
  const offer = packOffer(s);
  if (!offer) {
    res.status(400);
    throw new Error("Extra Oral Quiz questions aren't on sale.");
  }
  const student = req.student._id;
  const balances = await AiCredit.find({ student, batch: { $in: [req.batch._id, null] } }).select("batch balance").lean();
  const batchBalance = Math.max(0, balances.find((c) => c.batch)?.balance || 0);
  const generalBalance = Math.max(0, balances.find((c) => !c.batch)?.balance || 0);
  const parts = [];
  if (batchBalance + generalBalance >= offer.packCost) {
    const fromBatch = Math.min(batchBalance, offer.packCost);
    if (fromBatch) parts.push({ batch: req.batch._id, amount: fromBatch });
    if (offer.packCost - fromBatch) parts.push({ batch: null, amount: offer.packCost - fromBatch });
  }
  const taken = [];
  let ok = parts.length > 0;
  for (const part of parts) {
    const spent = await AiCredit.updateOne({ student, batch: part.batch, balance: { $gte: part.amount } }, { $inc: { balance: -part.amount } });
    if (!spent.modifiedCount) {
      ok = false;
      break;
    }
    taken.push(part);
  }
  if (!ok) {
    for (const t of taken) await AiCredit.updateOne({ student, batch: t.batch }, { $inc: { balance: t.amount } });
    res.status(402).json({
      message: `Unlocking ${offer.packSize} more questions costs ${offer.packCost} AI credit${offer.packCost === 1 ? "" : "s"}, and you don't have enough. Buy AI credits first.`,
      needCredits: true,
    });
    return;
  }
  AiUsage.create({ feature: "pora-dhora-pack", provider: "credits", student, batch: req.batch._id, ok: true, featureCost: 0, paidWithCredit: true, creditsSpent: offer.packCost }).catch(() => {});

  const day = today();
  const filter = { student, batch: req.batch._id };
  let pack = await PoraPack.findOneAndUpdate(
    s.packCarryOver ? filter : { ...filter, packDay: day },
    { $inc: { remaining: offer.packSize }, $set: { packDay: day } },
    { new: true }
  );
  if (!pack) pack = await PoraPack.findOneAndUpdate(filter, { $set: { remaining: offer.packSize, packDay: day } }, { upsert: true, new: true });
  res.status(200).json({ remaining: pack.remaining, message: `Unlocked ${offer.packSize} more questions.` });
});

// The teacher's lines, spoken: kept a little while, so a replay or a second
// look doesn't call the voice server again.
const spoken = new Map();
const SPOKEN_MAX = 200;

//@desc   The teacher's line as speech (MP3)
//@route  POST /api/app/batches/:batchId/pora/speak
const speak = asyncHandler(async (req, res) => {
  const config = await assertEnabled();
  if (!settingsOf(config).speak) {
    res.status(400);
    throw new Error("The teacher's voice is switched off.");
  }
  const text = String(req.body.text || "").trim().slice(0, 900);
  if (!text) {
    res.status(400);
    throw new Error("Nothing to say.");
  }
  const key = crypto.createHash("sha1").update(text).digest("hex");
  let audio = spoken.get(key);
  if (!audio) {
    audio = await tts.speak(text);
    spoken.set(key, audio);
    if (spoken.size > SPOKEN_MAX) spoken.delete(spoken.keys().next().value);
  }
  res.set("Content-Type", "audio/mpeg");
  res.set("Cache-Control", "private, max-age=3600");
  res.status(200).send(audio);
});

module.exports = { today, materialOf, languageOf, readable, passageAround, deleteSession, getPoraSettings, startSession, takeTurn, endSession, listSessions, getSession, unlockPack, speak, shapeSession };
