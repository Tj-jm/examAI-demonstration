const shared = require("./shared");
const cache = require("./cache");

// A batch's leaderboard: each student's average of their best percentage
// per graded exam, highest first (the rules are in
// controllers/app/leaderboardController.js).
//
// By the Performance setting:
//   live      a graded submission moves the board at once. With Redis the
//             board is a sorted set and only that student's entry is worked
//             out again; without Redis the board is cached until a
//             submission changes.
//   periodic  worked out at most every leaderboardMinutes.
//
// Any Redis trouble falls back to working it out from the database.

const redisBoard = shared.redis ? require("../redis/leaderboard").create(shared.redis) : null;

const tag = (batchId) => `leaderboard:${batchId}`;
const ALL_BOARDS = "leaderboards";

let perfModel = null;
const settings = async () => {
  perfModel = perfModel || require("../models/performanceSettingsModel");
  return perfModel.safeGet();
};

// Every ranked student of a batch: [{ _id, avgPercent, examsCount }], best
// first. The one query the whole board comes from.
const compute = async (batchId) => {
  const Submission = require("../models/submissionModel");
  const { studentExamIds } = require("./excludeStudentExams");
  const mongoose = require("mongoose");
  const excludeIds = await studentExamIds();
  return Submission.aggregate([
    { $match: { batch: new mongoose.Types.ObjectId(String(batchId)), status: "graded", exam: { $nin: excludeIds }, totalMarks: { $gt: 0 } } },
    { $project: { student: 1, exam: 1, percent: { $multiply: [{ $divide: ["$marks", "$totalMarks"] }, 100] } } },
    { $sort: { percent: -1 } },
    { $group: { _id: { student: "$student", exam: "$exam" }, bestPercent: { $first: "$percent" } } },
    { $group: { _id: "$_id.student", avgPercent: { $avg: "$bestPercent" }, examsCount: { $sum: 1 } } },
    { $sort: { avgPercent: -1 } },
  ]);
};

// Tests on a MongoDB-compatible server without $multiply swap this out.
let computeRows = compute;
const _useCompute = (fn) => { computeRows = fn || compute; };

// One student's standing in a batch, or null with nothing graded.
const computeOne = async (batchId, studentId) => {
  const Submission = require("../models/submissionModel");
  const { studentExamIds } = require("./excludeStudentExams");
  const [subs, excludeIds] = await Promise.all([
    Submission.find({ batch: batchId, student: studentId, status: "graded", totalMarks: { $gt: 0 } }).select("exam marks totalMarks").lean(),
    studentExamIds(),
  ]);
  const excluded = new Set(excludeIds.map(String));
  const best = new Map();
  for (const s of subs) {
    if (excluded.has(String(s.exam))) continue;
    const pct = (s.marks / s.totalMarks) * 100;
    const key = String(s.exam);
    if (!best.has(key) || best.get(key) < pct) best.set(key, pct);
  }
  if (!best.size) return null;
  const values = [...best.values()];
  return { avgPercent: values.reduce((a, b) => a + b, 0) / values.length, examsCount: values.length };
};

// → { top: [{ _id, avgPercent, examsCount, rank }] (10), me, total }
const read = async (batchId, studentId) => {
  const fromRows = (rows) => {
    const ranked = rows.map((r, i) => ({ ...r, rank: i + 1 }));
    return {
      top: ranked.slice(0, 10),
      me: ranked.find((r) => String(r._id) === String(studentId)) || null,
      total: ranked.length,
    };
  };

  const s = await settings();
  if (s.leaderboard === "periodic") {
    const rows = await cache.wrap(`leaderboard:${batchId}`, [], async () => JSON.parse(JSON.stringify(await computeRows(batchId))), {
      ttlS: (s.leaderboardMinutes || 5) * 60,
    });
    return fromRows(rows);
  }

  if (redisBoard) {
    try {
      return await redisBoard.read(batchId, studentId, async () => JSON.parse(JSON.stringify(await computeRows(batchId))));
    } catch {
      // fall through to the cached database read
    }
  }
  return fromRows(await cache.wrap(`leaderboard:live:${batchId}`, [tag(batchId), ALL_BOARDS], async () => JSON.parse(JSON.stringify(await computeRows(batchId)))));
};

// A submission's marks or status changed: that student's entry moves now.
const refresh = async (batchId, studentId) => {
  if (!batchId || !studentId) return;
  await cache.touch(tag(batchId));
  if (!redisBoard) return;
  try {
    await redisBoard.update(batchId, studentId, await computeOne(batchId, studentId));
  } catch {
    await redisBoard.drop(batchId).catch(() => {});
  }
};

// Something changed that can't be pinned to one student (a bulk write, an
// exam deleted): the board is worked out again on its next view. No batch
// means every batch.
const stale = async (batchId) => {
  await cache.touch(batchId ? tag(batchId) : ALL_BOARDS);
  if (!redisBoard) return;
  await (batchId ? redisBoard.drop(batchId) : redisBoard.dropAll()).catch(() => {});
};

// Mongoose plugin for Submission: keeps boards current on every write.
const submissionHooks = (schema) => {
  const single = (v) => (v && (typeof v === "string" || v._bsontype) ? String(v) : null);
  schema.pre("save", function (next) {
    // Autosaves of an attempt in progress never move a board.
    this.$locals.leaderboard = this.isModified("status") || this.isModified("marks") || this.isModified("totalMarks");
    next();
  });
  schema.post("save", function (doc) {
    if (!doc.$locals.leaderboard || doc.status === "in_progress") return undefined;
    return refresh(doc.batch, doc.student).catch(() => {});
  });
  schema.post("deleteOne", { document: true, query: false }, function (doc) {
    return refresh(doc.batch, doc.student).catch(() => {});
  });
  // An autosave (answers on an attempt in progress) moves nothing; any other
  // query write might, and can't say which student, so the board is redone.
  const AUTOSAVE = /^(answers|lastSavedAt|updatedAt|lastActivityAt)(\.|$)/;
  schema.post(
    ["updateOne", "updateMany", "replaceOne", "findOneAndUpdate", "findOneAndReplace", "findOneAndDelete", "deleteOne", "deleteMany"],
    { document: false, query: true },
    function () {
      const update = this.getUpdate?.() || null;
      if (update && !Array.isArray(update)) {
        const fields = [...Object.keys(update).filter((k) => !k.startsWith("$")), ...Object.keys(update.$set || {})];
        const ops = Object.keys(update).filter((k) => k.startsWith("$") && k !== "$set");
        if (fields.length && !ops.length && fields.every((k) => AUTOSAVE.test(k))) return undefined;
      }
      return stale(single((this.getFilter() || {}).batch)).catch(() => {});
    }
  );
  schema.post("insertMany", function (docs) {
    const batches = new Set([].concat(docs || []).map((d) => String(d.batch)));
    return Promise.all([...batches].map((b) => stale(b))).catch(() => {});
  });
};

// Mongoose plugin for Exam: removing an exam (or making it a student's own
// practice paper) changes which submissions count.
const examHooks = (schema) => {
  schema.post(["deleteOne", "deleteMany", "findOneAndDelete"], function () {
    return stale(null).catch(() => {});
  });
};

module.exports = { read, refresh, stale, compute, computeOne, submissionHooks, examHooks, _useCompute };
