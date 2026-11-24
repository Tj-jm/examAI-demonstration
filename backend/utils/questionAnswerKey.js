const Exam = require("../models/examModel");
const Submission = require("../models/submissionModel");

// A question's answer key: everything scoring depends on. Editing it while
// students are sitting an exam that uses the question would score them
// against a key they never saw, so it's locked then; editing it after
// submissions exist offers a re-score so every student is marked the same.

// What scoring reads, as one comparable string.
const answerKeyOf = (q) => JSON.stringify({
  marks: Number(q.marks) || 0,
  negativeMarks: q.type === "mcq" ? Number(q.negativeMarks) || 0 : 0,
  correctOption: q.type === "mcq" ? q.correctOption ?? null : null,
  options: q.type === "mcq" ? (q.options || []).length : 0,
  statements: q.type === "mtf" ? (q.statements || []).map((s) => Boolean(s.isTrue)) : [],
  subQuestions: q.type === "passage"
    ? (q.subQuestions || []).map((s) => [s.correctOption ?? null, Number(s.marks) || 0, Number(s.negativeMarks) || 0])
    : [],
});

const examsUsing = (questionId) => Exam.find({ questions: questionId })
  .select("title durationMinutes scriptGraceMinutes bufferSeconds")
  .lean();

// Attempts still running (inside their exam's time, grace and buffer
// included) on any exam that uses this question.
const liveAttempts = async (questionId) => {
  const exams = await examsUsing(questionId);
  if (!exams.length) return { count: 0, exams: [] };
  const now = Date.now();
  const live = [];
  for (const exam of exams) {
    const windowMs = ((exam.durationMinutes || 0) + (exam.scriptGraceMinutes || 0)) * 60000 + (exam.bufferSeconds || 0) * 1000;
    const count = await Submission.countDocuments({ exam: exam._id, status: "in_progress", startedAt: { $gte: new Date(now - windowMs) } });
    if (count) live.push({ title: exam.title, count });
  }
  return { count: live.reduce((n, e) => n + e.count, 0), exams: live };
};

const SCORED = ["submitted", "grading", "graded"];

// Finished attempts a re-score would touch.
const scoredAttempts = async (questionId) => {
  const exams = await examsUsing(questionId);
  if (!exams.length) return { exams: 0, submissions: 0 };
  const submissions = await Submission.countDocuments({ exam: { $in: exams.map((e) => e._id) }, status: { $in: SCORED } });
  return { exams: submissions ? exams.length : 0, submissions };
};

// Re-scores this question in every finished attempt of every exam using it,
// and refreshes each attempt's total marks. A teacher's own mark on an
// answer is kept. Written questions only change the total (their answers
// are graded by a person or the AI, not re-scored here).
const rescoreQuestion = async (question) => {
  const exams = await Exam.find({ questions: question._id }).populate("questions");
  let updated = 0;
  for (const exam of exams) {
    const total = exam.totalMarks();
    const submissions = await Submission.find({ exam: exam._id, status: { $in: SCORED } });
    for (const submission of submissions) {
      if (question.type !== "written") {
        for (const answer of submission.answers) {
          if (String(answer.question) !== String(question._id) || answer.gradedBy === "teacher" || answer.questionType === "written") continue;
          Submission.scoreObjectiveAnswer(answer, question);
        }
      }
      if (total !== null) submission.totalMarks = total;
      if (submission.status === "graded") {
        submission.marks = submission.answers.reduce((sum, a) => sum + (a.marksAwarded || 0), 0);
      }
      await submission.save();
      updated += 1;
    }
  }
  return { exams: exams.length, submissions: updated };
};

module.exports = { answerKeyOf, liveAttempts, scoredAttempts, rescoreQuestion };
