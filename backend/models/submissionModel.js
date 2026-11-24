const mongoose = require("mongoose");

// One answer shape covers all three question types. Only one of the three
// value fields is populated, decided by the question's discriminator.
const answerSchema = new mongoose.Schema(
  {
    question: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Question",
      required: true,
    },
    questionType: {
      type: String,
      enum: ["mcq", "mtf", "written", "passage", "coding"],
      required: true,
    },
    // A passage's written question (utils/passageParts.js): this answer is
    // "written", for question.subQuestions[subIndex].
    subIndex: { type: Number, default: undefined },

    // mcq — the chosen option key. coding — the chosen language.
    selectedOption: {
      type: String,
      default: null,
    },
    // mtf — one boolean per statement, index-aligned with the question
    statementAnswers: {
      type: [
        {
          index: Number,
          value: { type: Boolean, default: null },
        },
      ],
      default: undefined,
    },
    // passage — one selected option key per sub-question, index-aligned
    // with question.subQuestions, same shape/overwrite convention as
    // statementAnswers above (the client resends the whole array on every
    // change, see saveAnswer). A sub-question absent from this array is
    // simply unanswered — scored the same as a blank mcq (0), not wrong.
    subAnswers: {
      type: [
        {
          index: Number,
          selectedOption: { type: String, default: null },
        },
      ],
      default: undefined,
    },
    // written — free text. coding — the program.
    answerText: {
      type: String,
      default: null,
    },
    // written — one or more images the student attached (handwritten
    // working, a diagram) alongside or instead of typed text. Plain
    // strings (storage paths/urls), same pattern as Doubt.questionImage —
    // not a Media ref, since these are never browsed or reused anywhere
    // else the way a lecture attachment or question image is. Whether a
    // student can add these at all is a batch-level toggle checked in the
    // controller (see submissionModel.js's sibling in the Batch schema),
    // not enforced here.
    answerImages: {
      type: [String],
      default: undefined,
    },
    // The flattened result of a teacher marking up this answer in the
    // script doodler (see admin-panel's ScriptDoodler.jsx) — the
    // student's original answerText/answerImages plus pen strokes, shape
    // stamps, and typed notes, saved as one image so a teacher (or anyone
    // reviewing later) sees the marked-up script exactly as it was left,
    // not just the final numeric mark. Persistent by design: this is
    // meant to mimic keeping a physically annotated paper script, not a
    // scratch pad that disappears once grading is done.
    annotatedImage: {
      type: String,
      default: null,
    },
    // coding — how the program did on every test, set when the paper is
    // handed in (utils/codeRunner.js judgeAnswers).
    codeResult: {
      type: {
        _id: false,
        passed: Number,
        total: Number,
        results: [{ _id: false, passed: Boolean, status: String, timeMs: Number }],
        error: String,
        at: Date,
      },
      default: undefined,
    },

    // milliseconds spent on this question. collected by the player so weak
    // topic analysis can distinguish "wrong fast" from "wrong after a struggle".
    timeSpentMs: {
      type: Number,
      default: 0,
    },

    // ---------- grading ----------
    marksAwarded: {
      type: Number,
      default: null,
    },
    gradedBy: {
      type: String,
      enum: ["auto", "ai", "teacher"],
      default: null,
    },
    // Which specific staff member graded this, when gradedBy is "teacher"
    // — gradedBy alone only ever said the mode ("a person did this"), never
    // who. null for "auto"/"ai" grading, and for any answer graded before
    // this field existed. Kept even if that staff account is later
    // deleted (see userModel.js's isDeleted) — populate this and select
    // isDeleted to show a "(deleted)" tag rather than losing the record of
    // who actually graded it.
    gradedByUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    // ai suggestion is kept even after a teacher overrides it. the gap between
    // aiMarks and marksAwarded is how a buyer tunes their rubric prompts.
    aiMarks: Number,
    aiReasoning: String,
    aiConfidence: Number,
    // The note for the student that goes with the AI mark when it is used.
    aiFeedback: String,
    // What the AI read the answer's photos as, when not handwriting
    // (printed, screenshot, mixed), and the handwriting-check mode that
    // applied then (utils/handwriting.js). Null when they look handwritten.
    notHandwritten: { type: String, default: null },
    handwritingAction: { type: String, enum: [null, "flag", "hold", "zero"], default: null },
    // Shown to the student, on this specific answer — set either by the
    // teacher during normal grading (gradeAnswer) or as the "note for the
    // student" on a flagged mcq/mtf answer.
    teacherComment: String,
    // Private — an admin's guidance to the teacher when approving a
    // referral (decideReferral), e.g. "recheck part b against the rubric".
    // Never sent to the student: submissionController.js's getSubmission
    // answer-shaping simply never includes this field.
    adminNoteToTeacher: {
      type: String,
      default: null,
    },
    // Only meaningful during an active referral regrade — decideReferral
    // resets this to false on every referred answer (written or not) when
    // approving. gradeAnswer flips it back to true the moment this specific
    // answer is touched again. Exists purely so the "regrade is complete"
    // notification can tell whether a flagged mcq/mtf answer (whose marks
    // never change — see decideReferral) has actually been looked at, since
    // pendingWrittenAnswers has no way to know that on its own.
    regradeReviewed: {
      type: Boolean,
      default: true,
    },
    gradedAt: Date,
    // Set when an approved regrade reopens this answer (decideReferral):
    // who marked it first, when, and the mark they gave. The first marker
    // keeps the grading credit (gradedByUser/gradedAt stay) unless someone
    // else does the regrade (utils/gradingFlow.js).
    regradeOf: {
      by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      at: { type: Date, default: null },
      marks: { type: Number, default: null },
    },
  },
  { _id: true }
);

answerSchema.virtual("isGraded").get(function () {
  return this.marksAwarded !== null && this.marksAwarded !== undefined;
});

const submissionSchema = new mongoose.Schema(
  {
    exam: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Exam",
      required: true,
      index: true,
    },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
      index: true,
    },
    batch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Batch",
      required: true,
    },
    attempt: {
      type: Number,
      default: 1,
    },

    // in_progress  student has started, timer running
    // submitted    answers received, objective parts scored, written queued
    // grading      at least one written answer is with the AI or a teacher
    // graded       every answer has a mark. only now is a score visible.
    // rejected     arrived after the buffer window
    // abandoned    never submitted, timer long expired
    // disqualified an owner/admin call, layered on top of whatever status
    //              this had — see the `disqualified` sub-doc below. Always
    //              reversible via reinstate, which restores the status this
    //              held the moment before.
    status: {
      type: String,
      enum: ["in_progress", "submitted", "grading", "graded", "rejected", "abandoned", "disqualified"],
      default: "in_progress",
      index: true,
    },

    answers: {
      type: [answerSchema],
      default: [],
    },

    // withheld from the student until status is 'graded'
    marks: {
      type: Number,
      default: null,
    },
    totalMarks: {
      type: Number,
      default: null,
    },
    // A mark entered for an offline exam (see Exam.offline): no answers.
    offline: {
      type: new mongoose.Schema({
        absent: { type: Boolean, default: false },
        remark: { type: String, default: "", maxlength: 300 },
        parts: { type: [Number], default: [] }, // per Exam.offline.parts, null when not given
        enteredBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      }, { _id: false }),
      default: undefined,
    },

     startedAt: {
       type: Date,
       default: Date.now,
     },
     submittedAt: Date,
     gradedAt: Date,
     totalTimeMs: {
       type: Number,
       default: 0,
     },

     remark: String,

     // Auto-generated once, right when this submission first reaches
     // "graded" (see utils/examReport.js and its two call sites) — a short
     // AI note grounded in this attempt's own per-topic accuracy, shown to
     // the student alongside their result. Absent on any submission from
     // before this existed, or one with nothing topic-classified to report
     // on — every reader treats that exactly like "no report yet", no
     // separate empty-state needed.
     performanceReport: {
       summary: { type: String, default: null },
       strengths: { type: [String], default: undefined },
       weaknesses: { type: [String], default: undefined },
       recommendation: { type: String, default: null },
       generatedAt: { type: Date, default: null },
       // Handed to the background queue (Pro, Settings → Performance): the
       // result page shows it's being written until generatedAt is set.
       queuedAt: { type: Date, default: null },
     },

     // Flag-only exam integrity: the exam UI logs a violation while an
     // attempt is in progress, this just records it. Nothing here ever
     // changes grading, scoring, or submission status — a grader reading a
     // flag count decides what it means, same as they'd weigh any other
     // context. Wired up today: "tab-hidden" (ExamTake.jsx's
     // visibilitychange listener) and "answer-paste" (a paste event into a
     // written question's answer box — doesn't distinguish pasting your
     // own earlier draft back in from pasting someone else's text, that
     // judgment call is the grader's), and "left-exam" (leaving the exam
     // page inside the app, after a warning). window-blur/fullscreen-exit are
     // reserved enum values for later, not yet emitted by anything.
     violations: [
       {
         type: {
           type: String,
           enum: ["tab-hidden", "answer-paste", "window-blur", "fullscreen-exit", "left-exam"],
           required: true,
         },
         at: { type: Date, default: Date.now },
         // tab-hidden / left-exam only: when the student came back. Still
         // null once the attempt closed means they never did.
         backAt: { type: Date, default: null },
       },
     ],

     // Disqualify/reinstate — an owner/admin decision, separate from
     // grading and from the violations log above (which is purely
     // informational, see its own comment). This is deliberately never
     // wiped on reinstate: previousStatus/reason/by/at stay as the record
     // of what happened, and reinstatedBy/reinstatedAt just get added
     // alongside them. A second disqualify overwrites all of it, same as a
     // fresh decision would.
     // Set when the exam's away limit ended this attempt: "submit" (scored
     // with what was saved) or "abandon" (zero), how long the student was
     // away, the limit then, and whether they ever came back.
     awayEnd: {
       type: {
         mode: { type: String, enum: ["submit", "abandon"] },
         awayMs: Number,
         limitMinutes: Number,
         back: Boolean,
       },
       default: undefined,
     },

     disqualified: {
       reason: { type: String, default: null },
       by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
       at: { type: Date, default: null },
       previousStatus: { type: String, default: null },
       reinstatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
       reinstatedAt: { type: Date, default: null },
     },

     // A student gets exactly one review request per submission, ever —
     // approved or rejected, requested stays true once set, which is what
     // makes "one review" a hard cap rather than "one at a time". reason is
     // required at request time so an owner/admin has something to judge;
     // decision stays null while a request is pending.
     //
     // Approving a review does not create a parallel workflow: it re-opens
     // the submission's grading state so the original teacher can recheck
     // and update marks. The reviewedAnswers array records which specific
     // answers the student flagged for review.
     referral: {
       requested: { type: Boolean, default: false },
       reason: { type: String, default: null },
       questionIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Question" }],
       requestedAt: { type: Date, default: null },
       decision: { type: String, enum: ["approved", "rejected"], default: null },
       decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
       decidedAt: { type: Date, default: null },
       // The teacher's note to the student once a re-grade after an
       // approved referral is done (saveReferralNote). Referral-level, not
       // per-answer, since a re-grade can touch several flagged answers.
       regradeNote: { type: String, default: null },
       // Set once gradeAnswer has sent the "regrade complete" notification,
       // so it fires exactly once — the completion check (every flagged
       // answer's regradeReviewed is true) can otherwise stay true across
       // several later saves (e.g. editing a note afterward) and would
       // re-notify the student every time without this.
       regradeNotified: { type: Boolean, default: false },
       // Where the regrade goes (decideReferral): "original" (each answer to
       // whoever marked it first), "grader" (routeTo) or "pool" (anyone on
       // the batch). Until routeUntil passes; after that, or if that person
       // is deactivated, deleted or off the batch, anyone on the batch can.
       routeMode: { type: String, enum: ["original", "grader", "pool"], default: "original" },
       routeTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
       routeUntil: { type: Date, default: null },
     },

     // Whole-submission claim, not per-answer — GradeOne opens every written
     // answer on one screen, so that's the unit a grader actually works on.
     // null claimedBy means open to anyone on the batch. A claim older than
     // CLAIM_STALE_MS (gradingController.js) is treated as abandoned and
     // claimable again — there's no explicit "release on crash", so staleness
     // is what stops a dropped tab from locking a submission out forever.
     claimedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
     claimedAt: { type: Date, default: null },

     // Who holds this script until it's finished (utils/gradingFlow.js):
     // in "by script" pay mode, whoever saves its first mark; in either
     // mode, a grader an admin assigned it to. Unlike the claim above it
     // doesn't go stale; an admin reopens a stuck script instead.
     heldBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
     heldSince: { type: Date, default: null },
     heldAssigned: { type: Boolean, default: false },
     // Last time a person saved a mark here: a part-marked script with no
     // progress for Settings → Grading's "stuck after" hours is flagged.
     progressAt: { type: Date, default: null },
     // When the grading agent sent this script to a person for review
     // (agents/grading.js), so it doesn't ask again every pass.
     agentReviewAt: { type: Date, default: null },
     // Pay credit for the whole script ("by script" mode): who finished it
     // and when. A regrade keeps it with them unless someone else does it.
     credit: {
       by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
       at: { type: Date, default: null },
     },
   },
  { timestamps: true }
);

submissionSchema.index({ exam: 1, student: 1, attempt: 1 }, { unique: true });
submissionSchema.index({ status: 1, exam: 1 });
// Leaderboard ({batch, status}) and a student's results in one batch.
submissionSchema.index({ batch: 1, status: 1 });
submissionSchema.index({ student: 1, batch: 1 });

submissionSchema.methods.autoGradeBlankWrittenAnswers = function () {
  let changed = false;

  for (const answer of this.answers) {
    const hasTypedAnswer = typeof answer.answerText === "string" && answer.answerText.trim().length > 0;
    const hasImages = Array.isArray(answer.answerImages)
      && answer.answerImages.some((url) => typeof url === "string" && url.trim().length > 0);

    if (
      answer.questionType === "written"
      && !hasTypedAnswer
      && !hasImages
      && (answer.marksAwarded === null || answer.marksAwarded === undefined)
    ) {
      answer.marksAwarded = 0;
      answer.gradedBy = "auto";
      answer.gradedAt = new Date();
      changed = true;
    }
  }

  return changed;
};

// One objective answer (mcq, mtf, passage) against its question, in place.
// Exported for re-scoring a single question after its answer key changes.
const scoreObjectiveAnswer = (answer, question) => {
  if (question.type === "mcq") {
    if (answer.selectedOption === null || answer.selectedOption === undefined) {
      answer.marksAwarded = 0;
    } else if (answer.selectedOption === question.correctOption) {
      answer.marksAwarded = question.marks;
    } else {
      answer.marksAwarded = -(question.negativeMarks || 0);
    }
  } else if (question.type === "mtf") {
    // Each statement is worth an equal share of the question's marks: a
    // right call adds that share, a wrong one takes it away, a blank one is
    // 0. So a 1-mark question with 4 statements is +/-0.25 per statement and
    // the question's marks are exactly what a fully right answer earns.
    const count = (question.statements || []).length;
    const share = count > 0 ? (question.marks || 0) / count : 0;
    let total = 0;

    for (const stmt of answer.statementAnswers || []) {
      const expected = question.statements[stmt.index];
      if (!expected || stmt.value === null || stmt.value === undefined) continue;
      total += stmt.value === expected.isTrue ? share : -share;
    }

    answer.marksAwarded = Math.round(total * 100) / 100;
  } else if (question.type === "passage") {
    // One answer doc bundles every sub-question, each graded exactly like
    // a standalone mcq (own marks, own negativeMarks) and summed into
    // this one marksAwarded — so finalizeIfComplete's flat reduce over
    // `answers` needs no change at all to total a passage correctly.
    // A sub-question missing from subAnswers (never touched) contributes
    // nothing, same as a blank mcq scoring 0 rather than being penalized.
    let total = 0;

    for (const sub of answer.subAnswers || []) {
      const expected = question.subQuestions[sub.index];
      // Written questions under it have their own answers.
      if (!expected || expected.type === "written" || sub.selectedOption === null || sub.selectedOption === undefined) continue;
      total += sub.selectedOption === expected.correctOption
        ? (expected.marks || 0)
        : -(expected.negativeMarks || 0);
    }

    answer.marksAwarded = total;
  } else if (question.type === "coding") {
    const results = answer.codeResult?.results || [];
    answer.marksAwarded = results.length ? require("../utils/codeRunner").marksFor(question, results) : 0;
  } else {
    return;
  }
  answer.gradedBy = "auto";
  answer.gradedAt = new Date();
};

submissionSchema.methods.scoreObjective = function (questionMap) {
  if (!(questionMap instanceof Map)) {
    throw new Error("scoreObjective requires a Map of questionId to question");
  }

  this.autoGradeBlankWrittenAnswers();

  for (const answer of this.answers) {
    if (answer.questionType === "written") continue;

    const question = questionMap.get(String(answer.question));

    if (!question) {
      throw new Error(`Question ${answer.question} missing while scoring submission ${this._id}`);
    }

    scoreObjectiveAnswer(answer, question);
  }
};

submissionSchema.methods.pendingWrittenAnswers = function () {
  return this.answers.filter(
    (a) => a.questionType === "written" && (a.marksAwarded === null || a.marksAwarded === undefined)
  );
};

// Called after objective scoring and again after each written answer is
// graded. The score is only computed and exposed once nothing is pending.
submissionSchema.methods.finalizeIfComplete = function () {
  const pending = this.pendingWrittenAnswers();

  if (pending.length > 0) {
    this.status = "grading";
    return false;
  }

  // Nothing pending and this submission was already graded before — a
  // later call here (a comment-only note edit, say, with no marks change)
  // has nothing new to finalize. Recomputing marks/gradedAt on every such
  // call would silently reset the grading timestamp, and the caller
  // (gradeAnswer) would re-notify the student that their exam "has been
  // graded" purely because a note was saved. Only a genuine transition
  // into "graded" — pending just went from something to nothing — does
  // that; this returns true either way, so callers can tell the two apart
  // by checking status before calling this.
  // The total still follows any mark changed since ("Update mark").
  if (this.status === "graded") {
    this.marks = this.answers.reduce((sum, a) => sum + (a.marksAwarded || 0), 0);
    return true;
  }

  this.marks = this.answers.reduce((sum, a) => sum + (a.marksAwarded || 0), 0);
  this.status = "graded";
  this.gradedAt = new Date();
  return true;
};

// Returns the current referral state for the student's view, or null if no
// referral has been requested. Used by the exam-result page to decide whether
// to show the referral button or the review status.
submissionSchema.methods.getReferralState = function () {
  if (!this.referral?.requested) return null;

  return {
    requested: true,
    reason: this.referral.reason,
    questionIds: this.referral.questionIds,
    requestedAt: this.referral.requestedAt,
    decision: this.referral.decision,
    decidedBy: this.referral.decidedBy,
    decidedAt: this.referral.decidedAt,
    regradeNote: this.referral.regradeNote,
  };
};

// Leaderboards follow every write (utils/leaderboard.js; Pro).
submissionSchema.plugin(require("../utils/leaderboard").submissionHooks);
// A closed attempt holds no more buffered saves (utils/autosave.js; Pro).
submissionSchema.plugin(require("../utils/autosave").submissionHooks);

const Submission = mongoose.model("Submission", submissionSchema);
Submission.scoreObjectiveAnswer = scoreObjectiveAnswer;
module.exports = Submission;
