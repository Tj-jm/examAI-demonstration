const { questionText } = require("./questionText");

// A passage's written questions (subQuestions with type "written") are each
// answered and marked like a standalone written question: a submission holds
// one answer per written part, { question: <passage>, questionType:
// "written", subIndex }, next to the passage's own answer for its mcqs. So
// grading, AI grading, regrades and credits work per part unchanged; these
// helpers turn such an answer back into the question it answers.

const isWrittenSub = (sq) => sq?.type === "written";

// Indexes of a passage's written questions.
const writtenIndexes = (question) =>
  question?.type === "passage" ? (question.subQuestions || []).map((sq, i) => (isWrittenSub(sq) ? i : -1)).filter((i) => i >= 0) : [];

const hasSub = (answer) => answer?.subIndex !== null && answer?.subIndex !== undefined;

// The key one answer is saved under: the question id, plus ":<index>" for a
// passage's written part.
const answerKey = (answer) => (hasSub(answer) ? `${answer.question}:${answer.subIndex}` : String(answer.question));
const parseKey = (key) => {
  const [question, index] = String(key || "").split(":");
  return { question, subIndex: index === undefined || index === "" ? null : Number(index) };
};
const findAnswer = (answers, key) => {
  const { question, subIndex } = parseKey(key);
  return answers.find((a) => String(a.question) === question && (hasSub(a) ? a.subIndex === subIndex : subIndex === null));
};

// A written part as a written question: the passage, then the part.
const partOf = (passage, subIndex) => {
  const p = passage?.toObject ? passage.toObject() : passage;
  const sq = p?.subQuestions?.[subIndex];
  if (!sq) return null;
  const n = sq.label || String(subIndex + 1);
  return {
    _id: p._id,
    subIndex,
    type: "written",
    question: `${questionText(p)}\n\n(${n}) ${sq.question}`,
    passage: p.question,
    partLabel: n,
    partQuestion: sq.question,
    questionImage: sq.questionImage || p.questionImage || null,
    // The editor sets no rubric for a passage's written question, and AI
    // marking needs one: without it, one criterion worth all its marks,
    // judged against the model answer (or the passage's solution).
    rubric: sq.rubric?.length
      ? sq.rubric
      : [{ criterion: sq.modelAnswer ? "Matches the model answer in substance" : "A correct, complete answer to this question", marks: sq.marks || 1 }],
    modelAnswer: sq.modelAnswer || "",
    marks: sq.marks || 0,
    solutionText: p.solutionText,
    topic: p.topic, chapter: p.chapter, subject: p.subject, difficulty: p.difficulty,
  };
};

// The question an answer is for: the part for a passage's written answer.
const questionFor = (answer, question) => (hasSub(answer) && question ? partOf(question, answer.subIndex) : question);

// One answer per question, plus one per passage written part.
const answersFor = (questions) => questions.flatMap((q) => [
  { question: q._id, questionType: q.type },
  ...writtenIndexes(q).map((i) => ({ question: q._id, questionType: "written", subIndex: i })),
]);

module.exports = { isWrittenSub, writtenIndexes, hasSub, answerKey, parseKey, findAnswer, partOf, questionFor, answersFor };
