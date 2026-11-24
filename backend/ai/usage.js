const AiUsage = require("../models/aiUsageModel");
const AiCredit = require("../models/aiCreditModel");
const Batch = require("../models/batchModel");

const DAY_MS = 86400000;

// One calculation, shared by ai/service.js's request-time cap check and the
// student-facing usage meter — same reasoning as buildPerformance()/
// countResolved() elsewhere in this project: the number that blocks a call
// and the number a student sees for it must never be able to diverge.

// A batch's own dailyCallsPerStudent is a BONUS on top of the platform
// default, never a replacement for it — a batch can only ever grant its
// own students extra free calls, not take away the baseline every batch
// already gets. 0/unset means no bonus, not "no cap": the platform
// default (if any) still applies in full.
//
// If the platform default itself is unlimited (0/unset there), the whole
// thing stays unlimited regardless of any batch bonus — there's nothing
// to add on top of "no limit".
const getPlatformDailyDefault = (config) =>
  (config.limits.dailyCallsPerStudent > 0 ? config.limits.dailyCallsPerStudent : null);

const getBatchDailyBonus = async (batch) => {
  if (!batch) return 0;
  const batchDoc = await Batch.findById(batch).select("aiLimits");
  return batchDoc?.aiLimits?.dailyCallsPerStudent > 0 ? batchDoc.aiLimits.dailyCallsPerStudent : 0;
};

const getDailyCap = async (batch, config) => {
  const platformDefault = getPlatformDailyDefault(config);
  if (platformDefault === null) return null;
  const bonus = await getBatchDailyBonus(batch);
  return platformDefault + bonus;
};

// `batch` passed through untouched: a real id scopes the sum to that
// batch, `null` scopes it to calls with no batch at all, and `undefined`
// (the no-batch-context safety-net path in assertWithinCaps) drops the key
// from the query entirely — Mongo's driver strips undefined-valued keys
// before it ever reaches the server, so this one function serves all three
// shapes without a branch.
//
// Sums featureCost, not a flat count of documents — this is what makes the
// daily allowance itself cost-aware. A cost-20 feature has to actually
// consume 20 of the 50 in "50 free calls a day", not count the same as a
// cost-1 one the way a plain document count would. featureCost defaults to
// 1 via $ifNull for any AiUsage record logged before this field existed,
// so old usage history doesn't retroactively look like it cost nothing.
const sumCostToday = async (student, batch) => {
  const since = new Date(Date.now() - DAY_MS);
  const result = await AiUsage.aggregate([
    { $match: { student, batch, createdAt: { $gte: since }, ok: true } },
    { $group: { _id: null, total: { $sum: { $ifNull: ["$featureCost", 1] } } } },
  ]);
  return result.length > 0 ? result[0].total : 0;
};

const getCreditBalances = async (student, batch) => {
  const [batchCredit, generalCredit] = await Promise.all([
    batch ? AiCredit.findOne({ student, batch }) : Promise.resolve(null),
    AiCredit.findOne({ student, batch: null }),
  ]);
  return { batchCredits: batchCredit?.balance || 0, generalCredits: generalCredit?.balance || 0 };
};

// Only meaningful once the free allowance is actually exhausted — the next
// slot frees up exactly 24h after the oldest call still inside today's
// rolling window, not at some fixed clock time, since the cap itself is a
// rolling 24h window on purpose (see ai/service.js). Approximate now that
// usage is cost-weighted rather than a flat count — the oldest call aging
// out doesn't always free up enough budget for the very next action if it
// was a cheap one and the next action is expensive, but it's still the
// most honest single answer to "when does something change" without
// simulating the whole rolling window forward. null whenever there's
// nothing to count down to.
const getResetHint = async (student, batch, usedToday, dailyLimit) => {
  if (dailyLimit === null || usedToday < dailyLimit) return null;
  const since = new Date(Date.now() - DAY_MS);
  const oldest = await AiUsage.findOne({ student, batch, createdAt: { $gte: since }, ok: true })
    .sort({ createdAt: 1 })
    .select("createdAt");
  return oldest ? new Date(oldest.createdAt.getTime() + DAY_MS) : null;
};

// Full snapshot for the student-facing meter and the AI credits page.
// `student` may be omitted (no logged-in-student context) — everything
// collapses to zeros/nulls rather than throwing, so a caller never needs
// its own guard first.
const getUsageSnapshot = async ({ student, batch, config }) => {
  const platformDefault = getPlatformDailyDefault(config);
  const batchBonus = platformDefault === null ? 0 : await getBatchDailyBonus(batch);
  const dailyLimit = platformDefault === null ? null : platformDefault + batchBonus;

  const usedToday = student ? await sumCostToday(student, batch) : 0;
  const credits = student ? await getCreditBalances(student, batch) : { batchCredits: 0, generalCredits: 0 };
  const resetsAt = student ? await getResetHint(student, batch, usedToday, dailyLimit) : null;

  return {
    dailyLimit,
    // The breakdown behind dailyLimit — platformDefault is the general,
    // platform-wide amount every student gets on every batch; batchBonus
    // is this specific batch's own top-up, usable only here. dailyLimit
    // is always platformDefault + batchBonus (or null if the platform
    // itself has no cap).
    platformDefault,
    batchBonus,
    usedToday,
    remainingToday: dailyLimit === null ? null : Math.max(0, dailyLimit - usedToday),
    resetsAt,
    ...credits,
  };
};

module.exports = {
  getDailyCap, sumCostToday, getCreditBalances, getResetHint, getUsageSnapshot,
  getPlatformDailyDefault, getBatchDailyBonus,
};
