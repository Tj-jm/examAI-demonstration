// Purchase stacking. Buying thirty days twice must give sixty, but only when
// the second purchase lands while the first is still running — a purchase made
// after a lapse restarts from its own start date rather than extending a
// window that already closed.
//
// resolveExpiry is imported from the util the middleware uses, so this
// exercises the real request path rather than a copy that can drift.

const { resolveExpiry } = require("../utils/accessWindow");

let passed = 0;
let failed = 0;

const check = (label, actual, expected) => {
  const a = actual instanceof Date ? actual.toISOString().slice(0, 10) : actual;
  const e = expected instanceof Date ? expected.toISOString().slice(0, 10) : expected;
  if (a === e) {
    passed += 1;
    console.log(`  ok    ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}`);
    console.log(`        expected ${e}, got ${a}`);
  }
};

const day = (iso) => new Date(`${iso}T00:00:00Z`);
const buy = (start, days, isInfinite = false) => ({
  startDate: day(start),
  plan: { durationDays: days, isInfinite },
});

console.log("\nstacking");
check("single 30 day purchase", resolveExpiry([buy("2026-01-01", 30)]), day("2026-01-31"));

check(
  "two overlapping purchases stack to 60 days",
  resolveExpiry([buy("2026-01-01", 30), buy("2026-01-15", 30)]),
  day("2026-03-02")
);

check(
  "three overlapping purchases stack",
  resolveExpiry([buy("2026-01-01", 30), buy("2026-01-10", 30), buy("2026-01-20", 30)]),
  day("2026-04-01")
);

check(
  "a purchase after a lapse restarts rather than extending",
  resolveExpiry([buy("2026-01-01", 30), buy("2026-06-01", 30)]),
  day("2026-07-01")
);

check(
  "renewal on the exact expiry day extends",
  resolveExpiry([buy("2026-01-01", 30), buy("2026-01-31", 30)]),
  day("2026-03-02")
);

console.log("\ninfinite plans");
check(
  "infinite short circuits everything before it",
  resolveExpiry([buy("2026-01-01", 30), buy("2026-01-05", null, true)]).getUTCFullYear(),
  9999
);
check(
  "infinite first ignores what follows",
  resolveExpiry([buy("2026-01-01", null, true), buy("2026-02-01", 30)]).getUTCFullYear(),
  9999
);

console.log("\nedge cases");
check("no purchases means no expiry", resolveExpiry([]), null);
check(
  "a zero day plan does not extend anything",
  resolveExpiry([buy("2026-01-01", 30), buy("2026-01-10", 0)]),
  day("2026-01-31")
);

console.log("\n" + "-".repeat(50));
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("PASS");
