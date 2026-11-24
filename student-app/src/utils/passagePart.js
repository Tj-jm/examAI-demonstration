// The question a drawing pad shows for a written question under a passage:
// the passage plus that one question (DoodlePad renders `part` under it).
export const withPart = (question, si) => {
  const sub = question?.subQuestions?.[si];
  return sub ? { ...question, part: { label: sub.label || String(si + 1), question: sub.question, questionImage: sub.questionImage } } : question;
};
