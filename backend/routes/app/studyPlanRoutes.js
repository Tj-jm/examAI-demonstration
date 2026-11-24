const express = require("express");
const router = express.Router({ mergeParams: true });

const { getStudyPlan, getStudyPlanCapacity, generateStudyPlan, toggleStudyPlanDay } = require("../../controllers/app/studyPlanController");
const { requireFeature } = require("../../middleware/batchAccess");

// Mounted under /api/app/batches/:batchId/study-plan by batchRoutes, behind
// studentProtect + batchAccess + requireFeature("studyPlan") already
// applied there.

router.get("/", getStudyPlan);
// Read-only, no AI — the duration picker calls this to know which lengths
// this student's current content can actually back up.
router.get("/capacity", getStudyPlanCapacity);
// A second gate on top of the study-plan one above — same reasoning as
// practiceRoutes.js's own AI sub-routes: a batch can have the study-plan
// capability on and AI assistance off (aiAssist starts false on every
// batch), and generating a plan is an actual AI call.
router.post("/generate", requireFeature("aiAssist"), generateStudyPlan);
// Plain data toggle, no AI involved — no extra feature gate beyond the
// studyPlan one already applied where this router is mounted.
router.patch("/days/:day/complete", toggleStudyPlanDay);

module.exports = router;
