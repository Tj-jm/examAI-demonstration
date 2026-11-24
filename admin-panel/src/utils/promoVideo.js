import { PALETTES, posterPieces, drawBackground, loadPosterImages, posterFrame } from "./drawPoster";
import { loadPosterFonts } from "./posterStyles";
import fixWebmDuration from "fix-webm-duration";

// A short promo video made from a poster (admin Posters page): the same
// layout, its pieces coming in one after another over a slow zoom on the
// picture, the button pulsing at the end. Drawn on a canvas and recorded
// in this browser (no server work), with an optional voice and music.

const IN = 0.55; // seconds a piece takes to come in
const ease = (x) => 1 - (1 - x) ** 3;
const clamp01 = (x) => Math.min(1, Math.max(0, x));

// When each piece comes in, and how long the video runs. With a voice, the
// video is at least as long as it, stretched evenly.
export const promoTimeline = (pieces, { voiceSeconds = 0 } = {}) => {
  const count = (g) => pieces.filter((x) => x.group === g).length;
  const intro = 1.6;
  const head = 0.35 * count("headline") + (count("subline") ? 0.9 : 0) + 0.8;
  const body = (count("item") + count("stage")) * 0.9 + (count("item") ? 0.6 : 0) + (count("ticket") ? 1.2 : 0);
  const outro = 3.2;
  const natural = Math.max(8, intro + head + body + outro);
  const total = Math.max(natural, voiceSeconds ? voiceSeconds + 1.5 : 0);
  const k = total / natural;
  let headIx = 0;
  let itemIx = 0;
  let subIx = 0;
  let stageIx = 0;
  let ticketIx = 0;
  const starts = pieces.map((x) => {
    switch (x.group) {
      case "decor": return 0;
      case "card": return 0.5 * k;
      case "header": return 0.2 * k;
      case "tag": return 0.8 * k;
      case "photo": return 1.1 * k;
      case "band": return (intro - 0.5) * k;
      case "stage": return (intro + head + 0.25 * stageIx++) * k;
      case "ticket": return (intro + head + 0.7 * ticketIx++) * k;
      case "headline": return (intro + 0.35 * headIx++) * k;
      case "subline": return (intro + 0.35 * count("headline") + 0.3 + 0.5 * subIx++) * k;
      case "item": return (intro + head + 0.9 * itemIx++) * k;
      default: return (total - outro + 0.3) * 1; // cta, contact
    }
  });
  return { total, starts, outroAt: total - outro };
};

// One frame at time t (seconds).
export const drawPromoFrame = (ctx, { w, h, p, bg, pictureStyle, pieces, timeline }, t) => {
  const { total, starts, outroAt } = timeline;
  drawBackground(ctx, { w, h, p, bg, pictureStyle, zoom: 1 + 0.12 * clamp01(t / total), drift: Math.sin((t / total) * Math.PI), T: pieces.T, area: pieces.area });
  pieces.forEach((piece, i) => {
    const x = clamp01((t - starts[i]) / IN);
    if (x <= 0) return;
    const e = ease(x);
    const { box } = piece;
    ctx.save();
    ctx.globalAlpha = e;
    if (piece.motion === "rise") {
      // A podium block grows up from the floor.
      ctx.globalAlpha = 1;
      const by = box.y + box.h;
      ctx.translate(0, by);
      ctx.scale(1, Math.max(0.01, e));
      ctx.translate(0, -by);
    } else if (piece.motion === "slide") {
      ctx.globalAlpha = 1;
      ctx.translate((1 - e) * -(w + 200), 0);
    } else if (piece.motion === "stamp") {
      // Stamped on: big, then down to size.
      const k = 1 + 0.6 * (1 - e);
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      ctx.translate(cx, cy);
      ctx.scale(k, k);
      ctx.translate(-cx, -cy);
    } else if (piece.motion === "type") {
      // Written out left to right, as by hand (over about a second).
      const wx = clamp01((t - starts[i]) / 1.1);
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.rect(box.x - 20, box.y - 40, (box.w + 40) * wx, box.h + 80);
      ctx.clip();
    } else if (piece.group === "decor" || piece.group === "card") {
      // Just fades in.
    } else if (piece.group === "cta") {
      // Pops in, then pulses gently.
      const pulse = t > starts[i] + IN ? 1 + 0.04 * Math.sin((t - starts[i]) * 5) : 0.6 + 0.4 * e;
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      ctx.translate(cx, cy);
      ctx.scale(pulse, pulse);
      ctx.translate(-cx, -cy);
    } else if (piece.group === "tag") {
      ctx.translate((1 - e) * -60, 0);
    } else if (piece.group === "header") {
      ctx.translate(0, (1 - e) * -30);
    } else {
      ctx.translate(0, (1 - e) * 40);
    }
    piece.draw(ctx);
    ctx.restore();
  });
  // A soft fade to the palette in the last half second.
  const end = clamp01((t - (total - 0.5)) / 0.5);
  if (end > 0 && t > outroAt) {
    ctx.globalAlpha = end * 0.35;
    ctx.fillStyle = p.bg;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
  }
};

// Everything a frame needs: the pictures loaded, the pieces laid out, the
// timeline worked out.
export const preparePromo = async (canvas, poster, { size = "square", palette = "navy", pictureStyle = "soft", style = {}, voiceSeconds = 0 } = {}) => {
  const { w, h } = posterFrame(canvas, size);
  const p = PALETTES[palette] || PALETTES.navy;
  const ctx = canvas.getContext("2d");
  await loadPosterFonts();
  if (document.fonts?.ready) await document.fonts.ready.catch(() => {});
  const { bg, logo, logoOk, coverImg } = await loadPosterImages(poster);
  const pieces = posterPieces(ctx, { ...poster, logo, coverImg, bgImg: bg, hasPicture: Boolean(bg) }, { w, h, p, style });
  const timeline = promoTimeline(pieces, { voiceSeconds });
  return { ctx, scene: { w, h, p, bg, pictureStyle, pieces, timeline }, logoOk };
};

const pickType = () => {
  // MP4 first: Facebook and Instagram take it as it is.
  const types = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  return types.find((x) => window.MediaRecorder?.isTypeSupported?.(x)) || "";
};
export const canRecord = () => Boolean(window.MediaRecorder && HTMLCanvasElement.prototype.captureStream && window.AudioContext);

const decode = async (ctx, source) => {
  if (!source) return null;
  if (source instanceof AudioBuffer) return source;
  const buf = typeof source === "string" ? await (await fetch(source)).arrayBuffer() : await source.arrayBuffer();
  return ctx.decodeAudioData(buf);
};

// Plays the video once on `canvas` while recording it. voice: a data url;
// music: a File, or (seconds) => AudioBuffer for a built-in track
// (musicLibrary.js), under the voice. onProgress(0..1). Resolves to
// { blob, type, seconds }.
export const recordPromo = async (canvas, poster, opts, { voice, music, onProgress, signal } = {}) => {
  const audio = new AudioContext();
  const voiceBuf = await decode(audio, voice);
  const { ctx, scene } = await preparePromo(canvas, poster, { ...opts, voiceSeconds: voiceBuf?.duration || 0 });
  const total = scene.timeline.total;
  // A built-in track is made to the video's length.
  const musicBuf = await decode(audio, typeof music === "function" ? await music(total + 1) : music);
  const dest = audio.createMediaStreamDestination();
  const sources = [];
  if (voiceBuf) {
    const s = audio.createBufferSource();
    s.buffer = voiceBuf;
    const g = audio.createGain();
    g.gain.value = 1;
    s.connect(g).connect(dest);
    sources.push({ s, at: 0.6 });
  }
  if (musicBuf) {
    const s = audio.createBufferSource();
    s.buffer = musicBuf;
    s.loop = true;
    const g = audio.createGain();
    const level = voiceBuf ? 0.22 : 0.7;
    g.gain.setValueAtTime(level, audio.currentTime);
    s.connect(g).connect(dest);
    sources.push({ s, at: 0, fade: { g, level } });
  }
  drawPromoFrame(ctx, scene, 0);
  const stream = canvas.captureStream(30);
  for (const track of dest.stream.getAudioTracks()) stream.addTrack(track);
  const mimeType = pickType();
  const rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 6000000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((resolve) => { rec.onstop = resolve; });

  await audio.resume();
  rec.start(500);
  const t0 = performance.now();
  const a0 = audio.currentTime;
  for (const { s, at, fade } of sources) {
    s.start(a0 + at);
    if (fade) {
      fade.g.gain.setValueAtTime(fade.level, a0 + Math.max(0, total - 1.2));
      fade.g.gain.linearRampToValueAtTime(0, a0 + total);
    }
  }
  await new Promise((resolve) => {
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      if (signal?.aborted || t >= total + 0.2) return resolve();
      drawPromoFrame(ctx, scene, Math.min(t, total));
      onProgress?.(Math.min(1, t / total));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  rec.stop();
  await stopped;
  for (const { s } of sources) { try { s.stop(); } catch { /* ended */ } }
  audio.close().catch(() => {});
  if (signal?.aborted) return null;
  const type = (mimeType || rec.mimeType || "video/webm").split(";")[0];
  let blob = new Blob(chunks, { type });
  // A recorded WebM has no length in it; write it in so players can seek.
  if (type === "video/webm") blob = await fixWebmDuration(blob, total * 1000, { logger: false });
  return { blob, type, seconds: total };
};
