const AiConfig = require("../models/aiConfigModel");

// Written answers are meant to be the student's own handwriting. When an
// answer has photos, the AI grader also says what they show (imageSource in
// ai/prompts' PHOTO_READING): handwritten work, printed or typed text, a
// screenshot, or a mix. Anything but handwriting is acted on per
// Settings → AI → Handwriting check:
//   off  — nothing
//   flag — the mark stands, the answer is flagged
//   hold — (exams) flagged, and the AI mark is never applied without a
//          teacher (the grading agent leaves it)
//   zero — the AI mark is 0, and the answer is flagged

const DEFAULTS = { exam: "hold", practice: "flag" };

const handwritingMode = async (where) => {
  const config = await AiConfig.get();
  return config.handwritingCheck?.[where] || DEFAULTS[where];
};

// What the photos were read as, when that isn't handwriting.
const notHandwritten = (data) => (data?.imageSource && data.imageSource !== "handwritten" ? data.imageSource : null);

const SOURCE_TEXT = {
  printed: "printed or typed text",
  screenshot: "a screenshot",
  mixed: "partly printed or copied material",
};

// Practice: the marks after the policy, and a line for the student.
const practiceHandwriting = (data, marks, mode) => {
  const source = mode === "off" ? null : notHandwritten(data);
  if (!source) return { marks, note: null, source: null };
  const zero = mode === "zero";
  return {
    marks: zero ? 0 : marks,
    source,
    note: `Your photo looks like ${SOURCE_TEXT[source] || "copied material"}, not your own handwriting${zero ? ", so it earned no marks" : ""}. Write the answer yourself.`,
  };
};

// Practice feedback with the handwriting note in front.
const withNote = (feedback, note) => (note ? `${note}\n\n${feedback || ""}`.trim() : feedback);

module.exports = { handwritingMode, notHandwritten, practiceHandwriting, withNote, SOURCE_TEXT };
