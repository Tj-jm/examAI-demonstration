// A written part of a passage (Bangladesh's creative question: a stem, then
// ক, খ, গ, ঘ) is its own written question carrying the stem in `context`
// and its label in `partLabel`; parts of one passage share `group`. These
// put the stem back in front wherever the question is shown or sent to AI.

const questionText = (q) => {
  if (!q) return "";
  if (!q.context) return q.question || "";
  return `${q.context}\n\n${q.partLabel ? `(${q.partLabel}) ` : ""}${q.question || ""}`;
};

// For AI that must see the whole question at once (solutions, videos): a
// passage with every question under it, and its answers when asked.
const fullQuestionText = (q, { withAnswers = false } = {}) => {
  if (q?.type !== "passage") return questionText(q);
  const subs = (q.subQuestions || []).map((s, i) => {
    const opts = (s.options || []).map((o) => `   ${o.key}. ${o.text || "(image)"}`).join("\n");
    return `${i + 1}. ${s.question}${opts ? `\n${opts}` : ""}${withAnswers && s.correctOption ? `\n   Correct: ${s.correctOption}` : ""}`;
  });
  return `${questionText(q)}\n\nQuestions on this passage:\n${subs.join("\n")}`;
};

module.exports = { questionText, fullQuestionText };
