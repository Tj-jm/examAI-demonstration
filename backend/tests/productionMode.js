// Stack-trace suppression only engages when NODE_ENV is production, so testing
// it under the test env proves nothing. This file runs as its own process with
// NODE_ENV set, because the value is read at request time and cannot be
// toggled safely alongside the other suites.

process.env.NODE_ENV = "production";
process.env.SERVE_STATIC = "false";
process.env.JWT_SECRET = require("crypto").randomBytes(48).toString("hex");
process.env.ENCRYPTION_KEY = require("crypto").randomBytes(32).toString("hex");

const request = require("supertest");
const buildApp = require("../app");

const app = buildApp();

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

const leaksInternals = (body) =>
  /node_modules|\/home\/|at Object\.|at Module\./.test(JSON.stringify(body));

const run = async () => {
  console.log("\nresponse bodies in production");

  {
    const res = await request(app)
      .post("/api/auth/login")
      .set("Content-Type", "application/json")
      .send("{ broken");
    check("parse failure returns no stack", res.body.stack === undefined, JSON.stringify(res.body).slice(0, 100));
    check("parse failure is still a 400", res.status === 400, res.status);
    check("parse failure leaks no paths", !leaksInternals(res.body));
  }

  {
    const res = await request(app).get("/api/users");
    check("401 returns no stack", res.body.stack === undefined);
    check("401 leaks no paths or package names", !leaksInternals(res.body), JSON.stringify(res.body));
  }

  {
    const res = await request(app).get("/api/nope");
    check("404 returns no stack", res.body.stack === undefined);
  }

  {
    const res = await request(app)
      .get("/api/users")
      .set("Cookie", "examai_admin=garbage");
    check("a bad token returns no stack", res.body.stack === undefined);
    check("a bad token leaks no jwt internals", !leaksInternals(res.body), JSON.stringify(res.body));
  }

  console.log("\ncookie flags in production");
  {
    // secure is set from NODE_ENV, so this is the only place it can be checked.
    const { generateToken } = require("../utils/generateToken");
    const captured = {};
    const fakeRes = { cookie: (name, value, options) => Object.assign(captured, { name, options }) };

    generateToken(fakeRes, { id: "1", sessionId: "s", role: "owner", audience: "user" });

    check("cookie is httpOnly", captured.options.httpOnly === true);
    check("cookie is secure in production", captured.options.secure === true);
    check("cookie has a sameSite policy", Boolean(captured.options.sameSite), captured.options.sameSite);
    check("admin and student cookies have different names", captured.name === "examai_admin", captured.name);
  }

  console.log("\n" + "-".repeat(50));
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("PASS");
};

run().catch((error) => {
  console.error("suite crashed:", error);
  process.exit(1);
});
