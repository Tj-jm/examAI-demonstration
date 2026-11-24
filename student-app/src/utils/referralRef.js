// A friend's referral link (site/r/CODE, or ?ref=CODE on any page) is
// remembered on this device for 30 days, so it still applies after the
// visitor reads the landing page, signs up and only then picks a plan
// (PlanPicker.jsx).

const KEY = "examai.ref";
const DAYS = 30;

export const saveRef = (code) => {
  try {
    if (code && /^[A-Za-z0-9_-]{3,40}$/.test(code)) {
      localStorage.setItem(KEY, JSON.stringify({ code: code.toUpperCase(), at: Date.now() }));
    }
  } catch { /* storage blocked: the link still works on the page it opened */ }
};

// ?ref=CODE on any page (short links, older shared links), or a campaign's
// ?coupon=CODE: the newest link opened replaces an older saved code.
export const captureRef = () => {
  try {
    const q = new URLSearchParams(window.location.search);
    saveRef(q.get("coupon") || q.get("ref"));
  } catch { /* no URL to read */ }
};

export const savedRef = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!saved?.code) return "";
    if (Date.now() - saved.at > DAYS * 86400000) {
      localStorage.removeItem(KEY);
      return "";
    }
    return saved.code;
  } catch {
    return "";
  }
};

export const clearRef = () => {
  try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
};

// The link a student shares: site/r/CODE. The server sends it on to
// /?ref=CODE (shortLinkController.js redirectShortLink).
export const refLink = (base, code) => `${String(base).replace(/\/+$/, "")}/r/${encodeURIComponent(code)}`;
