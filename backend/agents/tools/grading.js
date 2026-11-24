const { z } = require("zod");
const mongoose = require("mongoose");
const { call } = require("../invoke");

// The grading agent's actions: apply the AI marks of a script it was
// confident about (finishes the script and tells the student, so it counts
// as something students see), and hand a script it wasn't sure about to
// people (to anyone on the batch, or one grader picked here), with its AI
// suggestions already filled in. The copilot can reopen a stuck script too.
const id = z.string().refine((v) => mongoose.isValidObjectId(v), "not a valid id");

const reopenRun = async (a, ctx, { refuseIfStarted }) => {
  const Submission = require("../../models/submissionModel");
  const { reopenSubmission } = require("../../controllers/admin/gradingController");
  const sub = await Submission.findById(a.submissionId).select("answers status");
  if (!sub) throw new Error("That script no longer exists.");
  if (sub.status !== "grading") return { submissionId: a.submissionId, summary: "Already finished; nothing to do.", link: `/grading/${a.submissionId}` };
  // A person started marking it while this waited: theirs to finish, or an
  // admin's call on the grading screen.
  if (refuseIfStarted && sub.answers.some((x) => x.questionType === "written" && x.gradedBy === "teacher")) {
    return { submissionId: a.submissionId, summary: "Someone has started marking it; left as it is.", link: `/grading/${a.submissionId}` };
  }
  const out = await call(reopenSubmission, { user: ctx.user, params: { id: a.submissionId }, body: { graderId: a.graderId || undefined } });
  return { submissionId: a.submissionId, summary: out.message, link: `/grading/${a.submissionId}` };
};

const tools = {
  apply_grades: {
    label: "Apply AI marks to a script",
    risk: "publish",
    schema: z.object({
      submissionId: id,
      batchId: id,
      studentName: z.string().max(200),
      examTitle: z.string().max(300),
      grades: z.array(z.object({ answerId: id, marks: z.number().min(0), outOf: z.number().min(0), confidence: z.number().min(0).max(1) })).min(1).max(100),
    }),
    batchesOf: (a) => [a.batchId],
    linkOf: (a) => `/grading/${a.submissionId}`,
    describe: (a) => {
      const got = a.grades.reduce((n, g) => n + g.marks, 0);
      const of = a.grades.reduce((n, g) => n + g.outOf, 0);
      const low = Math.min(...a.grades.map((g) => g.confidence));
      return `${a.studentName} · ${a.examTitle} · ${a.grades.length} written answer${a.grades.length === 1 ? "" : "s"} · ${got}/${of} · confidence ${Math.round(low * 100)}%+`;
    },
    async run(a, ctx) {
      const Submission = require("../../models/submissionModel");
      const { gradeAnswer } = require("../../controllers/admin/gradingController");
      const sub = await Submission.findById(a.submissionId).select("answers status referral");
      if (!sub) throw new Error("That script no longer exists.");
      // A regrade is a person's job: never the agent's.
      if (sub.referral?.requested && sub.referral?.decision === "approved") throw new Error("This script is being regraded; a person does that.");
      let applied = 0;
      let skipped = 0;
      for (const g of a.grades) {
        const answer = sub.answers.id(g.answerId);
        // A teacher may have marked it while this waited for approval.
        if (!answer || answer.marksAwarded !== null && answer.marksAwarded !== undefined) { skipped += 1; continue; }
        // The AI's note goes to the student with its mark, unless a
        // teacher already wrote one.
        const comment = !answer.teacherComment && answer.aiFeedback ? answer.aiFeedback : undefined;
        await call(gradeAnswer, { user: ctx.user, params: { id: a.submissionId, answerId: g.answerId }, body: { marks: g.marks, comment } });
        applied += 1;
      }
      return {
        submissionId: a.submissionId,
        summary: `Applied ${applied} mark${applied === 1 ? "" : "s"}${skipped ? `; ${skipped} had already been marked by a teacher` : ""}.`,
        link: `/grading/${a.submissionId}`,
      };
    },
  },

  review_script: {
    label: "Send a script to a person, with AI suggestions",
    risk: "staff",
    schema: z.object({
      submissionId: id,
      batchId: id,
      studentName: z.string().max(200),
      examTitle: z.string().max(300),
      // The answers it wasn't sure about (or couldn't mark).
      unsure: z.array(z.object({ answerId: id, question: z.number().int().min(1), marks: z.number().min(0).nullable(), outOf: z.number().min(0), confidence: z.number().min(0).max(1).nullable() })).max(100),
      // Empty: anyone on the batch. Otherwise held for this grader.
      graderId: id.optional().or(z.literal("")),
      graders: z.array(z.object({ _id: id, name: z.string().max(200) })).max(200).default([]),
    }),
    editable: ["graderId"],
    batchesOf: (a) => [a.batchId],
    linkOf: (a) => `/grading/${a.submissionId}`,
    describe: (a) => {
      const parts = a.unsure.map((u) => u.marks === null ? `Q${u.question}: no AI mark` : `Q${u.question}: ${u.marks}/${u.outOf} at ${Math.round((u.confidence || 0) * 100)}%`);
      const to = a.graderId ? a.graders.find((g) => g._id === a.graderId)?.name || "one grader" : "anyone on the batch";
      return `${a.studentName} · ${a.examTitle} · not sure about ${parts.join(", ") || "this script"} · goes to ${to}`;
    },
    run: (a, ctx) => reopenRun(a, ctx, { refuseIfStarted: true }),
  },
};

module.exports = { tools, reopenRun };
