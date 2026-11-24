// Follow-up questions on a practice question already answered ("I don't get
// line 4"): practiceController's getQna/askQna. The AI only elaborates this
// question's solution and the student's answer (prompts' practiceFollowUp);
// anything else is declined. Billed as practice-qna, gated by Settings → AI
// (features.practiceQna) and the batch's own switch (features.practiceQna,
// with aiAssist).

const MAX_MESSAGE = 400;
// Earlier turns sent back to the model: enough for "and line 5?".
const HISTORY = 6;
const REFUSAL = "I can only help with this question's solution. Ask about a step or line you didn't follow.";

// The worked solution as the lines a student sees, numbered from 1. A
// $$ … $$ display block written over several lines is one line here.
const solutionLines = (text) => {
  const raw = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out = [];
  let block = null;
  for (const l of raw) {
    if (block !== null) {
      block.push(l);
      if (l.endsWith("$$")) { out.push(block.join(" ")); block = null; }
      continue;
    }
    if (l === "$$" || (l.startsWith("$$") && !l.slice(2).includes("$$"))) { block = [l]; continue; }
    out.push(l);
  }
  if (block) out.push(block.join(" "));
  return out;
};

const optionList = (options) => (options || []).map((o) => `${o.key}. ${o.text}`).join("\n");

// The question as the model needs it, and what this student answered.
const describe = (question, attempt) => {
  const q = question;
  if (q.type === "mcq") {
    return {
      questionBlock: `Question: ${q.question}\nOptions:\n${optionList(q.options)}`,
      answerBlock: `Correct answer: ${q.correctOption}\nThe student chose: ${attempt.selectedOption || "nothing"} (${attempt.isCorrect ? "right" : "wrong"})`,
    };
  }
  if (q.type === "mtf") {
    const theirs = new Map((attempt.statementAnswers || []).map((s) => [s.index, s.value]));
    return {
      questionBlock: `Question (true or false for each statement): ${q.question}`,
      answerBlock: (q.statements || []).map((s, i) => `- "${s.text}": ${s.isTrue ? "true" : "false"}; the student said ${theirs.has(i) ? (theirs.get(i) ? "true" : "false") : "nothing"}`).join("\n"),
    };
  }
  if (q.type === "passage") {
    const theirs = new Map((attempt.subAnswers || []).map((s) => [s.index, s.selectedOption]));
    return {
      questionBlock: `Passage: ${q.question}\n\n${(q.subQuestions || []).map((sq, i) => `Q${i + 1}. ${sq.question}\n${optionList(sq.options)}`).join("\n\n")}`,
      answerBlock: (q.subQuestions || []).map((sq, i) => `Q${i + 1}: correct ${sq.correctOption}, the student chose ${theirs.get(i) || "nothing"}`).join("\n"),
    };
  }
  // Written: what they wrote and the mark it got.
  return {
    questionBlock: `Question (${q.marks || 0} marks): ${q.question}`,
    answerBlock: `The student's answer: ${attempt.answerText?.trim() || "(sent as a photo)"}\nMarked ${attempt.marksAwarded ?? "?"}/${q.marks || 0}`,
  };
};

module.exports = { solutionLines, describe, MAX_MESSAGE, HISTORY, REFUSAL };
