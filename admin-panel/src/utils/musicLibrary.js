// Built-in music for promo videos (PromoVideo.jsx): short tracks made in
// the browser from a chord progression, a bass line, an arpeggio or piano
// and light drums. Nothing is downloaded and there is no copyright to
// clear: the music is generated here, so it is free to use anywhere.

const midi = (n) => 440 * 2 ** ((n - 69) / 12);

// Chords as MIDI notes (root position, around middle C).
const C = {
  C: [48, 52, 55], Dm: [50, 53, 57], Em: [52, 55, 59], F: [53, 57, 60], G: [55, 59, 62], Am: [57, 60, 64],
  D: [50, 54, 57], Bm: [47, 50, 54], A: [57, 61, 64], E: [52, 56, 59],
  Cmaj7: [48, 52, 55, 59], Dm7: [50, 53, 57, 60], G7: [55, 59, 62, 65], Am7: [57, 60, 64, 67], Fmaj7: [53, 57, 60, 64],
  Bb: [46, 50, 53], Eb: [51, 55, 58], Gm: [55, 58, 62], Cm: [48, 51, 55], Ab: [56, 60, 63],
};

export const MUSIC = [
  { id: "upbeat", name: "Upbeat pop", bpm: 118, chords: ["C", "G", "Am", "F"], lead: "pluck8", drums: "four", bass: "eighth", pad: 0.6 },
  { id: "corporate", name: "Bright corporate", bpm: 104, chords: ["F", "C", "G", "Am"], lead: "piano8", drums: "pop", bass: "quarter", pad: 0.5 },
  { id: "inspiring", name: "Inspiring", bpm: 88, chords: ["Am", "F", "C", "G"], lead: "piano4", drums: "build", bass: "half", pad: 0.9 },
  { id: "calm", name: "Calm piano", bpm: 72, chords: ["C", "Am", "F", "G"], lead: "pianoArp", drums: "none", bass: "whole", pad: 0.7 },
  { id: "celebration", name: "Celebration", bpm: 126, chords: ["F", "Bb", "C", "Bb"], lead: "pluck16", drums: "claps", bass: "eighth", pad: 0.5 },
  { id: "lofi", name: "Lo-fi study", bpm: 78, chords: ["Dm7", "G7", "Cmaj7", "Am7"], lead: "keys", drums: "lofi", bass: "half", pad: 0.6, mellow: true },
  { id: "energetic", name: "Energetic", bpm: 138, chords: ["Em", "C", "G", "D"], lead: "saw16", drums: "four", bass: "eighth", pad: 0.4 },
  { id: "gentle", name: "Gentle acoustic", bpm: 96, chords: ["G", "Em", "C", "D"], lead: "pluckArp", drums: "shaker", bass: "quarter", pad: 0.4 },
];

// ---- instruments --------------------------------------------------------

const env = (g, t, { a = 0.005, peak = 1, d = 0.3, s = 0, r = 0.1, len = 0.3 }) => {
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * s || 0.0001), t + a + d);
  if (s) g.gain.setValueAtTime(peak * s, t + Math.max(a + d, len));
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(a + d, len) + r);
};

const tone = (ctx, out, { f, t, type = "triangle", len = 0.3, vol = 0.2, a, d, s, r, cutoff, detune = 0 }) => {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = f;
  o.detune.value = detune;
  const g = ctx.createGain();
  let node = o;
  if (cutoff) {
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = cutoff;
    o.connect(lp);
    node = lp;
  }
  node.connect(g).connect(out);
  env(g, t, { a, peak: vol, d: d ?? len, s, r, len });
  o.start(t);
  o.stop(t + len + (r ?? 0.1) + 0.5);
};

let noiseBuf = null;
const noise = (ctx) => {
  if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i += 1) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
};
const hit = (ctx, out, { t, type, freq, q = 1, vol = 0.2, len = 0.1 }) => {
  const s = ctx.createBufferSource();
  s.buffer = noise(ctx);
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  s.connect(f).connect(g).connect(out);
  env(g, t, { a: 0.001, peak: vol, d: len, r: 0.02, len });
  s.start(t);
  s.stop(t + len + 0.1);
};
const kick = (ctx, out, t, vol = 0.9) => {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.setValueAtTime(120, t);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.18);
  o.connect(g).connect(out);
  env(g, t, { a: 0.002, peak: vol, d: 0.28, r: 0.05, len: 0.28 });
  o.start(t);
  o.stop(t + 0.5);
};
const snare = (ctx, out, t, vol = 0.35) => hit(ctx, out, { t, type: "bandpass", freq: 1800, q: 0.8, vol, len: 0.16 });
const clap = (ctx, out, t, vol = 0.3) => { for (const dt of [0, 0.012, 0.024]) hit(ctx, out, { t: t + dt, type: "bandpass", freq: 1200, q: 1.2, vol, len: 0.09 }); };
const hat = (ctx, out, t, vol = 0.08) => hit(ctx, out, { t, type: "highpass", freq: 7500, vol, len: 0.04 });

// ---- one track ------------------------------------------------------------

const play = (ctx, out, style, seconds) => {
  const beat = 60 / style.bpm;
  const bar = beat * 4;
  const bars = Math.ceil(seconds / bar) + 1;
  const mellow = style.mellow ? 1800 : 5000;
  for (let b = 0; b < bars; b += 1) {
    const t0 = b * bar;
    const chord = C[style.chords[b % style.chords.length]];
    const root = chord[0];
    // Pad: the chord held through the bar.
    if (style.pad) {
      for (const n of chord) {
        tone(ctx, out, { f: midi(n), t: t0, type: "sawtooth", len: bar, vol: 0.035 * style.pad, a: 0.4, d: 0.5, s: 0.7, r: 0.6, cutoff: 1100, detune: -6 });
        tone(ctx, out, { f: midi(n), t: t0, type: "sawtooth", len: bar, vol: 0.035 * style.pad, a: 0.4, d: 0.5, s: 0.7, r: 0.6, cutoff: 1100, detune: 6 });
      }
    }
    // Bass.
    const bassStep = { eighth: beat / 2, quarter: beat, half: beat * 2, whole: bar }[style.bass] || beat;
    for (let t = 0; t < bar - 1e-6; t += bassStep) tone(ctx, out, { f: midi(root - 12), t: t0 + t, type: "triangle", len: Math.min(bassStep * 0.9, 0.6), vol: 0.32, d: Math.min(bassStep, 0.5), r: 0.05 });
    // Lead.
    const up = [...chord, chord[0] + 12, chord[1] + 12];
    const arp = (step, type, vol, opts = {}) => {
      let i = 0;
      for (let t = 0; t < bar - 1e-6; t += step, i += 1) tone(ctx, out, { f: midi(up[i % up.length] + 12), t: t0 + t, type, len: step * 0.9, vol, d: step * 0.8, r: 0.08, cutoff: mellow, ...opts });
    };
    switch (style.lead) {
      case "pluck8": arp(beat / 2, "square", 0.05, { cutoff: 2600 }); break;
      case "pluck16": arp(beat / 4, "square", 0.04, { cutoff: 3200 }); break;
      case "saw16": arp(beat / 4, "sawtooth", 0.035, { cutoff: 3600 }); break;
      case "pluckArp": arp(beat / 2, "triangle", 0.12); break;
      case "pianoArp": arp(beat / 2, "triangle", 0.14, { d: 1.2, r: 0.6 }); break;
      case "piano8":
        for (let t = 0; t < bar - 1e-6; t += beat / 2) for (const n of chord) tone(ctx, out, { f: midi(n + 12), t: t0 + t, type: "triangle", len: beat / 2, vol: 0.05, d: 0.35, r: 0.1 });
        break;
      case "piano4":
        for (let t = 0; t < bar - 1e-6; t += beat) for (const n of chord) tone(ctx, out, { f: midi(n + 12), t: t0 + t, type: "triangle", len: beat, vol: 0.06, d: 0.9, r: 0.3 });
        break;
      case "keys":
        for (const t of [0, beat * 1.5, beat * 2.5]) for (const n of chord) tone(ctx, out, { f: midi(n + 12), t: t0 + t, type: "sine", len: beat, vol: 0.07, d: 0.8, r: 0.3 });
        break;
      default: break;
    }
    // Drums.
    for (let q = 0; q < 4; q += 1) {
      const t = t0 + q * beat;
      switch (style.drums) {
        case "four":
          kick(ctx, out, t);
          if (q % 2) snare(ctx, out, t);
          hat(ctx, out, t + beat / 2);
          break;
        case "pop":
          if (q === 0 || q === 2) kick(ctx, out, t, 0.8);
          if (q % 2) clap(ctx, out, t, 0.22);
          hat(ctx, out, t);
          hat(ctx, out, t + beat / 2, 0.05);
          break;
        case "build":
          if (b >= 2 && q === 0) kick(ctx, out, t, 0.7);
          if (b >= 4 && q === 2) kick(ctx, out, t, 0.6);
          if (b >= 4) hat(ctx, out, t + beat / 2, 0.05);
          break;
        case "claps":
          kick(ctx, out, t, 0.8);
          if (q % 2) clap(ctx, out, t);
          for (let s = 0; s < 4; s += 1) hat(ctx, out, t + (s * beat) / 4, s % 2 ? 0.04 : 0.07);
          break;
        case "lofi": {
          const swing = beat * 0.58;
          if (q === 0 || q === 2) kick(ctx, out, t + (q === 2 ? beat * 0.25 : 0), 0.6);
          if (q % 2) snare(ctx, out, t, 0.18);
          hat(ctx, out, t, 0.04);
          hat(ctx, out, t + swing, 0.03);
          break;
        }
        case "shaker":
          for (let s = 0; s < 2; s += 1) hit(ctx, out, { t: t + (s * beat) / 2, type: "highpass", freq: 5000, vol: s ? 0.03 : 0.05, len: 0.07 });
          break;
        default: break;
      }
    }
  }
};

// The track, `seconds` long, faded in (the video fades it out at its end).
// Resolves to an AudioBuffer.
const cache = new Map();
export const renderMusic = async (id, seconds) => {
  const style = MUSIC.find((m) => m.id === id) || MUSIC[0];
  const len = Math.min(120, Math.max(4, Math.ceil(seconds)));
  const key = `${style.id}:${len}`;
  if (cache.has(key)) return cache.get(key);
  const rate = 44100;
  const ctx = new OfflineAudioContext(2, rate * len, rate);
  const master = ctx.createGain();
  master.gain.setValueAtTime(0, 0);
  master.gain.linearRampToValueAtTime(0.9, 0.6);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.ratio.value = 4;
  master.connect(comp).connect(ctx.destination);
  play(ctx, master, style, len);
  const buf = await ctx.startRendering();
  cache.set(key, buf);
  return buf;
};
