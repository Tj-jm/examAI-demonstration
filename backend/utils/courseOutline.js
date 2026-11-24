const Subject = require("../models/subjectModel");
const Chapter = require("../models/chapterModel");
const Topic = require("../models/topicModel");

// One order for everything in a batch. The batch's outline (batchModel's
// `outline`) says where its subjects, chapters, topics and lectures go and
// which named group each chapter belongs to; whatever it doesn't mention
// falls in after what it does, in the syllabus's own order, then by title.
//
// Every list a student or admin sees for a batch sorts through this, so
// lectures, practice, archive, the study plan, the tutor and the progress
// page can't disagree about what comes first.
//
//   const ol = await outlineFor(batch);
//   await ol.prime({ chapters, topics });   // ids it needs to know about
//   list.sort(ol.byTopic((t) => t._id));
//
// Sorting keys:
//   chapter: group, place in group (or subject), place in outline, syllabus order, title
//   topic:   its chapter's key, then place in outline, syllabus order, title
//   lecture: its chapter's key, then place in outline, the lecture's own order, oldest first

const LAST = Number.MAX_SAFE_INTEGER;
const str = (id) => (id && id._id ? String(id._id) : id ? String(id) : "");

const compareKeys = (a, b) => {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i];
    const y = b[i];
    if (x === y) continue;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (typeof x === "number" && typeof y === "number") return x - y;
    const c = String(x).localeCompare(String(y));
    if (c) return c;
  }
  return 0;
};

const positions = (ids) => new Map((ids || []).map((id, i) => [String(id), i]));

const outlineFor = async (batch) => {
  const outline = batch?.outline || {};
  const groups = (outline.groups || []).map((g) => ({ _id: String(g._id), name: g.name, chapters: (g.chapters || []).map(String) }));
  const groupOf = new Map();
  groups.forEach((g, gi) => g.chapters.forEach((c, ci) => { if (!groupOf.has(c)) groupOf.set(c, { index: gi, place: ci, group: g }); }));
  const subjectPos = positions(outline.subjects);
  const chapterPos = positions(outline.chapters);
  const topicPos = positions(outline.topics);
  const lecturePos = positions(outline.lectures);

  const subjects = new Map();
  const chapters = new Map();
  const topics = new Map();

  // Loads the syllabus facts the keys need (subject/chapter/topic order and
  // titles) for these ids, once each. Topics bring their chapters, chapters
  // bring their subjects.
  const prime = async ({ subjects: subjectIds = [], chapters: chapterIds = [], topics: topicIds = [] } = {}) => {
    const wantTopics = [...new Set(topicIds.map(str).filter((id) => id && !topics.has(id)))];
    if (wantTopics.length) {
      for (const t of await Topic.find({ _id: { $in: wantTopics } }).select("title chapter order").lean()) {
        topics.set(String(t._id), { chapter: String(t.chapter), order: t.order ?? 0, title: t.title || "" });
      }
    }
    const wantChapters = [...new Set([...chapterIds.map(str), ...[...topics.values()].map((t) => t.chapter)].filter((id) => id && !chapters.has(id)))];
    if (wantChapters.length) {
      for (const c of await Chapter.find({ _id: { $in: wantChapters } }).select("title subject order").lean()) {
        chapters.set(String(c._id), { subject: String(c.subject), order: c.order ?? 0, title: c.title || "" });
      }
    }
    const wantSubjects = [...new Set([...subjectIds.map(str), ...[...chapters.values()].map((c) => c.subject)].filter((id) => id && !subjects.has(id)))];
    if (wantSubjects.length) {
      for (const s of await Subject.find({ _id: { $in: wantSubjects } }).select("title order").lean()) {
        subjects.set(String(s._id), { order: s.order ?? 0, title: s.title || "" });
      }
    }
  };

  const subjectKey = (id) => {
    const s = subjects.get(str(id)) || { order: 0, title: "" };
    return [subjectPos.has(str(id)) ? subjectPos.get(str(id)) : LAST, s.order, s.title];
  };

  const chapterKey = (id) => {
    const key = str(id);
    const c = chapters.get(key) || { subject: "", order: 0, title: "" };
    const g = groupOf.get(key);
    // Grouped chapters go in their group's order; the rest come after every
    // group, by subject, in the order the outline or syllabus gives them.
    const head = g ? [g.index, g.place, 0, 0, ""] : [groups.length, 0, ...subjectKey(c.subject)];
    return [...head, chapterPos.has(key) ? chapterPos.get(key) : LAST, c.order, c.title];
  };

  const topicKey = (id) => {
    const key = str(id);
    const t = topics.get(key) || { chapter: "", order: 0, title: "" };
    return [...chapterKey(t.chapter), topicPos.has(key) ? topicPos.get(key) : LAST, t.order, t.title];
  };

  // lecture: { _id, chapter, order, createdAt }
  const lectureKey = (l) => {
    const key = str(l._id);
    return [...chapterKey(l.chapter), lecturePos.has(key) ? lecturePos.get(key) : LAST, l.order ?? 0, l.createdAt ? new Date(l.createdAt).getTime() : 0];
  };

  const by = (keyOf) => (get) => (a, b) => compareKeys(keyOf(get(a)), keyOf(get(b)));

  // The named group a chapter is in, or null.
  const group = (chapterId) => {
    const g = groupOf.get(str(chapterId));
    return g ? { _id: g.group._id, name: g.group.name } : null;
  };

  return {
    groups: groups.map((g) => ({ _id: g._id, name: g.name })),
    prime,
    chapterKey,
    topicKey,
    lectureKey,
    group,
    topicChapter: (id) => topics.get(str(id))?.chapter || null,
    bySubject: by(subjectKey),
    byChapter: by(chapterKey),
    byTopic: by(topicKey),
    byLecture: (get = (l) => l) => (a, b) => compareKeys(lectureKey(get(a)), lectureKey(get(b))),
  };
};

// Lectures (chapter/topic as ids or populated) in outline order, in place.
// Returns the outline so a caller can ask about groups too.
const orderLectures = async (batch, lectures) => {
  const ol = await outlineFor(batch);
  await ol.prime({ chapters: lectures.map((l) => l.chapter), topics: lectures.map((l) => l.topic).filter(Boolean) });
  lectures.sort(ol.byLecture());
  return ol;
};

// Distinct chapter ids behind topics (populated or id `chapter`) and
// whole-chapter entries, in outline order. The outline must be primed
// with them.
const chapterOrderOf = (ol, topics, chapters) => {
  const ids = new Set([
    ...topics.map((t) => String(t.chapter?._id || t.chapter || "")).filter(Boolean),
    ...chapters.map((c) => String(c._id)),
  ]);
  return [...ids].sort(ol.byChapter((x) => x));
};

module.exports = { outlineFor, orderLectures, chapterOrderOf, compareKeys };
