
// State that every server process must agree on once there is more than one
// of them: request limits, "settings changed, drop your cache", which process
// runs the scheduled jobs, and the progress of long AI runs.
//
// One process (every Basic and Standard install, and Pro without Redis):
// all of it lives in memory, exactly as before. Pro with REDIS_URL set: it
// lives in Redis (backend/redis/), so several copies of the app can run
// behind a load balancer and behave as one.

const memory = () => {
  const listeners = new Set();
  const cancelListeners = new Set();
  const jobs = new Map();
  const claims = new Map();
  return {
    kind: "memory",
    // undefined = express-rate-limit's own in-memory store.
    rateLimitStore: () => undefined,
    settingsChanged: (name) => listeners.forEach((fn) => fn(name)),
    onSettingsChange: (fn) => listeners.add(fn),
    // A single process always holds the lock.
    lock: async () => true,
    claim: async (name, ttlMs) => {
      const held = claims.get(name);
      if (held && held > Date.now()) return null;
      claims.set(name, Date.now() + ttlMs);
      return async () => void claims.delete(name);
    },
    saveJob: async (ns, id, data) => void jobs.set(`${ns}:${id}`, JSON.parse(JSON.stringify(data))),
    readJob: async (ns, id) => jobs.get(`${ns}:${id}`) || null,
    listJobs: async (ns) =>
      [...jobs.entries()].filter(([key]) => key.startsWith(`${ns}:`)).map(([key, job]) => ({ id: key.slice(ns.length + 1), job })),
    requestCancel: async (ns, id) => cancelListeners.forEach((fn) => fn(ns, id)),
    onCancel: (fn) => cancelListeners.add(fn),
    status: async () => ({ backend: "memory", connected: true }),
    close: async () => {},
  };
};

let impl;
if (process.env.REDIS_URL) {
  impl = require("../redis/shared").create(process.env.REDIS_URL);
} else {
  impl = memory();
}

// Long-running jobs (document ingest) keep a live object in the process
// that runs them. track() copies it to the shared store every second while
// it changes, and once more when it finishes, so a status request that lands
// on another server still sees current progress.
const tracked = new Map();
let flushTimer = null;
const flush = async () => {
  for (const [key, { ns, id, job, last }] of tracked) {
    const snapshot = JSON.stringify(job);
    if (snapshot !== last) {
      tracked.get(key).last = snapshot;
      await impl.saveJob(ns, id, job).catch(() => {});
    }
    if (job.finishedAt) tracked.delete(key);
  }
  if (tracked.size === 0 && flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
};
const trackJob = (ns, id, job) => {
  tracked.set(`${ns}:${id}`, { ns, id, job, last: null });
  if (!flushTimer) {
    flushTimer = setInterval(flush, 1000);
    flushTimer.unref?.();
  }
  flush();
};

module.exports = {
  kind: impl.kind,
  // The Redis connection on Pro with REDIS_URL, else null.
  redis: impl.client || null,
  redisUrl: impl.url || null,
  rateLimitStore: (prefix) => impl.rateLimitStore(prefix),
  settingsChanged: (name) => impl.settingsChanged(name),
  onSettingsChange: (fn) => impl.onSettingsChange(fn),
  // Run fn only if this process wins the named lock for ttlMs. Used so a
  // scheduled job runs once across all servers, not once per server.
  runOnce: async (name, ttlMs, fn) => ((await impl.lock(name, ttlMs)) ? fn() : undefined),
  // Hold the named lock while some work runs, on every server: → a release
  // function, or null when someone else holds it. It expires after ttlMs
  // in case the holder dies.
  claim: (name, ttlMs) => impl.claim(name, ttlMs),
  trackJob,
  readJob: (ns, id) => impl.readJob(ns, id),
  // Every tracked job in a namespace, from whichever server ran it.
  listJobs: (ns) => impl.listJobs(ns),
  // Ask whichever server runs a job to stop it; onCancel is how that server
  // hears it.
  requestCancel: (ns, id) => impl.requestCancel(ns, id),
  onCancel: (fn) => impl.onCancel(fn),
  status: () => impl.status(),
  close: () => impl.close(),
};
