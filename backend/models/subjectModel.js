const mongoose = require("mongoose");
const cacheInvalidation = require("../utils/cacheInvalidation");
const tags = require("../utils/cacheTags");
const crypto = require("crypto");

const subjectSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Please add a subject title"],
      trim: true,
    },
    slug: {
      type: String,
      unique: true,
      lowercase: true,
      index: true,
    },
    icon: String,
    iconColor: {
      type: String,
      default: "#14161A",
    },
    // replaces the hardcoded SUBJECT_ORDER array in menuController
    order: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Subjects are referenced by ObjectId everywhere, so renaming a subject no
// longer requires the cascading slug rewrite across seven collections that
// the original subjectController performed. Nothing actually reads this
// field back out as a URL or a lookup key today — it exists purely so two
// subjects can never collide under the hood — which is why the fix below
// optimizes for "always unique" over "looks like an English URL slug".
subjectSchema.pre("save", async function (next) {
  if (!this.isModified("title")) return next();

  // \p{L}\p{N} (Unicode letter/number, with the "u" flag) keeps a
  // character from ANY script — Bengali, Arabic, Chinese, Cyrillic,
  // Latin, all of it — instead of the old a-z0-9 range, which silently
  // deleted every non-Latin title down to whatever punctuation was left.
  // "পদার্থবিদ্যা - প্রথম পত্র" and "পদার্থবিদ্যা - দ্বিতীয় পত্র" both
  // used to reduce to the same bare "-" and collide on the very next
  // subject saved; this keeps the actual title text instead of erasing it.
  const base = this.title
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}-]/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  // A title that is pure emoji/punctuation/whitespace still needs some
  // slug — fall back to a short random one rather than storing "", which
  // unique:true would also reject on the very next such title.
  const fallback = () => `subject-${crypto.randomBytes(3).toString("hex")}`;

  // Guards uniqueness directly against the database rather than assuming
  // the regex above is collision-proof — two titles in any language can
  // still normalize to the same string (different punctuation stripped
  // to the same word, e.g.), so this appends -2, -3, ... until it finds
  // a slug nothing else in the collection is using.
  const Subject = this.constructor;
  let candidate = base || fallback();
  let n = 1;
  while (await Subject.exists({ slug: candidate, _id: { $ne: this._id } })) {
    n += 1;
    candidate = `${base || "subject"}-${n}`;
  }

  this.slug = candidate;
  return next();
});

// Writes here drop the cached reads built from them (utils/cacheInvalidation.js).
subjectSchema.plugin(cacheInvalidation, { tags: () => [tags.TAXONOMY, tags.ARCHIVE] });

module.exports = mongoose.model("Subject", subjectSchema);
