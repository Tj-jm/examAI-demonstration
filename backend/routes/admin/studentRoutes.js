const express = require("express");
const router = express.Router({ mergeParams: true });

const {
  getStudents,
  getStudent,
  createStudent,
  updateStudent,
  resetStudentPassword,
  deleteStudent,
  enrolStudent,
  recordPurchase, importStudentRows, assignStudentIds, getStudentPora, getStudentTutor, getStudentInterview,
} = require("../../controllers/admin/studentController");

const { protect, allow } = require("../../middleware/adminAuth");

router.use(protect);

router.post("/import", allow("owner", "admin"), importStudentRows);
router.post("/assign-ids", allow("owner", "admin"), assignStudentIds);

// A student who deleted their own account is a record, not an account:
// nothing can be edited, granted, paid for or wiped from it (the payments
// kept under it are accounting records).
const Student = require("../../models/studentModel");
const notDeleted = async (req, res, next) => {
  try {
    const student = await Student.findById(req.params.id).select("deletedAt").lean();
    if (student?.deletedAt) {
      res.status(409);
      return next(new Error("This student deleted their account — it can't be changed."));
    }
    return next();
  } catch (error) {
    return next(error);
  }
};

router
  .route("/")
  .get(getStudents)
  .post(allow("owner", "admin"), createStudent);

router
  .route("/:id")
  .get(getStudent)
  .put(allow("owner", "admin"), notDeleted, updateStudent)
  .delete(allow("owner", "admin"), notDeleted, deleteStudent);

router.get("/:id/pora", getStudentPora);
router.get("/:id/tutor", getStudentTutor);
router.get("/:id/interview", getStudentInterview);

router.put("/:id/password", allow("owner", "admin"), notDeleted, resetStudentPassword);

// Enrolment is free access. Recording a purchase is money. Both are separate
// from creating the account. Reads (list/detail) stay open to any staff —
// teachers/graders need them for search and lookup (Submissions.jsx,
// StudentDetail.jsx) — only the writes are owner/admin only.
router.post("/:id/enrol", allow("owner", "admin"), notDeleted, enrolStudent);
router.post("/:id/purchases", allow("owner", "admin"), notDeleted, recordPurchase);

module.exports = router;
