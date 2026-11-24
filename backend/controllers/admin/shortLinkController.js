const asyncHandler = require("express-async-handler");
const ShortLink = require("../../models/shortLinkModel");
const Coupon = require("../../models/couponModel");
const Batch = require("../../models/batchModel");
const Purchase = require("../../models/purchaseModel");
const { envBaseUrl } = require("../../utils/baseUrl");

//@desc   Get or create a short link for one coupon on one batch, landing on
//        either the subscribe page or the AI credits page.
//@route  POST /api/short-links
//@access Private (owner, admin, representative)
const createShortLink = asyncHandler(async (req, res) => {
  const { batchId, couponCode, target } = req.body;

  if (!batchId || !couponCode) {
    res.status(400);
    throw new Error("A batch and a coupon code are both required.");
  }

  const [batch, coupon] = await Promise.all([
    Batch.findById(batchId),
    Coupon.findOne({ code: String(couponCode).trim().toUpperCase() }),
  ]);

  if (!batch) {
    res.status(404);
    throw new Error("Batch not found.");
  }
  if (!coupon) {
    res.status(404);
    throw new Error("Coupon not found.");
  }

  // A representative can only ever shorten a link for their own coupon —
  // without this, any representative account could mint a shareable link
  // for a code that isn't theirs to promote (and whose redemptions
  // wouldn't even be attributed to them anyway).
  if (req.user.role === "representative" && String(coupon.representative) !== String(req.user._id)) {
    res.status(403);
    throw new Error("That coupon isn't attached to your account.");
  }

  const link = await ShortLink.findOrCreate({
    batch: batch._id,
    couponCode: coupon.code,
    target,
    createdBy: req.user._id,
  });

  // SERVER_URL (already used the same way in adapters/payment for gateway
  // callback URLs), not req.protocol/req.get("host"). Those reflect
  // whatever Host header the request actually arrived with — in dev this
  // request comes in through the admin panel's Vite proxy, which runs
  // with changeOrigin:false and so does NOT rewrite Host to the backend's
  // own address, only forwards the admin dev server's own origin. Building
  // the link from that produced a link the admin's own dev server (not the
  // API) would try to serve, which 404s since only the API has a /r route.
  // A reverse proxy in front of production could do the same thing if it
  // doesn't forward the true Host — SERVER_URL is the one place this is
  // meant to be configured explicitly, so trust that over what the request
  // happened to arrive labelled as.
  const base = process.env.SERVER_URL
    ? envBaseUrl("SERVER_URL")
    : `${req.protocol}://${req.get("host")}`;
  res.status(201).json({ code: link.code, url: `${base}/r/${link.code}` });
});

//@desc   Every short link for one coupon, with real per-link redemption
//        counts alongside the click totals — "real" because it's a live
//        count of Purchase.viaShortLink, not a guess or an aggregate that
//        just assumes clicks convert at some rate. A coupon can have
//        several links (different batches, different targets), and
//        redeemedCount on the coupon itself is a total across all of them
//        — this is what breaks that total back apart per link.
//@route  GET /api/short-links?couponCode=CODE
//@access Private (owner, admin, representative — own coupon only)
const getShortLinksForCoupon = asyncHandler(async (req, res) => {
  const { couponCode } = req.query;
  if (!couponCode) {
    res.status(400);
    throw new Error("A coupon code is required.");
  }

  const coupon = await Coupon.findOne({ code: String(couponCode).trim().toUpperCase() });
  if (!coupon) {
    res.status(404);
    throw new Error("Coupon not found.");
  }

  if (req.user.role === "representative" && String(coupon.representative) !== String(req.user._id)) {
    res.status(403);
    throw new Error("That coupon isn't attached to your account.");
  }

  const links = await ShortLink.find({ couponCode: coupon.code }).populate("batch", "name").sort({ createdAt: -1 });

  const redemptions = links.length === 0 ? [] : await Purchase.aggregate([
    { $match: { viaShortLink: { $in: links.map((l) => l.code) }, status: "complete" } },
    { $group: { _id: "$viaShortLink", count: { $sum: 1 } } },
  ]);
  const redemptionsByCode = new Map(redemptions.map((r) => [r._id, r.count]));

  res.status(200).json({
    links: links.map((l) => ({
      _id: l._id,
      code: l.code,
      batch: l.batch,
      target: l.target,
      clicks: l.clicks,
      redemptions: redemptionsByCode.get(l.code) || 0,
      createdAt: l.createdAt,
    })),
  });
});

//@desc   Resolve a short code and redirect to the real, long referral URL —
//        the exact same ?ref= link ReferralLinkButton.jsx would otherwise
//        hand out directly, plus &via= so the eventual purchase (if any)
//        can be traced back to this specific link. Public: whoever
//        received the link is not assumed to be logged into anything.
//@route  GET /r/:code
//@access Public
const redirectShortLink = asyncHandler(async (req, res) => {
  const link = await ShortLink.findOne({ code: req.params.code });

  if (!link) {
    // A student's referral link (site/r/CODE, utils/referrals.js) shares
    // this prefix: on to the home page with the code, where the student
    // app keeps it and says what it gives.
    const code = String(req.params.code || "").toUpperCase();
    if (/^[A-Z0-9_-]{3,40}$/.test(code) && await Coupon.exists({ code, referrer: { $ne: null } })) {
      res.redirect(302, `${envBaseUrl("CLIENT_URL_STUDENT") || ""}/?ref=${encodeURIComponent(code)}`);
      return;
    }
    res.status(404).send(renderLinkError("This link doesn't exist or is no longer active."));
    return;
  }

  const coupon = await Coupon.findOne({ code: link.couponCode });
  const product = link.target === "aiCredits" ? "aiCredits" : "subscriptions";

  // Checked here, not left for the purchase page to discover — a coupon
  // that's since been deactivated, expired, maxed out, or had its scope
  // narrowed away from what this link promised would otherwise silently
  // forward to a page that just rejects the code, with nothing telling
  // the person why the "discount" they were promised never showed up.
  if (!coupon || !coupon.isValid(link.batch, product)) {
    res.status(410).send(renderLinkError("This offer is no longer available. The coupon behind this link has expired, been deactivated, or reached its redemption limit."));
    return;
  }

  // Fire-and-forget — the redirect itself is what matters to whoever
  // clicked; losing an occasional click count to a transient DB hiccup is
  // harmless, but making them wait on it (or fail the redirect over it)
  // would not be.
  ShortLink.updateOne({ _id: link._id }, { $inc: { clicks: 1 } }).catch(() => {});

  const base = process.env.CLIENT_URL_STUDENT || "";
  const path = link.target === "aiCredits"
    ? `/batches/${link.batch}/ai-credits`
    : `/purchases/${link.batch}`;

  res.redirect(302, `${base}${path}?ref=${encodeURIComponent(link.couponCode)}&via=${encodeURIComponent(link.code)}`);
});

// A small, self-contained page rather than a bare text response — this is
// the one place in the whole system where a real, unauthenticated visitor
// (not a logged-in student, not staff) can land directly on the API
// server itself. A plain-text 404 there reads as the platform being
// broken; this at least reads as an intentional message.
const renderLinkError = (message) => `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Link unavailable</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; background: #0f1115; color: #e6e8ec; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 24px; }
  .card { max-width: 420px; text-align: center; }
  h1 { font-size: 18px; font-weight: 600; margin-bottom: 8px; }
  p { font-size: 14px; color: #9aa0aa; line-height: 1.5; }
</style>
</head>
<body>
  <div class="card">
    <h1>This link isn't available</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;

module.exports = { createShortLink, getShortLinksForCoupon, redirectShortLink };
