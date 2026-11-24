const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const InterviewSet = require("../../models/interviewSetModel");
const Lecture = require("../../models/lectureModel");
const ai = require("../../ai/service");
const prompts = require("../../ai/prompts");
const schemas = require("../../ai/schemas");

// Interviews students practise (Interview practice → Interviews). See
// interviewSetModel.js and app/interviewController.js.

const KINDS = ["viva", "admission", "job", "scholarship", "other"];
const clip = (v, n) => String(v ?? "").trim().slice(0, n);
const ids = (list) => (Array.isArray(list) ? list.filter((x) => mongoose.isValidObjectId(x)) : []);

const clean = (b) => {
  const out = {};
  if (b.title !== undefined) out.title = clip(b.title, 120);
  if (KINDS.includes(b.kind)) out.kind = b.kind;
  if (b.brief !== undefined) out.brief = clip(b.brief, 2000);
  if (Array.isArray(b.interviewers)) {
    out.interviewers = b.interviewers.slice(0, 3)
      .map((p) => ({ name: clip(p?.name, 40), role: clip(p?.role, 60), style: clip(p?.style, 200) }))
      .filter((p) => p.name);
  }
  if (Array.isArray(b.criteria)) out.criteria = b.criteria.map((c) => clip(c, 60)).filter(Boolean).slice(0, 6);
  if (Array.isArray(b.mustAsk)) out.mustAsk = b.mustAsk.map((c) => clip(c, 300)).filter(Boolean).slice(0, 8);
  if (b.lecture !== undefined) out.lecture = mongoose.isValidObjectId(b.lecture) ? b.lecture : null;
  if (["English", "Bangla"].includes(b.language)) out.language = b.language;
  if (b.questions !== undefined) out.questions = Math.min(15, Math.max(2, Math.round(Number(b.questions) || 6)));
  if (b.batches !== undefined) out.batches = ids(b.batches);
  if (b.isPublished !== undefined) out.isPublished = Boolean(b.isPublished);
  return out;
};

//@desc   All interviews
//@route  GET /api/interviews
//@access Private (staff)
const listSets = asyncHandler(async (req, res) => {
  const sets = await InterviewSet.find({}).sort({ updatedAt: -1 }).populate("lecture", "title").populate("batches", "name").lean();
  res.status(200).json({ sets });
});

//@desc   Add an interview
//@route  POST /api/interviews
//@access Private (owner, admin, teacher)
const createSet = asyncHandler(async (req, res) => {
  const body = clean(req.body || {});
  if (!body.title) {
    res.status(400);
    throw new Error("Give the interview a title.");
  }
  const set = await InterviewSet.create({ ...body, createdBy: req.user?._id });
  res.status(201).json(set);
});

//@desc   Change an interview
//@route  PUT /api/interviews/:id
//@access Private (owner, admin, teacher)
const updateSet = asyncHandler(async (req, res) => {
  const set = mongoose.isValidObjectId(req.params.id) ? await InterviewSet.findById(req.params.id) : null;
  if (!set) {
    res.status(404);
    throw new Error("Interview not found.");
  }
  const body = clean(req.body || {});
  if (body.title === "") delete body.title;
  Object.assign(set, body);
  await set.save();
  res.status(200).json(set);
});

//@desc   Delete an interview (students' past sessions stay)
//@route  DELETE /api/interviews/:id
//@access Private (owner, admin, teacher)
const deleteSet = asyncHandler(async (req, res) => {
  const result = mongoose.isValidObjectId(req.params.id) ? await InterviewSet.deleteOne({ _id: req.params.id }) : { deletedCount: 0 };
  if (!result.deletedCount) {
    res.status(404);
    throw new Error("Interview not found.");
  }
  res.status(200).json({ deleted: true });
});

//@desc   AI drafts an interview from a description or a lecture (not saved)
//@route  POST /api/interviews/draft  { description, lecture }
//@access Private (owner, admin, teacher)
const draftSet = asyncHandler(async (req, res) => {
  const description = clip(req.body.description, 800);
  let lecture = null;
  let excerpts = [];
  if (mongoose.isValidObjectId(req.body.lecture)) {
    lecture = await Lecture.findById(req.body.lecture).select("title").lean();
    if (lecture) excerpts = await require("../app/poraController").materialOf(lecture._id);
  }
  if (!description && !lecture) {
    res.status(400);
    throw new Error("Describe the interview, or pick a lecture for a viva.");
  }
  const { data } = await ai.generate({
    feature: "interview-draft",
    schema: schemas.interviewDraft,
    user: req.user?._id,
    wrapLatex: false,
    maxTokens: 1500,
    ...prompts.interviewDraft({ description, lectureTitle: lecture?.title, excerpts }),
  });
  res.status(200).json({ ...clean(data), ...(lecture ? { lecture: lecture._id, kind: data.kind || "viva" } : {}) });
});

module.exports = { listSets, createSet, updateSet, deleteSet, draftSet };
