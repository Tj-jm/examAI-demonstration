const { assertOwnMediaUrl, toAbsoluteUrl } = require("./mediaUrl");

const MAX_ANSWER_IMAGES = 10;

// Photographed working attached to written answers in a practice exam
// (batch or archive), allowed only when the batch has writtenAnswerImages
// on — same toggle and same limits as single-question practice
// (practiceController.js's gradeWrittenAttempt). Returns a Map of
// questionId -> image urls; empty when images are off, so every caller
// treats a disallowed image as simply not there.
const collectAnswerImages = async (req, answers) => {
  const byQuestion = new Map();
  if (!req.batch.features?.writtenAnswerImages) return byQuestion;

  for (const answer of answers) {
    const images = Array.isArray(answer.answerImages) ? answer.answerImages.filter((u) => typeof u === "string" && u) : [];
    if (images.length === 0) continue;
    if (images.length > MAX_ANSWER_IMAGES) {
      const error = new Error(`No more than ${MAX_ANSWER_IMAGES} images per answer.`);
      error.statusCode = 400;
      throw error;
    }
    for (const url of images) await assertOwnMediaUrl(url, req.student._id, "answer image");
    byQuestion.set(String(answer.questionId), images);
  }
  return byQuestion;
};

// The grader sees one image (the vision call takes a single image), so the
// first page is what gets graded — same as single-question practice.
const gradingImageUrl = (req, images) => (images?.length ? toAbsoluteUrl(req, images[0]) : undefined);

module.exports = { collectAnswerImages, gradingImageUrl, MAX_ANSWER_IMAGES };
