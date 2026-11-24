const express = require("express");
const router = express.Router();

const {
  listRequests, deletionCounts, approveRequest, rejectRequest, getDeletionSettings, updateDeletionSettings,
} = require("../../controllers/admin/deletionController");
const { protect, allow } = require("../../middleware/adminAuth");

router.use(protect, allow("owner", "admin"));

router.get("/", listRequests);
router.get("/counts", deletionCounts);
router.get("/settings", getDeletionSettings);
router.put("/settings", updateDeletionSettings);
router.post("/:id/approve", approveRequest);
router.post("/:id/reject", rejectRequest);

module.exports = router;
