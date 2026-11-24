// Zod validation of model output. These are the checks standing between a
// hallucinated question and the question bank, so each case isolates one rule:
// test data is otherwise valid, so a failure can only come from the rule under
// test rather than from an unrelated minimum-length error.

process.env.NODE_ENV = "test";

const s = require("../ai/schemas");

let passed = 0;
let failed = 0;

const check = (label, schema, input, shouldPass) => {
  const result = schema.safeParse(input);

  if (result.success === shouldPass) {
    passed += 1;
    console.log(`  ok    ${label}`);
  } else if (shouldPass) {
    failed += 1;
    console.log(`  FAIL  ${label}`);
    console.log(`        rejected: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label} — accepted when it should have been rejected`);
  }
};

// Valid baselines. Each case below changes exactly one thing.
const mcq = (over = {}) => ({
  type: "mcq",
  question: "A 2 kg ball at 5 m/s hits a stationary 3 kg ball. Final velocity?",
  options: [
    { key: "A", text: "2 m/s" },
    { key: "B", text: "2.5 m/s" },
    { key: "C", text: "5 m/s" },
  ],
  correctOption: "A",
  solutionText: "Momentum is conserved.",
  ...over,
});

const mtf = (over = {}) => ({
  type: "mtf",
  question: "Decide whether each statement about circular motion is true.",
  statements: [
    { text: "Speed is constant.", isTrue: true },
    { text: "Velocity is constant.", isTrue: false },
  ],
  solutionText: "Direction changes, so velocity changes.",
  ...over,
});

const written = (over = {}) => ({
  type: "written",
  question: "Explain why an orbiting satellite is in continuous free fall.",
  marks: 5,
  rubric: [{ criterion: "Identifies gravity as the only force", marks: 2 }],
  modelAnswer: "Gravity provides the centripetal force.",
  ...over,
});

const passage = (over = {}) => ({
  type: "passage",
  question: "Read the following excerpt about the water cycle and answer the questions below it.",
  subQuestions: [
    {
      question: "What process turns liquid water into vapour?",
      options: [{ key: "A", text: "Evaporation" }, { key: "B", text: "Condensation" }],
      correctOption: "A",
      marks: 1,
    },
    {
      question: "What causes water vapour to form clouds?",
      options: [{ key: "A", text: "Evaporation" }, { key: "B", text: "Condensation" }],
      correctOption: "B",
      marks: 1,
    },
  ],
  solutionText: "Evaporation and condensation drive the cycle described in the excerpt.",
  ...over,
});

console.log("\nmcq");
check("valid", s.generatedMcq, mcq(), true);
check("answer key naming an option that does not exist", s.generatedMcq, mcq({ correctOption: "Z" }), false);
check("duplicate option keys", s.generatedMcq, mcq({
  options: [{ key: "A", text: "one" }, { key: "A", text: "two" }],
  correctOption: "A",
}), false);
check("a single option", s.generatedMcq, mcq({ options: [{ key: "A", text: "only" }], correctOption: "A" }), false);
check("nine options", s.generatedMcq, mcq({
  options: Array.from({ length: 9 }, (_, i) => ({ key: String(i), text: `opt ${i}` })),
  correctOption: "0",
}), false);
check("missing solution text", s.generatedMcq, mcq({ solutionText: "" }), false);
check("wrong discriminator", s.generatedMcq, mcq({ type: "quiz" }), false);
check("difficulty defaults when absent", s.generatedMcq, (() => { const q = mcq(); delete q.difficulty; return q; })(), true);

console.log("\nmtf");
check("valid", s.generatedMtf, mtf(), true);
check("a single statement", s.generatedMtf, mtf({ statements: [{ text: "Only one.", isTrue: true }] }), false);
check("isTrue as a string", s.generatedMtf, mtf({
  statements: [{ text: "One.", isTrue: "yes" }, { text: "Two.", isTrue: false }],
}), false);

console.log("\nwritten");
check("valid", s.generatedWritten, written(), true);
check("empty rubric", s.generatedWritten, written({ rubric: [] }), false);
check("rubric row without marks", s.generatedWritten, written({ rubric: [{ criterion: "c" }] }), false);
check("marks above the cap", s.generatedWritten, written({ marks: 500 }), false);
check("fractional marks", s.generatedWritten, written({ marks: 2.5 }), false);

console.log("\npassage");
check("valid", s.generatedPassage, passage(), true);
check("one sub-question is too few", s.generatedPassage, passage({
  subQuestions: [passage().subQuestions[0]],
}), false);
check("sub-question answer key naming an option that does not exist", s.generatedPassage, passage({
  subQuestions: [{ ...passage().subQuestions[0], correctOption: "Z" }, passage().subQuestions[1]],
}), false);
check("sub-question duplicate option keys", s.generatedPassage, passage({
  subQuestions: [
    { question: "q", options: [{ key: "A", text: "one" }, { key: "A", text: "two" }], correctOption: "A", marks: 1 },
    passage().subQuestions[1],
  ],
}), false);
check("missing solution text", s.generatedPassage, passage({ solutionText: "" }), false);
check("passage text too short", s.generatedPassage, passage({ question: "Too short." }), false);
check("wrong discriminator", s.generatedPassage, passage({ type: "mcq" }), false);
check("sub-question marks default to 1 when absent", s.generatedPassage, (() => {
  const p = passage();
  delete p.subQuestions[0].marks;
  return p;
})(), true);

console.log("\ngrading");
check("valid", s.gradedAnswer, { marks: 3, reasoning: "Covers two of three criteria.", confidence: 0.7 }, true);
check("confidence above one", s.gradedAnswer, { marks: 3, reasoning: "r", confidence: 1.4 }, false);
check("negative marks", s.gradedAnswer, { marks: -1, reasoning: "r", confidence: 0.5 }, false);
check("missing reasoning", s.gradedAnswer, { marks: 3, confidence: 0.5 }, false);
check("optional criteria breakdown", s.gradedAnswer, {
  marks: 3,
  reasoning: "r",
  confidence: 0.8,
  criteriaMet: [{ criterion: "c", met: true, marksAwarded: 2 }],
}, true);

console.log("\nbatches");
check("mixed types in one batch", s.questionBatch, { questions: [mcq(), mtf(), written(), passage()] }, true);
check("one bad question fails the batch", s.questionBatch, { questions: [mcq(), mcq({ correctOption: "Z" })] }, false);
check("empty batch", s.questionBatch, { questions: [] }, false);

console.log("\nquality review");
check("valid", s.qualityReview, {
  issues: [{ kind: "multiple_valid_answers", severity: "high", detail: "B and C are both correct." }],
}, true);
check("no issues found", s.qualityReview, { issues: [] }, true);
check("unknown issue kind", s.qualityReview, {
  issues: [{ kind: "vibes", severity: "high", detail: "d" }],
}, false);
check("latex_error kind with no fix is rejected", s.qualityReview, {
  issues: [{ kind: "latex_error", severity: "medium", detail: "Unclosed $ before the fraction." }],
}, false);
check("latex_error kind with a fix", s.qualityReview, {
  issues: [{ kind: "latex_error", severity: "medium", detail: "Unclosed $ before the fraction." }],
  fix: { question: "What is $\\frac{1}{2} + 1$?" },
}, true);
check("wrong_skill_type kind with a fix", s.qualityReview, {
  issues: [{ kind: "wrong_skill_type", severity: "low", detail: "This is a calculation, not recall." }],
  fix: { skillType: "problemSolving" },
}, true);
check("wrong_difficulty kind with a fix", s.qualityReview, {
  issues: [{ kind: "wrong_difficulty", severity: "low", detail: "This is harder than 'easy'." }],
  fix: { difficulty: "hard" },
}, true);
check("fix with corrected question and options names the correct one", s.qualityReview, {
  issues: [{ kind: "latex_error", severity: "medium", detail: "Unbalanced braces in option B." }],
  fix: { options: [{ key: "A", text: "1" }, { key: "B", text: "$\\frac{1}{2}$" }], correctOption: "B" },
}, true);
check("fix rejects an invalid difficulty", s.qualityReview, {
  issues: [{ kind: "wrong_difficulty", severity: "low", detail: "d" }],
  fix: { difficulty: "extreme" },
}, false);
check("fix rejects an invalid skillType", s.qualityReview, {
  issues: [{ kind: "wrong_skill_type", severity: "low", detail: "d" }],
  fix: { skillType: "vibes" },
}, false);
check("fix rejects rewritten options with no correctOption named", s.qualityReview, {
  issues: [{ kind: "wrong_answer_key", severity: "high", detail: "d" }],
  fix: { options: [{ key: "A", text: "1" }, { key: "B", text: "2" }] },
}, false);
check("fix rejects a correctOption that isn't one of the rewritten options", s.qualityReview, {
  issues: [{ kind: "wrong_answer_key", severity: "high", detail: "d" }],
  fix: { options: [{ key: "A", text: "1" }, { key: "B", text: "2" }], correctOption: "C" },
}, false);
check("fix accepts rewritten options with a matching correctOption", s.qualityReview, {
  issues: [{ kind: "wrong_answer_key", severity: "high", detail: "d" }],
  fix: { options: [{ key: "A", text: "1" }, { key: "B", text: "2" }], correctOption: "B" },
}, true);
check("fix accepts correctOption alone, no options rewrite", s.qualityReview, {
  issues: [{ kind: "wrong_answer_key", severity: "high", detail: "d" }],
  fix: { correctOption: "B" },
}, true);

console.log("\npool audit fix");
check("rejects rewritten options with no correctOption named", s.poolAudit, {
  issues: [{
    index: 0, kind: "wrong_answer_key", severity: "high", detail: "d",
    fix: { options: [{ key: "A", text: "1" }, { key: "B", text: "2" }] },
  }],
  duplicateGroups: [],
}, false);
check("accepts rewritten options with a matching correctOption", s.poolAudit, {
  issues: [{
    index: 0, kind: "wrong_answer_key", severity: "high", detail: "d",
    fix: { options: [{ key: "A", text: "1" }, { key: "B", text: "2" }], correctOption: "A" },
  }],
  duplicateGroups: [],
}, true);
check("latex_error kind with no fix is rejected", s.poolAudit, {
  issues: [{ index: 0, kind: "latex_error", severity: "medium", detail: "Unclosed $ before the fraction." }],
  duplicateGroups: [],
}, false);
check("latex_error kind with a fix", s.poolAudit, {
  issues: [{
    index: 0, kind: "latex_error", severity: "medium", detail: "Unclosed $ before the fraction.",
    fix: { question: "What is $\\frac{1}{2} + 1$?" },
  }],
  duplicateGroups: [],
}, true);

console.log("\n" + "-".repeat(50));
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("PASS");
