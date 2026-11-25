// A saved demo state: the reset puts this back instead of seeding.
//
//   node demo/snapshot.js save    keep the database and uploads as they are now
//   node demo/snapshot.js clear   delete the snapshot; resets seed again
//   node demo/snapshot.js info    when it was saved and what it holds
//
// Where: DEMO_SNAPSHOT_PATH (default backend/demo/snapshot). It holds
//   db/<collection>.ndjson   one Extended JSON document per line
//   db/<collection>.indexes.json
//   uploads/                 a copy of the uploads folder (STORAGE_LOCAL_PATH)
//   meta.json
// The AI settings (aiconfigs) are never saved: they hold the AI keys, and the
// reset keeps the current ones. Files kept in S3 are not copied.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const mongoose = require("mongoose");

const { EJSON } = mongoose.mongo.BSON;

const SKIP = new Set(["aiconfigs"]);
const root = () => path.resolve(process.env.DEMO_SNAPSHOT_PATH || path.join(__dirname, "snapshot"));
const uploadsDir = () => path.resolve(process.env.STORAGE_LOCAL_PATH || "./uploads");

const has = () => fs.existsSync(path.join(root(), "meta.json"));
const info = () => (has() ? JSON.parse(fs.readFileSync(path.join(root(), "meta.json"), "utf8")) : null);

// The two folders must not hold each other, or a copy would eat itself.
const checkPaths = () => {
  const a = root();
  const b = uploadsDir();
  const inside = (x, y) => x === y || x.startsWith(y + path.sep);
  if (inside(a, b) || inside(b, a)) throw new Error(`The snapshot folder (${a}) and the uploads folder (${b}) must be separate.`);
  if (path.parse(b).root === b) throw new Error(`The uploads folder can't be a drive root (${b}).`);
};

const withDb = async (fn) => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set.");
  const conn = await mongoose.createConnection(process.env.MONGO_URI).asPromise();
  try {
    return await fn(conn.db);
  } finally {
    await conn.close();
  }
};

const writeLines = (file, cursor) => new Promise((resolve, reject) => {
  const out = fs.createWriteStream(file);
  let n = 0;
  out.on("error", reject);
  (async () => {
    for await (const doc of cursor) {
      n += 1;
      if (!out.write(EJSON.stringify(doc, { relaxed: false }) + "\n")) await new Promise((r) => out.once("drain", r));
    }
    out.end(() => resolve(n));
  })().catch(reject);
});

const save = async () => {
  checkPaths();
  const final = root();
  const tmp = `${final}.new`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(path.join(tmp, "db"), { recursive: true });

  const counts = await withDb(async (db) => {
    const out = {};
    const list = await db.listCollections({}, { nameOnly: true }).toArray();
    for (const { name } of list) {
      if (SKIP.has(name) || name.startsWith("system.")) continue;
      const col = db.collection(name);
      out[name] = await writeLines(path.join(tmp, "db", `${name}.ndjson`), col.find({}));
      const indexes = (await col.indexes()).filter((i) => i.name !== "_id_").map(({ v, ns, ...spec }) => spec);
      fs.writeFileSync(path.join(tmp, "db", `${name}.indexes.json`), JSON.stringify(indexes, null, 2));
    }
    return out;
  });

  const up = uploadsDir();
  if (fs.existsSync(up)) fs.cpSync(up, path.join(tmp, "uploads"), { recursive: true });
  else fs.mkdirSync(path.join(tmp, "uploads"));

  fs.writeFileSync(path.join(tmp, "meta.json"), JSON.stringify({ savedAt: new Date().toISOString(), collections: counts }, null, 2));
  fs.rmSync(final, { recursive: true, force: true });
  fs.renameSync(tmp, final);
  return info();
};

const clear = () => fs.rmSync(root(), { recursive: true, force: true });

const readLines = async (file, onBatch) => {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  let batch = [];
  for await (const line of rl) {
    if (!line.trim()) continue;
    batch.push(EJSON.parse(line, { relaxed: false }));
    if (batch.length >= 500) { await onBatch(batch); batch = []; }
  }
  if (batch.length) await onBatch(batch);
};

// Puts the saved collections into db (already emptied by the caller) and
// the saved uploads back in place of the current ones.
const restoreInto = async (db) => {
  checkPaths();
  const dir = path.join(root(), "db");
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".ndjson"))) {
    const name = file.slice(0, -".ndjson".length);
    if (SKIP.has(name)) continue;
    const col = db.collection(name);
    await db.createCollection(name).catch(() => {});
    await readLines(path.join(dir, file), (docs) => col.insertMany(docs, { ordered: false }));
    const idx = path.join(dir, `${name}.indexes.json`);
    const specs = fs.existsSync(idx) ? JSON.parse(fs.readFileSync(idx, "utf8")) : [];
    if (specs.length) await col.createIndexes(specs).catch((e) => console.error(`Demo restore: indexes on ${name}: ${e.message}`));
  }

  const up = uploadsDir();
  fs.mkdirSync(up, { recursive: true });
  for (const entry of fs.readdirSync(up)) fs.rmSync(path.join(up, entry), { recursive: true, force: true });
  const saved = path.join(root(), "uploads");
  if (fs.existsSync(saved)) fs.cpSync(saved, up, { recursive: true });
};

module.exports = { has, info, save, clear, restoreInto, root };

if (require.main === module) {
  const cmd = process.argv[2];
  const done = (p) => p.then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
  if (cmd === "save") {
    console.log("Demo: saving snapshot…");
    done(save().then((m) => console.log(`Demo: snapshot saved to ${root()} (${Object.keys(m.collections).length} collections, uploads copied).`)));
  } else if (cmd === "clear") {
    clear();
    console.log("Demo: snapshot deleted. Resets seed the demo data again.");
  } else if (cmd === "info") {
    const m = info();
    console.log(m ? `Saved ${m.savedAt} at ${root()}\n${Object.entries(m.collections).map(([k, v]) => `  ${k}: ${v}`).join("\n")}` : "No snapshot. Resets seed the demo data.");
  } else {
    console.log("Use: node demo/snapshot.js save | clear | info");
    process.exit(1);
  }
}
