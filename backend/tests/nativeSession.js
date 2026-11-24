// The mobile app's session: token in the login answer, Bearer header after.
// Needs TEST_MONGO_URL (a throwaway database).

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "native-session-test-secret";
// Email login needs an email service configured; nothing is sent here.
process.env.SMTP_HOST = process.env.SMTP_HOST || "smtp.invalid";
process.env.SMTP_USER = process.env.SMTP_USER || "test";
process.env.SMTP_PASS = process.env.SMTP_PASS || "test";
const mongoose = require("mongoose");

let passed = 0;
let failed = 0;
const check = (label, ok, detail) => {
  if (ok) { passed += 1; console.log(`  ok    ${label}`); }
  else { failed += 1; console.log(`  FAIL  ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`); }
};
const fakeReq = ({ headers = {}, cookies = {}, body = {} } = {}) => {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { body, cookies, get: (name) => h[name.toLowerCase()] };
};
const run = (fn, req) => new Promise((resolve) => {
  const res = {
    code: 200,
    cookieSet: null,
    status(c) { this.code = c; return this; },
    cookie(name, value) { this.cookieSet = { name, value }; return this; },
    json(b) { resolve({ code: this.code, body: b, cookie: this.cookieSet }); },
  };
  fn(req, res, (e) => resolve({ code: res.code, err: e?.message, next: !e }));
});

(async () => {
  const { readToken, withSessionToken } = require("../utils/generateToken");

  console.log("readToken");
  check("student cookie wins", readToken(fakeReq({ cookies: { examai_student: "c" }, headers: { Authorization: "Bearer b" } }), "student") === "c");
  check("student Bearer when no cookie", readToken(fakeReq({ headers: { Authorization: "Bearer b.c.d" } }), "student") === "b.c.d");
  check("staff never read from Bearer", readToken(fakeReq({ headers: { Authorization: "Bearer b" } }), "user") === undefined);
  check("malformed header ignored", readToken(fakeReq({ headers: { Authorization: "Basic xyz" } }), "student") === undefined);
  check("token only for the native app", withSessionToken(fakeReq(), { a: 1 }, "t").sessionToken === undefined);
  check("native app gets the token", withSessionToken(fakeReq({ headers: { "X-ExamAI-Client": "native" } }), { a: 1 }, "t").sessionToken === "t");

  if (!process.env.TEST_MONGO_URL) { console.log("TEST_MONGO_URL not set, database checks skipped."); console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0); }
  await mongoose.connect(process.env.TEST_MONGO_URL);
  if (/test|native/i.test(mongoose.connection.name)) await mongoose.connection.db.dropDatabase();
  const Student = require("../models/studentModel");
  const AppSettings = require("../models/appSettingsModel");
  const { login } = require("../controllers/app/authController");
  const { studentProtect } = require("../middleware/studentAuth");

  const s = await AppSettings.get();
  s.studentAuth.identifier = "email";
  await s.save();
  await Student.create({ name: "Native", email: "native@example.com", password: "Passw0rd!x", isProfileComplete: true, isActive: true });
  const body = { email: "native@example.com", password: "Passw0rd!x" };

  console.log("login");
  const web = await run(login, fakeReq({ body }));
  check("web login sets the cookie", web.code === 200 && web.cookie?.name === "examai_student", web);
  check("web login answer has no token", web.body && !("sessionToken" in web.body));

  const app = await run(login, fakeReq({ body, headers: { "X-ExamAI-Client": "native" } }));
  check("app login answer has the token", typeof app.body?.sessionToken === "string" && app.body.sessionToken === app.cookie?.value, app);

  console.log("studentProtect");
  const ok = await run(studentProtect, fakeReq({ headers: { Authorization: `Bearer ${app.body.sessionToken}` } }));
  check("Bearer token signs the app in", ok.next === true, ok);
  const stale = await run(studentProtect, fakeReq({ headers: { Authorization: `Bearer ${web.cookie.value}` } }));
  check("older session refused (signed in elsewhere)", stale.code === 440, stale);
  const none = await run(studentProtect, fakeReq());
  check("no cookie, no header: 401", none.code === 401, none);

  await mongoose.disconnect();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
