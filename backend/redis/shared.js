const os = require("os");
const crypto = require("crypto");
const Redis = require("ioredis");

// The Redis side of utils/shared.js (Pro). One connection for commands and
// one for the settings channel, since a subscribed connection can do nothing
// else. Every key is prefixed, so one Redis can serve several installs.
//
// If Redis goes away the app keeps serving: request limits let traffic
// through (passOnStoreError in middleware/rateLimit.js), settings caches
// expire on their own timer, and a scheduled job is skipped for that round.

const PREFIX = process.env.REDIS_PREFIX || "examai:";
const CHANNEL = `${PREFIX}settings`;
// "Stop this run": only the process running a job can abort it, and the
// request to stop may reach any server.
const CANCEL_CHANNEL = `${PREFIX}cancel`;
const JOB_TTL_S = 30 * 60;

// express-rate-limit (v7) store: one counter per client per window.
class RedisRateLimitStore {
  constructor(client, prefix) {
    this.client = client;
    this.prefix = `${PREFIX}rl:${prefix}:`;
    this.localKeys = false;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  async increment(key) {
    const k = this.prefix + key;
    try {
      const [[, totalHits], [, ttl]] = await this.client.multi().incr(k).pttl(k).exec();
      let remaining = ttl;
      if (remaining < 0) {
        await this.client.pexpire(k, this.windowMs);
        remaining = this.windowMs;
      }
      return { totalHits, resetTime: new Date(Date.now() + remaining) };
    } catch {
      // Redis unreachable: count this one request only, so requests go
      // through (express-rate-limit refuses 0). The connection's own error
      // handler has already logged why.
      return { totalHits: 1, resetTime: new Date(Date.now() + this.windowMs) };
    }
  }

  async decrement(key) {
    await this.client.decr(this.prefix + key).catch(() => {});
  }

  async resetKey(key) {
    await this.client.del(this.prefix + key).catch(() => {});
  }
}

const create = (url) => {
  // Who is speaking on the settings channel, so a server skips its own echo.
  const PROCESS_ID = `${os.hostname()}:${process.pid}:${crypto.randomBytes(3).toString("hex")}`;
  const options = { maxRetriesPerRequest: 2, enableOfflineQueue: true, lazyConnect: false };
  const client = new Redis(url, options);
  const subscriber = new Redis(url, options);
  let lastError = null;
  const listeners = new Set();

  for (const conn of [client, subscriber]) {
    conn.on("error", (error) => {
      if (lastError !== error.message) console.error(`Redis: ${error.message}`);
      lastError = error.message;
    });
    conn.on("ready", () => {
      lastError = null;
    });
  }

  const cancelListeners = new Set();

  subscriber.subscribe(CHANNEL, CANCEL_CHANNEL).catch(() => {});
  subscriber.on("message", (channel, message) => {
    let parsed;
    try {
      parsed = JSON.parse(message);
    } catch {
      return;
    }
    if (channel === CANCEL_CHANNEL) {
      cancelListeners.forEach((fn) => fn(parsed.ns, parsed.id));
      return;
    }
    if (channel !== CHANNEL) return;
    const { name, from } = parsed;
    // This process already cleared its own cache when it saved.
    if (from !== PROCESS_ID) listeners.forEach((fn) => fn(name));
  });

  return {
    kind: "redis",
    // For the other Redis drivers (cache, leaderboard, queue, autosave),
    // which share this connection rather than opening their own.
    client,
    url,
    rateLimitStore: (prefix) => new RedisRateLimitStore(client, prefix),

    settingsChanged: (name) => {
      listeners.forEach((fn) => fn(name));
      client.publish(CHANNEL, JSON.stringify({ name, from: PROCESS_ID })).catch(() => {});
    },
    onSettingsChange: (fn) => listeners.add(fn),

    // SET NX with an expiry: the first process to ask in a window wins.
    lock: async (name, ttlMs) => {
      try {
        return (await client.set(`${PREFIX}lock:${name}`, PROCESS_ID, "PX", ttlMs, "NX")) === "OK";
      } catch {
        return false;
      }
    },

    // A lock its holder lets go of when done. Unreachable Redis: let the
    // work through rather than block it.
    claim: async (name, ttlMs) => {
      const key = `${PREFIX}claim:${name}`;
      const token = `${PROCESS_ID}:${Math.random().toString(36).slice(2)}`;
      try {
        if ((await client.set(key, token, "PX", ttlMs, "NX")) !== "OK") return null;
      } catch {
        return async () => {};
      }
      return async () => {
        await client
          .eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, key, token)
          .catch(() => {});
      };
    },

    // Each job is also listed in a sorted set by start time, so "every run
    // in the last half hour" can be read from any server.
    saveJob: async (ns, id, data) => {
      const index = `${PREFIX}jobs:${ns}`;
      await client
        .multi()
        .set(`${PREFIX}job:${ns}:${id}`, JSON.stringify(data), "EX", JOB_TTL_S)
        .zadd(index, Date.now(), id)
        .zremrangebyscore(index, 0, Date.now() - JOB_TTL_S * 1000)
        .expire(index, JOB_TTL_S)
        .exec();
    },
    readJob: async (ns, id) => {
      const raw = await client.get(`${PREFIX}job:${ns}:${id}`).catch(() => null);
      return raw ? JSON.parse(raw) : null;
    },
    listJobs: async (ns) => {
      try {
        const ids = await client.zrange(`${PREFIX}jobs:${ns}`, 0, -1);
        if (!ids.length) return [];
        const raws = await client.mget(ids.map((id) => `${PREFIX}job:${ns}:${id}`));
        return ids.map((id, i) => (raws[i] ? { id, job: JSON.parse(raws[i]) } : null)).filter(Boolean);
      } catch {
        return [];
      }
    },
    requestCancel: async (ns, id) => {
      // This process may be the one running it: tell it directly too.
      cancelListeners.forEach((fn) => fn(ns, id));
      await client.publish(CANCEL_CHANNEL, JSON.stringify({ ns, id })).catch(() => {});
    },
    onCancel: (fn) => cancelListeners.add(fn),

    status: async () => {
      try {
        const t0 = Date.now();
        await client.ping();
        const pingMs = Date.now() - t0;
        const info = await client.info().catch(() => "");
        const field = (name) => (info.match(new RegExp(`^${name}:(\\S+)`, "m")) || [])[1] || null;
        const int = (name) => (field(name) === null ? null : Number(field(name)));
        // This install's keys, counted by kind (rl, cache, as, ...). Capped,
        // so a huge Redis never makes this page slow.
        const groups = {};
        let scanned = 0;
        let cursor = "0";
        do {
          const [next, keys] = await client.scan(cursor, "MATCH", `${PREFIX}*`, "COUNT", 1000);
          cursor = next;
          for (const key of keys) {
            const kind = key.slice(PREFIX.length).replace(/^:+/, "").split(":")[0] || "other";
            groups[kind] = (groups[kind] || 0) + 1;
          }
          scanned += keys.length;
        } while (cursor !== "0" && scanned < 20000);
        return {
          backend: "redis",
          connected: true,
          memory: field("used_memory_human"),
          memoryBytes: int("used_memory"),
          peakBytes: int("used_memory_peak"),
          maxBytes: int("maxmemory") || null,
          version: field("redis_version"),
          uptimeS: int("uptime_in_seconds"),
          clients: int("connected_clients"),
          opsPerSec: int("instantaneous_ops_per_sec"),
          commands: int("total_commands_processed"),
          keyspaceHits: int("keyspace_hits"),
          keyspaceMisses: int("keyspace_misses"),
          pingMs,
          keys: { total: scanned, capped: cursor !== "0", groups },
        };
      } catch (error) {
        return { backend: "redis", connected: false, error: error.message };
      }
    },

    close: async () => {
      await Promise.allSettled([client.quit(), subscriber.quit()]);
    },
  };
};

module.exports = { create, RedisRateLimitStore };
