// claimIsLive is the one line every part of the claim/lock feature agrees
// on — shapeClaim (what the queue/detail view shows), gradeAnswer's guard
// (what actually blocks a save), and claimSubmission's own query (what lets
// a new claim through) all call it instead of each doing their own "is this
// stale" math. Get the boundary wrong here and either a genuinely abandoned
// claim locks a submission out forever, or an actively-worked one gets
// silently stolen out from under whoever has it open.
//
// Pure function of a given Date, like doubtQuota.js's week-boundary tests —
// no database needed, so this suite gives the same answer regardless of
// when it runs.

process.env.NODE_ENV = "test";

const { claimIsLive, CLAIM_STALE_MS } = require("../controllers/admin/gradingController");

let passed = 0;
let failed = 0;

const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (ok) {
    passed += 1;
    console.log(`  ok    ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}`);
    console.log(`        expected ${expected}, got ${actual}`);
  }
};

console.log("\nclaimIsLive — no claim at all");
{
  check("null claimedAt is never live", claimIsLive(null), false);
  check("undefined claimedAt is never live", claimIsLive(undefined), false);
}

console.log("\nclaimIsLive — fresh vs. stale, relative to a fixed 'now'");
{
  const now = new Date("2026-09-22T12:00:00Z");
  const justNow = new Date(now.getTime() - 1000); // 1s ago
  const rightAtTheEdge = new Date(now.getTime() - CLAIM_STALE_MS); // exactly the boundary
  const oneMsInside = new Date(now.getTime() - CLAIM_STALE_MS + 1);
  const wellPast = new Date(now.getTime() - CLAIM_STALE_MS - 60000); // 1 min past stale

  check("a claim from a second ago is live", claimIsLive(justNow, now), true);
  check("a claim exactly CLAIM_STALE_MS old is no longer live (boundary is exclusive)", claimIsLive(rightAtTheEdge, now), false);
  check("a claim 1ms inside the window is still live", claimIsLive(oneMsInside, now), true);
  check("a claim well past the window is stale", claimIsLive(wellPast, now), false);
}

console.log("\nclaimIsLive — accepts a string date the same as a Date object");
{
  const now = new Date("2026-09-22T12:00:00Z");
  const isoJustNow = new Date(now.getTime() - 5000).toISOString();
  check("ISO string claimedAt (as it comes back from JSON) works the same as a Date", claimIsLive(isoJustNow, now), true);
}

console.log("\n" + "-".repeat(50));
console.log(`${passed} passed, ${failed} failed`);
console.log("\nNOT covered here — needs a real Submission collection and two");
console.log("concurrent requests to actually exercise:");
console.log("  - claimSubmission's atomicity: two graders racing to claim the");
console.log("    same submission, only one should win");
console.log("  - gradeAnswer actually rejecting a save while someone else's");
console.log("    claim is live, and accepting it once that claim goes stale");
console.log("  - the heartbeat: a save extending claimedAt so an active");
console.log("    grader's own claim doesn't expire mid-session");
console.log("  - releaseClaim only letting the current holder (or owner/admin)");
console.log("    clear it");

if (failed > 0) process.exit(1);
console.log("PASS");
