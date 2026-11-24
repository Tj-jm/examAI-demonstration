const asyncHandler = require("express-async-handler");
const { outlineFor } = require("../../utils/courseOutline");
const { batchQuestionScope, subjectIds } = require("../../utils/batchSubjects");
const Subject = require("../../models/subjectModel");
const Batch = require("../../models/batchModel");
const Program = require("../../models/programModel");
const Purchase = require("../../models/purchaseModel");
const Trial = require("../../models/trialModel");
const Doubt = require("../../models/doubtModel");
const Exam = require("../../models/examModel");
const Lecture = require("../../models/lectureModel");
const { Question } = require("../../models/questionModel");
const Topic = require("../../models/topicModel");
const Chapter = require("../../models/chapterModel");
const storage = require("../../adapters/storage");

const UPDATABLE = [
  "name",
  "year",
  "slug",
  "subjects",
  "archiveAuthorities",
  "accessType",
  "trialDays",
  "trialWarningDays",
  "features",
  "isActive",
  "teachers",
  "graders",
  "icon",
  "description",
  "aiLimits",
  "doubtLimits",
];

const pick = (body, fields) =>
  fields.reduce((acc, key) => {
    if (body[key] !== undefined) acc[key] = body[key];
    return acc;
  }, {});

//@desc   List batches
//@route  GET /api/batches
//@access Private
const getBatches = asyncHandler(async (req, res) => {
  const { program, search } = req.query;

  const query = {};
  if (program) query.program = program;
  if (search) query.name = { $regex: search, $options: "i" };
  if (req.query.includeInactive !== "true") query.isActive = true;
  // A teacher only ever sees batches they're actually assigned to teach —
  // the gate (representativeGate.js) controls which paths this role can
  // reach at all, but reaching /api/batches is shared with doubtSolver's
  // read-only dropdown use, so the actual row-level scoping has to happen
  // here, not there. Being on this list is itself an owner/admin action
  // (updateBatch's own "teachers" guard), never something a teacher can
  // grant themselves.
  if (req.user.role === "teacher") query.teachers = req.user._id;
  // A grader never actually reaches this route in practice — restrictedRoleGate
  // keeps this role to /api/grading only, and the submission responses there
  // already carry the batch name inline — but scoped the same way regardless,
  // rather than leaving a hole here if that gate ever widens.
  else if (req.user.role === "grader") query.graders = req.user._id;

  const batches = await Batch.find(query)
    .populate("program", "title icon iconColor")
    .populate("subjects", "title slug")
    .populate("teachers", "name email role")
    .populate("graders", "name email role")
    .sort({ order: 1, name: 1 });

  res.status(200).json(batches);
});

//@desc   Get one batch with what is assigned to it
//@route  GET /api/batches/:id
//@access Private
const getBatch = asyncHandler(async (req, res) => {
  const batch = await Batch.findById(req.params.id)
    .populate("program", "title icon iconColor")
    .populate("subjects", "title slug")
    .populate("teachers", "name email role")
    .populate("graders", "name email role")
    .populate("archiveAuthorities", "name shortName type");

  if (!batch) {
    res.status(404);
    throw new Error("Batch not found.");
  }

  const [examCount, lectureCount, questionCount, activeStudents] = await Promise.all([
    // createdByStudent: null — a batch's exam count should read as "how
    // many papers has staff put together", not include any legacy practice
    // exam left over from before those stopped being real Exam documents.
    Exam.countDocuments({ batches: batch._id, createdByStudent: null }),
    Lecture.countDocuments({ batches: batch._id }),
    Question.countDocuments({ batches: batch._id, status: "published", ...Question.IN_BANK }),
    Purchase.countDocuments({
      batch: batch._id,
      status: "complete",
      endDate: { $gte: new Date() },
    }),
  ]);

  res.status(200).json({
    batch,
    assigned: { exams: examCount, lectures: lectureCount, questions: questionCount },
    activeStudents,
  });
});

//@desc   Create a batch
//@route  POST /api/batches
//@access Private, admin
const createBatch = asyncHandler(async (req, res) => {
  const { name, program } = req.body;

  if (!name || !program) {
    res.status(400);
    throw new Error("A name and program are required.");
  }

  const parent = await Program.findById(program);
  if (!parent) {
    res.status(404);
    throw new Error("Program not found.");
  }

  // Appended after every existing sibling rather than left at the default
  // 0, which would otherwise sort a brand-new batch above ones an admin has
  // already arranged on purpose.
  const siblingCount = await Batch.countDocuments({ program: parent._id });

  const batch = await Batch.create({
    ...pick(req.body, UPDATABLE),
    program: parent._id,
    order: siblingCount,
    plans: Array.isArray(req.body.plans) ? req.body.plans : [],
  });

  res.status(201).json(batch);
});

//@desc   Duplicate a batch
//@route  POST /api/batches/:id/duplicate
//@access Private, admin
// Copies everything that defines the batch — subjects, features, limits,
// team, and its plans (pricing is part of the batch's own definition, not
// purchase history, so it's fine to carry over). The copy starts inactive
// and with nobody enrolled, so it cannot go live or take payments by
// accident before it's reviewed.
const duplicateBatch = asyncHandler(async (req, res) => {
  const source = await Batch.findById(req.params.id).lean();

  if (!source) {
    res.status(404);
    throw new Error("Batch not found.");
  }

  delete source._id;
  delete source.createdAt;
  delete source.updatedAt;
  delete source.__v;
  if (Array.isArray(source.plans)) {
    source.plans = source.plans.map((plan) => {
      const { _id, ...rest } = plan;
      return rest;
    });
  }

  const siblingCount = await Batch.countDocuments({ program: source.program });

  const copy = await Batch.create({
    ...source,
    name: req.body.name || `${source.name} (copy)`,
    isActive: false,
    order: siblingCount,
  });

  res.status(201).json(copy);
});

//@desc   Update a batch
//@route  PUT /api/batches/:id
//@access Private, admin
const updateBatch = asyncHandler(async (req, res) => {
  const batch = await Batch.findById(req.params.id);

  if (!batch) {
    res.status(404);
    throw new Error("Batch not found.");
  }

  // Plans are edited through their own endpoints so a whole-object PUT cannot
  // wipe or silently reprice them.
  Object.assign(batch, pick(req.body, UPDATABLE));

  if (req.body.program && String(req.body.program) !== String(batch.program)) {
    const parent = await Program.findById(req.body.program);
    if (!parent) {
      res.status(404);
      throw new Error("Program not found.");
    }
    batch.program = parent._id;
  }

  await batch.save();
  res.status(200).json(batch);
});

//@desc   Reorder batches within one program
//@route  PUT /api/batches/reorder
//@access Private, admin
// Scoped to a single program rather than global like the lecture pool's
// order — batches are already partitioned by program everywhere they're
// shown, so there's no cross-program merge to compute, just this program's
// full list of ids in their new order.
const reorderBatches = asyncHandler(async (req, res) => {
  const { program, ids } = req.body;

  if (!program || !Array.isArray(ids) || ids.length === 0) {
    res.status(400);
    throw new Error("Send the program and the batch ids in their new order.");
  }

  const count = await Batch.countDocuments({ _id: { $in: ids }, program });
  if (count !== ids.length) {
    res.status(400);
    throw new Error("Every id must belong to the given program.");
  }

  await Batch.bulkWrite(
    ids.map((id, index) => ({
      updateOne: { filter: { _id: id, program }, update: { order: index } },
    }))
  );

  res.status(200).json({ message: "Order saved." });
});

//@desc   Delete a batch
//@route  DELETE /api/batches/:id
//@access Private, admin
const deleteBatch = asyncHandler(async (req, res) => {
  const batch = await Batch.findById(req.params.id);

  if (!batch) {
    res.status(404);
    throw new Error("Batch not found.");
  }

  // Deleting a batch someone has paid for would destroy the record of that
  // payment along with their access.
  const purchases = await Purchase.countDocuments({ batch: batch._id });

  if (purchases > 0) {
    res.status(409);
    throw new Error(
      `This batch has ${purchases} purchase${purchases === 1 ? "" : "s"} against it and cannot be deleted. Deactivate it instead.`
    );
  }

  // Assignments are references held on the other documents, so they are
  // cleaned up rather than left pointing at a batch that no longer exists.
  // Exam/Lecture/Question hold `batches` as an array — one of several a
  // document can belong to — so losing this one just unassigns it. A
  // Doubt has a single `batch`, not an array; there is nothing to
  // unassign it to, so it is deleted outright rather than left orphaned
  // pointing at a batch that no longer exists. The confirm dialog in
  // Batches.jsx/BatchDetail.jsx says so explicitly before this ever runs.
  await Promise.all([
    Exam.updateMany({ batches: batch._id }, { $pull: { batches: batch._id } }),
    Lecture.updateMany({ batches: batch._id }, { $pull: { batches: batch._id } }),
    Question.updateMany({ batches: batch._id }, { $pull: { batches: batch._id } }),
    Trial.deleteMany({ batch: batch._id }),
    Doubt.deleteMany({ batch: batch._id }),
  ]);

  await batch.deleteOne();
  res.status(200).json({ message: "Batch deleted." });
});

//@desc   Add a plan to a batch
//@route  POST /api/batches/:id/plans
//@access Private, admin
// Currency codes are compared upper-case everywhere (gateway currency lists,
// plan lookups, webhook payloads), so they are normalised once on the way in
// rather than defensively at each comparison. A zero or negative amount is
// dropped rather than stored: a plan priced at 0 in one currency and 2000 in
// another is almost certainly a half-finished edit, and free access is
// already expressible through accessType.
const normalisePrices = (prices) => {
  if (!Array.isArray(prices)) return undefined;

  const seen = new Set();
  const out = [];

  for (const entry of prices) {
    const currency = String(entry?.currency || "").trim().toUpperCase();
    const amount = Number(entry?.amount);

    if (!currency || seen.has(currency)) continue;
    if (!Number.isFinite(amount) || amount <= 0) continue;

    seen.add(currency);
    out.push({ currency, amount });
  }

  return out;
};

const addPlan = asyncHandler(async (req, res) => {
  const batch = await Batch.findById(req.params.id);

  if (!batch) {
    res.status(404);
    throw new Error("Batch not found.");
  }

  const { label, price, durationDays, isInfinite, prices } = req.body;

  if (!label || price === undefined) {
    res.status(400);
    throw new Error("A plan needs a label and a price.");
  }

  if (batch.plans.some((p) => p.label === label)) {
    res.status(409);
    throw new Error("A plan with that label already exists on this batch.");
  }

  batch.plans.push({
    label,
    price,
    durationDays,
    isInfinite: Boolean(isInfinite),
    prices: normalisePrices(prices),
  });
  await batch.save();

  res.status(201).json(batch.plans[batch.plans.length - 1]);
});

//@desc   Update a plan
//@route  PUT /api/batches/:id/plans/:planId
//@access Private, admin
const updatePlan = asyncHandler(async (req, res) => {
  const batch = await Batch.findById(req.params.id);

  if (!batch) {
    res.status(404);
    throw new Error("Batch not found.");
  }

  const plan = batch.plans.id(req.params.planId);

  if (!plan) {
    res.status(404);
    throw new Error("Plan not found.");
  }

  // Purchases snapshot the plan they were bought under, so editing this one
  // changes what new buyers get and leaves existing terms untouched.
  Object.assign(plan, pick(req.body, ["label", "price", "durationDays", "isInfinite", "isActive"]));

  // Sent separately from the picked fields because an empty array is a
  // meaningful value here — "this plan is no longer sold in any other
  // currency" — and pick() would treat it the same as absent.
  if (req.body.prices !== undefined) {
    plan.prices = normalisePrices(req.body.prices);
  }
  await batch.save();

  res.status(200).json(plan);
});

//@desc   Remove a plan
//@route  DELETE /api/batches/:id/plans/:planId
//@access Private, admin
const deletePlan = asyncHandler(async (req, res) => {
  const batch = await Batch.findById(req.params.id);

  if (!batch) {
    res.status(404);
    throw new Error("Batch not found.");
  }

  const plan = batch.plans.id(req.params.planId);

  if (!plan) {
    res.status(404);
    throw new Error("Plan not found.");
  }

  // Existing purchases keep working because they hold their own copy of the
  // terms, but the historical record reads better with the plan still listed.
  const sold = await Purchase.countDocuments({
    batch: batch._id,
    "plan.label": plan.label,
  });

  if (sold > 0) {
    res.status(409);
    throw new Error(
      `${sold} purchase${sold === 1 ? " was" : "s were"} made on this plan. Deactivate it instead of deleting it.`
    );
  }

  plan.deleteOne();
  await batch.save();

  res.status(200).json({ message: "Plan removed." });
});

//@desc   Upload a custom icon image for a batch, replacing any preset choice
//@route  POST /api/batches/:id/icon
//@access Private (owner, admin — same as updateBatch)
const uploadBatchIcon = asyncHandler(async (req, res) => {
  const batch = await Batch.findById(req.params.id);
  if (!batch) {
    res.status(404);
    throw new Error("Batch not found.");
  }
  if (!req.file) {
    res.status(400);
    throw new Error("No file was received.");
  }

  const stored = await storage.store("batch-icons", req.file);
  const url = await storage.urlFor(stored.key, stored.driver);

  batch.icon = { kind: "custom", value: url };
  await batch.save();

  res.status(200).json({ icon: batch.icon });
});

//@desc   Which chapter-pools and topics actually have a question assigned
//        to this batch, and how many — the Content tab's own picker (and
//        the student-facing practice/topics list) each answer this
//        implicitly by which tiles happen to render; this is the same
//        computation, exposed directly so an admin can see the batch's
//        real coverage at a glance instead of clicking into every subject.
//        Counts published questions only; one still in review appears nowhere.
//@route  GET /api/batches/:id/content-coverage
//@access Private (owner, admin, or a teacher assigned to this batch)
const getContentCoverage = asyncHandler(async (req, res) => {
  const batch = await Batch.findById(req.params.id).select("_id outline subjects");
  if (!batch) {
    res.status(404);
    throw new Error("Batch not found.");
  }

  // Only the batch's ticked subjects count as covered — the same rule its
  // students see (utils/batchSubjects.js). Assigned questions in other
  // subjects are reported separately as hidden.
  const base = { ...batchQuestionScope(batch), status: "published" };
  const hiddenRows = await Question.aggregate([
    { $match: { batches: batch._id, status: "published", subject: { $nin: subjectIds(batch) } } },
    { $group: { _id: "$subject", count: { $sum: 1 } } },
  ]);
  const hiddenSubjects = await Subject.find({ _id: { $in: hiddenRows.map((r) => r._id).filter(Boolean) } }).select("title").lean();
  const hiddenTitle = new Map(hiddenSubjects.map((x) => [String(x._id), x.title]));
  const hidden = hiddenRows
    .map((r) => ({ _id: r._id, title: hiddenTitle.get(String(r._id)) || "No subject", count: r.count }))
    .sort((a, b) => b.count - a.count);

  const [byTopic, byPoolChapter] = await Promise.all([
    Question.aggregate([
      { $match: { ...base, topic: { $ne: null } } },
      { $group: { _id: "$topic", count: { $sum: 1 } } },
    ]),
    // A chapter-pool question (Question.topic === null) is filed straight
    // under a chapter — same convention every other chapter-pool query in
    // this codebase uses (practiceController.js's getTopics, etc.).
    Question.aggregate([
      { $match: { ...base, topic: null } },
      { $group: { _id: "$chapter", count: { $sum: 1 } } },
    ]),
  ]);

  const [topics, poolChapters] = await Promise.all([
    Topic.find({ _id: { $in: byTopic.map((t) => t._id) } })
      .populate({ path: "chapter", select: "title subject", populate: { path: "subject", select: "title" } })
      .select("title chapter"),
    Chapter.find({ _id: { $in: byPoolChapter.map((c) => c._id) } })
      .populate("subject", "title")
      .select("title subject"),
  ]);

  const countByTopic = new Map(byTopic.map((t) => [String(t._id), t.count]));
  const countByPoolChapter = new Map(byPoolChapter.map((c) => [String(c._id), c.count]));

  // subjectId -> { _id, title, chapters: Map(chapterId -> {...}) } — built
  // up from two different sources (topics and pool chapters) that can
  // point at the same chapter, so a chapter is only ever created once and
  // both sides fill in whichever half of it they have.
  const subjects = new Map();

  const ensureSubject = (doc) => {
    const key = String(doc._id);
    if (!subjects.has(key)) subjects.set(key, { _id: doc._id, title: doc.title, chapters: new Map() });
    return subjects.get(key);
  };

  const ensureChapter = (subjectEntry, doc) => {
    const key = String(doc._id);
    if (!subjectEntry.chapters.has(key)) {
      subjectEntry.chapters.set(key, { _id: doc._id, title: doc.title, chapterPoolCount: 0, topics: [] });
    }
    return subjectEntry.chapters.get(key);
  };

  for (const topic of topics) {
    // A topic whose chapter or subject was since deleted shouldn't crash
    // this screen — it just can't be placed anywhere, so it's skipped.
    if (!topic.chapter?.subject) continue;
    const chapterEntry = ensureChapter(ensureSubject(topic.chapter.subject), topic.chapter);
    chapterEntry.topics.push({ _id: topic._id, title: topic.title, questionCount: countByTopic.get(String(topic._id)) || 0 });
  }

  for (const chapter of poolChapters) {
    if (!chapter.subject) continue;
    const chapterEntry = ensureChapter(ensureSubject(chapter.subject), chapter);
    chapterEntry.chapterPoolCount = countByPoolChapter.get(String(chapter._id)) || 0;
  }

  // In the batch's outline order, the same order its students see.
  const ol = await outlineFor(batch);
  const allChapters = [...subjects.values()].flatMap((s) => [...s.chapters.values()]);
  await ol.prime({ subjects: [...subjects.keys()], chapters: allChapters.map((c) => c._id), topics: allChapters.flatMap((c) => c.topics.map((t) => t._id)) });
  const result = [...subjects.values()]
    .map((s) => ({
      _id: s._id,
      title: s.title,
      chapters: [...s.chapters.values()]
        .map((c) => ({ ...c, group: ol.group(c._id), topics: c.topics.sort(ol.byTopic((t) => t._id)) }))
        .sort(ol.byChapter((c) => c._id)),
    }))
    .sort(ol.bySubject((s) => s._id));

  res.status(200).json({ subjects: result, hidden });
});

module.exports = {
  getBatches,
  getBatch,
  createBatch,
  duplicateBatch,
  reorderBatches,
  updateBatch,
  deleteBatch,
  addPlan,
  updatePlan,
  deletePlan,
  uploadBatchIcon,
  getContentCoverage,
};
