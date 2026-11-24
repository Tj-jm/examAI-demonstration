const express = require("express");
const router = express.Router();
const c = require("../../controllers/admin/leadController");
const { protect, allow } = require("../../middleware/adminAuth");

// Leads: owner and admin only.
router.use(protect, allow("owner", "admin"));

router.get("/", c.listLeads);
router.get("/export", c.exportLeads);
router.get("/interested", c.getInterested);
router.post("/message", c.messageLeads);
router.put("/:id", c.updateLead);
router.delete("/:id", c.deleteLead);

module.exports = router;
