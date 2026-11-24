const { getUsageSnapshot } = require("../ai/usage");

// Written questions in a practice paper (batch or archive) are AI-graded at
// submit, and every one costs the student AI budget. A paper only hands out
// as many as the student can currently pay to grade — free daily allowance
// plus both credit pools — so no written answer comes back "could not be
// auto-graded" for lack of budget. Also returns what grading will cost, so
// the student is told up front.
//
// `batch` is the batch id, or null for the archive's own shared pool.
// How many AI gradings a question needs: 1 for a written question, one per
// written question under a passage.
const writtenWeight = (q) => (q.type === "written" ? 1 : (q.subQuestions || []).filter((sq) => sq.type === "written").length);
const needsGrading = (q) => writtenWeight(q) > 0;

const capWrittenByBudget = async ({ written, student, batch, config, feature }) => {
  const costEach = config.getFeatureCost(feature);
  if (written.length === 0) return { written: [], costEach, unlimited: false };

  const snapshot = await getUsageSnapshot({ student, batch, config });
  // No daily cap on this platform: grading is never refused, nothing to limit.
  if (snapshot.dailyLimit === null) {
    return { written, costEach, unlimited: true };
  }

  const available = snapshot.remainingToday + snapshot.batchCredits + snapshot.generalCredits;
  const affordable = costEach > 0 ? Math.floor(available / costEach) : Infinity;
  const shuffled = [...written].sort(() => Math.random() - 0.5);
  // A passage comes whole or not at all: only while all its written
  // questions can still be paid for.
  const kept = [];
  let used = 0;
  for (const q of shuffled) {
    const w = writtenWeight(q);
    if (used + w > affordable) continue;
    used += w;
    kept.push(q);
  }
  return { written: kept, costEach, unlimited: false };
};

// What the chosen paper's written questions will cost to grade — sent with
// the built paper so the student sees it before starting.
const writtenCostSummary = ({ selected, costEach, unlimited }) => {
  const writtenCount = selected.reduce((n, q) => n + writtenWeight(q), 0);
  if (writtenCount === 0) return null;
  return { writtenCount, costEach, total: writtenCount * costEach, unlimited };
};

module.exports = { capWrittenByBudget, writtenCostSummary, writtenWeight, needsGrading };
