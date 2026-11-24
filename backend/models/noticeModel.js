const mongoose = require("mongoose");
const cacheInvalidation = require("../utils/cacheInvalidation");
const tags = require("../utils/cacheTags");

// A notice is either "general" — shown in a carousel on the student
// homepage, every student sees it — or "batch", shown in that batch's own
// Notice Central, visible only to students in one of the listed batches.
// Never both at once: a notice that should reach two different audiences is
// two notices, not one with mixed scoping, which is what keeps "who sees
// this" answerable by reading noticeType alone rather than cross-checking
// against batches every time.
const noticeSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Please add a title"],
      trim: true,
    },

    // Markdown, same as a lecture's body — headings, lists, bold, links,
    // code. Rendered through the same SafeMarkdown component so the two
    // content types can never drift into different rendering rules.
    bodyMarkdown: {
      type: String,
      required: [true, "Please add a description"],
    },

    noticeType: {
      type: String,
      enum: ["general", "batch"],
      required: true,
    },

    // Required non-empty when noticeType is "batch", forced empty when
    // "general" — enforced in the controller rather than a schema
    // validator, so the error can name which rule was actually broken
    // instead of a generic Mongoose validation message.
    batches: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Batch",
      },
    ],

    // Optional. A notice with no cover image gets a themed placeholder on
    // the client rather than a broken image or an empty gap — see
    // NoticeCard in both frontends. Deliberately not a required field: a
    // one-line "exam moved to Friday" notice does not need a banner photo,
    // and forcing one would just get a random stock image nobody chose.
    coverImage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Media",
      default: null,
    },

    // The optional call-to-action button. Same {kind, value} shape as a
    // batch's own icon — see batchModel.js — so both use the same
    // IconPicker component and the same BatchIcon renderer on either
    // frontend, rather than a second icon system just for notices.
    icon: {
      kind: { type: String, enum: ["preset", "custom"], default: "preset" },
      value: { type: String, default: null },
    },

    // Both present or both absent — enforced in the controller. A link
    // with no label is a mystery button; a label with no link does nothing
    // when tapped.
    link: { type: String, default: null },
    linkLabel: { type: String, default: null },
    // The phone notification's line. Empty: "A new notice was posted."
    pushText: { type: String, default: "", maxlength: 140, trim: true },
    // General notices only: shown as a full card on a phone even when the
    // home screen uses the slim notice strip (Settings → Student app).
    featured: { type: Boolean, default: false },

    isPublished: {
      type: Boolean,
      default: false,
    },

    // Optional scheduling window. Either or both may be unset — an unset
    // publishFrom means "as soon as it's published", an unset publishUntil
    // means "indefinitely". A notice with isPublished:true still will not
    // show if the current moment falls outside this window; see isLive()
    // below, which is the one place that rule is allowed to live.
    publishFrom: { type: Date, default: null },
    publishUntil: { type: Date, default: null },

    // Set the first time this notice is found live after a save, and never
    // touched again. Without this, editing a typo in an already-live
    // notice's title would re-notify every one of its students a second
    // time for the same announcement — the guard is against re-notifying on
    // edit, not against ever notifying at all.
    notifiedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Whether a student would see this notice right now. Used both for the
// admin list's status pill (so "published" and "actually visible" are never
// silently different things shown as the same word) and to build the query
// that filters student-facing reads — see liveQuery() below, which has to
// express the same rule in Mongo query form rather than by filtering in JS
// after the fact.
noticeSchema.methods.isLive = function (now = new Date()) {
  if (!this.isPublished) return false;
  if (this.publishFrom && this.publishFrom > now) return false;
  if (this.publishUntil && this.publishUntil < now) return false;
  return true;
};

// The one-word status a human reads at a glance in the admin list. Distinct
// from isLive() only in that it explains *why* something isn't live —
// "Scheduled" and "Expired" are both isLive():false, but they are not the
// same situation and an admin scanning a list needs to tell them apart
// without opening each row.
noticeSchema.methods.status = function (now = new Date()) {
  if (!this.isPublished) return "draft";
  if (this.publishFrom && this.publishFrom > now) return "scheduled";
  if (this.publishUntil && this.publishUntil < now) return "expired";
  return "live";
};

// The Mongo-query form of isLive(), for filtering at the database level
// rather than fetching everything and checking each document in JS — which
// is exactly the shortcut the sample project's own pagination bug came
// from: count and filter have to agree, and they only reliably agree when
// they're built from the same expression.
// The homepage carousel and Notice Central, both newest first.
noticeSchema.index({ noticeType: 1, isPublished: 1, createdAt: -1 });
noticeSchema.index({ batches: 1, isPublished: 1, createdAt: -1 });

noticeSchema.statics.liveQuery = (extra = {}, now = new Date()) => ({
  ...extra,
  isPublished: true,
  $and: [
    { $or: [{ publishFrom: null }, { publishFrom: { $lte: now } }] },
    { $or: [{ publishUntil: null }, { publishUntil: { $gte: now } }] },
  ],
});

// Writes here drop the cached reads built from them (utils/cacheInvalidation.js).
noticeSchema.plugin(cacheInvalidation, { tags: () => [tags.NOTICES, tags.LANDING] });

module.exports = mongoose.model("Notice", noticeSchema);
