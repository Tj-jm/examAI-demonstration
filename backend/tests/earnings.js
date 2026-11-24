// buildMatch is the one piece of the earnings report that's pure logic —
// no database needed to prove it excludes the right statuses and builds the
// right date range. The aggregation pipeline itself (runFacets,
// getSummaryData) needs a real Purchase collection to test meaningfully;
// see the note at the end of this file for what that leaves uncovered.

process.env.NODE_ENV = "test";

const mongoose = require("mongoose");
const { buildMatch } = require("../controllers/admin/earningsController");

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

console.log("\nbuildMatch — status is always restricted to complete");
{
  check("with no filters at all, status is still fixed to complete", buildMatch({}), { status: "complete" });
  check("a caller cannot override status by passing one", buildMatch({ status: "refunded" }), { status: "complete" });
}

console.log("\nbuildMatch — date range");
{
  const withFrom = buildMatch({ from: "2026-01-01" });
  check("from alone sets $gte only", Object.keys(withFrom.createdAt), ["$gte"]);
  check("from is parsed as a real Date", withFrom.createdAt.$gte instanceof Date, true);

  const withTo = buildMatch({ to: "2026-01-31" });
  check("to alone sets $lte only", Object.keys(withTo.createdAt), ["$lte"]);

  const withBoth = buildMatch({ from: "2026-01-01", to: "2026-01-31" });
  check("both set both ends", Object.keys(withBoth.createdAt).sort(), ["$gte", "$lte"]);

  check("no date filters means no createdAt key at all", "createdAt" in buildMatch({}), false);
}

console.log("\nbuildMatch — batch and kind");
{
  const id = new mongoose.Types.ObjectId().toString();
  const withBatch = buildMatch({ batch: id });
  check("batch is cast to a real ObjectId, not left as a string", withBatch.batch instanceof mongoose.Types.ObjectId, true);
  check("and it matches the id that was passed in", String(withBatch.batch), id);

  check("kind passes through untouched when given", buildMatch({ kind: "ai-credits" }).kind, "ai-credits");
  check("kind is absent, not null, when not given", "kind" in buildMatch({}), false);
}

console.log("\n" + "-".repeat(50));
console.log(`${passed} passed, ${failed} failed`);
console.log("\nNOT covered here — needs a real Purchase collection:");
console.log("  - the $facet aggregation itself (byCurrency, byBatch, aiPacks, byProvider)");
console.log("  - multi-currency totals never being summed together");
console.log("  - the xlsx export matching what the summary endpoint returns");
console.log("  - role gating end to end (owner/admin only — routeAudit checks the guard, not the actual role)");

if (failed > 0) process.exit(1);
console.log("PASS");
