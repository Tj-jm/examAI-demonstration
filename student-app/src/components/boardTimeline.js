// When things happen in a video lesson (BoardPlayer.jsx): each segment's
// voice clips, the pauses between them, and the moment each board item
// appears. Pure functions, no React. The same file lives in both apps
// (student-app and admin-panel components/boardTimeline.js); keep them
// identical. The backend splits sentences the same way (utils/videoLesson.js
// sentencesOf), so a voice made a clip per sentence lines up with this.
// A clip item (a short video on the board) holds the voice like a pause
// while it plays (and its frozen last frame, `freeze`); its time is when it
// starts. A clip with voice "over" plays under the voice from its cue
// instead, holding nothing. A sequence's pictures and a step-by-step
// diagram's steps each get a time too (frames), from their cues. A clip
// that holds the voice can carry its own lines, spoken at set seconds into
// it (lines on its timeline clip).

const WORDS_PER_SECOND = 2.4;
const wordCount = (t) => String(t || "").split(/\s+/).filter(Boolean).length;
export const estimate = (say) => Math.max(2.5, wordCount(say) / WORDS_PER_SECOND + 0.6);

// Sentences, with one- or two-word ones joined to the one before.
export const sentencesOf = (say) => {
  const raw = String(say || "").trim().split(/(?<=[.!?।])\s+(?=\S)/).map((x) => x.trim()).filter(Boolean);
  const out = [];
  for (const x of raw) {
    if (out.length && (x.split(/\s+/).length < 3 || out[out.length - 1].split(/\s+/).length < 3)) out[out.length - 1] += ` ${x}`;
    else out.push(x);
  }
  return out;
};

// Words only (lower case, no punctuation), and where each kept character
// came from, so a cue found in the words maps back to the narration.
const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u;
const normalise = (text) => {
  let out = "";
  const map = [];
  let space = true;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (WORD_CHAR.test(ch)) { out += ch.toLowerCase(); map.push(i); space = false; }
    else if (!space) { out += " "; map.push(i); space = true; }
  }
  return { out, map };
};
export const plainWords = (t) => String(t || "").toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, " ").trim();

// Where a cue starts in the narration (a character index), or -1.
export const cueIndex = (say, cue) => {
  const c = plainWords(cue);
  if (!c) return -1;
  const { out, map } = normalise(String(say || ""));
  const at = ` ${out} `.indexOf(` ${c} `);
  return at < 0 ? -1 : map[at] ?? -1;
};

// The voice of one segment as clips: a clip per sentence when it was voiced
// that way, else the whole-segment audio, else (no voice) one silent clip
// per sentence timed from its words. Each has its place in the narration.
const narrationOf = (seg) => {
  const say = String(seg.say || "");
  let clips;
  if (seg.parts?.length) clips = seg.parts.map((p) => ({ text: p.text, url: p.audioUrl || null, dur: p.durationSeconds || estimate(p.text), ...(p.audioUrl && p.marks?.length ? { marks: p.marks } : {}) }));
  else if (seg.audioUrl) clips = [{ text: say, url: seg.audioUrl, dur: seg.durationSeconds || estimate(say) }];
  else {
    const sentences = sentencesOf(say);
    const total = estimate(say);
    const words = Math.max(1, wordCount(say));
    clips = (sentences.length ? sentences : [say]).map((text) => ({ text, url: null, dur: (total * Math.max(1, wordCount(text))) / words }));
  }
  let cursor = 0;
  let t = 0;
  return clips.map((c) => {
    const found = say.indexOf(c.text, cursor);
    const from = found >= 0 ? found : cursor;
    const to = found >= 0 ? found + c.text.length : Math.min(say.length, cursor + c.text.length);
    cursor = to;
    const clip = { ...c, charFrom: from, charTo: Math.max(to, from + 1), start: t };
    t += c.dur;
    return clip;
  });
};

// Narration time at a character of the narration: from the voice's own
// word timings when it gave them (marks: when each word starts, words being
// the sentence split on spaces), else by its place in the sentence.
const timeAtChar = (clips, ch) => {
  if (!clips.length) return 0;
  const c = clips.find((x) => ch < x.charTo) || clips[clips.length - 1];
  if (c.marks) {
    const before = (c.text.slice(0, Math.max(0, ch - c.charFrom)).match(/\S+\s+/g) || []).length;
    const t = c.marks[Math.min(before, c.marks.length - 1)];
    if (Number.isFinite(t)) return c.start + Math.min(c.dur, Math.max(0, t));
  }
  const f = Math.min(1, Math.max(0, (ch - c.charFrom) / (c.charTo - c.charFrom)));
  return c.start + c.dur * f;
};

// One segment: { duration, clips (to play, pauses included), times (per
// board item, from the segment's start) }.
export const segmentTimeline = (seg) => {
  const say = String(seg.say || "");
  const narr = narrationOf(seg);
  const narrEnd = narr.reduce((s, c) => s + c.dur, 0);
  const board = seg.board || [];
  const sentences = sentencesOf(say);

  // Pauses and clips: before the narration ("^"), after a sentence, or at
  // the end.
  const holds = (b) => b.type === "pause" || (b.type === "clip" && b.voice !== "over");
  const pauses = [];
  for (let k = 0; k < board.length; k += 1) {
    const b = board[k];
    if (!holds(b)) continue;
    let at = narrEnd;
    if (b.after === "^") at = 0;
    else if (b.after) {
      const ch = cueIndex(say, b.after);
      if (ch >= 0) {
        // The end of the sentence holding those words.
        let pos = 0;
        let end = say.length;
        for (const s of sentences) {
          const i = say.indexOf(s, pos);
          const e = (i >= 0 ? i : pos) + s.length;
          if (ch < e) { end = e; break; }
          pos = e;
        }
        const clipEnd = narr.find((c) => Math.abs(c.charTo - end) <= 2);
        at = clipEnd ? clipEnd.start + clipEnd.dur : timeAtChar(narr, end);
      }
    }
    const freeze = b.type === "clip" ? Math.max(0, Number(b.freeze) || 0) : 0;
    pauses.push({ at, seconds: Math.max(0.5, Number(b.seconds) || 2) + freeze, ...(b.type === "clip" ? { item: k, from: Math.max(0, Number(b.start) || 0), play: Math.max(0.5, Number(b.seconds) || 2), lines: b.lines || null } : {}) });
  }
  pauses.sort((a, b) => a.at - b.at);
  // Narration time to segment time: pauses at or before it come first.
  const shift = (t) => pauses.reduce((s, p) => (p.at <= t + 1e-6 ? s + p.seconds : s), 0);

  // Each item's narration time: at its cue; with the one before; else
  // spread between the items around it that have a time (the first items
  // from the start, as before cues existed).
  const n = board.length;
  const at = board.map((b) => {
    if (holds(b) || !b.cue) return null;
    const ch = cueIndex(say, b.cue);
    return ch >= 0 ? timeAtChar(narr, ch) : null;
  });
  for (let k = 0; k < n; k += 1) if (at[k] === null && board[k].with && k > 0 && at[k - 1] !== null) at[k] = at[k - 1];
  const known = at.map((x, k) => (x === null ? null : k)).filter((k) => k !== null);
  if (!known.length) {
    const spread = board.filter((b) => !b.with && !holds(b)).length || 1;
    let j = -1;
    for (let k = 0; k < n; k += 1) {
      if (!(board[k].with && k > 0) && !holds(board[k])) j += 1;
      at[k] = (narrEnd * Math.max(0, j)) / spread;
    }
  } else {
    for (let k = 0; k < n; k += 1) {
      if (at[k] !== null) continue;
      if (board[k].with && k > 0) { at[k] = at[k - 1]; continue; }
      const prev = [...known].reverse().find((x) => x < k);
      const next = known.find((x) => x > k);
      const a = prev === undefined ? 0 : at[prev];
      const z = next === undefined ? narrEnd : at[next];
      const lo = prev === undefined ? -1 : prev;
      const hi = next === undefined ? n : next;
      const slot = k - lo;
      at[k] = prev === undefined && slot === 1 ? 0 : a + ((z - a) * slot) / (hi - lo);
    }
  }
  // A pause item is placed where it holds the board; it shows nothing. A
  // clip's time is set below, when its place among the clips is known.
  const times = at.map((t) => t + shift(t));

  // The clips to play: narration cut at the pauses, with the pauses in.
  const clips = [];
  let t = 0;
  let pi = 0;
  const addPausesUpTo = (narrT) => {
    while (pi < pauses.length && pauses[pi].at <= narrT + 1e-6) {
      const p = pauses[pi];
      if (p.item !== undefined) {
        times[p.item] = t;
        clips.push({ kind: "video", item: p.item, url: null, from: p.from, to: p.from + p.play, start: t, dur: p.seconds, ...(p.lines?.length ? { lines: p.lines } : {}) });
      } else clips.push({ kind: "pause", url: null, from: 0, to: 0, start: t, dur: p.seconds });
      t += pauses[pi].seconds;
      pi += 1;
    }
  };
  for (const c of narr) {
    let from = 0;
    addPausesUpTo(c.start);
    while (pi < pauses.length && pauses[pi].at < c.start + c.dur - 1e-6) {
      const cut = pauses[pi].at - c.start;
      if (cut > from) { clips.push({ kind: c.url ? "audio" : "silent", url: c.url, text: c.text, from, to: cut, start: t, dur: cut - from }); t += cut - from; }
      from = cut;
      addPausesUpTo(pauses[pi].at);
    }
    if (c.dur - from > 1e-6) { clips.push({ kind: c.url ? "audio" : "silent", url: c.url, text: c.text, from, to: c.dur, start: t, dur: c.dur - from }); t += c.dur - from; }
  }
  addPausesUpTo(Infinity);
  // A sequence's pictures, a diagram's steps: each at its cue (never before
  // the item itself), else `seconds` after the one before. Steps past the
  // cues given are timed by the player, which knows how many there are.
  const segTime = (narrT) => narrT + shift(narrT);
  const frames = board.map((b, k) => {
    const cues = b.type === "sequence" ? (b.frames || []).map((f) => f?.cue || "") : b.type === "diagram" && b.build ? (b.stepCues || []) : null;
    if (!cues) return null;
    const per = Math.max(0.3, Number(b.seconds) || (b.type === "sequence" ? 1 : 1.5));
    const out = [];
    for (let i = 0; i < cues.length; i += 1) {
      const ch = cues[i] ? cueIndex(say, cues[i]) : -1;
      const prev = i ? out[i - 1] : times[k];
      const cued = ch >= 0 ? segTime(timeAtChar(narr, ch)) : null;
      out.push(i === 0 ? Math.max(times[k], cued ?? times[k]) : Math.max(prev, cued ?? prev + per));
    }
    return out;
  });
  return { duration: t, clips, times, frames };
};

// The whole lesson: segments placed one after another.
export const lessonTimeline = (segments) => {
  let t = 0;
  return (segments || []).map((seg) => {
    const tl = segmentTimeline(seg);
    const out = { ...tl, start: t };
    t += tl.duration;
    return out;
  });
};
