// Purchase stacking, in one place.
//
// Buying thirty days twice gives sixty when the second purchase lands while
// the first is still running. A purchase made after a lapse restarts from its
// own start date rather than extending a window that already closed. An
// infinite plan short-circuits everything.
//
// This lives here rather than inline in the middleware so that the tests
// exercise the same code the request path does.

const FOREVER = new Date("9999-12-31T23:59:59Z");

// `purchases` must be sorted by startDate ascending.
const resolveExpiry = (purchases) => {
  let expiry = null;

  for (const purchase of purchases) {
    if (purchase.plan.isInfinite) return new Date(FOREVER);

    const days = purchase.plan.durationDays || 0;
    const base = !expiry || expiry < purchase.startDate ? purchase.startDate : expiry;
    expiry = new Date(new Date(base).getTime() + days * 86400000);
  }

  // Ended by a promotion (controllers/admin/promoteController.js): every
  // purchase of the batch carries endedAt, and access stops then.
  if (expiry && purchases.length && purchases.every((p) => p.endedAt)) {
    const end = new Date(Math.max(...purchases.map((p) => new Date(p.endedAt).getTime())));
    if (end < expiry) expiry = end;
  }
  return expiry;
};

// Same stacking walk as resolveExpiry, but returns when the *current*
// window began instead of when it ends — the purchase whose startDate (or
// whose predecessor's still-open expiry) anchors the final expiry above. A
// gap between purchases restarts the window (see resolveExpiry's own
// comment), so this is the most recent restart point, not the very first
// purchase ever made. Needed to show "days elapsed out of total days"
// rather than only "days left" — resolveExpiry alone throws that away.
const resolveWindowStart = (purchases) => {
  let expiry = null;
  let windowStart = null;

  for (const purchase of purchases) {
    if (purchase.plan.isInfinite) return purchase.startDate;

    const days = purchase.plan.durationDays || 0;
    const gapped = !expiry || expiry < purchase.startDate;
    const base = gapped ? purchase.startDate : expiry;
    if (gapped) windowStart = purchase.startDate;
    expiry = new Date(new Date(base).getTime() + days * 86400000);
  }

  return windowStart;
};

module.exports = { resolveExpiry, resolveWindowStart, FOREVER };
