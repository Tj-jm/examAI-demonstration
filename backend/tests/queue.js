// Background jobs and shared slots (utils/queue.js, Pro): in this process
// without Redis; through BullMQ and Redis when TEST_REDIS_URL is set, where
// a job added while no worker runs is done once one starts (as after a
// restart), and slots hold across two servers.
process.env.NODE_ENV = "test";
const { execFileSync } = require("child_process");

if (!process.env.Q_MODE) {
  let bad = 0;
  for (const mode of ["memory", ...(process.env.TEST_REDIS_URL ? ["redis"] : [])]) {
    console.log(`\n== ${mode} ==`);
    const env = { ...process.env, Q_MODE: mode, REDIS_PREFIX: `examai-qtest-${process.pid}:` };
    if (mode === "redis") env.REDIS_URL = process.env.TEST_REDIS_URL;
    else delete env.REDIS_URL;
    try { execFileSync(process.execPath, [__filename], { stdio: "inherit", env }); } catch { bad += 1; }
  }
  if (!process.env.TEST_REDIS_URL) console.log("\nredis: skipped (set TEST_REDIS_URL to run)");
  process.exit(bad ? 1 : 0);
}

let passed = 0;
let failed = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { passed += 1; console.log(`  ok    ${label}`); }
  else { failed += 1; console.log(`  FAIL  ${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await wait(50); } return false; };

(async () => {
  const queue = require("../utils/queue");
  const redis = process.env.Q_MODE === "redis";

  const done = [];
  let flaky = 0;
  let running = 0;
  let peak = 0;
  queue.define("t-record", async ({ n }) => { done.push(n); });
  queue.define("t-flaky", async () => { flaky += 1; if (flaky < 2) throw new Error("try again"); }, { attempts: 3 });
  queue.define("t-slow", async () => { running += 1; peak = Math.max(peak, running); await wait(150); running -= 1; }, { concurrency: 2 });

  console.log("jobs");
  await queue.enqueue("t-record", { n: 1 });
  await queue.enqueue("t-record", { n: 2 });
  if (redis) {
    await wait(300);
    check("with Redis, nothing runs until a worker starts (jobs wait in Redis)", done, []);
    queue.startWorkers();
  }
  check("jobs added are done", await until(() => done.length === 2), true);
  await queue.enqueue("t-flaky", {});
  check("a failing job is retried", await until(() => flaky >= 2, 15000), true);
  for (let i = 0; i < 6; i += 1) await queue.enqueue("t-slow", {});
  await until(() => running === 0 && peak > 0, 8000);
  await wait(400);
  check("concurrency is held", peak <= 2, true);
  const stats = await queue.stats();
  check("stats name the backend", stats.backend, redis ? "redis" : "memory");
  let threw = false;
  try { await queue.enqueue("no-such-job", {}); } catch { threw = true; }
  check("an unknown job is an error", threw, true);

  console.log("\nslots");
  let inside = 0;
  let most = 0;
  const run = () => queue.withSlot("t-slot", async () => 2, {}, async () => { inside += 1; most = Math.max(most, inside); await wait(120); inside -= 1; });
  await Promise.all([run(), run(), run(), run(), run()]);
  check("at most the limit run at once", most, 2);
  const controller = new AbortController();
  const holders = [run(), run()];
  let waited = false;
  const stopped = queue.withSlot("t-slot", async () => 2, { signal: controller.signal, onWait: () => { waited = true; } }, async () => "ran").catch((e) => (e.stopped ? "stopped" : e.message));
  await wait(50);
  controller.abort();
  check("a run waiting for a slot can be stopped", [await stopped, waited], ["stopped", true]);
  await Promise.all(holders);

  if (redis) {
    // A second "server": another Redis connection taking the same slots.
    const Redis = require("ioredis");
    const other = new Redis(process.env.TEST_REDIS_URL);
    const rq = require("../redis/queue");
    const a = await rq.takeSlot(other, "t-x", 1, "server-b", 60000);
    const shared = require("../utils/shared");
    const b = await rq.takeSlot(shared.redis, "t-x", 1, "server-a", 60000);
    check("a slot held by another server is respected", [a, b], ["redis", false]);
    await rq.releaseSlot(other, "t-x", "server-b");
    check("…and free once it's given back", await rq.takeSlot(shared.redis, "t-x", 1, "server-a", 60000), "redis");
    await rq.takeSlot(other, "t-y", 1, "crashed", 1);
    await wait(20);
    check("a crashed server's slot lapses", await rq.takeSlot(shared.redis, "t-y", 1, "server-a", 60000), "redis");
    await other.quit();
  }

  await queue.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
