const mongoose = require("mongoose");
const { batchQuestionScope } = require("../utils/batchSubjects");

// What a batch or program really contains, as plain sentences for "Write
// with AI" (task courseDescription). Read from the database, so the
// description can only describe content that exists.

const FEATURE_NAMES = [
  ["lectures", "recorded lectures"],
  ["practice", "topic-wise practice questions"],
  ["exams", "exams and mock tests"],
  ["liveClasses", "live classes"],
  ["aiAssist", "AI explanations and hints on practice"],
  ["doubtSolving", "doubt solving"],
  ["studyPlan", "a personal study plan"],
  ["agentTutor", "a daily study tutor"],
  ["docChat", "questions answered from the course material"],
];

const list = (items, n) => (items.length > n ? `${items.slice(0, n).join(", ")} and ${items.length - n} more` : items.join(", "));

const planLine = (p) => {
  const amount = p.prices?.[0] ? `${p.prices[0].amount} ${p.prices[0].currency}` : `${p.price}`;
  return `${p.label}: ${amount}${p.isInfinite ? ", lifetime access" : p.durationDays ? `, ${p.durationDays} days` : ""}`;
};

const batchFacts = async (batchId) => {
  const Batch = require("../models/batchModel");
  // Registered for the populates below.
  require("../models/subjectModel");
  require("../models/programModel");
  const Chapter = require("../models/chapterModel");
  const Topic = require("../models/topicModel");
  const Lecture = require("../models/lectureModel");
  const Exam = require("../models/examModel");
  const LiveClass = require("../models/liveClassModel");
  const { Question } = require("../models/questionModel");

  if (!mongoose.isValidObjectId(batchId)) return null;
  const batch = await Batch.findById(batchId).populate("program", "title").populate("subjects", "title").lean();
  if (!batch) return null;
  // Lectures, practice and exams are on unless switched off; the rest are
  // off unless switched on (batchModel.js defaults).
  const on = (f) => (["lectures", "practice", "exams"].includes(f) ? batch.features?.[f] !== false : batch.features?.[f] === true);

  const subjectIds = (batch.subjects || []).map((s) => s._id);
  const [chapters, lectures, examCount, mockCount, questionCount, upcomingLive] = await Promise.all([
    subjectIds.length ? Chapter.find({ subject: { $in: subjectIds } }).sort({ order: 1, title: 1 }).select("title subject").limit(80).lean() : [],
    on("lectures") ? Lecture.find({ batches: batch._id, isPublished: true }).sort({ order: 1, createdAt: 1 }).select("title").limit(200).lean() : [],
    on("exams") ? Exam.countDocuments({ batches: batch._id, isPublished: true, createdByStudent: null }) : 0,
    on("exams") ? Exam.countDocuments({ batches: batch._id, isPublished: true, createdByStudent: null, mode: "mock" }) : 0,
    on("practice") ? Question.countDocuments({ ...batchQuestionScope(batch), status: "published" }) : 0,
    on("liveClasses") ? LiveClass.countDocuments({ batch: batch._id, status: "scheduled", scheduledAt: { $gte: new Date() } }) : 0,
  ]);
  const topicCount = chapters.length ? await Topic.countDocuments({ chapter: { $in: chapters.map((c) => c._id) } }) : 0;

  const facts = [`Batch: ${batch.name}`];
  if (batch.program?.title) facts.push(`Program: ${batch.program.title}`);
  if (subjectIds.length) facts.push(`Subjects: ${batch.subjects.map((s) => s.title).join(", ")}`);
  for (const s of batch.subjects || []) {
    const ch = chapters.filter((c) => String(c.subject) === String(s._id)).map((c) => c.title);
    if (ch.length) facts.push(`${s.title} chapters: ${list(ch, 15)}`);
  }
  if (topicCount) facts.push(`Topics across those chapters: ${topicCount}`);
  if (lectures.length) facts.push(`Recorded lectures: ${lectures.length} (for example: ${list(lectures.map((l) => l.title), 8)})`);
  if (examCount) facts.push(`Exams: ${examCount}${mockCount ? `, of which ${mockCount} mock test${mockCount === 1 ? "" : "s"}` : ""}`);
  if (questionCount) facts.push(`Practice questions: ${questionCount}`);
  if (upcomingLive) facts.push(`Upcoming live classes: ${upcomingLive}`);
  if (batch.archiveAuthorities?.length) facts.push("Past board and admission papers to practise");
  const features = FEATURE_NAMES.filter(([k]) => on(k)).map(([, label]) => label);
  if (features.length) facts.push(`Included: ${features.join(", ")}`);
  if (batch.accessType === "free") facts.push("Access: free");
  else {
    const plans = (batch.plans || []).filter((p) => p.isActive !== false);
    facts.push(`Access: paid${plans.length ? ` (plans: ${plans.map(planLine).join("; ")})` : ""}`);
    if (batch.trialDays) facts.push(`Free trial: ${batch.trialDays} days`);
  }
  return { title: batch.name, facts, current: batch.description || "" };
};

const programFacts = async (programId) => {
  const Program = require("../models/programModel");
  const Batch = require("../models/batchModel");
  if (!mongoose.isValidObjectId(programId)) return null;
  const program = await Program.findById(programId).lean();
  if (!program) return null;
  // All its batches: a new program's are often still inactive while being set up.
  const batches = await Batch.find({ program: program._id }).sort({ order: 1, name: 1 }).select("_id").limit(12).lean();
  const facts = [`Program: ${program.title}`, `Batches in it: ${batches.length}`];
  for (const b of batches) {
    const f = await batchFacts(b._id);
    if (f) facts.push(`- ${f.facts.filter((x) => !x.startsWith("Program:")).join(". ")}`);
  }
  return { title: program.title, facts, current: program.description || "" };
};

const courseFacts = (kind, id) => (kind === "program" ? programFacts(id) : batchFacts(id));

module.exports = { courseFacts, batchFacts, programFacts };
