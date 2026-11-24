const mongoose = require("mongoose");
const cacheInvalidation = require("../utils/cacheInvalidation");
const tags = require("../utils/cacheTags");

// Access is explicit assignment only. The original general/special split and
// the fullSubject flag existed to choose between implicit subject matching and
// explicit batch membership; with one rule they have nothing left to decide.
//
// subject[] is now metadata — it filters the assignment picker and drives
// display. It is not an access rule.

const planSchema = new mongoose.Schema(
  {
    label: {
      type: String,
      required: [true, "Each plan needs a label"],
    },
    // The price in the platform's default currency. Kept required and
    // unchanged so every existing plan, and every screen that reads
    // plan.price, keeps working exactly as before.
    price: {
      type: Number,
      required: [true, "Each plan needs a price"],
      min: 0,
    },

    // Prices in other currencies, set explicitly rather than converted.
    //
    // Deliberately not an FX calculation off `price`: a rate drifts daily, so
    // the same plan would silently change price, and 2,499 BDT is a
    // considered number in a way that "whatever $19 converts to today" is
    // not. Whoever runs the institution decides what each market pays.
    //
    // A currency absent from this list means the batch is simply not sold in
    // it — which is also what decides whether a BDT-only gateway is offered
    // at all, so leaving it empty keeps the single-currency behaviour intact.
    prices: [
      {
        _id: false,
        currency: {
          type: String,
          required: true,
          uppercase: true,
          trim: true,
        },
        amount: {
          type: Number,
          required: true,
          min: 0,
        },
      },
    ],
    durationDays: {
      type: Number,
      default: null,
      // A path validator rather than a pre('validate') hook: hooks are async
      // middleware and do not run under validateSync(), so a finite plan with
      // no duration would slip through anything that validates synchronously.
      validate: {
        validator: function (value) {
          if (this.isInfinite) return true;
          return value !== null && value !== undefined && value > 0;
        },
        message: "A plan needs a duration in days unless it is infinite",
      },
    },
    isInfinite: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { _id: true }
);

const batchSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Please add a batch name"],
      trim: true,
    },
    // The public course page's address, /courses/<slug> (Settings → SEO →
    // Course pages). Made from the name when empty; utils/courseSlug.js.
    slug: { type: String, trim: true, lowercase: true, default: undefined },
    // That page's own search and share tags (Settings → SEO → Course pages).
    // Empty: made from the course's name, description and cover
    // (utils/pageMeta.js).
    seo: {
      metaTitle: { type: String, trim: true, maxlength: 120, default: "" },
      metaDescription: { type: String, trim: true, maxlength: 300, default: "" },
      keywords: { type: [String], default: [] },
      ogImage: { type: String, trim: true, maxlength: 1000, default: "" },
    },
    program: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Program",
      required: true,
      index: true,
    },
    subjects: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Subject",
      },
    ],

    // The public archive's own module: which boards/exams/textbooks this
    // batch presents to its students, e.g. "HSC" and "NCTB Physics" but not
    // "JEE". Empty means the module is off for this batch — same "empty is
    // off" convention `subjects` above would use if it gated anything.
    // Content stays the shared, global archive pool (Question.isPublic);
    // this only controls which of it a given batch's students can reach,
    // the same way assigning a lecture to a batch controls reach without
    // duplicating the lecture. Deliberately NOT the same mechanism as
    // Question.batches (normal content assignment) — archive practice done
    // through this module is tracked in its own bucket (PracticeAttempt/
    // StudyPlan with batch: null), not folded into this batch's own
    // progress data, so it never touches the `batches` field on Question.
    archiveAuthorities: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "ExamAuthority",
      },
    ],

    // Owner/admin can touch any batch regardless of this list — it only
    // narrows what a teacher can do, never what an admin can. Managing who's
    // on it is itself an owner/admin action (see batchController.updateBatch
    // and the "teachers" field's own guard there), not something a teacher
    // can grant themselves.
    teachers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    // Same shape and same guard as teachers above — a grader is scoped to
    // exactly the batches listed here, managed only by owner/admin. Kept as
    // a separate array rather than folding into teachers because the two
    // roles get very different access (see restrictedRoleGate.js and
    // gradingController.js): a grader can only ever reach grading, nothing
    // else a teacher can touch on their batches.
    graders: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    icon: {
      // "preset" points at a name from the fixed icon set the admin panel
      // ships (a lucide icon name); "custom" points at an uploaded image
      // url. Only one is ever meaningful at a time — kind says which.
      kind: { type: String, enum: ["preset", "custom"], default: "preset" },
      value: { type: String, default: "GraduationCap" },
    },

    // Markdown, rendered through SafeMarkdown wherever it's shown (the
    // course catalogue's "view more" modal) — same convention as
    // Notice.bodyMarkdown and Program.description. Optional: a batch with
    // nothing here just shows no description section in the modal, rather
    // than an empty one.
    description: String,


    // School year or session, e.g. "2026" or "2026-27". Optional.
    year: { type: String, trim: true, maxlength: 20, default: "" },
    accessType: {
      type: String,
      enum: ["free", "paid"],
      default: "paid",
    },
    plans: [planSchema],

    trialDays: {
      type: Number,
      default: 7,
      min: 0,
    },
    trialWarningDays: {
      type: Number,
      default: 3,
    },

    // Capability switches only. Content visibility is handled by assignment,
    // so the eight isXAllowed content flags are gone.
    features: {
      lectures: { type: Boolean, default: true },
      practice: { type: Boolean, default: true },
      exams: { type: Boolean, default: true },
      aiAssist: { type: Boolean, default: false },
      doubtSolving: { type: Boolean, default: false },
      // Owner/admin only, per BatchDetail.jsx — whether a student can
      // attach one or more images to a written answer, in a real exam or
      // in practice. Independent of aiAssist: a batch might want this for
      // handwritten working shown to a human grader, with no AI involved
      // at all.
      writtenAnswerImages: { type: Boolean, default: false },
      // In exams, answer photos come only from the in-app camera (no
      // gallery, no files): a deterrent against attaching copied pages.
      cameraOnlyAnswers: { type: Boolean, default: false },
      // Whether a teacher can ask for an AI-suggested grade on a written
      // exam answer (see gradingController.js's gradeWithAi) — distinct
      // from aiAssist, which covers student-facing AI features
      // (doubt-solve, practice explain/similar, lecture summaries). This
      // one only ever matters when aiAssist is also on for the batch; the
      // endpoint checks both, not just this flag alone.
      examAiGrading: { type: Boolean, default: false },
      // Whether an admin can generate a lecture's "Ace this lecture"
      // practice questions with AI (lectureController.js's
      // generatePracticeQuestions) — same admin-triggered, student-cap-free
      // pattern as examAiGrading above, checked alongside aiAssist rather
      // than instead of it. Assigning existing bank questions to a lecture's
      // practice set needs neither flag — only generating new ones does.
      lecturePracticeGeneration: { type: Boolean, default: false },
      // Whether this batch can have live classes scheduled on it at all.
      // Off by default like every other add-on capability — see
      // controllers/admin/liveClassController.js's createLiveClass, which
      // checks this before letting a host schedule anything.
      liveClasses: { type: Boolean, default: false },
      // The AI-generated 7-day study plan (studyPlanController.js). Off by
      // default, same as every other add-on. Only matters when aiAssist is
      // also on for the batch — mirrors examAiGrading/
      // lecturePracticeGeneration's "checked alongside aiAssist, not
      // instead of it" pattern, since this is a real AI generation call,
      // not just a toggle.
      studyPlan: { type: Boolean, default: false },
      // Coding practice: a section of every coding question in the batch.
      codingPractice: { type: Boolean, default: false },
      // Lecture slides: decks published from Admin → Batch → Slides.
      lectureSlides: { type: Boolean, default: false },
      // The auto-generated per-exam AI performance report
      // (utils/examReport.js) — same "checked alongside aiAssist, not
      // instead of it" pattern as examAiGrading/studyPlan above, since this
      // is also a real AI generation call, just not a student-initiated one
      // (it fires on its own the moment a submission is graded).
      examPerformanceReport: { type: Boolean, default: false },
      // The short AI coaching note a student can request after finishing a
      // custom practice exam (practiceExamController.js's
      // getPracticeExamInsight) — same "checked alongside aiAssist, not
      // instead of it" pattern as examAiGrading/studyPlan/
      // examPerformanceReport above. Off by default, like every other
      // add-on.
      practiceExamInsight: { type: Boolean, default: false },
      // Off by default, same as every other add-on. When on, a chapter that
      // has chapter-pool questions (Question.topic === null under it — see
      // the "chapter pool" convention in questionModel.js) gets its own
      // tile in student Practice, alongside the usual per-topic tiles —
      // see practiceController.js's getTopics/getPracticeQuestions.
      practiceByChapter: { type: Boolean, default: false },
      // The on-screen scientific calculator. `calculator`: in practice,
      // similar questions, the archive, practice exams and drawn answers
      // (on unless switched off). `examCalculator`: the default for this
      // batch's exams, each of which can say otherwise (Exam.calculator).
      // Assignments: coursework with a due date (models/assignmentModel.js).
      assignments: { type: Boolean, default: true },
      calculator: { type: Boolean, default: true },
      examCalculator: { type: Boolean, default: false },
      // The archive's own master AI switch — separate from aiAssist on
      // purpose, since the archive is a shared pool across every batch's
      // own door (batch: null tracking, see archiveController.js), not
      // this batch's own content. Gates explain/similar in the archive, and
      // whether "written" is even offered as a type when a student builds
      // an archive practice exam (same "exclude at build time rather than
      // reject at submit time" pattern practiceExamController.js's own
      // aiAssist check already uses for batch practice exams). Off by
      // default, like every other add-on.
      archiveAiAssist: { type: Boolean, default: false },
      // The archive's own study plan (archiveStudyPlanController.js) — same
      // "checked alongside archiveAiAssist, not instead of it" pattern
      // studyPlan/examAiGrading/practiceExamInsight above use for their own
      // master switch.
      archiveStudyPlan: { type: Boolean, default: false },
      // The short AI coaching note after an archive practice exam
      // (archivePracticeExamController.js's getArchiveExamInsight) — same
      // "checked alongside archiveAiAssist" pattern as archiveStudyPlan.
      archiveExamInsight: { type: Boolean, default: false },
      // Document chat: "Ask this lecture" and "Ask your course" — answers
      // from this batch's lecture notes and files. Checked alongside
      // aiAssist, not instead of it, like studyPlan above.
      docChat: { type: Boolean, default: false },
      // Students ask follow-up questions on an answered practice question's
      // solution (utils/practiceQna.js). Checked alongside aiAssist.
      practiceQna: { type: Boolean, default: false },
      // Students ask for a short AI video elaborating part of a lecture or
      // video lesson (utils/studentVideo.js). Checked alongside aiAssist.
      studentVideos: { type: Boolean, default: false },
      // Oral Quiz: an AI teacher asks about a lecture and the student answers
      // aloud or by typing (poraController.js). Checked alongside aiAssist.
      poraDhora: { type: Boolean, default: false },
      // AI Tutoring: a written lesson check with an AI tutor
      // (aiTutorController.js). Checked alongside aiAssist.
      aiTutor: { type: Boolean, default: false },
      // Interview practice: a viva or interview panel, out loud
      // (interviewController.js). Checked alongside aiAssist.
      interview: { type: Boolean, default: false },
      // The admin copilot (agents) may create exams, notices and classes
      // for this batch. Also needs Settings → AI → Agents.
      agentCopilot: { type: Boolean, default: false },
      // The assignment agent may suggest and apply assignment grades here,
      // and remind students about work due. Also needs Settings → AI → Agents.
      agentAssignments: { type: Boolean, default: false },
      // The grading agent may mark written answers here (also needs AI help
      // and AI-assisted grading on, like the grading screen's AI button).
      agentGrading: { type: Boolean, default: false },
      // The after-class agent may make a quiz and message absentees here.
      agentAfterClass: { type: Boolean, default: false },
      // The at-risk agent may check on this batch's students weekly.
      agentAtRisk: { type: Boolean, default: false },
      // The support agent may draft answers to this batch's escalated doubts.
      agentSupport: { type: Boolean, default: false },
      // Students of this batch get the daily tutor.
      agentTutor: { type: Boolean, default: false },
    },

    // A bonus on top of the global AiConfig.limits.dailyCallsPerStudent for
    // this batch specifically — unset/0 (no default here on purpose) means
    // no bonus, just the platform default. Additive, not a replacement: a
    // batch that's paying for heavier AI use can give its own students
    // extra calls on top of the baseline everyone gets, but can't be used
    // to make a batch more conservative than the platform default — that's
    // a deliberate simplification, not an oversight.
    aiLimits: {
      dailyCallsPerStudent: { type: Number, min: 0 },
    },

    // A weekly cap on doubts that reach a human — set directly in "human"
    // mode, or escalated there from AI. NOT the same "0 = no cap"
    // convention aiLimits uses, deliberately: unset/null means unlimited
    // human doubts, but 0 is its own distinct state — "this batch has no
    // human capacity at all," which routes every doubt to AI only (see
    // assertWithinWeeklyDoubtLimit in utils/doubtQuota.js, and the
    // doubtSolving+aiAssist gating in controllers/app/doubtController.js).
    // No default here on purpose, same reasoning as aiLimits above: opt-in
    // per batch, and "unset" has to stay reachable as its own state,
    // distinct from an admin deliberately typing 0.
    doubtLimits: {
      weeklyHumanDoubts: { type: Number, min: 0 },
    },

    isActive: {
      type: Boolean,
      default: false,
    },

    // This batch's own course outline: the order its subjects, chapters,
    // topics and lectures appear in, and named groups of chapters (papers,
    // terms, units). Every student list and the admin batch tabs sort
    // through utils/courseOutline.js, so they always agree. Anything not
    // listed falls back to the syllabus order, after everything listed, so
    // new content still shows up. A chapter sits in at most one group.
    outline: {
      groups: [
        {
          name: { type: String, trim: true, maxlength: 60, required: true },
          chapters: [{ type: mongoose.Schema.Types.ObjectId, ref: "Chapter" }],
        },
      ],
      subjects: [{ type: mongoose.Schema.Types.ObjectId, ref: "Subject" }],
      chapters: [{ type: mongoose.Schema.Types.ObjectId, ref: "Chapter" }],
      topics: [{ type: mongoose.Schema.Types.ObjectId, ref: "Topic" }],
      lectures: [{ type: mongoose.Schema.Types.ObjectId, ref: "Lecture" }],
    },

    // The gradebook (utils/gradebook.js): how exams and assignments add up
    // to one grade. Categories are weighted; an item's category is an
    // assignment's own category, "Exams" for an exam, or an override here.
    // The scale turns the overall percentage into a letter (and GPA points
    // where the scale has them). Students see their grades only once
    // published.
    // Progress reports to students and guardians (utils/progressReports.js):
    // how often, to whom and how. The instant result message is separate:
    // one SMS or email as each exam is graded.
    progressReports: {
      enabled: { type: Boolean, default: false },
      frequency: { type: String, enum: ["weekly", "biweekly", "monthly"], default: "weekly" },
      weekday: { type: Number, min: 0, max: 6, default: 5 }, // 0 Sunday … 6 Saturday
      monthDay: { type: Number, min: 1, max: 28, default: 1 },
      hour: { type: Number, min: 0, max: 23, default: 20 },
      student: { sms: { type: Boolean, default: false }, email: { type: Boolean, default: true } },
      guardian: { sms: { type: Boolean, default: true }, email: { type: Boolean, default: true } },
      language: { type: String, enum: ["en", "bn"], default: "en" },
      showRank: { type: Boolean, default: true },
      instantResult: { type: Boolean, default: false },
      // The scheduled send last done ("2026-10-16"), so a restart or a
      // second server never sends the same one twice.
      lastPeriod: { type: String, default: "" },
    },
    gradebook: {
      categories: [
        {
          _id: false,
          name: { type: String, trim: true, maxlength: 40, required: true },
          weight: { type: Number, min: 0, max: 100, default: 0 },
        },
      ],
      scale: [
        {
          _id: false,
          letter: { type: String, trim: true, maxlength: 6, required: true },
          min: { type: Number, min: 0, max: 100, required: true },
          points: { type: Number, min: 0, max: 10, default: null },
        },
      ],
      overrides: [
        {
          _id: false,
          ref: { type: mongoose.Schema.Types.ObjectId, required: true },
          category: { type: String, trim: true, maxlength: 40, default: null },
          excluded: { type: Boolean, default: false },
        },
      ],
      missingAsZero: { type: Boolean, default: false },
      published: { type: Boolean, default: false },
      // Position in class on report cards and the student's grades page.
      showRank: { type: Boolean, default: false },
      // Report card wording: the term ("Half-yearly 2026") and a signature line.
      term: { type: String, trim: true, maxlength: 80, default: "" },
      signedBy: { type: String, trim: true, maxlength: 80, default: "" },
      // Signatures at the foot of the report card (up to 3), each with an
      // optional uploaded or drawn picture. Replaces signedBy when set.
      signatures: [
        {
          _id: false,
          name: { type: String, trim: true, maxlength: 60, default: "" },
          role: { type: String, trim: true, maxlength: 60, default: "" },
          image: { type: String, default: null },
        },
      ],
    },

    // Display order among sibling batches within the same program — an
    // admin's own curation, distinct from the catalogue's public ordering
    // rules if it ever gets any. Not unique or dense; ties fall back to
    // name so a freshly created batch (order: 0, same as everyone else
    // until moved) still sorts somewhere stable.
    order: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

batchSchema.methods.hasFeature = function (name) {
  return Boolean(this.features && this.features[name]);
};

// owner/admin decided elsewhere (the middleware checks role first and only
// falls back to this for teachers) — this only answers "is this specific
// teacher one of the ones assigned to this specific batch".
batchSchema.methods.hasTeacher = function (userId) {
  return this.teachers.some((t) => String(t) === String(userId));
};

batchSchema.methods.hasGrader = function (userId) {
  return this.graders.some((g) => String(g) === String(userId));
};

// "Is this person any kind of grading staff on this batch" — teacher or
// grader, either counts. Used wherever grading access itself is being
// checked rather than the wider teacher-only content-authoring access.
batchSchema.methods.hasGradingStaff = function (userId) {
  return this.hasTeacher(userId) || this.hasGrader(userId);
};

// One place that answers "what does this plan cost in this currency", so no
// caller has to remember that `price` means the default currency and
// `prices` means everything else. Returns null when the plan is not sold in
// the requested currency at all — which is a real answer, not an error, and
// is what stops a batch being offered through a gateway that only takes a
// currency it has no price in.
planSchema.methods.priceIn = function (currency, defaultCurrency) {
  const wanted = String(currency || "").toUpperCase();

  if (!wanted || wanted === String(defaultCurrency || "").toUpperCase()) {
    return this.price;
  }

  const match = (this.prices || []).find((p) => p.currency === wanted);
  return match ? match.amount : null;
};

// Every currency this plan can actually be bought in, default first.
planSchema.methods.currencies = function (defaultCurrency) {
  const base = String(defaultCurrency || "").toUpperCase();
  const others = (this.prices || []).map((p) => p.currency).filter((c) => c !== base);
  return [base, ...others].filter(Boolean);
};

// Writes here drop the cached reads built from them (utils/cacheInvalidation.js).
batchSchema.index({ slug: 1 }, { unique: true, partialFilterExpression: { slug: { $type: "string" } } });

batchSchema.pre("save", async function () {
  if (this.slug && !this.isModified("slug")) return;
  const { uniqueSlug } = require("../utils/courseSlug");
  this.slug = await uniqueSlug(this.slug || this.name, this._id);
});

batchSchema.plugin(cacheInvalidation, { tags: () => [tags.BATCHES, tags.LANDING] });

module.exports = mongoose.model("Batch", batchSchema);
