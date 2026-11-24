const shared = require("./shared");

// Exam autosave, buffered (with Redis, Settings → Performance:
// autosave "buffered"). The exam page saves an answer on every change; a
// class of a thousand sitting the same paper makes that the heaviest load
// the app sees. Buffered, a save is checked against a copy of the attempt
// kept in Redis (owner, deadline, its questions) and held there: no
// database read or write at all. Every autosaveFlushSeconds one server
// writes what changed to the database.
//
// Nothing that reads answers misses one: handing in (finishAttempt) and
// coming back to the exam (startExam) take whatever is held first, under a
// lock the writer also takes, so a save is never lost between the two.
//
// "direct", no Redis, or Redis failing mid-save:
// every change is written to the database at once, as before.
//
// Also here: the sweeper. Every minute one server closes attempts whose
// time is up, so a result appears (and its messages go out) even when the
// student never comes back to look.

const REDIS = shared.redis ? require("../redis/autosave").create(shared.redis) : null;
const FIELDS = ["selectedOption", "statementAnswers", "subAnswers", "answerText", "answerImages"];
const MAX_ANSWER_IMAGES = 10;
const LOCK_MS = 10000;

let perfModel = null;
const settings = async () => {
  perfModel = perfModel || require("../models/performanceSettingsModel");
  return perfModel.safeGet();
};

const buffered = async () => Boolean(REDIS) && (await settings()).autosave === "buffered";

const httpError = (status, message) => Object.assign(new Error(message), { statusCode: status });

// What a save checks, from the database once per attempt.
const loadMeta = async (id) => {
  const Submission = require("../models/submissionModel");
  const Exam = require("../models/examModel");
  const Batch = require("../models/batchModel");
  const sub = await Submission.findById(id).select("student status startedAt exam batch answers.question answers.questionType answers.subIndex").lean();
  if (!sub) return null;
  const [exam, batch] = await Promise.all([
    Exam.findById(sub.exam).select("durationMinutes bufferSeconds scriptGraceMinutes").lean(),
    Batch.findById(sub.batch).select("features.writtenAnswerImages").lean(),
  ]);
  const hasWritten = sub.answers.some((a) => a.questionType === "written");
  const mainDeadline = new Date(sub.startedAt).getTime() + (exam?.durationMinutes || 0) * 60000;
  return {
    student: String(sub.student),
    open: sub.status === "in_progress",
    mainDeadline,
    graceMs: hasWritten ? (exam?.scriptGraceMinutes || 0) * 60000 : 0,
    bufferMs: (exam?.bufferSeconds || 0) * 1000,
    questions: sub.answers.map(require("./passageParts").answerKey),
    images: Boolean(batch?.features?.writtenAnswerImages),
  };
};

// Each answer field is cast by the Submission schema now, so a bad value is
// refused here rather than breaking the write later.
let answerSchema = null;
const cast = (field, value) => {
  answerSchema = answerSchema || require("../models/submissionModel").schema.path("answers").schema;
  const path = answerSchema.path(field);
  if (!path || value === null) return value;
  try {
    const out = path.cast(value);
    return out && typeof out.toObject === "function" ? out.toObject() : Array.isArray(out) ? [...out].map((v) => (v && v.toObject ? v.toObject() : v)) : out;
  } catch {
    throw httpError(400, `That ${field} isn't a valid answer.`);
  }
};

// Saves one answer into the buffer. → true when held here; false means
// "use the direct path" (not buffered, or Redis trouble). Throws an error
// with statusCode for anything the direct path would refuse.
const save = async ({ id, studentId, body }) => {
  if (!(await buffered())) return false;
  let meta;
  try {
    if (await REDIS.isClosed(id)) throw httpError(400, "This attempt is no longer open for answers.");
    meta = await REDIS.getMeta(id);
  } catch (error) {
    if (error.statusCode) throw error;
    return false;
  }
  if (!meta) {
    meta = await loadMeta(id);
    if (!meta || meta.student !== String(studentId)) throw httpError(404, "Submission not found.");
    if (!meta.open) throw httpError(400, "This attempt is no longer open for answers.");
    const ttlS = (meta.mainDeadline + meta.graceMs + meta.bufferMs + 10 * 60000 - Date.now()) / 1000;
    await REDIS.setMeta(id, meta, ttlS).catch(() => {});
  }
  if (meta.student !== String(studentId)) throw httpError(404, "Submission not found.");

  const now = Date.now();
  if (now > meta.mainDeadline + meta.graceMs + meta.bufferMs) throw httpError(400, "Time is up for this attempt. Submit what you have.");
  const inGrace = meta.graceMs > 0 && now > meta.mainDeadline + meta.bufferMs;

  const { questionId, timeSpentMs } = body;
  if (!meta.questions.includes(String(questionId))) throw httpError(400, "That question is not part of this attempt.");
  const changed = FIELDS.filter((f) => body[f] !== undefined);
  if (inGrace && changed.some((f) => f !== "answerImages")) throw httpError(400, "Time is up — only script images can still be attached.");

  if (body.answerImages !== undefined) {
    if (!meta.images) throw httpError(403, "Image attachments are not enabled for this batch.");
    if (!Array.isArray(body.answerImages) || body.answerImages.length > MAX_ANSWER_IMAGES) throw httpError(400, `No more than ${MAX_ANSWER_IMAGES} images per answer.`);
    const { assertOwnMediaUrl } = require("./mediaUrl");
    for (const image of body.answerImages) await assertOwnMediaUrl(image, studentId, "answer image");
  }

  const fields = {};
  for (const f of changed) fields[`${questionId}|${f}`] = JSON.stringify(cast(f, body[f]));
  const time = timeSpentMs && Number(timeSpentMs) > 0 ? { [questionId]: Math.round(Number(timeSpentMs)) } : {};
  try {
    await REDIS.write(id, fields, time);
  } catch {
    return false;
  }
  return true;
};

// Puts held changes onto a loaded submission document (not saved). → true
// when something was applied.
const applyTo = (doc, raw) => {
  let applied = false;
  for (const [key, value] of Object.entries(raw)) {
    const [q, field] = key.split("|");
    const answer = require("./passageParts").findAnswer(doc.answers, q);
    if (!answer) continue;
    if (field === "timeSpentMs") answer.timeSpentMs = (answer.timeSpentMs || 0) + (Number(value) || 0);
    else if (FIELDS.includes(field)) answer[field] = JSON.parse(value);
    else continue;
    applied = true;
  }
  return applied;
};

const withLock = async (id, fn) => {
  const until = Date.now() + LOCK_MS;
  while (!(await REDIS.lock(id, LOCK_MS))) {
    if (Date.now() > until) break; // a stuck lock never holds an attempt up for good
    await new Promise((r) => setTimeout(r, 50));
  }
  try {
    return await fn();
  } finally {
    await REDIS.unlock(id).catch(() => {});
  }
};

// Before an attempt is read for real (handed in, resumed): whatever is held
// for it goes onto `doc`. With save, the document is saved too.
const settle = async (doc, { save: persist = false } = {}) => {
  if (!REDIS) return false;
  try {
    return await withLock(String(doc._id), async () => {
      const raw = await REDIS.take(String(doc._id));
      const applied = applyTo(doc, raw);
      if (applied && persist) {
        try {
          await doc.save();
        } catch (error) {
          await REDIS.putBack(String(doc._id), raw).catch(() => {});
          throw error;
        }
      }
      return applied;
    });
  } catch {
    return false;
  }
};

// Handed in, abandoned or disqualified: no more saves are held for it.
const closed = async (id) => {
  if (!REDIS) return;
  await REDIS.close(String(id)).catch(() => {});
};

// One attempt's held changes, written to the database.
const flushOne = async (id) => {
  const Submission = require("../models/submissionModel");
  await withLock(id, async () => {
    const raw = await REDIS.take(id);
    if (!Object.keys(raw).length) return;
    const doc = await Submission.findById(id);
    // Closed some other way (disqualified, abandoned): nothing more counts.
    if (!doc || doc.status !== "in_progress") return;
    applyTo(doc, raw);
    try {
      await doc.save();
      stats.written += 1;
    } catch (error) {
      stats.failed += 1;
      await REDIS.putBack(id, raw).catch(() => {});
    }
  });
};

const stats = { written: 0, failed: 0, ticks: 0, swept: 0 };

const FLUSH_BATCH = 500;
const flushAll = async () => {
  const ids = await REDIS.dirty(FLUSH_BATCH);
  for (const id of ids || []) await flushOne(id).catch(() => {});
  stats.ticks += 1;
};

// Attempts whose time is up are closed and scored (utils/finishAttempt.js).
const SWEEP_MS = 60 * 1000;
const sweep = async () => {
  const { closeOverdue } = require("./finishAttempt");
  // Started at least a few minutes ago: anything sooner can't be overdue.
  const before = await require("../models/submissionModel").countDocuments({ status: "in_progress" });
  await closeOverdue({ startedAt: { $lt: new Date(Date.now() - 5 * 60000) } });
  const after = await require("../models/submissionModel").countDocuments({ status: "in_progress" });
  stats.swept += Math.max(0, before - after);
};

let timers = [];
const start = () => {
  if (timers.length) return;
  // The writer: as often as the setting says, one server at a time.
  const tick = async () => {
    try {
      const s = await settings();
      const every = Math.max(2, s.autosaveFlushSeconds || 10) * 1000;
      if (REDIS) await shared.runOnce("autosave-flush", every - 500, flushAll);
      timers[0] = setTimeout(tick, every);
    } catch {
      timers[0] = setTimeout(tick, 10000);
    }
    timers[0].unref?.();
  };
  timers[0] = setTimeout(tick, 2000);
  timers[0].unref?.();
  timers[1] = setInterval(() => shared.runOnce("exam-sweeper", SWEEP_MS - 1000, sweep).catch(() => {}), SWEEP_MS);
  timers[1].unref?.();
};
const stop = () => {
  timers.forEach((t) => clearTimeout(t));
  timers = [];
};

const status = async () => ({
  mode: REDIS ? ((await settings()).autosave === "buffered" ? "buffered" : "direct") : "direct",
  held: REDIS ? await REDIS.dirtyCount().catch(() => null) : 0,
  ...stats,
});

// Mongoose plugin for Submission: an attempt that stops being in progress
// any way at all (handed in, abandoned, disqualified) holds no more saves.
const submissionHooks = (schema) => {
  schema.pre("save", function (next) {
    this.$locals.autosaveClosed = this.isModified("status") && this.status !== "in_progress";
    next();
  });
  schema.post("save", function (doc) {
    if (doc.$locals.autosaveClosed) return closed(doc._id);
    return undefined;
  });
  schema.post(["updateOne", "findOneAndUpdate"], { document: false, query: true }, function () {
    const set = { ...(this.getUpdate()?.$set || {}) };
    const id = this.getFilter()?._id;
    if (id && set.status && set.status !== "in_progress") return closed(id);
    return undefined;
  });
};

module.exports = { submissionHooks, save, settle, closed, flushAll, flushOne, sweep, start, stop, stats: status, buffered };
