// The week boundary and the limit check are the two things that have to be
// exactly right here — get the boundary wrong and "recharges next week"
// either never happens or happens on the wrong day; get the limit check
// wrong and a student either gets blocked early or never blocked at all.
// Tested as pure functions of a given Date, not against real time, so the
// suite gives the same answer regardless of which day it happens to run on.

process.env.NODE_ENV = "test";

const { startOfWeek, endOfWeek, assertWithinWeeklyDoubtLimit } = require("../utils/doubtQuota");

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

console.log("\nstartOfWeek — Sunday-start, fixed to this platform's primary market");
{
  const wednesday = new Date(2026, 8, 10, 15, 30, 0);
  const start = startOfWeek(wednesday);
  check("lands on a Sunday", start.getDay(), 0);
  check("that Sunday is the 6th, going backward from Wednesday the 10th", start.getDate(), 6);
  check("time is reset to midnight, not left at whatever time it was called", start.getHours(), 0);
  check("...and the same for minutes/seconds", start.getMinutes() + start.getSeconds(), 0);
}

console.log("\nstartOfWeek — a Sunday is its own start, not pushed back a further week");
{
  const sunday = new Date(2026, 8, 6, 9, 0, 0);
  const start = startOfWeek(sunday);
  check("today's date is unchanged when today already is Sunday", start.getDate(), 6);
}

console.log("\nstartOfWeek — crossing a month boundary");
{
  const octFirst = new Date(2026, 9, 1, 12, 0, 0);
  const start = startOfWeek(octFirst);
  check("rolls back into the previous month correctly", start.getMonth(), 8);
  check("lands on the 27th of September", start.getDate(), 27);
}

console.log("\nendOfWeek — exactly seven days after startOfWeek, not six or eight");
{
  const midweek = new Date(2026, 8, 10);
  const start = startOfWeek(midweek);
  const end = endOfWeek(midweek);
  const diffDays = Math.round((end - start) / 86400000);
  check("end is exactly 7 days after start", diffDays, 7);
  check("end also lands on a Sunday, the same weekday start does", end.getDay(), 0);
}

// assertWithinWeeklyDoubtLimit's null and 0 branches both return/throw
// before ever touching the database (only a real positive limit reaches
// countHumanDoubtsThisWeek), so these two are safe to exercise here as
// pure async calls against a fake student/batch — no DB connection
// needed. This is the exact semantic this suite used to get backwards
// (see the old version of the line below this block): unset must pass
// through silently (unlimited), 0 must throw (no human doubts at all,
// AI-only) — they are NOT the same value any more.
console.log("\nassertWithinWeeklyDoubtLimit — unset vs. 0 are different states, not aliases");
{
  const run = async (limit) => {
    try {
      await assertWithinWeeklyDoubtLimit("fake-student-id", { _id: "fake-batch-id", doubtLimits: { weeklyHumanDoubts: limit } });
      return "passed";
    } catch (err) {
      return "threw";
    }
  };

  const results = {};
  (async () => {
    results.unset = await run(undefined);
    results.null = await run(null);
    results.zero = await run(0);
  })().then(() => {
    check("unset (undefined) is unlimited — passes through", results.unset, "passed");
    check("explicitly null is unlimited — passes through", results.null, "passed");
    check("0 is AI-only — throws, does not silently pass", results.zero, "threw");

    console.log("\n" + "-".repeat(50));
    console.log(`${passed} passed, ${failed} failed`);
    console.log("\nNOT covered here — needs a real Doubt collection and a running server:");
    console.log("  - assertWithinWeeklyDoubtLimit actually blocking the Nth+1 doubt once a positive limit is set");
    console.log("  - a doubt escalated in one week counting against that week's total, not createdAt's week");
    console.log("  - createDoubt and escalateDoubt both calling the check before writing anything");

    if (failed > 0) process.exit(1);
    console.log("PASS");
  });
}
