// A question document holds the answer key right alongside everything a
const { questionText, fullQuestionText } = require("./questionText");
// student is allowed to see, because that is the natural shape for writing
// and grading one. Two different callers need two different redactions of
// it, and getting either wrong leaks either an answer or a grading rubric —
// so both live in one place rather than being re-derived ad hoc wherever a
// question gets sent to a student.

const { shape: shapeMedia } = require("../controllers/admin/mediaController");

// A Media ref only carries a `url` once it has been through shapeMedia (the
// url is computed from storage.urlFor / video.resolve, never stored on the
// document itself) — every media field below goes through this rather than
// being passed along as the bare populated (or worse, unpopulated) doc.
const shapeField = async (val) => (val ? shapeMedia(val) : null);

// `.populate("questions")` on the parent Exam/Submission only dereferences
// the question refs themselves — it does not reach into each question's own
// questionImage/options[].image refs. Rather than require every call site to
// remember the right nested-populate shape, each question populates its own
// media refs on demand here; Mongoose no-ops a ref that's already populated,
// so this is safe to call regardless of what the caller already did.
const populateMedia = async (question, { includeSolution } = {}) => {
  const paths = [{ path: "questionImage" }];
  if (question.type === "mcq") paths.push({ path: "options.image" });
  if (question.type === "passage") {
    paths.push({ path: "subQuestions.questionImage" }, { path: "subQuestions.options.image" });
  }
  if (includeSolution && (question.solutionImage || question.solutionVideo || question.solutionPdf)) {
    paths.push({ path: "solutionImage" }, { path: "solutionVideo" }, { path: "solutionPdf" });
  }
  if (includeSolution && question.solutionAttachments?.length) {
    paths.push({ path: "solutionAttachments" });
  }
  await question.populate(paths);
};

// Shared by forReview/practice's own review shape below — any number of
// files, any Media kind, the same general attachment list lectures already
// show students (see LectureView.jsx), rather than the three older
// single-file fields' one-of-each-kind limit.
const shapeSolutionAttachments = (attachments) => Promise.all((attachments || []).map(shapeMedia));

// Shared by forTaking/forReview below — a sub-question's own media resolved
// the same way shapeField handles a top-level questionImage/option image,
// just applied once per entry in subQuestions. `includeAnswer` mirrors the
// forTaking/forReview split one level down: strip correctOption while a
// student is taking the exam, keep it once they're reviewing a graded one.
const shapeSubQuestions = async (subQuestions, { includeAnswer }) =>
  Promise.all(
    (subQuestions || []).map(async (sq) => ({
      type: sq.type || "mcq",
      label: sq.label || "",
      question: sq.question,
      questionImage: await shapeField(sq.questionImage),
      marks: sq.marks,
      negativeMarks: sq.negativeMarks,
      options: await Promise.all(
        (sq.options || []).map(async (o) => ({ key: o.key, text: o.text, image: await shapeField(o.image) }))
      ),
      ...(includeAnswer ? { correctOption: sq.correctOption } : {}),
    }))
  );

// While an exam is being taken: everything needed to answer, nothing that
// reveals or hints at the answer.
const forTaking = async (question) => {
  await populateMedia(question);
  const q = question.toObject ? question.toObject() : question;

  const base = {
    _id: q._id,
    type: q.type,
    question: questionText(q),
    questionImage: await shapeField(q.questionImage),
    marks: q.marks,
    negativeMarks: q.negativeMarks,
    difficulty: q.difficulty,
  };

  if (q.type === "mcq") {
    return {
      ...base,
      options: await Promise.all(
        (q.options || []).map(async (o) => ({ key: o.key, text: o.text, image: await shapeField(o.image) }))
      ),
    };
  }

  if (q.type === "mtf") {
    return {
      ...base,
      statements: (q.statements || []).map((s) => ({ text: s.text })),
    };
  }

  if (q.type === "passage") {
    return { ...base, subQuestions: await shapeSubQuestions(q.subQuestions, { includeAnswer: false }) };
  }

  // Hidden tests stay on the server: only how many there are.
  if (q.type === "coding") {
    return {
      ...base, languages: q.languages, starterCode: q.starterCode, timeLimitMs: q.timeLimitMs,
      tests: (q.tests || []).filter((t) => !t.hidden).map((t) => ({ input: t.input, output: t.output })),
      hiddenTests: (q.tests || []).filter((t) => t.hidden).length,
    };
  }

  // written
  return { ...base, wordLimit: q.wordLimit };
};

// After grading: the answer key and the solution, for review. Never handed
// out before a submission's status is "graded" — the caller is responsible
// for that check, this function only knows how to shape one question.
const forReview = async (question) => {
  await populateMedia(question, { includeSolution: true });
  const q = question.toObject ? question.toObject() : question;

  const base = {
    _id: q._id,
    type: q.type,
    question: questionText(q),
    questionImage: await shapeField(q.questionImage),
    marks: q.marks,
    negativeMarks: q.negativeMarks,
    solutionText: q.solutionText,
    solutionImage: await shapeField(q.solutionImage),
    solutionVideo: await shapeField(q.solutionVideo),
    solutionPdf: await shapeField(q.solutionPdf),
    solutionAttachments: await shapeSolutionAttachments(q.solutionAttachments),
  };

  if (q.type === "mcq") {
    return {
      ...base,
      options: await Promise.all(
        (q.options || []).map(async (o) => ({ ...o, image: await shapeField(o.image) }))
      ),
      correctOption: q.correctOption,
    };
  }

  if (q.type === "mtf") {
    return {
      ...base,
      statements: q.statements,
    };
  }

  if (q.type === "passage") {
    return { ...base, subQuestions: await shapeSubQuestions(q.subQuestions, { includeAnswer: true }) };
  }

  if (q.type === "coding") {
    return { ...base, languages: q.languages, starterCode: q.starterCode, tests: q.tests };
  }

  return {
    ...base,
    rubric: q.rubric,
    modelAnswer: q.modelAnswer,
    wordLimit: q.wordLimit,
  };
};

// populateMedia/shapeField are also exported for callers that need the full,
// un-redacted question (everything forTaking/forReview strip out — topic,
// subject, chapter, tags, createdAt, …) with just its media refs resolved to
// real urls, rather than one of the two purpose-built shapes above. The
// admin batch-assignment picker is exactly this case: it needs the whole
// lean-ish object plus working image urls, not a student-safe or
// review-safe redaction of it.
// A passage's written question, for review: the passage's own review shape
// with the part's text, marks and model answer (utils/passageParts.js).
const partForReview = async (question, subIndex) => {
  const { partOf } = require("./passageParts");
  const part = partOf(question, subIndex);
  const base = await forReview(question);
  return {
    ...base,
    type: "written",
    subIndex,
    question: part.question,
    partLabel: part.partLabel,
    partQuestion: part.partQuestion,
    marks: part.marks,
    rubric: part.rubric,
    modelAnswer: part.modelAnswer,
    subQuestions: undefined,
    // The part's own solution, as practice shows it, rather than the
    // passage's whole one; that only when the part has none.
    ...(part.modelAnswer?.trim() && {
      solutionText: part.modelAnswer,
      solutionImage: undefined,
      solutionVideo: undefined,
      solutionPdf: undefined,
      solutionAttachments: [],
    }),
  };
};

module.exports = { forTaking, forReview, populateMedia, shapeField, partForReview };
