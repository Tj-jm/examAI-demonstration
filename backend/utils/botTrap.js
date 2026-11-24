// The bot check on public forms (the landing page's interest form, joining
// a public webinar). Two signs of a bot:
//  - the hidden "website" box is filled in. Browsers' autofill sometimes
//    puts the person's own name, phone or email there, so a copy of one of
//    those doesn't count.
//  - the form came back under 2 seconds after it was shown ("elapsed", in
//    ms, sent by the page). Missing (an older page) means not checked.

const MIN_MS = 2000;

const plain = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9@.]/g, "");
const digits = (v) => String(v || "").replace(/\D/g, "");

const sameAsGiven = (box, body) => {
  const b = plain(box);
  if (!b) return true;
  if ([body?.name, body?.email].some((v) => plain(v) && plain(v) === b)) return true;
  // A phone may come back as +8801… where they typed 01…: the last 9 digits.
  const p = digits(body?.phone);
  const d = digits(box);
  return p.length >= 6 && d.length >= 6 && p.slice(-9) === d.slice(-9);
};

const looksLikeBot = (body) => {
  const box = String(body?.website || "").trim();
  if (box && !sameAsGiven(box, body)) return true;
  const elapsed = Number(body?.elapsed);
  if (body?.elapsed != null && Number.isFinite(elapsed) && elapsed < MIN_MS) return true;
  return false;
};

module.exports = { looksLikeBot };
