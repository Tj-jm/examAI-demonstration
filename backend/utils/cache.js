const shared = require("./shared");

// Results of heavy reads that every student shares — a batch's practice
// topic counts, the archive's board/year filters, the landing page — kept
// until the data behind them changes.
//
//   cache.wrap("practice:topics:<batch>", ["batch:<id>", "questions"], fn)
//
// Each entry is filed under tags naming what it was built from. A write
// calls cache.touch("questions") and every entry filed under that tag is
// gone at once — no waiting for a timer, no stale page after an admin edit.
// A timer (settings.cache.maxAgeMinutes) is only the safety net for a write
// path that forgot to touch.
//
// Tags are version numbers. An entry's key includes the current version of
// each of its tags, so touching a tag (one INCR) makes every older entry
// unreachable, and those expire on their own. With Redis the
// versions and entries are shared by every server; otherwise both live in
// this process, which is all one server needs.
//
// A cache is never worth an error: any failure reading or writing it runs
// the real query instead.
//
// Without REDIS_URL the cache lives in this process.

const MEMORY_MAX_ENTRIES = Number(process.env.CACHE_MAX_ENTRIES || 5000);

const memoryDriver = () => {
  const versions = new Map();
  const entries = new Map(); // key -> { value, expires }
  return {
    kind: "memory",
    versions: async (tags) => tags.map((t) => versions.get(t) || 0),
    get: async (key) => {
      const hit = entries.get(key);
      if (!hit) return undefined;
      if (hit.expires < Date.now()) {
        entries.delete(key);
        return undefined;
      }
      // Least recently used goes first when full: re-insert moves it last.
      entries.delete(key);
      entries.set(key, hit);
      return hit.value;
    },
    set: async (key, value, ttlS) => {
      entries.set(key, { value, expires: Date.now() + ttlS * 1000 });
      while (entries.size > MEMORY_MAX_ENTRIES) entries.delete(entries.keys().next().value);
    },
    touch: async (tags) => {
      for (const t of tags) versions.set(t, (versions.get(t) || 0) + 1);
    },
    clear: async () => {
      entries.clear();
      versions.clear();
    },
    size: async () => entries.size,
  };
};

let driver = shared.redis ? require("../redis/cache").create(shared.redis) : memoryDriver();

// Everything is also filed under "*", so Clear all caches is one touch.
const ALL = "*";

const counters = { hits: 0, misses: 0, errors: 0, bypassed: 0 };
// Two students asking for the same missing entry at once share one query.
const inflight = new Map();

// Settings are read lazily (model require here would load mongoose models
// into files that only want the cache).
let settingsModel = null;
const settings = async () => {
  settingsModel = settingsModel || require("../models/performanceSettingsModel");
  return settingsModel.safeGet();
};

// A slow or unreachable Redis must not slow every page down: past this, the
// real query runs as if the cache were empty.
const CACHE_TIMEOUT_MS = Number(process.env.CACHE_TIMEOUT_MS || 250);
const timed = (promise) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("cache timeout")), CACHE_TIMEOUT_MS))]);

const serialise = (value) => JSON.stringify(value === undefined ? null : value);

// → fn()'s value, from the cache when possible. Values go through JSON, so
// cache a finished response shape (ObjectIds come back as strings).
// opts.group: the Performance setting that switches this cache on/off.
// opts.ttlS: an upper bound below the admin's max age (e.g. access checks).
const wrap = async (key, tags, fn, opts = {}) => {
  let ttlS;
  try {
    const s = await settings();
    if (opts.group && s.cache?.[opts.group] === false) {
      counters.bypassed += 1;
      return fn();
    }
    ttlS = Math.max(1, Math.min((s.cache?.maxAgeMinutes || 10) * 60, opts.ttlS || Infinity));
  } catch {
    ttlS = opts.ttlS || 600;
  }

  const allTags = [ALL, ...tags];
  let fullKey;
  try {
    const versions = await timed(driver.versions(allTags));
    fullKey = `${key}|${versions.join(".")}`;
    const raw = await timed(driver.get(fullKey));
    if (raw !== undefined && raw !== null) {
      counters.hits += 1;
      return JSON.parse(raw);
    }
  } catch {
    counters.errors += 1;
    return fn();
  }

  counters.misses += 1;
  if (inflight.has(fullKey)) return inflight.get(fullKey);
  const pending = (async () => {
    const value = await fn();
    driver.set(fullKey, serialise(value), ttlS).catch(() => {
      counters.errors += 1;
    });
    return value;
  })();
  inflight.set(fullKey, pending);
  try {
    return await pending;
  } finally {
    inflight.delete(fullKey);
  }
};

// Drops every entry filed under any of these tags, on every server.
// Never throws: a write must not fail because the cache is down.
const touch = async (...tags) => {
  const list = tags.flat().filter(Boolean).map(String);
  if (!list.length) return;
  try {
    await timed(driver.touch(list));
  } catch {
    counters.errors += 1;
  }
};

const clear = async () => {
  await touch(ALL);
  if (driver.kind === "memory") await driver.clear();
};

const stats = async () => {
  const total = counters.hits + counters.misses;
  let entries = null;
  try {
    entries = await driver.size();
  } catch {
    // unknown
  }
  return {
    backend: driver.kind,
    ...counters,
    hitRate: total ? Math.round((counters.hits / total) * 1000) / 10 : null,
    entries,
  };
};

// Tests swap drivers.
const _useDriver = (next) => {
  driver = next;
  counters.hits = counters.misses = counters.errors = counters.bypassed = 0;
};

module.exports = { wrap, touch, clear, stats, memoryDriver, _useDriver };
