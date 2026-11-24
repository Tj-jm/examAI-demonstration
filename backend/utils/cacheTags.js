// The one naming scheme for cache tags (utils/cache.js). A read files its
// entry under what it was built from; a write touches what it changed. Kept
// in one place so a reader and a writer can't spell the same thing two ways.

const id = (v) => String(v?._id || v);

module.exports = {
  // Anything about which batches exist, their order, prices, images.
  BATCHES: "batches",
  batch: (batchId) => `batch:${id(batchId)}`,
  // Question bank: publishing, filing, batches, archive boards/years.
  QUESTIONS: "questions",
  ARCHIVE: "archive",
  // Subjects, chapters, topics: titles and order.
  TAXONOMY: "taxonomy",
  EXAMS: "exams",
  LECTURES: "lectures",
  NOTICES: "notices",
  LANDING: "landing",
  // One student's purchases/trials: what they can open. ACCESS is every
  // student's, for a write that doesn't say whose it is.
  ACCESS: "access",
  access: (studentId) => `access:${id(studentId)}`,
};

// Purchase/Trial writes: the student's own tag when the write names them,
// else everyone's.
module.exports.studentAccessTags = ({ doc, docs, filter, single }) => {
  const students = [doc?.student, ...(docs || []).map((d) => d?.student), filter && single(filter.student)].filter(Boolean);
  return students.length ? students.map(module.exports.access) : [module.exports.ACCESS];
};
