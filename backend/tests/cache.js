// utils/cache.js and the invalidation plugin (utils/cacheInvalidation.js).
// Memory always; Redis when TEST_REDIS_URL is set; real writes through the
// models when TEST_MONGO_URL is set (any MongoDB-compatible server).

process.env.NODE_ENV = "test";
process.env.EXAMAI_TIER = "pro";
delete process.env.REDIS_URL;

const mongoose = require("mongoose");
const cache = require("../utils/cache");
const tags = require("../utils/cacheTags");

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

// The Performance settings live in the database; without one, defaults.
const Perf = require("../models/performanceSettingsModel");
let perf = new Perf({ singleton: "performance" }).toObject();
Perf.safeGet = async () => perf;

const behaviour = async (label) => {
  console.log(`\n${label}`);
  let runs = 0;
  const load = async () => {
    runs += 1;
    return { n: runs };
  };
  check("first read runs the query", await cache.wrap("k1", ["t1"], load), { n: 1 });
  check("second read is served from the cache", await cache.wrap("k1", ["t1"], load), { n: 1 });
  await cache.touch("t1");
  check("touching its tag drops it", await cache.wrap("k1", ["t1"], load), { n: 2 });
  await cache.touch("other");
  check("touching another tag doesn't", await cache.wrap("k1", ["t1"], load), { n: 2 });
  await cache.clear();
  check("Clear all caches drops everything", await cache.wrap("k1", ["t1"], load), { n: 3 });

  perf = { ...perf, cache: { ...perf.cache, practice: false } };
  await cache.wrap("k2", ["t2"], load, { group: "practice" });
  check("a group switched off always runs the query", (await cache.wrap("k2", ["t2"], load, { group: "practice" })).n, 5);
  perf = new Perf({ singleton: "performance" }).toObject();

  let slow = 0;
  const slowLoad = async () => {
    slow += 1;
    await new Promise((r) => setTimeout(r, 50));
    return slow;
  };
  await Promise.all([cache.wrap("k3", [], slowLoad), cache.wrap("k3", [], slowLoad), cache.wrap("k3", [], slowLoad)]);
  check("three students missing at once share one query", slow, 1);
};

(async () => {
  await behaviour("memory");
  {
    const small = cache.memoryDriver();
    for (let i = 0; i < 5; i += 1) await small.set(`k${i}`, "v", 60);
    check("memory entries are counted", await small.size(), 5);
  }

  console.log("\na broken cache is only slower");
  cache._useDriver({
    kind: "broken",
    versions: async () => { throw new Error("down"); },
    get: async () => { throw new Error("down"); },
    set: async () => { throw new Error("down"); },
    touch: async () => { throw new Error("down"); },
    size: async () => null,
  });
  check("reads fall through to the query", await cache.wrap("k", ["t"], async () => "real"), "real");
  await cache.touch("t");
  check("a write never fails because the cache is down", true, true);
  cache._useDriver({
    kind: "hung",
    versions: () => new Promise(() => {}),
    get: () => new Promise(() => {}),
    set: async () => {},
    touch: () => new Promise(() => {}),
    size: async () => null,
  });
  const t0 = Date.now();
  check("a hung cache is skipped quickly", await cache.wrap("k", ["t"], async () => "real"), "real");
  check("…within the timeout", Date.now() - t0 < 1000, true);

  if (process.env.TEST_REDIS_URL) {
    const Redis = require("ioredis");
    process.env.REDIS_PREFIX = `examai-test-${process.pid}:`;
    delete require.cache[require.resolve("../redis/cache")];
    const client = new Redis(process.env.TEST_REDIS_URL);
    const other = new Redis(process.env.TEST_REDIS_URL);
    cache._useDriver(require("../redis/cache").create(client));
    await behaviour("redis");

    // Another server: its own connection, same Redis.
    const serverB = require("../redis/cache").create(other);
    await cache.wrap("shared", ["s"], async () => "v1");
    await serverB.touch(["s"]);
    check("a write on another server drops this server's entry", await cache.wrap("shared", ["s"], async () => "v2"), "v2");
    await Promise.all([client.quit(), other.quit()]);
  } else {
    console.log("\nredis: skipped (set TEST_REDIS_URL to run)");
  }

  if (process.env.TEST_MONGO_URL) {
    console.log("\nevery kind of write invalidates (models)");
    cache._useDriver(cache.memoryDriver());
    await mongoose.connect(process.env.TEST_MONGO_URL);
    const { Question, Mcq } = require("../models/questionModel");
    const Batch = require("../models/batchModel");
    const Purchase = require("../models/purchaseModel");
    await Question.deleteMany({});

    let n = 0;
    const read = () => cache.wrap("q", [tags.QUESTIONS], async () => (n += 1));
    const fresh = async (label, write) => {
      await read();
      const before = await read();
      await write();
      check(label, (await read()) > before, true);
    };
    const subject = new mongoose.Types.ObjectId();
    const chapter = new mongoose.Types.ObjectId();
    const base = { subject, chapter, question: "q", options: [{ key: "A", text: "a" }, { key: "B", text: "b" }], correctOption: "A" };
    await fresh("create", () => Mcq.create(base));
    await fresh("insertMany (bulk import, AI runs)", () => Mcq.insertMany([base, base]));
    await fresh("updateMany (approve all, bulk archive)", () => Question.updateMany({}, { $set: { isPublic: true } }));
    await fresh("updateOne (move topic)", () => Question.updateOne({}, { $set: { difficulty: "hard" } }));
    await fresh("bulkWrite (add to board)", () => Question.bulkWrite([{ updateOne: { filter: {}, update: { $set: { difficulty: "easy" } } } }]));
    const one = await Question.findOne();
    await fresh("save (editor)", async () => { one.difficulty = "medium"; await one.save(); });
    await fresh("deleteOne on a document", () => one.deleteOne());
    await fresh("deleteMany (reject all)", () => Question.deleteMany({}));

    const student = new mongoose.Types.ObjectId();
    const otherStudent = new mongoose.Types.ObjectId();
    let a = 0;
    let b = 0;
    const readA = () => cache.wrap("a", [tags.ACCESS, tags.access(student)], async () => (a += 1));
    const readB = () => cache.wrap("b", [tags.ACCESS, tags.access(otherStudent)], async () => (b += 1));
    await readA(); await readB();
    await Purchase.collection.insertOne({ student, batch: new mongoose.Types.ObjectId(), status: "pending" });
    await Purchase.updateOne({ student }, { $set: { status: "complete" } });
    check("a purchase update for one student drops their access", await readA(), 2);
    check("…and not another student's", await readB(), 1);
    await Purchase.updateMany({ status: "complete" }, { $set: { status: "complete" } });
    check("a purchase write that doesn't name a student drops everyone's", [await readA(), await readB()], [3, 2]);
    await Purchase.deleteMany({});

    let batches = 0;
    const readBatches = () => cache.wrap("batches", [tags.BATCHES], async () => (batches += 1));
    await readBatches();
    await Batch.bulkWrite([{ updateMany: { filter: {}, update: { $set: { order: 1 } } } }]);
    check("reordering batches drops batch lists", await readBatches(), 2);

    // The batch access check, cached: a purchase grants at once, a refund
    // or a deactivated batch takes it away at once.
    console.log("\nbatch access (cached)");
    const { batchAccess } = require("../middleware/batchAccess");
    const batch = await Batch.create({ name: "Cache test", program: new mongoose.Types.ObjectId(), isActive: true, plans: [{ label: "All", durationDays: 30, price: 0, isActive: true }] });
    const who = { _id: new mongoose.Types.ObjectId() };
    const gate = () => new Promise((resolve) => {
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; } };
      const req = { params: { batchId: String(batch._id) }, body: {}, student: who };
      batchAccess(req, res, (err) => resolve(err ? res.statusCode : `${req.accessVia}:${req.batch.name}`));
    });
    check("no purchase: refused", await gate(), 403);
    check("…twice (the refusal is cached)", await gate(), 403);
    const bought = await Purchase.create({ student: who._id, batch: batch._id, status: "complete", plan: { label: "All", price: 0, durationDays: 30 }, startDate: new Date() });
    check("a purchase opens it at once", await gate(), "purchase:Cache test");
    await Purchase.updateOne({ _id: bought._id }, { $set: { status: "refunded" } });
    check("a refund closes it at once", await gate(), 403);
    await Purchase.updateOne({ _id: bought._id }, { $set: { status: "complete" } });
    check("…and buying again reopens it", await gate(), "purchase:Cache test");
    batch.name = "Renamed";
    await batch.save();
    check("a batch edit is seen at once", await gate(), "purchase:Renamed");
    batch.isActive = false;
    await batch.save();
    check("a deactivated batch is gone at once", await gate(), 404);
    await Promise.all([Purchase.deleteMany({}), Batch.deleteMany({ _id: batch._id })]);

    await mongoose.disconnect();
  } else {
    console.log("\nmodels: skipped (set TEST_MONGO_URL to run)");
  }

  console.log(`\n${"-".repeat(50)}\n${passed} passed, ${failed} failed`);
  console.log(failed === 0 ? "PASS" : "FAIL");
  process.exit(failed === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
