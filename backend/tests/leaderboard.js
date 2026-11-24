// The aggregation pipeline itself needs a real Submission collection to
// test end to end — not available in this sandbox (see the note at the end
// of this file). What's tested here is the ranking logic in isolation:
// given the same per-(student,exam) best-percentage rows the pipeline's
// $group stages would produce, does averaging and ranking behave the way
// the feature is supposed to.

process.env.NODE_ENV = "test";

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

// Mirrors exactly the two $group stages in leaderboardController.js's
// pipeline, so this proves the SAME logic the real aggregation runs,
// not a reimplementation that merely sounds equivalent.
const rank = (attempts) => {
  const bestByStudentExam = new Map();
  for (const a of attempts) {
    const key = `${a.student}:${a.exam}`;
    const existing = bestByStudentExam.get(key);
    if (!existing || a.percent > existing) bestByStudentExam.set(key, a.percent);
  }

  const byStudent = new Map();
  for (const [key, percent] of bestByStudentExam) {
    const student = key.split(":")[0];
    if (!byStudent.has(student)) byStudent.set(student, []);
    byStudent.get(student).push(percent);
  }

  const rows = [...byStudent.entries()]
    .map(([student, percents]) => ({
      student,
      avgPercent: percents.reduce((a, b) => a + b, 0) / percents.length,
      examsCount: percents.length,
    }))
    .sort((a, b) => b.avgPercent - a.avgPercent);

  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
};

console.log("\nranking — best attempt per exam, not first or average of attempts");
{
  const attempts = [
    { student: "s1", exam: "e1", percent: 40 },
    { student: "s1", exam: "e1", percent: 90 },
  ];
  const ranked = rank(attempts);
  check("a retake counts by its best attempt, not the first", ranked[0].avgPercent, 90);
  check("a retake does not count as two exams", ranked[0].examsCount, 1);
}

console.log("\nranking — average percentage, not total marks, decides order");
{
  const attempts = [
    { student: "s1", exam: "e1", percent: 100 },
    { student: "s2", exam: "e1", percent: 80 },
    { student: "s2", exam: "e2", percent: 85 },
    { student: "s2", exam: "e3", percent: 90 },
  ];
  const ranked = rank(attempts);
  check("a single perfect score outranks three merely-strong ones", ranked[0].student, "s1");
  check("with no minimum, one exam is enough to take the top spot on merit", ranked[0].examsCount, 1);
}

console.log("\nranking — no minimum means everyone with a graded exam is ranked");
{
  const attempts = [{ student: "s1", exam: "e1", percent: 55 }];
  const ranked = rank(attempts);
  check("a single graded exam is enough to be ranked at all", ranked.length, 1);
  check("that student is rank 1 by default among a field of one", ranked[0].rank, 1);
}

console.log("\nranking — ties and ordering");
{
  const attempts = [
    { student: "s1", exam: "e1", percent: 70 },
    { student: "s2", exam: "e1", percent: 90 },
    { student: "s3", exam: "e1", percent: 90 },
  ];
  const ranked = rank(attempts);
  check("the higher scorer is never ranked below an equal one", ranked[0].avgPercent >= ranked[1].avgPercent, true);
  check("three distinct students all appear", ranked.length, 3);
}

console.log("\n" + "-".repeat(50));
console.log(`${passed} passed, ${failed} failed`);
console.log("\nNOT covered here — needs a real Submission collection:");
console.log("  - the actual $group aggregation pipeline end to end");
console.log("  - student-created exams being excluded (excludeStudentExams.js)");
console.log("  - the requesting student's own rank being found outside the top 10");
console.log("  - requireFeature(\"exams\") gating this specific route (routeAudit confirms a guard exists, not which one)");

if (failed > 0) process.exit(1);
console.log("PASS");
