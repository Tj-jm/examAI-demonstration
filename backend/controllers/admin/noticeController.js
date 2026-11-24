const asyncHandler = require("express-async-handler");
const Notice = require("../../models/noticeModel");
const Student = require("../../models/studentModel");
const { shape: shapeMedia } = require("./mediaController");
const { notify } = require("../../utils/notify");
const { getActiveBatchStudentIds } = require("../../utils/batchMembers");

// Shared between create and update — a notice's cross-field rules cannot be
// expressed as ordinary Mongoose validators (they depend on more than one
// field at once), so they live here where the error can name exactly which
// rule was broken instead of a generic validation message.
const validate = ({ noticeType, batches, link, linkLabel }) => {
  if (noticeType === "batch" && (!Array.isArray(batches) || batches.length === 0)) {
    return "A batch notice needs at least one batch.";
  }

  if (Boolean(link) !== Boolean(linkLabel)) {
    return "A link needs a label, and a label needs a link — set both or neither.";
  }

  return null;
};

const shapeNotice = async (notice) => {
  const doc = notice.toObject();
  return {
    ...doc,
    coverImage: doc.coverImage ? await shapeMedia(doc.coverImage) : null,
    status: notice.status(),
  };
};

//@desc   Paginated notice list, filterable by type/batch/status/search —
//        the browsing screen the admin panel actually lives in day to day.
//@route  GET /api/admin/notices
//@access Private
const getNotices = asyncHandler(async (req, res) => {
  const { type, batch, status, search } = req.query;
  const page = Number(req.query.page) || 1;
  const limit = Math.min(Number(req.query.limit) || 20, 100);

  const query = {};
  if (type) query.noticeType = type;
  // Meaningful even without narrowing by type first — picking a batch here
  // implies "batch" notices, since "general" ones have none.
  if (batch) query.batches = batch;
  if (search) query.title = { $regex: search, $options: "i" };

  // Status is computed (draft/scheduled/live/expired), not stored, so it
  // filters via the same conditions status() itself checks rather than a
  // plain field match.
  const now = new Date();
  if (status === "draft") query.isPublished = false;
  if (status === "live") Object.assign(query, Notice.liveQuery({}, now));
  if (status === "scheduled") Object.assign(query, { isPublished: true, publishFrom: { $gt: now } });
  if (status === "expired") Object.assign(query, { isPublished: true, publishUntil: { $lt: now } });

  const [notices, total] = await Promise.all([
    Notice.find(query)
      .populate("batches", "name")
      .populate("coverImage")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Notice.countDocuments(query),
  ]);

  res.status(200).json({
    notices: await Promise.all(notices.map(shapeNotice)),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
  });
});

//@desc   One notice, for the editor
//@route  GET /api/admin/notices/:id
//@access Private
const getNotice = asyncHandler(async (req, res) => {
  const notice = await Notice.findById(req.params.id).populate("batches", "name").populate("coverImage");

  if (!notice) {
    res.status(404);
    throw new Error("Notice not found.");
  }

  res.status(200).json(await shapeNotice(notice));
});

const ALLOWED_FIELDS = [
  "title", "bodyMarkdown", "noticeType", "batches", "coverImage", "icon",
  "link", "linkLabel", "isPublished", "publishFrom", "publishUntil", "pushText",
  "featured",
];

const pick = (source, fields) =>
  Object.fromEntries(fields.filter((f) => source[f] !== undefined).map((f) => [f, source[f]]));

// Fires exactly once per notice, the first time it is found live after a
// save — see notifiedAt's own comment on the model for why a second edit
// must not re-trigger this. General fans out to every student on the
// platform; batch fans out to whoever currently has access to any of its
// batches, resolved the same way batchAccess itself would answer it (see
// utils/batchMembers.js) rather than a looser approximation.
const maybeNotify = async (notice) => {
  if (notice.notifiedAt || !notice.isLive()) return;

  const studentIds = notice.noticeType === "general"
    ? (await Student.find({}).select("_id")).map((s) => s._id)
    : [...new Set((await Promise.all(notice.batches.map(getActiveBatchStudentIds))).flat())];

  await notify(studentIds, "newNotice", {
    title: notice.title,
    body: notice.pushText || "A new notice was posted.",
    link: notice.noticeType === "general" ? "/" : `/batches/${notice.batches[0]}/notices`,
  });

  notice.notifiedAt = new Date();
  await notice.save();
};

//@desc   Create a notice
//@route  POST /api/admin/notices
//@access Private
const createNotice = asyncHandler(async (req, res) => {
  const body = pick(req.body, ALLOWED_FIELDS);

  // A general notice reaches every student — batches on it would be
  // misleading leftovers from switching the type dropdown mid-edit, not a
  // real scoping rule, so they are dropped rather than stored.
  if (body.noticeType === "general") body.batches = [];

  const error = validate(body);
  if (error) {
    res.status(400);
    throw new Error(error);
  }

  const notice = await Notice.create(body);
  await notice.populate("coverImage");
  await maybeNotify(notice);
  res.status(201).json(await shapeNotice(notice));
});

//@desc   Update a notice
//@route  PUT /api/admin/notices/:id
//@access Private
const updateNotice = asyncHandler(async (req, res) => {
  const notice = await Notice.findById(req.params.id);

  if (!notice) {
    res.status(404);
    throw new Error("Notice not found.");
  }

  const body = pick(req.body, ALLOWED_FIELDS);
  const merged = { ...notice.toObject(), ...body };
  if (merged.noticeType === "general") merged.batches = [];

  const error = validate(merged);
  if (error) {
    res.status(400);
    throw new Error(error);
  }

  Object.assign(notice, body);
  if (notice.noticeType === "general") notice.batches = [];
  await notice.save();
  await notice.populate("coverImage");
  await maybeNotify(notice);

  res.status(200).json(await shapeNotice(notice));
});

//@desc   Delete a notice
//@route  DELETE /api/admin/notices/:id
//@access Private
const deleteNotice = asyncHandler(async (req, res) => {
  const notice = await Notice.findById(req.params.id);

  if (!notice) {
    res.status(404);
    throw new Error("Notice not found.");
  }

  await notice.deleteOne();
  res.status(200).json({ message: "Notice deleted." });
});

module.exports = { getNotices, getNotice, createNotice, updateNotice, deleteNotice };
