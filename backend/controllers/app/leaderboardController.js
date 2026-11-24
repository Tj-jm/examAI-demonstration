const asyncHandler = require("express-async-handler");
const Student = require("../../models/studentModel");
const leaderboard = require("../../utils/leaderboard");

// Ranked on average percentage across a student's best attempt on each
// graded exam in this batch — not total marks summed. With no minimum exam
// count (a student can appear after just one), total marks would make exam
// count and exam size the deciding factor rather than how well someone
// actually did: a single 100-mark final would tower over three genuinely
// strong 20-mark quizzes for no reason related to performance. Percentage
// is the metric that still means the same thing whether a student has
// taken one exam or twenty.
//
// "Best attempt" rather than "first" or "average of attempts" — a retake
// exists to let a student show they've improved, and punishing that by
// averaging in an early bad attempt would make retaking strictly worse for
// their rank than never having tried again at all.
//
// Student-created practice exams are excluded the same way the admin panel
// already excludes them everywhere else (see excludeStudentExams.js) — a
// leaderboard has to be the same paper for everyone to mean anything, and a
// self-built practice exam is whatever topics and difficulty that one
// student chose for themselves.
//
// The rows come from utils/leaderboard.js: the same query as always, or on
// Pro a board kept current as submissions are graded (Settings →
// Performance).
const getLeaderboard = asyncHandler(async (req, res) => {
  const board = await leaderboard.read(req.batch._id, req.student._id);

  const students = await Student.find({ _id: { $in: board.top.map((r) => r._id) } }).select("name");
  const nameById = new Map(students.map((s) => [String(s._id), s.name]));

  const top10 = board.top.map((r) => ({
    rank: r.rank,
    studentId: r._id,
    name: nameById.get(String(r._id)) || "Student",
    avgPercent: Math.round(r.avgPercent * 10) / 10,
    examsCount: r.examsCount,
    isMe: String(r._id) === String(req.student._id),
  }));

  // The requesting student's own standing, found regardless of where it
  // falls — this is the whole reason "top 10" isn't the entire response.
  // null (not zero, not an empty object) specifically means "no graded
  // exams yet", which the frontend needs to tell apart from "ranked last".
  const mine = board.me;
  const me = mine
    ? {
        rank: mine.rank,
        avgPercent: Math.round(mine.avgPercent * 10) / 10,
        examsCount: mine.examsCount,
        inTopTen: mine.rank <= 10,
      }
    : null;

  res.status(200).json({ top10, me, totalRanked: board.total });
});

module.exports = { getLeaderboard };
