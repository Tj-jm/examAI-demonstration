// Turns a graded answer's partial-credit mark into a single "counted
// correct or not" signal — shared by utils/weakTopics.js (blending exam
// performance into the weak-topics ranking that feeds personalized
// practice, the weak-topics report, and the study plan) and
// utils/examReport.js (the per-exam AI performance report). One function,
// so "correct" means the same threshold everywhere rather than two
// hand-copied constants slowly drifting apart.
const PASS_RATIO = 0.6;

// A written question's real total is its rubric sum when it has one — see
// admin-panel's Grading.jsx computing the identical `rubricTotal` for the
// same display, falling back to the question's own `marks` field otherwise
// (every type, mcq/mtf included, always has that one).
const questionTotal = (question) => {
  if (question.type === "written" && question.rubric?.length) {
    const rubricTotal = question.rubric.reduce((sum, r) => sum + (r.marks || 0), 0);
    if (rubricTotal > 0) return rubricTotal;
  }
  return question.marks || 1;
};

// null means "not graded yet" (a still-pending written answer) — kept
// distinct from false so a caller counting attempts never mistakes "no
// mark yet" for "graded wrong".
const answerIsCorrect = (answer, question) => {
  if (answer.marksAwarded === null || answer.marksAwarded === undefined) return null;
  const total = questionTotal(question);
  if (total <= 0) return null;
  return answer.marksAwarded / total >= PASS_RATIO;
};

module.exports = { questionTotal, answerIsCorrect, PASS_RATIO };
