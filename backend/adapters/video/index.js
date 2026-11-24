const crypto = require("crypto");
const { streamLink } = require("../../utils/streamLink");

// Video is not stored by this application. It is either handed to a provider
// that specialises in delivery, or referenced where it already lives.
//
// Each adapter turns a stored key into something a browser can play. Only
// Bunny signs and expires, because it is the only one of these that can.

// ---------------------------------------------------------------- bunny
// A signed embed with an expiry and an origin lock. Copying the url out of the
// page buys someone a few hours, on one domain, and nothing after that.
const bunny = {
  name: "bunny",
  label: "Bunny Stream",
  needs: ["BUNNY_LIBRARY_ID", "BUNNY_SECURITY_KEY"],

  // Settings → Connections' test. Playback keys can't be checked without a
  // video; the API key can.
  async check() {
    const key = process.env.BUNNY_API_KEY;
    if (!key) return { ok: true, message: "Playback fields are filled in. Add the API key to test the connection and to upload." };
    const r = await fetch(`https://video.bunnycdn.com/library/${encodeURIComponent(process.env.BUNNY_LIBRARY_ID)}/videos?page=1&itemsPerPage=1`, { headers: { AccessKey: key, Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
    return r.ok ? { ok: true, message: "Bunny accepted the API key." } : { ok: false, message: `Bunny said no (HTTP ${r.status}).` };
  },
  signed: true,

  configured() {
    return Boolean(process.env.BUNNY_LIBRARY_ID && process.env.BUNNY_SECURITY_KEY);
  },

  embed(videoId, { expiresIn = 3600, origin } = {}) {
    const library = process.env.BUNNY_LIBRARY_ID;
    const key = process.env.BUNNY_SECURITY_KEY;

    if (!library || !key) {
      throw new Error("Bunny is selected but BUNNY_LIBRARY_ID or BUNNY_SECURITY_KEY is missing.");
    }

    const expires = Math.floor(Date.now() / 1000) + expiresIn;
    const token = crypto
      .createHash("sha256")
      .update(key + videoId + expires)
      .digest("hex");

    const url = new URL(`https://iframe.mediadelivery.net/embed/${library}/${videoId}`);
    url.searchParams.set("token", token);
    url.searchParams.set("expires", String(expires));
    // Never left to Bunny's own default — a dashboard "autoplay off"
    // setting has no effect on an embed iframe at all; only this url
    // parameter does. Explicit false regardless of what the library
    // console shows, since that setting doesn't actually reach here.
    url.searchParams.set("autoplay", "false");
    if (origin) url.searchParams.set("origin", origin);

    return { url: url.toString(), expiresAt: new Date(expires * 1000) };
  },

  // Sends a video file (a Buffer, or a Blob for a big file read from disk)
  // to the library; Bunny encodes it and it plays a few
  // minutes later. Uses BUNNY_API_KEY (the library's API key, under Stream >
  // API) when set, else the security key, as getDuration does.
  async upload(buffer, mimeType, title) {
    const library = process.env.BUNNY_LIBRARY_ID;
    const key = process.env.BUNNY_API_KEY || process.env.BUNNY_SECURITY_KEY;
    const base = `https://video.bunnycdn.com/library/${library}/videos`;
    const created = await fetch(base, {
      method: "POST",
      headers: { AccessKey: key, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ title: title || "Video" }),
    });
    const info = await created.json().catch(() => ({}));
    if (!created.ok || !info.guid) throw new Error(`Bunny answered ${created.status}: ${info.Message || info.message || "no video id"}`);
    const sent = await fetch(`${base}/${info.guid}`, { method: "PUT", headers: { AccessKey: key, "Content-Type": "application/octet-stream" }, body: buffer });
    if (!sent.ok) throw new Error(`Bunny upload failed (${sent.status}).`);
    return info.guid;
  },

  // Best-effort only — this hits Bunny's management API (a different
  // credential purpose than the playback-signing key above, though many
  // accounts use the same value for both), not the signed-embed path, so a
  // wrong/missing key here must never block linking the video itself. null
  // on any failure at all; the caller treats that exactly like a video
  // whose duration was never knowable.
  async getDuration(videoId) {
    const library = process.env.BUNNY_LIBRARY_ID;
    const key = process.env.BUNNY_SECURITY_KEY;
    if (!library || !key) return null;

    try {
      const response = await fetch(`https://video.bunnycdn.com/library/${library}/videos/${videoId}`, {
        headers: { AccessKey: key },
      });
      if (!response.ok) return null;
      const data = await response.json();
      // Bunny reports this in whole seconds as "length" on the video object.
      return Number.isFinite(data.length) && data.length > 0 ? data.length : null;
    } catch {
      return null;
    }
  },
};

// ---------------------------------------------------------------- vdocipher
// Real DRM (Widevine, FairPlay): the video is encrypted and plays only in
// VdoCipher's player, with each viewer's name drawn over it. The embed is an
// expiring link to our own /api/stream route, which asks VdoCipher for a
// one-time playback code at the moment the video is opened
// (routes/streamRoutes.js).
const VDO_API = "https://dev.vdocipher.com/api";
// The secret as pasted, cleaned: no spaces or line ends, quotes, or a
// leading "Apisecret" (VdoCipher rejects the header otherwise).
const vdoSecret = () => String(process.env.VDOCIPHER_API_SECRET || "").trim().replace(/^["']|["']$/g, "").replace(/^apisecret\s+/i, "").trim();
const vdoHeaders = () => ({ Authorization: `Apisecret ${vdoSecret()}`, Accept: "application/json" });

const vdocipher = {
  name: "vdocipher",
  label: "VdoCipher (DRM)",
  needs: ["VDOCIPHER_API_SECRET"],

  async check() {
    const r = await fetch("https://dev.vdocipher.com/api/videos?page=1&limit=1", { headers: vdoHeaders(), signal: AbortSignal.timeout(8000) });
    return r.ok ? { ok: true, message: "VdoCipher accepted the secret." } : { ok: false, message: `VdoCipher said no (HTTP ${r.status}).` };
  },
  signed: true,

  configured() {
    return Boolean(process.env.VDOCIPHER_API_SECRET);
  },

  // A video id is 32 hex characters; a dashboard link carries it too.
  parse(input) {
    const match = String(input).trim().match(/([0-9a-f]{32})/i);
    return match ? match[1].toLowerCase() : null;
  },

  embed(videoId) {
    if (!this.configured()) throw new Error("VdoCipher is selected but VDOCIPHER_API_SECRET is missing.");
    return { url: streamLink(videoId, "vdocipher"), expiresAt: null };
  },

  // A player address for one viewing, with the viewer's name moving over
  // the picture.
  async player(videoId, { watermark } = {}) {
    const annotate = watermark
      ? JSON.stringify([{ type: "rtext", text: watermark, alpha: "0.45", color: "0xFFFFFF", size: "14", interval: "5000" }])
      : undefined;
    const response = await fetch(`${VDO_API}/videos/${encodeURIComponent(videoId)}/otp`, {
      method: "POST",
      headers: { ...vdoHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ ttl: 300, ...(annotate ? { annotate } : {}) }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.otp) throw new Error(`VdoCipher answered ${response.status}: ${data.message || "no playback code"}`);
    const url = new URL("https://player.vdocipher.com/v2/");
    url.searchParams.set("otp", data.otp);
    url.searchParams.set("playbackInfo", data.playbackInfo);
    return url.toString();
  },

  // Sends a video file to VdoCipher; it is encrypted there and plays a few
  // minutes later. Returns the new video id.
  async upload(buffer, mimeType, title) {
    const created = await fetch(`${VDO_API}/videos?title=${encodeURIComponent(title || "Video")}`, { method: "PUT", headers: vdoHeaders() });
    const info = await created.json().catch(() => ({}));
    const payload = info.clientPayload;
    if (!created.ok || !payload?.uploadLink || !info.videoId) throw new Error(`VdoCipher answered ${created.status}: ${info.message || "no upload link"}`);
    const form = new FormData();
    for (const field of ["policy", "key", "x-amz-signature", "x-amz-algorithm", "x-amz-date", "x-amz-credential"]) form.append(field, payload[field]);
    form.append("success_action_status", "201");
    form.append("success_action_redirect", "");
    form.append("file", new Blob([buffer], { type: mimeType }), `video.${mimeType === "video/webm" ? "webm" : "mp4"}`);
    const sent = await fetch(payload.uploadLink, { method: "POST", body: form });
    if (!sent.ok) throw new Error(`VdoCipher upload failed (${sent.status}).`);
    return info.videoId;
  },

  // Best effort, like Bunny's: null when unknown (still processing, say).
  async getDuration(videoId) {
    if (!this.configured()) return null;
    try {
      const response = await fetch(`${VDO_API}/videos/${encodeURIComponent(videoId)}`, { headers: vdoHeaders() });
      if (!response.ok) return null;
      const data = await response.json();
      return Number.isFinite(data.length) && data.length > 0 ? Math.round(data.length) : null;
    } catch {
      return null;
    }
  },
};

// ---------------------------------------------------------------- youtube
const youtube = {
  name: "youtube",
  label: "YouTube",
  needs: [],
  signed: false,

  configured() {
    return true;
  },

  // Accepts a bare id, a watch url, a short url or an existing embed url, so a
  // teacher can paste whatever their browser gave them.
  parse(input) {
    const text = String(input).trim();
    const patterns = [
      /(?:youtube\.com\/watch\?(?:.*&)?v=)([\w-]{11})/,
      /(?:youtu\.be\/)([\w-]{11})/,
      /(?:youtube\.com\/embed\/)([\w-]{11})/,
      /(?:youtube\.com\/shorts\/)([\w-]{11})/,
      /^([\w-]{11})$/,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[1];
    }
    return null;
  },

  embed(videoId) {
    return {
      url: `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1`,
      expiresAt: null,
    };
  },
};

// ---------------------------------------------------------------- vimeo
const vimeo = {
  name: "vimeo",
  label: "Vimeo",
  needs: [],

  async check() {
    const r = await fetch("https://api.vimeo.com/me", { headers: { Authorization: `bearer ${process.env.VIMEO_ACCESS_TOKEN}` }, signal: AbortSignal.timeout(8000) });
    return r.ok ? { ok: true, message: "Vimeo accepted the token." } : { ok: false, message: `Vimeo said no (HTTP ${r.status}).` };
  },
  signed: false,

  configured() {
    return true;
  },

  parse(input) {
    const text = String(input).trim();
    const patterns = [
      /vimeo\.com\/(?:video\/)?(\d+)/,
      /player\.vimeo\.com\/video\/(\d+)/,
      /^(\d{6,})$/,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[1];
    }
    return null;
  },

  // Uploading needs VIMEO_ACCESS_TOKEN (a Vimeo app token with the upload
  // scope); linking an existing video doesn't.
  canUpload() {
    return Boolean(process.env.VIMEO_ACCESS_TOKEN);
  },

  // Sends a video file to the account (one tus request). Vimeo's own
  // privacy defaults apply; set them in Vimeo (paid plans can hide videos
  // from vimeo.com and allow embedding only on your domain).
  async upload(buffer, mimeType, title) {
    const created = await fetch("https://api.vimeo.com/me/videos", {
      method: "POST",
      headers: {
        Authorization: `bearer ${process.env.VIMEO_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
        Accept: "application/vnd.vimeo.*+json;version=3.4",
      },
      body: JSON.stringify({ name: title || "Video", upload: { approach: "tus", size: buffer.size ?? buffer.length } }),
    });
    const info = await created.json().catch(() => ({}));
    const link = info.upload?.upload_link;
    const id = String(info.uri || "").split("/").pop();
    if (!created.ok || !link || !id) throw new Error(`Vimeo answered ${created.status}: ${info.error || info.developer_message || "no upload link"}`);
    const sent = await fetch(link, {
      method: "PATCH",
      headers: { "Tus-Resumable": "1.0.0", "Upload-Offset": "0", "Content-Type": "application/offset+octet-stream" },
      body: buffer,
    });
    if (!sent.ok) throw new Error(`Vimeo upload failed (${sent.status}).`);
    return id;
  },

  embed(videoId) {
    return { url: `https://player.vimeo.com/video/${videoId}`, expiresAt: null };
  },
};

// ---------------------------------------------------------------- link
// Anything else with a url: a self-hosted mp4, a Loom, a Drive share. Playable
// but not protected, which the interface says out loud.
const link = {
  name: "link",
  label: "Direct link",
  needs: [],
  signed: false,

  configured() {
    return true;
  },

  parse(input) {
    const text = String(input).trim();
    try {
      const url = new URL(text);
      if (!["http:", "https:"].includes(url.protocol)) return null;
      return url.toString();
    } catch {
      return null;
    }
  },

  embed(url) {
    return { url, expiresAt: null };
  },
};

const PROVIDERS = { bunny, vdocipher, youtube, vimeo, link };

const get = (name) => {
  const provider = PROVIDERS[name];
  if (!provider) throw new Error(`Unknown video provider "${name}".`);
  return provider;
};

// Turns a Media document into something playable. Called at request time
// rather than stored, because a signed url has an expiry.
const resolve = (media, options = {}) => {
  if (!media || media.kind !== "video") return null;

  try {
    const provider = get(media.driver);
    const { url, expiresAt } = provider.embed(media.key, options);
    return { url, expiresAt, provider: provider.name, signed: provider.signed };
  } catch (error) {
    // A misconfigured provider must not take down the page that lists the
    // lecture. The absence is reported and everything else still renders.
    return { url: null, error: error.message, provider: media.driver };
  }
};

const list = () =>
  Object.values(PROVIDERS).map((p) => ({
    name: p.name,
    label: p.label,
    signed: p.signed,
    configured: p.configured(),
    needs: p.needs,
    // Can take a saved AI video (see VideoExport.jsx).
    upload: Boolean(p.upload) && (p.canUpload ? p.canUpload() : p.configured()),
  }));

module.exports = { get, resolve, list, PROVIDERS };
