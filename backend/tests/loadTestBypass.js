// LOADTEST_TOKEN lets a load test's requests past the rate limits (they all
// come from one machine) and TRUST_PROXY sets how many proxies are trusted.
// Neither may loosen anything while unset or wrong.

const express = require("express");
const request = require("supertest");

let passed = 0;
let failed = 0;

const check = (label, ok, detail) => {
  if (ok) {
    passed += 1;
    console.log(`  ok    ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail !== undefined ? ` — ${detail}` : ""}`);
  }
};

const TOKEN = "t".repeat(40);

// A fresh limiter per case, so counts don't carry over.
const appWith = () => {
  delete require.cache[require.resolve("../middleware/rateLimit")];
  const { authLimiter } = require("../middleware/rateLimit");
  const app = express();
  app.post("/login", authLimiter, (req, res) => res.json({ ok: true }));
  return app;
};

const statuses = async (app, n, headers = {}) => {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const req = request(app).post("/login");
    for (const [k, v] of Object.entries(headers)) req.set(k, v);
    out.push((await req).status);
  }
  return out;
};

const run = async () => {
  delete process.env.LOADTEST_TOKEN;
  let s = await statuses(appWith(), 12, { "X-Loadtest-Token": TOKEN });
  check("token unset: header ignored, limit applies", s.slice(10).every((c) => c === 429), s.join(","));

  process.env.LOADTEST_TOKEN = "short";
  s = await statuses(appWith(), 12, { "X-Loadtest-Token": "short" });
  check("token too short: limit applies", s.slice(10).every((c) => c === 429), s.join(","));

  process.env.LOADTEST_TOKEN = TOKEN;
  s = await statuses(appWith(), 15, { "X-Loadtest-Token": TOKEN });
  check("right token: never limited", s.every((c) => c === 200), s.join(","));

  s = await statuses(appWith(), 12, { "X-Loadtest-Token": "x".repeat(40) });
  check("wrong token: limit applies", s.slice(10).every((c) => c === 429), s.join(","));

  s = await statuses(appWith(), 12);
  check("no header: limit applies", s.slice(10).every((c) => c === 429), s.join(","));
  delete process.env.LOADTEST_TOKEN;

  process.env.JWT_SECRET = process.env.JWT_SECRET || require("crypto").randomBytes(48).toString("hex");
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || require("crypto").randomBytes(32).toString("hex");
  process.env.SERVE_STATIC = "false";
  const buildApp = require("../app");
  delete process.env.TRUST_PROXY;
  check("trust proxy defaults to 1", buildApp().get("trust proxy") === 1);
  process.env.TRUST_PROXY = "2";
  check("TRUST_PROXY=2 is used", buildApp().get("trust proxy") === 2);
  process.env.TRUST_PROXY = "lots";
  check("nonsense TRUST_PROXY falls back to 1", buildApp().get("trust proxy") === 1);
  delete process.env.TRUST_PROXY;

  console.log("\n" + "-".repeat(50));
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("PASS");
  process.exit(0);
};

run().catch((error) => {
  console.error("suite crashed:", error);
  process.exit(1);
});
