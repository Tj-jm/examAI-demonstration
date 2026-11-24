const crypto = require("crypto");
const cache = require("./cache");
const shared = require("./shared");
const LectureAiSummary = require("../models/lectureAiSummaryModel");

// Each student's own lecture summaries (models/lectureAiSummaryModel.js).
//
// Serve: a student's saved summaries are read through the cache (Redis on
// Pro, memory otherwise), filed under a tag only that student's writes
// touch. Reject: while one of their summaries is being made, a second
// request for it (a double tap, another tab, another server) gets a 409
// instead of paying for the same AI call twice.

const MAKE_TTL_MS = 3 * 60 * 1000;

const hash = (text) => crypto.createHash("sha1").update(text || "").digest("hex");

// What each kind is made from; a changed lecture gives a new fingerprint.
const sourceOf = (lecture, kind) =>
  kind === "points"
    ? hash(lecture.bodyMarkdown)
    : hash((lecture.attachments || []).map((a) => String(a._id || a)).join(","));

const tag = (lectureId, studentId) => `lecture-ai:${lectureId}:${studentId}`;

const saved = (lectureId, studentId) =>
  cache.wrap(tag(lectureId, studentId), [tag(lectureId, studentId)], async () =>
    LectureAiSummary.find({ lecture: lectureId, student: studentId }).select("kind points summary source").lean()
  );

// → { aiSummary, aiAttachmentSummary } for this student, current ones only.
const mine = async (lecture, studentId) => {
  let rows = [];
  try {
    rows = await saved(lecture._id, studentId);
  } catch {
    rows = [];
  }
  const current = (kind) => rows.find((r) => r.kind === kind && r.source === sourceOf(lecture, kind));
  return {
    aiSummary: current("points")?.points || [],
    aiAttachmentSummary: current("attachments")?.summary || null,
  };
};

// Runs make() (the AI call) unless this student is already making this
// summary, saves what it returns and drops their cached copy.
const make = async (lecture, studentId, kind, makeFn) => {
  const release = await shared.claim(`lecture-ai:${kind}:${lecture._id}:${studentId}`, MAKE_TTL_MS);
  if (!release) {
    throw Object.assign(new Error("Your summary is already being made. It will show in a moment."), { statusCode: 409 });
  }
  try {
    const value = await makeFn();
    await LectureAiSummary.findOneAndUpdate(
      { student: studentId, lecture: lecture._id, kind },
      { $set: { ...value, source: sourceOf(lecture, kind) } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    await cache.touch(tag(lecture._id, studentId));
    return value;
  } finally {
    await release();
  }
};

module.exports = { mine, make, sourceOf };
