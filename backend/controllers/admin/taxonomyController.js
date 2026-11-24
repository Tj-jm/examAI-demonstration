const asyncHandler = require("express-async-handler");
const Subject = require("../../models/subjectModel");
const Chapter = require("../../models/chapterModel");
const Topic = require("../../models/topicModel");
const { Question } = require("../../models/questionModel");
const Lecture = require("../../models/lectureModel");
const ExamAuthority = require("../../models/examAuthorityModel");
const storage = require("../../adapters/storage");

// The original cascaded deletes: removing a subject wiped every chapter,
// topic and question beneath it in one transaction. That is unrecoverable from
// a misclick, so a node with dependants is refused and the caller is told what
// is in the way. Deactivating is the soft path.

// AI questions kept only in a lecture quiz never block a delete: they follow
// their lecture instead. Each one under `scope` (a subject, chapter or topic
// being deleted) is refiled where its lecture is now, minus the node being
// deleted (a topic going away leaves it in the chapter pool). One whose
// lecture is gone can't be reached by anything and is deleted. Only a
// question with nowhere left to go is kept, and then still blocks the delete.
const rehomeQuizQuestions = async (scope, gone) => {
  const quizOnly = await Question.find({ ...scope, lectureQuizOnly: true }).select("_id aiMeta").lean();
  if (!quizOnly.length) return 0;
  const lectureIds = [...new Set(quizOnly.map((q) => q.aiMeta?.sourceRef).filter(Boolean))];
  const lectures = await Lecture.find({ _id: { $in: lectureIds.filter((id) => /^[a-f\d]{24}$/i.test(id)) } })
    .select("subject chapter topic").lean();
  const byId = new Map(lectures.map((l) => [String(l._id), l]));
  const orphans = [];
  let stuck = 0;
  for (const q of quizOnly) {
    const lecture = byId.get(String(q.aiMeta?.sourceRef));
    if (!lecture) { orphans.push(q._id); continue; }
    const same = (a, b) => a && b && String(a) === String(b);
    if (!lecture.chapter || same(lecture.chapter, gone.chapter) || same(lecture.subject, gone.subject)) { stuck += 1; continue; }
    await Question.updateOne({ _id: q._id }, {
      $set: { subject: lecture.subject, chapter: lecture.chapter, topic: same(lecture.topic, gone.topic) ? null : lecture.topic || null },
    });
  }
  if (orphans.length) await Question.deleteMany({ _id: { $in: orphans } });
  return stuck;
};

const pick = (body, fields) =>
  fields.reduce((acc, key) => {
    if (body[key] !== undefined) acc[key] = body[key];
    return acc;
  }, {});

// ---------------------------------------------------------------- subjects

//@desc   List subjects
//@route  GET /api/subjects
//@access Private
const getSubjects = asyncHandler(async (req, res) => {
  const query = req.query.includeInactive === "true" ? {} : { isActive: true };
  const subjects = await Subject.find(query).sort({ order: 1, title: 1 });
  res.status(200).json(subjects);
});

//@desc   Create a subject
//@route  POST /api/subjects
//@access Private, admin
const createSubject = asyncHandler(async (req, res) => {
  const { title, icon, iconColor, order } = req.body;

  if (!title) {
    res.status(400);
    throw new Error("A subject title is required.");
  }

  const subject = await Subject.create({ title, icon, iconColor, order });
  res.status(201).json(subject);
});

//@desc   Update a subject
//@route  PUT /api/subjects/:id
//@access Private, admin
const updateSubject = asyncHandler(async (req, res) => {
  const subject = await Subject.findById(req.params.id);

  if (!subject) {
    res.status(404);
    throw new Error("Subject not found.");
  }

  // Renaming only touches this document. Everything downstream references it
  // by id, so there is no cascading slug rewrite to perform.
  Object.assign(subject, pick(req.body, ["title", "icon", "iconColor", "order", "isActive"]));
  await subject.save();

  res.status(200).json(subject);
});

//@desc   Delete a subject
//@route  DELETE /api/subjects/:id
//@access Private, admin
const deleteSubject = asyncHandler(async (req, res) => {
  const subject = await Subject.findById(req.params.id);

  if (!subject) {
    res.status(404);
    throw new Error("Subject not found.");
  }

  const [chapters, bankQuestions] = await Promise.all([
    Chapter.countDocuments({ subject: subject._id }),
    Question.countDocuments({ subject: subject._id, ...Question.IN_BANK }),
  ]);
  const questions = chapters > 0 || bankQuestions > 0
    ? bankQuestions
    : bankQuestions + (await rehomeQuizQuestions({ subject: subject._id }, { subject: subject._id }));

  if (chapters > 0 || questions > 0) {
    res.status(409);
    throw new Error(
      `This subject still has ${chapters} chapters and ${questions} questions. Move or delete them first, or deactivate the subject instead.`
    );
  }

  await subject.deleteOne();
  res.status(200).json({ message: "Subject deleted." });
});

// ---------------------------------------------------------------- chapters

//@desc   List chapters, optionally by subject
//@route  GET /api/chapters
//@access Private
const getChapters = asyncHandler(async (req, res) => {
  const { subject, search } = req.query;

  const query = {};
  if (subject) query.subject = subject;
  if (search) query.title = { $regex: search, $options: "i" };
  if (req.query.includeInactive !== "true") query.isActive = true;

  const chapters = await Chapter.find(query)
    .populate("subject", "title slug")
    .sort({ order: 1, title: 1 });

  res.status(200).json(chapters);
});

//@desc   Create a chapter
//@route  POST /api/chapters
//@access Private
const createChapter = asyncHandler(async (req, res) => {
  const { title, subTitle, subject, section, order } = req.body;

  if (!title || !subject) {
    res.status(400);
    throw new Error("A title and subject are required.");
  }

  const parent = await Subject.findById(subject);
  if (!parent) {
    res.status(404);
    throw new Error("Subject not found.");
  }

  const chapter = await Chapter.create({ title, subTitle, subject, section, order });
  res.status(201).json(chapter);
});

//@desc   Update a chapter
//@route  PUT /api/chapters/:id
//@access Private
const updateChapter = asyncHandler(async (req, res) => {
  const chapter = await Chapter.findById(req.params.id);

  if (!chapter) {
    res.status(404);
    throw new Error("Chapter not found.");
  }

  Object.assign(
    chapter,
    pick(req.body, ["title", "subTitle", "section", "order", "isActive"])
  );
  await chapter.save();

  res.status(200).json(chapter);
});

//@desc   Delete a chapter
//@route  DELETE /api/chapters/:id
//@access Private
const deleteChapter = asyncHandler(async (req, res) => {
  const chapter = await Chapter.findById(req.params.id);

  if (!chapter) {
    res.status(404);
    throw new Error("Chapter not found.");
  }

  const [topics, bankQuestions, lectures] = await Promise.all([
    Topic.countDocuments({ chapter: chapter._id }),
    Question.countDocuments({ chapter: chapter._id, ...Question.IN_BANK }),
    Lecture.countDocuments({ chapter: chapter._id }),
  ]);
  const questions = topics > 0 || bankQuestions > 0 || lectures > 0
    ? bankQuestions
    : bankQuestions + (await rehomeQuizQuestions({ chapter: chapter._id }, { chapter: chapter._id }));

  if (topics > 0 || questions > 0 || lectures > 0) {
    res.status(409);
    throw new Error(
      `This chapter still has ${topics} topics, ${questions} questions and ${lectures} lectures. Move or delete them first, or deactivate the chapter instead.`
    );
  }

  await chapter.deleteOne();
  res.status(200).json({ message: "Chapter deleted." });
});

// ------------------------------------------------------------------ topics

//@desc   List topics, optionally by chapter or subject
//@route  GET /api/topics
//@access Private
const getTopics = asyncHandler(async (req, res) => {
  const { chapter, subject, search } = req.query;

  const query = {};
  if (chapter) query.chapter = chapter;
  if (subject) query.subject = subject;
  if (search) query.title = { $regex: search, $options: "i" };
  if (req.query.includeInactive !== "true") query.isActive = true;

  const topics = await Topic.find(query)
    .populate("chapter", "title section")
    .sort({ order: 1, title: 1 });

  res.status(200).json(topics);
});

//@desc   Create a topic
//@route  POST /api/topics
//@access Private
const createTopic = asyncHandler(async (req, res) => {
  const { title, subTitle, chapter, order } = req.body;

  if (!title || !chapter) {
    res.status(400);
    throw new Error("A title and chapter are required.");
  }

  const parent = await Chapter.findById(chapter);
  if (!parent) {
    res.status(404);
    throw new Error("Chapter not found.");
  }

  // subject is denormalised from the chapter so topic queries do not need a
  // join, and it can never disagree with the chapter because it is never
  // accepted from the request body.
  const topic = await Topic.create({
    title,
    subTitle,
    chapter,
    subject: parent.subject,
    order,
  });

  res.status(201).json(topic);
});

//@desc   Update a topic
//@route  PUT /api/topics/:id
//@access Private
const updateTopic = asyncHandler(async (req, res) => {
  const topic = await Topic.findById(req.params.id);

  if (!topic) {
    res.status(404);
    throw new Error("Topic not found.");
  }

  Object.assign(topic, pick(req.body, ["title", "subTitle", "order", "isActive"]));
  await topic.save();

  res.status(200).json(topic);
});

//@desc   Delete a topic
//@route  DELETE /api/topics/:id
//@access Private
const deleteTopic = asyncHandler(async (req, res) => {
  const topic = await Topic.findById(req.params.id);

  if (!topic) {
    res.status(404);
    throw new Error("Topic not found.");
  }

  const bankQuestions = await Question.countDocuments({ topic: topic._id, ...Question.IN_BANK });
  const questions = bankQuestions > 0
    ? bankQuestions
    : await rehomeQuizQuestions({ topic: topic._id }, { topic: topic._id });

  if (questions > 0) {
    res.status(409);
    throw new Error(
      `This topic still has ${questions} questions. Move or delete them first, or deactivate the topic instead.`
    );
  }

  await topic.deleteOne();
  res.status(200).json({ message: "Topic deleted." });
});

// ------------------------------------------------------------- authorities

//@desc   List exam authorities (boards, entrance exams, textbooks)
//@route  GET /api/taxonomy/authorities
//@access Private
const getAuthorities = asyncHandler(async (req, res) => {
  const query = req.query.includeInactive === "true" ? {} : { isActive: true };
  const authorities = await ExamAuthority.find(query).sort({ order: 1, name: 1 });
  res.status(200).json(authorities);
});

//@desc   The public archive in numbers: questions per board/exam/book, and
//        the years they come from (for one board when ?authority= is set)
//@route  GET /api/taxonomy/authorities/archive-stats?authority=&subject=
//@access Private
const getArchiveStats = asyncHandler(async (req, res) => {
  const { Types } = require("mongoose");
  const base = { isPublic: true, status: "published", ...Question.IN_BANK };
  if (req.query.subject && Types.ObjectId.isValid(String(req.query.subject))) base.subject = new Types.ObjectId(String(req.query.subject));
  const authority = req.query.authority && Types.ObjectId.isValid(String(req.query.authority)) ? new Types.ObjectId(String(req.query.authority)) : null;

  const [total, perAuthority, perYear] = await Promise.all([
    Question.countDocuments(base),
    Question.aggregate([
      { $match: base },
      { $unwind: "$sources" },
      { $group: { _id: { q: "$_id", a: "$sources.authority" } } },
      { $group: { _id: "$_id.a", count: { $sum: 1 } } },
    ]),
    Question.aggregate([
      { $match: authority ? { ...base, "sources.authority": authority } : base },
      { $unwind: "$sources" },
      ...(authority ? [{ $match: { "sources.authority": authority } }] : []),
      { $unwind: "$sources.years" },
      { $group: { _id: { q: "$_id", y: "$sources.years" } } },
      { $group: { _id: "$_id.y", count: { $sum: 1 } } },
      { $sort: { _id: -1 } },
    ]),
  ]);

  res.status(200).json({
    total,
    byAuthority: Object.fromEntries(perAuthority.map((r) => [String(r._id), r.count])),
    years: perYear.filter((r) => Number.isInteger(r._id)).map((r) => ({ year: r._id, count: r.count })),
  });
});

//@desc   Create an exam authority
//@route  POST /api/taxonomy/authorities
//@access Private, owner/admin
const createAuthority = asyncHandler(async (req, res) => {
  const { name, shortName, region, type, order } = req.body;

  if (!name) {
    res.status(400);
    throw new Error("An authority name is required.");
  }

  const authority = await ExamAuthority.create({ name, shortName, region, type, order });
  res.status(201).json(authority);
});

//@desc   Update an exam authority
//@route  PUT /api/taxonomy/authorities/:id
//@access Private, owner/admin
const updateAuthority = asyncHandler(async (req, res) => {
  const authority = await ExamAuthority.findById(req.params.id);

  if (!authority) {
    res.status(404);
    throw new Error("Authority not found.");
  }

  Object.assign(
    authority,
    pick(req.body, ["name", "shortName", "region", "type", "order", "isActive", "icon"])
  );
  await authority.save();

  res.status(200).json(authority);
});

//@desc   Upload a custom icon image for an authority, replacing any preset choice
//@route  POST /api/taxonomy/authorities/:id/icon
//@access Private, owner/admin
const uploadAuthorityIcon = asyncHandler(async (req, res) => {
  const authority = await ExamAuthority.findById(req.params.id);
  if (!authority) {
    res.status(404);
    throw new Error("Authority not found.");
  }
  if (!req.file) {
    res.status(400);
    throw new Error("No file was received.");
  }

  const stored = await storage.store("authority-icons", req.file);
  const url = await storage.urlFor(stored.key, stored.driver);

  authority.icon = { kind: "custom", value: url };
  await authority.save();

  res.status(200).json({ icon: authority.icon });
});

//@desc   Delete an exam authority
//@route  DELETE /api/taxonomy/authorities/:id
//@access Private, owner/admin
const deleteAuthority = asyncHandler(async (req, res) => {
  const authority = await ExamAuthority.findById(req.params.id);

  if (!authority) {
    res.status(404);
    throw new Error("Authority not found.");
  }

  const questions = await Question.countDocuments({ "sources.authority": authority._id });

  if (questions > 0) {
    res.status(409);
    throw new Error(
      `This authority still has ${questions} questions filed under it. Move or delete them first, or deactivate the authority instead.`
    );
  }

  await authority.deleteOne();
  res.status(200).json({ message: "Authority deleted." });
});

//@desc   Full tree for pickers and navigation
//@route  GET /api/taxonomy/tree
//@access Private
const getTree = asyncHandler(async (req, res) => {
  const [subjects, chapters, topics] = await Promise.all([
    Subject.find({ isActive: true }).sort({ order: 1, title: 1 }).lean(),
    Chapter.find({ isActive: true }).sort({ order: 1, title: 1 }).lean(),
    Topic.find({ isActive: true }).sort({ order: 1, title: 1 }).lean(),
  ]);

  const topicsByChapter = topics.reduce((acc, topic) => {
    const key = String(topic.chapter);
    (acc[key] = acc[key] || []).push(topic);
    return acc;
  }, {});

  const chaptersBySubject = chapters.reduce((acc, chapter) => {
    const key = String(chapter.subject);
    (acc[key] = acc[key] || []).push({
      ...chapter,
      topics: topicsByChapter[String(chapter._id)] || [],
    });
    return acc;
  }, {});

  const tree = subjects.map((subject) => ({
    ...subject,
    chapters: chaptersBySubject[String(subject._id)] || [],
  }));

  res.status(200).json(tree);
});

module.exports = {
  getSubjects,
  createSubject,
  updateSubject,
  deleteSubject,
  getChapters,
  createChapter,
  updateChapter,
  deleteChapter,
  getTopics,
  createTopic,
  updateTopic,
  deleteTopic,
  getAuthorities,
  getArchiveStats,
  createAuthority,
  updateAuthority,
  uploadAuthorityIcon,
  deleteAuthority,
  getTree,
};
