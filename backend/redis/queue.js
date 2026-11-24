const IORedis = require("ioredis");
const { Queue, Worker } = require("bullmq");

// The Redis side of utils/queue.js (Pro): BullMQ queues on the app's Redis,
// and "at most N at once" slots shared by every server.

const PREFIX = (process.env.REDIS_PREFIX || "examai:").replace(/:$/, "");
const KEEP = { age: 24 * 3600, count: 1000 };

const create = (url) => {
  // BullMQ blocks on its connection, so it gets its own, set up as it needs.
  const connection = new IORedis(url, { maxRetriesPerRequest: null, enableOfflineQueue: false, lazyConnect: false });
  connection.on("error", () => {});
  const queues = new Map();
  const workers = [];
  const queueFor = (name) => {
    if (!queues.has(name)) queues.set(name, new Queue(name, { connection, prefix: `${PREFIX}:bull` }));
    return queues.get(name);
  };

  return {
    add: async (name, data, { jobId, attempts }) => {
      await queueFor(name).add(name, data, {
        jobId,
        attempts,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: KEEP,
        removeOnFail: KEEP,
      });
    },
    start: (handlers) => {
      for (const [name, h] of handlers) {
        const worker = new Worker(name, async (job) => h.fn(job.data), {
          connection: connection.duplicate({ maxRetriesPerRequest: null }),
          prefix: `${PREFIX}:bull`,
          concurrency: h.concurrency,
        });
        worker.on("error", () => {});
        workers.push(worker);
      }
    },
    counts: async (names) => {
      const out = {};
      for (const name of names) {
        out[name] = await queueFor(name).getJobCounts("waiting", "active", "completed", "failed", "delayed");
      }
      return out;
    },
    close: async () => {
      await Promise.all(workers.map((w) => w.close()));
      await Promise.all([...queues.values()].map((q) => q.close()));
      await connection.quit();
    },
  };
};

// Slots: a sorted set of holders scored by when their hold runs out. Taking
// one clears lapsed holders (a crashed server's) first, all in one step.
const TAKE = `
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", ARGV[1])
if redis.call("ZCARD", KEYS[1]) < tonumber(ARGV[2]) then
  redis.call("ZADD", KEYS[1], ARGV[3], ARGV[4])
  redis.call("PEXPIRE", KEYS[1], ARGV[5])
  return 1
end
return 0`;

const slotKey = (name) => `${PREFIX}:slots:${name}`;

const takeSlot = async (client, name, limit, holder, holdMs) => {
  const now = Date.now();
  const ok = await client.eval(TAKE, 1, slotKey(name), now, limit, now + holdMs, holder, holdMs * 2);
  return ok === 1 ? "redis" : false;
};

const renewSlot = (client, name, holder, holdMs) => client.zadd(slotKey(name), "XX", Date.now() + holdMs, holder);

const releaseSlot = (client, name, holder) => client.zrem(slotKey(name), holder);

module.exports = { create, takeSlot, renewSlot, releaseSlot };
