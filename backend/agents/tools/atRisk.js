const { z } = require("zod");
const mongoose = require("mongoose");

// The at-risk agent's one action: a personal check-in to a student who is
// slipping, pointing at the topic they most need to practise.
const id = z.string().refine((v) => mongoose.isValidObjectId(v), "not a valid id");

const tools = {
  nudge_student: {
    label: "Check in with a student",
    risk: "publish",
    schema: z.object({
      studentId: id,
      batchId: id,
      studentName: z.string().max(200),
      batchName: z.string().max(200),
      reasons: z.array(z.string().max(200)).min(1).max(5),
      message: z.string().min(1).max(600),
      topicId: id.nullable().optional(),
      topicTitle: z.string().max(200).nullable().optional(),
    }),
    batchesOf: (a) => [a.batchId],
    describe: (a) => `${a.studentName} (${a.batchName}): ${a.reasons.join(" · ")}`,
    async run(a) {
      const { notify } = require("../../utils/notify");
      const link = a.topicId ? `/batches/${a.batchId}/practice/${a.topicId}` : `/batches/${a.batchId}`;
      await notify(a.studentId, "studyNudge", { title: a.topicTitle ? `A quick boost: ${a.topicTitle}` : "Checking in", body: a.message, link });
      return { summary: `Sent ${a.studentName} a check-in${a.topicTitle ? ` with ${a.topicTitle} practice` : ""}.` };
    },
  },
};

module.exports = { tools };
