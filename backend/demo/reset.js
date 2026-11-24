// Wipes the demo database and seeds it again (demo/index.js).
//
//   node demo/reset.js        from the command line (the Docker start runs it)
//   require("./reset").start() in the server: the nightly reset and the
//                              admin panel's "Reset demo".
//
// Steps: keep the AI settings (Settings → AI: the main connection, picture
// AI, voice), drop the database, run the seed scripts in turn
// (seed/index.js, seed/people.js, seed/fill.js), put the AI settings back,
// give the owner DEMO_OWNER_PASSWORD and keep the site out of search
// engines. Every other seeded account uses the seed scripts' password,
// 123456789.
require("dotenv").config();
const path = require("path");
const { execFile } = require("child_process");
const mongoose = require("mongoose");

const SEED = path.join(__dirname, "../seed");
const STEPS = [
  ["index.js", ["--force"]],
  ["people.js", ["--allow-remote"]],
  ["fill.js", ["--count", process.env.DEMO_FILL_COUNT || "40", "--allow-remote"]],
];

let busy = false;
let last = null;

const run = (file, args) => new Promise((resolve, reject) => {
  execFile(process.execPath, [path.join(SEED, file), ...args], { cwd: path.join(__dirname, ".."), env: process.env, maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) return reject(new Error(`${file}: ${(stderr || error.message).trim().split("\n").pop()}`));
    resolve(stdout);
  });
});

// Its own connection, so the server's stays as it is.
const withDb = async (fn) => {
  const conn = await mongoose.createConnection(process.env.MONGO_URI).asPromise();
  try {
    return await fn(conn);
  } finally {
    await conn.close();
  }
};

const reset = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set.");
  const ai = await withDb(async (conn) => {
    const docs = await conn.collection("aiconfigs").find({}).toArray();
    await conn.dropDatabase();
    return docs;
  });
  for (const [file, args] of STEPS) await run(file, args);
  await withDb(async (conn) => {
    const bcrypt = require("bcryptjs");
    const owner = process.env.DEMO_OWNER_PASSWORD;
    if (owner) {
      await conn.collection("users").updateOne({ role: "owner" }, { $set: { password: await bcrypt.hash(owner, 10), mustChangePassword: false } });
    }
    await conn.collection("appsettings").updateMany({}, { $set: { "seo.noIndex": true } });
    if (ai.length) {
      await conn.collection("aiconfigs").deleteMany({});
      await conn.collection("aiconfigs").insertMany(ai);
    }
  });
  last = new Date();
};

const start = () => {
  if (busy) return Promise.resolve(false);
  busy = true;
  console.log("Demo: resetting data…");
  return reset()
    .then(() => { console.log("Demo: data reset."); return true; })
    .catch((e) => { console.error(`Demo reset failed: ${e.message}`); return false; })
    .finally(() => { busy = false; });
};

module.exports = { start, running: () => busy, lastReset: () => last };

if (require.main === module) {
  start().then((ok) => process.exit(ok ? 0 : 1));
}
