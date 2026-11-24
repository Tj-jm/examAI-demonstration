const mongoose = require("mongoose");

// One request to an agent: what was asked, the plan it made, and what
// happened to each step. Steps wait here for approval (the Agent inbox).
const stepSchema = new mongoose.Schema(
  {
    tool: { type: String, required: true },
    title: { type: String, required: true },
    args: { type: mongoose.Schema.Types.Mixed, default: {} },
    // safe: a draft or anything reversible; staff: changes staff work
    // (asks first in "safe" mode); publish: students see it
    risk: { type: String, enum: ["safe", "staff", "publish"], default: "safe" },
    status: {
      type: String,
      enum: ["pending", "approved", "running", "done", "failed", "rejected", "skipped"],
      default: "pending",
    },
    result: { type: mongoose.Schema.Types.Mixed, default: null },
    error: String,
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    decidedAt: Date,
    finishedAt: Date,
  },
  { _id: true }
);

const agentRunSchema = new mongoose.Schema(
  {
    agent: { type: String, required: true, default: "copilot" },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    request: { type: String, required: true, maxlength: 2000 },
    timezone: { type: String, default: "UTC" },
    // planning → awaiting (a step needs approval) / running → done.
    // needs_info: the agent asked a question instead of planning.
    status: {
      type: String,
      enum: ["planning", "awaiting", "running", "done", "failed", "cancelled", "needs_info"],
      default: "planning",
    },
    // The agent's own words: what it plans to do, or its question.
    reply: String,
    error: String,
    mode: { type: String, enum: ["ask", "safe", "auto"], default: "safe" },
    // Asked from the form view: every step waits, and staff may change any
    // field before running the lot.
    form: { type: Boolean, default: false },
    steps: { type: [stepSchema], default: [] },
    batches: [{ type: mongoose.Schema.Types.ObjectId, ref: "Batch" }],
    // Earlier tries of a copilot request that was edited and asked again.
    history: {
      type: [{ request: String, reply: String, error: String, plan: String, at: Date, _id: false }],
      default: [],
    },
    // The conversation as the Workspace view shows it: what staff wrote
    // (the request and each follow-up) and each reply.
    chat: {
      type: [{ from: { type: String, enum: ["staff", "agent"] }, text: String, at: Date, _id: false }],
      default: [],
    },
    // The tool drawers the plan uses (agents/engine.js DRAWERS).
    drawers: { type: [String], default: [] },
    // When each retry was planned: counts toward the daily request limit.
    retries: { type: [Date], default: [] },
    // Deleted from the page. Kept a while so the background agents still
    // know what they already did, then removed by the TTL index below.
    hidden: { type: Boolean, default: false },
    deleteAfter: { type: Date, default: null },
  },
  { timestamps: true }
);

agentRunSchema.index({ user: 1, createdAt: -1 });
agentRunSchema.index({ status: 1, updatedAt: -1 });
agentRunSchema.index({ agent: 1, createdAt: -1 });
agentRunSchema.index({ deleteAfter: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("AgentRun", agentRunSchema);
