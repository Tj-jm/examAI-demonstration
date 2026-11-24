const asyncHandler = require("express-async-handler");
const PerformanceSettings = require("../../models/performanceSettingsModel");
const AiConfig = require("../../models/aiConfigModel");
const AiUsage = require("../../models/aiUsageModel");
const shared = require("../../utils/shared");
const cache = require("../../utils/cache");
const os = require("os");

// Settings → Performance: how the app trades freshness for speed and
// AI cost, and what that is doing right now. Owner/admin only.

// The saved-result prices live with the other AI prices (AiConfig), but are
// set here, next to the reuse settings they belong to.
const SAVED_COST_KEYS = [
  "practice-similar-saved", "archive-similar-saved",
  "practice-hint-saved", "archive-hint-saved",
  "practice-explain-saved", "archive-explain-saved",
];

const savedModel = () => (true ? require("../../models/savedAiResultModel.pro") : null);

const shape = async () => {
  const settings = (await PerformanceSettings.get()).toObject();
  const config = true ? await AiConfig.get() : null;
  const savedCosts = {};
  for (const key of SAVED_COST_KEYS) savedCosts[key] = config ? config.getFeatureCost(key) : 0;
  return {
    cache: settings.cache,
    reuse: settings.reuse,
    background: settings.background,
    leaderboard: settings.leaderboard,
    leaderboardMinutes: settings.leaderboardMinutes,
    autosave: settings.autosave,
    autosaveFlushSeconds: settings.autosaveFlushSeconds,
    live: settings.live,
    savedCosts,
    redis: shared.kind === "redis",
    ai: true,
  };
};

//@desc   The Performance settings
//@route  GET /api/performance
//@access Private (owner, admin)
const getSettings = asyncHandler(async (req, res) => {
  res.status(200).json(await shape());
});

// Copies the allowed fields of one group, so a stray field can't land.
const pick = (target, source, fields) => {
  if (!source || typeof source !== "object") return;
  for (const f of fields) if (source[f] !== undefined) target.set(f, source[f]);
};

//@desc   Save the Performance settings
//@route  PUT /api/performance
//@access Private (owner, admin)
const updateSettings = asyncHandler(async (req, res) => {
  const settings = await PerformanceSettings.findOne({ singleton: "performance" }) || new PerformanceSettings({ singleton: "performance" });
  const b = req.body || {};
  if (b.cache) for (const f of ["dashboard", "practice", "archive", "landing", "access", "maxAgeMinutes"]) {
    if (b.cache[f] !== undefined) settings.set(`cache.${f}`, b.cache[f]);
  }
  if (b.reuse) for (const f of ["similar", "poolSize", "servesPerSet", "approval", "savedCharge", "hints", "hintApproval", "explanations"]) {
    if (b.reuse[f] !== undefined) settings.set(`reuse.${f}`, b.reuse[f]);
  }
  if (b.background) for (const f of ["examReport", "ingestConcurrency"]) {
    if (b.background[f] !== undefined) settings.set(`background.${f}`, b.background[f]);
  }
  pick(settings, b, ["leaderboard", "leaderboardMinutes", "autosave", "autosaveFlushSeconds"]);
  if (b.live) for (const f of ["maxParticipants", "blockWhenFull", "alertPercent"]) {
    if (b.live[f] !== undefined) settings.set(`live.${f}`, b.live[f]);
  }

  try {
    await settings.save();
  } catch (error) {
    res.status(400);
    throw new Error(error.errors ? Object.values(error.errors)[0].message : error.message);
  }

  if (b.savedCosts && true) {
    const config = await AiConfig.get(true);
    for (const key of SAVED_COST_KEYS) {
      const value = Number(b.savedCosts[key]);
      if (Number.isFinite(value) && value >= 0 && value <= 1000) config.featureCosts[key] = Math.round(value);
    }
    await config.save();
  }

  // A cache switched off or a shorter max age: start clean.
  if (b.cache) await cache.clear();
  res.status(200).json(await shape());
});

//@desc   What the speed-ups are doing now: Redis, cache hits, the queue,
//        the exam autosave buffer and what reused AI results saved
//@route  GET /api/performance/status
//@access Private (owner, admin)
const getStatus = asyncHandler(async (req, res) => {
  const optional = (path) => {
    try {
      return require(path);
    } catch {
      return null;
    }
  };
  const queue = optional("../../utils/queue");
  const autosave = optional("../../utils/autosave");

  const since = new Date(Date.now() - 30 * 86400000);
  const [redis, cacheStats, queueStats, autosaveStats, reuse] = await Promise.all([
    shared.status().catch((e) => ({ backend: shared.kind, connected: false, error: e.message })),
    cache.stats(),
    queue?.stats ? queue.stats().catch(() => null) : null,
    autosave?.stats ? autosave.stats().catch(() => null) : null,
    true
      ? AiUsage.aggregate([
          { $match: { reused: true, createdAt: { $gte: since } } },
          { $group: { _id: "$feature", served: { $sum: 1 }, savedUsd: { $sum: "$savedUsd" }, credits: { $sum: "$featureCost" } } },
        ])
      : [],
  ]);

  const Saved = savedModel();
  const saved = Saved
    ? Object.fromEntries((await Saved.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }])).map((r) => [r._id, r.n]))
    : {};

  const mem = process.memoryUsage();
  res.status(200).json({
    at: new Date().toISOString(),
    // The server that answered: with several, each poll may land on another.
    server: {
      host: os.hostname(),
      pid: process.pid,
      uptimeS: Math.round(process.uptime()),
      rssBytes: mem.rss,
      heapBytes: mem.heapUsed,
      load: os.loadavg()[0],
      cpus: os.cpus().length,
    },
    redis,
    cache: cacheStats,
    queue: queueStats,
    autosave: autosaveStats,
    reuse: {
      last30Days: reuse.map((r) => ({ feature: r._id, served: r.served, savedUsd: Math.round(r.savedUsd * 10000) / 10000, credits: r.credits })),
      saved,
    },
  });
});

//@desc   Clear every cached read, on every server
//@route  POST /api/performance/cache/clear
//@access Private (owner, admin)
const clearCache = asyncHandler(async (req, res) => {
  await cache.clear();
  res.status(200).json({ ok: true });
});

// ---------------------------------------------------------------- saved AI results

const PAGE = 20;

//@desc   Saved AI results, newest first (Review → Saved AI sets)
//@route  GET /api/performance/saved?status=&kind=&page=
//@access Private (owner, admin)
const listSaved = asyncHandler(async (req, res) => {
  const Saved = savedModel();
  const filter = {};
  if (["active", "pending_review", "retired"].includes(req.query.status)) filter.status = req.query.status;
  if (["similar", "hint", "explanation"].includes(req.query.kind)) filter.kind = req.query.kind;
  const page = Math.max(1, Number(req.query.page) || 1);
  const [items, total] = await Promise.all([
    Saved.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * PAGE)
      .limit(PAGE)
      .select("-servedTo")
      .populate("question", "question type topic chapter")
      .lean(),
    Saved.countDocuments(filter),
  ]);
  res.status(200).json({ items, total, page, pages: Math.max(1, Math.ceil(total / PAGE)) });
});

const findSaved = async (req, res) => {
  const row = await savedModel().findById(req.params.id);
  if (!row) {
    res.status(404);
    throw new Error("Saved result not found.");
  }
  return row;
};

//@desc   Approve a saved result: students may now be served it
//@route  POST /api/performance/saved/:id/approve
//@access Private (owner, admin)
const approveSaved = asyncHandler(async (req, res) => {
  const row = await findSaved(req, res);
  row.status = "active";
  row.reviewedBy = req.user._id;
  row.reviewedAt = new Date();
  await row.save();
  res.status(200).json({ ok: true });
});

//@desc   Retire a saved result: never served again
//@route  POST /api/performance/saved/:id/reject
//@access Private (owner, admin)
const rejectSaved = asyncHandler(async (req, res) => {
  const row = await findSaved(req, res);
  row.status = "retired";
  row.reviewedBy = req.user._id;
  row.reviewedAt = new Date();
  await row.save();
  res.status(200).json({ ok: true });
});

//@desc   Put a saved set of similar questions in the question bank, filed
//        like the question they came from, waiting in Review like any AI
//        question
//@route  POST /api/performance/saved/:id/add-to-bank
//@access Private (owner, admin)
const addSavedToBank = asyncHandler(async (req, res) => {
  const row = await findSaved(req, res);
  if (row.kind !== "similar" || !Array.isArray(row.payload?.questions)) {
    res.status(400);
    throw new Error("Only a set of similar questions can go to the question bank.");
  }
  const { Question, Mcq } = require("../../models/questionModel");
  const source = await Question.findById(row.question).lean();
  if (!source) {
    res.status(404);
    throw new Error("The question this set came from no longer exists.");
  }
  const docs = row.payload.questions
    .filter((q) => q.type === "mcq" || !q.type)
    .map((q) => ({
      question: q.question,
      options: q.options,
      correctOption: q.correctOption,
      solutionText: q.solutionText,
      difficulty: q.difficulty || "medium",
      skillType: q.skillType || null,
      subject: source.subject,
      chapter: source.chapter,
      topic: source.topic || null,
      batches: source.batches || [],
      marks: source.marks || 1,
      source: "ai",
      status: "pending_review",
      aiMeta: { model: row.model, promptVersion: "similar-saved", sourceRef: String(row._id) },
    }));
  const created = await Mcq.insertMany(docs);
  res.status(201).json({ added: created.length });
});

//@desc   Delete a saved result for good (Retire keeps it, unserved)
//@route  DELETE /api/performance/saved/:id
//@access Private (owner, admin)
const deleteSaved = asyncHandler(async (req, res) => {
  const row = await findSaved(req, res);
  await row.deleteOne();
  res.status(200).json({ ok: true });
});

//@desc   In-app live classes right now: who's in, the servers, capacity
//@route  GET /api/performance/live
//@access Private (owner, admin)
const getLive = asyncHandler(async (req, res) => {
  res.status(200).json(await require("../../utils/liveMonitor").snapshot());
});

//@desc   Peak people per day and the busiest hours, from samples
//@route  GET /api/performance/live/history?days=7|30
//@access Private (owner, admin)
const getLiveHistory = asyncHandler(async (req, res) => {
  res.status(200).json(await require("../../utils/liveMonitor").history(Number(req.query.days) || 7));
});

module.exports = { getLive, getLiveHistory, getSettings, updateSettings, getStatus, clearCache, listSaved, approveSaved, rejectSaved, addSavedToBank, deleteSaved, SAVED_COST_KEYS };
