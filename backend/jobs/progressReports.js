const cron = require("node-cron");
const { runDue } = require("../utils/progressReports");

// Scheduled progress reports (utils/progressReports.js). Every ten minutes:
// any batch whose weekly, fortnightly or monthly send time has passed and
// hasn't gone out yet sends now. A send missed by over 12 hours (the server
// was down) is skipped rather than sent late.
const CHECK_INTERVAL = "*/10 * * * *";

const tick = () => runDue().then((done) => {
  for (const d of done) console.log(`Progress reports ${d.period} for batch ${d.batch}: ${d.sent} sent, ${d.failed} failed, ${d.skipped} skipped.`);
}).catch((err) => console.error("Progress reports run failed:", err));

// Called once from server.js, never from app.js (tests load that).
const start = () => {
  tick();
  cron.schedule(CHECK_INTERVAL, tick);
};

module.exports = { start };
