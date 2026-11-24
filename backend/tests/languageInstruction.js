// languageInstruction() is the one thing standing between "the model reads
// Bangla and answers in English anyway" (the reported bug) and correct
// behaviour. Not exported directly — tested here through generateQuestions'
// own system prompt, which is what a real request actually sends, rather
// than importing the internal helper and testing it in isolation from the
// prompt it's supposed to end up inside.

process.env.NODE_ENV = "test";

const { generateQuestions } = require("../ai/prompts");

let passed = 0;
let failed = 0;

const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (ok) {
    passed += 1;
    console.log(`  ok    ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}`);
    console.log(`        expected ${expected}, got ${actual}`);
  }
};

const baseArgs = {
  sourceText: "Photosynthesis converts light energy into chemical energy.",
  topicTitle: "Photosynthesis",
  chapterTitle: "Plant Biology",
  subjectTitle: "Biology",
  count: 2,
  types: ["mcq"],
  difficulty: "medium",
};

console.log("\nlanguageInstruction — no language specified (the default, unset case)");
{
  const { system } = generateQuestions(baseArgs);
  check(
    "falls back to matching the source material's own language, not English by default",
    system.includes("same language as the source material"),
    true
  );
  check(
    "still protects technical terms even in the default case",
    system.includes("scientific notation") && system.includes("chemical formulas"),
    true
  );
  check(
    "does not claim a specific language when none was requested",
    system.includes("Write the question text, options, and every other piece of generated text in English,"),
    false
  );
}

console.log("\nlanguageInstruction — an explicit language always wins");
{
  const { system } = generateQuestions({ ...baseArgs, language: "Bangla" });
  check("names the requested language directly", system.includes("in Bangla"), true);
  check("states it applies regardless of the source's own language", system.includes("regardless of what language the source material"), true);
}

console.log("\nlanguageInstruction — empty string behaves as unset, not as a language named \"\"");
{
  const { system } = generateQuestions({ ...baseArgs, language: "" });
  check("an empty string falls back to match-source behaviour", system.includes("same language as the source material"), true);
}

console.log("\n" + "-".repeat(50));
console.log(`${passed} passed, ${failed} failed`);
console.log("\nNOT covered here — needs a real model call:");
console.log("  - whether the model actually follows this instruction in practice");
console.log("  - Bengali script rendering downstream (admin editor, SafeMarkdown, PDF export)");

if (failed > 0) process.exit(1);
console.log("PASS");
