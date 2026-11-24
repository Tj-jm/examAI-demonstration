const express = require("express");
const router = express.Router({ mergeParams: true });

const {
  getExams,
  getExam,
  createExam,
  updateExam,
  setQuestions,
  addQuestions,
  smartPickQuestions,
  removeQuestion,
  setPublished,
  setActive,
  duplicateExam,
  deleteExam,
} = require("../../controllers/admin/examController");

const { protect, allow } = require("../../middleware/adminAuth");

router.use(protect);

router
  .route("/")
  .get(getExams)
  .post(createExam);

router
  .route("/:id")
  .get(getExam)
  .put(updateExam)
  // Owner + admin only — the same pairing every other destructive action in
  // this app uses (deleting a staff user, changing payment credentials).
  // Everything else on this router is still reachable by any authenticated
  // staff, including teacher and doubtSolver, exactly as before; this is
  // the one action being tightened, not a general role rework.
  .delete(allow("owner", "admin"), deleteExam);

router
  .route("/:id/questions")
  .put(setQuestions)
  .post(addQuestions);

router.delete("/:id/questions/:questionId", removeQuestion);
router.post("/:id/smart-pick", smartPickQuestions);

router.put("/:id/publish", setPublished);
router.put("/:id/active", setActive);
router.post("/:id/duplicate", duplicateExam);

module.exports = router;
