// The on-screen calculator: who gets it, and its arithmetic.
import { createRequire } from "module";
const require = createRequire(import.meta.url);
process.env.NODE_ENV = "test";
const { calculatorAllowed } = require("../controllers/app/examController");
const { evaluate, format } = await import("../../student-app/src/components/calculator/evaluate.js");

let passed = 0;
let failed = 0;
const check = (label, ok, detail) => {
  if (ok) { passed += 1; console.log(`  ok    ${label}`); }
  else { failed += 1; console.log(`  FAIL  ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`); }
};

console.log("who gets it");
const batch = (features) => ({ features });
check("exam, batch default unset: off", calculatorAllowed({ calculator: null }, batch({})) === false);
check("exam follows the batch default when on", calculatorAllowed({ calculator: null }, batch({ examCalculator: true })) === true);
check("exam set to allowed beats a batch default of off", calculatorAllowed({ calculator: true }, batch({ examCalculator: false })) === true);
check("exam set to not allowed beats a batch default of on", calculatorAllowed({ calculator: false }, batch({ examCalculator: true })) === false);
check("a student's practice exam: on by default", calculatorAllowed({ createdByStudent: "s1", calculator: false }, batch({})) === true);
check("a student's practice exam: off when the batch turns practice off", calculatorAllowed({ createdByStudent: "s1" }, batch({ calculator: false })) === false);

console.log("\narithmetic");
const near = (a, b) => typeof a === "number" && Math.abs(a - b) < 1e-9 * Math.max(1, Math.abs(b));
const cases = [
  ["2+3×4", 14], ["(2+3)×4", 20], ["-2^2", -4], ["2^3^2", 512], ["2^-1", 0.5], ["2π", 2 * Math.PI],
  ["3(4+1)", 15], ["sin(30)", 0.5], ["sin(180)", 0], ["tan(45)", 1], ["asin(1)", 90], ["log(1000)", 3],
  ["ln(e)", 1], ["√16", 4], ["5!", 120], ["50%", 0.5], ["(1+2", 3], ["6.02E23×2", 1.204e24], ["0.1+0.2", 0.3],
  ["10^(2)", 100], ["cbrt(27)", 3], ["asin(0.5)", 30], ["acos(0.5)", 60], ["acos(-1)", 180], ["atan(1)", 45], ["atan(-1)", -45],
];
for (const [src, want] of cases) {
  let got; try { got = evaluate(src, { deg: true }); } catch (e) { got = e.message; }
  check(`${src} = ${want}`, near(got, want), got);
}
check("ANS is the last answer", evaluate("ANS×2", { ans: 7 }) === 14);
check("radians when asked", near(evaluate("sin(π÷2)", { deg: false }), 1));
for (const src of ["1÷0", "tan(90)", "log(-1)", "√-4", "asin(2)", "171!", "2×", "abc", "alert(1)"]) {
  let threw = false; try { evaluate(src); } catch { threw = true; }
  check(`"${src}" is an error, not a number`, threw);
}
check("large and small numbers in E notation", format(1.204e24) === "1.204E24" && format(1.234e-7) === "1.234E-7");
check("10 significant digits", format(1 / 3) === "0.3333333333");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
