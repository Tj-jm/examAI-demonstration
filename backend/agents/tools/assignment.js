const { z } = require("zod");
const mongoose = require("mongoose");
const { call } = require("../invoke");

// The assignment agent's one action: apply its suggested grade to a
// hand-in, and return it to the student when the agent is set to.
const id = z.string().refine((v) => mongoose.isValidObjectId(v), "not a valid id");

const tools = {
  apply_assignment_grade: {
    label: "Apply a suggested assignment grade",
    risk: "publish",
    schema: z.object({
      submissionId: id,
      batchId: id,
      studentName: z.string().max(200),
      assignmentTitle: z.string().max(300),
      marks: z.number().min(0),
      outOf: z.number().min(0),
      returnToStudent: z.boolean(),
    }),
    batchesOf: (a) => [a.batchId],
    describe: (a) => `${a.studentName} · ${a.assignmentTitle} · ${a.marks}/${a.outOf}${a.returnToStudent ? " · returned to the student" : " · kept for review"}`,
    async run(a, ctx) {
      const { AssignmentSubmission } = require("../../models/assignmentModel");
      const { gradeSubmission } = require("../../controllers/admin/courseworkController");
      const sub = await AssignmentSubmission.findById(a.submissionId);
      if (!sub) throw new Error("That hand-in no longer exists.");
      // A teacher may have graded it while this waited for approval.
      if (sub.status === "graded") return { submissionId: a.submissionId, summary: "Already graded by a teacher; left as it is." };
      if (sub.ai?.marks === null || sub.ai?.marks === undefined) throw new Error("There's no suggestion to apply.");
      await call(gradeSubmission, {
        user: ctx.user,
        params: { subId: a.submissionId },
        body: { marks: sub.ai.marks, rubricScores: sub.ai.rubricScores, feedback: sub.ai.feedback, returned: a.returnToStudent },
      });
      return { submissionId: a.submissionId, summary: `Graded ${a.marks}/${a.outOf}${a.returnToStudent ? " and returned" : ""}.` };
    },
  },
};

module.exports = { tools };
