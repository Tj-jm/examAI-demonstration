const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Lecture = require("../../models/lectureModel");
const AiConfig = require("../../models/aiConfigModel");
const AiUsage = require("../../models/aiUsageModel");
const AiCredit = require("../../models/aiCreditModel");
const TutorSession = require("../../models/tutorSessionModel");
const TutorPack = require("../../models/tutorPackModel");
const aiService = require("../../ai/service");
const prompts = require("../../ai/prompts");
const schemas = require("../../ai/schemas");
const docText = require("../../utils/docText");
const storage = require("../../adapters/storage");
const { toAbsoluteUrl, assertOwnMediaUrl, recordStudentUpload } = require("../../utils/mediaUrl");
const { preparePhoto } = require("../../utils/photo");
const { today, materialOf, languageOf, readable, passageAround } = require("./poraController");

// AI Tutoring: an AI tutor checks in writing whether a student understood a
// lecture. Three layouts, fixed per session when it starts:
//   chat, book — questions, follow-ups and hints, each answer marked (the
//                same turn engine as Oral Quiz, poraController.js);
//   paper      — one creative question: a stimulus and four parts worth
//                1, 2, 3 and 4 marks, each marked like a board examiner.
//
// Billing is Oral Quiz's: with free daily questions set, a main question (or
// a paper part) is counted when first answered, from today's free ones, then
// from a pack bought with AI credits, and the AI calls are prepaid. Follow-
// ups, hints, skips and the report are free. A failed AI call gives the
// question back. With no daily limit, every AI call is charged.

const MAX_HINTS = 3;
const FEATURE = "ai-tutor";
const PART_MARKS = [1, 2, 3, 4];
const LAYOUTS = ["chat", "book", "paper"];
// Drawn pages or photos per answer.
const MAX_IMAGES = 4;

const settingsOf = (config) => {
  const s = config.aiTutor || {};
  return {
    dailyQuestions: s.dailyQuestions ?? 10,
    packSize: s.packSize ?? 10,
    packCost: s.packCost || 2,
    packCarryOver: Boolean(s.packCarryOver),
    questionsPerSession: s.questionsPerSession || 5,
    followUps: s.followUps ?? 1,
    layout: LAYOUTS.includes(s.layout) ? s.layout : "chat",
    tutorName: s.tutorName || "",
    partMarks: Array.isArray(s.partMarks) && s.partMarks.length === PART_MARKS.length ? s.partMarks.map((m) => Math.max(1, Number(m) || 1)) : PART_MARKS,
    scoring: {
      strictness: ["lenient", "normal", "strict"].includes(s.strictness) ? s.strictness : "normal",
      hintPenalty: Math.max(0, Number(s.hintPenalty) || 0),
      stepMarking: Boolean(s.stepMarking),
      criteriaWeight: Math.min(50, Math.max(0, Number(s.criteriaWeight) || 0)),
    },
  };
};

// A session's scoring: as it was when it started (older sessions: defaults).
const scoringOf = (session) => ({
  strictness: session.scoring?.strictness || "normal",
  hintPenalty: session.scoring?.hintPenalty || 0,
  stepMarking: Boolean(session.scoring?.stepMarking),
  criteriaWeight: session.scoring?.criteriaWeight || 0,
});

const packOffer = (s) => (s.packSize > 0 ? { packSize: s.packSize, packCost: s.packCost } : null);

const allowance = async (student, batch, s) => {
  const doc = await TutorPack.findOne({ student, batch }).lean();
  const day = today();
  const packLive = s.packCarryOver || doc?.packDay === day;
  return { usedToday: doc?.day === day ? doc.usedToday || 0 : 0, remaining: packLive ? doc?.remaining || 0 : 0 };
};

const countFree = async (student, batch) => {
  const day = today();
  const bumped = await TutorPack.updateOne({ student, batch, day }, { $inc: { usedToday: 1 } });
  if (!bumped.matchedCount) await TutorPack.updateOne({ student, batch }, { $set: { day, usedToday: 1 } }, { upsert: true });
};

const limitMessage = (s, offer) =>
  offer
    ? `You've used today's ${s.dailyQuestions} free AI Tutoring questions. Unlock ${offer.packSize} more for ${offer.packCost} AI credit${offer.packCost === 1 ? "" : "s"}, or come back tomorrow.`
    : `You've answered today's ${s.dailyQuestions} AI Tutoring questions. It resets tomorrow.`;

// Takes one question from today's free ones or the pack. Returns "free",
// "pack", or null when none is left (the response is already sent).
const takeQuestion = async (req, res, s) => {
  const { usedToday } = await allowance(req.student._id, req.batch._id, s);
  if (usedToday < s.dailyQuestions) return "free";
  const taken = await TutorPack.findOneAndUpdate(
    { student: req.student._id, batch: req.batch._id, remaining: { $gte: 1 }, ...(s.packCarryOver ? {} : { packDay: today() }) },
    { $inc: { remaining: -1 } }
  );
  if (taken) return "pack";
  const offer = packOffer(s);
  res.status(429).json({ message: limitMessage(s, offer), limitReached: true, offer });
  return null;
};
const giveBack = (req, took) => (took === "pack"
  ? TutorPack.updateOne({ student: req.student._id, batch: req.batch._id }, { $inc: { remaining: 1 } })
  : null);
const settle = (req, took) => (took === "free" ? countFree(req.student._id, req.batch._id) : null);

const assertEnabled = async () => {
  const config = await AiConfig.get();
  if (!config.features.aiTutor) {
    throw Object.assign(new Error("AI Tutoring is switched off."), { statusCode: 403 });
  }
  return config;
};

const ask = (req, schema, { system, prompt }, maxTokens, prepaid, images = []) => aiService.generate({
  ...(images.length ? { imageUrls: images.map((u) => toAbsoluteUrl(req, u)) } : {}),
  feature: FEATURE,
  schema,
  wrapLatex: false,
  student: req.student._id,
  batch: req.batch._id,
  system,
  prompt,
  maxTokens,
  prepaid,
}).then((r) => r.data);

const paperScore = (paper) => (paper?.parts || []).reduce((n, p) => n + (typeof p.got === "number" ? p.got : 0), 0);
const paperTotal = (paper) => (paper?.parts || []).reduce((n, p) => n + (p.marks || 0), 0) || 10;

// Hints the student asked for on main question q.
const hintsOn = (session, q) => session.turns.filter((t) => t.role === "student" && t.kind === "hint" && t.q === q).length;

const shapeSession = (s, { full = true } = {}) => ({
  _id: s._id,
  lecture: s.lecture,
  lectureTitle: s.lectureTitle,
  language: s.language || "English",
  layout: s.layout || "chat",
  status: s.status,
  asked: s.asked,
  limit: s.limit,
  hintsLeft: Math.max(0, MAX_HINTS - (s.hints || 0)),
  hintPenalty: s.scoring?.hintPenalty || 0,
  marks: s.marks,
  score: s.report?.score ?? null,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
  ...(full ? {
    turns: s.turns,
    report: s.report || null,
    // A part's model answer only once it is marked (or the session is over).
    paper: s.paper?.stimulus ? {
      stimulus: s.paper.stimulus,
      parts: s.paper.parts.map((p) => {
        const marked = typeof p.got === "number";
        return {
          question: p.question,
          marks: p.marks,
          answer: p.answer || "",
          images: p.images || [],
          got: marked ? p.got : null,
          feedback: p.feedback || "",
          wrongPart: p.wrongPart || "",
          model: marked || s.status === "done" ? p.model || "" : "",
        };
      }),
    } : null,
  } : {}),
});

// --------------------------------------------------------- chat and book

const tutorTurn = (req, s, session, excerpts, studentTurn, prepaid, images) => ask(req, schemas.tutorTurn, prompts.tutorTurn({
  title: session.lectureTitle,
  excerpts,
  turns: session.turns.slice(-24),
  studentTurn,
  asked: session.asked,
  limit: session.limit,
  followUpsLeft: Math.max(0, s.followUps - session.followUpsNow),
  teacherName: s.tutorName,
  language: session.language || "English",
  hasImages: Boolean(images?.length),
  scoring: scoringOf(session),
}), 900, prepaid, images);

// Applies the tutor's turn to the session (the student's turn is already on it).
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
    const raw = verdict === "skipped" ? 0 : Math.round(Math.min(10, Math.max(0, Number(data.marks) || (verdict === "correct" ? 8 : verdict === "partial" ? 5 : 1))));
    // Each hint on this question takes its penalty off (never below 0).
    const { hintPenalty } = scoringOf(session);
    const cut = verdict === "skipped" ? 0 : Math.min(raw, hintPenalty * hintsOn(session, q));
    const marks = Math.round((raw - cut) * 2) / 2;
    session.marks[q - 1] = marks;
    session.markModified("marks");
    const wrong = String(data.wrongPart || "").trim();
    const note = String(data.feedback || "").trim() || (verdict === "correct" ? "Good." : verdict === "skipped" ? "Alright, let's move on." : "Not quite.");
    session.turns.push({
      role: "teacher",
      kind: "feedback",
      text: cut > 0 ? `${note} (−${cut} for hint${cut === hintPenalty ? "" : "s"})` : note,
      q,
      verdict,
      // Only words really in the answer can be struck out.
      ...(wrong && verdict !== "correct" && studentTurn.text.toLowerCase().includes(wrong.toLowerCase()) ? { wrongPart: wrong } : {}),
    });
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

// ---------------------------------------------------------------- report

const finishSession = async ({ req, session, prepaid }) => {
  session.status = "done";
  session.endedAt = new Date();
  let marks;
  let score;
  let turns = session.turns;
  if (session.layout === "paper") {
    const parts = session.paper?.parts || [];
    marks = parts.filter((p) => typeof p.got === "number").map((p) => Math.round((p.got / p.marks) * 10));
    score = Math.round((paperScore(session.paper) / paperTotal(session.paper)) * 100);
    turns = [{ role: "teacher", text: `Stimulus: ${session.paper?.stimulus || ""}` }];
    parts.forEach((p, i) => {
      turns.push({ role: "teacher", text: `Part ${i + 1} (${p.marks} marks): ${p.question}` });
      if (p.answer) turns.push({ role: "student", kind: "answer", text: p.answer });
      if (typeof p.got === "number") turns.push({ role: "teacher", text: `${p.got}/${p.marks}. ${p.feedback || ""}` });
    });
  } else {
    marks = session.marks.filter((m) => typeof m === "number");
    score = marks.length ? Math.round((marks.reduce((a, b) => a + b, 0) / (session.limit * 10)) * 100) : 0;
  }
  let report = { score, criteria: [], strengths: [], weaknesses: [], remark: "" };
  if (marks.length) {
    try {
      const data = await ask(req, schemas.poraReport, prompts.poraReport({ title: session.lectureTitle, turns: turns.slice(-60), marks, language: session.language || "English" }), 600, prepaid);
      report = { score, ...data };
      // The report's criteria (each 0–5) count for criteriaWeight % of the score.
      const weight = scoringOf(session).criteriaWeight;
      const criteria = (data.criteria || []).filter((c) => typeof c.score === "number");
      if (weight > 0 && criteria.length) {
        const cPct = (criteria.reduce((n, c) => n + Math.min(5, Math.max(0, c.score)), 0) / (criteria.length * 5)) * 100;
        report.marksScore = score;
        report.criteriaWeight = weight;
        report.score = Math.round(score * (1 - weight / 100) + cPct * (weight / 100));
      }
    } catch {
      // The marks still stand without the written part.
    }
  }
  session.report = report;
};

const findSession = async (req, res) => {
  const session = mongoose.isValidObjectId(req.params.id)
    ? await TutorSession.findOne({ _id: req.params.id, student: req.student._id, batch: req.batch._id })
    : null;
  if (!session) {
    res.status(404);
    throw new Error("Session not found.");
  }
  return session;
};

//@desc   AI Tutoring settings and today's allowance
//@route  GET /api/app/batches/:batchId/tutoring/settings
const getTutorSettings = asyncHandler(async (req, res) => {
  const config = await AiConfig.get();
  const s = settingsOf(config);
  const [{ usedToday, remaining }, credits] = await Promise.all([
    allowance(req.student._id, req.batch._id, s),
    AiCredit.find({ student: req.student._id, batch: { $in: [req.batch._id, null] } }).select("batch balance").lean(),
  ]);
  res.status(200).json({
    enabled: Boolean(config.features.aiTutor),
    freePerDay: s.dailyQuestions,
    usedToday,
    packRemaining: remaining,
    availableToday: s.dailyQuestions ? Math.max(0, s.dailyQuestions - usedToday) + remaining : null,
    offer: packOffer(s),
    credits: { batch: credits.find((c) => c.batch)?.balance || 0, general: credits.find((c) => !c.batch)?.balance || 0 },
    questionsPerSession: s.questionsPerSession,
    layout: s.layout,
    tutorName: s.tutorName,
    maxHints: MAX_HINTS,
  });
});

//@desc   Start (or resume) a session on a lecture
//@route  POST /api/app/batches/:batchId/tutoring/start
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

  const open = await TutorSession.findOne({ student: req.student._id, batch: req.batch._id, lecture: lecture._id, status: "active" });
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
  const session = new TutorSession({
    student: req.student._id,
    batch: req.batch._id,
    lecture: lecture._id,
    lectureTitle: lecture.title,
    layout: s.layout,
    scoring: s.scoring,
    limit: s.layout === "paper" ? PART_MARKS.length : s.questionsPerSession,
    language: languageOf(excerpts),
  });
  if (s.layout === "paper") {
    const data = await ask(req, schemas.tutorPaper, prompts.tutorPaper({ title: lecture.title, excerpts, language: session.language, partMarks: s.partMarks }), 1800, capped);
    session.paper = {
      stimulus: data.stimulus.trim(),
      parts: data.parts.slice(0, PART_MARKS.length).map((p, i) => ({ question: p.question.trim(), model: p.answer.trim(), marks: s.partMarks[i] })),
    };
    session.asked = PART_MARKS.length;
  } else {
    const data = await tutorTurn(req, s, session, excerpts, null, capped);
    applyTurn(session, data, null, excerpts, s);
  }
  await session.save();
  res.status(201).json({ session: shapeSession(session) });
});

// A paper part: answer or skip it, and the examiner marks it.
const paperTurn = async (req, res, s, session, kind, text, images) => {
  const i = Number(req.body.part);
  const part = session.paper?.parts?.[i];
  if (!part) {
    res.status(400);
    throw new Error("Pick a part to answer.");
  }
  if (typeof part.got === "number") {
    res.status(409);
    throw new Error("That part is already marked.");
  }
  if (kind === "skip") {
    part.answer = "";
    part.got = 0;
    part.feedback = "Skipped.";
  } else {
    const capped = s.dailyQuestions > 0;
    let took = null;
    if (capped && !part.paid) {
      took = await takeQuestion(req, res, s);
      if (!took) return false;
    }
    let data;
    try {
      data = await ask(req, schemas.tutorMark, prompts.tutorMark({
        title: session.lectureTitle,
        stimulus: session.paper.stimulus,
        question: part.question,
        model: part.model,
        marks: part.marks,
        answer: text,
        hasImages: images.length > 0,
        language: session.language || "English",
        level: session.paper.parts.indexOf(part),
        scoring: scoringOf(session),
      }), 500, capped, images);
    } catch (error) {
      await giveBack(req, took);
      throw error;
    }
    await settle(req, took);
    if (took) part.paid = true;
    const wrong = String(data.wrongPart || "").trim();
    part.answer = text;
    part.images = images.length ? images : undefined;
    part.got = Math.min(part.marks, Math.max(0, Math.round((Number(data.got) || 0) * 2) / 2));
    part.feedback = String(data.feedback || "").trim();
    part.wrongPart = wrong && part.got < part.marks && text.toLowerCase().includes(wrong.toLowerCase()) ? wrong : "";
  }
  session.marks = session.paper.parts.map((p) => (typeof p.got === "number" ? Math.round((p.got / p.marks) * 10) : null)).filter((m) => m !== null);
  session.markModified("paper");
  if (session.paper.parts.every((p) => typeof p.got === "number")) await finishSession({ req, session, prepaid: s.dailyQuestions > 0 });
  return true;
};

//@desc   The student answers, skips, or asks for a hint
//@route  POST /api/app/batches/:batchId/tutoring/sessions/:id/turn
const takeTurn = asyncHandler(async (req, res) => {
  const config = await assertEnabled();
  const s = settingsOf(config);
  const session = await findSession(req, res);
  if (session.status !== "active") {
    res.status(409);
    throw new Error("This session has ended.");
  }
  const kind = ["answer", "skip", "hint"].includes(req.body.kind) ? req.body.kind : "answer";
  const text = String(req.body.text || "").trim().slice(0, 3000);
  const images = kind === "answer" && Array.isArray(req.body.images) ? req.body.images.filter((u) => typeof u === "string").slice(0, MAX_IMAGES) : [];
  for (const u of images) await assertOwnMediaUrl(u, req.student._id, "picture");
  if (kind === "answer" && !text && !images.length) {
    res.status(400);
    throw new Error("Write, draw or upload your answer first.");
  }

  if (session.layout === "paper") {
    if (kind === "hint") {
      res.status(400);
      throw new Error("No hints on a creative question.");
    }
    if (!(await paperTurn(req, res, s, session, kind, text, images))) return;
    await session.save();
    res.status(200).json({ session: shapeSession(session) });
    return;
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
  let took = null;
  if (capped && kind === "answer" && session.paidQ < q) {
    took = await takeQuestion(req, res, s);
    if (!took) return;
  }

  const studentTurn = {
    role: "student",
    kind,
    text: kind === "skip" ? "(skipped)" : kind === "hint" ? "(hint please)" : text || "(answer in the picture)",
    q,
    ...(images.length ? { images } : {}),
  };
  const excerpts = await materialOf(session.lecture);
  let data;
  try {
    data = await tutorTurn(req, s, session, excerpts, studentTurn, capped, images);
  } catch (error) {
    await giveBack(req, took);
    throw error;
  }
  await settle(req, took);
  if (took) session.paidQ = q;

  session.turns.push(studentTurn);
  const next = applyTurn(session, data, studentTurn, excerpts, s);
  if (next === "finish") await finishSession({ req, session, prepaid: capped });
  await session.save();
  res.status(200).json({ session: shapeSession(session) });
});

//@desc   End a session now, with a report on what was answered
//@route  POST /api/app/batches/:batchId/tutoring/sessions/:id/end
const endSession = asyncHandler(async (req, res) => {
  const config = await AiConfig.get();
  const s = settingsOf(config);
  const session = await findSession(req, res);
  if (session.status === "active") {
    // Chat and book: only questions answered count toward the score. A
    // paper is always out of its 10 marks.
    if (session.layout !== "paper") session.limit = Math.max(1, session.marks.filter((m) => typeof m === "number").length);
    await finishSession({ req, session, prepaid: s.dailyQuestions > 0 });
    session.markModified("paper");
    await session.save();
  }
  res.status(200).json({ session: shapeSession(session) });
});

//@desc   The student's sessions in this batch (optionally one lecture's)
//@route  GET /api/app/batches/:batchId/tutoring/sessions?lecture=
const listSessions = asyncHandler(async (req, res) => {
  const filter = { student: req.student._id, batch: req.batch._id };
  if (mongoose.isValidObjectId(req.query.lecture)) filter.lecture = req.query.lecture;
  const sessions = await TutorSession.find(filter).sort({ updatedAt: -1 }).limit(30).select("-turns -paper");
  res.status(200).json({ sessions: sessions.map((x) => shapeSession(x, { full: false })) });
});

//@desc   One session
//@route  GET /api/app/batches/:batchId/tutoring/sessions/:id
const getSession = asyncHandler(async (req, res) => {
  res.status(200).json(shapeSession(await findSession(req, res)));
});

//@desc   Delete one of the student's sessions
//@route  DELETE /api/app/batches/:batchId/tutoring/sessions/:id
const deleteSession = asyncHandler(async (req, res) => {
  const result = mongoose.isValidObjectId(req.params.id)
    ? await TutorSession.deleteOne({ _id: req.params.id, student: req.student._id, batch: req.batch._id })
    : { deletedCount: 0 };
  if (!result.deletedCount) {
    res.status(404);
    throw new Error("Session not found.");
  }
  res.status(200).json({ deleted: true });
});

//@desc   A drawn page or photo of an answer
//@route  POST /api/app/batches/:batchId/tutoring/upload-image
const uploadAnswerImage = asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400);
    throw new Error("No file was received.");
  }
  const stored = await storage.store("tutor-images", await preparePhoto(req.file));
  await recordStudentUpload(stored.key, req.student._id, "tutor-images");
  res.status(200).json({ url: await storage.urlFor(stored.key, stored.driver) });
});

//@desc   Buy more AI Tutoring questions with AI credits (this batch's first)
//@route  POST /api/app/batches/:batchId/tutoring/unlock
const unlockPack = asyncHandler(async (req, res) => {
  const config = await assertEnabled();
  const s = settingsOf(config);
  const offer = packOffer(s);
  if (!offer) {
    res.status(400);
    throw new Error("Extra AI Tutoring questions aren't on sale.");
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
  AiUsage.create({ feature: "ai-tutor-pack", provider: "credits", student, batch: req.batch._id, ok: true, featureCost: 0, paidWithCredit: true, creditsSpent: offer.packCost }).catch(() => {});

  const day = today();
  const filter = { student, batch: req.batch._id };
  let pack = await TutorPack.findOneAndUpdate(
    s.packCarryOver ? filter : { ...filter, packDay: day },
    { $inc: { remaining: offer.packSize }, $set: { packDay: day } },
    { new: true }
  );
  if (!pack) pack = await TutorPack.findOneAndUpdate(filter, { $set: { remaining: offer.packSize, packDay: day } }, { upsert: true, new: true });
  res.status(200).json({ remaining: pack.remaining, message: `Unlocked ${offer.packSize} more questions.` });
});

module.exports = { uploadAnswerImage, getTutorSettings, startSession, takeTurn, endSession, listSessions, getSession, deleteSession, unlockPack, shapeSession };
