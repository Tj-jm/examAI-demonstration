const Exam = require("../models/examModel");

// A student's own practice paper no longer creates an Exam document at all
// (see practiceExamController.js) — but that only holds for anything built
// after this shipped. Any exam created the old way, before this change,
// still has createdByStudent set and still sits in the same collection
// every admin query here reads from.
//
// Everywhere the admin panel lists, counts, or otherwise surfaces exams —
// the exam list, the grading queue, submission oversight, a batch's own
// exam count, whether a question is safe to delete — needs to agree that
// these do not exist. One helper rather than five inline queries, so that
// agreement can't quietly drift as new admin screens get added.
//
// Submission has no createdByStudent of its own, which is why every caller
// filtering submissions does it by excluding the exam ids this returns
// (`exam: { $nin: await studentExamIds() }`) rather than filtering
// Submission directly.
const studentExamIds = () => Exam.distinct("_id", { createdByStudent: { $ne: null } });

module.exports = { studentExamIds };
