const mongoose = require("mongoose");
const singletonCache = require("../utils/singletonCache");

// How the app trades freshness for speed and AI cost. Each choice is the
// admin's (Settings → Performance, Pro): a coaching centre running one
// 1,000-student exam a week wants different defaults from one that sells
// endless AI practice. Defaults keep behaviour close to what it was before
// these settings existed, except where the new way is plainly better.
const performanceSettingsSchema = new mongoose.Schema(
  {
    singleton: { type: String, default: "performance", unique: true },

    // Read caching: shared (not per-student) results of heavy queries, kept
    // until the data behind them changes, or at most maxAgeMinutes.
    cache: {
      dashboard: { type: Boolean, default: true },
      practice: { type: Boolean, default: true },
      archive: { type: Boolean, default: true },
      landing: { type: Boolean, default: true },
      access: { type: Boolean, default: true },
      maxAgeMinutes: { type: Number, default: 10, min: 1, max: 1440 },
    },

    // Student AI: serve a saved result or ask the AI again.
    reuse: {
      // fresh: every request calls the AI (the old behaviour).
      // saved: call the AI only when nothing is saved for that question.
      // mix: keep up to poolSize saved sets per question, and once each has
      //      been served servesPerSet times, make one more in the background.
      similar: { type: String, enum: ["mix", "saved", "fresh"], default: "mix" },
      poolSize: { type: Number, default: 3, min: 1, max: 20 },
      servesPerSet: { type: Number, default: 20, min: 1, max: 10000 },
      // auto: a new set is served at once. review: it waits in Review first,
      // and students get fresh AI until one is approved.
      approval: { type: String, enum: ["auto", "review"], default: "auto" },
      // What a student pays for a set someone else's request already paid for.
      savedCharge: { type: String, enum: ["reduced", "full", "free"], default: "reduced" },
      hints: { type: String, enum: ["saved", "fresh"], default: "saved" },
      // Same as approval, for saved hint chains.
      hintApproval: { type: String, enum: ["auto", "review"], default: "auto" },
      explanations: { type: String, enum: ["saved", "fresh"], default: "saved" },
    },

    // Long AI work: in the request (student waits) or in the background.
    background: {
      examReport: { type: String, enum: ["queued", "instant"], default: "queued" },
      // Document runs at once, across every server.
      ingestConcurrency: { type: Number, default: 2, min: 1, max: 20 },
    },

    // live: a graded submission moves the board at once (Redis).
    // periodic: recomputed at most every leaderboardMinutes.
    leaderboard: { type: String, enum: ["live", "periodic"], default: "live" },
    leaderboardMinutes: { type: Number, default: 5, min: 1, max: 1440 },

    // buffered: exam answers are held in Redis and written to the database
    // every autosaveFlushSeconds and on submit. direct: every change is a
    // database write (the old behaviour; the only choice without Redis).
    autosave: { type: String, enum: ["buffered", "direct"], default: "buffered" },
    autosaveFlushSeconds: { type: Number, default: 10, min: 2, max: 120 },

    // In-app live classes (utils/liveMonitor.js). maxParticipants: how many
    // people this LiveKit server can take at once, across every class; 0
    // means not set. blockWhenFull: a student can't join once it's reached.
    // alertPercent: the Performance page warns from this share.
    live: {
      maxParticipants: { type: Number, default: 0, min: 0, max: 100000 },
      blockWhenFull: { type: Boolean, default: false },
      alertPercent: { type: Number, default: 90, min: 10, max: 100 },
    },
  },
  { timestamps: true }
);

singletonCache.attach(performanceSettingsSchema, "PerformanceSettings");

performanceSettingsSchema.statics.get = async function () {
  return this.cachedGet("plain", async () => {
    let settings = await this.findOne({ singleton: "performance" });
    if (!settings) settings = await this.create({ singleton: "performance" });
    return settings;
  });
};

// Settings as plain values, with defaults, for code that must not fail when
// the database is slow or down (a cache decision is never worth an error).
performanceSettingsSchema.statics.safeGet = async function () {
  try {
    return (await this.get()).toObject();
  } catch {
    return new this({ singleton: "performance" }).toObject();
  }
};

module.exports = mongoose.model("PerformanceSettings", performanceSettingsSchema);
