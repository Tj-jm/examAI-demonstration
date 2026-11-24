// One-off backfill — run this after deploying the exam performance report
// feature (utils/examReport.js) to generate the report for any submission
// that reached "graded" before that code existed, or whose generation
// attempt failed and was never retried (generateExamPerformanceReport never
// throws — a failure is only logged, see its own comment — so a submission
// caught by a since-fixed bug silently has no report and nothing retries it
// on its own).
//
// Safe to run more than once: every already-graded submission is checked,
// and generateExamPerformanceReport overwrites performanceReport either way
// (it doesn't skip a submission that already has one) — a repeat run just
// regenerates the same submissions again rather than skipping them, which
// is harmless, just a bit of wasted AI calls if run repeatedly. Pass
// --missing-only to skip anything that already has a report instead.
//
// Usage:  node backend/scripts/backfillExamPerformanceReports.js [--missing-only]
// Needs the same MONGO_URI as the server (reads backend/.env), and an AI
// provider actually configured (Settings > AI) — a submission whose batch
// doesn't have aiAssist on, or with nothing topic-classified to report on,
// is silently skipped either way, same as the live trigger does.

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const Submission = require("../models/submissionModel");
const { generateExamPerformanceReport } = require("../utils/examReport");

const missingOnly = process.argv.includes("--missing-only");

const run = async () => {
  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI is not set — copy backend/.env.example to backend/.env first.");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Connected: ${mongoose.connection.host}`);

  const query = { status: "graded" };
  if (missingOnly) query["performanceReport.generatedAt"] = null;

  const submissions = await Submission.find(query).select("_id");
  console.log(`${submissions.length} graded submission(s) to process${missingOnly ? " (missing a report only)" : ""}.`);

  let done = 0;
  for (const s of submissions) {
    await generateExamPerformanceReport(s._id);
    done += 1;
    if (done % 10 === 0) console.log(`  ${done}/${submissions.length}...`);
  }

  const withReport = await Submission.countDocuments({ status: "graded", "performanceReport.generatedAt": { $ne: null } });
  console.log(`Done. ${withReport} graded submission(s) now have a report (some may have been skipped — no AI assist on their batch, or nothing topic-classified to report on).`);

  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
