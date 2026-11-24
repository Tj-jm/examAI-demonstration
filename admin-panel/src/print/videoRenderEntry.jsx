import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import BoardPlayer from "../components/BoardPlayer";
import { lessonTimeline } from "../components/boardTimeline";
import { evenAudio, captionCues, toSrt, toVtt } from "../components/videoHd";

// The page the server records a lesson video from (backend
// utils/lessonRender.js, in headless Chromium). The server calls
// window.__load(lesson, captions), starts its screencast, then
// window.__start(); waits for window.__ended; then window.__stop(). The
// sound is recorded here and sent to the server in parts (__soundChunk).
const root = createRoot(document.getElementById("board"));
const s = { lesson: null, captions: false, signal: 0, media: {}, tapped: new WeakSet() };

const tap = (el) => {
  if (!s.mix || s.tapped.has(el)) return;
  try { s.ctx.createMediaElementSource(el).connect(s.mix); s.tapped.add(el); } catch { /* already wired */ }
};

const draw = () => root.render(
  <BoardPlayer lesson={s.lesson} recording showCaptions={s.captions} startSignal={s.signal}
    onEnded={() => { window.__ended = true; }}
    onMedia={(m) => { s.media = { ...s.media, ...m }; }}
    onClipMedia={tap} />,
);

window.addEventListener("error", (e) => window.__renderError?.(e.message || "The page failed."));

window.__load = async (lesson, captions) => {
  s.lesson = lesson;
  s.captions = Boolean(captions);
  flushSync(draw);
  await document.fonts.ready;
  s.ctx = new AudioContext();
  s.dest = s.ctx.createMediaStreamDestination();
  s.mix = s.ctx.createGain();
  const even = evenAudio(s.ctx);
  s.mix.connect(even.input);
  even.output.connect(s.dest);
  s.ctx.createMediaElementSource(s.media.audio).connect(s.mix);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return lessonTimeline(lesson.segments || []).reduce((n, x) => n + x.duration, 0);
};

let sent = Promise.resolve();
const toBase64 = (blob) => new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] || ""); r.readAsDataURL(blob); });

window.__start = async () => {
  await s.ctx.resume();
  const type = ["audio/webm;codecs=opus", "audio/webm"].find((t) => MediaRecorder.isTypeSupported(t)) || "";
  s.rec = new MediaRecorder(s.dest.stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 160000 });
  s.rec.ondataavailable = (e) => { if (e.data.size) { const d = e.data; sent = sent.then(async () => window.__soundChunk(await toBase64(d))); } };
  s.rec.start(1000);
  const at = Date.now();
  setInterval(() => { window.__at = (Date.now() - at) / 1000; }, 500);
  s.signal = 1;
  flushSync(draw);
  return at;
};

window.__stop = () => new Promise((ok) => {
  s.rec.onstop = () => { sent.then(() => ok(true)); };
  s.rec.stop();
});

// The captions as files (.srt, .vtt), timed from the lesson's start.
window.__captions = () => { const cues = captionCues(s.lesson, 0); return { srt: toSrt(cues), vtt: toVtt(cues) }; };
