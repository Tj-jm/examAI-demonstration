const Submission = require("../models/submissionModel");
const Exam = require("../models/examModel");
const { Question } = require("../models/questionModel");
const Batch = require("../models/batchModel");
const aiService = require("../ai/service");
const { examPerformanceReport: buildExamReportPrompt } = require("../ai/prompts");
const { examPerformanceReport: examPerformanceReportSchema } = require("../ai/schemas");
const { answerIsCorrect } = require("./answerScoring");

// Called right after a submission newly reaches "graded" (see
// submissionController.js's submitExam and gradingController.js's
// gradeAnswer — both call this at the exact point they already fire the
// "examGraded" notification). Computes this one exam's per-topic accuracy
// itself (plain JS, no AI needed for arithmetic), then asks the AI for a
// short narrative — summary, strengths, weaknesses, a recommendation —
// grounded in those real numbers. Stored on the submission itself, shown to
// the student alongside their result (ExamResult.jsx).
//
// Auto-triggered by grading, not a student action, so a failure here (AI
// not configured, provider hiccup, nothing gradeable to report on) must
// never break the grading flow it's called from — this never throws, it
// just logs and returns.
const generateExamPerformanceReport = async (submissionId, { rethrow = false } = {}) => {
  try {
    const submission = await Submission.findById(submissionId);
    if (!submission || submission.status !== "graded") return;

    // Same per-batch opt-in every other AI feature respects — an
    // auto-triggered call is not exempt from "this batch hasn't turned AI
    // on" just because no student explicitly asked for it. Two switches,
    // same as examAiGrading/studyPlan (see batchModel.js): the dedicated
    // toggle turns this feature on at all, and it only ever fires when
    // aiAssist is also on for the batch.
    const batch = await Batch.findById(submission.batch).select("features");
    if (!batch?.features?.aiAssist || !batch?.features?.examPerformanceReport) return;

    const exam = await Exam.findById(submission.exam).select("title");
    const questionIds = submission.answers.map((a) => a.question);
    const questions = await Question.find({ _id: { $in: questionIds } })
      .select("topic chapter skillType marks rubric type")
      .populate("topic", "title")
      .populate("chapter", "title");
    const qMap = new Map(questions.map((q) => [String(q._id), q]));

    // A chapter-pool question (no topic, see the "chapter pool" convention
    // used across this codebase) used to be skipped here entirely — an exam
    // built mostly or entirely from chapter-pool questions got no AI report
    // at all, and a mixed exam's report silently ignored however the
    // student did on that portion. Grouped under the chapter's own title
    // instead now, same shape as a topic row, so it counts the same way a
    // topic does everywhere below this point.
    const byTopic = new Map();
    for (const answer of submission.answers) {
      const question = qMap.get(String(answer.question));
      if (!question) continue;

      const correct = answerIsCorrect(answer, question);
      if (correct === null) continue;

      const group = question.topic || question.chapter;
      if (!group) continue;

      const groupId = String(group._id);
      if (!byTopic.has(groupId)) byTopic.set(groupId, { title: group.title, total: 0, correct: 0 });
      const row = byTopic.get(groupId);
      row.total += 1;
      if (correct) row.correct += 1;
    }

    // Nothing topic- or chapter-classified and gradeable to report on — an
    // exam whose questions predate topic tagging, say. Leaving
    // performanceReport unset is exactly what an older/ungraded submission
    // already looks like, no separate "couldn't generate" state needed.
    if (byTopic.size === 0) return;

    const topics = [...byTopic.values()]
      .map((r) => ({ title: r.title, accuracy: Math.round((r.correct / r.total) * 100), attempts: r.total }))
      .sort((a, b) => a.accuracy - b.accuracy);

    const { data } = await aiService.generate({
      feature: "exam-performance-report",
      schema: examPerformanceReportSchema,
      // Auto-triggered by grading completing, not something a student
      // spent a credit choosing to do — same student: null,
      // not-billable pattern as study-plan-free/question_generation (see
      // ai/featureCosts.js's comment on why those aren't in its cost list
      // either). batch is still passed for AI-usage-dashboard attribution.
      student: null,
      batch: submission.batch,
      ...buildExamReportPrompt({
        examTitle: exam?.title,
        marks: submission.marks,
        totalMarks: submission.totalMarks,
        topics,
      }),
    });

    submission.performanceReport = {
      summary: data.summary,
      strengths: data.strengths,
      weaknesses: data.weaknesses,
      recommendation: data.recommendation,
      generatedAt: new Date(),
    };
    await submission.save();
  } catch (err) {
    console.error(`Exam performance report failed for submission ${submissionId}:`, err.message);
    // The background queue retries; every other caller carries on.
    if (rethrow) throw err;
  }
};

// How every caller asks for a report: with the Performance setting
// "queued" (the default there) it is written in the background, so handing
// in or grading an exam never waits on the AI; otherwise it's written now.
// Never throws, like generateExamPerformanceReport.
const scheduleExamPerformanceReport = async (submissionId) => {
  try {
    if (true) {
      const settings = await require("../models/performanceSettingsModel").safeGet();
      if (settings.background?.examReport !== "instant") {
        // Only batches that have the report on get one (the same check the
        // report makes), so "being written" is never shown for nothing.
        const sub = await Submission.findById(submissionId).select("batch status").lean();
        const batch = sub && (await Batch.findById(sub.batch).select("features").lean());
        if (!sub || sub.status !== "graded" || !batch?.features?.aiAssist || !batch?.features?.examPerformanceReport) return;
        await Submission.updateOne({ _id: submissionId }, { $set: { "performanceReport.queuedAt": new Date() } });
        await require("./queue").enqueue("exam-report", { submissionId: String(submissionId) });
        return;
      }
    }
  } catch (err) {
    console.error(`Exam performance report could not be queued for ${submissionId}:`, err.message);
  }
  await generateExamPerformanceReport(submissionId);
};

module.exports = { generateExamPerformanceReport, scheduleExamPerformanceReport };
