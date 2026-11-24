// isLive()/status() decide what a student sees and what an admin's status
// pill says — tested here in isolation from any request, since a mismatch
// between the two is exactly the kind of bug that only shows up as "it says
// live but nobody can see it" days later. liveQuery() is checked against a
// real in-memory document so the Mongo query form is proven to agree with
// the plain-JS one, not just asserted to.

process.env.NODE_ENV = "test";

const mongoose = require("mongoose");
require("../models/noticeModel");
const Notice = mongoose.model("Notice");

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

const HOUR = 60 * 60 * 1000;
const now = new Date();
const past = new Date(now - HOUR);
const future = new Date(now.getTime() + HOUR);

const make = (attrs) => new Notice({ title: "t", bodyMarkdown: "b", noticeType: "general", ...attrs });

console.log("\nisLive() / status() agree on every combination");
{
  const draft = make({ isPublished: false });
  check("unpublished is not live", draft.isLive(now), false);
  check("unpublished status is draft", draft.status(now), "draft");

  const plain = make({ isPublished: true });
  check("published with no window is live", plain.isLive(now), true);
  check("published with no window status is live", plain.status(now), "live");

  const notYet = make({ isPublished: true, publishFrom: future });
  check("publishFrom in the future is not live", notYet.isLive(now), false);
  check("publishFrom in the future status is scheduled", notYet.status(now), "scheduled");

  const already = make({ isPublished: true, publishFrom: past });
  check("publishFrom in the past is live", already.isLive(now), true);
  check("publishFrom in the past status is live", already.status(now), "live");

  const overNow = make({ isPublished: true, publishUntil: past });
  check("publishUntil in the past is not live", overNow.isLive(now), false);
  check("publishUntil in the past status is expired", overNow.status(now), "expired");

  const stillOpen = make({ isPublished: true, publishUntil: future });
  check("publishUntil in the future is live", stillOpen.isLive(now), true);

  const window = make({ isPublished: true, publishFrom: past, publishUntil: future });
  check("inside an open window is live", window.isLive(now), true);
  check("inside an open window status is live", window.status(now), "live");

  // Scheduled takes precedence in status() even when an end date has also
  // technically already passed relative to a badly-ordered window (from
  // after until) — status() checks publishFrom first, matching isLive()'s
  // own check order, so the two can never disagree about which one wins.
  const bothSet = make({ isPublished: true, publishFrom: future, publishUntil: past });
  check("a scheduled notice is not live even with a past end date too", bothSet.isLive(now), false);
  check("and reports scheduled, not expired, since that check runs first", bothSet.status(now), "scheduled");
}

console.log("\nliveQuery() matches the same documents isLive() says are live");
{
  const cases = [
    make({ isPublished: false }),
    make({ isPublished: true }),
    make({ isPublished: true, publishFrom: future }),
    make({ isPublished: true, publishUntil: past }),
    make({ isPublished: true, publishFrom: past, publishUntil: future }),
  ];

  // A tiny in-memory match against the actual Mongo query shape, so this
  // proves the query and the plain-JS method describe the same rule rather
  // than two rules that happen to have similar names.
  const matchesQuery = (doc, query) => {
    if (query.isPublished !== undefined && doc.isPublished !== query.isPublished) return false;
    for (const clause of query.$and || []) {
      const [field, cond] = Object.entries(clause.$or[1])[0];
      const ok = doc[field] === null || (cond.$lte ? doc[field] <= cond.$lte : doc[field] >= cond.$gte);
      if (!ok) return false;
    }
    return true;
  };

  const query = Notice.liveQuery({}, now);

  for (const doc of cases) {
    check(
      `liveQuery agrees with isLive() for isPublished=${doc.isPublished}, from=${doc.publishFrom}, until=${doc.publishUntil}`,
      matchesQuery(doc, query),
      doc.isLive(now)
    );
  }
}

console.log("\n" + "-".repeat(50));
console.log(`${passed} passed, ${failed} failed`);
console.log("\nNOT covered here — needs a database:");
console.log("  - the admin CRUD endpoints and their validation messages");
console.log("  - pagination counts against a real Notice collection");
console.log("  - image upload through the notices media folder");

if (failed > 0) process.exit(1);
console.log("PASS");

mongoose.connection.close().catch(() => {});
