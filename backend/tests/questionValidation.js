// Cross-field validation for question shapes. These are the checks a mongoose
// schema cannot make on its own — most importantly, whether correctOption
// actually names one of the options that exist.

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = require("crypto").randomBytes(48).toString("hex");
process.env.ENCRYPTION_KEY = require("crypto").randomBytes(32).toString("hex");

const { validateShape } = require("../controllers/admin/questionController");

let passed = 0;
let failed = 0;

const check = (label, type, body, expectValid) => {
  const problem = validateShape(type, body);
  const isValid = problem === null;

  if (isValid === expectValid) {
    passed += 1;
    console.log(`  ok    ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}`);
    console.log(`        expected ${expectValid ? "valid" : "invalid"}, got ${problem || "valid"}`);
  }
};

const opts = (...keys) => keys.map((k) => ({ key: k, text: `option ${k}` }));

console.log("\nmcq");
check("well formed", "mcq", { options: opts("A", "B", "C", "D"), correctOption: "B" }, true);
check("two options is enough", "mcq", { options: opts("A", "B"), correctOption: "A" }, true);
check("image instead of text", "mcq", { options: [{ key: "A", image: "x.png" }, { key: "B", text: "b" }], correctOption: "A" }, true);
check("one option rejected", "mcq", { options: opts("A"), correctOption: "A" }, false);
check("no options rejected", "mcq", { correctOption: "A" }, false);
check("missing correctOption", "mcq", { options: opts("A", "B") }, false);
check("correctOption not among options", "mcq", { options: opts("A", "B", "C"), correctOption: "D" }, false);
check("duplicate keys rejected", "mcq", { options: opts("A", "B", "A"), correctOption: "A" }, false);
check("option with no key", "mcq", { options: [{ text: "no key" }, { key: "B", text: "b" }], correctOption: "B" }, false);
check("option with neither text nor image", "mcq", { options: [{ key: "A" }, { key: "B", text: "b" }], correctOption: "B" }, false);

console.log("\nmtf");
check("well formed", "mtf", { statements: [{ text: "s1", isTrue: true }, { text: "s2", isTrue: false }] }, true);
check("one statement rejected", "mtf", { statements: [{ text: "s1", isTrue: true }] }, false);
check("statement missing text", "mtf", { statements: [{ isTrue: true }, { text: "s2", isTrue: false }] }, false);
check("isTrue must be boolean", "mtf", { statements: [{ text: "s1", isTrue: "yes" }, { text: "s2", isTrue: false }] }, false);
check("isTrue missing", "mtf", { statements: [{ text: "s1" }, { text: "s2", isTrue: false }] }, false);

console.log("\nwritten");
check("no rubric is allowed at draft time", "written", {}, true);
check("well formed rubric", "written", { rubric: [{ criterion: "states the law", marks: 2 }] }, true);
check("rubric must be a list", "written", { rubric: "two marks for the law" }, false);
check("rubric row needs a criterion", "written", { rubric: [{ marks: 2 }] }, false);
check("rubric row needs marks", "written", { rubric: [{ criterion: "states the law" }] }, false);
check("zero marks is a real value", "written", { rubric: [{ criterion: "no credit row", marks: 0 }] }, true);

console.log("\npassage");
const subq = (overrides) => ({
  question: "Sub question",
  options: opts("A", "B", "C", "D"),
  correctOption: "A",
  marks: 1,
  ...overrides,
});
check("well formed", "passage", { subQuestions: [subq({}), subq({ correctOption: "B" })] }, true);
check("one sub-question is enough", "passage", { subQuestions: [subq({})] }, true);
check("no sub-questions rejected", "passage", { subQuestions: [] }, false);
check("subQuestions missing entirely", "passage", {}, false);
check("sub-question missing text", "passage", { subQuestions: [subq({ question: "" })] }, false);
check("sub-question with one option rejected", "passage", { subQuestions: [{ ...subq({}), options: opts("A") }] }, false);
check("sub-question missing correctOption", "passage", { subQuestions: [{ ...subq({}), correctOption: undefined }] }, false);
check("sub-question correctOption not among its options", "passage", { subQuestions: [subq({ correctOption: "Z" })] }, false);
check("sub-question duplicate option keys rejected", "passage", { subQuestions: [{ ...subq({}), options: opts("A", "A") }] }, false);
check("one bad sub-question fails the whole passage", "passage", { subQuestions: [subq({}), { ...subq({}), correctOption: "Z" }] }, false);

console.log("\nunknown type");
check("rejected", "essay", {}, false);

console.log("\n" + "-".repeat(50));
console.log(`${passed} passed, ${failed} failed`);

if (failed > 0) process.exit(1);
console.log("PASS");
