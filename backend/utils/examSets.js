const mongoose = require("mongoose");
const Exam = require("../models/examModel");
const ExamSetGroup = require("../models/examSetGroupModel");
const ExamSetAssignment = require("../models/examSetAssignmentModel");

// Paper sets (models/examSetGroupModel.js): drawing the sets from a pool,
// and sending each student to the one set they were given.

const LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const labelFor = (i) => (i < 26 ? LABELS[i] : LABELS[Math.floor(i / 26) - 1] + LABELS[i % 26]);

// ---------- drawing ----------

// A passage's written parts share Question.group and are drawn together as
// one item; every other question is an item of its own. Pool order is kept.
const unitsOf = (questions) => {
  const units = [];
  const byGroup = new Map();
  for (const q of questions) {
    if (q.group) {
      if (byGroup.has(q.group)) { byGroup.get(q.group).questions.push(q); continue; }
      const unit = { key: `g:${q.group}`, questions: [q] };
      byGroup.set(q.group, unit);
      units.push(unit);
    } else {
      units.push({ key: String(q._id), questions: [q] });
    }
  }
  for (const u of units) {
    const first = u.questions[0];
    u.topic = first.topic ? String(first.topic) : null;
    u.difficulty = first.difficulty || null;
    u.marks = u.questions.reduce((sum, q) => sum + (q.marks || 0), 0);
  }
  return units;
};

const matches = (unit, rule) =>
  (rule.noTopic ? !unit.topic : !rule.topic || String(rule.topic) === unit.topic) &&
  (!rule.difficulty || rule.difficulty === unit.difficulty);

// setCount papers of perPaper items each. Within a rule (or the whole pool
// with no rules), the items used least so far are taken first, ties broken at
// random, so every item gets used and the sets differ as much as the pool
// allows. Throws a message naming the rule that cannot be met.
const drawSets = (units, { perPaper, setCount, rules }) => {
  const buckets = rules?.length ? rules.filter((r) => r.count > 0) : [{ label: "Whole pool", count: perPaper }];
  const wanted = buckets.reduce((sum, r) => sum + r.count, 0);
  if (wanted !== perPaper) throw new Error(`The rules add up to ${wanted} items, but each paper has ${perPaper}.`);

  for (const rule of buckets) {
    const have = units.filter((u) => matches(u, rule)).length;
    if (have < rule.count) throw new Error(`"${rule.label || "Whole pool"}" needs ${rule.count} items per paper, but the pool has only ${have}.`);
  }

  const used = new Map(units.map((u) => [u.key, 0]));
  const sets = [];
  for (let s = 0; s < setCount; s += 1) {
    const taken = new Set();
    const picked = [];
    for (const rule of buckets) {
      const candidates = units
        .filter((u) => !taken.has(u.key) && matches(u, rule))
        .map((u) => ({ u, r: Math.random() }))
        .sort((a, b) => used.get(a.u.key) - used.get(b.u.key) || a.r - b.r)
        .slice(0, rule.count)
        .map((x) => x.u);
      if (candidates.length < rule.count) {
        throw new Error(`"${rule.label || "Whole pool"}" overlaps another rule and runs out of items. Make the rules separate.`);
      }
      for (const u of candidates) { taken.add(u.key); used.set(u.key, used.get(u.key) + 1); picked.push(u); }
    }
    sets.push(picked);
  }
  return sets;
};

// How much the sets share: for each pair, the share of items in both.
const overlapOf = (sets) => {
  const keys = sets.map((s) => new Set(s.map((u) => u.key)));
  let sum = 0;
  let max = 0;
  let pairs = 0;
  for (let i = 0; i < keys.length; i += 1) {
    for (let j = i + 1; j < keys.length; j += 1) {
      let both = 0;
      for (const k of keys[i]) if (keys[j].has(k)) both += 1;
      const share = keys[i].size ? both / keys[i].size : 0;
      sum += share;
      max = Math.max(max, share);
      pairs += 1;
    }
  }
  return { average: pairs ? Math.round((100 * sum) / pairs) : 0, most: Math.round(100 * max) };
};

// ---------- students ----------

// The group a route id names: the group's own id, or any of its sets' ids.
// Null for an ordinary exam id (or nothing).
const groupFor = async (id) => {
  if (!mongoose.isValidObjectId(id)) return null;
  const group = await ExamSetGroup.findById(id);
  if (group) return group;
  const exam = await Exam.findById(id).select("paperSet").lean();
  return exam?.paperSet?.group ? ExamSetGroup.findById(exam.paperSet.group) : null;
};

// The set to show when the student has none yet: one open now, else the
// next to open, else the first.
const representative = (setExams) => {
  const open = setExams.filter((e) => e.isOpen());
  if (open.length) return open[0];
  const later = setExams.filter((e) => e.opensLater()).sort((a, b) => a.opensAt - b.opensAt);
  return later[0] || setExams[0] || null;
};

// The exam id a student's request for `id` really means. An ordinary exam:
// `id` itself. A paper set (by the group's id or any set's id): the set this
// student was given; with { assign: true } and none given yet, one of the
// sets open now is given (the least-used first) and kept. Before that, the
// representative set (for the rules screen). Null: no such published group.
const resolveExamId = async (id, studentId, { assign = false } = {}) => {
  const group = await groupFor(id);
  if (!group) return id;
  if (!group.isPublished) return null;

  const mine = await ExamSetAssignment.findOne({ group: group._id, student: studentId }).lean();
  if (mine) return String(mine.exam);

  const setExams = await Exam.find({ _id: { $in: group.sets.map((s) => s.exam) }, isPublished: true });
  if (!setExams.length) return null;
  const open = setExams.filter((e) => e.isOpen());
  if (!assign || !open.length) return String(representative(setExams)._id);

  const counts = await ExamSetAssignment.aggregate([
    { $match: { group: group._id } },
    { $group: { _id: "$exam", n: { $sum: 1 } } },
  ]);
  const countOf = new Map(counts.map((c) => [String(c._id), c.n]));
  const choice = open
    .map((e) => ({ e, n: countOf.get(String(e._id)) || 0, r: Math.random() }))
    .sort((a, b) => a.n - b.n || a.r - b.r)[0].e;
  try {
    await ExamSetAssignment.create({ group: group._id, student: studentId, exam: choice._id });
    return String(choice._id);
  } catch (error) {
    if (error.code !== 11000) throw error;
    const winner = await ExamSetAssignment.findOne({ group: group._id, student: studentId }).lean();
    return String(winner.exam);
  }
};

// A list of exam documents (hydrated) with each group's sets folded into one
// entry: the student's own set when given one (assigned: Map group id →
// exam id), else the representative. The entry keeps the set's fields but
// takes the group's id and title, and lists every set id in setIds.
const foldSets = (exams, assigned = new Map(), groups = new Map()) => {
  const plain = [];
  const bySet = new Map();
  for (const e of exams) {
    const g = e.paperSet?.group ? String(e.paperSet.group) : null;
    if (!g) { plain.push(e); continue; }
    if (!bySet.has(g)) bySet.set(g, []);
    bySet.get(g).push(e);
  }
  const folded = [];
  for (const [g, list] of bySet) {
    const own = assigned.get(g);
    const pick = (own && list.find((e) => String(e._id) === String(own))) || representative(list);
    if (!pick) continue;
    folded.push({ exam: pick, groupId: g, setIds: list.map((e) => String(e._id)), title: groups.get(g)?.title });
  }
  return { plain, folded };
};

// Group id → the student's set id, for the groups given.
const assignmentsFor = async (studentId, groupIds) => {
  if (!groupIds.length) return new Map();
  const rows = await ExamSetAssignment.find({ student: studentId, group: { $in: groupIds } }).select("group exam").lean();
  return new Map(rows.map((r) => [String(r.group), String(r.exam)]));
};

module.exports = { labelFor, unitsOf, drawSets, overlapOf, resolveExamId, foldSets, assignmentsFor, representative };
