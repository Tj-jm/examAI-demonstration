// The sales demo (DEMO_MODE=1). Only sales representatives use this site:
//
// - One password in front of everything (DEMO_BASIC_USER / DEMO_BASIC_PASSWORD),
//   asked by the browser before any page or API call loads.
// - Never indexed by search engines.
// - Demo data is wiped and seeded again (or the saved snapshot put back,
//   demo/snapshot.js) on start, every night at 03:17 server time, and from
//   "Reset demo" in the admin panel (demo/reset.js).
// - GET /api/demo/info: the demo accounts to sign in as (emails only; reps
//   are told the passwords), for the quick sign-in buttons.
//
// Email and SMS send nothing unless their keys are set, so leave SMTP_* and
// the SMS gateway keys out of the demo's environment.
const express = require("express");
const crypto = require("crypto");

const isDemo = () => process.env.DEMO_MODE === "1";

const same = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// The site-wide password. Webhooks from payment gateways and Zoom can't
// send it, but a demo takes no real payments or meetings.
const gate = (req, res, next) => {
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  const user = process.env.DEMO_BASIC_USER;
  const pass = process.env.DEMO_BASIC_PASSWORD;
  if (!user || !pass) return next();
  if (req.path === "/api/health") return next();
  const [kind, value] = String(req.headers.authorization || "").split(" ");
  if (kind === "Basic" && value) {
    const [u, ...rest] = Buffer.from(value, "base64").toString().split(":");
    if (same(u, user) && same(rest.join(":"), pass)) return next();
  }
  res.setHeader("WWW-Authenticate", 'Basic realm="Demo", charset="UTF-8"');
  res.status(401).send("This demo is for our sales team.");
};

const router = () => {
  const r = express.Router();
  const { protect, allow } = require("../middleware/adminAuth");
  const reset = require("./reset");

  // Who to sign in as: one of each role.
  r.get("/info", async (req, res, next) => {
    try {
      const User = require("../models/userModel");
      const Student = require("../models/studentModel");
      const one = (role) => User.findOne({ role, isDeleted: { $ne: true } }).sort({ createdAt: 1 }).select("email name role").lean();
      const roles = ["owner", "admin", "teacher", "grader", "doubtSolver", "representative"];
      const staff = (await Promise.all(roles.map(one))).filter(Boolean);
      const student = await Student.findOne({ email: /@example\.com$/ }).sort({ createdAt: 1 }).select("email name").lean();
      res.json({
        demo: true,
        resetting: reset.running(),
        lastReset: reset.lastReset(),
        staff: staff.map((u) => ({ role: u.role, name: u.name, email: u.email })),
        student: student ? { name: student.name, email: student.email } : null,
      });
    } catch (e) {
      next(e);
    }
  });

  // Fresh demo data now. Everyone is signed out (the accounts are made again).
  r.post("/reset", protect, allow("owner", "admin"), (req, res) => {
    if (reset.running()) return res.status(409).json({ message: "A reset is already running." });
    reset.start();
    res.status(202).json({ message: "Resetting the demo. Sign in again in a minute." });
  });
  return r;
};

// Nightly reset, in this process (one demo server).
const schedule = () => {
  const cron = require("node-cron");
  cron.schedule("17 3 * * *", () => require("./reset").start());
};

module.exports = { isDemo, gate, router, schedule };
