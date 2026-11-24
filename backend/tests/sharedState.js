// utils/shared.js: in memory always, and against a real Redis when
// TEST_REDIS_URL is set (e.g. docker run -p 6379:6379 redis:7-alpine, then
// TEST_REDIS_URL=redis://127.0.0.1:6379 node tests/sharedState.js).
// The Redis half checks what several servers rely on: one shared request
// count, settings changes reaching other processes, a lock only one process
// wins, and job progress readable from anywhere.

process.env.NODE_ENV = "test";
process.env.EXAMAI_TIER = "pro";

let passed = 0;
let failed = 0;
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed += 1;
    console.log(`  ok    ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log("\nmemory (one server)");
  delete process.env.REDIS_URL;
  const mem = require("../utils/shared");
  check("uses memory without REDIS_URL", mem.kind, "memory");
  check("rate limits use express-rate-limit's own store", mem.rateLimitStore("x"), undefined);
  let heard = null;
  mem.onSettingsChange((name) => (heard = name));
  mem.settingsChanged("AppSettings");
  check("settings changes reach this process", heard, "AppSettings");
  check("one process always wins the lock", await mem.runOnce("t", 1000, async () => "ran"), "ran");
  const job = { status: "running", completed: 1 };
  mem.trackJob("ingest", "a", job);
  await wait(50);
  check("job progress is readable", (await mem.readJob("ingest", "a")).completed, 1);
  check("jobs are listed", (await mem.listJobs("ingest")).map((j) => j.id), ["a"]);
  let stopped = null;
  mem.onCancel((ns, id) => (stopped = `${ns}:${id}`));
  await mem.requestCancel("ingest", "a");
  check("a stop request reaches this process", stopped, "ingest:a");

  const url = process.env.TEST_REDIS_URL;
  if (!url) {
    console.log("\nredis: skipped (set TEST_REDIS_URL to run)");
  } else {
    console.log("\nredis (several servers)");
    process.env.REDIS_PREFIX = `examai-test-${process.pid}:`;
    delete require.cache[require.resolve("../redis/shared")];
    const { create: createFresh } = require("../redis/shared");
    const a = createFresh(url);
    const b = createFresh(url);
    await wait(300);

    const storeA = a.rateLimitStore("login");
    const storeB = b.rateLimitStore("login");
    storeA.init({ windowMs: 60000 });
    storeB.init({ windowMs: 60000 });
    await storeA.increment("1.2.3.4");
    await storeB.increment("1.2.3.4");
    check("two servers share one request count", (await storeA.increment("1.2.3.4")).totalHits, 3);

    let bHeard = null;
    b.onSettingsChange((name) => (bHeard = name));
    a.settingsChanged("AiConfig");
    await wait(200);
    check("a settings change on one server reaches the other", bHeard, "AiConfig");

    const results = await Promise.all([a.lock("job", 5000), b.lock("job", 5000)]);
    check("only one server wins a lock", results.filter(Boolean).length, 1);

    await a.saveJob("ingest", "x", { completed: 7 });
    check("job progress saved by one is read by the other", (await b.readJob("ingest", "x")).completed, 7);
    check("jobs saved by one are listed by the other", (await b.listJobs("ingest")).map((j) => j.id), ["x"]);

    let aStopped = null;
    a.onCancel((ns, id) => (aStopped = `${ns}:${id}`));
    await b.requestCancel("ingest", "x");
    await wait(200);
    check("a stop pressed on one server reaches the one running the job", aStopped, "ingest:x");

    await Promise.all([a.close(), b.close()]);
  }

  console.log(`\n${"-".repeat(50)}\n${passed} passed, ${failed} failed`);
  console.log(failed === 0 ? "PASS" : "FAIL");
  process.exit(failed === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
