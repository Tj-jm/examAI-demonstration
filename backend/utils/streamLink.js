const crypto = require("crypto");

// Expiring links for video and voice files kept in storage. The file's key
// is encrypted into the link, so a copied link stops working after a few
// hours and never reveals the file's permanent address. routes/streamRoutes.js
// opens them.
const TTL_SECONDS = 6 * 60 * 60;

const secret = () => crypto.createHash("sha256").update(`stream-link:${process.env.JWT_SECRET || ""}`).digest();

const streamLink = (key, driver, ttl = TTL_SECONDS) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", secret(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify({ k: key, d: driver || null, e: Math.floor(Date.now() / 1000) + ttl })), cipher.final()]);
  return `/api/stream/${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url")}`;
};

// { key, driver } for a good link, "expired", or null for anything else.
const readLink = (token) => {
  try {
    const raw = Buffer.from(String(token), "base64url");
    if (raw.length < 29) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", secret(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const data = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8"));
    if (!data.k || !Number.isFinite(data.e)) return null;
    if (data.e < Date.now() / 1000) return "expired";
    return { key: data.k, driver: data.d };
  } catch {
    return null;
  }
};

module.exports = { streamLink, readLink, TTL_SECONDS };
