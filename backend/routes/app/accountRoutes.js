const express = require("express");
const router = express.Router();

const { getStanding, getDeletion, requestDeletion, cancelDeletion } = require("../../controllers/app/accountController");
const { studentProtect } = require("../../middleware/studentAuth");

router.use(studentProtect);

router.get("/standing", getStanding);
router.get("/deletion", getDeletion);
router.post("/deletion", requestDeletion);
router.delete("/deletion", cancelDeletion);

// Campaigns (utils/campaigns.js): link clicks and the opt-out.
const campaignApp = require("../../controllers/app/campaignController");
router.post("/campaign-click", campaignApp.campaignClick);
router.get("/marketing", campaignApp.getMarketing);
router.put("/marketing", campaignApp.setMarketing);

module.exports = router;
