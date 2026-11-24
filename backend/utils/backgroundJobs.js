
// The jobs utils/queue.js runs in the background, by name. Each handler
// takes plain data (it may run on another server) and throws to be retried.
const register = (define) => {
  if (true) {
    // The AI note on an exam result (utils/examReport.js), off the submit
    // and grading requests. A few at a time, so a whole class handing in at
    // once doesn't fire hundreds of AI calls together.
    define(
      "exam-report",
      async ({ submissionId }) => {
        const { generateExamPerformanceReport } = require("./examReport");
        await generateExamPerformanceReport(submissionId, { rethrow: true });
        // Nothing to report on (no topics, say): the page stops waiting.
        const Submission = require("../models/submissionModel");
        await Submission.updateOne(
          { _id: submissionId, "performanceReport.generatedAt": null },
          { $set: { "performanceReport.queuedAt": null } }
        );
      },
      { concurrency: 3, attempts: 3 }
    );
  }
  // A campaign's messages (utils/campaigns.js). One at a time; a retry
  // resumes where the last try stopped.
  define(
    "campaign-send",
    async ({ campaignId }) => {
      await require("./campaigns").send(campaignId);
    },
    { concurrency: 1, attempts: 3 }
  );
};

module.exports = { register };
