// Pulled out of practiceExamController.js so the one piece of arithmetic
// that decides what a student sees as their score can be tested without a
// database — everything else in that controller either re-fetches live
// documents or calls out to AI, neither of which belongs in a unit test.

// Negative marking can take marksAwarded below zero on an all-wrong paper;
// clamped here rather than letting a student see a negative percentage,
// which would be technically accurate and practically meaningless.
//
// totalMarks of 0 (every question turned out ungradable) returns null
// rather than 0 — a paper nothing could be scored on is not the same thing
// as a paper scored zero, and the caller uses null to skip updating the
// running average rather than recording a failed attempt that never
// actually happened.
const computePercent = (marksAwarded, totalMarks) => {
  if (!totalMarks || totalMarks <= 0) return null;
  return Math.round((Math.max(0, marksAwarded) / totalMarks) * 100);
};

module.exports = { computePercent };
