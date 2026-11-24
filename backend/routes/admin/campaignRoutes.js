const express = require("express");
const router = express.Router();
const c = require("../../controllers/admin/campaignController");
const { protect, allow } = require("../../middleware/adminAuth");

// Messages to students in bulk: owner and admin only.
router.use(protect, allow("owner", "admin"));

router.get("/", c.listCampaigns);
router.post("/", c.createCampaign);
router.post("/estimate", c.estimateCampaign);
router.get("/:id", c.getCampaign);
router.put("/:id", c.updateCampaign);
router.delete("/:id", c.deleteCampaign);
router.post("/:id/send", c.sendCampaign);
router.post("/:id/cancel", c.cancelCampaign);
router.post("/:id/toggle", c.toggleAutomation);
router.post("/:id/duplicate", c.duplicateCampaign);

module.exports = router;
