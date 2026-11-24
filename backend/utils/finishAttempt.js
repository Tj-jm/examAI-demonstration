const Submission = require("../models/submissionModel");
const Exam = require("../models/examModel");
const { notify } = require("./notify");
const autosave = require("./autosave");
const { scheduleExamPerformanceReport } = require("./examReport");
const { sendResultMessage } = require("./progressReports");

// Submitting and timing out end the same way: whatever answers were saved
// get scored. A timed-out attempt is closed the next time anyone looks at it
// (the student opening the exam, a result or their results list, staff
// opening the results). A sweeper also closes them every minute
// (utils/autosave.js), so results appear without anyone looking.

// The last moment an answer counts: the timer, plus the script-upload grace
// window when the attempt has a written question, plus the network buffer.
const attemptDeadline = (submission, exam) => {
  const hasWritten = submission.answers.some((a) => a.questionType === "written");
  const graceMs = hasWritten ? (exam.scriptGraceMinutes || 0) * 60000 : 0;
  return submission.startedAt.getTime() + exam.durationMinutes * 60000 + graceMs + (exam.bufferSeconds || 0) * 1000;
};

// Flags that mean the student was away from the exam: a tab switch, or
// leaving the exam page inside the app.
const AWAY_TYPES = ["tab-hidden", "left-exam", "window-blur"];

// Which flag each Conduct "watch" switch covers.
const WATCH_OF = { "tab-hidden": "tabSwitch", "window-blur": "leftWindow", "answer-paste": "paste", "left-exam": "leftPage" };
const examWatch = async () => {
  const w = (await require("../models/appSettingsModel").get()).conduct?.watch || {};
  return Object.fromEntries(["tabSwitch", "leftWindow", "paste", "leftPage"].map((k) => [k, w[k] !== false]));
};

const withQuestions = async (exam, examId) =>
  exam && exam.populated?.("questions") ? exam : Exam.findById(examId || exam?._id).populate("questions");

// Scores an in_progress attempt with its saved answers. `at` is when it
// counts as handed in. Returns false when something else (the student's own
// submit, a second look a moment earlier) already closed it — the status
// flip is claimed atomically, so the paper is only ever scored once.
const finishAttempt = async (submission, exam, { at = new Date(), awayEnd } = {}) => {
  const claimed = await Submission.updateOne(
    { _id: submission._id, status: "in_progress" },
    { $set: { status: "submitted" } }
  );
  if (!claimed.modifiedCount) return false;
  // Answers still held in Redis (Pro, buffered autosave) count too.
  await autosave.settle(submission);
  await autosave.closed(submission._id);

  exam = await withQuestions(exam, submission.exam);
  const questionMap = new Map(exam.questions.map((q) => [String(q._id), q]));
  submission.status = "submitted";
  await require("./codeRunner").judgeAnswers(submission.answers, questionMap);
  submission.scoreObjective(questionMap);
  submission.totalMarks = exam.totalMarks();
  submission.submittedAt = at;
  submission.totalTimeMs = at.getTime() - submission.startedAt.getTime();
  if (awayEnd) submission.awayEnd = awayEnd;
  submission.finalizeIfComplete();
  await submission.save();

  if (submission.status === "graded") {
    await notify(submission.student, "examGraded", {
      title: "Your exam has been graded",
      body: exam.title,
      link: `/submissions/${submission._id}`,
    }).catch(() => {});
    // Never blocks — see generateExamPerformanceReport's own try/catch.
    await scheduleExamPerformanceReport(submission._id);
    // The SMS/email to student and guardian, when the batch has it on. Not
    // awaited: a slow gateway must not hold up the result.
    sendResultMessage(submission._id);
  }
  return true;
};

// The exam's away limit, broken: the first time the student was away (tab
// switched, page left) longer than the limit in one go. Gives when the
// attempt ends (the moment they left plus the limit) and how long they were
// away — so far, when they haven't come back. Null when the limit is off or
// was kept.
const awayBreach = (submission, exam, now = Date.now()) => {
  if (!["submit", "abandon"].includes(exam.awayMode)) return null;
  const limitMs = (exam.awayMinutes || 5) * 60000;
  for (const v of submission.violations || []) {
    if (!AWAY_TYPES.includes(v.type)) continue;
    const left = new Date(v.at).getTime();
    const awayMs = (v.backAt ? new Date(v.backAt).getTime() : now) - left;
    if (awayMs > limitMs) {
      return {
        at: new Date(left + limitMs),
        awayEnd: { mode: exam.awayMode, awayMs, limitMinutes: exam.awayMinutes || 5, back: Boolean(v.backAt) },
      };
    }
  }
  return null;
};

// Ends an attempt with zero: the away limit set to "abandon".
const abandonAttempt = async (submission, { at, awayEnd }) => {
  const claimed = await Submission.updateOne(
    { _id: submission._id, status: "in_progress" },
    { $set: { status: "abandoned", submittedAt: at, totalTimeMs: at.getTime() - submission.startedAt.getTime(), awayEnd } }
  );
  if (!claimed.modifiedCount) return false;
  Object.assign(submission, { status: "abandoned", submittedAt: at, awayEnd });
  return true;
};

// Closes one attempt if its time is up, or its away limit was broken.
// Returns false when it stays open, "timeout" or "away" when it closed here.
const closeIfOverdue = async (submission, exam) => {
  if (submission.status !== "in_progress") return false;
  exam = await withQuestions(exam, submission.exam);
  if (!exam) return false;
  const deadline = attemptDeadline(submission, exam);
  const now = Date.now();
  const breach = awayBreach(submission, exam, Math.min(now, deadline));
  if (breach && breach.at.getTime() < deadline) {
    const done = breach.awayEnd.mode === "abandon"
      ? await abandonAttempt(submission, breach)
      : await finishAttempt(submission, exam, breach);
    if (done) await require("./conduct").recordExamViolation(submission).catch(() => {});
    return done && "away";
  }
  if (now <= deadline) return false;
  return (await finishAttempt(submission, exam, { at: new Date(deadline) })) && "timeout";
};

// Every overdue attempt matching a filter (always narrowed to in_progress).
// Called just before a list is read, so the list shows them graded.
const closeOverdue = async (filter) => {
  const open = await Submission.find({ ...filter, status: "in_progress" }).limit(200);
  const exams = new Map();
  for (const submission of open) {
    const key = String(submission.exam);
    if (!exams.has(key)) exams.set(key, await Exam.findById(submission.exam).populate("questions"));
    await closeIfOverdue(submission, exams.get(key)).catch(() => {});
  }
};

// Closes every "away" flag still open (tab switched, exam page left) with
// the moment the student came back. True when anything changed.
const markBack = (submission, at = new Date()) => {
  let changed = false;
  for (const v of submission.violations || []) {
    if (AWAY_TYPES.includes(v.type) && !v.backAt) {
      v.backAt = at;
      changed = true;
    }
  }
  return changed;
};

// What the student is told when the away limit ended an attempt.
const awayMessage = (awayEnd) => awayEnd.mode === "abandon"
  ? `This attempt was ended because you were away from the exam for more than ${awayEnd.limitMinutes} minute${awayEnd.limitMinutes === 1 ? "" : "s"}. It scores zero.`
  : `This attempt was submitted because you were away from the exam for more than ${awayEnd.limitMinutes} minute${awayEnd.limitMinutes === 1 ? "" : "s"}. Answers saved before then were marked.`;

module.exports = { WATCH_OF, examWatch, attemptDeadline, finishAttempt, closeIfOverdue, closeOverdue, markBack, awayBreach, awayMessage, AWAY_TYPES };
