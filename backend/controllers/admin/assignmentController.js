const asyncHandler = require("express-async-handler");
const { orderLectures } = require("../../utils/courseOutline");
const mongoose = require("mongoose");
const Batch = require("../../models/batchModel");
const Exam = require("../../models/examModel");
const Lecture = require("../../models/lectureModel");
const { Question } = require("../../models/questionModel");
const { populateMedia, shapeField } = require("../../utils/shapeQuestion");

// Assignment is the only access rule. A batch sees a lecture, exam or question
// because that document lists the batch in its `batches` array — there is no
// implicit matching by subject, which is why batches have no type or
// fullSubject flag.
//
// The same operation is exposed from both ends: from a batch ("load this new
// batch up with content") and from an item ("push this mock to all my HSC
// batches"). Underneath both are $addToSet and $pull on the same field.

const RESOURCES = {
  exams: { model: Exam, label: "exam" },
  lectures: { model: Lecture, label: "lecture" },
  questions: { model: Question, label: "question" },
};

const resolve = (kind, res) => {
  const entry = RESOURCES[kind];
  if (!entry) {
    res.status(400);
    throw new Error(`Unknown resource "${kind}". Expected exams, lectures or questions.`);
  }
  return entry;
};

const toObjectIds = (ids, res) => {
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400);
    throw new Error("Send a list of ids.");
  }

  const invalid = ids.filter((id) => !mongoose.Types.ObjectId.isValid(id));
  if (invalid.length > 0) {
    res.status(400);
    throw new Error(`Not valid ids: ${invalid.join(", ")}`);
  }

  return ids.map((id) => new mongoose.Types.ObjectId(id));
};

// Shared by getAssigned and getAssignable — the batch page's one filter row
// (subject/chapter/topic/search) is used against both "what's already
// here" and "what could be added", so both need the exact same field-name
// mapping per kind. Exam stores subjects/topics as arrays (one exam can
// span several) and has no chapter field at all; lectures/questions use
// singular fields and do — a chapter filter is silently ignored for exams
// rather than matching a field that was never there.
// The admin picker (list and slide view alike) shows a question's image
// before its text, same as every student-facing screen — but questionImage
// and options[].image are bare ObjectId refs on the document, and a .url is
// only ever computed on demand via shapeMedia, never stored. Unlike
// forTaking/forReview in shapeQuestion.js, this keeps every other field
// (topic, subject, tags, createdAt, …) exactly as fetched — the picker needs
// all of it, not a student- or review-safe redaction of it.
const shapeQuestionMedia = async (question) => {
  await populateMedia(question);
  const q = question.toObject();
  q.questionImage = await shapeField(q.questionImage);
  if (q.type === "mcq" && Array.isArray(q.options)) {
    q.options = await Promise.all(
      q.options.map(async (o) => ({ ...o, image: await shapeField(o.image) }))
    );
  }
  return q;
};

const applyContentFilters = (kind, query, params) => {
  const isExam = kind === "exams";
  if (params.subject) query[isExam ? "subjects" : "subject"] = params.subject;
  // { topic: null } isolates the chapter pool — every question or lecture
  // filed straight under a chapter rather than one of its topics (see
  // questionModel.js's/lectureModel.js's own optional topic field). Same
  // topic=none sentinel questionController.js's getQuestions and
  // aiController.js's getReviewQueue already use. Exams have no chapter
  // field at all (see the comment above), so the sentinel is exam-only a
  // no-op, same as chapter itself below.
  if (!isExam && params.topic === "none") query.topic = null;
  else if (params.topic) query[isExam ? "topics" : "topic"] = params.topic;
  if (!isExam && params.chapter) query.chapter = params.chapter;
  // Only questions carry tags (Question.tags, a lowercase array) — exams
  // have nothing to match here and lectures use a single "tag" for
  // something else (an author grouping, not this filter row), so a tag
  // param is only ever applied for kind === "questions".
  if (kind === "questions" && params.tag) query.tags = params.tag.trim().toLowerCase();
  if (kind === "questions" && ["mcq", "mtf", "written", "passage"].includes(params.type)) query.type = params.type;
  if (params.search) {
    query[kind === "questions" ? "question" : "title"] = { $regex: params.search, $options: "i" };
  }
};

//@desc   What is assigned to a batch — optionally filtered by the same
//        subject/chapter/topic/search row the "assignable" picker uses, so
//        finding one item in a batch with a couple hundred assigned isn't
//        a scroll-and-squint exercise.
//@route  GET /api/batches/:id/assigned/:kind
//@access Private
const getAssigned = asyncHandler(async (req, res) => {
  const { model } = resolve(req.params.kind, res);

  const batch = await Batch.findById(req.params.id);
  if (!batch) {
    res.status(404);
    throw new Error("Batch not found.");
  }

  const page = Number(req.query.page) || 1;
  const limit = Math.min(Number(req.query.limit) || 50, 200);

  const filterQuery = { batches: batch._id };
  if (req.params.kind === "questions") filterQuery.status = "published";
  applyContentFilters(req.params.kind, filterQuery, req.query);

  // Exam has no "topic" field (only the plural "topics" array) — populating
  // a path that matches nothing in the schema throws in Mongoose 8
  // (StrictPopulate), not a silent no-op like older versions. That throw is
  // exactly what was turning every "exams" request here into a 500.
  let query = model.find(filterQuery);
  if (req.params.kind !== "exams") query = query.populate("topic", "title");

  // Lectures have a real, meaningful order (see Lecture.order and its
  // dedicated reorder endpoint) that students' own lecture list is sorted
  // by — this view should show the same order, not creation date, or an
  // admin reordering from here would have no way to tell whether it
  // actually changed anything a student sees. Exams and questions have no
  // such field, so they're unaffected.
  const sort = req.params.kind === "lectures" ? { order: 1, createdAt: -1 } : { createdAt: -1 };

  const isQuestions = req.params.kind === "questions";
  // Questions keep their real Mongoose documents here instead of .lean() —
  // shaping each one's media refs to a working url needs the instance
  // .populate() shapeQuestion.js uses (a lean object has no such method).
  // Exams and lectures have no image refs this card needs, so they stay
  // lean, same as before.
  //
  // Lectures come back in the batch's outline order — the exact order its
  // students see (utils/courseOutline.js) — so they're sorted whole, then
  // paged.
  if (req.params.kind === "lectures") {
    const all = await query.populate("chapter", "title").lean();
    const ol = await orderLectures(batch, all);
    const items = all.slice((page - 1) * limit, page * limit).map((l) => ({ ...l, group: l.chapter ? ol.group(l.chapter._id) : null }));
    res.status(200).json({ items, total: all.length, page, pages: Math.ceil(all.length / limit), groups: ol.groups });
    return;
  }

  const [rawItems, total] = await Promise.all([
    isQuestions
      ? query.sort(sort).skip((page - 1) * limit).limit(limit)
      : query.sort(sort).skip((page - 1) * limit).limit(limit).lean(),
    model.countDocuments(filterQuery),
  ]);
  const items = isQuestions ? await Promise.all(rawItems.map(shapeQuestionMedia)) : rawItems;

  res.status(200).json({ items, total, page, pages: Math.ceil(total / limit) });
});

// What could be added to a batch, as a query: not yet in it, matching the
// filter row. Shared by the picker list and "Add all matching".
const assignableFilter = (batch, kind, params) => {
  const isExam = kind === "exams";
  const query = { batches: { $ne: batch._id } };
  // A question appears nowhere until it passes review.
  if (kind === "questions") query.status = "published";

  // The batch's subjects filter the picker by default because that is almost
  // always what is wanted, but it is a query parameter rather than a rule:
  // a combined or revision batch has to be able to pull in anything. The new
  // subject/chapter/topic filter row on the batch page always sends
  // anySubject=true and its own explicit filters instead — this default only
  // still matters for any other caller of this endpoint.
  if (params.anySubject !== "true" && batch.subjects.length > 0) {
    query[isExam ? "subjects" : "subject"] = { $in: batch.subjects };
  }

  // Exam stores subjects/topics as arrays (one exam can span several) and has
  // no chapter field at all — a chapter filter is silently ignored for exams
  // rather than matching a field that was never there to begin with, which is
  // what querying {chapter: id} against a document with no chapter path did
  // before this: matched nothing, for every exam, regardless of the filter.
  applyContentFilters(kind, query, params);

  return query;
};

//@desc   What could be assigned to a batch but is not yet
//@route  GET /api/batches/:id/assignable/:kind
//@access Private
const getAssignable = asyncHandler(async (req, res) => {
  const { model } = resolve(req.params.kind, res);

  const batch = await Batch.findById(req.params.id);
  if (!batch) {
    res.status(404);
    throw new Error("Batch not found.");
  }

  const page = Number(req.query.page) || 1;
  const limit = Math.min(Number(req.query.limit) || 50, 200);

  const isExam = req.params.kind === "exams";
  const query = assignableFilter(batch, req.params.kind, req.query);

  let assignableQuery = model.find(query);
  if (!isExam) assignableQuery = assignableQuery.populate("topic", "title");

  const isQuestions = req.params.kind === "questions";
  const [rawItems, total] = await Promise.all([
    isQuestions
      ? assignableQuery.sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
      : assignableQuery.sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    model.countDocuments(query),
  ]);
  const items = isQuestions ? await Promise.all(rawItems.map(shapeQuestionMedia)) : rawItems;

  res.status(200).json({ items, total, page, pages: Math.ceil(total / limit) });
});

//@desc   Assign items to a batch
//@route  POST /api/batches/:id/assigned/:kind
//@access Private
const assignToBatch = asyncHandler(async (req, res) => {
  const { model, label } = resolve(req.params.kind, res);

  const batch = await Batch.findById(req.params.id);
  if (!batch) {
    res.status(404);
    throw new Error("Batch not found.");
  }

  const ids = toObjectIds(req.body.ids, res);

  // $addToSet rather than $push, so assigning something twice is a no-op
  // rather than a duplicate entry that later has to be pulled twice.
  const result = await model.updateMany(
    { _id: { $in: ids }, ...(req.params.kind === "questions" ? { status: "published" } : {}) },
    { $addToSet: { batches: batch._id } }
  );

  res.status(200).json({
    message: `Assigned ${result.modifiedCount} ${label}${result.modifiedCount === 1 ? "" : "s"}.`,
    matched: result.matchedCount,
    modified: result.modifiedCount,
  });
});

//@desc   Assign everything the filter row matches that the batch lacks.
//        Returns the ids so the page can undo it.
//@route  POST /api/batches/:id/assign-matching/:kind
//@access Private
const assignMatching = asyncHandler(async (req, res) => {
  const { model, label } = resolve(req.params.kind, res);

  const batch = await Batch.findById(req.params.id);
  if (!batch) {
    res.status(404);
    throw new Error("Batch not found.");
  }

  // Plain strings only, so a body can't slip an operator into the query.
  const params = {};
  for (const key of ["subject", "chapter", "topic", "tag", "type", "search", "anySubject"]) {
    if (typeof req.body?.[key] === "string" && req.body[key]) params[key] = req.body[key];
  }
  const query = assignableFilter(batch, req.params.kind, params);
  const ids = (await model.find(query).select("_id").lean()).map((d) => d._id);
  if (ids.length) await model.updateMany({ _id: { $in: ids } }, { $addToSet: { batches: batch._id } });

  res.status(200).json({
    message: `Assigned ${ids.length} ${label}${ids.length === 1 ? "" : "s"}.`,
    modified: ids.length,
    ids,
  });
});

//@desc   Unassign items from a batch
//@route  DELETE /api/batches/:id/assigned/:kind
//@access Private
const unassignFromBatch = asyncHandler(async (req, res) => {
  const { model, label } = resolve(req.params.kind, res);

  const batch = await Batch.findById(req.params.id);
  if (!batch) {
    res.status(404);
    throw new Error("Batch not found.");
  }

  const ids = toObjectIds(req.body.ids, res);

  const result = await model.updateMany(
    { _id: { $in: ids } },
    { $pull: { batches: batch._id } }
  );

  res.status(200).json({
    message: `Removed ${result.modifiedCount} ${label}${result.modifiedCount === 1 ? "" : "s"}.`,
    matched: result.matchedCount,
    modified: result.modifiedCount,
  });
});

//@desc   Set which batches an item belongs to
//@route  PUT /api/assignments/:kind/:itemId/batches
//@access Private
const setItemBatches = asyncHandler(async (req, res) => {
  const { model } = resolve(req.params.kind, res);

  const item = await model.findById(req.params.itemId);
  if (!item) {
    res.status(404);
    throw new Error("Item not found.");
  }

  const ids = Array.isArray(req.body.batchIds) ? req.body.batchIds : [];

  // Every id is checked to exist before anything is written, so a typo cannot
  // leave the item pointing at a batch that was never created.
  if (ids.length > 0) {
    const found = await Batch.countDocuments({ _id: { $in: ids } });
    if (found !== ids.length) {
      res.status(400);
      throw new Error("One or more of those batches does not exist.");
    }
  }

  // This is the one assignment endpoint with no single batch id in the url
  // — the batches being touched are the request body itself — so the
  // batch-scoped guard on the other routes can't apply here. Checked
  // inline instead, against every batch either being added or removed:
  // dropping an item from a batch is as much a content change as adding it
  // to one, so a teacher needs rights on both sides of the diff.
  if (!["owner", "admin"].includes(req.user.role)) {
    const touched = [...new Set([...ids, ...item.batches.map(String)])];
    const batches = await Batch.find({ _id: { $in: touched } }).select("teachers");
    if (batches.some((b) => !b.hasTeacher(req.user._id))) {
      res.status(403);
      throw new Error("You are not assigned to teach one or more of those batches.");
    }
  }

  item.batches = ids;
  await item.save();

  res.status(200).json({ _id: item._id, batches: item.batches });
});

//@desc   Copy every assignment from one batch to another
//@route  POST /api/batches/:id/copy-from/:sourceId
//@access Private
const copyAssignments = asyncHandler(async (req, res) => {
  const [target, source] = await Promise.all([
    Batch.findById(req.params.id),
    Batch.findById(req.params.sourceId),
  ]);

  if (!target || !source) {
    res.status(404);
    throw new Error("Batch not found.");
  }

  if (String(target._id) === String(source._id)) {
    res.status(400);
    throw new Error("Pick a different batch to copy from.");
  }

  // requireBatchTeacher on the route already covers :id (the target, being
  // written to) — this covers :sourceId, the one batch id this endpoint
  // touches that isn't in a position that guard checks.
  if (!["owner", "admin"].includes(req.user.role) && !source.hasTeacher(req.user._id)) {
    res.status(403);
    throw new Error("You are not assigned to teach the batch you're copying from.");
  }

  // Without this, setting up next term's batch means reassigning everything by
  // hand — the difference between two minutes and an afternoon.
  const kinds = Array.isArray(req.body.kinds) && req.body.kinds.length > 0
    ? req.body.kinds
    : Object.keys(RESOURCES);

  const summary = {};

  for (const kind of kinds) {
    const { model } = resolve(kind, res);

    const result = await model.updateMany(
      { batches: source._id },
      { $addToSet: { batches: target._id } }
    );

    summary[kind] = result.modifiedCount;
  }

  res.status(200).json({
    message: `Copied assignments from ${source.name}.`,
    copied: summary,
  });
});

module.exports = {
  getAssigned,
  getAssignable,
  assignToBatch,
  assignMatching,
  unassignFromBatch,
  setItemBatches,
  copyAssignments,
};