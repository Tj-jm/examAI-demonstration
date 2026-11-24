const Exam = require("../models/examModel");
require("../models/questionModel"); // exam questions are populated for their marks
const Submission = require("../models/submissionModel");
const { Assignment, AssignmentSubmission } = require("../models/assignmentModel");

// The gradebook: a batch's exams and assignments added up into one grade per
// student. Each item sits in a category; a category's percentage is its
// marks over its maximum; the overall percentage weighs the categories
// (only those with marks so far, so an empty category never drags anyone
// down); the scale turns that into a letter and, where it has them, GPA
// points. Settings live on Batch.gradebook.

const SCALES = {
  letter: [
    { letter: "A", min: 90, points: 4 },
    { letter: "B", min: 80, points: 3 },
    { letter: "C", min: 70, points: 2 },
    { letter: "D", min: 60, points: 1 },
    { letter: "F", min: 0, points: 0 },
  ],
  // Bangladesh SSC / HSC grading.
  gpa5: [
    { letter: "A+", min: 80, points: 5 },
    { letter: "A", min: 70, points: 4 },
    { letter: "A-", min: 60, points: 3.5 },
    { letter: "B", min: 50, points: 3 },
    { letter: "C", min: 40, points: 2 },
    { letter: "D", min: 33, points: 1 },
    { letter: "F", min: 0, points: 0 },
  ],
  // UK-style university classes.
  classes: [
    { letter: "First", min: 70, points: null },
    { letter: "2:1", min: 60, points: null },
    { letter: "2:2", min: 50, points: null },
    { letter: "Third", min: 40, points: null },
    { letter: "Fail", min: 0, points: null },
  ],
};

const DEFAULT_CATEGORIES = [
  { name: "Exams", weight: 60 },
  { name: "Assignments", weight: 40 },
];

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;

// A batch's settings, with defaults filled in.
const settingsFor = (batch) => {
  const g = (batch && batch.gradebook) || {};
  const plain = (list) => (list || []).map((x) => (typeof x.toObject === "function" ? x.toObject() : { ...x }));
  const categories = plain(g.categories).filter((c) => c.name);
  const scale = plain(g.scale).filter((r) => r.letter);
  return {
    categories: categories.length ? categories : DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    scale: (scale.length ? scale : SCALES.letter.map((r) => ({ ...r }))).sort((a, b) => b.min - a.min),
    overrides: plain(g.overrides),
    missingAsZero: Boolean(g.missingAsZero),
    published: Boolean(g.published),
    showRank: Boolean(g.showRank),
    term: g.term || "",
    signedBy: g.signedBy || "",
    // Older report cards had only a "signed by" line; it reads as one
    // signature with that role.
    signatures: plain(g.signatures).filter((x) => x.name || x.role || x.image).length
      ? plain(g.signatures).filter((x) => x.name || x.role || x.image).map((x) => ({ name: x.name || "", role: x.role || "", image: x.image || null }))
      : g.signedBy ? [{ name: "", role: g.signedBy, image: null }] : [],
  };
};

const letterFor = (scale, pct) => {
  if (pct === null || pct === undefined) return { letter: null, points: null };
  const row = scale.find((r) => pct >= r.min) || scale[scale.length - 1];
  return row ? { letter: row.letter, points: row.points ?? null } : { letter: null, points: null };
};

// One student's grade from their cells: { [itemId]: { marks, max, status } }
// where status is "graded", "pending" or absent (nothing handed in).
const computeRow = (items, cells, settings) => {
  const byCat = new Map();
  for (const c of settings.categories) byCat.set(c.name, { marks: 0, max: 0, counted: 0 });
  for (const item of items) {
    if (item.excluded) continue;
    if (!byCat.has(item.category)) byCat.set(item.category, { marks: 0, max: 0, counted: 0 });
    const cat = byCat.get(item.category);
    const cell = cells[item.id];
    if (cell && cell.status === "graded") {
      cat.marks += cell.marks;
      cat.max += cell.max;
      cat.counted += 1;
    } else if (!cell && settings.missingAsZero && item.closed && item.max > 0) {
      cat.max += item.max;
      cat.counted += 1;
    }
  }
  const weights = new Map(settings.categories.map((c) => [c.name, Number(c.weight) || 0]));
  const categories = {};
  let weighted = 0;
  let weightUsed = 0;
  let allMarks = 0;
  let allMax = 0;
  for (const [name, cat] of byCat) {
    const pct = cat.max > 0 ? round1((100 * cat.marks) / cat.max) : null;
    categories[name] = { marks: round2(cat.marks), max: round2(cat.max), pct, weight: weights.get(name) || 0 };
    allMarks += cat.marks;
    allMax += cat.max;
    const w = weights.get(name) || 0;
    if (pct !== null && w > 0) { weighted += w * pct; weightUsed += w; }
  }
  // No weights set (or none on the categories with marks): a plain total.
  const overall = weightUsed > 0 ? round1(weighted / weightUsed) : allMax > 0 ? round1((100 * allMarks) / allMax) : null;
  return { categories, overall, ...letterFor(settings.scale, overall) };
};

// Standard competition ranking: 90, 90, 80 rank 1, 1, 3.
const rankRows = (rows) => {
  const scored = rows.filter((r) => r.overall !== null).sort((a, b) => b.overall - a.overall);
  scored.forEach((r, i) => { r.rank = i > 0 && scored[i - 1].overall === r.overall ? scored[i - 1].rank : i + 1; });
  for (const r of rows) if (r.overall === null) r.rank = null;
  return scored.length;
};

// The batch's gradebook items: published exams and assignments, oldest first.
const loadItems = async (batchId, settings) => {
  const now = Date.now();
  const overrides = new Map(settings.overrides.map((o) => [String(o.ref), o]));
  const [exams, assignments] = await Promise.all([
    Exam.find({ batches: batchId, isPublished: true })
      .select("title questions opensAt createdAt isActive isPublished mode liveHours closesAt offline paperSet")
      .populate("questions", "marks"),
    Assignment.find({ batch: batchId, isPublished: true }).select("title category maxMarks dueAt allowLate lateDays"),
  ]);
  // Paper sets (utils/examSets.js): one column per group, holding each
  // student's mark on whichever set they sat. Its id is the group's.
  const setGroups = new Map();
  for (const e of exams) {
    if (!e.paperSet?.group) continue;
    const g = String(e.paperSet.group);
    if (!setGroups.has(g)) setGroups.set(g, []);
    setGroups.get(g).push(e);
  }
  const groupTitles = new Map(setGroups.size
    ? (await require("../models/examSetGroupModel").find({ _id: { $in: [...setGroups.keys()] } }).select("title").lean()).map((g) => [String(g._id), g.title])
    : []);
  const items = [
    ...exams.filter((e) => !e.paperSet?.group).map((e) => ({
      id: String(e._id), kind: "exam", title: e.title, category: "Exams",
      max: e.totalMarks() || 0, date: e.offline?.date || e.opensAt || e.createdAt,
      closed: Boolean(e.offline) || (!e.isOpen() && !e.opensLater()),
    })),
    ...[...setGroups].map(([g, list]) => ({
      id: g, kind: "exam", title: groupTitles.get(g) || list[0].title, category: "Exams",
      examIds: list.map((e) => String(e._id)),
      max: Math.max(...list.map((e) => e.totalMarks() || 0)),
      date: list.map((e) => e.opensAt || e.createdAt).sort((a, b) => a - b)[0],
      closed: list.every((e) => !e.isOpen() && !e.opensLater()),
    })),
    ...assignments.map((a) => ({
      id: String(a._id), kind: "assignment", title: a.title, category: a.category || "Assignments",
      max: a.maxMarks || 0, date: a.dueAt, closed: a.closesAt().getTime() < now,
    })),
  ];
  for (const item of items) {
    const o = overrides.get(item.id);
    if (o?.category) item.category = o.category;
    item.excluded = Boolean(o?.excluded);
  }
  return items.sort((a, b) => new Date(a.date) - new Date(b.date));
};

// cells[studentId][itemId]. forStudent: only grades the student may see
// (assignments returned to them).
const loadCells = async (items, studentIds, { forStudent = false } = {}) => {
  const cells = {};
  for (const id of studentIds) cells[String(id)] = {};
  // A paper-set column stands for all its sets' exam ids.
  const columnOf = new Map();
  for (const i of items) if (i.kind === "exam") for (const id of i.examIds || [i.id]) columnOf.set(id, i.id);
  const examIds = [...columnOf.keys()];
  const assignmentIds = items.filter((i) => i.kind === "assignment").map((i) => i.id);
  const [subs, hand] = await Promise.all([
    examIds.length ? Submission.find({ exam: { $in: examIds }, student: { $in: studentIds } }).select("exam student status marks totalMarks").lean() : [],
    assignmentIds.length ? AssignmentSubmission.find({ assignment: { $in: assignmentIds }, student: { $in: studentIds }, status: { $ne: "draft" } }).select("assignment student status finalMarks returned").lean() : [],
  ]);
  const itemMax = new Map(items.map((i) => [i.id, i.max]));
  for (const s of subs) {
    const row = cells[String(s.student)];
    if (!row) continue;
    const key = columnOf.get(String(s.exam)) || String(s.exam);
    let cell = null;
    if (s.status === "graded") cell = { marks: s.marks || 0, max: s.totalMarks || itemMax.get(key) || 0, status: "graded" };
    else if (s.status === "disqualified") cell = { marks: 0, max: s.totalMarks || itemMax.get(key) || 0, status: "graded", note: "disqualified" };
    else if (["submitted", "grading", "in_progress"].includes(s.status)) cell = { status: "pending" };
    if (!cell) continue;
    // Several attempts: the best graded one counts.
    const prev = row[key];
    if (!prev || (cell.status === "graded" && (prev.status !== "graded" || cell.marks / (cell.max || 1) > prev.marks / (prev.max || 1)))) row[key] = cell;
  }
  for (const h of hand) {
    const row = cells[String(h.student)];
    if (!row) continue;
    const key = String(h.assignment);
    const graded = h.status === "graded" && (!forStudent || h.returned);
    row[key] = graded ? { marks: h.finalMarks || 0, max: itemMax.get(key) || 0, status: "graded" } : { status: "pending" };
  }
  return cells;
};

// The whole gradebook for staff, or one student's row.
const buildGradebook = async (batch, students, { forStudent = false } = {}) => {
  const settings = settingsFor(batch);
  const items = await loadItems(batch._id, settings);
  const cells = await loadCells(items, students.map((s) => s._id), { forStudent });
  const rows = students.map((s) => ({
    student: { _id: s._id, name: s.name, studentId: s.studentId || null, email: s.email || null },
    cells: cells[String(s._id)] || {},
    ...computeRow(items, cells[String(s._id)] || {}, settings),
  }));
  const ranked = rankRows(rows);
  const graded = rows.filter((r) => r.overall !== null);
  const average = graded.length ? round1(graded.reduce((sum, r) => sum + r.overall, 0) / graded.length) : null;
  // Each item's class average, as a percentage.
  for (const item of items) {
    const marks = rows.map((r) => r.cells[item.id]).filter((c) => c && c.status === "graded" && c.max > 0);
    item.average = marks.length ? round1((100 * marks.reduce((sum, c) => sum + c.marks / c.max, 0)) / marks.length) : null;
  }
  // Categories some item uses but the settings don't list (weight 0).
  const extra = [...new Set(items.filter((i) => !i.excluded).map((i) => i.category))]
    .filter((name) => !settings.categories.some((c) => c.name === name));
  return { settings, items, rows, ranked, average, unweighted: extra };
};

module.exports = { SCALES, DEFAULT_CATEGORIES, settingsFor, letterFor, computeRow, rankRows, loadItems, loadCells, buildGradebook };
