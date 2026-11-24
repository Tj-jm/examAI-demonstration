const asyncHandler = require("express-async-handler");
const Batch = require("../models/batchModel");
const Purchase = require("../models/purchaseModel");
const Trial = require("../models/trialModel");
const { resolveExpiry } = require("../utils/accessWindow");
const cache = require("../utils/cache");
const tags = require("../utils/cacheTags");

// Establishes whether a student may see anything belonging to a batch, and
// leaves the result on req for downstream handlers. Every content route and
// every AI route sits behind this — an AI endpoint that queried content
// directly would leak paid material to trial users.

const ACCESS_TTL_S = 60;

// The batch, the end of the student's paid access (purchases chained) and
// the end of their latest trial. Plain data, so it can be cached.
const resolveAccess = async (studentId, batchId) => {
  const batch = await Batch.findById(batchId).lean();
  if (!batch || !batch.isActive) return { batch: null };
  const now = new Date();

  // Free batches used to be auto-enrolled — now they go through a 0-cost
  // purchase like any other batch, so access is checked via Purchase here.
  // Sorted ascending because resolveExpiry walks them in order.
  const purchases = await Purchase.find({ student: studentId, batch: batch._id, status: "complete" })
    .select("plan startDate endedAt")
    .sort({ startDate: 1 })
    .lean();
  const expiry = resolveExpiry(purchases);

  const trial = await Trial.findOne({ student: studentId, batch: batch._id, endDate: { $gte: now } })
    .select("endDate")
    .sort({ endDate: -1 })
    .lean();

  return { batch: JSON.parse(JSON.stringify(batch)), expiry: expiry || null, trialEnd: trial?.endDate || null };
};

//@desc Resolve and enforce batch access for the authenticated student
const batchAccess = asyncHandler(async (req, res, next) => {
  const batchId = req.params.batchId || req.body.batchId;

  if (!batchId) {
    res.status(400);
    throw new Error("A batch is required for this request.");
  }

  // The batch and this student's access to it, read on every batch route,
  // are cached briefly (Settings → Performance, "access"). A purchase,
  // trial or batch write drops them at once; the short expiry is only the
  // safety net. Expiry dates are still compared with the clock on each
  // request, so a cached grant never outlives the access itself.
  const cached = await cache.wrap(
    `access:${req.student._id}:${batchId}`,
    [tags.ACCESS, tags.access(req.student._id), tags.BATCHES, tags.batch(batchId)],
    () => resolveAccess(req.student._id, batchId),
    { group: "access", ttlS: ACCESS_TTL_S }
  );

  if (!cached.batch || !cached.batch.isActive) {
    res.status(404);
    throw new Error("Batch not found.");
  }

  req.batch = Batch.hydrate(cached.batch);

  const now = new Date();
  const expiry = cached.expiry ? new Date(cached.expiry) : null;
  if (expiry && expiry >= now) {
    req.accessVia = "purchase";
    req.expiresAt = expiry;
    return next();
  }

  const trialEnd = cached.trialEnd ? new Date(cached.trialEnd) : null;
  if (trialEnd && trialEnd >= now) {
    req.accessVia = "trial";
    req.expiresAt = trialEnd;
    req.trialEndsAt = trialEnd;
    return next();
  }

  res.status(403);
  throw new Error("You do not have an active subscription or trial for this batch.");
});

//@desc Require a batch capability flag. Runs after batchAccess.
// usage: router.get("/x", studentProtect, batchAccess, requireFeature("aiAssist"), handler)
const requireFeature = (feature) => {
  const guard = asyncHandler(async (req, res, next) => {
    if (!req.batch) {
      res.status(500);
      throw new Error("requireFeature must run after batchAccess.");
    }

    if (!req.batch.hasFeature(feature)) {
      res.status(403);
      throw new Error("That is not included in this batch.");
    }

    return next();
  });

  guard.isFeatureGuard = true;
  guard.feature = feature;
  return guard;
};

batchAccess.isBatchGuard = true;

module.exports = { batchAccess, requireFeature };
