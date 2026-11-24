const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const shared = require("../utils/shared");

// Load tests (loadtest/GUIDE.txt): every simulated student comes from the
// one test machine, so requests carrying LOADTEST_TOKEN in the
// X-Loadtest-Token header skip these limits. Off unless the token is set
// on the server (32+ characters); remove it when the test is over.
const loadTest = (req) => {
  const token = process.env.LOADTEST_TOKEN || "";
  const sent = String(req.get("x-loadtest-token") || "");
  if (token.length < 32 || sent.length !== token.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(token));
};

// OTP sending and login are the two endpoints an attacker will hammer, and
// AI endpoints cost real money per call. None of these existed before.
//
// Counted in memory on one server, or in Redis when several servers share
// the load (Pro, utils/shared.js). If Redis is unreachable, requests go
// through rather than failing.
const shape = (name) => ({ store: shared.rateLimitStore(name), passOnStoreError: true, skip: loadTest });

const authLimiter = rateLimit({
  ...shape("auth"),
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many attempts. Try again in a few minutes." },
});

const otpLimiter = rateLimit({
  ...shape("otp"),
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many codes requested. Try again later." },
});

const aiLimiter = rateLimit({
  ...shape("ai"),
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Slow down a moment." },
});

// Mounted on /api. The student app (/api/app) keeps 300 a minute. The
// admin panel gets more: one click there (say, adding a question to a
// batch) refreshes several lists, so quick work hit 300 and failed.
// Running code in the sandbox: per student, 10 runs a minute.
const codeRunLimiter = rateLimit({
  ...shape("code"),
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => `s:${req.student?._id}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many runs. Wait a moment and try again." },
});

const isStudentApp = (req) => req.path.startsWith("/app/") || req.path === "/app";
const tooMany = { message: "Too many requests. Wait a moment and try again." };

const apiLimiter = rateLimit({
  ...shape("api"),
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: tooMany,
  skip: (req) => loadTest(req) || !isStudentApp(req),
});

const adminApiLimiter = rateLimit({
  ...shape("api-admin"),
  windowMs: 60 * 1000,
  max: 1200,
  standardHeaders: true,
  legacyHeaders: false,
  message: tooMany,
  skip: (req) => loadTest(req) || isStudentApp(req),
});

// The public interest form: a few tries an hour from one address.
const leadLimiter = rateLimit({
  ...shape("lead"),
  windowMs: 60 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Thanks, we've got your details. Try again later if you need to change them." },
});

// Joining a public webinar. Generous: a school or a mobile network puts
// many people behind one address.
const webinarLimiter = rateLimit({
  ...shape("webinar"),
  windowMs: 10 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many tries from this network. Try again in a few minutes." },
});

module.exports = { loadTest, codeRunLimiter, authLimiter, otpLimiter, aiLimiter, apiLimiter, adminApiLimiter, leadLimiter, webinarLimiter };
