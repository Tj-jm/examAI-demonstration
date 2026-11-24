const express = require("express");
const router = express.Router({ mergeParams: true });

const { getTopics, getPracticeQuestions, submitPracticeAttempt, explainAttempt, getHint, getQna, askQna, gradeWrittenAttempt, uploadPracticeAnswerImage, getWeakTopics, getPersonalizedQuestions, getSimilarQuestions, toggleFavorite, getFavoriteIds, getFavoriteQuestions } = require("../../controllers/app/practiceController");
const { getLearnTopics, getLearnCards, rateLearnCard } = require("../../controllers/app/learnController");
const { requireFeature } = require("../../middleware/batchAccess");
const { aiLimiter } = require("../../middleware/rateLimit");
const { uploadImage } = require("../../middleware/upload");

// Mounted under /api/app/batches/:batchId/practice by batchRoutes, behind
// studentProtect + batchAccess + requireFeature("practice") already applied
// there.

router.get("/topics", getTopics);
router.get("/weak-topics", getWeakTopics);
router.get("/personalized", getPersonalizedQuestions);
router.get("/favorites/ids", getFavoriteIds);
router.get("/favorites", getFavoriteQuestions);
router.post("/favorites/:questionId", toggleFavorite);
router.get("/questions", getPracticeQuestions);
router.post("/attempt", submitPracticeAttempt);
// A second gate on top of the practice one above — a batch can have
// practice on and AI assistance off, which is the expected default
// (aiAssist starts false on every batch).
router.post("/explain", requireFeature("aiAssist"), explainAttempt);
router.post("/hint", requireFeature("aiAssist"), getHint);
router.post("/grade-written", requireFeature("aiAssist"), gradeWrittenAttempt);
// Not gated behind aiAssist — attaching an image is just storage, not an
// AI call. Its own feature check (writtenAnswerImages) lives inside the
// controller, same as submissionController's exam-side equivalent.
router.post("/upload-answer-image", uploadImage, uploadPracticeAnswerImage);
router.post("/similar", requireFeature("aiAssist"), getSimilarQuestions);
// Follow-up questions on an answered question's solution: AI help plus the
// batch's own switch for it (and Settings → AI, checked in the controller).
router.get("/qna/:questionId", requireFeature("aiAssist"), requireFeature("practiceQna"), getQna);
router.post("/qna/:questionId", requireFeature("aiAssist"), requireFeature("practiceQna"), aiLimiter, askQna);
// Learn mode: study cards for written questions (no AI).
router.get("/learn/topics", getLearnTopics);
router.get("/learn/cards/:scope", getLearnCards);
router.post("/learn/cards/:questionId/rate", rateLearnCard);

module.exports = router;
