// The two pieces of pure arithmetic behind the practice-exam rewrite:
// what percentage a graded paper comes out to, and how a new attempt folds
// into a running average. Both are tested here in isolation from anything
// that needs a live request or a database — see the note at the bottom for
// what that leaves uncovered.

process.env.NODE_ENV = "test";
process.env.ENCRYPTION_KEY = require("crypto").randomBytes(32).toString("hex");

const mongoose = require("mongoose");
const { computePercent } = require("../utils/practiceScoring");
require("../models/practiceExamRecordModel");
const PracticeExamRecord = mongoose.model("PracticeExamRecord");

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

console.log("\ncomputePercent");
{
  check("a straightforward fraction", computePercent(15, 20), 75);
  check("a full score", computePercent(20, 20), 100);
  check("a zero score is still a real result, not null", computePercent(0, 20), 0);

  // Negative marking can take the raw total below zero on a bad enough
  // paper — clamped to 0% rather than shown as a negative percentage,
  // which would be accurate but meaningless to a student reading it.
  check("negative marksAwarded is clamped to 0%, not shown negative", computePercent(-6, 20), 0);

  // Nothing to average — every question in the paper turned out ungradable
  // (a written question with no rubric, say). null is the signal the
  // caller uses to skip recording the attempt at all, not to record a 0%.
  check("zero total marks yields null, not 0%", computePercent(5, 0), null);
  check("null total marks yields null", computePercent(5, null), null);
  check("undefined total marks yields null", computePercent(5, undefined), null);

  // Standard rounding, not truncation — 1/3 is closer to 33% than to 32%.
  check("rounds rather than truncates", computePercent(1, 3), 33);
  check("rounds up at the midpoint", computePercent(2, 3), 67);
}

console.log("\nPracticeExamRecord.nextAverage — pure arithmetic half of recordAttempt");
{
  // recordAttempt itself runs as a MongoDB aggregation pipeline update and
  // needs a live database to exercise — nextAverage is the same formula
  // written in plain JS specifically so the formula itself can be checked
  // without one. The two are not literally the same code path; this proves
  // the arithmetic concept is right, not that the Mongo pipeline
  // implementing it has no typo. See the note at the end of this file.
  check("first attempt: the average is just that attempt's score", PracticeExamRecord.nextAverage(0, 0, 80), 80);
  check("second attempt averages evenly with the first", PracticeExamRecord.nextAverage(80, 1, 60), 70);

  // Three attempts: 80, 60, 100 — average should land on exactly 80,
  // folded in one at a time the way recordAttempt actually receives them,
  // not computed as a batch mean.
  let avg = PracticeExamRecord.nextAverage(0, 0, 80);
  avg = PracticeExamRecord.nextAverage(avg, 1, 60);
  avg = PracticeExamRecord.nextAverage(avg, 2, 100);
  check("three attempts fold into the same result as a plain average", Math.round(avg * 100) / 100, 80);

  // A late attempt should move the average less than an early one — the
  // whole point of an average over a single "most recent" number.
  const afterTwoGoodAttempts = PracticeExamRecord.nextAverage(90, 2, 90);
  const oneBadAttemptLater = PracticeExamRecord.nextAverage(afterTwoGoodAttempts, 3, 0);
  check("one zero after a strong streak dents the average, doesn't erase it", oneBadAttemptLater > 50, true);
}

console.log("\n" + "-".repeat(50));
console.log(`${passed} passed, ${failed} failed`);
console.log("\nNOT covered here — needs a live request or a database:");
console.log("  - recordAttempt's actual MongoDB aggregation pipeline");
console.log("  - written-question AI grading and the aiAssist feature gate");
console.log("  - buildPracticeExam / submitPracticeExam end to end");
console.log("  - the admin-side createdByStudent exclusions (excludeStudentExams.js)");

if (failed > 0) process.exit(1);
console.log("PASS");

mongoose.connection.close().catch(() => {});
