// Single source of truth for which `feature` strings (see every
// `aiService.generate({ feature: "..." })` call site) are billable against a
// student's AI credits, and what each one costs by default.
//
// Deliberately NOT every feature key in the codebase: admin-triggered bulk
// generation (question_generation, solution_backfill, quality_check,
// document_generation) has no `student` on the call, so it never touches
// assertWithinCaps' per-student branch at all — there is no credit to spend.
//
// The two lecture-summary features ARE billable despite being cached and
// shared across every student who views the lecture — the cache is what's
// shared, not the cost. Whoever's request actually triggers a (re)generation
// (the first viewer ever, or anyone who taps regenerate afterward) is who
// pays for that one AI call; everyone who reads the resulting cached
// summary afterward pays nothing, same as before.
//
// Costs are "leaning toward heavier calls costing more" per the project's
// own open item — doubt-solve-image and practice-similar (a 5-question
// generation) default higher than a single-question text call.
const FEATURE_COST_KEYS = [
  { key: "doubt-solve", label: "Doubt solved by AI", hint: "A student's doubt answered by AI, no image attached." },
  { key: "doubt-solve-image", label: "Doubt solved by AI, with image", hint: "Same, but with a photo attached — a vision call costs more." },
  { key: "practice-explain", label: "Explain a practice mistake", hint: "Why an MCQ or true/false answer was wrong." },
  { key: "practice-qna", label: "Ask about a practice solution", hint: "One follow-up answer on a practice question already answered (\"I don't get line 4\"): the steps of that solution spelled out, nothing else." },
  { key: "student-video", label: "Short AI video for a student", hint: "One short video a student asks for on a point of a lecture or solution (\"elaborate the proof\"): its script and voice." },
  { key: "practice-similar", label: "Generate similar questions", hint: "A fresh set of similar practice questions from one question." },
  { key: "practice-grade-written", label: "Grade a written practice answer", hint: "AI marks one written answer against its rubric." },
  { key: "practice-exam-grade-written", label: "Grade a written answer in a practice exam", hint: "Same grading, run automatically per written answer when a custom practice exam is submitted." },
  { key: "practice-exam-insight", label: "AI insight on a practice exam result", hint: "A short coaching note a student can request after finishing a custom practice exam, grounded in that attempt's topic accuracy and their overall weak spots." },
  { key: "lecture-summarize", label: "Summarize lecture notes into key points", hint: "A bullet-point checklist generated from a lecture's notes. Cached and shared by every student once generated — this cost is only charged to whoever triggers a (re)generation." },
  { key: "lecture-attachment-summary", label: "Summarize a lecture's attachments", hint: "A prose summary of what's in a lecture's attached PDFs/Word docs/slides. Same shared-cache, billed-on-trigger model." },
  // Only reaches this cost at all when AiConfig.features.studyPlanFree is
  // off — when it's on, studyPlanController.js calls aiService.generate
  // with student: null, the same admin-triggered-call pattern
  // question_generation/lecture-practice-generate use above, which skips
  // assertWithinCaps' per-student branch entirely (see ai/service.js).
  { key: "study-plan", label: "Generate a 7-day study plan", hint: "A student's own weak-topic data turned into a week of focused practice. Unless \"Free study plans\" is on below." },
  // lecture-practice-generate (lectureController.js's generatePracticeQuestions)
  // is deliberately NOT here — same reason as question_generation/
  // solution_backfill/quality_check/document_generation above: it's
  // admin-triggered with student: null, so it never reaches
  // assertWithinCaps' per-student branch and has no credit cost to define.

  // The archive's own equivalents of practice-explain/practice-similar/
  // practice-exam-grade-written/practice-exam-insight/study-plan — same AI
  // calls, conceptually, but priced separately on purpose: the archive is
  // shared across every batch's own door (batch: null, see
  // archiveController.js's header comment), so its costs shouldn't be tied
  // to whatever a specific batch's own practice features happen to cost.
  // Each is gated by the batch's own archiveAiAssist/archiveStudyPlan/
  // archiveExamInsight toggle (see batchModel.js), same "checked alongside
  // the master switch, not instead of it" pattern the batch-side features
  // already use — see archiveRoutes.js.
  { key: "archive-explain", label: "Archive: explain a mistake", hint: "Why an MCQ or true/false answer was wrong, for a question from the public archive." },
  { key: "practice-hint", label: "Practice: hint before answering", hint: "One of up to three escalating hints on a batch practice question the student hasn't answered yet — never the answer itself." },
  { key: "archive-hint", label: "Archive: hint before answering", hint: "One of up to three escalating hints on an archive question the student hasn't answered yet — never the answer itself." },
  { key: "archive-grade-written", label: "Archive: grade a written practice answer", hint: "AI marks one written answer to an archive question against its rubric." },
  { key: "archive-similar", label: "Archive: generate similar questions", hint: "A fresh set of similar questions from one archive question." },
  { key: "archive-exam-grade-written", label: "Archive: grade a written answer in a practice exam", hint: "Same grading, run automatically per written answer when an archive practice exam is submitted." },
  { key: "archive-exam-insight", label: "Archive: AI insight on a practice exam result", hint: "A short coaching note after finishing an archive practice exam." },
  { key: "doc-chat", label: "Ask the course documents", hint: "One answer in document chat (\"Ask this lecture\" / \"Ask your course\"), found in the batch's lecture notes and files." },
  { key: "pora-dhora", label: "Oral Quiz: one AI teacher turn", hint: "Only charged when Oral Quiz has no free daily questions set; otherwise it's billed per question answered, like course chat." },
  { key: "interview", label: "Interview practice: one interviewer turn", hint: "Only charged when Interview practice has no free daily questions set; otherwise it's billed per question answered, like course chat." },
  { key: "ai-tutor", label: "AI Tutoring: one AI tutor turn", hint: "Only charged when AI Tutoring has no free daily questions set; otherwise it's billed per question answered, like course chat." },
  { key: "archive-study-plan", label: "Archive: generate a study plan", hint: "A student's archive-wide weak-topic data turned into a scheduled plan." },
  // Saved AI results served again (Settings → Performance, when the charge
  // for a saved result is "Reduced"). 0 is allowed: free.
  { key: "practice-similar-saved", label: "Saved similar questions", hint: "A saved set of similar questions served again instead of a new AI call. 0 makes it free.", reuse: true },
  { key: "archive-similar-saved", label: "Archive: saved similar questions", hint: "The same, for an archive question.", reuse: true },
  { key: "practice-hint-saved", label: "Saved hint", hint: "A saved hint served again. 0 makes it free.", reuse: true },
  { key: "archive-hint-saved", label: "Archive: saved hint", hint: "The same, for an archive question.", reuse: true },
  { key: "practice-explain-saved", label: "Saved explanation", hint: "A saved explanation of the same wrong answer served again. 0 makes it free.", reuse: true },
  { key: "archive-explain-saved", label: "Archive: saved explanation", hint: "The same, for an archive question.", reuse: true },
];

const DEFAULT_FEATURE_COSTS = {
  "doubt-solve": 1,
  "doubt-solve-image": 2,
  "practice-explain": 1,
  "practice-qna": 1,
  "student-video": 3,
  "practice-similar": 2,
  "practice-grade-written": 1,
  "practice-exam-grade-written": 1,
  "practice-exam-insight": 1,
  "lecture-summarize": 1,
  "lecture-attachment-summary": 1,
  "doc-chat": 1,
  "pora-dhora": 1,
  "ai-tutor": 1,
  "interview": 1,
  "study-plan": 2,
  "archive-explain": 1,
  "practice-hint": 1,
  "archive-hint": 1,
  "archive-grade-written": 1,
  "archive-similar": 2,
  "archive-exam-grade-written": 1,
  "archive-exam-insight": 1,
  "archive-study-plan": 2,
  "practice-similar-saved": 1,
  "archive-similar-saved": 1,
  "practice-hint-saved": 0,
  "archive-hint-saved": 0,
  "practice-explain-saved": 0,
  "archive-explain-saved": 0,
};

module.exports = { FEATURE_COST_KEYS, DEFAULT_FEATURE_COSTS };
