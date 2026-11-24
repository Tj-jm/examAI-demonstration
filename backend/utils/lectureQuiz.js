// "Ace this lecture" questions written by AI belong to their lecture's quiz
// only (isForPractice: false, see utils/batchSubjects.js). Ones made before
// that rule were saved as batch practice questions: put back once, at start.
// Only AI questions made from a lecture (aiMeta.sourceRef is that lecture)
// and still in its quiz; bank questions picked into a quiz are left alone.
const markAiLectureQuestions = async () => {
  const Lecture = require("../models/lectureModel");
  const { Question } = require("../models/questionModel");
  const lectures = await Lecture.find({ "practiceQuestionSets.0": { $exists: true } }).select("practiceQuestionSets").lean();
  let changed = 0;
  for (const l of lectures) {
    const ids = l.practiceQuestionSets.flatMap((s) => s.questions || []);
    if (!ids.length) continue;
    const out = await Question.updateMany(
      { _id: { $in: ids }, source: "ai", "aiMeta.sourceRef": String(l._id), isForPractice: { $ne: false } },
      { $set: { isForPractice: false } },
    );
    changed += out.modifiedCount || 0;
  }
  return changed;
};

module.exports = { markAiLectureQuestions };
