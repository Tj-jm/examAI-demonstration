const aiService = require("../ai/service");
const { questionText, fullQuestionText } = require("./questionText");
const { archiveHint } = require("../ai/prompts");
const { hint: hintSchema } = require("../ai/schemas");
const { containsModelAnswerLeak } = require("../ai/leakGuard");
const AiConfig = require("../models/aiConfigModel");

// Hint-first tutor, shared by the archive and batch practice: up to three
// escalating hints on a question the student hasn't answered yet, never the
// answer itself. The prompt is told the answer (so hints are right) and
// told not to reveal it; this module is the second layer that checks.

const MAX_HINTS = 3;

// Used only when the model gives the answer away twice in a row — a vaguer
// hint is better than a spoiler, and better than an error the student paid for.
const FALLBACK_HINTS = {
  1: "Start by naming the topic this question is really testing, and recall the one rule or formula from it that fits.",
  2: "Write down what the question gives you and what it asks for, then see which part of that rule connects them.",
  3: "Apply that rule to the given values one step at a time, and check each option (or statement) against your result.",
};
// The same, for a Bangla or Hindi question when hints match its language.
const FALLBACK_BY_SCRIPT = [
  [/[ঀ-৿]/, {
    1: "প্রশ্নটি আসলে কোন বিষয় যাচাই করছে তা ঠিক করো, আর সেই বিষয়ের যে নিয়ম বা সূত্রটি খাটে তা মনে করো।",
    2: "প্রশ্নে কী দেওয়া আছে আর কী চাওয়া হয়েছে লিখে ফেলো, তারপর দেখো নিয়মের কোন অংশ এ দুটিকে যুক্ত করে।",
    3: "দেওয়া মানগুলোতে নিয়মটি ধাপে ধাপে প্রয়োগ করো, আর প্রতিটি অপশন (বা বিবৃতি) তোমার ফলের সাথে মিলিয়ে দেখো।",
  }],
  [/[ऀ-ॿ]/, {
    1: "पहले पहचानिए कि यह प्रश्न असल में किस विषय को जाँच रहा है, और उस विषय का कौन-सा नियम या सूत्र यहाँ लागू होता है।",
    2: "प्रश्न में क्या दिया है और क्या पूछा गया है, लिख लीजिए, फिर देखिए नियम का कौन-सा हिस्सा इन दोनों को जोड़ता है।",
    3: "दिए गए मानों पर नियम को एक-एक कदम लागू कीजिए, और हर विकल्प (या कथन) को अपने परिणाम से मिलाइए।",
  }],
];
const fallbackHint = (question, level, matchLanguage) => {
  const found = matchLanguage && FALLBACK_BY_SCRIPT.find(([script]) => script.test(question.question || ""));
  return (found ? found[1] : FALLBACK_HINTS)[level];
};

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const norm = (text) => String(text || "").replace(/\s+/g, " ").trim().toLowerCase();

// Second layer behind the prompt's own rules: the hint must not quote the
// reference solution, the correct option's text (when it's long enough to be
// meaningful — "4" appears in plenty of honest hints), or name the key
// outright ("the answer is B", "option (B) is correct").
const hintLeaks = (text, question) => {
  if (containsModelAnswerLeak(text, question.solutionText)) return true;
  if (question.type !== "mcq" || !question.correctOption) return false;

  const correct = question.options.find((o) => o.key === question.correctOption);
  if (correct && norm(correct.text).length >= 6 && norm(text).includes(norm(correct.text))) return true;

  // Case-sensitive on purpose — key "A" must not match the word "a" — and
  // Unicode-aware so Bangla keys (ক, খ …) are bounded like Latin ones.
  const key = `(?<![\\p{L}\\p{N}])${escapeRegex(question.correctOption)}(?![\\p{L}\\p{N}])`;
  const namesKey = new RegExp(
    `([Aa]nswer|[Cc]orrect|উত্তর|সঠিক)[^.।]{0,25}${key}|${key}[)"'\\]]?\\s+is\\s+(the\\s+)?([Cc]orrect|[Rr]ight|[Aa]nswer)`,
    "u"
  );
  return namesKey.test(text);
};

// Reads and validates { level, previousHints } from a request body. Throws a
// 400-style error for a level outside 1..MAX_HINTS.
const parseHintRequest = (body) => {
  const level = Number(body.level);
  const previousHints = Array.isArray(body.previousHints)
    ? body.previousHints.filter((h) => typeof h === "string").slice(0, MAX_HINTS - 1).map((h) => h.slice(0, 600))
    : [];
  if (!Number.isInteger(level) || level < 1 || level > MAX_HINTS) {
    const error = new Error(`Hints go from 1 to ${MAX_HINTS}.`);
    error.statusCode = 400;
    throw error;
  }
  return { level, previousHints };
};

// What a hint is about. A passage is several mcqs under one text, so a hint
// is for one of them (`subIndex`): the passage plus that sub-question is
// hinted as an ordinary mcq, with the same leak checks against its key.
// Throws a 400-style error for a missing or out-of-range subIndex.
const hintTargetFor = (question, subIndex) => {
  if (question.type !== "passage") return question;
  const index = Number(subIndex);
  const sub = Number.isInteger(index) ? question.subQuestions?.[index] : undefined;
  if (!sub) {
    const error = new Error("Choose which question under the passage you want a hint for.");
    error.statusCode = 400;
    throw error;
  }
  if (sub.type === "written") return require("./passageParts").partOf(question, index);
  return {
    type: "mcq",
    question: `${questionText(question)}\n\nQuestion ${index + 1}: ${sub.question}`,
    options: sub.options,
    correctOption: sub.correctOption,
    solutionText: question.solutionText,
    topic: question.topic,
    chapter: question.chapter,
  };
};

// One hint for `question` (topic/chapter populated). Asks once; if the hint
// gives the answer away, asks again with a stricter note; if that leaks too,
// returns a generic hint instead of a spoiler. `feature` is the billing key.
// → { hint, usage } (usage: the last AI call's tokens and model).
const generateHintWithUsage = async ({ question, level, previousHints, student, batch, feature }) => {
  const matchLanguage = (await AiConfig.get()).hints?.matchLanguage !== false;
  const ask = (strict) =>
    aiService.generate({
      feature,
      schema: hintSchema,
      student,
      batch,
      ...archiveHint({
        type: question.type,
        question: questionText(question),
        options: question.options,
        statements: question.statements,
        correctAnswer: question.type === "mcq" ? question.correctOption : undefined,
        solutionText: question.type === "written" ? question.modelAnswer || question.solutionText : question.solutionText,
        level,
        previousHints,
        topicTitle: question.topic?.title || question.chapter?.title,
        strict,
        matchLanguage,
      }),
    });

  let { data, usage } = await ask(false);
  if (hintLeaks(data.hint, question)) {
    ({ data, usage } = await ask(true));
    if (hintLeaks(data.hint, question)) data = { hint: fallbackHint(question, level, matchLanguage) };
  }
  return { hint: data.hint, usage };
};

const generateHint = async (options) => (await generateHintWithUsage(options)).hint;

module.exports = { MAX_HINTS, parseHintRequest, hintTargetFor, generateHint, generateHintWithUsage, hintLeaks };
