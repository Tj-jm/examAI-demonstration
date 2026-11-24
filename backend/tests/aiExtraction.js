// Pulling JSON out of a model response. Models wrap objects in prose and code
// fences whatever the instruction says, and local models do it far more often
// than hosted ones. Failing a call over formatting wastes a real request that
// already cost time and money.

process.env.NODE_ENV = "test";
process.env.ENCRYPTION_KEY = require("crypto").randomBytes(32).toString("hex");

const { extractJson, estimateCost, hasKnownPricing, looksSelfHosted } = require("../ai/service");

let passed = 0;
let failed = 0;

const check = (label, input, expected) => {
  let actual;
  try {
    actual = JSON.stringify(extractJson(input));
  } catch (error) {
    actual = `threw: ${error.message}`;
  }

  const want = expected === null ? null : JSON.stringify(expected);

  if (expected === null ? actual.startsWith("threw") : actual === want) {
    passed += 1;
    console.log(`  ok    ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}`);
    console.log(`        expected ${want === null ? "a throw" : want}, got ${actual}`);
  }
};

const obj = { questions: [{ type: "mcq", question: "q" }] };
const json = JSON.stringify(obj);

console.log("\nclean input");
check("bare json", json, obj);
check("json with surrounding whitespace", `\n\n  ${json}  \n`, obj);
check("a bare array", "[1,2,3]", [1, 2, 3]);

console.log("\nfenced");
check("json fence", "```json\n" + json + "\n```", obj);
check("plain fence", "```\n" + json + "\n```", obj);
check("fence with prose before it", "Here is the result:\n```json\n" + json + "\n```", obj);
check("fence with prose after it", "```json\n" + json + "\n```\nLet me know if you need more.", obj);

console.log("\nunfenced prose");
check("prose before", "Sure! Here you go: " + json, obj);
check("prose after", json + " I hope this helps.", obj);
check("prose both sides", "Here: " + json + " — done.", obj);

console.log("\nawkward");
check("nested braces survive", '{"a":{"b":{"c":1}}}', { a: { b: { c: 1 } } });
check("a brace inside a string value", '{"text":"use { like this"}', { text: "use { like this" });

console.log("\nunrecoverable");
check("plain prose with no json", "I am not able to answer that.", null);
check("empty response", "", null);
check("truncated json", '{"questions":[{"type":"mcq"', null);
// \vec, \frac, \beta turned into control characters before reaching us
// (as \u000b or the raw byte) come back as the LaTeX command.
check("vertical tab escape restored", '{"hint":"$\\u000bec{A}$"}', { hint: "$\\vec{A}$" });
check("raw control bytes restored", '{"hint":"\u000bec \u000crac \u0008eta"}', { hint: "\\vec \\frac \\beta" });

console.log("\ncost estimation");
const near = (label, actual, expected) => {
  const ok = Math.abs(actual - expected) < 1e-9;
  if (ok) { passed += 1; console.log(`  ok    ${label}`); }
  else { failed += 1; console.log(`  FAIL  ${label} — expected ${expected}, got ${actual}`); }
};

near("custom with no pricing set is assumed free", estimateCost("custom", "qwen2.5:14b", 100000, 100000), 0);
near("unknown hosted model is not guessed at", estimateCost("openai", "some-future-model", 1000, 1000), 0);
near("gpt-4o-mini priced per million", estimateCost("openai", "gpt-4o-mini", 1e6, 1e6), 0.15 + 0.6);
near("versioned model names still match", estimateCost("openai", "gpt-4o-mini-2024-07-18", 1e6, 0), 0.15);
near("zero tokens costs nothing", estimateCost("openai", "gpt-4o", 0, 0), 0);

console.log("\nmanual pricing override (custom/paid endpoints — Groq, OpenRouter, DeepSeek...)");
near(
  "override prices a custom endpoint that isn't actually free",
  estimateCost("custom", "llama-3.3-70b", 1e6, 1e6, { inputPerMillion: 0.59, outputPerMillion: 0.79 }),
  0.59 + 0.79
);
near(
  "override wins even over a known hosted model's table rate",
  estimateCost("openai", "gpt-4o", 1e6, 0, { inputPerMillion: 1, outputPerMillion: 1 }),
  1
);
near(
  "override with both rates at 0 is treated as unset, falls back to the table",
  estimateCost("openai", "gpt-4o-mini", 1e6, 0, { inputPerMillion: 0, outputPerMillion: 0 }),
  0.15
);
near(
  "embedded ignores any override — genuinely free, no API on the other end",
  estimateCost("embedded", "qwen2.5-1.5b", 1e6, 1e6, { inputPerMillion: 5, outputPerMillion: 5 }),
  0
);

console.log("\nnewly-added table entries (gpt-4.1, o3-mini, claude-opus-4-1, gemini-1.5-pro/flash)");
near("gpt-4.1", estimateCost("openai", "gpt-4.1", 1e6, 1e6), 2 + 8);
near("gpt-4.1-mini distinct from gpt-4.1", estimateCost("openai", "gpt-4.1-mini", 1e6, 1e6), 0.4 + 1.6);
near("o3-mini", estimateCost("openai", "o3-mini", 1e6, 1e6), 1.1 + 4.4);
near("claude-opus-4-1", estimateCost("anthropic", "claude-opus-4-1", 1e6, 1e6), 15 + 75);
near("gemini-1.5-pro", estimateCost("gemini", "gemini-1.5-pro", 1e6, 1e6), 1.25 + 5);
near("gemini-1.5-flash distinct from 1.5-pro", estimateCost("gemini", "gemini-1.5-flash", 1e6, 1e6), 0.075 + 0.3);

console.log("\nhasKnownPricing — settings-screen warning check");
const ok = (label, actual, expected) => {
  if (actual === expected) { passed += 1; console.log(`  ok    ${label}`); }
  else { failed += 1; console.log(`  FAIL  ${label} — expected ${expected}, got ${actual}`); }
};
ok("embedded is always considered priced (it's genuinely free)", hasKnownPricing("embedded", "whatever", null), true);
ok("known hosted model is priced", hasKnownPricing("openai", "gpt-4o-mini", null), true);
ok("unrecognized model with no override is NOT priced", hasKnownPricing("openai", "some-brand-new-model", null), false);
ok("custom with no override is NOT priced", hasKnownPricing("custom", "llama-3.3-70b", null), false);
ok("custom WITH an override IS priced", hasKnownPricing("custom", "llama-3.3-70b", { inputPerMillion: 0.5, outputPerMillion: 0.5 }), true);

console.log("\nlooksSelfHosted — distinguishes your own box from a paid gateway");
ok("localhost is self-hosted", looksSelfHosted("http://localhost:11434/v1"), true);
ok("127.0.0.1 is self-hosted", looksSelfHosted("http://127.0.0.1:1234/v1"), true);
ok("a private LAN address is self-hosted", looksSelfHosted("http://192.168.1.50:8000/v1"), true);
ok("a real public API domain is not self-hosted", looksSelfHosted("https://api.groq.com/openai/v1"), false);
ok("empty/unset baseUrl is not self-hosted", looksSelfHosted(""), false);

console.log("\n" + "-".repeat(50));
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("PASS");
