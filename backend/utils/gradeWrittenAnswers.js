const AiConfig = require("../models/aiConfigModel");
const usage = require("../ai/usage");

const PARALLEL = 3;

// Grades a practice paper's written answers before the results are built.
// Each one is its own AI call, so doing them one after another made a paper
// with several written questions slow to submit.
//
// They run three at a time only when the platform has no daily AI cap. With
// a cap, the free-allowance check in ai/service.js reads today's usage
// before each call and the usage is recorded after it, so parallel calls
// could each see the same allowance left and skip a credit they owe. On a
// capped platform they stay one at a time, exactly as before.
//
// `grade(answer, question)` must not throw (both controllers' gradeWritten
// already turn failures into a note). Returns a Map keyed by question id.
const gradeWrittenAnswers = async ({ jobs, grade, student, batch }) => {
  const results = new Map();
  if (jobs.length === 0) return results;

  const snapshot = await usage.getUsageSnapshot({ student, batch, config: await AiConfig.get() });
  const width = snapshot.dailyLimit === null ? Math.min(PARALLEL, jobs.length) : 1;

  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const { answer, question } = jobs[next++];
      // A passage's written question is keyed "<passage>:<index>".
      results.set(question.subIndex != null ? `${question._id}:${question.subIndex}` : String(question._id), await grade(answer, question));
    }
  };
  await Promise.all(Array.from({ length: width }, worker));
  return results;
};

module.exports = { gradeWrittenAnswers };
