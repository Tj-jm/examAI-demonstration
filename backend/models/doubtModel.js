const mongoose = require("mongoose");

// A student's question, answered one of two ways — AI first with an option
// to escalate, or straight to a human. Both paths converge on the same
// record so a doubt-solver's queue and a student's own history are both
// just filtered views of one collection, not two separate flows to keep
// in sync.
//
// Status is the state machine:
//   pending   -> just created, AI call in flight (mode: "ai" only —
//                mode: "human" skips straight to "escalated")
//   answered  -> AI has answered; student can regenerate or escalate
//   escalated -> waiting on a human (either escalated from AI, or
//                mode: "human" from the start)
//   resolved  -> a doubt-solver has written the final answer. Can return
//                to "escalated" exactly once, if a student's review request
//                is approved — see the review sub-document below.

const doubtSchema = new mongoose.Schema(
  {
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
      index: true,
    },
    topic: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Topic",
    },

    question: {
      type: String,
      required: [true, "Describe the doubt"],
      trim: true,
    },
    // A reference image for whoever answers this — not read by the AI in
    // this version (no vision model wired up yet), but still worth letting
    // a student attach for a human solver to look at.
    questionImage: String,

    mode: {
      type: String,
      enum: ["ai", "human"],
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "answered", "escalated", "resolved"],
      default: "pending",
      index: true,
    },

    // The moment this doubt actually became a human doubt-solver's
    // problem — set immediately for a doubt created in "human" mode, or
    // when an "ai" mode doubt is later escalated. This is what the weekly
    // human-doubt quota counts against, deliberately not createdAt: a
    // doubt started with the AI in one week and escalated the next should
    // count against the week it actually consumed human capacity, not the
    // week it happened to be typed. See utils/doubtQuota.js.
    escalatedAt: { type: Date, default: null, index: true },
    // When the support agent last looked at it (agents/support.js).
    agentCheckedAt: { type: Date, default: null },

    aiAnswer: String,
    regenerateCount: {
      type: Number,
      default: 0,
    },

    humanAnswer: String,
    // A doubt-solver's reply image — a worked step, a diagram, a marked-up
    // version of the student's own photo. Optional alongside humanAnswer,
    // never a replacement for it (resolveDoubt still requires answer text).
    humanAnswerImage: String,
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    resolvedAt: Date,

    // A student gets exactly one review request per doubt, ever — approved
    // or rejected, requested stays true forever once set, which is what
    // makes "one review" a hard cap rather than "one at a time". reason is
    // required at request time so an owner/admin has something to judge
    // before deciding; decision stays null while a request is pending.
    //
    // Approving a review does not create a parallel workflow: it sets
    // status back to "escalated", reusing the exact queue a doubt-solver
    // already checks for open work, rather than inventing a second place
    // to look. resolvedBy is deliberately left untouched when that happens
    // — it still names the original solver, which is what the queue query
    // and the resolve-controller's own guard both use to make sure only
    // that same person can supply the updated answer (see
    // controllers/admin/doubtController.js).
    review: {
      requested: { type: Boolean, default: false },
      reason: { type: String, default: null },
      requestedAt: { type: Date, default: null },
      decision: { type: String, enum: ["approved", "rejected"], default: null },
      decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      decidedAt: { type: Date, default: null },
    },
  },
  { timestamps: true }
);

doubtSchema.index({ status: 1, createdAt: 1 });
doubtSchema.index({ student: 1, createdAt: -1 });

module.exports = mongoose.model("Doubt", doubtSchema);
