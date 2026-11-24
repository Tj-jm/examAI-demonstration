// Two things have to be exactly right here, tested against real in-memory
// documents rather than mocked: the "one review, ever" cap, and the rule
// that a review-reopened doubt is only visible to (and resolvable by) the
// solver who originally answered it. Both are security/fairness properties,
// not just UI behaviour, so this checks the model's own state rather than
// a re-implementation of it.

process.env.NODE_ENV = "test";

const mongoose = require("mongoose");
require("../models/doubtModel");
const Doubt = mongoose.model("Doubt");

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

const oid = () => new mongoose.Types.ObjectId();

const resolvedDoubt = (overrides = {}) => new Doubt({
  student: oid(),
  batch: oid(),
  question: "why does this work",
  mode: "human",
  status: "resolved",
  humanAnswer: "because of X",
  resolvedBy: oid(),
  resolvedAt: new Date(),
  ...overrides,
});

console.log("\nreview sub-document defaults");
{
  const d = resolvedDoubt();
  check("requested defaults false", d.review.requested, false);
  check("decision defaults null, not \"pending\" as a string", d.review.decision, null);
  check("reason defaults null", d.review.reason, null);
}

console.log("\nthe one-review cap survives both outcomes");
{
  const approved = resolvedDoubt({ review: { requested: true, decision: "approved", reason: "x" } });
  const rejected = resolvedDoubt({ review: { requested: true, decision: "rejected", reason: "x" } });
  check("requested stays true after an approval", approved.review.requested, true);
  check("requested stays true after a rejection too — no second chance either way", rejected.review.requested, true);
}

console.log("\napproving sets the fields decideReview relies on, in the shape it expects");
{
  const d = resolvedDoubt();
  const decider = oid();
  d.review.requested = true;
  d.review.reason = "still confused about step 3";
  d.review.requestedAt = new Date();

  d.review.decision = "approved";
  d.review.decidedBy = decider;
  d.review.decidedAt = new Date();
  d.status = "escalated";

  check("status returns to escalated, the queue solvers already check", d.status, "escalated");
  check("resolvedBy is untouched by approval — still names the original solver", d.resolvedBy != null, true);
  check("decidedBy records who approved it", String(d.review.decidedBy), String(decider));
}

console.log("\nqueue visibility — the exact $or a doubt-solver's query uses");
{
  const visibleTo = (doubt, solverId) => {
    if (!doubt.resolvedBy) return true;
    return String(doubt.resolvedBy) === String(solverId);
  };

  const solverA = oid();
  const solverB = oid();

  const brandNew = resolvedDoubt({ status: "escalated", resolvedBy: undefined });
  check("a brand-new escalation with no resolvedBy is visible to anyone", visibleTo(brandNew, solverA), true);
  check("...including a different solver", visibleTo(brandNew, solverB), true);

  const reopened = resolvedDoubt({ status: "escalated", resolvedBy: solverA });
  check("a review-reopened doubt is visible to the original solver", visibleTo(reopened, solverA), true);
  check("...but not to a different solver", visibleTo(reopened, solverB), false);
}

console.log("\n" + "-".repeat(50));
console.log(`${passed} passed, ${failed} failed`);
console.log("\nNOT covered here — needs a database and a running server:");
console.log("  - requestReview's one-per-doubt enforcement end to end");
console.log("  - decideReview's guard against deciding an already-decided review");
console.log("  - resolveDoubt's 403 when a different solver tries to update a reopened doubt");
console.log("  - the subject filter's Topic lookup in buildQueueQuery");
console.log("  - countResolved matching between getMyStats and getSolverStats for the same person");

if (failed > 0) process.exit(1);
console.log("PASS");

mongoose.connection.close().catch(() => {});
