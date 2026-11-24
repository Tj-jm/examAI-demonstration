const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Lecture = require("../../models/lectureModel");
const DocChunk = require("../../models/docChunkModel");
const ChatThread = require("../../models/chatThreadModel");
const AiConfig = require("../../models/aiConfigModel");
const AiUsage = require("../../models/aiUsageModel");
const AiCredit = require("../../models/aiCreditModel");
const DocChatPack = require("../../models/docChatPackModel");
const aiService = require("../../ai/service");
const { docChat: docChatPrompt } = require("../../ai/prompts");
const { docChatAnswer } = require("../../ai/schemas");
const { retrieve } = require("../../utils/docRetrieve");
const docText = require("../../utils/docText");
const { screenMessage, recordAbuse } = require("../../utils/conduct");
const storage = require("../../adapters/storage");
const { toAbsoluteUrl, assertOwnMediaUrl, recordStudentUpload } = require("../../utils/mediaUrl");
const { preparePhoto } = require("../../utils/photo");

// Document chat: a student asks, the answer comes from their batch's own
// lecture notes and files (utils/docIndex.js, docRetrieve.js), with the
// exact lines it used. Two doors:
//   "Ask this lecture" — lectureId set, only that lecture's material;
//   "Ask your course"  — every published lecture assigned to the batch.
//
// The model is asked for quotes; every quote is checked against the excerpt
// it names before the student sees it (docText.quoteIn). An answer whose
// quotes don't hold up is not shown as coming from the course. When the
// material doesn't cover the question, the admin decides: a general answer,
// plainly labelled as not from the course, or only a pointer to a teacher.

const HISTORY_TURNS = 6;
const EXCERPTS = 8;
const NOT_COVERED = "This isn't covered in your course documents.";
// A question with a photo takes two AI calls (reading the photo, then the
// answer), so it counts as two questions.
const IMAGE_COST = 2;

// Server-local date, the day the free question count belongs to.
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// → { usedToday, remaining } for a student in a batch. Without carry-over,
// unlocked questions only count on the day they were bought.
const chatAllowance = async (student, batch, settings) => {
  const doc = await DocChatPack.findOne({ student, batch }).lean();
  const day = today();
  const packLive = settings.packCarryOver || doc?.packDay === day;
  return { usedToday: doc?.day === day ? doc.usedToday || 0 : 0, remaining: packLive ? doc?.remaining || 0 : 0 };
};

// One free question used today.
const countFreeQuestion = async (student, batch, count = 1) => {
  const day = today();
  const bumped = await DocChatPack.updateOne({ student, batch, day }, { $inc: { usedToday: count } });
  if (!bumped.matchedCount) await DocChatPack.updateOne({ student, batch }, { $set: { day, usedToday: count } }, { upsert: true });
};

const packOffer = (settings) =>
  settings.packSize > 0 ? { packSize: settings.packSize, packCost: settings.packCost || 1 } : null;

// A short follow-up ("why?", "and the second one?") searches with the
// previous question too, so it still finds the right material.
const searchQuery = (question, history) => {
  if (docText.terms(question).length >= 4) return question;
  const previous = [...history].reverse().find((m) => m.role === "student");
  return previous ? `${previous.text} ${question}` : question;
};

const excerptLabel = (chunk, lectureTitles, courseScope) => {
  const where = chunk.source.kind === "notes"
    ? `Notes${chunk.source.title && chunk.source.title !== "Notes" ? ` · ${chunk.source.title}` : ""}`
    : `${chunk.source.title || "File"}${chunk.page ? ` · p.${chunk.page}` : ""}`;
  return courseScope ? `${lectureTitles.get(String(chunk.lecture)) || "Lecture"} — ${where}` : where;
};

// Excerpt markers the model sometimes leaves in the answer text ("[1]",
// "(excerpt 2)", "according to excerpt 3,"). Math between $…$ and code
// between backticks is left alone, so $[1, 2]$ and `a[1]` survive.
const stripMarkers = (text) =>
  text
    .split(/(\$\$[\s\S]*?\$\$|\$[^$]*\$|```[\s\S]*?```|`[^`]*`)/)
    .map((part, i) => (i % 2 ? part : part
      .replace(/\b(?:according to|as (?:stated|mentioned|shown) in|see|from|in)\s+(?:the\s+)?excerpts?\s*\[?\d+(?:\s*(?:,|and|&)\s*\[?\d+\]?)*\]?\s*,?\s*/gi, "")
      .replace(/\s*\(\s*(?:see\s+)?excerpts?\s*\[?\d+(?:\s*(?:,|and|&)\s*\d+)*\]?\s*\)/gi, "")
      .replace(/\b(?:the\s+)?excerpts?\s*\[?\d+\]?\s+(?:says|states|shows|mentions|notes|explains)(?:\s+that)?\s*/gi, "")
      .replace(/\bexcerpts?\s*\[\d+\]/gi, "")
      .replace(/\s*\[\d+(?:\s*[,–-]\s*\d+)*\](?![\d(])/g, "")
      .replace(/ {2,}/g, " ")
      .replace(/ ([.,;:!?])/g, "$1")))
    .join("")
    .trim()
    .replace(/^[a-z]/, (c) => c.toUpperCase());

// → { message, found, general }: the model's answer with only the citations
// that really quote their excerpt.
const verifyAnswer = (data, excerpts, { allowGeneral }) => {
  const citations = [];
  const seen = new Set();
  for (const c of data.citations || []) {
    const excerpt = excerpts[c.excerpt - 1];
    if (!excerpt || !docText.quoteIn(c.quote, excerpt.chunk.text)) continue;
    const key = `${c.excerpt}|${docText.skeleton(c.quote)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    citations.push({ excerpt: c.excerpt, quote: c.quote.trim(), chunk: excerpt.chunk });
  }
  const found = Boolean(data.foundInDocuments) && citations.length > 0;
  const answer = stripMarkers(String(data.answer || ""));

  if (found) return { text: answer, citations, found: true, general: false };
  // Not covered — or claimed covered with no quote that holds up, which is
  // never shown as the course's. A general answer only if the admin allows.
  if (allowGeneral && answer) return { text: answer, citations: [], found: false, general: true };
  return { text: NOT_COVERED, citations: [], found: false, general: false };
};

const shapeThread = (thread, { full = true } = {}) => ({
  _id: thread._id,
  lecture: thread.lecture,
  title: thread.title,
  updatedAt: thread.updatedAt,
  ...(full ? { messages: thread.messages } : { messageCount: thread.messages?.length || 0 }),
});

//@desc   Ask the course documents a question (starts or continues a thread)
//@route  POST /api/app/batches/:batchId/chat
//@access Private (student + batchAccess + features.aiAssist + features.docChat)
const ask = asyncHandler(async (req, res) => {
  const config = await AiConfig.get();
  if (!config.features.docChat) {
    res.status(403);
    throw new Error("Document chat is switched off.");
  }
  const settings = config.docChat || {};
  const image = req.body.image ? String(req.body.image) : null;
  const question = String(req.body.message || "").trim() || (image ? "Explain this." : "");
  if (!question) {
    res.status(400);
    throw new Error("Type a question first.");
  }
  if (image) await assertOwnMediaUrl(image, req.student._id, "photo");
  // Free check before anything is paid for; throws when abusive.
  await screenMessage({ student: req.student._id, batch: req.batch._id, source: "course-chat", text: req.body.message });
  const cost = image ? IMAGE_COST : 1;
  if (question.length > 2000) {
    res.status(400);
    throw new Error("That question is too long — keep it under 2000 characters.");
  }

  // Which thread, and which door.
  let thread = null;
  if (req.body.threadId) {
    if (!mongoose.isValidObjectId(req.body.threadId)) {
      res.status(400);
      throw new Error("Invalid conversation.");
    }
    thread = await ChatThread.findOne({ _id: req.body.threadId, student: req.student._id, batch: req.batch._id });
    if (!thread) {
      res.status(404);
      throw new Error("Conversation not found.");
    }
  }
  const lectureId = thread ? thread.lecture : req.body.lectureId || null;
  const scope = settings.scope || "both";
  if (lectureId && scope === "course") {
    res.status(403);
    throw new Error("Asking a single lecture is switched off — use Ask your course.");
  }
  if (!lectureId && scope === "lecture") {
    res.status(403);
    throw new Error("Asking the whole course is switched off — ask from a lecture instead.");
  }

  // What the student may read: published lectures assigned to this batch.
  let lectures;
  if (lectureId) {
    if (!mongoose.isValidObjectId(lectureId)) {
      res.status(400);
      throw new Error("Invalid lecture.");
    }
    lectures = await Lecture.find({ _id: lectureId, batches: req.batch._id, isPublished: true }).select("title docIndex").lean();
    if (!lectures.length) {
      res.status(404);
      throw new Error("Lecture not found in this batch.");
    }
  } else {
    lectures = await Lecture.find({ batches: req.batch._id, isPublished: true }).select("title docIndex").lean();
  }
  const lectureIds = lectures.map((l) => l._id);
  const lectureTitles = new Map(lectures.map((l) => [String(l._id), l.title]));

  // Lectures made before course chat existed get indexed on first ask.
  const unindexed = lectures.filter((l) => !l.docIndex?.status || l.docIndex.status === "none");
  if (unindexed.length) require("../../utils/docIndex").indexMissing(unindexed.map((l) => l._id)).catch(() => {});

  if (!(await DocChunk.exists({ lecture: { $in: lectureIds } }))) {
    res.status(409);
    throw new Error(
      unindexed.length || lectures.some((l) => l.docIndex?.status === "indexing")
        ? "The course documents are still being prepared. Try again in a minute."
        : "There are no lecture notes or readable files to ask about yet."
    );
  }

  // Free questions per day, not charged to the AI allowance or credits.
  // Past them, a question comes out of a pack the student bought — already
  // paid — or the student is offered one. With no daily limit set, every
  // answer is charged like any AI call.
  let fromPack = false;
  const capped = settings.dailyMessages > 0;
  if (capped) {
    const { usedToday } = await chatAllowance(req.student._id, req.batch._id, settings);
    if (usedToday + cost > settings.dailyMessages) {
      const taken = await DocChatPack.findOneAndUpdate(
        {
          student: req.student._id,
          batch: req.batch._id,
          remaining: { $gte: cost },
          ...(settings.packCarryOver ? {} : { packDay: today() }),
        },
        { $inc: { remaining: -cost } }
      );
      if (!taken) {
        const offer = packOffer(settings);
        res.status(429).json({
          message: usedToday < settings.dailyMessages
            ? `A question with a photo counts as ${IMAGE_COST}, and you have ${settings.dailyMessages - usedToday} left today.${offer ? ` Unlock ${offer.packSize} more for ${offer.packCost} AI credit${offer.packCost === 1 ? "" : "s"}, or ask without the photo.` : " Ask without the photo."}`
            : offer
            ? `You've used today's ${settings.dailyMessages} free questions. Unlock ${offer.packSize} more for ${offer.packCost} AI credit${offer.packCost === 1 ? "" : "s"}, or come back tomorrow.`
            : `You've asked ${usedToday} questions today — the daily limit for course chat. It resets tomorrow.`,
          limitReached: true,
          offer,
        });
        return;
      }
      fromPack = true;
    }
  }

  const refund = () =>
    fromPack ? DocChatPack.updateOne({ student: req.student._id, batch: req.batch._id }, { $inc: { remaining: cost } }) : null;

  // A photo is read first — its text is what gets searched and answered.
  let photoText = "";
  if (image) {
    try {
      const read = await aiService.complete({
        feature: "doc-chat",
        system: "You read photos students take of questions, notes and diagrams. You never answer or solve anything.",
        prompt: "Transcribe all the text in this photo exactly as written, maths in LaTeX between $...$. Then, if there is a diagram, graph or circuit, add one line starting \"Diagram:\" describing it with its labels and values. Output only that.",
        imageUrl: toAbsoluteUrl(req, image),
        student: req.student._id,
        batch: req.batch._id,
        maxTokens: 1500,
        prepaid: capped,
      });
      photoText = String(read.text || "").trim().slice(0, 4000);
    } catch (error) {
      await refund();
      throw error;
    }
  }
  const asked = photoText ? `${question}\n\n[The student's photo says:]\n${photoText}` : question;

  const history = (thread?.messages || []).slice(-HISTORY_TURNS).map((m) => ({ role: m.role, text: m.text }));
  const query = photoText ? `${question} ${photoText}` : searchQuery(question, history);

  let queryVector = null;
  try {
    queryVector = (await aiService.embed([query]))?.[0] || null;
  } catch {
    // keyword search alone
  }
  const { chunks, whole } = await retrieve({ lectureIds, query, queryVector, limit: EXCERPTS, wholeLecture: Boolean(lectureId) });
  const excerpts = chunks.map((chunk, i) => ({ n: i + 1, chunk, label: excerptLabel(chunk, lectureTitles, !lectureId), text: chunk.text }));

  const { system, prompt } = docChatPrompt({
    excerpts,
    history,
    question: asked,
    allowGeneral: settings.allowGeneral !== false,
    whole,
  });
  let data;
  try {
    ({ data } = await aiService.generate({
      feature: "doc-chat",
      schema: docChatAnswer,
      student: req.student._id,
      batch: req.batch._id,
      system,
      prompt,
      maxTokens: 1500,
      prepaid: capped,
    }));
  } catch (error) {
    // No answer, no question used: give the pack question back.
    await refund();
    throw error;
  }
  if (capped && !fromPack) await countFreeQuestion(req.student._id, req.batch._id, cost);

  // The model judged the message abusive: recorded, and no answer given.
  const abusive = Boolean(data?.abusive);
  if (abusive) {
    await recordAbuse({ student: req.student._id, batch: req.batch._id, source: "course-chat", text: question, flaggedBy: "ai" }).catch(() => {});
  }
  const result = abusive
    ? { text: "Let's keep it respectful — ask me anything about your course.", citations: [], found: true, general: false }
    : verifyAnswer(data, excerpts, { allowGeneral: settings.allowGeneral !== false });
  const citations = result.citations.map((c) => ({
    lecture: c.chunk.lecture,
    lectureTitle: lectureTitles.get(String(c.chunk.lecture)),
    kind: c.chunk.source.kind,
    media: c.chunk.source.media,
    title: c.chunk.source.title,
    page: c.chunk.page,
    quote: c.quote,
  }));

  if (!thread) {
    thread = new ChatThread({
      student: req.student._id,
      batch: req.batch._id,
      lecture: lectureId,
      title: question.length > 80 ? `${question.slice(0, 77)}…` : question,
    });
  }
  thread.messages.push({ role: "student", text: question, ...(image && { image }) });
  thread.messages.push({
    role: "assistant",
    text: result.text,
    citations,
    foundInDocuments: result.found,
    generalAnswer: result.general,
  });
  if (!result.found) thread.unanswered += 1;
  await thread.save();

  res.status(200).json({
    threadId: thread._id,
    message: thread.messages[thread.messages.length - 1],
  });
});

//@desc   The student's conversations in this batch (optionally one lecture's)
//@route  GET /api/app/batches/:batchId/chat/threads?lecture=
//@access Private (student + batchAccess + features.aiAssist + features.docChat)
const listThreads = asyncHandler(async (req, res) => {
  const filter = { student: req.student._id, batch: req.batch._id };
  if (req.query.lecture === "none") filter.lecture = null;
  else if (mongoose.isValidObjectId(req.query.lecture)) filter.lecture = req.query.lecture;
  const threads = await ChatThread.find(filter).sort({ updatedAt: -1 }).limit(50).select("lecture title updatedAt messages");
  res.status(200).json({ threads: threads.map((t) => shapeThread(t, { full: false })) });
});

//@desc   One conversation
//@route  GET /api/app/batches/:batchId/chat/threads/:id
const getThread = asyncHandler(async (req, res) => {
  const thread = mongoose.isValidObjectId(req.params.id)
    ? await ChatThread.findOne({ _id: req.params.id, student: req.student._id, batch: req.batch._id })
    : null;
  if (!thread) {
    res.status(404);
    throw new Error("Conversation not found.");
  }
  res.status(200).json(shapeThread(thread));
});

//@desc   Delete a conversation
//@route  DELETE /api/app/batches/:batchId/chat/threads/:id
const deleteThread = asyncHandler(async (req, res) => {
  const result = mongoose.isValidObjectId(req.params.id)
    ? await ChatThread.deleteOne({ _id: req.params.id, student: req.student._id, batch: req.batch._id })
    : { deletedCount: 0 };
  if (!result.deletedCount) {
    res.status(404);
    throw new Error("Conversation not found.");
  }
  res.status(200).json({ deleted: true });
});

//@desc   Which doors are open (for the student app to show them)
//@route  GET /api/app/batches/:batchId/chat/settings
const getChatSettings = asyncHandler(async (req, res) => {
  const config = await AiConfig.get();
  const settings = config.docChat || {};
  const [{ usedToday, remaining }, credits] = await Promise.all([
    chatAllowance(req.student._id, req.batch._id, settings),
    AiCredit.find({ student: req.student._id, batch: { $in: [req.batch._id, null] } }).select("batch balance").lean(),
  ]);
  const freePerDay = settings.dailyMessages || 0;
  res.status(200).json({
    enabled: Boolean(config.features.docChat),
    scope: settings.scope || "both",
    allowGeneral: settings.allowGeneral !== false,
    freePerDay,
    usedToday,
    packRemaining: remaining,
    packCarryOver: Boolean(settings.packCarryOver),
    // Free questions left today plus unlocked ones; null = no daily limit.
    availableToday: freePerDay ? Math.max(0, freePerDay - usedToday) + remaining : null,
    offer: packOffer(settings),
    // Shown beside the unlock button; a pack takes batch credits first,
    // the rest from general.
    credits: {
      batch: credits.find((c) => c.batch)?.balance || 0,
      general: credits.find((c) => !c.batch)?.balance || 0,
    },
  });
});

//@desc   Buy a pack of extra course-chat questions with AI credits — this
//        batch's own credits first, the rest from general credits.
//@route  POST /api/app/batches/:batchId/chat/unlock
//@access Private (student + batchAccess + features.aiAssist + features.docChat)
const unlockPack = asyncHandler(async (req, res) => {
  const config = await AiConfig.get();
  const offer = packOffer(config.docChat || {});
  if (!config.features.docChat || !offer) {
    res.status(400);
    throw new Error("Extra course-chat questions aren't on sale.");
  }

  const student = req.student._id;
  // Each part is taken only if that balance still covers it; if the second
  // part fails (spent elsewhere meanwhile), the first is given back.
  const pay = async () => {
    const balances = await AiCredit.find({ student, batch: { $in: [req.batch._id, null] } }).select("batch balance").lean();
    const batchBalance = balances.find((c) => c.batch)?.balance || 0;
    const generalBalance = balances.find((c) => !c.batch)?.balance || 0;
    if (batchBalance + generalBalance < offer.packCost) return null;
    const parts = [
      { batch: req.batch._id, amount: Math.min(Math.max(batchBalance, 0), offer.packCost) },
    ];
    parts.push({ batch: null, amount: offer.packCost - parts[0].amount });
    const taken = [];
    for (const part of parts.filter((p) => p.amount > 0)) {
      const spent = await AiCredit.updateOne({ student, batch: part.batch, balance: { $gte: part.amount } }, { $inc: { balance: -part.amount } });
      if (!spent.modifiedCount) {
        for (const t of taken) await AiCredit.updateOne({ student, batch: t.batch }, { $inc: { balance: t.amount } });
        return null;
      }
      taken.push(part);
    }
    return taken;
  };
  const taken = await pay();
  const paidFrom = taken?.length === 2 ? "both" : taken?.[0]?.batch ? "batch" : "general";
  if (!taken) {
    res.status(402).json({
      message: `Unlocking ${offer.packSize} more questions costs ${offer.packCost} AI credit${offer.packCost === 1 ? "" : "s"}, and you don't have enough. Buy AI credits first.`,
      needCredits: true,
    });
    return;
  }

  // On the usage dashboard and the student's credit history like any other
  // credit spend.
  AiUsage.create({
    feature: "doc-chat-pack",
    provider: "credits",
    student,
    batch: req.batch._id,
    ok: true,
    featureCost: 0,
    paidWithCredit: true,
    creditsSpent: offer.packCost,
  }).catch(() => {});

  // Without carry-over, questions left from an earlier day's pack are gone,
  // so a new day's pack starts from its own size.
  const day = today();
  const filter = { student, batch: req.batch._id };
  let pack = await DocChatPack.findOneAndUpdate(
    config.docChat?.packCarryOver ? filter : { ...filter, packDay: day },
    { $inc: { remaining: offer.packSize }, $set: { packDay: day } },
    { new: true }
  );
  if (!pack) {
    pack = await DocChatPack.findOneAndUpdate(filter, { $set: { remaining: offer.packSize, packDay: day } }, { upsert: true, new: true });
  }
  await require("../../utils/notify").notify(student, "aiCredits", {
    title: `${offer.packSize} more course-chat questions unlocked`,
    body: `${offer.packCost} AI credit${offer.packCost === 1 ? "" : "s"} used.`,
    link: `/batches/${req.batch._id}/chat`,
  }).catch(() => {});
  res.status(200).json({
    remaining: pack.remaining,
    paidFrom,
    message: `Unlocked ${offer.packSize} more questions.`,
  });
});

//@desc   Upload a photo to ask about
//@route  POST /api/app/batches/:batchId/chat/upload-image
//@access Private (student + batchAccess + features.aiAssist + features.docChat)
const uploadChatImage = asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400);
    throw new Error("No file was received.");
  }
  const stored = await storage.store("chat-images", await preparePhoto(req.file));
  await recordStudentUpload(stored.key, req.student._id, "chat-images");
  res.status(200).json({ url: await storage.urlFor(stored.key, stored.driver) });
});

module.exports = { uploadChatImage, ask, listThreads, getThread, deleteThread, getChatSettings, unlockPack, verifyAnswer, searchQuery, NOT_COVERED };
