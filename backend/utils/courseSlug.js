// Course page addresses: /courses/<slug>, made from the batch name. Letters
// and digits of any script are kept (a Bangla name stays readable), the rest
// become dashes. Unique across batches: a clash gets -2, -3…
const slugify = (text) =>
  String(text || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

const uniqueSlug = async (wanted, selfId) => {
  const Batch = require("../models/batchModel");
  const base = slugify(wanted) || `course-${String(selfId || "").slice(-6)}`;
  for (let n = 1; n < 200; n += 1) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    const taken = await Batch.exists({ slug: candidate, ...(selfId ? { _id: { $ne: selfId } } : {}) });
    if (!taken) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
};

// Batches made before course pages existed get their slug the first time
// it's needed.
const ensureSlugs = async (batches) => {
  const Batch = require("../models/batchModel");
  for (const b of batches) {
    if (b.slug) continue;
    b.slug = await uniqueSlug(b.name, b._id);
    await Batch.updateOne({ _id: b._id }, { $set: { slug: b.slug } }).catch(() => {});
  }
  return batches;
};

module.exports = { slugify, uniqueSlug, ensureSlugs };
