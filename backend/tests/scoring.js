// Objective scoring and the release of a final mark. The rule under test is
// that `marks` stays null until every written answer has been graded.

process.env.NODE_ENV = "test";
process.env.ENCRYPTION_KEY = require("crypto").randomBytes(32).toString("hex");

const mongoose = require("mongoose");
require("../models/questionModel");
require("../models/submissionModel");
const Submission = mongoose.model("Submission");

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

const oid = (n) => new mongoose.Types.ObjectId(String(n).padStart(24, "0"));

const build = (answers) => {
  const s = new Submission({ exam: oid(1), student: oid(2), batch: oid(3) });
  s.answers = answers;
  return s;
};

console.log("\nmcq scoring");
{
  const s = build([
    { question: oid(11), questionType: "mcq", selectedOption: "A" },
    { question: oid(12), questionType: "mcq", selectedOption: "C" },
    { question: oid(13), questionType: "mcq", selectedOption: null },
  ]);
  const map = new Map([
    [String(oid(11)), { type: "mcq", correctOption: "A", marks: 1, negativeMarks: 0.25 }],
    [String(oid(12)), { type: "mcq", correctOption: "B", marks: 1, negativeMarks: 0.25 }],
    [String(oid(13)), { type: "mcq", correctOption: "B", marks: 1, negativeMarks: 0.25 }],
  ]);
  s.scoreObjective(map);
  check("correct answer scores full marks", s.answers[0].marksAwarded, 1);
  check("wrong answer takes the penalty", s.answers[1].marksAwarded, -0.25);
  check("skipped answer is neither rewarded nor penalised", s.answers[2].marksAwarded, 0);
  check("marked as auto-graded", s.answers[0].gradedBy, "auto");
}

console.log("\nmtf partial credit");
{
  const q = {
    type: "mtf",
    marks: 1,
    negativeMarks: 0.25,
    statements: [{ isTrue: true }, { isTrue: true }, { isTrue: true }, { isTrue: false }],
  };

  const all = build([{ question: oid(21), questionType: "mtf",
    statementAnswers: [{ index: 0, value: true }, { index: 1, value: true }, { index: 2, value: true }, { index: 3, value: false }] }]);
  all.scoreObjective(new Map([[String(oid(21)), q]]));
  check("all four correct", all.answers[0].marksAwarded, 1);

  const some = build([{ question: oid(21), questionType: "mtf",
    statementAnswers: [{ index: 0, value: true }, { index: 1, value: false }, { index: 2, value: true }, { index: 3, value: false }] }]);
  some.scoreObjective(new Map([[String(oid(21)), q]]));
  check("three right one wrong", some.answers[0].marksAwarded, 0.5);

  const blank = build([{ question: oid(21), questionType: "mtf",
    statementAnswers: [{ index: 0, value: null }, { index: 1, value: null }, { index: 2, value: null }, { index: 3, value: null }] }]);
  blank.scoreObjective(new Map([[String(oid(21)), q]]));
  check("unanswered statements score zero", blank.answers[0].marksAwarded, 0);

  // Each statement is worth marks / statements, whatever negativeMarks says.
  const two = { type: "mtf", marks: 1, negativeMarks: 0, statements: [{ isTrue: true }, { isTrue: false }] };
  const both = build([{ question: oid(22), questionType: "mtf", statementAnswers: [{ index: 0, value: true }, { index: 1, value: false }] }]);
  both.scoreObjective(new Map([[String(oid(22)), two]]));
  check("two statements, both right, earns the full mark", both.answers[0].marksAwarded, 1);
  const half = build([{ question: oid(22), questionType: "mtf", statementAnswers: [{ index: 0, value: true }] }]);
  half.scoreObjective(new Map([[String(oid(22)), two]]));
  check("one of two right, other blank, earns half", half.answers[0].marksAwarded, 0.5);
  const wrong = build([{ question: oid(22), questionType: "mtf", statementAnswers: [{ index: 0, value: false }, { index: 1, value: false }] }]);
  wrong.scoreObjective(new Map([[String(oid(22)), two]]));
  check("one right one wrong cancels out", wrong.answers[0].marksAwarded, 0);
  const three = { type: "mtf", marks: 2, statements: [{ isTrue: true }, { isTrue: true }, { isTrue: true }] };
  const thirds = build([{ question: oid(23), questionType: "mtf", statementAnswers: [{ index: 0, value: true }] }]);
  thirds.scoreObjective(new Map([[String(oid(23)), three]]));
  check("shares round to two decimals", thirds.answers[0].marksAwarded, 0.67);
}

console.log("\nwithholding the final mark");
{
  const s = build([
    { question: oid(31), questionType: "mcq", selectedOption: "A" },
    { question: oid(32), questionType: "written", answerText: "an answer" },
  ]);
  const map = new Map([
    [String(oid(31)), { type: "mcq", correctOption: "A", marks: 1, negativeMarks: 0 }],
    [String(oid(32)), { type: "written", marks: 5 }],
  ]);

  s.scoreObjective(map);
  check("written answers are left alone", s.answers[1].marksAwarded, null);
  check("one answer still pending", s.pendingWrittenAnswers().length, 1);
  check("finalize refuses", s.finalizeIfComplete(), false);
  check("status moves to grading", s.status, "grading");
  check("marks stay hidden", s.marks, null);

  s.answers[1].marksAwarded = 4;
  check("finalize succeeds once graded", s.finalizeIfComplete(), true);
  check("status is graded", s.status, "graded");
  check("marks are the sum", s.marks, 5);
}

console.log("\nblank written answers");
{
  const blank = build([
    { question: oid(33), questionType: "written", answerText: null, answerImages: undefined },
  ]);
  const map = new Map([
    [String(oid(33)), { type: "written", marks: 5 }],
  ]);

  blank.scoreObjective(map);
  check("blank written answer scores zero", blank.answers[0].marksAwarded, 0);
  check("blank written answer is marked auto-graded", blank.answers[0].gradedBy, "auto");
  check("blank written answer is not pending", blank.pendingWrittenAnswers().length, 0);
  check("blank written answer allows finalization", blank.finalizeIfComplete(), true);
  check("blank written answer contributes zero", blank.marks, 0);
}

console.log("\nmixed blank and content written answers");
{
  const mixed = build([
    { question: oid(35), questionType: "written", answerText: null, answerImages: undefined },
    { question: oid(36), questionType: "written", answerText: "A complete response.", answerImages: undefined },
  ]);
  const map = new Map([
    [String(oid(35)), { type: "written", marks: 5 }],
    [String(oid(36)), { type: "written", marks: 5 }],
  ]);

  mixed.scoreObjective(map);
  check("blank answer in mixed submission scores zero", mixed.answers[0].marksAwarded, 0);
  check("content answer in mixed submission remains pending", mixed.answers[1].marksAwarded, null);
  check("only the content answer remains in the queue", mixed.pendingWrittenAnswers().length, 1);
  check("mixed submission remains in grading", mixed.finalizeIfComplete(), false);
}

console.log("\nimage-only written answers");
{
  const imageOnly = build([
    { question: oid(34), questionType: "written", answerText: null, answerImages: ["answer.jpg"] },
  ]);
  const map = new Map([
    [String(oid(34)), { type: "written", marks: 5 }],
  ]);

  imageOnly.scoreObjective(map);
  check("image-only written answer remains pending", imageOnly.answers[0].marksAwarded, null);
  check("image-only written answer remains in grading queue", imageOnly.pendingWrittenAnswers().length, 1);
}

console.log("\nguards");
{
  const s = build([{ question: oid(41), questionType: "mcq", selectedOption: "A" }]);

  let threw = false;
  try { s.scoreObjective(); } catch (e) { threw = true; }
  check("throws without a question map", threw, true);

  threw = false;
  try { s.scoreObjective(new Map()); } catch (e) { threw = true; }
  check("throws when a question is missing from the map", threw, true);
}

console.log("\n" + "-".repeat(50));
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("PASS");
