// notify() is the one choke point every trigger goes through — tested here
// against real in-memory model documents (no server) to prove the shape and
// defaults are correct. batchMembers.js is tested against the exact
// resolveExpiry logic it wraps, since duplicating that math a second time —
// even correctly — is how the two would eventually disagree.

process.env.NODE_ENV = "test";

const mongoose = require("mongoose");
require("../models/appSettingsModel");
require("../models/notificationModel");
const { resolveExpiry } = require("../utils/accessWindow");

let passed = 0;
let failed = 0;

const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed += 1;
    console.log(`  ok    ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}`);
    console.log(`        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

console.log("\nNotification model shape");
{
  const Notification = mongoose.model("Notification");
  const n = new Notification({ student: new mongoose.Types.ObjectId(), type: "examGraded", title: "t" });

  check("defaults to unread", n.isRead, false);
  check("body defaults to null, not undefined", n.body, null);
  check("link defaults to null", n.link, null);

  let threw = false;
  try {
    const err = new Notification({ student: new mongoose.Types.ObjectId(), type: "somethingElse", title: "t" }).validateSync();
    threw = Boolean(err);
  } catch (e) { threw = true; }
  check("an unrecognised type fails validation", threw, true);

  threw = false;
  try {
    const err = new Notification({ type: "examGraded", title: "t" }).validateSync();
    threw = Boolean(err);
  } catch (e) { threw = true; }
  check("a notification needs a student", threw, true);
}

console.log("\nAppSettings.notificationSettings defaults");
{
  const AppSettings = mongoose.model("AppSettings");
  const s = new AppSettings({});
  check("doubtResolved defaults on", s.notificationSettings.doubtResolved, true);
  check("examGraded defaults on", s.notificationSettings.examGraded, true);
  check("examReview defaults on", s.notificationSettings.examReview, true);
  check("newNotice defaults on", s.notificationSettings.newNotice, true);
}

console.log("\nbatch membership math (the same resolveExpiry batchMembers.js wraps)");
{
  const day = 86400000;
  const now = new Date();

  const infinitePlan = { plan: { isInfinite: true }, startDate: new Date(now - day) };
  check("an infinite purchase means active regardless of age", resolveExpiry([infinitePlan]) >= now, true);

  const expired = { plan: { isInfinite: false, durationDays: 10 }, startDate: new Date(now - 20 * day) };
  check("a 10-day plan bought 20 days ago has lapsed", resolveExpiry([expired]) < now, true);

  const current = { plan: { isInfinite: false, durationDays: 30 }, startDate: new Date(now - 5 * day) };
  check("a 30-day plan bought 5 days ago is still active", resolveExpiry([current]) >= now, true);

  // Stacked purchases: this is the case batchMembers.js has to get right by
  // reuse rather than approximation — a student who bought twice should not
  // be read as lapsed just because the first purchase alone would have been.
  const stacked = [
    { plan: { isInfinite: false, durationDays: 10 }, startDate: new Date(now - 15 * day) },
    { plan: { isInfinite: false, durationDays: 10 }, startDate: new Date(now - 15 * day) },
  ];
  check("two 10-day purchases from 15 days ago stack to still-active", resolveExpiry(stacked) >= now, true);
}

console.log("\n" + "-".repeat(50));
console.log(`${passed} passed, ${failed} failed`);
console.log("\nNOT covered here — needs a database:");
console.log("  - notify() actually respecting the admin toggle end to end");
console.log("  - the three real trigger sites (doubt resolve, exam grade, notice publish)");
console.log("  - getActiveBatchStudentIds against real Purchase/Trial documents");
console.log("  - the student-facing list/unread-count/mark-read endpoints");

if (failed > 0) process.exit(1);
console.log("PASS");

mongoose.connection.close().catch(() => {});
