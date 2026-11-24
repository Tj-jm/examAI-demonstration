const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const LiveClass = require("../models/liveClassModel");

// Public webinars: a share link for an in-app class that lets anyone in
// as a guest (controllers/app/webinarController.js).

const slugify = (text) =>
  String(text || "")
    .toLowerCase()
    .normalize("NFC")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "webinar";

// A link name no other class uses: the asked-for one, or the title's with
// a number on the end.
const uniqueSlug = async (want, id) => {
  const base = slugify(want);
  for (let i = 0; i < 50; i += 1) {
    const slug = i ? `${base}-${i + 1}` : base;
    const taken = await LiveClass.exists({ "public.slug": slug, _id: { $ne: id } });
    if (!taken) return slug;
  }
  return `${base}-${crypto.randomBytes(3).toString("hex")}`;
};

// Applies the editor's public-webinar settings to a class. Errors as
// { error }.
const applyPublic = async (liveClass, body) => {
  if (!body || typeof body !== "object") return {};
  const on = Boolean(body.on);
  if (on && liveClass.provider !== "livekit") return { error: "Only an in-app class can be a public webinar." };
  const cur = liveClass.public?.toObject?.() || liveClass.public || {};
  const next = { ...cur, on };
  if (["open", "otp", "google"].includes(body.entry)) next.entry = body.entry;
  if (body.replay !== undefined) next.replay = Boolean(body.replay);
  if (["open", "approve", "off"].includes(body.questions)) next.questions = body.questions;
  if (body.cap !== undefined) next.cap = Math.min(100000, Math.max(1, Math.round(Number(body.cap) || 500)));
  if (body.blurb !== undefined) next.blurb = String(body.blurb || "").trim().slice(0, 600);
  if (body.closed !== undefined) next.closed = Boolean(body.closed);
  if (on && (body.slug !== undefined || !cur.slug)) next.slug = await uniqueSlug(body.slug || cur.slug || liveClass.title, liveClass._id);
  liveClass.public = next;
  return {};
};

// A guest's pass: which guest, in which class. Lasts a day.
const guestToken = (guest) => jwt.sign({ g: String(guest._id), c: String(guest.liveClass) }, process.env.JWT_SECRET, { audience: "guest", expiresIn: "1d" });
const readGuestToken = (token) => {
  try {
    return jwt.verify(String(token || ""), process.env.JWT_SECRET, { audience: "guest" });
  } catch {
    return null;
  }
};

// A one-time code, kept hashed with the guest's id.
const codeHash = (guestId, code) => crypto.createHmac("sha256", process.env.JWT_SECRET).update(`${guestId}:${code}`).digest("hex");

// The webinar's recording to replay: the newest finished one not deleted,
// as { url, file } (file: plays in a <video>; otherwise a provider's
// player to embed). null when there's none.
const replayOf = (liveClass) => {
  const storage = require("../adapters/storage");
  const { streamLink } = require("./streamLink");
  const rec = [...(liveClass.recordings || [])].reverse().find((r) => r.status === "ready" && r.decision !== "deleted" && (r.key || r.sent?.key));
  if (!rec) return null;
  const sent = rec.sent?.status === "sent" && rec.sent.key;
  const doc = { kind: "video", driver: sent ? rec.sent.to : rec.driver || "local", key: sent ? rec.sent.key : rec.key };
  if (!sent && rec.sent?.removedCopy) return null;
  if (storage.DRIVERS[doc.driver]) return { url: streamLink(doc.key, doc.driver), file: true };
  const r = require("../adapters/video").resolve(doc, { origin: process.env.PROD_ORIGIN });
  return r?.url ? { url: r.url, file: false } : null;
};

// Google sign-in: the ID token from Google's button, checked with Google.
// { email, name, verified } or null.
const checkGoogle = async (credential) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId || !credential) return null;
  try {
    const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(String(credential).slice(0, 4096))}`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const t = await r.json();
    if (t.aud !== clientId || !["accounts.google.com", "https://accounts.google.com"].includes(t.iss)) return null;
    if (Number(t.exp) * 1000 < Date.now()) return null;
    return { email: String(t.email || "").toLowerCase(), name: String(t.name || t.given_name || "").trim(), verified: t.email_verified === true || t.email_verified === "true" };
  } catch {
    return null;
  }
};

module.exports = { replayOf, checkGoogle, slugify, uniqueSlug, applyPublic, guestToken, readGuestToken, codeHash };
