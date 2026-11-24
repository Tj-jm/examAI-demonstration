const cron = require("node-cron");
const { sweep } = require("../utils/liveAttendance");
const { refreshAll } = require("../utils/liveRecording");

// Who's in each live in-app class, every 30 seconds (and a sample for the
// Performance page's history every few minutes); and recordings still
// being finished, every minute (auto-publishing them when asked).
const start = () => {
  cron.schedule("*/30 * * * * *", () => {
    sweep()
      .then(() => require("../utils/liveMonitor").record())
      .catch((error) => console.error(`Live attendance job: ${error.message}`));
  });
  cron.schedule("0 * * * * *", () => {
    refreshAll().catch((error) => console.error(`Live recording job: ${error.message}`));
  });
};

module.exports = { start };
