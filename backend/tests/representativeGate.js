// The representative gate is the one thing in this feature that absolutely
// cannot be wrong — it's a global security boundary, not a UI convenience.
// Tested here as a pure function of (role, path), independent of any real
// JWT or request, so the path-matching logic itself is provable without
// standing up an HTTP server.

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-not-for-real-use";

const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
require("../models/userModel");
require("../models/couponModel");

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

// A minimal fake of the one thing the gate actually reads: req.cookies and
// req.path. Running it through Express itself would test routing, not the
// gate's own decision — this isolates the decision.
const runGate = ({ role, path, hasToken = true }) => {
  const { representativeGate } = require("../middleware/representativeGate");

  const token = hasToken
    ? jwt.sign({ id: "u1", sessionId: "s1", role, aud: "user" }, process.env.JWT_SECRET)
    : null;

  const req = { cookies: token ? { examai_admin: token } : {}, path };
  let statusCode = null;
  const res = { status: (code) => { statusCode = code; return res; } };
  let nextCalled = false;
  let thrown = null;

  try {
    representativeGate(req, res, () => { nextCalled = true; });
  } catch (e) {
    thrown = e;
  }

  return { nextCalled, blocked: Boolean(thrown), statusCode };
};

console.log("\nrepresentativeGate — path allowlist");
{
  check("a representative can reach their own coupon performance", runGate({ role: "representative", path: "/api/representatives/me/coupons" }).nextCalled, true);
  check("a representative can reach auth (login/logout/me)", runGate({ role: "representative", path: "/api/auth/me" }).nextCalled, true);

  const blocked = runGate({ role: "representative", path: "/api/students" });
  check("a representative is blocked from an unrelated admin route", blocked.blocked, true);
  check("blocked with 403, not some other status", blocked.statusCode, 403);

  check("a representative cannot reach another representative's performance via the admin route", runGate({ role: "representative", path: "/api/representatives/someOtherId/coupons" }).blocked, true);
  check("a representative cannot reach earnings", runGate({ role: "representative", path: "/api/earnings/summary" }).blocked, true);
  check("a representative cannot reach coupon management itself", runGate({ role: "representative", path: "/api/coupons" }).blocked, true);
}

console.log("\nrepresentativeGate — doubtSolver path allowlist");
{
  // This is the exact bug that shipped: /api/doubts (no trailing slash) is
  // the bare queue-list endpoint, and a prefix of "/api/doubts/" (WITH a
  // trailing slash) does not match it — "/api/doubts".startsWith("/api/doubts/")
  // is false, since the bare path is shorter than the prefix it's being
  // compared against. A doubt solver could reach every sub-path
  // (/api/doubts/mine, /api/doubts/:id/resolve) but not the queue itself,
  // which is the one thing this role exists to see first.
  const queue = runGate({ role: "doubtSolver", path: "/api/doubts" });
  check("a doubt solver can reach the bare queue list, no trailing slash", queue.nextCalled, true);

  check("a doubt solver can reach their own solved history", runGate({ role: "doubtSolver", path: "/api/doubts/mine" }).nextCalled, true);
  check("a doubt solver can reach their own payment stats", runGate({ role: "doubtSolver", path: "/api/doubts/stats/me" }).nextCalled, true);
  check("a doubt solver can resolve a specific doubt", runGate({ role: "doubtSolver", path: "/api/doubts/abc123/resolve" }).nextCalled, true);
  check("a doubt solver can reach auth", runGate({ role: "doubtSolver", path: "/api/auth/me" }).nextCalled, true);

  // The queue's own filter dropdowns need batch names and subject names —
  // both read-only for this role, since every write on either already has
  // its own independent allow("owner","admin") check at the route level.
  check("a doubt solver can read the batch list, for the queue's batch filter", runGate({ role: "doubtSolver", path: "/api/batches" }).nextCalled, true);
  check("a doubt solver can read the subject list, for the queue's subject filter", runGate({ role: "doubtSolver", path: "/api/taxonomy/subjects" }).nextCalled, true);

  // Scoped narrowly to /api/taxonomy/subjects specifically, not the whole
  // /api/taxonomy/ tree — a doubt solver's UI never needed topics or
  // chapters, and widening the prefix to the parent path would have handed
  // over more than the one dropdown actually uses.
  const topics = runGate({ role: "doubtSolver", path: "/api/taxonomy/topics" });
  check("a doubt solver cannot reach an unrelated taxonomy path", topics.blocked, true);

  check("a doubt solver cannot reach coupon management", runGate({ role: "doubtSolver", path: "/api/coupons" }).blocked, true);
  check("a doubt solver cannot reach earnings", runGate({ role: "doubtSolver", path: "/api/earnings/summary" }).blocked, true);
  check("a doubt solver cannot reach team/user management", runGate({ role: "doubtSolver", path: "/api/users" }).blocked, true);
}

console.log("\nrepresentativeGate — everyone else passes through untouched");
{
  check("an admin is never touched by this gate", runGate({ role: "admin", path: "/api/students" }).nextCalled, true);
  check("an admin can reach coupon management", runGate({ role: "admin", path: "/api/coupons" }).nextCalled, true);
  check("a teacher can reach their batches", runGate({ role: "teacher", path: "/api/batches" }).nextCalled, true);
  check("a teacher cannot reach lecture management", runGate({ role: "teacher", path: "/api/lectures" }).blocked, true);
  check("owner is never touched by this gate", runGate({ role: "owner", path: "/api/anything" }).nextCalled, true);
}

console.log("\nrepresentativeGate — no session at all is left to protect()");
{
  // The gate is a narrowing filter, not the authoritative check — with no
  // token it has nothing to narrow, and just steps aside.
  check("no cookie at all passes through (protect() on the route will reject it)", runGate({ role: "representative", path: "/api/students", hasToken: false }).nextCalled, true);
}

console.log("\nCoupon model — representative attribution");
{
  const Coupon = mongoose.model("Coupon");
  const withoutRep = new Coupon({ code: "SAVE10", discountType: "percent", discountValue: 10 });
  check("representative defaults to null, not required", withoutRep.representative, null);

  const repId = new mongoose.Types.ObjectId();
  const withRep = new Coupon({ code: "JOHN20", discountType: "percent", discountValue: 20, representative: repId });
  check("a coupon can be attached to a representative", String(withRep.representative), String(repId));

  // Existing behaviour, re-checked here only because this feature adds a
  // new field next to it — a coupon still has to make sense on its own
  // terms regardless of whether anyone is attributed to it.
  check("percent discount still applies correctly alongside the new field", withRep.apply(100), 80);
}

console.log("\n" + "-".repeat(50));
console.log(`${passed} passed, ${failed} failed`);
console.log("\nNOT covered here — needs a real database and a running server:");
console.log("  - the coupon CRUD endpoints and their validation messages");
console.log("  - the performance aggregation against real Purchase documents");
console.log("  - buildPerformance() returning identical numbers via /me and /:id");

if (failed > 0) process.exit(1);
console.log("PASS");

mongoose.connection.close().catch(() => {});
