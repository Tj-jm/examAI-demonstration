const express = require("express");
const router = express.Router();

const { getBatches, getBatch, startTrial, getDashboard, locateItem } = require("../../controllers/app/batchController");
const { getBatchNotices } = require("../../controllers/app/noticeController");
const { getLeaderboard } = require("../../controllers/app/leaderboardController");
const { getAiUsage } = require("../../controllers/app/aiUsageController");
const { getProgress } = require("../../controllers/app/progressController");
const { studentProtect } = require("../../middleware/studentAuth");
const { batchAccess, requireFeature } = require("../../middleware/batchAccess");

router.use(studentProtect);

router.get("/dashboard", getDashboard);
router.get("/", getBatches);
router.get("/locate/:kind/:id", locateItem);
router.post("/:batchId/trial", require("../../middleware/salesOpen").salesOpen, startTrial);
router.get("/:batchId", batchAccess, getBatch);

// Not behind requireFeature, unlike every route group below it — a notice
// board isn't a toggleable capability the way AI or doubt-solving are, it's
// closer to the batch's own existence: any batch a student can already
// reach can also have something posted to it.
router.get("/:batchId/notices", batchAccess, getBatchNotices);

// Also not behind one specific requireFeature: this backs a meter shown on
// both the practice pages (gated by "practice"+"aiAssist") and the doubt
// pages (gated by "doubtSolving") — it reports on the one shared daily cap
// and credit pools behind both, so it can't sensibly sit behind either
// feature alone.
router.get("/:batchId/ai-usage", batchAccess, getAiUsage);

// Behind requireFeature("exams") specifically, not its own toggle — a
// leaderboard with zero graded exams is meaningless, so it makes no sense
// to offer one on a batch where exams aren't even switched on.
router.get("/:batchId/leaderboard", batchAccess, requireFeature("exams"), getLeaderboard);

// No feature switch of its own: it reads what the batch's practice, exams
// and lectures already produced, and hides whatever the batch doesn't use.
router.get("/:batchId/progress", batchAccess, getProgress);

router.use(
  "/:batchId/lectures",
  batchAccess,
  requireFeature("lectures"),
  require("./lectureRoutes")
);

router.use(
  "/:batchId/exams",
  batchAccess,
  requireFeature("exams"),
  require("./examRoutes")
);

router.use(
  "/:batchId/slides",
  batchAccess,
  requireFeature("lectureSlides"),
  require("./slideRoutes")
);

router.use(
  "/:batchId/coding",
  batchAccess,
  requireFeature("codingPractice"),
  require("./codingRoutes")
);

router.use(
  "/:batchId/practice",
  batchAccess,
  requireFeature("practice"),
  require("./practiceRoutes")
);

router.use(
  "/:batchId/practice-exams",
  batchAccess,
  requireFeature("practice"),
  require("./practiceExamRoutes")
);

router.use(
  "/:batchId/doubts",
  batchAccess,
  requireFeature("doubtSolving"),
  require("./doubtRoutes")
);

router.use(
  "/:batchId/grades",
  batchAccess,
  require("./gradesRoutes")
);

router.use(
  "/:batchId/assignments",
  batchAccess,
  requireFeature("assignments"),
  require("./courseworkRoutes")
);

router.use(
  "/:batchId/live-classes",
  batchAccess,
  requireFeature("liveClasses"),
  require("./liveClassRoutes")
);

router.use(
  "/:batchId/tutor",
  batchAccess,
  requireFeature("agentTutor"),
  require("./tutorRoutes")
);

router.use(
  "/:batchId/study-plan",
  batchAccess,
  requireFeature("studyPlan"),
  require("./studyPlanRoutes")
);

// Document chat — an AI feature, so checked alongside aiAssist, not
// instead of it (same as studyPlan above).
router.use(
  "/:batchId/chat",
  batchAccess,
  requireFeature("aiAssist"),
  requireFeature("docChat"),
  require("./docChatRoutes")
);

// Short AI videos a student asks for (studentVideoController.js) — an AI
// feature, so checked alongside aiAssist, like docChat above.
router.use(
  "/:batchId/videos",
  batchAccess,
  requireFeature("aiAssist"),
  requireFeature("studentVideos"),
  require("./studentVideoRoutes")
);

// Oral Quiz (poraController.js) — an AI feature, checked alongside aiAssist.
router.use(
  "/:batchId/pora",
  batchAccess,
  requireFeature("aiAssist"),
  requireFeature("poraDhora"),
  require("./poraRoutes")
);

// AI Tutoring (aiTutorController.js) — an AI feature, checked alongside aiAssist.
router.use(
  "/:batchId/tutoring",
  batchAccess,
  requireFeature("aiAssist"),
  requireFeature("aiTutor"),
  require("./aiTutorRoutes")
);

// Interview practice (interviewController.js) — an AI feature, checked alongside aiAssist.
router.use(
  "/:batchId/interview",
  batchAccess,
  requireFeature("aiAssist"),
  requireFeature("interview"),
  require("./interviewRoutes")
);

// Not requireFeature — see archiveRoutes.js's own gate: which boards/
// exams/books a batch presents IS the on/off switch, there's no separate
// boolean alongside it.
router.use(
  "/:batchId/archive",
  batchAccess,
  require("./archiveRoutes")
);

module.exports = router;
