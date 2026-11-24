const cron = require("node-cron");

// Background agents: the grading pass and the after-class pass. Each does
// nothing unless switched on in Settings → AI → Agents. One at a time.
let busy = false;
const tick = async () => {
  if (busy) return;
  busy = true;
  try {
    await require("../agents/afterClass").sweep().catch(() => {});
    await require("../agents/grading").sweep().catch(() => {});
    await require("../agents/support").sweep().catch(() => {});
    await require("../agents/assignment").sweep().catch(() => {});
    await require("../agents/assignment").reminders().catch(() => {});
  } finally {
    busy = false;
  }
};

// Weekly: the at-risk check (Sunday 6pm, server time).
const weekly = async () => {
  await require("../agents/atRisk").sweep().catch(() => {});
};

// Weekly: the marketing agent's proposals (Saturday 10am, server time:
// the start of the week in Bangladesh).
const marketing = async () => {
  await require("../agents/marketing").sweep().catch(() => {});
};

// Evening: the tutor's reminder to students with tasks left (7pm).
const evening = async () => {
  await require("../utils/tutor").eveningNudges().catch(() => {});
};

const start = () => {
  cron.schedule("0 19 * * *", evening);
  cron.schedule("*/10 * * * *", tick);
  cron.schedule("0 18 * * 0", weekly);
  cron.schedule("0 10 * * 6", marketing);
};

module.exports = { start, tick, weekly, marketing };
