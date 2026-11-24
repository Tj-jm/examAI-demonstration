const crypto = require("crypto");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const Media = require("../models/mediaModel");
const storage = require("../adapters/storage");

// Self-hosted protected video. A video is cut by ffmpeg into 6-second
// chunks at 360p and 720p (1080p when asked), and each chunk is encrypted
// here with AES-128; a new key every 10 chunks. Nothing on disk says how to
// play it: playlists are written per request with links that expire, and a
// key is handed only to a signed-in viewer (routes/streamRoutes.js), and
// wrapped: scrambled with a secret for that viewing that only our player
// asks for and knows how to undo. A download manager sees hundreds of
// encrypted pieces and keys that don't open them.

const SEGMENT = 6;
const ROTATE = 10;
// Links last 30 minutes; a playing video gets a fresh one every 20 (the
// session route), and a page left open up to GRACE can still start it.
const TTL = 30 * 60;
const GRACE = 12 * 60 * 60;
const RENEW = 20 * 60;
// Bitrate caps sized for lectures (writing, slides and faces stay sharp);
// a still board uses far less than the cap.
const LADDER = [
  { name: "360p", height: 360, video: 900, audio: 96 },
  { name: "540p", height: 540, video: 1800, audio: 128 },
  { name: "720p", height: 720, video: 3500, audio: 128 },
  { name: "1080p", height: 1080, video: 6500, audio: 128 },
];
const HOST = os.hostname();

const workDir = () => path.resolve(process.env.STORAGE_LOCAL_PATH || "./uploads", "..", "hls-work");

// ------------------------------------------------------------------ tokens

// The link in a playlist url: which media, and (for a lecture opened by a
// student) which student it was opened for. Encrypted, so it can't be made
// up or edited, and it expires.
const secret = () => crypto.createHash("sha256").update(`hls-link:${process.env.JWT_SECRET || ""}`).digest();

const makeToken = (mediaId, viewer = null, ttl = TTL) => {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", secret(), iv);
  const body = Buffer.concat([c.update(JSON.stringify({ m: String(mediaId), v: viewer ? String(viewer) : null, e: Math.floor(Date.now() / 1000) + ttl })), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64url");
};

// { media, viewer } for a good token, "expired", or null. `grace` seconds
// past the end still count (only for getting a fresh link).
const readToken = (token, grace = 0) => {
  try {
    const raw = Buffer.from(String(token), "base64url");
    if (raw.length < 29) return null;
    const d = crypto.createDecipheriv("aes-256-gcm", secret(), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    const data = JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8"));
    if (!data.m || !Number.isFinite(data.e)) return null;
    if (data.e + grace < Date.now() / 1000) return "expired";
    return { media: data.m, viewer: data.v || null };
  } catch {
    return null;
  }
};

const playUrl = (mediaId, viewer) => `/api/stream/hls/${makeToken(mediaId, viewer)}/master.m3u8`;

// ------------------------------------------------------------ wrapped keys

// A secret for one viewing (this media, viewer and player). The key route
// XORs each key with a mask made from it; the player gets it from the
// session route and undoes the mask (student-app src/utils/protectedHls.js
// must use the same mask).
const seedFor = (link, player) => crypto.createHmac("sha256", secret()).update(`seed:${link.media}:${link.viewer || ""}:${player}`).digest();
const maskFor = (seed, k) => crypto.createHmac("sha256", seed).update(`examai-hls:${k}`).digest().subarray(0, 16);
const wrapKey = (keyHex, link, player, k) => {
  const key = Buffer.from(keyHex, "hex");
  const mask = maskFor(seedFor(link, player), k);
  return Buffer.from(key.map((b, i) => b ^ mask[i]));
};

// --------------------------------------------------------------- playlists

const cleanPlayer = (p) => (/^[a-z0-9]{8,40}$/i.test(String(p || "")) ? String(p) : "");

const master = (media, player) => {
  const q = player ? `?p=${player}` : "";
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3"];
  for (const r of media.hls.renditions) {
    const width = Math.round((r.height * 16) / 9 / 2) * 2;
    lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${r.bandwidth},RESOLUTION=${width}x${r.height},NAME="${r.name}"`, `${r.name}.m3u8${q}`);
  }
  return `${lines.join("\n")}\n`;
};

const ivFor = (i) => {
  const iv = Buffer.alloc(16);
  iv.writeUInt32BE(i, 12);
  return iv;
};

const variant = (media, name, player) => {
  const r = media.hls.renditions.find((x) => x.name === name);
  if (!r) return null;
  const q = player ? `?p=${player}` : "";
  const target = Math.ceil(Math.max(SEGMENT, ...r.durations));
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3", `#EXT-X-TARGETDURATION:${target}`, "#EXT-X-MEDIA-SEQUENCE:0", "#EXT-X-PLAYLIST-TYPE:VOD"];
  r.durations.forEach((dur, i) => {
    // Same key urls in every quality, so switching quality reuses a key.
    lines.push(`#EXT-X-KEY:METHOD=AES-128,URI="key/${Math.floor(i / ROTATE)}${q}",IV=0x${ivFor(i).toString("hex")}`);
    lines.push(`#EXTINF:${dur.toFixed(3)},`, `${name}/${i}.ts`);
  });
  lines.push("#EXT-X-ENDLIST");
  return `${lines.join("\n")}\n`;
};

// ------------------------------------------------------------------ ffmpeg

const run = (cmd, args, onLine) =>
  new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let err = "";
    let out = "";
    p.stdout.on("data", (d) => {
      out += d;
      if (onLine) {
        const parts = out.split("\n");
        out = parts.pop();
        parts.forEach(onLine);
      }
    });
    p.stderr.on("data", (d) => { err = (err + d).slice(-4000); });
    p.on("error", (e) => reject(e.code === "ENOENT" ? new Error(`${cmd} isn't installed on the server (apt install -y ffmpeg).`) : e));
    p.on("close", (code) => (code === 0 ? resolve(onLine ? "" : out) : reject(new Error(`${cmd} failed: ${err.split("\n").filter(Boolean).slice(-2).join(" ")}`))));
  });

const probe = async (src) => {
  const out = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=height:format=duration", "-of", "json", src]);
  const j = JSON.parse(out || "{}");
  return { height: Number(j.streams?.[0]?.height) || 0, duration: Number(j.format?.duration) || 0 };
};

const sourceOf = async (media) => {
  const s = media.hls.source || {};
  if (s.path) return s.path;
  const driver = storage.DRIVERS[s.driver];
  if (!driver) throw new Error("The original video file isn't in storage any more.");
  // Local disk: the file itself. S3: a signed address ffmpeg reads from.
  return driver.pathOf ? driver.pathOf(s.key) : storage.urlFor(s.key, s.driver);
};

const parsePlaylist = (text) => {
  const files = [];
  let dur = null;
  for (const line of text.split("\n").map((l) => l.trim())) {
    if (line.startsWith("#EXTINF:")) dur = parseFloat(line.slice(8));
    else if (line && !line.startsWith("#") && dur !== null) {
      files.push({ file: line, dur });
      dur = null;
    }
  }
  return files;
};

const putChunk = async (driver, key, buf) => {
  if (driver.put.length >= 3) return driver.put(key, buf, "video/mp2t");
  return driver.put(key, buf);
};

const convert = async (media) => {
  const src = await sourceOf(media);
  const { height, duration } = await probe(src);
  if (!height) throw new Error("No video picture found in that file.");
  // Never above the original's own height (upscaling only adds blur).
  let ladder = LADDER.filter((r) => r.height === 360 || (r.height === 540 && height >= 500) || (r.height === 720 && height >= 680) || (r.height === 1080 && media.hls.hd && height >= 1000));
  if (height < 360) ladder = [{ ...LADDER[0], name: `${height}p`, height }];

  const driver = storage.getDriver();
  // A fresh folder each time: a re-convert mustn't overwrite chunks someone
  // is watching; the old ones go once the new ones are in place.
  const folder = `protected/${crypto.randomBytes(16).toString("hex")}`;
  const old = media.hls.renditions?.length ? { storage: media.hls.storage, folder: media.hls.folder } : null;
  const keys = [];
  const keyFor = (i) => {
    const k = Math.floor(i / ROTATE);
    while (keys.length <= k) keys.push(crypto.randomBytes(16).toString("hex"));
    return Buffer.from(keys[k], "hex");
  };
  const tmp = path.join(workDir(), `job-${media._id}`);
  await fs.rm(tmp, { recursive: true, force: true });
  const renditions = [];
  let lastSave = 0;
  try {
    for (const [ri, r] of ladder.entries()) {
      const dir = path.join(tmp, r.name);
      await fs.mkdir(dir, { recursive: true });
      const args = [
        "-hide_banner", "-y", "-i", src, "-map", "0:v:0", "-map", "0:a:0?",
        "-vf", `scale=-2:${r.height}:flags=lanczos`, "-c:v", "libx264", "-preset", "faster", "-profile:v", "high", "-pix_fmt", "yuv420p",
        "-crf", r.height >= 720 ? "20" : "21", "-maxrate", `${r.video}k`, "-bufsize", `${r.video * 2}k`,
        "-force_key_frames", `expr:gte(t,n_forced*${SEGMENT})`,
        "-c:a", "aac", "-b:a", `${r.audio}k`, "-ac", "2",
        "-f", "hls", "-hls_time", String(SEGMENT), "-hls_playlist_type", "vod",
        "-hls_segment_filename", path.join(dir, "%d.ts"), "-progress", "pipe:1", "-nostats", path.join(dir, "index.m3u8"),
      ];
      await run("ffmpeg", args, (line) => {
        const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
        if (!m || !duration) return;
        const part = Math.min(1, Number(m[1]) / 1e6 / duration);
        const pct = Math.round(((ri + part * 0.9) / ladder.length) * 100);
        if (Date.now() - lastSave > 3000) {
          lastSave = Date.now();
          Media.updateOne({ _id: media._id }, { $set: { "hls.progress": pct } }).catch(() => {});
        }
      });
      // Encrypt each chunk and put it in storage; the plain one is deleted.
      const list = parsePlaylist(await fs.readFile(path.join(dir, "index.m3u8"), "utf8"));
      for (const [i, seg] of list.entries()) {
        const file = path.join(dir, seg.file);
        const c = crypto.createCipheriv("aes-128-cbc", keyFor(i), ivFor(i));
        const enc = Buffer.concat([c.update(await fs.readFile(file)), c.final()]);
        await putChunk(driver, `${folder}/${r.name}/${i}.ts`, enc);
        await fs.rm(file, { force: true });
      }
      renditions.push({ name: r.name, height: r.height, bandwidth: (r.video + r.audio) * 1000, durations: list.map((s) => Number(s.dur.toFixed(3))) });
      await Media.updateOne({ _id: media._id }, { $set: { "hls.progress": Math.round(((ri + 1) / ladder.length) * 100) } });
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }

  await Media.updateOne({ _id: media._id }, {
    $set: {
      driver: "protected", key: folder, durationSeconds: Math.round(duration) || media.durationSeconds,
      "hls.status": "ready", "hls.progress": 100, "hls.error": null, "hls.folder": folder, "hls.storage": driver.name,
      "hls.renditions": renditions, "hls.keys": keys, "hls.finishedAt": new Date(),
    },
  });
  if (old && old.folder !== folder) await removeChunks({ hls: old });
  // A new upload's original is kept in the work folder (never served), so
  // the video can be converted again later at a better quality.
};

// ------------------------------------------------------------------- queue

// One video at a time on each server. A queued upload waits for the server
// whose disk holds it; a stored file can be taken by any server.
let busy = false;

const next = async () => {
  if (busy) return;
  busy = true;
  try {
    for (;;) {
      const media = await Media.findOneAndUpdate(
        { "hls.status": "queued", $or: [{ "hls.source.host": { $in: [null, ""] } }, { "hls.source.host": HOST }] },
        { $set: { "hls.status": "converting", "hls.progress": 0, "hls.worker": HOST, "hls.startedAt": new Date() } },
        { new: true, sort: { updatedAt: 1 } }
      );
      if (!media) break;
      try {
        await convert(media);
      } catch (error) {
        console.error(`Protected video ${media._id}: ${error.message}`);
        await Media.updateOne({ _id: media._id }, { $set: { "hls.status": "failed", "hls.error": error.message.slice(0, 300) } });
      }
    }
  } finally {
    busy = false;
  }
};

const kick = () => { next().catch((e) => console.error(`Protected video queue: ${e.message}`)); };

// After a restart, this server's half-done jobs go back in the queue.
const start = async () => {
  await Media.updateMany({ "hls.status": "converting", "hls.worker": HOST }, { $set: { "hls.status": "queued" } });
  kick();
  setInterval(kick, 30000).unref();
};

const hasOriginal = async (media) => {
  const src = media.hls?.source || {};
  if (src.path) return fs.access(src.path).then(() => true, () => false);
  return Boolean(src.driver && src.key && storage.DRIVERS[src.driver]);
};

// Queue a stored video file (a live recording, an exported lesson).
const queueStored = async (media, { hd = false } = {}) => {
  const fromStorage = Boolean(storage.DRIVERS[media.driver]);
  // Again (a retry, or a re-convert at a new quality): needs the original.
  const again = media.driver === "protected" && (await hasOriginal(media));
  if (media.kind !== "video" || (!fromStorage && !again)) {
    throw new Error(media.driver === "protected" ? "The original file of this video isn't kept, so it can't be converted again. Upload it again instead." : "Only video files kept in storage can be protected.");
  }
  if (["queued", "converting"].includes(media.hls?.status)) return media;
  const set = { "hls.status": "queued", "hls.progress": 0, "hls.error": null, "hls.hd": Boolean(hd) };
  if (fromStorage) set["hls.source"] = { driver: media.driver, key: media.key };
  await Media.updateOne({ _id: media._id }, { $set: set });
  kick();
  return Media.findById(media._id);
};

// An uploaded file, already on this server's disk.
const queueUpload = async ({ file, title, hd, uploadedBy }) => {
  const folder = `protected/${crypto.randomBytes(16).toString("hex")}`;
  const media = await Media.create({
    title: title || file.originalname, kind: "video", driver: "protected", key: folder,
    sizeBytes: file.size, mimeType: file.mimetype, uploadedBy,
    hls: { status: "queued", progress: 0, hd: Boolean(hd), folder, source: { path: file.path, host: HOST } },
  });
  kick();
  return media;
};

const incomingDir = async () => {
  const dir = path.join(workDir(), "incoming");
  await fs.mkdir(dir, { recursive: true });
  return dir;
};

// Deletes a protected video's chunks (local disk; on S3 they stay until
// the bucket's own clean-up, as listing a prefix isn't in the adapter).
const removeChunks = async (media) => {
  const driver = storage.DRIVERS[media.hls?.storage];
  if (driver?.pathOf && media.hls?.folder) await fs.rm(driver.pathOf(media.hls.folder), { recursive: true, force: true }).catch(() => {});
  if (media.hls?.source?.path) await fs.rm(media.hls.source.path, { force: true }).catch(() => {});
};

// What the admin and the apps see about it (never the keys or paths).
const publicState = (hls) => (hls?.status ? {
  status: hls.status, progress: hls.progress || 0, error: hls.error || null, hd: Boolean(hls.hd),
  qualities: (hls.renditions || []).map((r) => r.name),
  // Has a playable version (also while a re-convert runs).
  playable: Boolean(hls.renditions?.length),
  reconvert: Boolean(hls.source?.path || (hls.source?.driver && hls.source?.key)),
} : null);

module.exports = { makeToken, readToken, playUrl, seedFor, wrapKey, GRACE, RENEW, cleanPlayer, master, variant, start, kick, queueStored, queueUpload, incomingDir, removeChunks, publicState, ROTATE };
