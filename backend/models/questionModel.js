const mongoose = require("mongoose");
const cacheInvalidation = require("../utils/cacheInvalidation");
const tags = require("../utils/cacheTags");
const { SKILL_TYPE_VALUES } = require("../utils/skillTypes");

// One collection, four shapes. Discriminators let a mixed exam load every
// question type in a single query instead of one query per type, and adding a
// fourth type later touches nothing that already exists.

const options = { discriminatorKey: "type", timestamps: true };

const questionSchema = new mongoose.Schema(
  {
    question: {
      type: String,
      required: [true, "Please add the question text"],
    },
    // A Media reference rather than a url, so moving from local disk to S3
    // never rewrites the documents that point at a file.
    questionImage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Media",
    },

    // A written part of a passage (utils/questionText.js): the passage text,
    // the part's label (ক, খ or a, b) and an id shared by every part of the
    // same passage, including the passage question holding its mcqs.
    context: { type: String, default: undefined },
    partLabel: { type: String, default: undefined, maxlength: 10 },
    group: { type: String, default: undefined, index: true },

    subject: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subject",
      required: [true, "Please add a subject"],
    },
    chapter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Chapter",
      required: [true, "Please add a chapter"],
    },
    // Optional — a question filed straight under its chapter instead of a
    // specific topic (the "chapter pool") has no topic at all, null rather
    // than missing. subject/chapter above stay required either way, derived
    // from whichever of Topic/Chapter the question was actually filed
    // under (see questionController.js's createQuestion/updateQuestion).
    // A chapter-pool question is invisible to every topic-keyed student
    // feature — practice's topic list, the weak-topics report, the study
    // plan, the per-topic exam performance breakdown — all of which read
    // this field and skip a question that has none (see utils/weakTopics.js
    // and utils/examReport.js). It still scores and counts normally in an
    // exam; only the topic-accuracy analytics skip it. That tradeoff is
    // deliberate, not a bug to fix later: a question spanning more than one
    // topic (or a passage question, which can only ever be chapter-pool —
    // see the Passage discriminator below) has no single topic to be
    // honest about.
    topic: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Topic",
      default: null,
    },

    marks: {
      type: Number,
      default: 1,
      min: [0, "Marks cannot be negative"],
    },
    negativeMarks: {
      type: Number,
      default: 0,
      min: [0, "Negative marks are stored as a positive value"],
    },
    difficulty: {
      type: String,
      enum: ["easy", "medium", "hard"],
      default: "medium",
    },

    // What kind of thinking the question actually tests — recall,
    // application, analysis, and so on (see utils/skillTypes.js). Shared
    // across all three types on purpose: an mcq and a written question can
    // both be a "recall" question, so this lives on the base schema, not a
    // discriminator. Unset on anything created before this field existed —
    // no backfill, no default, since "unknown" is more honest than a guess.
    skillType: {
      type: String,
      enum: SKILL_TYPE_VALUES,
    },

    // solution, any combination
    solutionText: String,
    solutionImage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Media",
    },
    solutionVideo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Media",
    },
    solutionPdf: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Media",
    },
    // The general, multi-file version of the three single-file fields
    // above — solutionImage/Video/Pdf only ever cover 3 of Media's 4
    // kinds (never "document"), only ever one of each, and only
    // solutionImage actually had an editor UI. This is the same shape and
    // the same AttachmentPicker component lectureModel.js's own
    // `attachments` already uses: any number of files, any Media kind.
    // Kept alongside the three older fields rather than migrating them —
    // nothing currently reads or writes solutionVideo/solutionPdf outside
    // this schema, so leaving them in place costs nothing and risks
    // nothing, while this is the field new admin edits actually go through.
    solutionAttachments: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Media",
      },
    ],

    // An AI solution written for a question that already exists (backfill,
    // or "generate solution" on a single question) lands here instead of
    // overwriting solutionText directly. The live solutionText — what
    // students actually see — only changes once a person approves it,
    // exactly like a freshly generated question does via `status`. A
    // question can be published and still have a solution sitting here
    // awaiting review, which is why this is its own flag rather than reusing
    // the question's own status.
    pendingSolutionText: String,
    solutionStatus: {
      type: String,
      enum: ["none", "pending_review"],
      default: "none",
      index: true,
    },

    // Every board/exam/book this question appeared in, each with all the
    // years it appeared there (Dhaka Board 2015, 2017, 2019 + Rajshahi Board
    // 2018, 2020). paperLabel is free text ("Physics 1st Paper") — the
    // physical grouping it was printed under on that board. See
    // utils/archiveSources.js for validation and query helpers.
    sources: [
      {
        _id: false,
        authority: { type: mongoose.Schema.Types.ObjectId, ref: "ExamAuthority", required: true },
        years: [Number],
        paperLabel: String,
      },
    ],
    // The public archive's entire visibility gate. Defaults false so
    // nothing existing becomes archive-visible by accident; every archive
    // query filters on this, every batch-scoped query stays untouched.
    isPublic: {
      type: Boolean,
      default: false,
      index: true,
    },

    isForPractice: {
      type: Boolean,
      default: true,
    },

    // Written by AI for one lecture's "Ace this lecture" quiz and not yet
    // kept: lives only in that quiz, out of the question bank (Questions
    // page, exam builder, counts) until an admin opens it and saves it to
    // the bank under a chapter and topic (admin LectureView).
    lectureQuizOnly: {
      type: Boolean,
      default: false,
    },

    // Free-form labels — "reserved", "exam-only", whatever a teacher wants
    // to group by later — orthogonal to subject/chapter/topic, which are a
    // fixed syllabus position a question can only have one of. Stored
    // lowercase so "Exam" and "exam" filter as the same tag.
    tags: {
      type: [String],
      default: [],
      index: true,
    },

    // when non-empty, only these batches may see this question
    batches: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Batch",
      },
    ],

    // provenance — set when a model generated this
    source: {
      type: String,
      enum: ["manual", "import", "ai"],
      default: "manual",
    },
    aiMeta: {
      model: String,
      promptVersion: String,
      sourceRef: String,
      confidence: Number,
      // Things a reviewer should look at before approving — set by document
      // extraction ("figure needs checking: …", "answer not printed — worked
      // out by AI").
      flags: { type: [String], default: undefined },
      reviewedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      reviewedAt: Date,
    },
    status: {
      type: String,
      enum: ["draft", "pending_review", "published", "rejected"],
      default: "published",
      index: true,
    },
    // When the question went live — not when it was written. An AI question
    // generated last week and approved today is new to the bank today, and
    // the Questions list's "Newest first" sorts by this.
    publishedAt: Date,
  },
  options
);

// The student archive always filters on board + public + published.
questionSchema.index({ "sources.authority": 1, isPublic: 1, status: 1, topic: 1 });
questionSchema.index({ topic: 1, status: 1 });
questionSchema.index({ chapter: 1, type: 1, status: 1 });
questionSchema.index({ subject: 1, isForPractice: 1, status: 1 });
questionSchema.index({ status: 1, publishedAt: -1, _id: -1 });

// The question bank: everything except AI questions kept only in a lecture quiz.
questionSchema.statics.IN_BANK = { lectureQuizOnly: { $ne: true } };

// Runs on the editor's create/update path (.save()). Bulk import normalises
// tags itself before insertMany, which — like every Mongoose bulk write —
// does not run document middleware.
questionSchema.pre("save", function (next) {
  if (this.isModified("tags") && Array.isArray(this.tags)) {
    const seen = new Set();
    this.tags = this.tags
      .map((t) => String(t).trim().toLowerCase())
      .filter((t) => t && !seen.has(t) && seen.add(t));
  }
  if (this.status === "published" && !this.publishedAt && (this.isNew || this.isModified("status"))) {
    this.publishedAt = new Date();
  }
  next();
});

// Bulk import and AI inserts go through insertMany, which skips the hook
// above. A doc with no status gets the schema default, published.
questionSchema.pre("insertMany", function (next, docs) {
  const now = new Date();
  for (const doc of Array.isArray(docs) ? docs : [docs]) {
    if (doc && (doc.status || "published") === "published" && !doc.publishedAt) doc.publishedAt = now;
  }
  next();
});

// Writes here drop the cached reads built from them (utils/cacheInvalidation.js).
questionSchema.plugin(cacheInvalidation, { tags: () => [tags.QUESTIONS, tags.ARCHIVE] });

const Question = mongoose.model("Question", questionSchema);

// ---------- MCQ ----------
// Options are an array rather than optionA..optionD so the count is not fixed
// at four and scoring can loop instead of branching.
const Mcq = Question.discriminator(
  "mcq",
  new mongoose.Schema(
    {
      options: {
        type: [
          {
            key: { type: String, required: true },
            text: String,
            // An option can be a diagram with no words, which is normal in
            // physics and chemistry.
            image: { type: mongoose.Schema.Types.ObjectId, ref: "Media" },
          },
        ],
        validate: {
          validator: (v) => v.length >= 2,
          message: "An MCQ needs at least two options",
        },
      },
      correctOption: {
        type: String,
        required: [true, "Please mark the correct option"],
      },
    },
    { timestamps: true }
  )
);

// ---------- Multiple true / false ----------
const Mtf = Question.discriminator(
  "mtf",
  new mongoose.Schema(
    {
      statements: {
        type: [
          {
            text: { type: String, required: true },
            isTrue: { type: Boolean, required: true },
          },
        ],
        validate: {
          validator: (v) => v.length >= 2,
          message: "An MTF question needs at least two statements",
        },
      },
      // No per-statement marks field: each statement is worth an equal
      // share of `marks` (Submission's scoreObjectiveAnswer).
    },
    { timestamps: true }
  )
);

// ---------- Written ----------
const Written = Question.discriminator(
  "written",
  new mongoose.Schema(
    {
      // the rubric is what AI grading scores against. no rubric, no AI grading.
      rubric: {
        type: [
          {
            criterion: { type: String, required: true },
            marks: { type: Number, required: true },
            guidance: String,
          },
        ],
        default: [],
      },
      modelAnswer: String,
      wordLimit: Number,
    },
    { timestamps: true }
  )
);

const writtenHasRubric = (doc) =>
  Array.isArray(doc.rubric) && doc.rubric.length > 0;

// ---------- Passage ----------
// A prompt (the base question/questionImage fields above, reused as-is —
// no separate passageText/passageImage field needed) with an array of mcq
// sub-questions under it, each independently auto-graded exactly like a
// standalone mcq (see submissionModel.js's scoreObjective). Chapter-pool
// only — never filed under a topic, enforced in questionController.js, not
// here, matching the same application-level-not-schema-level pattern the
// rest of this file uses for cross-field checks (an mcq's correctOption
// naming a real option, say).
//
// The base `marks` field is never hand-entered for a passage question — it
// is always the sum of every sub-question's own `marks`, recomputed on
// every save (see the pre-validate hook below) so every existing call site
// that already reads `question.marks` (exam summaries, smart-pick, the
// admin bank list) keeps working unmodified, with zero passage-specific
// branching needed anywhere marks are totalled. The base `negativeMarks`
// field is unused for this type — each sub-question carries its own.
const passageSchema = new mongoose.Schema(
  {
    subQuestions: {
      type: [
        {
          // mcq: options and a key, marked automatically. written: answered
          // in text or photos and marked by a grader or AI against its
          // rubric, like a standalone written question.
          type: { type: String, enum: ["mcq", "written"], default: "mcq" },
          // Its label in the paper: ক, খ or a, b.
          label: { type: String, maxlength: 10 },
          question: { type: String, required: true },
          questionImage: { type: mongoose.Schema.Types.ObjectId, ref: "Media" },
          options: {
            type: [
              {
                key: { type: String, required: true },
                text: String,
                image: { type: mongoose.Schema.Types.ObjectId, ref: "Media" },
              },
            ],
            validate: {
              validator: function (v) { return this.type === "written" || v.length >= 2; },
              message: "Every multiple choice question under a passage needs at least two options",
            },
          },
          correctOption: {
            type: String,
            required: [function () { return this.type !== "written"; }, "Mark which option is correct for every question under the passage"],
          },
          rubric: { type: [{ _id: false, criterion: { type: String, required: true }, marks: { type: Number, required: true } }], default: undefined },
          modelAnswer: String,
          marks: {
            type: Number,
            default: 1,
            min: [0, "Marks cannot be negative"],
          },
          negativeMarks: {
            type: Number,
            default: 0,
            min: [0, "Negative marks are stored as a positive value"],
          },
        },
      ],
      validate: {
        validator: (v) => v.length >= 1,
        message: "A passage needs at least one question under it",
      },
    },
  },
  { timestamps: true }
);

passageSchema.pre("validate", function (next) {
  this.marks = (this.subQuestions || []).reduce((sum, sq) => sum + (sq.marks || 0), 0);
  next();
});

const Passage = Question.discriminator("passage", passageSchema);

// ---------- Coding ----------
// The student writes a program; it runs in a sandbox (utils/codeRunner.js)
// against every test. Shown tests can be tried with Run; hidden ones count
// only at submit. Marks: each test's own marks, or an equal share.
const Coding = Question.discriminator(
  "coding",
  new mongoose.Schema(
    {
      // Keys of utils/codeRunner.js LANGUAGES the student may pick from.
      languages: {
        type: [String],
        validate: { validator: (v) => v.length >= 1, message: "Allow at least one language" },
      },
      starterCode: { type: [{ _id: false, language: String, code: String }], default: [] },
      tests: {
        type: [
          {
            input: { type: String, default: "" },
            output: { type: String, default: "" },
            hidden: { type: Boolean, default: false },
            marks: { type: Number, default: undefined, min: 0 },
          },
        ],
        validate: { validator: (v) => v.length >= 1, message: "Add at least one test" },
      },
      timeLimitMs: { type: Number, default: 2000, min: 500, max: 10000 },
    },
    { timestamps: true }
  )
);

module.exports = { Question, Mcq, Mtf, Written, Passage, Coding, writtenHasRubric };