const asyncHandler = require("express-async-handler");
const User = require("../../models/userModel");
const { staffBatchIds } = require("../../utils/staffBatchIds");

// The admin panel's "what's waiting" numbers that have no endpoint of their
// own (doubts, leads, hand-ins, recordings), plus, for every badged page,
// when its newest item arrived and when this person last opened the page:
// a newer item shows as new. Each section is worked out on its own and
// left out if its feature isn't in this edition or the role can't see it.

const MANAGERS = ["owner", "admin"];
const GRADERS = ["owner", "admin", "teacher", "grader"];

// key: roles that see it, and how to count it.
const SECTIONS = {
  doubts: {
    roles: ["owner", "admin", "doubtSolver", "teacher"],
    async run(user) {
      const Doubt = require("../../models/doubtModel");
      const q = { status: "escalated" };
      if (user.role === "doubtSolver") q.$or = [{ resolvedBy: { $exists: false } }, { resolvedBy: null }, { resolvedBy: user._id }];
      const [count, last] = await Promise.all([Doubt.countDocuments(q), Doubt.findOne(q).sort({ escalatedAt: -1 }).select("escalatedAt createdAt").lean()]);
      return { count, latest: last?.escalatedAt || last?.createdAt };
    },
  },
  doubtReviews: {
    roles: MANAGERS,
    async run() {
      const Doubt = require("../../models/doubtModel");
      const q = { "review.requested": true, "review.decision": null };
      const [count, last] = await Promise.all([Doubt.countDocuments(q), Doubt.findOne(q).sort({ "review.requestedAt": -1 }).select("review.requestedAt").lean()]);
      return { count, latest: last?.review?.requestedAt };
    },
  },
  leads: {
    roles: MANAGERS,
    async run() {
      const Lead = require("../../models/leadModel");
      const q = { status: "new" };
      const [count, last] = await Promise.all([Lead.countDocuments(q), Lead.findOne(q).sort({ createdAt: -1 }).select("createdAt").lean()]);
      return { count, latest: last?.createdAt };
    },
  },
  assignments: {
    roles: GRADERS,
    async run(user) {
      const { AssignmentSubmission } = require("../../models/assignmentModel");
      const batches = await staffBatchIds(user);
      const q = { status: "submitted", ...(batches ? { batch: { $in: batches } } : {}) };
      const [count, last] = await Promise.all([AssignmentSubmission.countDocuments(q), AssignmentSubmission.findOne(q).sort({ submittedAt: -1 }).select("submittedAt").lean()]);
      return { count, latest: last?.submittedAt };
    },
  },
  recordings: {
    roles: MANAGERS,
    async run() {
      const LiveClass = require("../../models/liveClassModel");
      const rows = await LiveClass.aggregate([
        { $unwind: "$recordings" },
        { $match: { "recordings.status": "ready", "recordings.decision": "pending" } },
        { $group: { _id: null, count: { $sum: 1 }, latest: { $max: "$updatedAt" } } },
      ]);
      return { count: rows[0]?.count || 0, latest: rows[0]?.latest };
    },
  },
  // Pages whose count has its own endpoint: only when the newest arrived.
  support: {
    roles: ["owner", "admin", "teacher"],
    async run(user) {
      const SupportTicket = require("../../models/supportTicketModel");
      const q = { status: "open", ...(MANAGERS.includes(user.role) ? {} : { assignedTo: user._id }) };
      const last = await SupportTicket.findOne(q).sort({ updatedAt: -1 }).select("updatedAt").lean();
      return { latest: last?.updatedAt };
    },
  },
  conduct: {
    roles: MANAGERS,
    async run() {
      const ConductEvent = require("../../models/conductEventModel");
      const last = await ConductEvent.findOne({ status: "open", kind: { $in: ["abuse", "examViolation"] } }).sort({ createdAt: -1 }).select("createdAt").lean();
      return { latest: last?.createdAt };
    },
  },
  deletions: {
    roles: MANAGERS,
    async run() {
      const DeletionRequest = require("../../models/deletionRequestModel");
      const last = await DeletionRequest.findOne({ status: "awaiting" }).sort({ createdAt: -1 }).select("createdAt").lean();
      return { latest: last?.createdAt };
    },
  },
  review: {
    roles: MANAGERS,
    async run() {
      const { Question } = require("../../models/questionModel");
      const last = await Question.findOne({ status: "pending_review" }).sort({ createdAt: -1 }).select("createdAt").lean();
      return { latest: last?.createdAt };
    },
  },
  referrals: {
    roles: MANAGERS,
    async run() {
      const Submission = require("../../models/submissionModel");
      const last = await Submission.findOne({ "referral.requested": true, "referral.decision": null }).sort({ "referral.requestedAt": -1 }).select("referral.requestedAt updatedAt").lean();
      return { latest: last?.referral?.requestedAt || last?.updatedAt };
    },
  },
  grading: {
    roles: GRADERS,
    async run(user) {
      const Submission = require("../../models/submissionModel");
      const batches = await staffBatchIds(user);
      const last = await Submission.findOne({ status: "grading", ...(batches ? { batch: { $in: batches } } : {}) }).sort({ submittedAt: -1 }).select("submittedAt").lean();
      return { latest: last?.submittedAt };
    },
  },
  agents: {
    roles: MANAGERS,
    async run() {
      const AgentRun = require("../../models/agentRunModel");
      const last = await AgentRun.findOne({ status: { $in: ["awaiting", "needs_info"] }, hidden: { $ne: true } }).sort({ updatedAt: -1 }).select("updatedAt").lean();
      return { latest: last?.updatedAt };
    },
  },
};

const KEYS = Object.keys(SECTIONS);

//@desc   Waiting counts the sidebar has no other source for, when each
//        badged page's newest item came in, and when this person last
//        opened each page
//@route  GET /api/badges
//@access Private (staff)
const getBadges = asyncHandler(async (req, res) => {
  const counts = {};
  const latest = {};
  await Promise.all(KEYS.filter((k) => SECTIONS[k].roles.includes(req.user.role)).map(async (k) => {
    try {
      const out = await SECTIONS[k].run(req.user);
      if (out.count !== undefined) counts[k] = out.count;
      if (out.latest) latest[k] = out.latest;
    } catch {
      // Not in this edition, or failed: no badge rather than no sidebar.
    }
  }));
  const me = await User.findById(req.user._id).select("badgeSeen").lean();
  res.status(200).json({ counts, latest, seen: me?.badgeSeen || {} });
});

//@desc   This person just opened a badged page: what's there now isn't new
//@route  POST /api/badges/seen  { key }
//@access Private (staff)
const markSeen = asyncHandler(async (req, res) => {
  const key = String(req.body?.key || "");
  if (!KEYS.includes(key)) {
    res.status(400);
    throw new Error("Unknown page.");
  }
  const at = new Date();
  await User.updateOne({ _id: req.user._id }, { $set: { [`badgeSeen.${key}`]: at } });
  res.status(200).json({ key, at });
});

module.exports = { getBadges, markSeen, BADGE_KEYS: KEYS };
