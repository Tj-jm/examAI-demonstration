const cron = require("node-cron");
const { processDue } = require("../utils/accountDeletion");

// Deletion requests past their grace period, every hour. A missed tick is
// caught on the next one.
const start = () => {
  cron.schedule("17 * * * *", () => {
    processDue().catch((error) => console.error(`Account deletion job: ${error.message}`));
  });
};

module.exports = { start };
