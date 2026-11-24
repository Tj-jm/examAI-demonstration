// Server-made lesson video (optional; the admin's browser recording still
// works as before). Headless Chromium plays the lesson in the admin build's
// video-render.html at 1280x720 or 1920x1080: the picture is taken with the
// page's screencast, the sound with the page's own recorder (voice and
// clips through the same evening-out as the HD export), and ffmpeg puts
// them together as a course MP4. It plays in real time, so a 5-minute
// lesson takes about 5 minutes. One at a time; the rest wait their turn.
// No mouse pointer: nothing moves the mouse in a headless page.
const fs = require("fs");
const os = require("os");
const path = require("path");
const storage = require("../adapters/storage");
const { chromiumPath } = require("./printServer");

const ORIGIN = "http://lesson.render";
const ADMIN_DIST = path.join(__dirname, "../../admin-panel/dist");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif" };

const hasFfmpeg = () => {
  try { require("child_process").execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; }
};
// Why it can't run here, or null.
const cannotRender = () => {
  if (!chromiumPath()) return "The server has no Chromium. It comes with the Docker image; set CHROMIUM_PATH if it's elsewhere.";
  if (!hasFfmpeg()) return "ffmpeg isn't installed on the server (apt install -y ffmpeg).";
  if (!fs.existsSync(path.join(ADMIN_DIST, "video-render.html"))) return "The admin build has no video-render.html. Build the admin panel again.";
  return null;
};

// The lesson as the player wants it, its sound and clips from this page's
// own address (served below from storage).
const forPage = (shaped) => ({
  ...shaped,
  segments: shaped.segments.map((s) => ({
    ...s,
    audioUrl: s.audioUrl ? `${ORIGIN}/__audio/${s._id}` : null,
    parts: s.parts ? s.parts.map((p, i) => ({ ...p, audioUrl: p.audioUrl ? `${ORIGIN}/__audio/${s._id}?clip=${i}` : null })) : s.parts,
    board: (s.board || []).map((b, k) => (b.type === "clip" ? {
      ...b,
      ...(b.url ? { url: `${ORIGIN}/__clip/${s._id}/${k}` } : {}),
      ...(b.lines ? { lines: b.lines.map((l, n) => ({ ...l, audioUrl: l.audioUrl ? `${ORIGIN}/__audio/${s._id}?line=${k}.${n}` : null })) } : {}),
    } : b)),
  })),
});

// Files the page asks for: the admin build, the lesson's sound and clips
// (from storage), other paths of this site (pictures) from this server,
// pictures elsewhere as they are.
const server = (raw) => async (req) => {
  let url;
  try { url = new URL(req.url()); } catch { return req.abort(); }
  if (url.protocol === "data:" || url.protocol === "blob:") return req.continue();
  if (url.origin !== ORIGIN) return /^https?:$/.test(url.protocol) && ["image", "media", "font", "stylesheet"].includes(req.resourceType()) ? req.continue() : req.abort();
  const p = decodeURIComponent(url.pathname);
  try {
    if (p.startsWith("/admin/")) {
      const file = path.normalize(path.join(ADMIN_DIST, p.slice("/admin/".length)));
      if (!file.startsWith(ADMIN_DIST)) return req.abort();
      return req.respond({ status: 200, contentType: TYPES[path.extname(file)] || "application/octet-stream", body: await fs.promises.readFile(file) });
    }
    const seg = (id) => raw.segments.find((x) => String(x._id) === id);
    let m = /^\/__audio\/([a-f0-9]{24})$/.exec(p);
    if (m) {
      const s = seg(m[1]);
      const [k, n] = String(url.searchParams.get("line") || "").split(".").map(Number);
      const file = url.searchParams.has("clip") ? s?.parts?.[Number(url.searchParams.get("clip"))]
        : url.searchParams.has("line") ? s?.board?.[k]?.lines?.[n] : s?.audio;
      if (!file?.key) return req.respond({ status: 404, body: "" });
      return req.respond({ status: 200, contentType: "audio/mpeg", body: await storage.get(file.key, file.driver) });
    }
    m = /^\/__clip\/([a-f0-9]{24})\/(\d+)$/.exec(p);
    if (m) {
      const item = seg(m[1])?.board?.[Number(m[2])];
      if (item?.type !== "clip" || !item.media?.key) return req.respond({ status: 404, body: "" });
      return req.respond({ status: 200, contentType: /\.webm$/i.test(item.media.key) ? "video/webm" : "video/mp4", body: await storage.get(item.media.key, item.media.driver) });
    }
    // Pictures stored on this server (/media, /api/stream links).
    const local = await fetch(`http://127.0.0.1:${process.env.PORT || 5000}${url.pathname}${url.search}`);
    return req.respond({ status: local.status, contentType: local.headers.get("content-type") || "application/octet-stream", body: Buffer.from(await local.arrayBuffer()) });
  } catch {
    return req.respond({ status: 404, body: "" });
  }
};

// Picture and sound into one course MP4 (as videoLessonController's
// toCourseMp4): H.264 + AAC, constant 30 fps, the picture `skip` seconds in
// (when the lesson started), the last frame held to the end of the sound.
const mux = (videoFile, audioFile, skip, output, height) => new Promise((resolve, reject) => {
  const [w, h, rate] = height === 1080 ? [1920, 1080, "6M"] : [1280, 720, "4M"];
  const { spawn } = require("child_process");
  const args = ["-hide_banner", "-loglevel", "error", "-y",
    "-ss", Math.max(0, skip).toFixed(3), "-i", videoFile, "-i", audioFile,
    "-map", "0:v:0", "-map", "1:a:0",
    "-vf", `fps=30,scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,format=yuv420p,tpad=stop_mode=clone:stop_duration=30`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-maxrate", rate, "-bufsize", `${parseInt(rate, 10) * 2}M`, "-g", "60",
    "-af", "aresample=async=1:first_pts=0,deesser=i=0.4:m=0.5:f=0.5,alimiter=limit=0.85:level=false", "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
    "-shortest", "-movflags", "+faststart", output];
  const p = spawn("ffmpeg", args);
  let err = "";
  p.stderr.on("data", (d) => { err = (err + d).slice(-2000); });
  p.on("error", reject);
  p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`Making the MP4 failed: ${err.trim().split("\n").pop() || code}`))));
});

// The page's picture as a video file: Chromium's screencast (JPEG frames,
// sent only when something changes) fed to ffmpeg at a steady 30 fps, the
// last frame repeated while nothing moves. x264 ultrafast keeps up on a
// small server (Puppeteer's own recorder encodes VP9 and falls minutes
// behind on one CPU, then waits for it all at the end).
const screenRecorder = async (page, file, w, h) => {
  const { spawn } = require("child_process");
  const ff = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", "30", "-i", "-",
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "16", "-pix_fmt", "yuv420p", file]);
  let err = "";
  ff.stderr.on("data", (d) => { err = (err + d).slice(-2000); });
  ff.stdin.on("error", () => {});
  const closed = new Promise((ok) => { ff.on("close", ok); ff.on("error", () => ok(-1)); });
  const client = await page.createCDPSession();
  let last = null;
  let t0 = null;
  let written = 0;
  client.on("Page.screencastFrame", (e) => {
    client.send("Page.screencastFrameAck", { sessionId: e.sessionId }).catch(() => {});
    last = Buffer.from(e.data, "base64");
    if (t0 === null) t0 = Date.now();
  });
  await client.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: w, maxHeight: h, everyNthFrame: 1 });
  const pump = () => {
    if (!last || t0 === null) return;
    const due = Math.floor(((Date.now() - t0) * 30) / 1000);
    for (; written < due; written += 1) ff.stdin.write(last);
  };
  const timer = setInterval(pump, 50);
  // The first frame: the picture's start.
  for (let i = 0; i < 100 && t0 === null; i += 1) await new Promise((ok) => setTimeout(ok, 50));
  if (t0 === null) { clearInterval(timer); ff.kill("SIGKILL"); throw new Error("The page showed nothing to record."); }
  return {
    startedAt: t0,
    stop: async () => {
      pump();
      clearInterval(timer);
      await client.send("Page.stopScreencast").catch(() => {});
      await client.detach().catch(() => {});
      ff.stdin.end();
      let guard;
      const code = await Promise.race([closed, new Promise((ok) => { guard = setTimeout(() => ok("timeout"), 10 * 60000); })]);
      clearTimeout(guard);
      if (code === "timeout") { ff.kill("SIGKILL"); throw new Error("Finishing the picture took too long."); }
      if (code !== 0) throw new Error(`Recording the picture failed: ${err.trim().split("\n").pop() || code}`);
    },
    kill: () => { clearInterval(timer); ff.kill("SIGKILL"); },
  };
};

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// Plays `shaped` (shapeLesson's output) with `raw` (the lesson document, for
// its file keys) and writes the MP4 to `output`. onStep: a status line.
const renderLesson = async ({ shaped, raw, output, height = 720, captions = false, onStep = () => {} }) => {
  const puppeteer = require("puppeteer-core");
  const [w, h] = height === 1080 ? [1920, 1080] : [1280, 720];
  const base = output.replace(/\.mp4$/, "");
  const videoFile = `${base}.screen.mkv`;
  const audioFile = `${base}.sound.webm`;
  await fs.promises.mkdir(path.dirname(output), { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: chromiumPath(),
    headless: true,
    defaultViewport: { width: w, height: h, deviceScaleFactor: 1 },
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--font-render-hinting=none", "--autoplay-policy=no-user-gesture-required", "--hide-scrollbars", `--window-size=${w},${h}`],
  });
  let recorder = null;
  const sound = fs.createWriteStream(audioFile);
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    const serve = server(raw);
    page.on("request", (req) => { serve(req).catch(() => req.abort().catch(() => {})); });
    page.setDefaultTimeout(180000);
    let failed = null;
    await page.exposeFunction("__soundChunk", (b64) => { sound.write(Buffer.from(b64, "base64")); });
    await page.exposeFunction("__renderError", (msg) => { failed = msg; });
    onStep("Loading the lesson");
    await page.goto(`${ORIGIN}/admin/video-render.html`, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => typeof window.__load === "function");
    const total = await page.evaluate((l, c) => window.__load(l, c), forPage(shaped), captions);
    recorder = await screenRecorder(page, videoFile, w, h);
    const screenAt = recorder.startedAt;
    const startedAt = await page.evaluate(() => window.__start());
    const skip = (startedAt - screenAt) / 1000;
    // Until the player says it's done (or far past its length).
    const limit = Date.now() + (total * 1.5 + 180) * 1000;
    for (;;) {
      await new Promise((ok) => setTimeout(ok, 2000));
      if (failed) throw new Error(failed);
      const st = await page.evaluate(() => ({ ended: Boolean(window.__ended), at: window.__at || 0 }));
      if (st.ended) break;
      if (Date.now() > limit) throw new Error("The lesson didn't finish playing.");
      onStep(`Recording ${clock(st.at)} of ${clock(total)}`);
    }
    await new Promise((ok) => setTimeout(ok, 700));
    onStep("Finishing the recording");
    let wait;
    await Promise.race([page.evaluate(() => window.__stop()), new Promise((ok) => { wait = setTimeout(ok, 30000); })]);
    clearTimeout(wait);
    await recorder.stop();
    recorder = null;
    await new Promise((ok) => sound.end(ok));
    onStep("Making the MP4");
    await mux(videoFile, audioFile, skip, output, height);
    return { seconds: total, captions: await page.evaluate(() => window.__captions()).catch(() => null) };
  } finally {
    if (recorder) recorder.kill();
    if (!sound.closed) sound.destroy();
    await browser.close().catch(() => {});
    await fs.promises.unlink(videoFile).catch(() => {});
    await fs.promises.unlink(audioFile).catch(() => {});
  }
};

// One render at a time; each waits for the one before.
let line = Promise.resolve();
let waiting = 0;
const queued = (work, onStep) => {
  waiting += 1;
  if (waiting > 1) onStep(`Waiting for ${waiting - 1} other video${waiting > 2 ? "s" : ""} to finish`);
  const run = line.then(() => work());
  line = run.catch(() => {}).finally(() => { waiting -= 1; });
  return run;
};

module.exports = { renderLesson, cannotRender, queued, EXPORT_TMP: path.join(os.tmpdir(), "examai-exports") };
