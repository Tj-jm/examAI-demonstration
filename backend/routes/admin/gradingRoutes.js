const express = require("express");
const router = express.Router();

const {
  getQueue, getForGrading, getAnswerImage, gradeAnswer, gradeWithAi, saveAnnotation,
  claimSubmission, releaseClaim,
  getPendingReferrals, decideReferral, saveReferralNote, reassignAnswer,
  disqualifySubmission, reinstateSubmission,
  getMyGradingStats, listGraders, getGraderStats,
  reopenSubmission, getSubmissionStaff,
} = require("../../controllers/admin/gradingController");
const { protect, allow } = require("../../middleware/adminAuth");
const { uploadImage } = require("../../middleware/upload");

// grader added alongside teacher — the role exists for exactly this one
// route file (restrictedRoleGate.js narrows a grader account to nothing
// else at all). Everything below that isn't further restricted to
// owner/admin is therefore shared by teacher and grader identically.
router.use(protect, allow("owner", "admin", "teacher", "grader"));

// Referral review — admin decides, teacher/grader rechecks if approved.
// Defined before /:id and /graders so Express doesn't catch these as an
// id param on the single-segment GET/PUT routes further down.
router.get("/referrals", allow("owner", "admin"), getPendingReferrals);
router.put("/:id/referral", allow("owner", "admin"), decideReferral);
router.put("/:id/referral-note", saveReferralNote);
router.put("/:id/disqualify", allow("owner", "admin"), disqualifySubmission);
router.put("/:id/reinstate", allow("owner", "admin"), reinstateSubmission);

// Payment-window stats — see doubts/stats/me and doubts/solvers for the
// identical pattern this mirrors. /graders and /graders/:id/stats are
// single/double-segment GETs that would otherwise be swallowed by /:id
// below, so they're declared here with the other pre-/:id routes.
router.get("/stats/me", getMyGradingStats);
router.get("/graders", allow("owner", "admin"), listGraders);
router.get("/graders/:id/stats", allow("owner", "admin"), getGraderStats);

router.get("/", getQueue);
router.get("/:id", getForGrading);
router.get("/:id/answers/:answerId/images/:index", getAnswerImage);
router.post("/:id/claim", require("../../middleware/adminAuth").featureOff("claimScripts"), claimSubmission);
router.post("/:id/reopen", allow("owner", "admin"), reopenSubmission);
router.get("/:id/staff", allow("owner", "admin"), getSubmissionStaff);
router.post("/:id/release", releaseClaim);
router.put("/:id/answers/:answerId", gradeAnswer);
router.put("/:id/answers/:answerId/reassign", allow("owner", "admin"), reassignAnswer);
router.post("/:id/answers/:answerId/ai-grade", gradeWithAi);
router.post("/:id/answers/:answerId/annotation", uploadImage, saveAnnotation);

module.exports = router;
