const express = require("express");
const rateLimit = require("express-rate-limit");
const { studentProtect } = require("../../middleware/studentAuth");
const c = require("../../controllers/app/progressReportController");

// Two small routers, mounted at their own paths (app.js) so nothing else
// under /api/app passes through them.

// /api/app/progress — public: the link in a progress report SMS or email.
// Limited so the tokens can't be guessed by brute force.
const report = express.Router();
const reportLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false });
report.get("/:token", reportLimiter, c.getReport);

// /api/app/account/guardian — the student's guardian contact.
const guardian = express.Router();
guardian.route("/").get(studentProtect, c.getGuardian).put(studentProtect, c.updateGuardian);

module.exports = { report, guardian };
