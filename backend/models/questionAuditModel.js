const mongoose = require("mongoose");

// One document per "AI audit" run (aiController.js's auditQuestionPool) —
// persisted rather than handed back and forgotten, so navigating to the
// results page, refreshing it, or coming back to it later never loses a run
// that already cost an AI call. Decisions (dismiss / mark applied) are
// written back onto this same document too, so those survive a reload the
// same way.

const auditIssueSchema = new mongoose.Schema(
  {
    questionId: { type: mongoose.Schema.Types.ObjectId, ref: "Question", required: true },
    preview: String,
    type: String,
    kind: {
      type: String,
      enum: ["wrong_answer_key", "multiple_valid_answers", "ambiguous_wording", "no_correct_answer", "typo", "latex_error", "other"],
      required: true,
    },
    severity: { type: String, enum: ["low", "medium", "high"], required: true },
    detail: { type: String, required: true },
    // Shape mirrors what updateQuestion's body accepts (questionController.js's
    // COMMON/BY_TYPE) — applying a fix is a direct PUT with these fields, no
    // translation step.
    fix: mongoose.Schema.Types.Mixed,
    // "open" until a person acts on it. "applied" is set once the fix has
    // actually been written to the question (see aiApi.js's
    // decideAuditPool); "dismissed" is a person saying "not worth acting on"
    // without changing the question.
    status: { type: String, enum: ["open", "applied", "dismissed"], default: "open" },
  },
  { _id: false }
);

// A real Schema instance, not an inline object literal — `questions` below
// needs one of its own fields to be literally named "type" (the question's
// mcq/mtf/written type), and Mongoose special-cases any key called "type"
// in a plain object used as a path or array-element definition: it reads
// `{ type: String, ... }` as "this whole thing's type is String" rather
// than "there is a field named type". That collapsed this array down to
// `[String]` — every write then tried to cast a whole array of
// {_id, question, type} objects into a single string and failed with a
// CastError. A Schema instance is exempt from that heuristic, which is the
// standard fix for a field that needs to be named "type".
const duplicateQuestionRefSchema = new mongoose.Schema(
  {
    _id: { type: mongoose.Schema.Types.ObjectId, ref: "Question" },
    question: String,
    type: String,
  },
  { _id: false }
);

const duplicateGroupSchema = new mongoose.Schema(
  {
    reason: String,
    questions: [duplicateQuestionRefSchema],
    status: { type: String, enum: ["open", "dismissed"], default: "open" },
  },
  { _id: false }
);

const questionAuditSchema = new mongoose.Schema(
  {
    chapter: { type: mongoose.Schema.Types.ObjectId, ref: "Chapter" },
    // Mixed rather than a plain ObjectId ref: this stores exactly what the
    // audit request scoped on, which can be a real topic id, the literal
    // string "none" (chapter-pool-only, same sentinel as everywhere else in
    // this codebase), or left unset entirely (a whole chapter, every topic
    // included). Collapsing "none" and "unset" into the same stored value
    // would make a re-opened audit unable to tell "this chapter's pool
    // only" apart from "this whole chapter".
    topic: mongoose.Schema.Types.Mixed,
    // Set instead of chapter/topic when the run came from a hand-picked
    // selection in the bank (Questions.jsx's checkboxes) rather than a
    // topic/chapter-pool filter — there's no single filing to redisplay for
    // that case, just how many questions went in.
    selectionCount: Number,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reviewed: { type: Number, default: 0 },
    totalInPool: { type: Number, default: 0 },
    truncated: { type: Boolean, default: false },
    issues: [auditIssueSchema],
    duplicateGroups: [duplicateGroupSchema],
  },
  { timestamps: true }
);

module.exports = mongoose.model("QuestionAudit", questionAuditSchema);
