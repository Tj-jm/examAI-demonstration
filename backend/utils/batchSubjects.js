// A batch shows its students only questions from the subjects ticked on the
// batch (Batch.subjects): practice, practice exams, weak topics, the study
// plan, the tutor and the archive all filter through here. Nothing ticked
// means nothing shows. Exams and lectures are not filtered: an exam's
// questions are hand-picked, and lectures follow their own assignment.

const subjectIds = (batch) => (batch?.subjects || []).map((s) => s?._id || s);

// Mongo filter on a question's subject.
const subjectScope = (batch) => ({ subject: { $in: subjectIds(batch) } });

// This batch's own questions: assigned to it and in a ticked subject.
// isForPractice false keeps a question to where it was put: an "Ace this
// lecture" question written by AI lives only in its lecture's quiz.
const batchQuestionScope = (batch) => ({ batches: batch._id, isForPractice: { $ne: false }, ...subjectScope(batch) });

const inBatchSubjects = (batch, subjectId) => subjectIds(batch).some((s) => String(s) === String(subjectId?._id || subjectId));

module.exports = { subjectIds, subjectScope, batchQuestionScope, inBatchSubjects };
