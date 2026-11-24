const express = require("express");
const router = express.Router();

const { getQuestionLesson, getLectureLesson } = require("../../controllers/app/videoLessonController");
const { studentProtect } = require("../../middleware/studentAuth");

router.use(studentProtect);
router.get("/question/:id", getQuestionLesson);
router.get("/lecture/:id", getLectureLesson);

module.exports = router;
