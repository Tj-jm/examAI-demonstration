const Doubt = require("../models/doubtModel");

// A fixed calendar week, not a rolling window — deliberately different from
// the AI daily cap (ai/service.js), which uses a rolling 24 hours precisely
// so nothing resets at a predictable clock moment. Here the opposite is
// what was asked for: a meter that "recharges next week", a single moment
// every student sees the same way, not one doubt aging out of a rolling
// window at a time with no clear "next week" to point to on the meter.
//
// Weeks start Sunday — this platform's primary market is Bangladesh, where
// Sunday is the first day of the working week (the weekend is Friday and
// Saturday), unlike the Mon-Sun convention common elsewhere. If an install
// needs Monday-start weeks instead, this is the one function to change.
const startOfWeek = (date = new Date()) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
};

const endOfWeek = (date = new Date()) => {
  const start = startOfWeek(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return end;
};

// Counts against escalatedAt, not createdAt — a doubt started with the AI
// in one week and only escalated to a human the next should count against
// the week it actually asked for human time, not the week it happened to
// be typed. See the field's own comment on the Doubt model.
const countHumanDoubtsThisWeek = (studentId, batchId) =>
  Doubt.countDocuments({
    student: studentId,
    batch: batchId,
    escalatedAt: { $gte: startOfWeek() },
  });

// Throws with a message naming the actual reset moment, not just "try
// again later" — a student hitting this needs to know whether that means
// tomorrow or four days from now.
//
// weeklyHumanDoubts is NOT "0 or unset means no cap" like the AI limits
// elsewhere in this file's neighborhood — unset (null/undefined) means
// unlimited, but 0 is its own distinct, deliberate state: this batch has
// no human doubt capacity at all, so every doubt — a fresh "human" pick or
// an AI doubt being escalated — is refused here and routed to AI only.
// See the field's own comment on the Batch model.
const assertWithinWeeklyDoubtLimit = async (student, batch) => {
  const limit = batch?.doubtLimits?.weeklyHumanDoubts;
  if (limit == null) return;

  if (limit === 0) {
    const error = new Error("This batch doesn't have a human doubt solver — ask the AI instead.");
    error.statusCode = 400;
    throw error;
  }

  const used = await countHumanDoubtsThisWeek(student, batch._id);
  if (used >= limit) {
    const resetsAt = endOfWeek();
    const error = new Error(
      `You've reached this batch's weekly limit of ${limit} doubt${limit === 1 ? "" : "s"} to a human solver. `
      + `This resets on ${resetsAt.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}.`
    );
    error.statusCode = 429;
    throw error;
  }
};

module.exports = { startOfWeek, endOfWeek, countHumanDoubtsThisWeek, assertWithinWeeklyDoubtLimit };
