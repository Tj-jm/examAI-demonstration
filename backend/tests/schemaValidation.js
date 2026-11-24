// Mongoose-level validation. These run under validateSync(), which is what
// catches the difference between a path validator and a pre('validate') hook —
// hooks are async middleware and do not fire synchronously, so a rule written
// as a hook silently passes anything validated that way.

process.env.NODE_ENV = "test";
process.env.ENCRYPTION_KEY = require("crypto").randomBytes(32).toString("hex");

const mongoose = require("mongoose");
require("../models/questionModel");
require("../models/batchModel");

const Batch = mongoose.model("Batch");
const oid = () => new mongoose.Types.ObjectId();

let passed = 0;
let failed = 0;

const check = (label, doc, shouldBeValid) => {
  const error = doc.validateSync();
  const isValid = !error;

  if (isValid === shouldBeValid) {
    passed += 1;
    console.log(`  ok    ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}`);
    console.log(`        expected ${shouldBeValid ? "valid" : "invalid"}${error ? `, got: ${error.message}` : ", got valid"}`);
  }
};

const base = { question: "q", subject: oid(), chapter: oid(), topic: oid() };
const make = (type, extra) => new (mongoose.model(type))({ type, ...base, ...extra });
const batch = (plans) => new Batch({ name: "b", program: oid(), plans });

console.log("\nquestion types");
check("mcq with two options", make("mcq", { options: [{ key: "A", text: "a" }, { key: "B", text: "b" }], correctOption: "A" }), true);
check("mcq with one option", make("mcq", { options: [{ key: "A", text: "a" }], correctOption: "A" }), false);
check("mcq without correctOption", make("mcq", { options: [{ key: "A", text: "a" }, { key: "B", text: "b" }] }), false);
check("mtf with two statements", make("mtf", { statements: [{ text: "s1", isTrue: true }, { text: "s2", isTrue: false }] }), true);
check("mtf with one statement", make("mtf", { statements: [{ text: "s1", isTrue: true }] }), false);
check("written with a rubric", make("written", { rubric: [{ criterion: "c", marks: 2 }] }), true);
check("written without a rubric", make("written", {}), true);
check("question with no text", new (mongoose.model("mcq"))({ type: "mcq", subject: oid(), chapter: oid(), topic: oid(), options: [{ key: "A", text: "a" }, { key: "B", text: "b" }], correctOption: "A" }), false);
check("negative marks stored as a positive value", make("mcq", { options: [{ key: "A", text: "a" }, { key: "B", text: "b" }], correctOption: "A", negativeMarks: -1 }), false);

console.log("\nbatch plans");
check("finite plan with a duration", batch([{ label: "1 month", price: 15, durationDays: 30 }]), true);
check("infinite plan needs no duration", batch([{ label: "Full", price: 120, isInfinite: true }]), true);
check("finite plan without a duration", batch([{ label: "1 month", price: 15 }]), false);
check("finite plan with a zero duration", batch([{ label: "odd", price: 15, durationDays: 0 }]), false);
check("plan without a price", batch([{ label: "free?", durationDays: 30 }]), false);
check("plan with a negative price", batch([{ label: "x", price: -5, durationDays: 30 }]), false);
check("plan without a label", batch([{ price: 15, durationDays: 30 }]), false);
check("one bad plan invalidates the batch", batch([
  { label: "good", price: 15, durationDays: 30 },
  { label: "bad", price: 15 },
]), false);
check("a batch with no plans is fine", batch([]), true);

console.log("\n" + "-".repeat(50));
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("PASS");
