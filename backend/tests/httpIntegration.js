// The real express app over real HTTP. No database, so persistence is not
// covered here — what is covered is everything that decides whether a request
// reaches a controller at all: authentication, token forgery, audience
// separation, error shape, and route ordering.
//
// These are the failures that matter most, because a controller bug returns
// wrong data to one person while an auth bug exposes everything to everyone.

process.env.NODE_ENV = "test";
process.env.SERVE_STATIC = "false";
process.env.JWT_SECRET = require("crypto").randomBytes(48).toString("hex");
process.env.ENCRYPTION_KEY = require("crypto").randomBytes(32).toString("hex");

const request = require("supertest");
const jwt = require("jsonwebtoken");
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

const sign = (payload, secret = process.env.JWT_SECRET) =>
  jwt.sign(payload, secret, { expiresIn: "30d" });

const asCookie = (name, token) => `${name}=${token}`;

const run = async () => {
  console.log("\nhealth and basics");
  {
    const res = await request(app).get("/api/health");
    check("health responds 200", res.status === 200, res.status);
    check("health reports ok", res.body.status === "ok", JSON.stringify(res.body));
  }
  {
    const res = await request(app).get("/api/does-not-exist");
    check("unknown api path returns 404", res.status === 404, res.status);
    check("404 is json, not html", typeof res.body.message === "string", res.text.slice(0, 60));
  }

  console.log("\nunauthenticated access");
  {
    const guarded = [
      ["get", "/api/users"],
      ["get", "/api/questions"],
      ["post", "/api/questions"],
      ["get", "/api/exams"],
      ["get", "/api/batches"],
      ["get", "/api/ai/config"],
      ["post", "/api/ai/generate-questions"],
      ["get", "/api/students"],
      ["get", "/api/purchases"],
      ["get", "/api/taxonomy/tree"],
      ["put", "/api/assignments/exams/abc/batches"],
    ];

    let allBlocked = true;
    for (const [method, path] of guarded) {
      const res = await request(app)[method](path).send({});
      if (res.status !== 401) {
        allBlocked = false;
        console.log(`        ${method.toUpperCase()} ${path} returned ${res.status}`);
      }
    }
    check(`all ${guarded.length} guarded routes reject an anonymous caller with 401`, allBlocked);
  }

  console.log("\ntoken forgery");
  {
    // The bug this covers: a weak or leaked signing secret lets anyone mint an
    // admin session. Nothing here should ever get past the signature check.
    const forged = sign({ id: "000000000000000000000001", sessionId: "x", role: "owner", aud: "user" }, "abc123");
    const res = await request(app).get("/api/users").set("Cookie", asCookie("examai_admin", forged));
    check("a token signed with the wrong secret is rejected", res.status === 401, res.status);
  }
  {
    const noSig = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url") +
      "." + Buffer.from(JSON.stringify({ id: "1", role: "owner", aud: "user" })).toString("base64url") + ".";
    const res = await request(app).get("/api/users").set("Cookie", asCookie("examai_admin", noSig));
    check("an alg:none token is rejected", res.status === 401, res.status);
  }
  {
    const expired = jwt.sign(
      { id: "000000000000000000000001", sessionId: "x", role: "owner", aud: "user" },
      process.env.JWT_SECRET,
      { expiresIn: "-1h" }
    );
    const res = await request(app).get("/api/users").set("Cookie", asCookie("examai_admin", expired));
    check("an expired token is rejected", res.status === 401, res.status);
    check("expiry is explained rather than generic", /expired/i.test(res.body.message), res.body.message);
  }
  {
    const res = await request(app).get("/api/users").set("Cookie", asCookie("examai_admin", "not-a-jwt"));
    check("a malformed token is rejected", res.status === 401, res.status);
  }

  console.log("\naudience separation");
  {
    // A validly signed student token must not satisfy an admin route. The
    // original student middleware had this check commented out.
    const studentToken = sign({ id: "000000000000000000000001", sessionId: "x", role: "student", aud: "student" });
    const res = await request(app).get("/api/users").set("Cookie", asCookie("examai_admin", studentToken));
    check("a student token cannot reach an admin route", res.status === 403, res.status);
    check("the refusal names the reason", /staff/i.test(res.body.message), res.body.message);
  }
  {
    const adminToken = sign({ id: "000000000000000000000001", sessionId: "x", role: "owner", aud: "user" });
    const res = await request(app)
      .get("/api/users")
      .set("Cookie", asCookie("examai_student", adminToken));
    check("an admin token in the student cookie is not accepted as a session", res.status === 401, res.status);
  }

  console.log("\nerror handling");
  {
    const res = await request(app)
      .post("/api/auth/login")
      .set("Content-Type", "application/json")
      .send("{ this is not json");
    check("malformed json is a 400, not a 500", res.status === 400, res.status);
    check("the message says what was wrong", /json/i.test(res.body.message), res.body.message);
  }
  {
    const huge = { padding: "x".repeat(3 * 1024 * 1024) };
    const res = await request(app).post("/api/auth/login").send(huge);
    check("an oversized body is a 413, not a 500", res.status === 413, res.status);
  }
  {
    const res = await request(app).post("/api/auth/login").send({});
    check("login without credentials is a 400", res.status === 400, res.status);
    check("no stack trace outside production", res.body.stack !== undefined, "stack present in test env as designed");
  }

  console.log("\nroute ordering");
  {
    // With SERVE_STATIC on, a catch-all serves the student app. If it were
    // registered before the api routes, every api call would return html.
    process.env.SERVE_STATIC = "true";
    const staticApp = buildApp();
    const res = await request(staticApp).get("/api/health");
    check("api routes still resolve when static serving is on", res.status === 200, res.status);
    check("api returns json, not the spa shell", res.body.status === "ok", res.text.slice(0, 40));
    process.env.SERVE_STATIC = "false";
  }

  console.log("\nrate limiting");
  {
    const limited = buildApp();
    let sawLimit = false;

    // The auth limiter allows 10 in 15 minutes.
    for (let i = 0; i < 14; i += 1) {
      const res = await request(limited).post("/api/auth/login").send({ email: "a@b.c", password: "x" });
      if (res.status === 429) { sawLimit = true; break; }
    }
    check("repeated login attempts are rate limited", sawLimit);
  }

  console.log("\nsecurity headers");
  {
    const res = await request(app).get("/api/health");
    check("x-powered-by is not advertised", res.headers["x-powered-by"] === undefined, res.headers["x-powered-by"]);
    check("nosniff is set", res.headers["x-content-type-options"] === "nosniff");
  }

  console.log("\n" + "-".repeat(60));
  console.log(`${passed} passed, ${failed} failed`);
  console.log("Note: persistence is not covered here. No mongod is available in");
  console.log("this environment, so controller behaviour against real data is");
  console.log("untested. Run the seed script and exercise the api to cover that.");

  if (failed > 0) process.exit(1);
  console.log("PASS");
};

run().catch((error) => {
  console.error("suite crashed:", error);
  process.exit(1);
});
