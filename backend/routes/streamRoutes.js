const express = require("express");
const asyncHandler = require("express-async-handler");
const jwt = require("jsonwebtoken");
const storage = require("../adapters/storage");
const video = require("../adapters/video");
const { readLink } = require("../utils/streamLink");
const { readToken } = require("../utils/generateToken");

// Who is watching, for the name drawn over a DRM video: the signed-in
// student (name and phone), else the signed-in staff member.
const viewerOf = async (req) => {
  for (const [audience, model, pick] of [
    ["student", "../models/studentModel", (s) => [s.name, s.phoneNumber || s.email]],
    ["user", "../models/userModel", (u) => [u.name, u.email]],
  ]) {
    const token = readToken(req, audience);
    if (!token) continue;
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded.aud !== audience) continue;
      const who = await require(model).findById(decoded.id).select("name phoneNumber email").lean();
      if (who) return pick(who).filter(Boolean).join(" · ");
    } catch {
      // Not signed in as this one.
    }
  }
  return "";
};

const router = express.Router();

//@desc   A picture in lecture notes, by an address that never expires.
//        Notes are saved text, so a link written into them must outlive any
//        signed storage url; this looks the file up each time. Keys are
//        content hashes, as unguessable as a public bucket's own urls.
//@route  GET /api/stream/file/:folder/:name
//@access Anyone holding the link
router.get("/file/:folder/:name", asyncHandler(async (req, res) => {
  const { folder, name } = req.params;
  // lectures: "Insert image"; questions: figures cut out by "Read pages".
  if (!["lectures", "questions"].includes(folder) || !/^[a-f0-9]{32}\.(png|jpe?g|webp|gif)$/.test(name)) { res.status(404); throw new Error("Not found."); }
  const key = `${folder}/${name}`;
  if (!(await storage.exists(key))) { res.status(404); throw new Error("Not found."); }
  res.set("Cache-Control", "private, max-age=600");
  res.redirect(302, await storage.urlFor(key));
}));

// ---------------------------------------------------- protected video (HLS)
// utils/protectedVideo.js. Every step needs a signed-in viewer (a staff
// member, or the student the link was made for) and a link that hasn't
// expired; links last 30 minutes and the player renews them.
const pv = require("../utils/protectedVideo");
const Media = require("../models/mediaModel");
const { COOKIE_NAMES } = require("../utils/generateToken");
const rateLimit = require("express-rate-limit");
const shared = require("../utils/shared");

const signedIn = (req, res, next) => {
  if (req.cookies?.[COOKIE_NAMES.user]) return require("../middleware/adminAuth").protect(req, res, next);
  return require("../middleware/studentAuth").studentProtect(req, res, next);
};
signedIn.isAuthGuard = true;

// A media id from a good link, its playlist data, and the viewer checked
// against the link. `grace`: an expired link still counts this long (only
// for getting a fresh one).
const hlsMedia = ({ keys = false, grace = 0 } = {}) => asyncHandler(async (req, res, next) => {
  const link = pv.readToken(req.params.tok, grace);
  if (link === "expired") { res.status(410); throw new Error("This link has expired. Reload the page."); }
  if (!link) { res.status(404); throw new Error("Not found."); }
  if (link.viewer && req.student && String(req.student._id) !== link.viewer) {
    res.status(403);
    throw new Error("This video was opened on another account.");
  }
  const media = await Media.findById(link.media).select(keys ? "+hls.keys" : "");
  if (!media || media.driver !== "protected" || !media.hls?.renditions?.length) { res.status(404); throw new Error("Not found."); }
  req.hlsLink = link;
  req.hlsMedia = media;
  next();
});

const keyLimiter = rateLimit({
  store: shared.rateLimitStore("hlskey"),
  passOnStoreError: true,
  windowMs: 10 * 60 * 1000,
  max: 400,
  keyGenerator: (req) => String(req.student?._id || req.user?._id || req.ip),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many video requests. Wait a few minutes." },
});

// One device at a time (Settings → Student app): starting a protected video
// claims it for this player; another player's key requests are refused
// while that claim is fresh.
const oneDevice = async () => Boolean((await require("../models/appSettingsModel").get()).studentUi?.videoOneDevice);
const Playback = () => require("../models/videoPlaybackModel");
const CLAIM_FRESH_MS = 3 * 60 * 1000;

const sendText = (res, body) => {
  res.set({ "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" });
  res.send(body);
};

//@desc   A protected video's list of qualities
//@route  GET /api/stream/hls/:tok/master.m3u8
//@access Signed-in viewer
router.get("/hls/:tok/master.m3u8", signedIn, hlsMedia(), asyncHandler(async (req, res) => {
  const player = pv.cleanPlayer(req.query.p);
  if (req.student && (await oneDevice()) && player) {
    await Playback().updateOne({ student: req.student._id }, { $set: { player, at: new Date() } }, { upsert: true });
  }
  sendText(res, pv.master(req.hlsMedia, player));
}));

//@desc   A fresh link and this viewing's key secret, for our player
//@route  GET /api/stream/hls/:tok/session
//@access Signed-in viewer
router.get("/hls/:tok/session", signedIn, hlsMedia({ grace: pv.GRACE }), (req, res, next) => {
  const player = pv.cleanPlayer(req.query.p);
  if (!player) { res.status(400); return next(new Error("Missing player.")); }
  const link = req.hlsLink;
  res.set("Cache-Control", "no-store");
  res.json({ t: pv.makeToken(link.media, link.viewer), s: pv.seedFor(link, player).toString("hex"), every: pv.RENEW });
});

//@desc   One chunk's key, wrapped for this viewing
//@route  GET /api/stream/hls/:tok/key/:k
//@access Signed-in viewer
router.get("/hls/:tok/key/:k", signedIn, keyLimiter, hlsMedia({ keys: true }), asyncHandler(async (req, res) => {
  const key = req.hlsMedia.hls.keys?.[Number(req.params.k)];
  const player = pv.cleanPlayer(req.query.p);
  if (!/^\d+$/.test(req.params.k) || !key || !player) { res.status(404); throw new Error("Not found."); }
  if (req.student && (await oneDevice())) {
    const claim = await Playback().findOne({ student: req.student._id }).lean();
    const fresh = claim && Date.now() - new Date(claim.at).getTime() < CLAIM_FRESH_MS;
    if (fresh && claim.player !== player) {
      res.status(409);
      throw new Error("This account is now watching on another device.");
    }
    await Playback().updateOne({ student: req.student._id }, { $set: { player: player || "unknown", at: new Date() } }, { upsert: true });
  }
  res.set({ "Content-Type": "application/octet-stream", "Cache-Control": "no-store" });
  res.send(pv.wrapKey(key, req.hlsLink, player, req.params.k));
}));

//@desc   One quality's list of chunks
//@route  GET /api/stream/hls/:tok/:q.m3u8
//@access Signed-in viewer
router.get("/hls/:tok/:q.m3u8", signedIn, hlsMedia(), (req, res, next) => {
  const text = pv.variant(req.hlsMedia, req.params.q, pv.cleanPlayer(req.query.p));
  if (!text) { res.status(404); return next(new Error("Not found.")); }
  sendText(res, text);
});

//@desc   One encrypted chunk
//@route  GET /api/stream/hls/:tok/:q/:n.ts
//@access Signed-in viewer
router.get("/hls/:tok/:q/:n.ts", signedIn, hlsMedia(), asyncHandler(async (req, res) => {
  const { hls } = req.hlsMedia;
  const r = hls.renditions.find((x) => x.name === req.params.q);
  const n = Number(req.params.n);
  if (!r || !Number.isInteger(n) || n < 0 || n >= r.durations.length) { res.status(404); throw new Error("Not found."); }
  const key = `${hls.folder}/${r.name}/${n}.ts`;
  const driver = storage.DRIVERS[hls.storage] || storage.getDriver();
  if (driver.pathOf) {
    return res.sendFile(driver.pathOf(key), {
      dotfiles: "deny",
      headers: { "Content-Type": "video/mp2t", "Cache-Control": "private, max-age=86400", "X-Robots-Tag": "noindex" },
    }, (err) => { if (err && !res.headersSent) res.status(404).end(); });
  }
  res.set("Cache-Control", "no-store");
  res.redirect(302, await storage.urlFor(key, hls.storage));
}));

//@desc   Play a video or voice file from an expiring link (utils/streamLink.js)
//@route  GET /api/stream/:token
//@access Anyone holding a link that hasn't expired
router.get("/:token", asyncHandler(async (req, res) => {
  const link = readLink(req.params.token);
  if (link === "expired") { res.status(410); throw new Error("This link has expired. Reload the page."); }
  if (!link) { res.status(404); throw new Error("Not found."); }
  if (link.driver === "vdocipher") {
    res.set("Cache-Control", "no-store");
    // A hosted video: named only when Settings → Name over videos is "Every video".
    const setting = (await require("../models/appSettingsModel").get()).studentUi?.videoWatermark || "all";
    const watermark = setting === "all" ? await viewerOf(req) : "";
    return res.redirect(302, await video.get("vdocipher").player(link.key, { watermark }));
  }
  const driver = storage.DRIVERS[link.driver] || storage.getDriver();
  if (driver.pathOf) {
    let file;
    try { file = driver.pathOf(link.key); } catch { res.status(404); throw new Error("Not found."); }
    // sendFile answers range requests, so the player can seek.
    return res.sendFile(file, {
      dotfiles: "deny",
      headers: { "Cache-Control": "private, max-age=3600", "Content-Disposition": "inline", "X-Robots-Tag": "noindex" },
    }, (err) => { if (err && !res.headersSent) res.status(err.statusCode || 404).end(); });
  }
  // Cloud storage: its own short-lived signed address.
  res.set("Cache-Control", "no-store");
  res.redirect(302, await storage.urlFor(link.key, link.driver));
}));

module.exports = router;
