const asyncHandler = require("express-async-handler");
const Program = require("../../models/programModel");
const Batch = require("../../models/batchModel");
const { shape: shapeMedia } = require("./mediaController");

const UPDATABLE = ["title", "description", "icon", "iconColor", "image", "order", "isActive"];

const pick = (body, fields) =>
  fields.reduce((acc, key) => {
    if (body[key] !== undefined) acc[key] = body[key];
    return acc;
  }, {});

// A program's image is a Media reference, same as Notice.coverImage — never
// returned as a bare ObjectId (see the doc.coverImage lesson in
// noticeController.js: a shaping function handed an unpopulated ref reads
// undefined off it and produces a broken image with no error). null when
// unset, same "no image, use the placeholder" meaning as Notice.
const shapeProgram = async (program) => {
  const doc = program.toObject ? program.toObject() : program;
  return { ...doc, image: doc.image ? await shapeMedia(doc.image) : null };
};

//@desc   List programs
//@route  GET /api/programs
//@access Private
const getPrograms = asyncHandler(async (req, res) => {
  const query = req.query.includeInactive === "true" ? {} : { isActive: true };

  const programs = await Program.find(query).sort({ order: 1, title: 1 }).populate("image").lean();

  // Batch counts are what a teacher scans this list for, so they come with it
  // rather than costing one request per row.
  const counts = await Batch.aggregate([
    { $group: { _id: "$program", total: { $sum: 1 }, active: { $sum: { $cond: ["$isActive", 1, 0] } } } },
  ]);

  const byProgram = counts.reduce((acc, c) => {
    acc[String(c._id)] = c;
    return acc;
  }, {});

  const shaped = await Promise.all(programs.map((p) => shapeProgram(p)));

  res.status(200).json(
    shaped.map((p) => ({
      ...p,
      batchCount: byProgram[String(p._id)] ? byProgram[String(p._id)].total : 0,
      activeBatchCount: byProgram[String(p._id)] ? byProgram[String(p._id)].active : 0,
    }))
  );
});

//@desc   Get one program with its batches
//@route  GET /api/programs/:id
//@access Private
const getProgram = asyncHandler(async (req, res) => {
  const program = await Program.findById(req.params.id).populate("image");

  if (!program) {
    res.status(404);
    throw new Error("Program not found.");
  }

  const batches = await Batch.find({ program: program._id })
    .populate("subjects", "title slug")
    .sort({ name: 1 });

  res.status(200).json({ program: await shapeProgram(program), batches });
});

//@desc   Create a program
//@route  POST /api/programs
//@access Private, admin
const createProgram = asyncHandler(async (req, res) => {
  const { title } = req.body;

  if (!title) {
    res.status(400);
    throw new Error("A program title is required.");
  }

  const program = await Program.create(pick(req.body, UPDATABLE));
  await program.populate("image");
  res.status(201).json(await shapeProgram(program));
});

//@desc   Update a program
//@route  PUT /api/programs/:id
//@access Private, admin
const updateProgram = asyncHandler(async (req, res) => {
  const program = await Program.findById(req.params.id);

  if (!program) {
    res.status(404);
    throw new Error("Program not found.");
  }

  Object.assign(program, pick(req.body, UPDATABLE));
  await program.save();
  await program.populate("image");

  res.status(200).json(await shapeProgram(program));
});

//@desc   Delete a program
//@route  DELETE /api/programs/:id
//@access Private, admin
const deleteProgram = asyncHandler(async (req, res) => {
  const program = await Program.findById(req.params.id);

  if (!program) {
    res.status(404);
    throw new Error("Program not found.");
  }

  // The original deleted every batch under the program, which would have
  // silently revoked access for everyone who had paid for one of them.
  const batches = await Batch.countDocuments({ program: program._id });

  if (batches > 0) {
    res.status(409);
    throw new Error(
      `This program still has ${batches} batch${batches === 1 ? "" : "es"}. Move or delete them first, or deactivate the program instead.`
    );
  }

  await program.deleteOne();
  res.status(200).json({ message: "Program deleted." });
});

// @desc   Reorder programs (global order)
// @route  PUT /api/programs/reorder
// @access Private, admin
const reorderPrograms = asyncHandler(async (req, res) => {
  const { ids } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400);
    throw new Error("Send the program ids in their new order.");
  }

  const count = await Program.countDocuments({ _id: { $in: ids } });
  if (count !== ids.length) {
    res.status(400);
    throw new Error("Every id must be a valid program.");
  }

  await Program.bulkWrite(
    ids.map((id, index) => ({
      updateOne: { filter: { _id: id }, update: { order: index } },
    }))
  );

  res.status(200).json({ message: "Order saved." });
});

module.exports = {
  getPrograms,
  getProgram,
  createProgram,
  updateProgram,
  deleteProgram,
  reorderPrograms,
};
