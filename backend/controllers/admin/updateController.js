const asyncHandler = require("express-async-handler");
const Update = require("../../models/updateModel");

//@desc   All updates, newest first — the editor needs inactive ones too,
//        unlike the public feed which only shows active, published ones.
//@route  GET /api/updates?page=&limit=
//@access Private (owner, admin)
const getUpdates = asyncHandler(async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Math.min(Number(req.query.limit) || 30, 100);

  const [updates, total] = await Promise.all([
    Update.find().sort({ publishedAt: -1 }).skip((page - 1) * limit).limit(limit),
    Update.countDocuments(),
  ]);

  res.status(200).json({ updates, total, page, pages: Math.ceil(total / limit) });
});

//@desc   Create an update
//@route  POST /api/updates
//@access Private (owner, admin)
const createUpdate = asyncHandler(async (req, res) => {
  const { title, body, link, isActive, publishedAt } = req.body;

  if (!title || !title.trim()) {
    res.status(400);
    throw new Error("Give this update a title.");
  }

  const update = await Update.create({
    title: title.trim(),
    body: body || "",
    link: link || null,
    isActive: isActive !== false,
    publishedAt: publishedAt || Date.now(),
  });

  res.status(201).json(update);
});

//@desc   Edit an update
//@route  PUT /api/updates/:id
//@access Private (owner, admin)
const updateUpdate = asyncHandler(async (req, res) => {
  const update = await Update.findById(req.params.id);
  if (!update) {
    res.status(404);
    throw new Error("Update not found.");
  }

  const { title, body, link, isActive, publishedAt } = req.body;
  if (title !== undefined) update.title = title.trim();
  if (body !== undefined) update.body = body;
  if (link !== undefined) update.link = link || null;
  if (isActive !== undefined) update.isActive = isActive;
  if (publishedAt !== undefined) update.publishedAt = publishedAt;

  await update.save();
  res.status(200).json(update);
});

//@desc   Delete an update
//@route  DELETE /api/updates/:id
//@access Private (owner, admin)
const deleteUpdate = asyncHandler(async (req, res) => {
  const update = await Update.findById(req.params.id);
  if (!update) {
    res.status(404);
    throw new Error("Update not found.");
  }

  await update.deleteOne();
  res.status(200).json({ message: "Removed." });
});

module.exports = { getUpdates, createUpdate, updateUpdate, deleteUpdate };
