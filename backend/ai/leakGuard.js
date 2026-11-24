// A written-practice grade's `reasoning` is shown straight to the student
// who submitted the answer — but the same prompt call also hands the model
// the question's modelAnswer, so it can grade accurately against it. The
// prompt itself instructs the model never to quote that model answer back
// (see gradeWrittenPractice in ai/prompts/index.js) and treats the
// student's answer text as data, not instructions, but a model can still be
// talked into leaking it via a crafted answer. This is the second,
// independent layer: scan the actual response before it reaches the
// student and withhold it if it clearly reproduces the model answer.
const normalize = (text) => text.replace(/\s+/g, " ").trim().toLowerCase();

// A short shared substring (a common word, "the answer is") is expected and
// harmless; a long one is not something a grading explanation would
// legitimately reproduce verbatim from a reference the student never saw.
const MIN_LEAK_LENGTH = 30;

const containsModelAnswerLeak = (reasoning, modelAnswer) => {
  if (!reasoning || !modelAnswer) return false;

  const r = normalize(reasoning);
  const m = normalize(modelAnswer);
  if (m.length < MIN_LEAK_LENGTH) return false;

  for (let i = 0; i + MIN_LEAK_LENGTH <= m.length; i += 10) {
    if (r.includes(m.slice(i, i + MIN_LEAK_LENGTH))) return true;
  }
  return false;
};

// Marks stay whatever they were graded as — only the feedback text (the
// thing that could carry the leaked wording) is replaced.
const sanitizeReasoning = (reasoning, modelAnswer) =>
  containsModelAnswerLeak(reasoning, modelAnswer)
    ? "Feedback withheld because it quoted the reference answer directly. Your mark above is still accurate."
    : reasoning;

module.exports = { containsModelAnswerLeak, sanitizeReasoning };
