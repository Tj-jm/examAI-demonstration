// Runs every test file in sequence and fails on the first non-zero exit.
const { spawnSync } = require("child_process");
const path = require("path");

const suites = ["routeAudit.js", "questionValidation.js", "scoring.js", "accessResolution.js", "schemaValidation.js", "aiSchemas.js", "aiExtraction.js", "aiProvider.js", "httpIntegration.js", "productionMode.js", "localModels.js", "storage.js", "ingest.js", "mediaHttp.js", "paymentGateways.js", "practiceExam.js", "notices.js", "notifications.js", "earnings.js", "representativeGate.js", "leaderboard.js", "languageInstruction.js", "doubtReview.js", "doubtQuota.js", "gradingClaim.js", "wrapLatex.js", "archiveSources.js", "iconPresets.js", "ingestQuality.js", "publishedAt.js", "docChat.js", "accountCare.js", "liveKit.js", "agents.js", "mediaUrl.js", "answerPhotos.js", "progress.js", "courseOutline.js", "videoLesson.js", "readPages.js", "examAttempts.js", "aiWriting.js", "studentLists.js", "nativeSession.js", "calculator.mjs", "institution.js", "studentImport.js", "assignments.js", "gradebook.js", "certificates.js", "gradingFlow.js", "lecturePractice.js", "boardTimeline.mjs", "tutorExamTask.js", "practiceQna.js", "studentVideo.js", "progressReports.js", "sharedState.js", "cache.js", "aiReuse.js", "leaderboardBoard.js", "queue.js", "autosave.js", "loadTestBypass.js"];

let failed = 0;
const failedNames = [];

for (const suite of suites) {
  console.log(`\n${"=".repeat(60)}\n${suite}\n${"=".repeat(60)}`);
  const run = spawnSync(process.execPath, [path.join(__dirname, suite)], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  process.stdout.write(run.stdout || "");
  process.stderr.write(run.stderr || "");
  if (run.status !== 0) {
    failed += 1;
    failedNames.push(suite);
    // On GitHub Actions, surface the failing lines as an annotation so they
    // show on the run page instead of being buried under service logs.
    if (process.env.GITHUB_ACTIONS) {
      const lines = `${run.stdout || ""}\n${run.stderr || ""}`.split("\n")
        .filter((line) => /FAIL|Error|expected/.test(line)).slice(0, 15).join("%0A");
      console.log(`::error title=${suite} failed::${lines || "exit code " + run.status}`);
    }
  }
}

console.log(`\n${"=".repeat(60)}`);
if (failed > 0) {
  console.error(`${failed} suite(s) failed: ${failedNames.join(", ")}`);
  process.exit(1);
}
console.log("All suites passed.");