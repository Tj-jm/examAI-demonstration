const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Batch = require("../../models/batchModel");
const Chapter = require("../../models/chapterModel");
const Topic = require("../../models/topicModel");
const Subject = require("../../models/subjectModel");
const Lecture = require("../../models/lectureModel");
const { Question } = require("../../models/questionModel");
const { sourceMatch } = require("../../utils/archiveSources");
const { outlineFor } = require("../../utils/courseOutline");
const { batchQuestionScope, subjectScope, inBatchSubjects } = require("../../utils/batchSubjects");

// The batch's course outline (batchModel's `outline`, read through
// utils/courseOutline.js): its named groups and the order of its subjects,
// chapters, topics and lectures. Everything a student sees for the batch
// sorts by it.

const MAX_GROUPS = 40;
const MAX_IDS = 5000;

const loadBatch = async (req, res) => {
  const batch = await Batch.findById(req.params.id);
  if (!batch) {
    res.status(404);
    throw new Error("Batch not found.");
  }
  return batch;
};

// What the outline lists for a chapter or topic outside the batch's ticked
// subjects: a chapter only while it has lectures here (lectures aren't
// filtered by subject), and in it only the topics those lectures use. Its
// questions never show, so nothing else of it does.
const outlineScope = (batch, lectures) => {
  const lectureChapters = new Set(lectures.map((l) => String(l.chapter)));
  const lectureTopics = new Set(lectures.filter((l) => l.topic).map((l) => String(l.topic)));
  const ticked = (chapter) => inBatchSubjects(batch, chapter.subject);
  return {
    showChapter: (chapter) => ticked(chapter) || lectureChapters.has(String(chapter._id)),
    showTopic: (topic, chapter) => Boolean(chapter) && (ticked(chapter) || lectureTopics.has(String(topic._id))),
  };
};

// Puts back the saved ids the outline didn't show (and so couldn't send),
// each after the id it followed before, so ticking a subject again brings
// its old order back.
const keepHidden = (next, prev, hidden) => {
  const out = [...next];
  const has = new Set(out);
  let after = null;
  for (const id of prev) {
    if (!has.has(id) && hidden(id)) {
      out.splice(after === null ? 0 : out.indexOf(after) + 1, 0, id);
      has.add(id);
    }
    if (has.has(id)) after = id;
  }
  return out;
};

const countBy = async (match, field) => {
  const rows = await Question.aggregate([{ $match: match }, { $group: { _id: `$${field}`, count: { $sum: 1 } } }]);
  return new Map(rows.filter((r) => r._id).map((r) => [String(r._id), r.count]));
};

//@desc   The batch's outline, with every chapter its content reaches, in order
//@route  GET /api/admin/batches/:id/outline
//@access Private (batch teacher)
const getOutline = asyncHandler(async (req, res) => {
  const batch = await loadBatch(req, res);

  // Published questions only: one still in review appears nowhere.
  // Questions only count in the batch's ticked subjects (what students see,
  // utils/batchSubjects.js); lectures aren't filtered by subject.
  const own = { ...batchQuestionScope(batch), status: "published" };
  const archive = (batch.archiveAuthorities || []).length
    ? { isPublic: true, status: "published", ...sourceMatch(batch.archiveAuthorities.map(String)), ...subjectScope(batch) }
    : null;

  const [syllabusChapters, lectures, ownByChapter, ownByTopic, archiveByChapter, archiveByTopic] = await Promise.all([
    (batch.subjects || []).length ? Chapter.find({ subject: { $in: batch.subjects } }).select("_id").lean() : [],
    Lecture.find({ batches: batch._id }).select("title chapter topic order createdAt isPublished").lean(),
    countBy(own, "chapter"),
    countBy(own, "topic"),
    archive ? countBy(archive, "chapter") : new Map(),
    archive ? countBy(archive, "topic") : new Map(),
  ]);

  const chapterIds = [...new Set([
    ...syllabusChapters.map((c) => String(c._id)),
    ...lectures.map((l) => String(l.chapter)),
    ...ownByChapter.keys(),
    ...archiveByChapter.keys(),
    ...(batch.outline?.chapters || []).map(String),
    ...(batch.outline?.groups || []).flatMap((g) => g.chapters.map(String)),
  ])].filter((id) => mongoose.isValidObjectId(id));

  const [allChapters, allTopics] = await Promise.all([
    Chapter.find({ _id: { $in: chapterIds } }).select("title subject order").lean(),
    Topic.find({ chapter: { $in: chapterIds } }).select("title chapter order").lean(),
  ]);
  const scope = outlineScope(batch, lectures);
  const chapters = allChapters.filter(scope.showChapter);
  const chapterById = new Map(chapters.map((c) => [String(c._id), c]));
  const topics = allTopics.filter((t) => scope.showTopic(t, chapterById.get(String(t.chapter))));
  const subjects = await Subject.find({ _id: { $in: [...new Set(chapters.map((c) => String(c.subject)))] } }).select("title").lean();

  const ol = await outlineFor(batch);
  await ol.prime({ chapters: chapters.map((c) => c._id), topics: topics.map((t) => t._id), subjects: subjects.map((s) => s._id) });
  const live = new Set(chapters.map((c) => String(c._id)));
  const placed = new Set([
    ...(batch.outline?.chapters || []).map(String),
    ...(batch.outline?.groups || []).flatMap((g) => g.chapters.map(String)),
  ]);
  const saved = placed.size > 0;

  const lecturesByChapter = new Map();
  lectures.sort(ol.byLecture());
  for (const l of lectures) {
    const key = String(l.chapter);
    if (!lecturesByChapter.has(key)) lecturesByChapter.set(key, []);
    lecturesByChapter.get(key).push({ _id: l._id, title: l.title, topic: l.topic || null, isPublished: l.isPublished });
  }
  const topicsByChapter = new Map();
  topics.sort(ol.byTopic((t) => t._id));
  for (const t of topics) {
    const key = String(t.chapter);
    if (!topicsByChapter.has(key)) topicsByChapter.set(key, []);
    topicsByChapter.get(key).push({ _id: t._id, title: t.title, questions: ownByTopic.get(String(t._id)) || 0, archive: archiveByTopic.get(String(t._id)) || 0 });
  }

  res.status(200).json({
    groups: ol.groups.map((g) => ({ ...g, chapters: (batch.outline?.groups?.find((x) => String(x._id) === g._id)?.chapters || []).map(String).filter((id) => live.has(id)) })),
    subjects: subjects.sort(ol.bySubject((s) => s._id)).map((s) => ({ _id: s._id, title: s.title })),
    chapters: chapters.sort(ol.byChapter((c) => c._id)).map((c) => {
      const id = String(c._id);
      return {
        _id: c._id,
        title: c.title,
        subject: c.subject,
        group: ol.group(id)?._id || null,
        isNew: saved && !placed.has(id),
        lectures: lecturesByChapter.get(id) || [],
        topics: topicsByChapter.get(id) || [],
        questions: ownByChapter.get(id) || 0,
        archive: archiveByChapter.get(id) || 0,
      };
    }),
    saved,
  });
});

const idList = (value, label, res) => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_IDS || !value.every((id) => mongoose.isValidObjectId(id))) {
    res.status(400);
    throw new Error(`The ${label} order isn't valid.`);
  }
  return [...new Set(value.map(String))];
};

// Merges the saved order of chapters, topics and subjects the outline hid
// (see outlineScope) into a new save, group places included.
const keepHiddenOrder = async (batch, outline) => {
  const prev = batch.outline || {};
  const prevGroups = (prev.groups || []).map((g) => ({ _id: String(g._id), chapters: (g.chapters || []).map(String) }));
  const prevChapters = (prev.chapters || []).map(String);
  const prevTopics = (prev.topics || []).map(String);
  const chapterIds = [...new Set([...prevChapters, ...prevGroups.flatMap((g) => g.chapters)])];
  if (!chapterIds.length && !prevTopics.length) return;

  const [lectures, topics] = await Promise.all([
    Lecture.find({ batches: batch._id }).select("chapter topic").lean(),
    Topic.find({ _id: { $in: prevTopics } }).select("chapter").lean(),
  ]);
  const chapters = await Chapter.find({ _id: { $in: [...new Set([...chapterIds, ...topics.map((t) => String(t.chapter))])] } }).select("subject").lean();
  const scope = outlineScope(batch, lectures);
  const chapterById = new Map(chapters.map((c) => [String(c._id), c]));
  const topicById = new Map(topics.map((t) => [String(t._id), t]));
  const hiddenChapter = (id) => chapterById.has(id) && !scope.showChapter(chapterById.get(id));
  const hiddenTopic = (id) => {
    const t = topicById.get(id);
    if (!t) return false;
    const c = chapterById.get(String(t.chapter));
    return !(c && scope.showChapter(c) && scope.showTopic(t, c));
  };

  outline.chapters = keepHidden(outline.chapters, prevChapters, hiddenChapter);
  outline.topics = keepHidden(outline.topics, prevTopics, hiddenTopic);
  outline.subjects = keepHidden(outline.subjects, (prev.subjects || []).map(String), (id) => !inBatchSubjects(batch, id));
  const taken = new Set(outline.groups.flatMap((g) => g.chapters));
  for (const g of outline.groups) {
    const old = prevGroups.find((p) => p._id === String(g._id));
    if (!old) continue;
    g.chapters = keepHidden(g.chapters, old.chapters, (id) => hiddenChapter(id) && !taken.has(id));
    g.chapters.forEach((id) => taken.add(id));
  }
};

//@desc   Save the batch's outline (an empty body resets it to the syllabus order)
//@route  PUT /api/admin/batches/:id/outline
//@access Private (batch teacher)
const saveOutline = asyncHandler(async (req, res) => {
  const batch = await loadBatch(req, res);
  const body = req.body || {};

  const rawGroups = body.groups === undefined ? [] : body.groups;
  if (!Array.isArray(rawGroups) || rawGroups.length > MAX_GROUPS) {
    res.status(400);
    throw new Error(`Use up to ${MAX_GROUPS} groups.`);
  }
  // A chapter sits in one group at most: the first that lists it keeps it.
  const taken = new Set();
  const groups = rawGroups.map((g, i) => {
    const name = String(g?.name || "").trim().slice(0, 60);
    if (!name) {
      res.status(400);
      throw new Error(`Group ${i + 1} needs a name.`);
    }
    const chapters = idList(g.chapters, "group's chapter", res).filter((id) => !taken.has(id) && taken.add(id));
    return { ...(mongoose.isValidObjectId(g._id) ? { _id: g._id } : {}), name, chapters };
  });
  const names = groups.map((g) => g.name.toLowerCase());
  if (new Set(names).size !== names.length) {
    res.status(400);
    throw new Error("Two groups have the same name.");
  }

  const outline = {
    groups,
    subjects: idList(body.subjects, "subject", res),
    chapters: idList(body.chapters, "chapter", res),
    topics: idList(body.topics, "topic", res),
    lectures: idList(body.lectures, "lecture", res),
  };
  // A reset (empty body) clears everything; any other save keeps what the
  // outline hid for being outside the ticked subjects.
  if (Object.keys(body).length) await keepHiddenOrder(batch, outline);
  // Only the outline is written, so nothing else on the batch is revalidated.
  await Batch.updateOne({ _id: batch._id }, { $set: { outline } }, { runValidators: true });
  res.status(200).json({ ok: true });
});

module.exports = { getOutline, saveOutline };
