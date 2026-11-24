const cron = require("node-cron");
const { runDue } = require("../utils/campaigns");

// Campaigns (utils/campaigns.js). Every minute: start scheduled campaigns
// that are due, and pick up a send whose server stopped part way. Every
// hour: run the automations (utils/automations.js).
const tick = () => runDue().catch((err) => console.error("Campaign check failed:", err));
const hourly = () => require("../utils/automations").runAll().then((done) => {
  for (const d of done) console.log(`Automation "${d.automation}": ${d.sent} sent.`);
}).catch((err) => console.error("Automations run failed:", err));

// Called once from server.js, never from app.js (tests load that).
const start = () => {
  // Deliveries became unique per campaign, student and key (automations
  // can reach a student again for a new reason); the older index without
  // the key would refuse that.
  require("mongoose").connection.once("open", () => {
    require("../models/campaignDeliveryModel").collection.dropIndex("campaign_1_student_1").catch(() => {});
  });
  tick();
  cron.schedule("* * * * *", tick);
  cron.schedule("7 * * * *", hourly);
};

module.exports = { start };
