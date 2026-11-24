const express = require("express");
const router = express.Router();

const {
  getQueue, getDoubt, resolveDoubt, deleteDoubt, uploadAnswerImage,
  getMySolvedDoubts, getMyStats, listDoubtSolvers, getSolverStats,
  getReviewRequests, decideReview,
} = require("../../controllers/admin/doubtController");
const { protect, allow } = require("../../middleware/adminAuth");
const { uploadImage } = require("../../middleware/upload");

router.use(protect, allow("owner", "admin", "doubtSolver", "teacher"));

// Specific literal paths declared before /:id, so Express matches them
// first rather than trying to parse "mine", "solvers", "reviews" or
// "upload-image" as an id — the same ordering rule as
// representativeRoutes.js's /me/coupons.
router.get("/mine", getMySolvedDoubts);
router.get("/stats/me", getMyStats);
router.post("/upload-image", uploadImage, uploadAnswerImage);

// Everything below this line is owner/admin oversight — a doubt-solver can
// see their own history and stats above, but not anyone else's, not the
// solver directory, and not the review-approval queue. Reviewing a
// doubt-solver's own work is deliberately not something a doubt-solver
// (including the one who wrote the original answer) can do.
router.get("/solvers", allow("owner", "admin"), listDoubtSolvers);
router.get("/solvers/:id/stats", allow("owner", "admin"), getSolverStats);
router.get("/reviews", allow("owner", "admin"), getReviewRequests);
router.put("/:id/review", allow("owner", "admin"), decideReview);

router.get("/", getQueue);
router.get("/:id", getDoubt);
router.put("/:id/resolve", require("../../middleware/adminAuth").featureOff("doubts"), resolveDoubt);
router.delete("/:id", allow("owner", "admin"), deleteDoubt);

module.exports = router;
