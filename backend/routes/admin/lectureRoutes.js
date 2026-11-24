const express = require("express");
const router = express.Router({ mergeParams: true });

const {
  getLectures,
  getLecture,
  getLectureStats,
  getLectureOrder,
  createLecture,
  updateLecture,
  deleteLecture,
  reorderLectures,
  setPublished,
  setPracticeQuestions,
  generatePracticeQuestions,
  suggestDescription,
  reindexLecture,
  readLectureScans,
} = require("../../controllers/admin/lectureController");

const { protect } = require("../../middleware/adminAuth");
const { aiLimiter } = require("../../middleware/rateLimit");

router.use(protect);

// Declared before /:id so "order", "reorder", "publish" and
// "description/suggest" are not read as ids.
router.get("/order", getLectureOrder);
router.put("/reorder", reorderLectures);
router.put("/publish", setPublished);
router.post("/description/suggest", aiLimiter, suggestDescription);

router
  .route("/")
  .get(getLectures)
  .post(createLecture);

router
  .route("/:id")
  .get(getLecture)
  .put(updateLecture)
  .delete(deleteLecture);

router.get("/:id/stats", getLectureStats);
router.put("/:id/practice-questions", setPracticeQuestions);
router.post("/:id/doc-index", reindexLecture);
router.post("/:id/doc-index/read-scans", aiLimiter, readLectureScans);
router.post("/:id/practice-questions/generate", generatePracticeQuestions);

module.exports = router;
