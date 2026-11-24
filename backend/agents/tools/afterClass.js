const { z } = require("zod");
const mongoose = require("mongoose");
const { call } = require("../invoke");

// The after-class agent: a short quiz from the class notes, published to
// the batch, and a catch-up message to the students who missed the class.
const id = z.string().refine((v) => mongoose.isValidObjectId(v), "not a valid id");
const examRef = z.string().refine((v) => /^step:\d+$/.test(v) || mongoose.isValidObjectId(v), "an exam id or step:N");

const handlers = () => ({
  exam: require("../../controllers/admin/examController"),
  assignment: require("../../controllers/admin/assignmentController"),
});

const tools = {
  make_class_quiz: {
    label: "Make a quiz from the class notes",
    risk: "safe",
    schema: z.object({ liveClassId: id, batchId: id, classTitle: z.string().max(300), count: z.number().int().min(3).max(8) }),
    batchesOf: (a) => [a.batchId],
    describe: (a) => `${a.count} questions from the notes of “${a.classTitle}” · draft, questions wait in Review`,
    async run(a, ctx) {
      const LiveClass = require("../../models/liveClassModel");
      const Chapter = require("../../models/chapterModel");
      const { Question } = require("../../models/questionModel");
      const ai = require("../../ai/service");
      const prompts = require("../../ai/prompts");
      const { lecturePracticeQuestions } = require("../../ai/schemas");
      const lc = await LiveClass.findById(a.liveClassId);
      if (!lc || lc.notes?.status !== "ready" || !lc.notes.markdown) throw new Error("The class has no notes to make a quiz from.");
      const chapter = await Chapter.findById(lc.publishChapter);
      if (!chapter) throw new Error("Set a chapter for the class (class settings → Recordings) so the questions have a home.");
      const { data, usage } = await ai.generate({
        feature: "agent-afterClass",
        schema: lecturePracticeQuestions,
        user: ctx.user._id,
        batch: lc.batch,
        ...prompts.generateLecturePracticeQuestions({ title: lc.title, bodyMarkdown: lc.notes.markdown, count: a.count }),
      });
      // Waiting for review until the quiz is published (the next step).
      const created = await Promise.all(data.questions.map((q) => Question.create({
        type: q.type, question: q.question, subject: chapter.subject, chapter: chapter._id, topic: null,
        batches: [lc.batch], difficulty: q.difficulty, skillType: q.skillType, solutionText: q.solutionText,
        source: "ai", aiMeta: { model: usage?.model, sourceRef: String(lc._id) }, status: "pending_review",
        ...(q.type === "mcq" ? { options: q.options, correctOption: q.correctOption } : { statements: q.statements }),
      })));
      const h = handlers();
      const exam = await call(h.exam.createExam, {
        user: ctx.user,
        body: { title: `Quick quiz: ${lc.title}`, mode: "quiz", durationMinutes: Math.max(5, created.length * 2), description: "Made from the class notes." },
      });
      await call(h.assignment.assignToBatch, { user: ctx.user, params: { id: String(lc.batch), kind: "exams" }, body: { ids: [String(exam._id)] } });
      await call(h.exam.addQuestions, { user: ctx.user, params: { id: String(exam._id) }, body: { questionIds: created.map((q) => String(q._id)) } });
      return { examId: String(exam._id), summary: `Draft quiz with ${created.length} questions made; the questions are in Review.`, link: `/exams/${exam._id}` };
    },
  },

  publish_class_quiz: {
    label: "Publish the class quiz",
    risk: "publish",
    schema: z.object({ exam: examRef, batchId: id }),
    batchesOf: (a) => [a.batchId],
    describe: () => "Approve its questions, publish the quiz and open it to the batch",
    async run(a, ctx) {
      const Exam = require("../../models/examModel");
      const { Question } = require("../../models/questionModel");
      const examId = ctx.resolve(a.exam, "examId");
      const exam = await Exam.findById(examId).select("questions title");
      if (!exam) throw new Error("The quiz no longer exists.");
      // Approving the plan approves the questions it wrote.
      await Question.updateMany({ _id: { $in: exam.questions }, source: "ai", status: "pending_review" }, { $set: { status: "published" } });
      const h = handlers();
      await call(h.exam.setPublished, { user: ctx.user, params: { id: examId }, body: { isPublished: true } });
      await call(h.exam.setActive, { user: ctx.user, params: { id: examId }, body: { isActive: true } });
      return { examId, summary: `“${exam.title}” is published and open.`, link: `/exams/${examId}` };
    },
  },

  message_absentees: {
    label: "Message students who missed the class",
    risk: "publish",
    schema: z.object({ liveClassId: id, batchId: id, classTitle: z.string().max(300), absent: z.number().int().min(0), withQuiz: z.boolean().optional() }),
    batchesOf: (a) => [a.batchId],
    describe: (a) => `${a.absent} student${a.absent === 1 ? "" : "s"} who missed “${a.classTitle}”: recording, notes${a.withQuiz ? " and the quiz" : ""}`,
    async run(a) {
      const { notify } = require("../../utils/notify");
      const absent = await absentees(a.liveClassId, a.batchId);
      await notify(absent, "liveClassMissed", {
        title: `You missed: ${a.classTitle}`,
        body: `Catch up with the recording and class notes${a.withQuiz ? ", then take the quick quiz" : ""}.`,
        link: `/batches/${a.batchId}/live-classes/${a.liveClassId}`,
      });
      return { summary: `Sent a catch-up message to ${absent.length} student${absent.length === 1 ? "" : "s"}.` };
    },
  },
};

// Students of the batch with no time in the class at all.
const absentees = async (liveClassId, batchId) => {
  const LiveAttendance = require("../../models/liveAttendanceModel");
  const { getActiveBatchStudentIds, reachableStudents } = require("../../utils/batchMembers");
  const all = (await reachableStudents(await getActiveBatchStudentIds(batchId))).map(String);
  const came = new Set((await LiveAttendance.find({ liveClass: liveClassId, student: { $ne: null } }).select("student").lean()).map((x) => String(x.student)));
  return all.filter((s) => !came.has(s));
};

module.exports = { tools, absentees };
