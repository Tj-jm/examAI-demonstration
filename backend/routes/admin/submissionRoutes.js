const express = require("express");
const router = express.Router();

const { getSubmissions, getSubmission, deleteSubmission } = require("../../controllers/admin/submissionsController");
const { protect, allow } = require("../../middleware/adminAuth");

router.use(protect);

router.get("/", getSubmissions);
router.get("/:id", getSubmission);
// Owner/admin only — see deleteSubmission's own comment for why this is
// gated tighter than the reads above, which teacher/grader also use.
router.delete("/:id", allow("owner", "admin"), deleteSubmission);

module.exports = router;
