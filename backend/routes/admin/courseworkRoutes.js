const express = require("express");
const router = express.Router({ mergeParams: true });
const { protect, allow } = require("../../middleware/adminAuth");
const { uploadImage } = require("../../middleware/upload");
const c = require("../../controllers/admin/courseworkController");

// Mounted at /api/grading/assignments: under /api/grading so the grader
// and teacher accounts (narrowed by representativeGate) can reach it.
// Setting work is refused to graders in the controller.
router.use(protect, allow("owner", "admin", "teacher", "grader"));

router.route("/").get(c.listAssignments).post(c.createAssignment);
router.post("/upload", uploadImage, c.uploadAttachment);
router.route("/submissions/:subId").get(c.getSubmission).put(c.gradeSubmission);
// AI checking (Standard and up): controllers/admin/courseworkAiController.js.
try { router.post("/submissions/:subId/ai-check", require("../../controllers/admin/courseworkAiController").aiCheck); } catch { /* not in this edition */ }
router.route("/:id").get(c.getAssignment).put(c.updateAssignment).delete(c.deleteAssignment);
router.get("/:id/submissions", c.listSubmissions);
router.post("/:id/return-all", c.returnAll);

module.exports = router;
