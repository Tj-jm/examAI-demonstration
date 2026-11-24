const asyncHandler = require("express-async-handler");

// Records that pile up fast and aren't needed once they're old: owners can
// delete the ones older than a chosen age from Settings → Data. Nothing
// here is course content, results or payments.
//   - AI call log: the daily allowance and spend cap only look at the last
//     24 hours, so older entries are history only (usage charts, a
//     student's AI usage in their profile).
//   - Course chat and practice follow-up conversations: a student's old
//     chats. Deleting a practice follow-up also resets its per-question limit.
//   - Campaign sends: one record per student per campaign. Sales are
//     credited to a campaign opened in the 7 days before, and the campaign's
//     own counts are kept on the campaign.
//   - Live class captions: only read to write the class notes.
const KINDS = {
  aiUsage: { label: "AI call log", model: () => require("../../models/aiUsageModel"), field: "createdAt" },
  chatThreads: { label: "Course chat conversations", model: () => require("../../models/chatThreadModel"), field: "updatedAt" },
  practiceQna: { label: "Practice question follow-ups", model: () => require("../../models/practiceQnaModel"), field: "updatedAt" },
  campaignDeliveries: { label: "Campaign send records", model: () => require("../../models/campaignDeliveryModel"), field: "createdAt" },
  liveCaptions: { label: "Live class captions", model: () => require("../../models/liveTranscriptModel"), field: "at" },
};
const AGES = [30, 90, 180, 365];

const modelOf = (kind) => KINDS[kind].model();

//@desc   How many of each record there are, and the oldest one's date
//@route  GET /api/settings/cleanup
//@access Private (owner)
const getCleanup = asyncHandler(async (req, res) => {
  const rows = await Promise.all(Object.entries(KINDS).map(async ([kind, k]) => {
    const Model = modelOf(kind);
    const [count, oldest] = await Promise.all([
      Model.estimatedDocumentCount(),
      Model.findOne({ [k.field]: { $ne: null } }).sort({ [k.field]: 1 }).select(k.field).lean(),
    ]);
    return { kind, label: k.label, count, oldest: oldest?.[k.field] || null };
  }));
  res.status(200).json({ kinds: rows, ages: AGES });
});

//@desc   Delete one kind of record older than a number of days
//@route  POST /api/settings/cleanup  { kind, days }
//@access Private (owner)
const runCleanup = asyncHandler(async (req, res) => {
  const { kind } = req.body || {};
  const days = Number(req.body?.days);
  if (!KINDS[kind]) {
    res.status(400);
    throw new Error("Unknown kind of data.");
  }
  if (!AGES.includes(days)) {
    res.status(400);
    throw new Error(`Pick one of: ${AGES.join(", ")} days.`);
  }
  const before = new Date(Date.now() - days * 86400000);
  const { deletedCount } = await modelOf(kind).deleteMany({ [KINDS[kind].field]: { $lt: before } });
  res.status(200).json({ kind, days, deleted: deletedCount || 0 });
});

module.exports = { getCleanup, runCleanup, KINDS, AGES };
