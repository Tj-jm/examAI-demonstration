const express = require("express");
const router = express.Router();

const {
  getSupportSettings, updateSupportSettings, listTickets, ticketCounts, getTicket, replyTicket, updateTicket, uploadStaffImage, listAssignees,
} = require("../../controllers/admin/supportController");
const { protect, allow } = require("../../middleware/adminAuth");
const { uploadImage } = require("../../middleware/upload");

// Owner/admin see every ticket; a teacher only the ones assigned to them
// (enforced in the controller).
router.use(protect, allow("owner", "admin", "teacher"));

router.get("/", listTickets);
router.get("/counts", ticketCounts);
router.get("/assignees", allow("owner", "admin"), listAssignees);
router.get("/settings", allow("owner", "admin"), getSupportSettings);
router.put("/settings", allow("owner", "admin"), updateSupportSettings);
router.post("/upload-image", uploadImage, uploadStaffImage);
router.get("/:id", getTicket);
router.post("/:id/reply", replyTicket);
router.put("/:id", updateTicket);

module.exports = router;
