const express = require("express");
const router = express.Router();

const { getSummary, getSources, getTrend, getTransactions, getOptions, getTeamSellers, getTeamDoubtSolvers } = require("../../controllers/admin/earningsController");
const { exportEarnings } = require("../../controllers/admin/earningsExportController");
const { protect, allow } = require("../../middleware/adminAuth");

// Owner and admin only, nothing else — actual revenue figures are more
// sensitive than most of what a teacher or doubt-solver's role already
// reaches, so this follows the tighter pairing (matches deleting a staff
// user and changing payment credentials) rather than the looser
// "any authenticated staff" default most content routes use.
router.use(protect, allow("owner", "admin"));

router.get("/summary", getSummary);
router.get("/sources", getSources);
router.get("/trend", getTrend);
router.get("/transactions", getTransactions);
router.get("/options", getOptions);
router.get("/export", exportEarnings);
router.get("/team/sellers", getTeamSellers);
router.get("/team/doubt-solvers", getTeamDoubtSolvers);

module.exports = router;
