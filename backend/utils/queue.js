const shared = require("./shared");

// Background work that shouldn't hold up a request, with retries.
//
//   queue.define("exam-report", handler, { concurrency: 3 })
//   await queue.enqueue("exam-report", { submissionId })
//
// With REDIS_URL the jobs go to BullMQ on the same Redis: they survive a
// restart, any server (or a worker-only process, WORKER_ONLY=1) runs them,
// and `concurrency` holds across all of them. Without Redis they run in this
// process, a few at a time. If Redis refuses a job it runs here instead —
// a job is never lost because the queue is down.
//
// Also slots: "at most N of these at once, across every server", for long
// runs that can't be handed to a worker (document runs live in the request
// that started them and report progress from there).

const RETRY_DELAYS_MS = [5000, 30000];

const handlers = new Map(); // name -> { fn, concurrency, attempts }
const define = (name, fn, { concurrency = 2, attempts = 3 } = {}) => {
  handlers.set(name, { fn, concurrency, attempts });
};

// The app's own jobs (utils/backgroundJobs.js), defined on first use.
let defined = false;
const defineAll = () => {
  if (defined) return;
  defined = true;
  require("./backgroundJobs").register(define);
};

// ---------------------------------------------------------------- in-process

const counts = new Map(); // name -> { waiting, active, completed, failed }
const countsFor = (name) => {
  if (!counts.has(name)) counts.set(name, { waiting: 0, active: 0, completed: 0, failed: 0 });
  return counts.get(name);
};
const pending = new Map(); // name -> [{ data, attempt }]

const pump = (name) => {
  const h = handlers.get(name);
  const c = countsFor(name);
  const list = pending.get(name) || [];
  while (h && c.active < h.concurrency && list.length) {
    const job = list.shift();
    c.waiting -= 1;
    c.active += 1;
    Promise.resolve()
      .then(() => h.fn(job.data))
      .then(() => { c.completed += 1; })
      .catch(() => {
        if (job.attempt + 1 < h.attempts) {
          const delay = RETRY_DELAYS_MS[Math.min(job.attempt, RETRY_DELAYS_MS.length - 1)];
          c.waiting += 1;
          setTimeout(() => { list.push({ data: job.data, attempt: job.attempt + 1 }); pump(name); }, delay).unref?.();
        } else {
          c.failed += 1;
        }
      })
      .finally(() => {
        c.active -= 1;
        pump(name);
      });
  }
};

const runHere = (name, data) => {
  if (!pending.has(name)) pending.set(name, []);
  pending.get(name).push({ data, attempt: 0 });
  countsFor(name).waiting += 1;
  setImmediate(() => pump(name));
};

// ---------------------------------------------------------------- Redis

const redisQueue = shared.redisUrl ? require("../redis/queue").create(shared.redisUrl) : null;

// jobId: one job per id at a time (a second enqueue of the same id is
// dropped while the first is waiting).
const enqueue = async (name, data, { jobId } = {}) => {
  defineAll();
  if (!handlers.has(name)) throw new Error(`No background job called "${name}".`);
  if (redisQueue) {
    try {
      await redisQueue.add(name, data, { jobId, attempts: handlers.get(name).attempts });
      return "queued";
    } catch {
      // Redis refused it: run it here rather than lose it.
    }
  }
  runHere(name, data);
  return "local";
};

// Starts taking jobs from Redis (every server does, unless WORKER=off).
// Without Redis, jobs already run where they were added.
let started = false;
const startWorkers = () => {
  defineAll();
  if (started || !redisQueue || process.env.WORKER === "off") return;
  started = true;
  redisQueue.start(handlers);
};

const stats = async () => {
  defineAll();
  const local = Object.fromEntries([...handlers.keys()].map((n) => [n, { ...countsFor(n) }]));
  if (!redisQueue) return { backend: "memory", jobs: local, workers: true };
  try {
    return { backend: "redis", jobs: await redisQueue.counts([...handlers.keys()]), local, workers: started };
  } catch (error) {
    return { backend: "redis", error: error.message, local, workers: started };
  }
};

// ---------------------------------------------------------------- slots

const SLOT_POLL_MS = 2000;
const SLOT_HOLD_MS = 2 * 60 * 1000; // renewed while the run lasts
const localSlots = new Map(); // name -> count

const tryTake = async (name, limit, holder) => {
  if (shared.redis) {
    try {
      return await require("../redis/queue").takeSlot(shared.redis, name, limit, holder, SLOT_HOLD_MS);
    } catch {
      // Redis trouble: fall back to counting in this process.
    }
  }
  const n = localSlots.get(name) || 0;
  if (n >= limit) return false;
  localSlots.set(name, n + 1);
  return "local";
};

const giveBack = async (name, holder, how) => {
  if (how === "local") {
    localSlots.set(name, Math.max(0, (localSlots.get(name) || 1) - 1));
    return;
  }
  await require("../redis/queue").releaseSlot(shared.redis, name, holder).catch(() => {});
};

// Runs fn once one of `limit()` slots called `name` is free. onWait() is
// called once if it has to wait; a signal that aborts while waiting gives
// up without running fn.
const withSlot = async (name, limit, { signal, onWait, onStart } = {}, fn) => {
  const holder = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let how = false;
  let waited = false;
  while (!how) {
    if (signal?.aborted) throw Object.assign(new Error("Stopped."), { stopped: true });
    const max = Math.max(1, Number(await limit()) || 1);
    how = await tryTake(name, max, holder);
    if (!how) {
      if (!waited) { waited = true; onWait?.(); }
      await new Promise((r) => setTimeout(r, SLOT_POLL_MS));
    }
  }
  onStart?.();
  const renew = how === "local" ? null : setInterval(() => {
    require("../redis/queue").renewSlot(shared.redis, name, holder, SLOT_HOLD_MS).catch(() => {});
  }, SLOT_HOLD_MS / 3);
  renew?.unref?.();
  try {
    return await fn();
  } finally {
    if (renew) clearInterval(renew);
    await giveBack(name, holder, how);
  }
};

const close = async () => {
  if (redisQueue) await redisQueue.close().catch(() => {});
};

module.exports = { define, enqueue, startWorkers, stats, withSlot, close, handlers };
