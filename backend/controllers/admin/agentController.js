const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const AgentRun = require("../../models/agentRunModel");
const engine = require("../../agents/engine");

// Agents (admin side): give the copilot an instruction, see its plan,
// approve or reject steps (the Agent inbox), cancel.

const canSee = (user, run) => ["owner", "admin"].includes(user.role) || String(run.user) === String(user._id);

const loadRun = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) { res.status(404); throw new Error("Request not found."); }
  const run = await AgentRun.findById(req.params.id);
  if (!run || run.hidden || !canSee(req.user, run)) { res.status(404); throw new Error("Request not found."); }
  return run;
};

//@desc   Whether this person can use the copilot, and on which batches
//@route  GET /api/agents/status
//@access Private
const getStatus = asyncHandler(async (req, res) => {
  const blocked = await engine.blockedFor(req.user);
  const batches = await engine.allowedBatches(req.user);
  const s = await engine.settings();
  const background = Object.entries(engine.AGENTS).filter(([, a]) => a.background).map(([key, a]) => ({
    key, label: a.label, enabled: Boolean(s.enabled && s[key]?.enabled), mode: s[key]?.mode || "safe", batchFeature: a.batchFeature,
  }));
  const waiting = await AgentRun.countDocuments({
    status: { $in: ["awaiting", "needs_info"] },
    hidden: { $ne: true },
    ...(["owner", "admin"].includes(req.user.role) ? {} : { user: req.user._id }),
  });
  res.status(200).json({
    available: !blocked,
    reason: blocked,
    mode: s.copilot?.mode || "safe",
    view: s.copilot?.view || "classic",
    batches: batches.map((b) => ({ _id: b._id, name: b.name })),
    background: ["owner", "admin"].includes(req.user.role) ? background : [],
    waiting,
  });
});

//@desc   Give the copilot an instruction
//@route  POST /api/agents/runs  { request, timezone }
//@access Private
const createRun = asyncHandler(async (req, res) => {
  const request = String(req.body.request || "").trim();
  if (request.length < 4) { res.status(400); throw new Error("Tell the copilot what to do."); }
  const blocked = await engine.blockedFor(req.user);
  if (blocked) { res.status(403); throw new Error(blocked); }
  const run = await engine.start({ user: req.user, request, timezone: String(req.body.timezone || "UTC").slice(0, 60), form: req.body.form === true });
  res.status(201).json(await engine.shape(run, req.user));
});

//@desc   Requests, newest first, a page at a time.
//        ?agent=copilot|grading|…  ?status=waiting|open|done|failed|cancelled
//        ?q=text  ?page=1  ?limit=20
//@route  GET /api/agents/runs
//@access Private
const STATUS_GROUPS = {
  waiting: ["awaiting", "needs_info"],
  open: ["planning", "running", "awaiting", "needs_info"],
  done: ["done"],
  failed: ["failed"],
  cancelled: ["cancelled"],
};
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const runFilter = (req) => {
  const q = { hidden: { $ne: true }, ...(["owner", "admin"].includes(req.user.role) ? {} : { user: req.user._id }) };
  if (req.query.agent && engine.AGENTS[req.query.agent]) q.agent = String(req.query.agent);
  const group = STATUS_GROUPS[req.query.status];
  if (group) q.status = { $in: group };
  const text = String(req.query.q || "").trim().slice(0, 100);
  if (text) q.$or = [{ request: { $regex: escapeRe(text), $options: "i" } }, { reply: { $regex: escapeRe(text), $options: "i" } }];
  return q;
};
const getRuns = asyncHandler(async (req, res) => {
  const q = runFilter(req);
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
  const total = await AgentRun.countDocuments(q);
  const pages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(Math.max(Number(req.query.page) || 1, 1), pages);
  const runs = await AgentRun.find(q).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate("user", "name");
  res.status(200).json({ runs: await Promise.all(runs.map((r) => engine.shape(r, req.user))), total, page, pages, limit });
});

//@desc   Edit a copilot request that asked a question or stopped, and ask again
//@route  POST /api/agents/runs/:id/retry  { request }
//@access Private
const retryRun = asyncHandler(async (req, res) => {
  const run = await loadRun(req, res);
  const request = String(req.body.request || "").trim();
  if (request.length < 4) { res.status(400); throw new Error("Tell the copilot what to do."); }
  const blocked = await engine.blockedFor(req.user);
  if (blocked) { res.status(403); throw new Error(blocked); }
  try {
    await engine.retry(run, request, req.user);
  } catch (err) {
    res.status(err.statusCode || 400);
    throw err;
  }
  res.status(200).json(await engine.shape(run, req.user));
});

//@desc   A follow-up in the copilot chat: the plan is remade with it
//@route  POST /api/agents/runs/:id/revise  { message }
//@access Private
const reviseRun = asyncHandler(async (req, res) => {
  const run = await loadRun(req, res);
  const message = String(req.body.message || "").trim();
  if (message.length < 2) { res.status(400); throw new Error("Write what to change."); }
  const blocked = await engine.blockedFor(req.user);
  if (blocked) { res.status(403); throw new Error(blocked); }
  try {
    await engine.revise(run, message, req.user);
  } catch (err) {
    res.status(err.statusCode || 400);
    throw err;
  }
  res.status(200).json(await engine.shape(run, req.user));
});

//@desc   Remove a request from the page
//@route  DELETE /api/agents/runs/:id
//@access Private
const deleteRun = asyncHandler(async (req, res) => {
  const run = await loadRun(req, res);
  if (run.hidden) { res.status(404); throw new Error("Request not found."); }
  try {
    await engine.hide(run);
  } catch (err) {
    res.status(err.statusCode || 400);
    throw err;
  }
  res.status(200).json({ ok: true });
});

//@desc   Remove finished requests in bulk: the ones picked, or every finished
//        one matching the page's filters
//@route  POST /api/agents/runs/clear  { ids? }  (filters as in GET /runs)
//@access Private
const FINISHED = ["done", "failed", "cancelled", "needs_info"];
const clearRuns = asyncHandler(async (req, res) => {
  const q = runFilter(req);
  if (Array.isArray(req.body.ids)) {
    q._id = { $in: req.body.ids.filter((x) => mongoose.isValidObjectId(x)).slice(0, 200) };
  }
  // Never active work, whatever the filter says.
  q.status = q.status ? { $in: q.status.$in.filter((x) => FINISHED.includes(x)) } : { $in: FINISHED };
  const r = await AgentRun.updateMany(q, { $set: { hidden: true, deleteAfter: new Date(Date.now() + 30 * 86400000) } });
  res.status(200).json({ cleared: r.modifiedCount || 0 });
});

//@desc   One request
//@route  GET /api/agents/runs/:id
//@access Private
const getRun = asyncHandler(async (req, res) => {
  const run = await loadRun(req, res);
  await run.populate("user", "name");
  res.status(200).json(await engine.shape(run, req.user));
});

//@desc   Approve or reject steps waiting for a person
//@route  POST /api/agents/runs/:id/decide  { stepIds: [] | "all", approve }
//@access Private
const decide = asyncHandler(async (req, res) => {
  const run = await loadRun(req, res);
  if (!["awaiting", "running"].includes(run.status)) { res.status(409); throw new Error("Nothing in this request is waiting for a decision."); }
  // Approving needs the same right as asking: the copilot still on, and
  // this person allowed to use it.
  const blocked = await engine.blockedFor(req.user, run.agent).then((r) => (r && /limit/.test(r) ? null : r));
  if (blocked && req.body.approve) { res.status(403); throw new Error(blocked); }
  const ids = req.body.stepIds === "all"
    ? run.steps.filter((s) => s.status === "pending").map((s) => String(s._id))
    : (Array.isArray(req.body.stepIds) ? req.body.stepIds.map(String) : []);
  const rejectIds = Array.isArray(req.body.rejectIds) ? req.body.rejectIds.map(String) : [];
  if (!ids.length && !rejectIds.length) { res.status(400); throw new Error("Pick the steps to decide on."); }
  await engine.decide(run, ids, Boolean(req.body.approve), req.user, rejectIds);
  res.status(200).json(await engine.shape(run, req.user));
});

//@desc   Change a waiting step's editable fields (e.g. a drafted answer)
//@route  PUT /api/agents/runs/:id/steps/:stepId  { args }
//@access Private
const editStep = asyncHandler(async (req, res) => {
  const run = await loadRun(req, res);
  try {
    await engine.editStep(run, req.params.stepId, req.body.args);
  } catch (err) {
    res.status(err.statusCode || 400);
    throw err;
  }
  res.status(200).json(await engine.shape(run, req.user));
});

//@desc   Remake ({ action: "remake", prompt? }) or remove a waiting step's picture
//@route  POST /api/agents/runs/:id/steps/:stepId/picture
//@access Private
const stepPicture = asyncHandler(async (req, res) => {
  const run = await loadRun(req, res);
  const action = req.body.action === "remove" ? "remove" : "remake";
  try {
    await engine.stepPicture(run, req.params.stepId, { action, prompt: typeof req.body.prompt === "string" ? req.body.prompt : "" }, req.user);
  } catch (err) {
    res.status(err.statusCode || 400);
    throw err;
  }
  res.status(200).json(await engine.shape(run, req.user));
});

//@desc   Form view: what a waiting step would act on
//@route  POST /api/agents/runs/:id/steps/:stepId/preview
//@access Private
const previewStep = asyncHandler(async (req, res) => {
  const run = await loadRun(req, res);
  try {
    res.status(200).json(await engine.previewStep(run, req.params.stepId, req.body.args, req.user));
  } catch (err) {
    res.status(err.statusCode || 400);
    throw err;
  }
});

//@desc   Stop a request; steps not yet done are skipped
//@route  POST /api/agents/runs/:id/cancel
//@access Private
const cancelRun = asyncHandler(async (req, res) => {
  const run = await loadRun(req, res);
  if (["done", "failed", "cancelled"].includes(run.status)) { res.status(409); throw new Error("This request has already finished."); }
  await engine.cancel(run);
  res.status(200).json(await engine.shape(run, req.user));
});

//@desc   Run a background agent's pass now (grading, after-class)
//@route  POST /api/agents/sweep/:agent
//@access Private (owner, admin)
const sweepNow = asyncHandler(async (req, res) => {
  const passes = {
    grading: () => require("../../agents/grading").sweep(),
    afterClass: () => require("../../agents/afterClass").sweep(),
    atRisk: () => require("../../agents/atRisk").sweep({ force: true }),
    support: () => require("../../agents/support").sweep({ force: true }),
    marketing: () => require("../../agents/marketing").sweep({ force: true }),
  };
  if (!passes[req.params.agent]) { res.status(404); throw new Error("No such agent."); }
  if (!["owner", "admin"].includes(req.user.role)) { res.status(403); throw new Error("Only an owner or admin can run agents."); }
  const result = await passes[req.params.agent]();
  res.status(200).json(result || {});
});

module.exports = { getStatus, createRun, getRuns, getRun, decide, cancelRun, sweepNow, editStep, stepPicture, previewStep, retryRun, reviseRun, deleteRun, clearRuns };
