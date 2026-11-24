const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const crypto = require("crypto");
const Lecture = require("../../models/lectureModel");
const AiConfig = require("../../models/aiConfigModel");
const AiUsage = require("../../models/aiUsageModel");
const AiCredit = require("../../models/aiCreditModel");
const InterviewSet = require("../../models/interviewSetModel");
const InterviewSession = require("../../models/interviewSessionModel");
const InterviewPack = require("../../models/interviewPackModel");
const aiService = require("../../ai/service");
const tts = require("../../ai/tts");
const prompts = require("../../ai/prompts");
const schemas = require("../../ai/schemas");
const { today, materialOf, languageOf } = require("./poraController");

// Interview practice: a panel of one to three AI interviewers asks out loud
// (a board viva, an admission, scholarship or job interview), the student
// answers out loud (or types, when the admin allows), each answer is
// marked, and the report scores the interview's criteria with tips and a
// better answer to the weakest question.
//
// Three ways in: an interview the admin set up (InterviewSet), a viva on
// any lecture, or one the student describes themselves.
//
// Billing is Oral Quiz's: with free daily questions set, a main question is
// counted when first answered, from today's free ones, then from a pack
// bought with AI credits, and the AI calls are prepaid. Follow-ups, passes
// and the report are free. A failed AI call gives the question back. With
// no daily limit, every AI call is charged.

const FEATURE = "interview";
const KINDS = ["viva", "admission", "job", "scholarship", "other"];
const LAYOUTS = ["panel", "board", "video"];

// A panel for each kind, when the interview names none.
const PANELS = {
  viva: [
    { name: "Dr. Rahman", role: "Board examiner", style: "asks about the concepts" },
    { name: "Ms. Sultana", role: "Board examiner", style: "asks how it applies, with examples" },
    { name: "Mr. Karim", role: "External examiner", style: "follows up and probes" },
  ],
  admission: [
    { name: "Prof. Hasan", role: "Admission board chair", style: "warm, asks about motivation and plans" },
    { name: "Dr. Nahar", role: "Faculty member", style: "asks subject questions" },
    { name: "Mr. Alam", role: "Board member", style: "asks about character and situations" },
  ],
  job: [
    { name: "Ms. Ahmed", role: "HR manager", style: "behaviour and motivation questions" },
    { name: "Mr. Chowdhury", role: "Team lead", style: "skills, situations and follow-ups" },
  ],
  scholarship: [
    { name: "Dr. Islam", role: "Committee chair", style: "goals and motivation" },
    { name: "Ms. Akter", role: "Committee member", style: "achievements, need and plans" },
  ],
  other: [{ name: "Mr. Hossain", role: "Interviewer", style: "friendly but thorough" }],
};
const CRITERIA = {
  viva: ["Subject knowledge", "Clarity", "Use of terms", "Confidence"],
  admission: ["Motivation", "Subject knowledge", "Communication", "Confidence"],
  job: ["Relevant skills", "Examples from experience", "Communication", "Confidence"],
  scholarship: ["Goals", "Achievements", "Communication", "Confidence"],
  other: ["Content", "Clarity", "Examples", "Confidence"],
};

const settingsOf = (config) => {
  const s = config.interview || {};
  return {
    dailyQuestions: s.dailyQuestions ?? 10,
    packSize: s.packSize ?? 10,
    packCost: s.packCost || 2,
    packCarryOver: Boolean(s.packCarryOver),
    followUps: s.followUps ?? 1,
    layout: LAYOUTS.includes(s.layout) ? s.layout : "panel",
    answerSeconds: s.answerSeconds ?? 90,
    typing: Boolean(s.typing),
    speak: s.speak !== false,
    lectureViva: s.lectureViva !== false,
    ownInterview: s.ownInterview !== false,
    strictness: s.strictness || "normal",
  };
};

const packOffer = (s) => (s.packSize > 0 ? { packSize: s.packSize, packCost: s.packCost } : null);

const allowance = async (student, batch, s) => {
  const doc = await InterviewPack.findOne({ student, batch }).lean();
  const day = today();
  const packLive = s.packCarryOver || doc?.packDay === day;
  return { usedToday: doc?.day === day ? doc.usedToday || 0 : 0, remaining: packLive ? doc?.remaining || 0 : 0 };
};

const countFree = async (student, batch) => {
  const day = today();
  const bumped = await InterviewPack.updateOne({ student, batch, day }, { $inc: { usedToday: 1 } });
  if (!bumped.matchedCount) await InterviewPack.updateOne({ student, batch }, { $set: { day, usedToday: 1 } }, { upsert: true });
};

const limitMessage = (s, offer) =>
  offer
    ? `You've used today's ${s.dailyQuestions} free interview questions. Unlock ${offer.packSize} more for ${offer.packCost} AI credit${offer.packCost === 1 ? "" : "s"}, or come back tomorrow.`
    : `You've answered today's ${s.dailyQuestions} interview questions. It resets tomorrow.`;

const takeQuestion = async (req, res, s) => {
  const { usedToday } = await allowance(req.student._id, req.batch._id, s);
  if (usedToday < s.dailyQuestions) return "free";
  const taken = await InterviewPack.findOneAndUpdate(
    { student: req.student._id, batch: req.batch._id, remaining: { $gte: 1 }, ...(s.packCarryOver ? {} : { packDay: today() }) },
    { $inc: { remaining: -1 } }
  );
  if (taken) return "pack";
  const offer = packOffer(s);
  res.status(429).json({ message: limitMessage(s, offer), limitReached: true, offer });
  return null;
};
const giveBack = (req, took) => (took === "pack"
  ? InterviewPack.updateOne({ student: req.student._id, batch: req.batch._id }, { $inc: { remaining: 1 } })
  : null);
const settle = (req, took) => (took === "free" ? countFree(req.student._id, req.batch._id) : null);

const assertEnabled = async () => {
  const config = await AiConfig.get();
  if (!config.features.interview) {
    throw Object.assign(new Error("Interview practice is switched off."), { statusCode: 403 });
  }
  return config;
};

// Interviews this batch's students can pick.
const setsFor = (batchId) => InterviewSet.find({
  isPublished: true,
  $or: [{ batches: { $size: 0 } }, { batches: batchId }],
}).sort({ updatedAt: -1 });

const shapeSession = (s, { full = true } = {}) => ({
  _id: s._id,
  source: s.source,
  set: s.set,
  lecture: s.lecture,
  title: s.title,
  kind: s.kind,
  brief: s.brief,
  interviewers: s.interviewers,
  language: s.language || "English",
  layout: s.layout || "panel",
  answerSeconds: s.answerSeconds ?? 90,
  status: s.status,
  asked: s.asked,
  limit: s.limit,
  marks: s.marks,
  score: s.report?.score ?? null,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
  // Feedback notes are for the report: shown once the interview is over.
  ...(full ? {
    turns: s.status === "done" ? s.turns : s.turns.filter((t) => t.kind !== "feedback"),
    report: s.report || null,
  } : {}),
});

// The transcript as the AI reads it: who said what.
const transcript = (session, { notes = false } = {}) => session.turns
  .filter((t) => notes || t.kind !== "feedback")
  .map((t) => {
    if (t.role === "student") return { who: t.kind === "skip" ? "Student (passed)" : `Student${t.timedOut ? " (time ran out)" : ""}`, text: t.text };
    if (t.kind === "feedback") return { who: "(Panel's private note on that answer)", text: t.text };
    return { who: session.interviewers[t.by]?.name || "Interviewer", text: t.text };
  });

const setupOf = (session) => ({
  title: session.title,
  kind: session.kind,
  brief: session.brief,
  interviewers: session.interviewers,
  criteria: session.criteria,
  mustAsk: session.mustAsk,
  language: session.language || "English",
});

const ask = (req, schema, { system, prompt }, maxTokens, prepaid) => aiService.generate({
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

const interviewerTurn = (req, s, session, excerpts, studentTurn, prepaid) => ask(req, schemas.interviewTurn, prompts.interviewTurn({
  setup: setupOf(session),
  excerpts,
  turns: transcript(session).slice(-30),
  studentTurn,
  asked: session.asked,
  limit: session.limit,
  followUpsLeft: Math.max(0, s.followUps - session.followUpsNow),
  strictness: s.strictness,
}), 700, prepaid);

// Applies the panel's turn (the student's turn is already on the session).
const applyTurn = (session, data, studentTurn, s) => {
  const q = session.asked;
  let next = data.next;
  if (next === "followUp" && (session.followUpsNow >= s.followUps || studentTurn?.kind === "skip")) next = "question";
  if (next === "question" && session.asked >= session.limit) next = "finish";
  if (!studentTurn) next = "question";
  const panel = session.interviewers.length || 1;
  const by = Math.min(panel - 1, Math.max(0, Number(data.by) || 0));

  if (studentTurn) {
    const verdict = studentTurn.kind === "skip" ? "skipped" : ["strong", "ok", "weak"].includes(data.verdict) ? data.verdict : "ok";
    const marks = verdict === "skipped" ? 0 : Math.round(Math.min(10, Math.max(0, Number(data.marks) || (verdict === "strong" ? 8 : verdict === "ok" ? 6 : 3))));
    session.marks[q - 1] = marks;
    session.markModified("marks");
    if (verdict !== "skipped" && String(data.feedback || "").trim()) {
      session.turns.push({ role: "interviewer", kind: "feedback", text: String(data.feedback).trim(), q, verdict });
    }
  }

  const say = String(data.say || "").trim();
  if (next === "finish") {
    session.turns.push({ role: "interviewer", kind: "closing", text: say || "Thank you, that's all from us.", q, by: 0 });
    return "finish";
  }
  session.turns.push({ role: "interviewer", kind: next, text: say, q: next === "question" ? q + 1 : q, by });
  if (next === "question") {
    session.asked += 1;
    session.followUpsNow = 0;
  } else session.followUpsNow += 1;
  return next;
};

const finishSession = async ({ req, session, prepaid }) => {
  session.status = "done";
  session.endedAt = new Date();
  const marks = session.marks.filter((m) => typeof m === "number");
  const score = marks.length ? Math.round((marks.reduce((a, b) => a + b, 0) / (session.limit * 10)) * 100) : 0;
  let report = { score, criteria: [], strengths: [], weaknesses: [], tips: [], remark: "" };
  if (marks.length) {
    try {
      const data = await ask(req, schemas.interviewReport, prompts.interviewReport({ setup: setupOf(session), turns: transcript(session, { notes: true }).slice(-70), marks }), 1200, prepaid);
      report = { score, ...data };
    } catch {
      // The marks still stand without the written part.
    }
  }
  session.report = report;
};

const findSession = async (req, res) => {
  const session = mongoose.isValidObjectId(req.params.id)
    ? await InterviewSession.findOne({ _id: req.params.id, student: req.student._id, batch: req.batch._id })
    : null;
  if (!session) {
    res.status(404);
    throw new Error("Session not found.");
  }
  return session;
};

// A lecture's material, or a 409 explaining why there is none yet.
const lectureMaterial = async (res, lecture) => {
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
  return excerpts;
};

//@desc   Interview practice settings, today's allowance and the interviews
//@route  GET /api/app/batches/:batchId/interview/settings
const getInterviewSettings = asyncHandler(async (req, res) => {
  const config = await AiConfig.get();
  const s = settingsOf(config);
  const [{ usedToday, remaining }, credits, voice, sets] = await Promise.all([
    allowance(req.student._id, req.batch._id, s),
    AiCredit.find({ student: req.student._id, batch: { $in: [req.batch._id, null] } }).select("batch balance").lean(),
    tts.status(),
    setsFor(req.batch._id).select("title kind brief interviewers questions lecture language").lean(),
  ]);
  res.status(200).json({
    enabled: Boolean(config.features.interview),
    freePerDay: s.dailyQuestions,
    usedToday,
    packRemaining: remaining,
    availableToday: s.dailyQuestions ? Math.max(0, s.dailyQuestions - usedToday) + remaining : null,
    offer: packOffer(s),
    credits: { batch: credits.find((c) => c.batch)?.balance || 0, general: credits.find((c) => !c.batch)?.balance || 0 },
    layout: s.layout,
    answerSeconds: s.answerSeconds,
    typing: s.typing,
    voice: s.speak && voice.ready,
    lectureViva: s.lectureViva,
    ownInterview: s.ownInterview,
    sets: sets.map((x) => ({
      _id: x._id,
      title: x.title,
      kind: x.kind,
      brief: x.brief,
      questions: x.questions,
      panel: (x.interviewers?.length ? x.interviewers : PANELS[x.kind] || PANELS.other).map((p) => p.name),
      lecture: x.lecture || null,
    })),
  });
});

//@desc   Start (or resume) an interview
//@route  POST /api/app/batches/:batchId/interview/start
//        { setId } | { lectureId } | { own: { kind, description, questions } } + fresh
const startSession = asyncHandler(async (req, res) => {
  const config = await assertEnabled();
  const s = settingsOf(config);
  const { setId, lectureId, own } = req.body;

  let setup;
  let excerpts = [];
  if (setId) {
    const set = mongoose.isValidObjectId(setId) ? await setsFor(req.batch._id).findOne({ _id: setId }).lean() : null;
    if (!set) {
      res.status(404);
      throw new Error("That interview isn't available.");
    }
    if (set.lecture) {
      const lecture = await Lecture.findById(set.lecture).select("title docIndex").lean();
      if (lecture) excerpts = await lectureMaterial(res, lecture);
    }
    setup = {
      source: "set",
      set: set._id,
      lecture: set.lecture || null,
      title: set.title,
      kind: set.kind,
      brief: set.brief,
      interviewers: set.interviewers?.length ? set.interviewers : PANELS[set.kind] || PANELS.other,
      criteria: set.criteria?.length ? set.criteria : CRITERIA[set.kind] || CRITERIA.other,
      mustAsk: set.mustAsk || [],
      language: set.language || "English",
      limit: set.questions || 6,
    };
  } else if (lectureId) {
    if (!s.lectureViva) {
      res.status(403);
      throw new Error("Lecture vivas are switched off.");
    }
    const lecture = mongoose.isValidObjectId(lectureId)
      ? await Lecture.findOne({ _id: lectureId, batches: req.batch._id, isPublished: true }).select("title docIndex").lean()
      : null;
    if (!lecture) {
      res.status(404);
      throw new Error("Lecture not found in this batch.");
    }
    excerpts = await lectureMaterial(res, lecture);
    setup = {
      source: "lecture",
      lecture: lecture._id,
      title: `Viva: ${lecture.title}`,
      kind: "viva",
      brief: `A board viva on the lecture "${lecture.title}".`,
      interviewers: PANELS.viva,
      criteria: CRITERIA.viva,
      mustAsk: [],
      language: languageOf(excerpts),
      limit: 6,
    };
  } else if (own && typeof own === "object") {
    if (!s.ownInterview) {
      res.status(403);
      throw new Error("Practising your own interview is switched off.");
    }
    const description = String(own.description || "").trim().slice(0, 600);
    if (description.length < 5) {
      res.status(400);
      throw new Error("Say what the interview is for: the post, the university or the scholarship.");
    }
    const kind = KINDS.includes(own.kind) ? own.kind : "other";
    setup = {
      source: "own",
      title: description.length > 70 ? `${description.slice(0, 67)}…` : description,
      kind,
      brief: description,
      interviewers: PANELS[kind],
      criteria: CRITERIA[kind],
      mustAsk: [],
      language: own.language === "Bangla" || /[ঀ-৿]/.test(description) ? "Bangla" : "English",
      limit: Math.min(10, Math.max(3, Math.round(Number(own.questions) || 6))),
    };
  } else {
    res.status(400);
    throw new Error("Pick an interview first.");
  }

  // One open session per interview: resume it unless asked for a fresh one.
  const sameKey = setup.source === "set" ? { set: setup.set } : setup.source === "lecture" ? { source: "lecture", lecture: setup.lecture } : null;
  const open = sameKey ? await InterviewSession.findOne({ student: req.student._id, batch: req.batch._id, ...sameKey, status: "active" }) : null;
  if (open && !req.body.fresh) {
    res.status(200).json({ session: shapeSession(open), resumed: true });
    return;
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
  const session = new InterviewSession({
    student: req.student._id,
    batch: req.batch._id,
    ...setup,
    // The video call has one interviewer.
    interviewers: s.layout === "video" ? setup.interviewers.slice(0, 1) : setup.interviewers.slice(0, 3),
    layout: s.layout,
    answerSeconds: s.answerSeconds,
  });
  const data = await interviewerTurn(req, s, session, excerpts, null, capped);
  applyTurn(session, data, null, s);
  await session.save();
  res.status(201).json({ session: shapeSession(session) });
});

//@desc   The student answers or passes
//@route  POST /api/app/batches/:batchId/interview/sessions/:id/turn  { kind, text, seconds, timedOut }
const takeTurn = asyncHandler(async (req, res) => {
  const config = await assertEnabled();
  const s = settingsOf(config);
  const session = await findSession(req, res);
  if (session.status !== "active") {
    res.status(409);
    throw new Error("This interview has ended.");
  }
  const kind = req.body.kind === "skip" ? "skip" : "answer";
  const text = String(req.body.text || "").trim().slice(0, 3000);
  if (kind === "answer" && !text) {
    res.status(400);
    throw new Error("Say your answer first.");
  }
  const last = [...session.turns].reverse().find((t) => t.role === "interviewer" && t.kind !== "feedback");
  if (last?.kind === "closing") {
    res.status(409);
    throw new Error("This interview has ended.");
  }

  // A main question is counted on its first answer.
  const capped = s.dailyQuestions > 0;
  const q = session.asked;
  let took = null;
  if (capped && kind === "answer" && session.paidQ < q) {
    took = await takeQuestion(req, res, s);
    if (!took) return;
  }

  const seconds = Math.min(3600, Math.max(0, Math.round(Number(req.body.seconds) || 0)));
  const studentTurn = {
    role: "student",
    kind,
    text: kind === "skip" ? "(passed)" : text,
    q,
    ...(seconds ? { seconds } : {}),
    ...(req.body.timedOut ? { timedOut: true } : {}),
  };
  const excerpts = session.lecture ? await materialOf(session.lecture) : [];
  let data;
  try {
    data = await interviewerTurn(req, s, session, excerpts, studentTurn, capped);
  } catch (error) {
    await giveBack(req, took);
    throw error;
  }
  await settle(req, took);
  if (took) session.paidQ = q;

  session.turns.push(studentTurn);
  const next = applyTurn(session, data, studentTurn, s);
  if (next === "finish") await finishSession({ req, session, prepaid: capped });
  await session.save();
  res.status(200).json({ session: shapeSession(session) });
});

//@desc   End the interview now, with a report on what was answered
//@route  POST /api/app/batches/:batchId/interview/sessions/:id/end
const endSession = asyncHandler(async (req, res) => {
  const config = await AiConfig.get();
  const s = settingsOf(config);
  const session = await findSession(req, res);
  if (session.status === "active") {
    session.limit = Math.max(1, session.marks.filter((m) => typeof m === "number").length);
    await finishSession({ req, session, prepaid: s.dailyQuestions > 0 });
    await session.save();
  }
  res.status(200).json({ session: shapeSession(session) });
});

//@desc   The student's interview sessions in this batch
//@route  GET /api/app/batches/:batchId/interview/sessions
const listSessions = asyncHandler(async (req, res) => {
  const sessions = await InterviewSession.find({ student: req.student._id, batch: req.batch._id }).sort({ updatedAt: -1 }).limit(30).select("-turns");
  res.status(200).json({ sessions: sessions.map((x) => shapeSession(x, { full: false })) });
});

//@desc   One session
//@route  GET /api/app/batches/:batchId/interview/sessions/:id
const getSession = asyncHandler(async (req, res) => {
  res.status(200).json(shapeSession(await findSession(req, res)));
});

//@desc   Delete one of the student's sessions
//@route  DELETE /api/app/batches/:batchId/interview/sessions/:id
const deleteSession = asyncHandler(async (req, res) => {
  const result = mongoose.isValidObjectId(req.params.id)
    ? await InterviewSession.deleteOne({ _id: req.params.id, student: req.student._id, batch: req.batch._id })
    : { deletedCount: 0 };
  if (!result.deletedCount) {
    res.status(404);
    throw new Error("Session not found.");
  }
  res.status(200).json({ deleted: true });
});

//@desc   Buy more interview questions with AI credits (this batch's first)
//@route  POST /api/app/batches/:batchId/interview/unlock
const unlockPack = asyncHandler(async (req, res) => {
  const config = await assertEnabled();
  const s = settingsOf(config);
  const offer = packOffer(s);
  if (!offer) {
    res.status(400);
    throw new Error("Extra interview questions aren't on sale.");
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
  AiUsage.create({ feature: "interview-pack", provider: "credits", student, batch: req.batch._id, ok: true, featureCost: 0, paidWithCredit: true, creditsSpent: offer.packCost }).catch(() => {});

  const day = today();
  const filter = { student, batch: req.batch._id };
  let pack = await InterviewPack.findOneAndUpdate(
    s.packCarryOver ? filter : { ...filter, packDay: day },
    { $inc: { remaining: offer.packSize }, $set: { packDay: day } },
    { new: true }
  );
  if (!pack) pack = await InterviewPack.findOneAndUpdate(filter, { $set: { remaining: offer.packSize, packDay: day } }, { upsert: true, new: true });
  res.status(200).json({ remaining: pack.remaining, message: `Unlocked ${offer.packSize} more questions.` });
});

// The panel's lines, spoken: kept a little while for replays.
const spoken = new Map();
const SPOKEN_MAX = 200;

//@desc   An interviewer's line as speech (MP3)
//@route  POST /api/app/batches/:batchId/interview/speak  { text, language }
const speak = asyncHandler(async (req, res) => {
  const config = await assertEnabled();
  if (!settingsOf(config).speak) {
    res.status(400);
    throw new Error("The interviewers' voice is switched off.");
  }
  const text = String(req.body.text || "").trim().slice(0, 900);
  if (!text) {
    res.status(400);
    throw new Error("Nothing to say.");
  }
  const language = req.body.language === "Bangla" ? "Bangla" : "English";
  const key = crypto.createHash("sha1").update(`${language}|${text}`).digest("hex");
  let audio = spoken.get(key);
  if (!audio) {
    audio = await tts.speak(text, { language });
    spoken.set(key, audio);
    if (spoken.size > SPOKEN_MAX) spoken.delete(spoken.keys().next().value);
  }
  res.set("Content-Type", "audio/mpeg");
  res.set("Cache-Control", "private, max-age=3600");
  res.status(200).send(audio);
});

module.exports = {
  PANELS, CRITERIA, shapeSession,
  getInterviewSettings, startSession, takeTurn, endSession, listSessions, getSession, deleteSession, unlockPack, speak,
};
