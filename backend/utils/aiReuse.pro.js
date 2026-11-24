const crypto = require("crypto");
const { questionText, fullQuestionText } = require("./questionText");
const SavedAiResult = require("../models/savedAiResultModel.pro");
const aiService = require("../ai/service");
const shared = require("./shared");

// Serving a saved AI result instead of making a new, billed AI call.
// The admin chooses per kind in Settings → Performance:
//
//   similar questions  fresh  every request asks the AI (the old behaviour)
//                      saved  ask only when nothing is saved for the question
//                      mix    keep up to poolSize sets; serve one the student
//                             hasn't seen; once every set has been served
//                             servesPerSet times, make one more in the
//                             background, until the pool is full
//   hints              saved / fresh  (a chain of up to 3 per question)
//   explanations       saved / fresh  (one per wrong answer chosen)
//
// A saved result is billed at the "-saved" cost (reduced), the full cost, or
// nothing (savedCharge). New sets can wait for an admin's approval before
// anyone is served them (approval "review"): until then students get fresh
// AI, as if nothing were saved.
//
// Results belong to one version of the question (contentKey), so an edited
// question never gets an old answer.

// What the AI was shown about a question; a change here makes new results.
const contentKey = (q) => {
  const pick = {
    type: q.type,
    question: questionText(q),
    options: (q.options || []).map((o) => [o.key, o.text]),
    correctOption: q.correctOption,
    statements: (q.statements || []).map((s) => [s.text, s.answer ?? s.isTrue]),
    modelAnswer: q.modelAnswer,
    rubric: (q.rubric || []).map((r) => [r.criterion, r.marks]),
    solutionText: q.solutionText,
    subQuestions: (q.subQuestions || []).map((s) => [s.question, (s.options || []).map((o) => [o.key, o.text]), s.correctOption]),
  };
  return crypto.createHash("sha1").update(JSON.stringify(pick)).digest("hex");
};

let perfModel = null;
const settings = async () => {
  perfModel = perfModel || require("../models/performanceSettingsModel");
  const s = await perfModel.safeGet();
  return s.reuse || {};
};

const SERVED_TO_KEEP = 500;
const sameId = (a, b) => String(a) === String(b);

// Bill a saved result per the admin's choice.
const charge = async ({ savedCharge, feature, student, batch, savedUsd }) =>
  aiService.chargeReuse({
    feature: savedCharge === "full" ? feature : `${feature}-saved`,
    student,
    batch,
    free: savedCharge === "free",
    savedUsd,
  });

const markServed = (id, student) =>
  SavedAiResult.updateOne(
    { _id: id },
    { $inc: { servedCount: 1 }, $push: { servedTo: { $each: [student], $slice: -SERVED_TO_KEEP } } }
  ).catch(() => {});

const save = async ({ kind, question, key, variant = "", status = "active", payload, hints, feature, usage, student }) => {
  const costUsd = await aiService.usageCostUsd(usage).catch(() => 0);
  return SavedAiResult.create({
    kind, question, contentKey: key, variant, status, payload, hints, feature,
    model: usage?.model || "", costUsd, createdFor: student || null,
    servedCount: student ? 1 : 0, servedTo: student ? [student] : [],
  });
};

// A background top-up: one at a time per question, across every server
// (a shared lock), and never in the way of the student's response. A lost
// top-up only means a later request makes the set itself.
const topUps = new Set();
const background = (name, fn) => {
  if (topUps.has(name)) return;
  topUps.add(name);
  setImmediate(async () => {
    try {
      await shared.runOnce(`reuse-topup:${name}`, TOPUP_LOCK_MS, fn);
    } catch {
      // see above
    } finally {
      topUps.delete(name);
    }
  });
};
const TOPUP_LOCK_MS = 2 * 60 * 1000;

// ---------------------------------------------------------------- similar

// generate(): the fresh AI call for this student → { data, usage }.
// makeSet(): the same call with nobody billed, for background top-ups.
const similar = async ({ question, feature, student, batch, generate, makeSet }) => {
  const r = await settings();
  const mode = r.similar || "mix";
  if (mode === "fresh") return (await generate()).data;

  const key = contentKey(question);
  const sets = await SavedAiResult.find({ kind: "similar", question: question._id, contentKey: key, status: { $in: ["active", "pending_review"] } })
    .sort({ servedCount: 1, createdAt: 1 })
    .lean();
  const active = sets.filter((s) => s.status === "active");
  const poolSize = r.poolSize || 3;
  const reviewFirst = r.approval === "review";

  const unseen = active.find((s) => !(s.servedTo || []).some((id) => sameId(id, student)));
  const pick = unseen || (mode === "saved" ? active[0] : null);

  if (pick) {
    await charge({ savedCharge: r.savedCharge || "reduced", feature, student, batch, savedUsd: pick.costUsd || 0 });
    await markServed(pick._id, student);

    // Mix: every set used servesPerSet times and room in the pool → one more.
    const servesPerSet = r.servesPerSet || 20;
    const used = active.every((s) => s.servedCount + (sameId(s._id, pick._id) ? 1 : 0) >= servesPerSet);
    if (mode === "mix" && used && sets.length < poolSize && makeSet) {
      background(`similar:${question._id}:${key}`, async () => {
        const fresh = await makeSet();
        await save({ kind: "similar", question: question._id, key, status: reviewFirst ? "pending_review" : "active", payload: fresh.data, feature, usage: fresh.usage });
      });
    }
    return pick.payload;
  }

  // Nothing (unseen) to serve: a new set, paid in full, kept for the next
  // students while the pool has room.
  const fresh = await generate();
  if (sets.length < poolSize) {
    await save({
      kind: "similar", question: question._id, key, status: reviewFirst ? "pending_review" : "active",
      payload: fresh.data, feature, usage: fresh.usage, student,
    }).catch(() => {});
  }
  return fresh.data;
};

// ---------------------------------------------------------------- hints

const norm = (t) => String(t || "").replace(/\s+/g, " ").trim();

// generate(): the fresh hint → { hint, usage }. previousHints: what the
// student was already given; a saved chain is used only when it starts
// with exactly those (so hint 2 always follows on from the hint 1 shown).
const hint = async ({ question, subIndex, level, previousHints, feature, student, batch, generate }) => {
  const r = await settings();
  if ((r.hints || "saved") === "fresh") return (await generate()).hint;

  const key = contentKey(question);
  const variant = subIndex !== undefined && subIndex !== null && subIndex !== "" ? `sub:${Number(subIndex)}` : "";
  // A chain waiting for approval (hintApproval "review") still grows, but
  // students get fresh hints until an admin approves it.
  const chain = await SavedAiResult.findOne({ kind: "hint", question: question._id, contentKey: key, variant, status: { $in: ["active", "pending_review"] } }).lean();
  const hints = chain?.hints || [];
  const prefixMatches = previousHints.length === level - 1 && previousHints.every((h, i) => norm(h) === norm(hints[i]));

  if (chain?.status === "active" && prefixMatches && hints[level - 1]) {
    await charge({ savedCharge: r.savedCharge || "reduced", feature, student, batch, savedUsd: chain.costUsd ? chain.costUsd / Math.max(1, hints.length) : 0 });
    await markServed(chain._id, student);
    return hints[level - 1];
  }

  const fresh = await generate();
  // Extend the chain when this hint is its next link.
  if (prefixMatches && hints.length === level - 1) {
    if (chain) {
      const costUsd = await aiService.usageCostUsd(fresh.usage).catch(() => 0);
      await SavedAiResult.updateOne(
        { _id: chain._id, hints: { $size: level - 1 } },
        { $push: { hints: fresh.hint }, $inc: { costUsd } }
      ).catch(() => {});
    } else if (level === 1) {
      await save({ kind: "hint", question: question._id, key, variant, status: r.hintApproval === "review" ? "pending_review" : "active", hints: [fresh.hint], feature, usage: fresh.usage, student }).catch(() => {});
    }
  }
  return fresh.hint;
};

// ---------------------------------------------------------------- explanations

// The answer being explained: the option chosen, or the true/false marks.
const answerVariant = (question, { selectedOption, statementAnswers }) =>
  question.type === "mcq" ? `opt:${String(selectedOption ?? "")}` : `tf:${JSON.stringify((statementAnswers || []).map((a) => (a === null || a === undefined ? null : Boolean(a))))}`;

// generate(): the fresh explanation → { data, usage }.
const explanation = async ({ question, answer, feature, student, batch, generate }) => {
  const r = await settings();
  if ((r.explanations || "saved") === "fresh") return (await generate()).data;

  const key = contentKey(question);
  const variant = answerVariant(question, answer);
  const saved = await SavedAiResult.findOne({ kind: "explanation", question: question._id, contentKey: key, variant, status: "active" }).lean();
  if (saved) {
    await charge({ savedCharge: r.savedCharge || "reduced", feature, student, batch, savedUsd: saved.costUsd || 0 });
    await markServed(saved._id, student);
    return saved.payload;
  }
  const fresh = await generate();
  await save({ kind: "explanation", question: question._id, key, variant, payload: fresh.data, feature, usage: fresh.usage, student }).catch(() => {});
  return fresh.data;
};

// Results of questions whose content has changed are retired, so the review
// list and the savings count only what can still be served. Run from the
// queue's housekeeping (and by tests).
const retireStale = async () => {
  const { Question } = require("../models/questionModel");
  let retired = 0;
  const cursor = SavedAiResult.find({ status: { $ne: "retired" } }).select("question contentKey").lean().cursor();
  const current = new Map();
  for await (const row of cursor) {
    const id = String(row.question);
    if (!current.has(id)) {
      const q = await Question.findById(row.question).lean();
      current.set(id, q ? contentKey(q) : null);
    }
    if (current.get(id) !== row.contentKey) {
      await SavedAiResult.updateOne({ _id: row._id }, { $set: { status: "retired" } });
      retired += 1;
    }
  }
  return retired;
};

module.exports = { similar, hint, explanation, contentKey, retireStale, answerVariant };
