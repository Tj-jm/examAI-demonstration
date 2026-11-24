// Helpers for the HD (1080p, "Udemy-ready") video export: the recorded tab
// scaled to exactly 1920×1080, the voice evened out, and a captions file
// written from the lesson's own timing. Used by VideoExport.jsx (one
// lesson) and CourseVideoExport.jsx (a whole batch, one after another).
import fixWebmDuration from "fix-webm-duration";
import { lessonTimeline } from "./boardTimeline";

// 720p: light enough for any PC to record without stalling. The server
// turns the recording into the final course MP4 (see uploadParts).
export const HD = { width: 1280, height: 720, fps: 30, bps: 2500000 };
// The sizes offered: 720p (light, any PC) and 1080p (sharper, heavier).
export const SIZES = { 720: HD, 1080: { width: 1920, height: 1080, fps: 30, bps: 5000000 } };

// MP4 (H.264 + AAC) is what course sites ask for; WebM is the fallback.
const MP4_TYPES = ["video/mp4;codecs=avc1.640028,mp4a.40.2", "video/mp4;codecs=avc1.4D0028,mp4a.40.2", "video/mp4;codecs=avc1,mp4a.40.2", "video/mp4"];
const WEBM_TYPES = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
const supported = (t) => Boolean(window.MediaRecorder?.isTypeSupported?.(t));
export const canMp4 = () => MP4_TYPES.some(supported);
// HD records WebM (VP8 first: Chrome's lightest, steadiest recorder); the
// server makes the MP4. `fmt` is kept for callers but no longer changes it.
export const pickHdType = () => [...WEBM_TYPES.slice(1, 2), ...WEBM_TYPES, ...MP4_TYPES].find(supported) || "";

// The tab capture, asked for at up to 4K so Chrome doesn't shrink it first.
export const captureTab = () => navigator.mediaDevices.getDisplayMedia({
  video: { displaySurface: "browser", frameRate: HD.fps, width: { ideal: 1920, max: 2560 }, height: { ideal: 1080, max: 1440 } },
  audio: false,
  preferCurrentTab: true,
  selfBrowserSurface: "include",
});

// The captured board redrawn onto a 1920×1080 canvas (fitted, never
// stretched), so every lecture of a course comes out the same size
// whatever the screen. source() is the size the screen actually gave.
// Drawn and sent at a steady 30 frames a second, even while the board is
// still: a tab only sends frames when something changes, and a file built
// from those has long gaps, few keyframes and ends before its sound,
// which course sites and players handle badly.
export const scaledTrack = (track, dim = HD) => {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream([track]);
  const canvas = document.createElement("canvas");
  canvas.width = dim.width;
  canvas.height = dim.height;
  const g = canvas.getContext("2d", { alpha: false });
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  g.fillStyle = "#000";
  g.fillRect(0, 0, dim.width, dim.height);
  let stopped = false;
  let source = { width: 0, height: 0 };
  const out = canvas.captureStream(0).getVideoTracks()[0];
  const draw = () => {
    if (stopped) return;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (vw && vh) {
      source = { width: vw, height: vh };
      const k = Math.min(dim.width / vw, dim.height / vh);
      const w = Math.round(vw * k);
      const h = Math.round(vh * k);
      if (w < dim.width || h < dim.height) g.fillRect(0, 0, dim.width, dim.height);
      g.drawImage(video, Math.round((dim.width - w) / 2), Math.round((dim.height - h) / 2), w, h);
    }
    out.requestFrame?.();
  };
  let timer = null;
  const ready = video.play().then(() => { draw(); timer = setInterval(draw, 1000 / dim.fps); });
  return {
    track: out,
    ready,
    source: () => source,
    stop: () => { stopped = true; clearInterval(timer); out.stop(); video.srcObject = null; },
  };
};

// Even loudness: a gentle cut on the harsh "s" band (TTS voices hiss once
// compressed), a gentle compressor, a little make-up gain and a limiter
// set below full scale, so quiet and loud sentences (and clips) land at
// about the same level without fizz or clipping. Connect sources to
// `input`, take the sound from `output`. The server's ffmpeg step also
// de-esses and limits (videoLessonController toCourseMp4).
export const evenAudio = (ctx) => {
  const ess = ctx.createBiquadFilter();
  ess.type = "peaking";
  ess.frequency.value = 7000;
  ess.Q.value = 0.9;
  ess.gain.value = -5;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -24;
  comp.knee.value = 12;
  comp.ratio.value = 3;
  comp.attack.value = 0.005;
  comp.release.value = 0.25;
  const makeup = ctx.createGain();
  makeup.gain.value = 1.25;
  const limit = ctx.createDynamicsCompressor();
  limit.threshold.value = -6;
  limit.knee.value = 0;
  limit.ratio.value = 20;
  limit.attack.value = 0.001;
  limit.release.value = 0.1;
  ess.connect(comp);
  comp.connect(makeup);
  makeup.connect(limit);
  return { input: ess, output: limit };
};

export const recorderFor = (videoTrack, audioTracks, dim = HD) => {
  const mimeType = pickHdType();
  const rec = new MediaRecorder(new MediaStream([videoTrack, ...audioTracks]), {
    ...(mimeType ? { mimeType } : {}),
    // 2.5 Mbps at 720p (about 19 MB a minute), 5 Mbps at 1080p.
    videoBitsPerSecond: dim.bps,
    audioBitsPerSecond: 160000,
    videoKeyFrameIntervalDuration: 2000,
  });
  return { rec, mimeType: (mimeType || rec.mimeType || "video/webm").split(";")[0] };
};

// HD recordings are sent to the server while they're made, so the browser
// never holds the whole video; the server then converts them (ffmpeg) into
// a clean MP4 with a constant frame rate and the sound in step.
const PART = 8 * 1024 * 1024;

// To the server in ~8 MB parts, in order; then finish() saves it as the
// lesson's video. A failed part is tried again twice before giving up.
export const uploadParts = (lessonId) => {
  const upload = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  let index = 0;
  let queue = Promise.resolve();
  let pending = [];
  let pendingSize = 0;
  let size = 0;
  let failed = null;
  const send = (blob) => {
    const i = index++;
    queue = queue.then(async () => {
      if (failed) return;
      for (let tries = 0; ; tries += 1) {
        try {
          const res = await fetch(`/api/video-lessons/${lessonId}/export/part?upload=${upload}&index=${i}`, {
            method: "POST", credentials: "include", headers: { "Content-Type": "application/octet-stream" }, body: blob,
          });
          if (res.ok) return;
          const body = await res.json().catch(() => ({}));
          if (res.status < 500 || tries >= 2) { failed = body.message || `Uploading failed (${res.status}).`; return; }
        } catch (e) {
          if (tries >= 2) { failed = `Uploading failed: ${e.message}`; return; }
        }
        await new Promise((ok) => setTimeout(ok, 2000 * (tries + 1)));
      }
    });
  };
  const flush = () => { if (pending.length) { send(new Blob(pending)); pending = []; pendingSize = 0; } };
  return {
    push: (data) => { size += data.size; pending.push(data); pendingSize += data.size; if (pendingSize >= PART) flush(); },
    size: () => size,
    // Converts and saves (or keeps for download: to=download); resolves
    // with the result once the server is done. onWait: a status line.
    finish: async (query, onWait) => {
      flush();
      await queue;
      if (failed) throw new Error(failed);
      const res = await fetch(`/api/video-lessons/${lessonId}/export?${query}&upload=${upload}`, { method: "POST", credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || `Saving failed (${res.status}).`);
      const t0 = Date.now();
      for (;;) {
        await new Promise((ok) => setTimeout(ok, 3000));
        onWait?.(`Making the MP4 on the server… ${Math.round((Date.now() - t0) / 1000)} s`);
        const st = await fetch(`/api/video-lessons/${lessonId}/export/status?upload=${upload}`, { credentials: "include" }).then((r) => r.json()).catch(() => ({ state: "working" }));
        if (st.state === "done") return st;
        if (st.state === "error" || st.message) throw new Error(st.message || "Converting the video failed.");
      }
    },
  };
};

// Into a file in the folder the user picked, as it's recorded.
export const writeParts = async (dir, name) => {
  const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
  let queue = Promise.resolve();
  let failed = null;
  return {
    push: (data) => { queue = queue.then(() => (failed ? null : w.write(data))).catch((e) => { failed = failed || e; }); },
    finish: async () => { await queue; if (failed) { await w.abort?.().catch(() => {}); throw failed; } await w.close(); },
    abort: async () => { await queue; await w.abort?.().catch(() => {}); },
  };
};

// A recorded WebM has no length in it; write it in.
export const finalBlob = async (chunks, mimeType, seconds) => {
  const blob = new Blob(chunks, { type: mimeType });
  return mimeType === "video/webm" ? fixWebmDuration(blob, seconds * 1000, { logger: false }) : blob;
};

// Captions -----------------------------------------------------------------

const clean = (s) => String(s || "").replace(/<[^>]+>/g, "").replace(/[*_`#]/g, "").replace(/\s+/g, " ").trim();
const MAX_CUE = 84; // two lines of about 42 characters
const MAX_LINE = 42;

// A long sentence cut into cues of up to two short lines, its time shared
// out by length.
const splitCue = ({ start, end, text }) => {
  if (text.length <= MAX_CUE) return [{ start, end, text }];
  const parts = [];
  let cur = "";
  for (const w of text.split(" ")) {
    if (cur && (cur + " " + w).length > MAX_CUE) { parts.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) parts.push(cur);
  const total = parts.reduce((n, p) => n + p.length, 0) || 1;
  let t = start;
  return parts.map((p) => {
    const d = ((end - start) * p.length) / total;
    const cue = { start: t, end: t + d, text: p };
    t += d;
    return cue;
  });
};
const lines = (text) => {
  if (text.length <= MAX_LINE) return text;
  const words = text.split(" ");
  let best = text;
  let bestGap = Infinity;
  for (let i = 1; i < words.length; i += 1) {
    const a = words.slice(0, i).join(" ");
    const b = words.slice(i).join(" ");
    const gap = Math.abs(a.length - b.length);
    if (gap < bestGap) { bestGap = gap; best = `${a}\n${b}`; }
  }
  return best;
};

// What is said and when, from the same timeline the player uses (pauses and
// clips get no caption). `offset`: seconds between the recording starting
// and the lesson starting.
export const captionCues = (lesson, offset = 0) => {
  const segments = lesson?.segments || [];
  const cues = [];
  lessonTimeline(segments).forEach((x, i) => {
    for (const c of x.clips) {
      if (c.kind !== "audio" && c.kind !== "silent") continue;
      const text = clean(c.text || segments[i]?.say);
      if (!text || c.dur <= 0) continue;
      const start = offset + x.start + c.start;
      cues.push({ start, end: start + c.dur, text });
    }
  });
  return cues.flatMap(splitCue).map((c) => ({ ...c, text: lines(c.text) }));
};

const stamp = (sec, sep) => {
  const ms = Math.max(0, Math.round(sec * 1000));
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}${sep}${p(ms % 1000, 3)}`;
};
export const toSrt = (cues) => cues.map((c, i) => `${i + 1}\n${stamp(c.start, ",")} --> ${stamp(c.end, ",")}\n${c.text}\n`).join("\n");
export const toVtt = (cues) => `WEBVTT\n\n${cues.map((c) => `${stamp(c.start, ".")} --> ${stamp(c.end, ".")}\n${c.text}\n`).join("\n")}`;

// Files ----------------------------------------------------------------------

export const safeName = (s, fallback = "Lesson") => (String(s || "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 120) || fallback);
export const extOf = (mimeType) => (mimeType === "video/mp4" ? "mp4" : "webm");

// A file the server made, straight to the downloads folder (not via memory).
export const downloadUrl = (url, name, ext = "mp4") => {
  const a = document.createElement("a");
  a.href = `${url}&name=${encodeURIComponent(name)}`;
  a.download = `${name}.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
};

export const download = (blob, name) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
};

// Into a folder the user picked (Chrome), else a download.
export const saveFile = async (dir, name, blob) => {
  if (!dir) return download(blob, name);
  const handle = await dir.getFileHandle(name, { create: true });
  const w = await handle.createWritable();
  await w.write(blob);
  await w.close();
};

export const captionFiles = (cues, base) => [
  [`${base}.srt`, new Blob([toSrt(cues)], { type: "application/x-subrip" })],
  [`${base}.vtt`, new Blob([toVtt(cues)], { type: "text/vtt" })],
];

// The player's media from this site's own address, so the recording isn't
// silent when storage sends no CORS headers (as VideoExport.jsx does).
export const sameOriginLesson = (lesson) => ({
  ...lesson,
  segments: lesson.segments.map((s) => ({
    ...s,
    audioUrl: s.audioUrl ? `/api/video-lessons/${lesson._id}/audio/${s._id}` : null,
    parts: s.parts ? s.parts.map((p, i) => ({ ...p, audioUrl: p.audioUrl ? `/api/video-lessons/${lesson._id}/audio/${s._id}?clip=${i}` : null })) : s.parts,
    board: (s.board || []).map((b, k) => (b.type === "clip" && b.url ? { ...b, url: `/api/video-lessons/${lesson._id}/clip/${s._id}/${k}` } : b)),
  })),
});
