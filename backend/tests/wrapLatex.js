// Latex.jsx (the frontend component) only renders maths it can find between a
// recognised delimiter — $...$, $$...$$, \(...\), \[...\], or a \begin{...}
// environment. A model that writes a correctly-escaped "\frac{a}{b}" with no
// delimiter around it has produced text the frontend has no way to find, not
// a rendering bug. wrapBareLatex exists to add the delimiter before anything
// is saved.

process.env.NODE_ENV = "test";

const { wrapBareLatex, deepWrapLatex } = require("../ai/wrapLatex");

let passed = 0;
let failed = 0;

const check = (label, ok, detail) => {
  if (ok) { passed += 1; console.log(`  ok    ${label}`); }
  else { failed += 1; console.log(`  FAIL  ${label}${detail !== undefined ? ` — ${detail}` : ""}`); }
};

console.log("\nwrapping a bare command");
{
  const out = wrapBareLatex("v = \\frac{s}{t} approximately.");
  check("the command gets a $...$ pair", out === "v = $\\frac{s}{t}$ approximately.", out);
}

{
  const out = wrapBareLatex("Then \\sqrt{2} is irrational.");
  check("\\sqrt{2} is wrapped", out === "Then $\\sqrt{2}$ is irrational.", out);
}

{
  const out = wrapBareLatex("Nested groups: \\sqrt{\\frac{a}{b}} here.");
  check("nested braces stay together in one wrap",
    out === "Nested groups: $\\sqrt{\\frac{a}{b}}$ here.", out);
}

console.log("\nsuperscripts and subscripts attached to a command");
{
  const out = wrapBareLatex("So x_{max}^2 is the peak.");
  check("a subscript/superscript pair on a plain variable is left alone",
    out === "So x_{max}^2 is the peak.", out);
}

{
  const out = wrapBareLatex("Given \\theta_0 as the start angle.");
  check("a subscript attached to a command is included in the wrap",
    out === "Given $\\theta_0$ as the start angle.", out);
}

console.log("\nmerging adjacent commands");
{
  const out = wrapBareLatex("Use \\frac{a}{b} \\cdot \\frac{c}{d} together.");
  check("a short gap between two commands merges into one span",
    out === "Use $\\frac{a}{b} \\cdot \\frac{c}{d}$ together.", out);
}

{
  const out = wrapBareLatex("First \\alpha, much later in the paragraph \\beta appears.");
  check("commands separated by real prose stay as separate spans",
    out === "First $\\alpha$, much later in the paragraph $\\beta$ appears.", out);
}

console.log("\nleaving correct input alone");
{
  const out = wrapBareLatex("Already correct: $\\frac{a}{b}$ stays as is.");
  check("an already-delimited command is untouched", out === "Already correct: $\\frac{a}{b}$ stays as is.", out);
}

{
  const out = wrapBareLatex("Display block: $$\\int_0^1 x\\,dx$$ done.");
  check("a $$...$$ block is left alone", out === "Display block: $$\\int_0^1 x\\,dx$$ done.", out);
}

{
  const out = wrapBareLatex("\\(\\pi r^2\\) is the area.");
  check("a \\(...\\) span is left alone", out === "\\(\\pi r^2\\) is the area.", out);
}

{
  const block = "\\begin{align*} x &= 1 \\\\ y &= 2 \\end{align*}";
  const out = wrapBareLatex(`Solve it: ${block} done.`);
  check("a \\begin{align*}...\\end{align*} environment is left alone",
    out === `Solve it: ${block} done.`, out);
}

{
  const out = wrapBareLatex("Plain prose with no backslash at all.");
  check("text with no backslash is returned unchanged",
    out === "Plain prose with no backslash at all.", out);
}

{
  const out = wrapBareLatex("An unbalanced \\frac{a group that never closes.");
  check("an unbalanced brace does not swallow the rest of the string",
    typeof out === "string" && out.startsWith("An unbalanced $\\frac{a group that never closes.$") === false,
    out);
}

console.log("\nnon-string input");
{
  check("null passes through", wrapBareLatex(null) === null);
  check("a number passes through", wrapBareLatex(5) === 5);
  check("undefined passes through", wrapBareLatex(undefined) === undefined);
}

console.log("\ndeepWrapLatex walks nested structures");
{
  const input = {
    questions: [
      { type: "mcq", question: "Find \\frac{1}{2} of 10.", options: [{ key: "A", text: "\\frac{1}{2}" }] },
      { type: "written", modelAnswer: "Because \\theta = 90^\\circ.", rubric: [{ criterion: "uses \\pi", marks: 2 }] },
    ],
    correctOption: "A",
  };

  const out = deepWrapLatex(input);

  check("a string field nested in an array of objects is wrapped",
    out.questions[0].question === "Find $\\frac{1}{2}$ of 10.", out.questions[0].question);
  check("a string nested two levels deep (options[].text) is wrapped",
    out.questions[0].options[0].text === "$\\frac{1}{2}$", out.questions[0].options[0].text);
  check("a short plain string with no backslash (correctOption) is untouched",
    out.correctOption === "A");
  check("a field on a different array element is wrapped independently",
    out.questions[1].rubric[0].criterion === "uses $\\pi$", out.questions[1].rubric[0].criterion);
}

console.log("\n" + "-".repeat(50));
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("PASS");