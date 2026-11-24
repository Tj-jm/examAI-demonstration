const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const ai = require("../../ai/service");
const { FORMAT_LIMIT, writingTask, WRITING_TASKS, WRITING_LANGUAGES: LANGUAGES } = require("../../ai/writing");
const AiConfig = require("../../models/aiConfigModel");
const AppSettings = require("../../models/appSettingsModel");
const Exam = require("../../models/examModel");
const Batch = require("../../models/batchModel");

// "Write with AI" for staff (ai/writing.js). Admin writing aids: switched on
// once in Settings → AI, never billed to students.


// An exam's facts for its description: the saved exam, with whatever the
// builder hasn't saved yet laid over it.
const examInput = async (body) => {
  const draft = body.exam && typeof body.exam === "object" ? body.exam : {};
  let saved = {};
  if (body.examId && mongoose.isValidObjectId(body.examId)) {
    const exam = await Exam.findById(body.examId).populate("questions", "marks type");
    if (exam) {
      saved = {
        ...exam.toObject(),
        questionCount: exam.questions.length,
        totalMarks: exam.totalMarks(),
        types: [...new Set(exam.questions.map((q) => q.type))],
        hasWritten: exam.questions.some((q) => q.type === "written"),
      };
    }
  }
  const pick = ["title", "mode", "durationMinutes", "attemptsAllowed", "opensAt", "liveHours", "shuffleQuestions",
    "showResultImmediately", "scriptGraceMinutes", "awayMode", "awayMinutes", "questionCount", "totalMarks", "types", "hasWritten"];
  const exam = {};
  for (const k of pick) exam[k] = draft[k] !== undefined ? draft[k] : saved[k];
  return exam;
};

// What happened, for a conduct message: the attempt being disqualified
// (exam, integrity flags) or the student's recent conduct record.
const VIOLATION = { "tab-hidden": "left the exam tab", "answer-paste": "pasted into an answer", "window-blur": "switched windows", "fullscreen-exit": "left full screen", "left-exam": "left the exam" };
const conductFacts = async (body) => {
  const facts = [];
  if (body.submissionId && mongoose.isValidObjectId(body.submissionId)) {
    const Submission = require("../../models/submissionModel");
    const sub = await Submission.findById(body.submissionId).select("exam violations").populate("exam", "title").lean();
    if (sub) {
      if (sub.exam?.title) facts.push(`Exam: ${sub.exam.title}`);
      const counts = {};
      for (const v of sub.violations || []) counts[v.type] = (counts[v.type] || 0) + 1;
      for (const [t, n] of Object.entries(counts)) facts.push(`During the exam the student ${VIOLATION[t] || t} ${n} time${n === 1 ? "" : "s"}`);
    }
  }
  if (body.studentId && mongoose.isValidObjectId(body.studentId)) {
    const ConductEvent = require("../../models/conductEventModel");
    const events = await ConductEvent.find({ student: body.studentId, status: { $ne: "dismissed" } })
      .sort({ createdAt: -1 }).limit(8).populate("exam", "title").lean();
    for (const e of events) {
      const what = e.kind === "abuse" ? `Abusive message: "${String(e.text || "").slice(0, 200)}"`
        : e.kind === "examViolation" ? `${e.count || 1} exam integrity flag${e.count === 1 ? "" : "s"}`
          : e.kind === "disqualified" ? "Disqualified from an exam"
            : `Earlier action: ${e.action || e.kind}`;
      facts.push(`${new Date(e.createdAt).toISOString().slice(0, 10)}: ${what}${e.exam?.title ? ` (${e.exam.title})` : ""}`);
    }
  }
  return facts;
};

//@desc   Draft text with AI: an exam description, a notice, a landing page
//        section, a live class, a notice's push line, or a translation
//@route  POST /api/ai-write
//@access Private (staff)
const write = asyncHandler(async (req, res) => {
  if (!(await AiConfig.get()).features.writingHelp) {
    res.status(403);
    throw new Error("Write with AI is switched off. Turn it on in Settings → AI → Features.");
  }
  const { task } = req.body || {};
  if (!WRITING_TASKS.includes(task)) {
    res.status(400);
    throw new Error("Unknown writing task.");
  }

  const input = {
    ...req.body,
    language: LANGUAGES.includes(req.body.language) ? req.body.language : "en",
    siteName: (await AppSettings.get()).siteName,
  };
  if (task === "examDescription") input.exam = await examInput(req.body);
  if (task === "courseDescription") {
    input.kind = req.body.kind === "program" ? "program" : "batch";
    input.course = await require("../../ai/courseFacts").courseFacts(input.kind, req.body.id);
    if (!input.course) {
      res.status(404);
      throw new Error(`That ${input.kind} wasn't found.`);
    }
  }
  if (task === "notice" && Array.isArray(req.body.batches) && req.body.batches.length) {
    const ids = req.body.batches.filter((id) => mongoose.isValidObjectId(id)).slice(0, 10);
    input.batchNames = (await Batch.find({ _id: { $in: ids } }).select("name").lean()).map((b) => b.name);
  }
  if (task === "campaign") {
    input.audience = String(req.body.audience || "all");
    input.sms = Boolean(req.body.sms);
    input.automation = Boolean(req.body.automation);
    input.couponCode = String(req.body.couponCode || "").trim().slice(0, 40);
    if (req.body.batch && mongoose.isValidObjectId(req.body.batch)) input.batchName = (await Batch.findById(req.body.batch).select("name").lean())?.name;
  }
  if (task === "conductMessage") input.facts = await conductFacts(req.body);
  if (task === "translate" && !String(req.body.text || "").trim()) {
    res.status(400);
    throw new Error("There's no text to translate yet.");
  }
  if (task === "format") {
    const text = String(req.body.text || "");
    if (!text.trim()) {
      res.status(400);
      throw new Error("Paste some text first.");
    }
    if (text.length > FORMAT_LIMIT) {
      res.status(400);
      throw new Error(`That's too long to format in one go (${FORMAT_LIMIT.toLocaleString()} characters at most). Select part of it and format that.`);
    }
  }
  if (["notice", "liveClass", "campaign"].includes(task) && !String(req.body.prompt || "").trim()) {
    res.status(400);
    throw new Error("Say in a few words what it's about first.");
  }
  if (task === "pushLine" && !String(req.body.body || req.body.title || "").trim()) {
    res.status(400);
    throw new Error("Write the notice first. The push line is made from it.");
  }

  const { schema, system, prompt } = writingTask(task, input);
  const { data } = await ai.generate({
    feature: `write-${task}`,
    schema,
    system,
    prompt,
    maxTokens: task === "format" ? 12000 : task === "translate" ? 3000 : 1500,
    user: req.user._id,
    // Prose, not maths: leave dollar signs and the like alone.
    wrapLatex: false,
  });

  res.status(200).json(data);
});

module.exports = { write, examInput, conductFacts };
