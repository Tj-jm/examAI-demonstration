import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import "@fontsource/caveat/500.css";
import "@fontsource/caveat/700.css";
import "@fontsource/patrick-hand/400.css";
import "@fontsource/atma/500.css";
import Watermark from "./Watermark";
import { lessonTimeline } from "./boardTimeline";
import { GraphItem, NumberLineItem } from "./BoardGraph";

// Plays a video lesson (backend models/videoLessonModel.js): each segment's
// voice, a clip per sentence, with each board item appearing as the voice
// says its cue, pauses holding the board, and items marked "with" appearing
// together (the timing is boardTimeline.js). A segment with no audio is
// timed from its words and shown with captions. The same file lives in both
// apps (student-app and admin-panel components/BoardPlayer.jsx); keep them
// identical.
//
// lesson: { title, imageUrl, style, segments: [{ say, board, parts: [{ text, audioUrl, durationSeconds }], audioUrl, durationSeconds }] }
// style (Settings → video board): { board, ink, accent, logo, name, corner }
// recording: no controls, starts when told (the admin's video export);
// onMedia({ stage, audio }) hands the board and audio elements to it, and
// onClipMedia(video) each clip's video element (for its sound).
// onPosition({ segment, item }) says what is playing (the editor marks it);
// jump: { segment, nonce } moves to the start of a segment; play: true
// plays from there; only: true plays just that segment, then stops.
// Controls: play, back/forward 10 s, previous/next part, seek, volume,
// speed, captions, full screen. Keys (once the player is clicked): space or
// k play/pause, ←/→ 5 s, up/down volume, m mute, c captions, f full screen.
// Volume and speed are remembered on this device.
//
// Optional effects (all off unless an item asks): how an item comes on
// (enter), how a highlight marks an earlier item (emphasis), items taken
// off or crossed out (remove), items kept through a new board (keep), the camera zooming onto an item or a part of
// it (camera, area), items set side by side in a row (row), a picture's crop and slow zoom or pan, a sequence of pictures (a
// flipbook), a diagram drawn step by step, a clip under the voice, and a
// part's own board colour and layout. Everything is driven by the lesson
// clock, so the video export records it as it plays.

const tex = (src, display) => {
  try {
    return katex.renderToString(src, { displayMode: display, throwOnError: false, output: "html" });
  } catch {
    return src;
  }
};
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
// Text with inline maths, and ==highlights==. Maths may be written $…$,
// $$…$$, \(…\) or \[…\] (all shown inline); \$ is a plain dollar sign.
const HL_OPEN = "\u0001";
const HL_CLOSE = "\u0002";
const DOLLAR = "\u0003";
const MATH_RUN = /(\$\$[^$]+?\$\$|\$[^$]+?\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\])/;
const unwrapMath = (m) => (m.startsWith("$$") ? m.slice(2, -2) : m.startsWith("$") ? m.slice(1, -1) : m.slice(2, -2));
const inline = (text) =>
  String(text || "")
    .replace(/\\\$/g, DOLLAR)
    .replace(/==(?!=)(.+?)==/g, `${HL_OPEN}$1${HL_CLOSE}`)
    .split(MATH_RUN)
    .map((part, i) => (i % 2 ? tex(unwrapMath(part).replace(/[\u0001\u0002]/g, "").replaceAll(DOLLAR, "\\$"), false) : escapeHtml(part).replaceAll(DOLLAR, "$")))
    .join("")
    .replaceAll(HL_OPEN, '<mark class="bp-hl">')
    .replaceAll(HL_CLOSE, "</mark>");

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
// This viewer's volume and speed (a convenience: fine when storage is off).
const PREFS_KEY = "boardPlayer.prefs";
const loadPrefs = () => {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    return {
      volume: Number.isFinite(p.volume) ? Math.min(1, Math.max(0, p.volume)) : 1,
      muted: Boolean(p.muted),
      rate: SPEEDS.includes(p.rate) ? p.rate : 1,
    };
  } catch {
    return { volume: 1, muted: false, rate: 1 };
  }
};
const savePrefs = (p) => {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* storage off */ }
};

const DEFAULT_STYLE = { board: "#fbfaf6", ink: "#1d2330", accent: "#2f6fdf", logo: null, name: null, corner: "tr" };
// Below this shrink, the board is wiped and the newest step starts a fresh
// one, so long working stays readable.
const MIN_SCALE = 0.8;

// full: the whole board, shown by the player (FullItem); elsewhere (the
// editor's previews) as large.
const IMAGE_HEIGHT = { small: "6.5em", medium: "9.5em", large: "14em", full: "14em" };
const FULL_TYPES = ["image", "sequence", "clip", "diagram"];
const isFull = (item) => item?.size === "full" && FULL_TYPES.includes(item.type);

// A part's own board (segment.background): a preset or a colour.
const PRESETS = {
  whiteboard: { board: "#fbfaf6", ink: "#1d2330", accent: "#2f6fdf" },
  blackboard: { board: "#22272b", ink: "#f2f2ee", accent: "#ffd54f" },
  greenboard: { board: "#1f3d30", ink: "#f4f1e8", accent: "#ffe082" },
  dark: { board: "#0f172a", ink: "#e2e8f0", accent: "#38bdf8" },
};
const lookOf = (bg) => {
  if (PRESETS[bg]) return PRESETS[bg];
  if (!/^#[0-9a-f]{6}$/i.test(bg || "")) return null;
  const n = parseInt(bg.slice(1), 16);
  const light = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) > 150;
  return { board: bg, ink: light ? "#1d2330" : "#f2f2ee" };
};

// How an item comes on (item.enter); the usual fade when unset.
const ENTER = {
  fade: "bp-in 450ms ease-out both",
  slide: "bp-slide 550ms cubic-bezier(.2,.8,.2,1) both",
  pop: "bp-pop 500ms cubic-bezier(.3,1.5,.5,1) both",
  zoom: "bp-zoom 650ms ease-out both",
  wipe: "bp-wipe 750ms ease-out both",
  write: "bp-wipe 1500ms linear both",
  draw: "bp-reveal 1400ms ease-out both",
  morph: "bp-morph 650ms ease-out both",
};
// A working line's changed part (\hl{...} in its latex), in the accent.
const hlMath = (latex, accent) => String(latex || "").replace(/\\hl\{/g, `\\textcolor{${accent}}{`);
const TEXTUAL = ["heading", "text", "answer", "list", "callout"];
// Typewriter: plain text only (maths and highlights come on with a wipe).
const typeable = (item) => item.enter === "type" && (["code", "output"].includes(item.type) || (["heading", "text", "answer"].includes(item.type) && !/[$\\]|==/.test(item.text || "")));
const TYPE_CPS = 32;
const MEDIA = ["image", "diagram", "clip", "sequence", "graph"];

// Marks drawn around an item (a highlight's emphasis, a removal): measured
// from the item as laid out, so they fit whatever it is.
function ItemMarks({ kinds, color, warm }) {
  const ref = useRef(null);
  const [box, setBox] = useState(null);
  useLayoutEffect(() => {
    const host = ref.current?.parentElement;
    const el = host?.firstElementChild;
    if (!host || !el || el === ref.current) return;
    const hr = host.getBoundingClientRect();
    const k = hr.width / (host.offsetWidth || hr.width || 1) || 1;
    let r = el.getBoundingClientRect();
    const math = el.querySelector(".katex-display .katex");
    // An equation: just the equation; a line of text: just the text, not
    // the whole width.
    if (math || (getComputedStyle(el).display === "block" && !["FIGURE", "TABLE", "UL"].includes(el.tagName))) {
      const range = document.createRange();
      range.selectNodeContents(math?.querySelector(".katex-html") || math || el);
      const rr = range.getBoundingClientRect();
      if (rr.width > 0) r = rr;
    }
    const next = { left: (r.left - hr.left) / k, top: (r.top - hr.top) / k, width: r.width / k, height: r.height / k };
    if (!box || Math.abs(box.left - next.left) + Math.abs(box.top - next.top) + Math.abs(box.width - next.width) + Math.abs(box.height - next.height) > 1) setBox(next);
  });
  const draw = (delay = 0, ms = 600) => ({ opacity: 0, strokeDasharray: "1.08 1.08", strokeDashoffset: 1.08, animation: `bp-draw ${ms}ms ease-out ${delay}ms forwards, bp-fade 1ms linear ${delay}ms forwards` });
  const pad = 6;
  return (
    <span ref={ref} aria-hidden style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0, pointerEvents: "none" }}>
      {box && kinds.map((kind) => {
        const w = box.width + pad * 2;
        const h = box.height + pad * 2;
        const common = { fill: "none", stroke: kind === "strike" || kind === "cross" ? warm : color, strokeWidth: 3, strokeLinecap: "round", pathLength: 1 };
        const svg = (children, extra = {}) => (
          <svg key={kind} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ position: "absolute", left: box.left - pad, top: box.top - pad, width: w, height: h, overflow: "visible", ...extra }}>{children}</svg>
        );
        if (kind === "underline") return svg(<path d={`M ${pad} ${h - pad + 3} Q ${w / 2} ${h - pad + 7} ${w - pad} ${h - pad + 1}`} {...common} style={draw()} />);
        if (kind === "circle") return svg(<ellipse cx={w / 2} cy={h / 2} rx={w / 2 + 4} ry={h / 2 + 3} {...common} style={draw(0, 800)} />);
        if (kind === "strike") return svg(<path d={`M ${pad - 2} ${h / 2} L ${w - pad + 2} ${h / 2 - 2}`} {...common} style={draw()} />);
        if (kind === "cross") return svg(<><path d={`M ${pad} ${pad} L ${w - pad} ${h - pad}`} {...common} style={draw()} /><path d={`M ${w - pad} ${pad} L ${pad} ${h - pad}`} {...common} style={draw(350)} /></>);
        if (kind === "arrow") {
          const y = h / 2;
          return (
            <svg key={kind} viewBox="0 0 60 30" style={{ position: "absolute", left: box.left - 64, top: box.top + box.height / 2 - 15, width: 60, height: 30, overflow: "visible" }}>
              <path d="M 2 22 Q 30 26 50 15" {...common} style={draw()} />
              <path d="M 40 9 L 52 14 L 43 24" {...common} style={draw(450, 250)} />
            </svg>
          );
        }
        return null;
      })}
    </span>
  );
}

// Marks drawn over a picture, in % of it: circles, arrows, underlines
// (drawn as by hand when `draw` is set) and labels. aspect is the
// picture's height over width, so shapes keep their proportions.
// scaled: strokes sized with the picture (a full-board picture video),
// rather than a fixed 3 px. The 3 px is measured into the picture's units
// (not a non-scaling stroke, whose dashes ignore pathLength and break the
// drawing animation into pieces).
// stretch: the picture is stretched to its box (a part shown, in a tight
// row), so the marks stretch with it rather than keep its shape.
export function MarkShapes({ marks, color, aspect = 0.75, draw = false, scaled = false, stretch = false }) {
  const svgRef = useRef(null);
  const [px, setPx] = useState(0);
  useLayoutEffect(() => {
    const el = svgRef.current;
    if (scaled || !el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([e]) => setPx(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [scaled, marks?.length]);
  if (!marks?.length) return null;
  const unit = px ? 100 / px : 0.25; // one screen pixel, in picture units
  const h = 100 * aspect;
  const Y = (y) => (y / 100) * h;
  // Marks carried over from the picture's earlier step (old) stay still;
  // only the new ones are drawn, one after another.
  const order = [];
  let n = 0;
  for (const m of marks) order.push(m.old ? -1 : n++);
  // Hidden until its turn (a round line cap would show as a dot), and a
  // dash a little longer than the shape, so a closed one joins up.
  const anim = (i, extra = 0) => {
    if (!draw || order[i] < 0) return null;
    const at = `${0.5 + order[i] * 0.7 + extra}s`;
    return { opacity: 0, strokeDasharray: "1.08 1.08", strokeDashoffset: 1.08, animation: `bp-draw 700ms ease-out ${at} forwards, bp-fade 1ms linear ${at} forwards` };
  };
  const fade = (i, extra) => (draw && order[i] >= 0 ? { opacity: 0, animation: `bp-fade 200ms ease-out ${0.5 + order[i] * 0.7 + extra}s forwards` } : null);
  return (
    <>
      <svg ref={svgRef} viewBox={`0 0 100 ${h}`} preserveAspectRatio={stretch ? "none" : undefined} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none" }}>
        {marks.map((m, i) => {
          const c = m.color || color;
          const common = scaled
            ? { fill: "none", stroke: c, strokeWidth: 0.55, strokeLinecap: "round", strokeLinejoin: "round", pathLength: 1, style: anim(i) }
            : { fill: "none", stroke: c, strokeWidth: 3 * unit, strokeLinecap: "round", strokeLinejoin: "round", pathLength: 1, style: anim(i) };
          const x1 = m.x; const y1 = Y(m.y);
          // Dashed shapes fade in (the drawing animation uses the dash itself).
          const dashed = { ...common, pathLength: undefined, strokeDasharray: scaled ? "1.8 1.3" : `${9 * unit} ${7 * unit}`, style: fade(i, 0) || undefined };
          // highlight: a see-through marker band; cross and tick fill their box.
          if (["dashbox", "highlight", "cross", "tick", "oval", "dashoval"].includes(m.kind)) {
            const ax = Math.min(x1, m.x2 ?? x1 + 8); const ay = Math.min(y1, Y(m.y2 ?? m.y + 8));
            const aw = Math.abs((m.x2 ?? x1 + 8) - x1) || 4; const ah = Math.abs(Y(m.y2 ?? m.y + 8) - y1) || 4;
            if (m.kind === "oval" || m.kind === "dashoval") return <ellipse key={i} cx={ax + aw / 2} cy={ay + ah / 2} rx={aw / 2} ry={ah / 2} {...(m.kind === "dashoval" ? dashed : common)} />;
            if (m.kind === "dashbox") return <rect key={i} x={ax} y={ay} width={aw} height={ah} rx={1.2} {...dashed} />;
            if (m.kind === "highlight") return <rect key={i} x={ax} y={ay} width={aw} height={ah} rx={0.6} fill={c} fillOpacity={0.3} style={fade(i, 0) || undefined} />;
            if (m.kind === "cross") return <path key={i} d={`M${ax} ${ay}L${ax + aw} ${ay + ah}M${ax + aw} ${ay}L${ax} ${ay + ah}`} {...common} />;
            return <path key={i} d={`M${ax} ${ay + ah * 0.55}L${ax + aw * 0.38} ${ay + ah}L${ax + aw} ${ay}`} {...common} />;
          }
          if (m.kind === "number") {
            const r = scaled ? 2.6 : 3.2;
            return (
              <g key={i} style={fade(i, 0) || undefined}>
                <circle cx={x1} cy={y1} r={r} fill={c} stroke="#fff" strokeWidth={scaled ? 0.35 : 1.5} vectorEffect={scaled ? undefined : "non-scaling-stroke"} />
                <text x={x1} y={y1} textAnchor="middle" dominantBaseline="central" fill="#fff" fontSize={r * 1.15} fontWeight={700} fontFamily="Inter, system-ui, sans-serif">{String(m.text || "").slice(0, 3)}</text>
              </g>
            );
          }
          // box: a frame from (x, y) to (x2, y2); dim: everything outside it darkened.
          if (m.kind === "box" || m.kind === "dim") {
            const bx = Math.min(x1, m.x2 ?? x1 + 10); const by = Math.min(y1, Y(m.y2 ?? m.y + 10));
            const bw = Math.abs((m.x2 ?? x1 + 10) - x1); const bh = Math.abs(Y(m.y2 ?? m.y + 10) - y1);
            if (m.kind === "dim") return <path key={i} d={`M0 0H100V${h}H0Z M${bx} ${by}V${by + bh}H${bx + bw}V${by}Z`} fillRule="evenodd" fill="rgba(0,0,0,0.55)" style={fade(i, 0) || undefined} />;
            return <rect key={i} x={bx} y={by} width={bw} height={bh} rx={1.2} {...common} />;
          }
          if (m.kind === "circle" || m.kind === "dashcircle") {
            const r = m.x2 != null ? Math.hypot(m.x2 - m.x, Y(m.y2) - y1) || 5 : 6;
            return <circle key={i} cx={x1} cy={y1} r={r} {...(m.kind === "dashcircle" ? dashed : common)} />;
          }
          const x2 = m.x2 ?? m.x + 12; const y2 = m.y2 != null ? Y(m.y2) : y1;
          if (m.kind === "underline") return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} {...common} />;
          if (m.kind === "dashed") return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} {...dashed} />;
          if (m.kind === "arrow" || m.kind === "double" || m.kind === "dasharrow") {
            // The head: a filled triangle at the end, pointing along the line.
            const a = Math.atan2(y2 - y1, x2 - x1);
            const len = Math.min(5, Math.max(2.5, Math.hypot(x2 - x1, y2 - y1) * 0.3));
            const p = (da) => `${x2 - len * Math.cos(a + da)},${y2 - len * Math.sin(a + da)}`;
            const q = (da) => `${x1 + len * Math.cos(a + da)},${y1 + len * Math.sin(a + da)}`;
            return (
              <g key={i}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} {...(m.kind === "dasharrow" ? dashed : common)} />
                <polygon points={`${x2},${y2} ${p(0.45)} ${p(-0.45)}`} fill={c} style={fade(i, 0.6)} />
                {m.kind === "double" && <polygon points={`${x1},${y1} ${q(0.45)} ${q(-0.45)}`} fill={c} style={fade(i, 0.6)} />}
              </g>
            );
          }
          return null;
        })}
      </svg>
      {marks.map((m, i) => m.kind === "label" && (
        <span key={`t${i}`} style={{ position: "absolute", left: `${m.x}%`, top: `${m.y}%`, transform: "translate(-50%, -50%)", background: m.color || color, color: "#fff", fontSize: "0.6em", lineHeight: 1.35, fontWeight: 700, padding: "0.1em 0.45em", borderRadius: 6, whiteSpace: "nowrap", ...(fade(i, 0.2) || {}) }}
          dangerouslySetInnerHTML={{ __html: inline(m.text || "") }} />
      ))}
    </>
  );
}

// Which of n pictures or steps shows at `now`: each at its time (times),
// the rest `per` seconds apart after the last; round again when looping.
const stepAt = (n, now, at, times, per, loop) => {
  if (n <= 1) return 0;
  const known = (times || []).slice(0, n);
  const base = known.length ? known[known.length - 1] : at;
  const passed = known.filter((t) => t <= now + 1e-6).length;
  if (known.length && passed < known.length) return Math.max(0, passed - 1);
  const i = Math.max(0, known.length - 1) + Math.max(0, Math.floor((now - base) / per + 1e-6));
  return loop ? i % n : Math.min(n - 1, i);
};
const svgUrl = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
// A diagram's steps: the drawing with groups data-step="1", "2"… shown up to
// each step in turn.
const diagramSteps = (svg) => {
  try {
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    const nums = [...new Set([...doc.querySelectorAll("[data-step]")].map((n) => Number(n.getAttribute("data-step"))).filter(Number.isFinite))].sort((a, b) => a - b);
    if (nums.length < 2) return null;
    return nums.map((v) => {
      const d = doc.cloneNode(true);
      d.querySelectorAll("[data-step]").forEach((n) => { if (Number(n.getAttribute("data-step")) > v) n.remove(); });
      return new XMLSerializer().serializeToString(d);
    });
  } catch {
    return null;
  }
};
// Pictures stacked in one place, one showing (a sequence, a diagram's steps).
function Stack({ urls, index, fade, height }) {
  return (
    <div style={{ display: "grid", lineHeight: 0 }}>
      {urls.map((u, i) => (
        <img key={i} src={u} alt="" style={{ gridArea: "1 / 1", height, maxWidth: "100%", objectFit: "contain", display: "block", borderRadius: 6, opacity: i === index ? 1 : 0, transition: fade ? "opacity 450ms ease" : "none" }} />
      ))}
    </div>
  );
}

// An AI diagram: its SVG shown as a picture (never as live markup).
function DiagramItem({ item, anim, glowStyle, self, now, at, times }) {
  const steps = useMemo(() => (item.build && item.svg ? diagramSteps(item.svg) : null), [item.build, item.svg]);
  if (!item.svg) return null;
  const height = IMAGE_HEIGHT[item.size] || IMAGE_HEIGHT.large;
  return (
    <figure style={{ ...anim, ...glowStyle, alignSelf: self, textAlign: item.align || undefined, margin: "0.3em 0", maxWidth: "80%" }}>
      {steps
        ? <Stack urls={steps.map(svgUrl)} index={stepAt(steps.length, now, at, times, Number(item.seconds) || 1.5, false)} fade height={height} />
        : <img src={svgUrl(item.svg)} alt=""
          style={{ height, maxWidth: "100%", objectFit: "contain", display: "block", borderRadius: 6 }} />}
      {item.caption && <figcaption style={{ fontSize: "0.7em", opacity: 0.75, marginTop: "0.25em" }} dangerouslySetInnerHTML={{ __html: inline(item.caption) }} />}
    </figure>
  );
}

// A video clip on the board. While the clock is inside it (clip.active) it
// plays from clip.local seconds into the video, following the player's
// play/pause, speed and volume; otherwise it rests on its first frame. The
// player keeps a handle on it (clip.register) to hold the clock while it
// loads, and the video export takes its sound (onClipMedia).
function ClipItem({ item, anim, glowStyle, self, clip, onClipMedia, fill = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const v = ref.current;
    if (!v || !clip) return undefined;
    clip.register(v);
    onClipMedia?.(v);
    return () => clip.register(v, true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const v = ref.current;
    if (!v || !clip) return;
    v.muted = clip.muted || item.sound === false;
    v.volume = clip.volume ?? 1;
    v.playbackRate = clip.rate || 1;
    if (clip.active) {
      if (Math.abs(v.currentTime - clip.local) > 0.35) v.currentTime = clip.local;
      if (clip.playing && v.paused) v.play().catch(() => {});
      else if (!clip.playing && !v.paused) v.pause();
    } else if (!v.paused) {
      v.pause();
    }
  });
  if (!item.url) return null;
  if (fill) {
    return (
      <video ref={ref} src={item.url} playsInline preload="auto"
        onLoadedMetadata={(e) => { if (!clip?.active) e.currentTarget.currentTime = Number(item.start) || 0; }}
        style={{ ...anim, position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block", background: "#000" }} />
    );
  }
  return (
    <figure style={{ ...anim, ...glowStyle, alignSelf: self, textAlign: item.align || undefined, margin: "0.3em 0", maxWidth: "80%" }}>
      <video ref={ref} src={item.url} playsInline preload="auto"
        onLoadedMetadata={(e) => { if (!clip?.active) e.currentTarget.currentTime = Number(item.start) || 0; }}
        style={{ height: IMAGE_HEIGHT[item.size] || IMAGE_HEIGHT.large, maxWidth: "100%", display: "block", borderRadius: 6, background: "#000" }} />
      {item.caption && <figcaption style={{ fontSize: "0.7em", opacity: 0.75, marginTop: "0.25em" }} dangerouslySetInnerHTML={{ __html: inline(item.caption) }} />}
    </figure>
  );
}

// A slow zoom or pan while a picture is on the board (item.motion).
const MOTION = { in: "bp-kb-in 14s ease-out both", out: "bp-kb-out 14s ease-out both", left: "bp-kb-left 14s ease-in-out both", right: "bp-kb-right 14s ease-in-out both" };
function PictureItem({ item, url, anim, glowStyle, fresh, accent, self }) {
  const [aspect, setAspect] = useState(0.75);
  const height = IMAGE_HEIGHT[item.size] || IMAGE_HEIGHT.medium;
  const c = item.crop;
  const onLoad = (e) => e.currentTarget.naturalWidth && setAspect(e.currentTarget.naturalHeight / e.currentTarget.naturalWidth);
  const move = MOTION[item.motion] ? { animation: MOTION[item.motion], transformOrigin: "center" } : null;
  return (
    <figure style={{ ...anim, ...glowStyle, alignSelf: self, textAlign: item.align || undefined, margin: "0.3em 0", maxWidth: "80%" }}>
      {c ? (
        // Only a part of the picture: the whole of it placed so that part
        // fills the box (marks stay where they are on the picture).
        <div style={{ position: "relative", display: "inline-block", height, aspectRatio: `${c.w} / ${c.h * aspect}`, maxWidth: "100%", overflow: "hidden", lineHeight: 0, verticalAlign: "top" }}>
          <div style={{ position: "absolute", inset: 0, ...move }}>
            <div style={{ position: "absolute", width: `${10000 / c.w}%`, height: `${10000 / c.h}%`, left: `${(-c.x * 100) / c.w}%`, top: `${(-c.y * 100) / c.h}%` }}>
              <img src={url} alt="" onLoad={onLoad} style={{ width: "100%", height: "100%", display: "block" }} />
              <MarkShapes marks={item.marks} color={accent} aspect={aspect} draw={fresh} stretch />
            </div>
          </div>
        </div>
      ) : (
        <div style={{ position: "relative", display: "inline-block", lineHeight: 0, ...(move ? { overflow: "hidden" } : null) }}>
          <div style={{ position: "relative", ...move }}>
            <img src={url} alt="" onLoad={onLoad}
              style={{ height, maxWidth: "100%", objectFit: "contain", display: "block" }} />
            <MarkShapes marks={item.marks} color={accent} aspect={aspect} draw={fresh} />
          </div>
        </div>
      )}
      {item.caption && <figcaption style={{ fontSize: "0.7em", opacity: 0.75, marginTop: "0.25em" }} dangerouslySetInnerHTML={{ __html: inline(item.caption) }} />}
    </figure>
  );
}

// Pictures shown one after another in one place, like a flipbook.
function SequenceItem({ item, anim, glowStyle, self, now, at, times }) {
  const frames = (item.frames || []).filter((f) => f.url);
  if (!frames.length) return null;
  const i = stepAt(frames.length, now, at, times, Number(item.seconds) || 1, Boolean(item.loop));
  const caption = frames[i]?.caption || item.caption;
  return (
    <figure style={{ ...anim, ...glowStyle, alignSelf: self, textAlign: item.align || undefined, margin: "0.3em 0", maxWidth: "80%" }}>
      <Stack urls={frames.map((f) => f.url)} index={i} fade={item.transition !== "cut"} height={IMAGE_HEIGHT[item.size] || IMAGE_HEIGHT.medium} />
      {caption && <figcaption style={{ fontSize: "0.7em", opacity: 0.75, marginTop: "0.25em" }} dangerouslySetInnerHTML={{ __html: inline(caption) }} />}
    </figure>
  );
}

// A full-board item: the picture, flipbook or clip fills the whole board
// edge to edge (cropped to fit, no caption); a diagram is fitted whole.
// A whole picture over the board, letterboxed, with marks drawn on it (a
// picture video). The box is the picture itself, so a camera move's area
// (in % of the picture) lands on the right part.
const MARK_COLOR = "#e8590c";
function ContainedPicture({ url, marks, fresh, anim, move }) {
  const [aspect, setAspect] = useState(null);
  const onLoad = (e) => e.currentTarget.naturalWidth && setAspect(e.currentTarget.naturalHeight / e.currentTarget.naturalWidth);
  const a = aspect || 9 / 16;
  // The board is 16:9: a taller picture fills its height, a wider one its width.
  const tall = a > 9 / 16;
  const w = tall ? (9 / 16 / a) * 100 : 100;
  const h = tall ? 100 : (a / (9 / 16)) * 100;
  return (
    <div style={{ position: "absolute", left: `${(100 - w) / 2}%`, top: `${(100 - h) / 2}%`, width: `${w}%`, height: `${h}%`, ...anim }}>
      <div style={{ position: "absolute", inset: 0, ...move }}>
        <img src={url} alt="" onLoad={onLoad} style={{ width: "100%", height: "100%", display: "block" }} />
        {aspect && <MarkShapes marks={marks} color={MARK_COLOR} aspect={aspect} draw={fresh} scaled />}
      </div>
    </div>
  );
}

function FullItem({ item, lesson, fresh, now, at, times, clip, onClipMedia }) {
  const steps = useMemo(() => (item.type === "diagram" && item.svg ? (item.build && diagramSteps(item.svg)) || [item.svg] : null), [item.type, item.build, item.svg]);
  const anim = fresh && !(item.type === "image" && item.from) ? { animation: ENTER[item.enter] || ENTER.fade } : null;
  const fill = { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" };
  if (item.type === "clip") return <ClipItem item={item} anim={anim} clip={clip} onClipMedia={onClipMedia} fill />;
  if (item.type === "image") {
    const url = item.url || (item.src === "solution" ? lesson.solutionImageUrl : lesson.imageUrl);
    if (!url) return null;
    const move = MOTION[item.motion] ? { animation: MOTION[item.motion], transformOrigin: "center" } : null;
    if (item.fit === "contain") return <ContainedPicture url={url} marks={item.marks} fresh={fresh} anim={anim} move={move} />;
    return <div style={{ ...fill, overflow: "hidden", ...anim }}><img src={url} alt="" style={{ ...fill, ...move }} /></div>;
  }
  const urls = item.type === "sequence"
    ? (item.frames || []).filter((f) => f.url).map((f) => f.url)
    : (steps || []).map(svgUrl);
  if (!urls.length) return null;
  const i = item.type === "sequence"
    ? stepAt(urls.length, now, at, times, Number(item.seconds) || 1, Boolean(item.loop))
    : stepAt(urls.length, now, at, times, Number(item.seconds) || 1.5, false);
  const fade = item.type !== "sequence" || item.transition !== "cut";
  return (
    <div style={{ ...fill, ...anim }}>
      {urls.map((u, n) => <img key={n} src={u} alt="" style={{ ...fill, objectFit: item.type === "diagram" ? "contain" : "cover", opacity: n === i ? 1 : 0, transition: fade ? "opacity 450ms ease" : "none" }} />)}
    </div>
  );
}

// Callouts: a thought, or a labelled note (key idea, tip, common mistake,
// note, a question to ask yourself), in the look chosen in Settings →
// video board (style.callouts): soft cards, sticky notes, hand-drawn
// marker, index cards, handwritten quote, or plain.
const CALLOUT_LABELS = { idea: "Key idea", tip: "Tip", warning: "Common mistake", note: "Note", question: "Ask yourself" };
const WARM = "#d9623b";
const PAPER_INK = "#1d2330";
const HAND = "Caveat, 'Noto Sans Bengali', cursive";
const html = (t) => ({ __html: inline(t) });
function Callout({ item, anim, glowStyle, ink, accent, self, look = "soft" }) {
  const think = item.kind === "think";
  const label = CALLOUT_LABELS[item.kind] || CALLOUT_LABELS.note;
  const tone = item.kind === "warning" ? WARM : accent;
  const box = { ...anim, ...glowStyle, alignSelf: self, maxWidth: think ? "75%" : "70%", margin: "0.4em 0", lineHeight: 1.4 };
  if (look === "sticky") {
    if (think) {
      return (
        <div style={{ ...box, display: "flex", alignItems: "center", gap: "0.45em", fontFamily: HAND, fontSize: "1.3em", lineHeight: 1.2 }}>
          <svg viewBox="0 0 38 34" style={{ width: "1.5em", height: "1.35em", flex: "none" }}><path d="M8 22c-5 0-6-7-1-8 0-6 8-8 11-4 3-4 11-2 10 3 5 1 4 9-1 9H8z" fill="none" stroke={ink} strokeWidth="1.8" strokeLinejoin="round" /><circle cx="7" cy="28" r="2.2" fill="none" stroke={ink} strokeWidth="1.5" /><circle cx="3" cy="32" r="1.3" fill="none" stroke={ink} strokeWidth="1.3" /></svg>
          <span dangerouslySetInnerHTML={html(item.text)} />
        </div>
      );
    }
    return (
      <div style={{ ...box, position: "relative", background: item.kind === "warning" ? "#ffe1d6" : "#fff7c2", color: PAPER_INK, padding: "0.55em 0.85em 0.65em", boxShadow: "0 0.35em 0.8em rgba(0,0,0,0.14)", transform: `rotate(${item.kind === "warning" ? 1 : -1.2}deg)` }}>
        <span style={{ position: "absolute", top: "-0.5em", left: "40%", width: "3.2em", height: "1em", background: "rgba(255,255,255,0.65)", boxShadow: "0 1px 2px rgba(0,0,0,0.08)", transform: "rotate(-3deg)" }} />
        <div style={{ fontFamily: HAND, fontWeight: 700, fontSize: "1.2em", lineHeight: 1 }}>{label}</div>
        <div dangerouslySetInnerHTML={html(item.text)} />
      </div>
    );
  }
  if (look === "marker") {
    const frame = think
      ? <path d="M6 20c-6-8 4-16 14-13 4-7 18-7 24-1 7-5 21-4 26 2 9-3 22 2 22 10 6 6-2 15-12 13-4 6-18 7-25 2-8 5-22 4-27-2-10 3-24-2-22-11z" fill="none" stroke={ink} strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
      : <path d="M2 4 Q50 0 98 3 Q101 50 97 97 Q50 101 3 96 Q-1 50 2 4" fill="none" stroke={tone} strokeWidth="2" vectorEffect="non-scaling-stroke" />;
    return (
      <div style={{ ...box, position: "relative", padding: think ? "0.55em 1.3em" : "0.65em 0.9em 0.55em", ...(think ? { fontFamily: HAND, fontSize: "1.3em", lineHeight: 1.2 } : null) }}>
        <svg preserveAspectRatio="none" viewBox={think ? "0 0 100 40" : "0 0 100 100"} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}>{frame}</svg>
        {!think && <div style={{ fontFamily: HAND, fontWeight: 700, fontSize: "1.25em", color: tone, lineHeight: 1 }}>{label}</div>}
        <div style={{ position: "relative" }} dangerouslySetInnerHTML={html(item.text)} />
      </div>
    );
  }
  if (look === "card") {
    if (think) {
      return (
        <div style={{ ...box, display: "flex", alignItems: "flex-end", gap: "0.5em" }}>
          <svg viewBox="0 0 34 34" style={{ width: "1.9em", height: "1.9em", flex: "none" }}><circle cx="17" cy="12" r="7" fill="none" stroke={ink} strokeWidth="1.7" /><path d="M4 33c1-8 7-12 13-12s12 4 13 12" fill="none" stroke={ink} strokeWidth="1.7" /></svg>
          <div style={{ background: `${ink}12`, borderRadius: "1em 1em 1em 0.25em", padding: "0.45em 0.85em", fontStyle: "italic" }} dangerouslySetInnerHTML={html(item.text)} />
        </div>
      );
    }
    return (
      <div style={{ ...box, position: "relative", background: "#fff", color: PAPER_INK, padding: "0.65em 0.95em", boxShadow: "0 0.2em 0.6em rgba(0,0,0,0.1)", clipPath: "polygon(0 0, calc(100% - 1.2em) 0, 100% 1.2em, 100% 100%, 0 100%)" }}>
        <span style={{ position: "absolute", right: 0, top: 0, width: "1.2em", height: "1.2em", background: "linear-gradient(225deg, transparent 50%, #dfe3ea 50%)" }} />
        <div style={{ display: "inline-block", fontSize: "0.62em", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: tone, borderBottom: `2px solid ${tone}`, paddingBottom: "0.1em", marginBottom: "0.35em" }}>{label}</div>
        <div dangerouslySetInnerHTML={html(item.text)} />
      </div>
    );
  }
  if (look === "quote") {
    if (think) {
      return (
        <div style={{ ...box, position: "relative", paddingLeft: "1.5em", fontFamily: HAND, fontSize: "1.35em", lineHeight: 1.2 }}>
          <span style={{ position: "absolute", left: 0, top: "-0.35em", fontSize: "2.3em", fontFamily: "Georgia, serif", color: `${accent}77`, lineHeight: 1 }}>{"\u201C"}</span>
          <span dangerouslySetInnerHTML={html(item.text)} />
        </div>
      );
    }
    return (
      <div style={box}>
        <span style={{ display: "inline-block", fontWeight: 700, fontSize: "0.8em", padding: "0 0.35em", marginBottom: "0.2em", background: `linear-gradient(transparent 45%, ${tone}4d 45%, ${tone}4d 90%, transparent 90%)` }}>{label}</span>
        <div dangerouslySetInnerHTML={html(item.text)} />
      </div>
    );
  }
  if (look === "plain") {
    if (think) return <div style={{ ...box, padding: "0.35em 0.8em", border: `1.5px dashed ${ink}40`, borderRadius: "0.6em", fontStyle: "italic", opacity: 0.9 }} dangerouslySetInnerHTML={html(item.text)} />;
    return (
      <div style={{ ...box, border: `1px solid ${ink}2e`, background: `${ink}08`, borderRadius: "0.5em", padding: "0.35em 0.8em" }}>
        <div style={{ fontSize: "0.62em", fontWeight: 600, color: `${ink}99`, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.1em" }}>{label}</div>
        <div dangerouslySetInnerHTML={html(item.text)} />
      </div>
    );
  }
  // soft (the default)
  if (think) {
    return (
      <div style={{ ...box, display: "flex", alignItems: "center", gap: "0.55em", background: "linear-gradient(135deg, #f3f0ff, #eef6ff)", color: PAPER_INK, borderRadius: 999, padding: "0.4em 1em 0.4em 0.7em", fontStyle: "italic" }}>
        <span style={{ width: "1.2em", height: "1.2em", borderRadius: "50%", border: "2px solid #8b7fd6", flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#8b7fd6", fontStyle: "normal", fontWeight: 700, fontSize: "0.85em", lineHeight: 0 }}>…</span>
        <span dangerouslySetInnerHTML={html(item.text)} />
      </div>
    );
  }
  return (
    <div style={{ ...box, borderRadius: "0.8em", padding: "0.6em 0.9em", background: "linear-gradient(160deg, #ffffff, #f2f5fb)", color: PAPER_INK, boxShadow: "0 1px 0 rgba(255,255,255,0.8) inset, 0 0.45em 1.1em rgba(29,35,48,0.1)", border: "1px solid rgba(29,35,48,0.06)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.45em", fontSize: "0.66em", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: tone, marginBottom: "0.2em" }}>
        <span style={{ width: "1.4em", height: "1.4em", borderRadius: "0.45em", background: `${tone}2e`, flex: "none" }} />{label}
      </div>
      <div dangerouslySetInnerHTML={html(item.text)} />
    </div>
  );
}

const SELF = { left: "flex-start", center: "center", right: "flex-end" };

// Steps that put nothing on the board themselves.
const UNSHOWN = ["newBoard", "pause", "highlight", "remove", "camera"];

// A camera move's part of an item (area: x, y, w, h in % of its box), as a
// box on the screen; the whole item when it names none.
const areaOf = (r, a) => (a && a.w > 0 && a.h > 0
  ? { left: r.left + (r.width * a.x) / 100, top: r.top + (r.height * a.y) / 100, width: (r.width * a.w) / 100, height: (r.height * a.h) / 100 }
  : r);

// One board item drawn on its own, as on a board `width` wide, for the
// editor to pick a part of it (the same box the camera zooms into).
// boxRef: the item's own element.
export function ItemPreview({ item, lesson, width = 760, background, boxRef }) {
  const style = { ...DEFAULT_STYLE, ...(lesson?.style || {}) };
  const look = lookOf(background);
  const hostRef = useRef(null);
  useLayoutEffect(() => {
    if (boxRef) boxRef.current = hostRef.current?.firstElementChild || null;
  });
  return (
    <div style={{ width, boxSizing: "border-box", padding: `${width * 0.03}px ${width * 0.06}px`, background: look?.board || style.board, color: look?.ink || style.ink, fontFamily: "Inter, 'Noto Sans Bengali', system-ui, sans-serif", fontSize: Math.max(11, width / 38), lineHeight: "normal" }}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div ref={hostRef} style={{ position: "relative", display: "flex", flexDirection: "column" }}>
          <Item item={item} lesson={lesson} fresh={false} accent={look?.accent || style.accent} ink={look?.ink || style.ink} board={look?.board || style.board} glow={false} fx={null} now={0} at={0} times={null} clip={null} />
        </div>
      </div>
    </div>
  );
}

// ---- Code and program output ----------------------------------------------
// A small colourer: comments, strings, numbers and keywords. Not a parser;
// enough for the short programs a lesson shows.
const KEYWORDS = {
  c: "auto break case char const continue default do double else enum extern float for goto if int long register return short signed sizeof static struct switch typedef union unsigned void volatile while include define printf scanf main",
  python: "and as assert break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass print raise return True try while with yield range len input",
  java: "abstract boolean break byte case catch char class continue default do double else extends final finally float for if implements import int interface long new package private protected public return short static super switch this throw throws try void while null true false String System",
  javascript: "async await break case catch class const continue default delete do else export false for function if import in instanceof let new null return switch this throw true try typeof undefined var void while console",
  sql: "select from where insert into values update set delete create table drop alter and or not null primary key foreign references join left right inner outer on group by order having as distinct count sum avg min max limit",
};
KEYWORDS.cpp = `${KEYWORDS.c} bool class namespace new delete private public protected template this using std cout cin endl string vector true false`;
const CODE_COLORS = { comment: "#7f8c98", string: "#a5d6a7", number: "#f6c177", keyword: "#82aaff", tag: "#f78c6c" };
// Strings, numbers, words (a C "#include" as one word).
const CODE_REST = /("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)|(\b\d+(?:\.\d+)?\b)|(#?[A-Za-z_]\w*)/.source;
const colourCode = (code, lang) => {
  const words = new Set((KEYWORDS[lang] || "").split(" ").filter(Boolean));
  const ci = lang === "sql";
  const hash = lang === "python";
  const re = lang === "html"
    ? /(<!--[\s\S]*?(?:-->|$))|("[^"\n]*"?|'[^'\n]*'?)|(<\/?[A-Za-z][\w-]*|\/?>)/g
    : new RegExp(`(${(hash ? /#[^\n]*/ : lang === "sql" ? /--[^\n]*/ : /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/).source})|${CODE_REST}`, "g");
  let out = "";
  let last = 0;
  for (const m of code.matchAll(re)) {
    out += escapeHtml(code.slice(last, m.index));
    last = m.index + m[0].length;
    const kind = m[1] ? "comment" : m[2] ? "string" : lang === "html" ? (m[3] ? "tag" : null) : m[3] ? "number" : m[4] && (words.has(ci ? m[4].toLowerCase() : m[4]) || (m[4][0] === "#" && !hash)) ? "keyword" : null;
    out += kind ? `<span style="color:${CODE_COLORS[kind]}">${escapeHtml(m[0])}</span>` : escapeHtml(m[0]);
  }
  return out + escapeHtml(code.slice(last));
};
const LANG_NAMES = { c: "C", cpp: "C++", python: "Python", java: "Java", javascript: "JavaScript", html: "HTML", sql: "SQL" };
function CodeItem({ item, text, anim, glowStyle, self }) {
  const output = item.type === "output";
  const label = output ? "Output" : LANG_NAMES[item.lang] || "";
  return (
    <figure style={{ ...anim, ...glowStyle, alignSelf: self, margin: "0.3em 0", maxWidth: "100%" }}>
      <div style={{ position: "relative", background: output ? "#0b0f14" : "#1e2230", color: output ? "#d7f5d0" : "#e4e7ef", borderRadius: 10, padding: label ? "1.5em 1em 0.7em" : "0.7em 1em", boxShadow: "0 0.2em 0.6em rgba(0,0,0,0.18)", overflow: "hidden" }}>
        {label && <span style={{ position: "absolute", top: "0.45em", left: "1em", fontSize: "0.6em", letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.6, fontFamily: "system-ui, sans-serif" }}>{label}</span>}
        <pre style={{ margin: 0, fontFamily: "ui-monospace, 'JetBrains Mono', Consolas, monospace", fontSize: "0.78em", lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}
          dangerouslySetInnerHTML={{ __html: output ? escapeHtml(text || "") : colourCode(text || "", item.lang) }} />
      </div>
      {item.caption && <figcaption style={{ fontSize: "0.7em", opacity: 0.75, marginTop: "0.3em" }} dangerouslySetInnerHTML={{ __html: inline(item.caption) }} />}
    </figure>
  );
}

// fx: effects on the item itself (dimmed by a spotlight or a removal,
// fading out, pulsing). typed: characters shown so far (typewriter).
function Item({ item, lesson, fresh, accent, ink, board, glow, clip, onClipMedia, fx, typed, now, at, times, centered }) {
  const typing = typeable(item);
  const enter = item.enter === "type" && !typing ? "wipe" : item.enter || (item.from ? "morph" : null);
  // A picture's next step (more marks on the same picture) doesn't come in again.
  const still = item.type === "image" && item.from;
  const anim = {
    ...(fresh && enter !== "type" && !still ? { animation: ENTER[enter] || ENTER.fade } : null),
    ...(item.enter === "write" && TEXTUAL.includes(item.type) ? { fontFamily: HAND, fontSize: item.type === "heading" ? "1.75em" : "1.2em" } : null),
    ...fx,
  };
  const glowStyle = glow ? { background: `${accent}2e`, boxShadow: `0 0 0 0.25em ${accent}2e`, borderRadius: 6, transition: "background 300ms" } : null;
  // Where the item sits across the board (item.align; left when unset, or
  // centred in a centred part). Lines of text keep the full width and
  // align their text; boxes move.
  const align = item.align || (centered ? "center" : null);
  const self = SELF[align] || "flex-start";
  const line = align && align !== "left" ? { textAlign: align } : null;
  const text = typing && typed !== undefined ? String(item.text || "").slice(0, typed) : item.text;
  switch (item.type) {
    case "heading":
      return <div style={{ ...line, fontSize: "1.55em", fontWeight: 700, color: accent, margin: "0.1em 0 0.35em", ...anim, ...glowStyle }} dangerouslySetInnerHTML={{ __html: inline(text) }} />;
    case "math":
      return <div className={align ? `bp-math-${align}` : undefined} style={{ ...anim, ...glowStyle, ...line, fontSize: "1.25em", margin: "0.2em 0" }} dangerouslySetInnerHTML={{ __html: tex(hlMath(item.latex, accent), true) }} />;
    case "list":
      return (
        <ul style={{ ...anim, ...glowStyle, alignSelf: self, margin: "0.2em 0", paddingLeft: item.check ? 0 : "1.2em", listStyle: item.check ? "none" : undefined }}>
          {(item.items || []).map((x, i) => (item.check
            ? (
              <li key={i} style={{ margin: "0.15em 0", display: "flex", gap: "0.45em", alignItems: "baseline" }}>
                <span style={{ color: accent, fontWeight: 700, flex: "none", ...(fresh ? { opacity: 0, animation: `bp-pop 400ms cubic-bezier(.3,1.5,.5,1) ${250 + i * 220}ms forwards` } : null) }}>✓</span>
                <span dangerouslySetInnerHTML={{ __html: inline(x) }} />
              </li>
            )
            : <li key={i} style={{ margin: "0.15em 0" }} dangerouslySetInnerHTML={{ __html: inline(x) }} />))}
        </ul>
      );
    case "graph":
      return <GraphItem item={item} anim={anim} glowStyle={glowStyle} self={self} accent={accent} ink={ink} fresh={fresh} />;
    case "numberline":
      return <NumberLineItem item={item} anim={anim} glowStyle={glowStyle} self={self} accent={accent} ink={ink} board={board || "#fff"} fresh={fresh} />;
    case "answer":
      return (
        <div style={{ ...glowStyle, display: "inline-block", alignSelf: self, border: `3px solid ${accent}`, borderRadius: 10, padding: "0.25em 0.7em", margin: "0.35em 0", fontWeight: 600, fontSize: "1.2em", ...anim }}
          dangerouslySetInnerHTML={{ __html: inline(text) }} />
      );
    case "image": {
      const url = item.url || (item.src === "solution" ? lesson.solutionImageUrl : lesson.imageUrl);
      return url ? <PictureItem item={item} url={url} anim={anim} glowStyle={glowStyle} fresh={fresh} accent={accent} self={self} /> : null;
    }
    case "diagram":
      return <DiagramItem item={item} anim={anim} glowStyle={glowStyle} self={self} now={now} at={at} times={times} />;
    case "sequence":
      return <SequenceItem item={item} anim={anim} glowStyle={glowStyle} self={self} now={now} at={at} times={times} />;
    case "clip":
      return <ClipItem item={item} anim={anim} glowStyle={glowStyle} self={self} clip={clip} onClipMedia={onClipMedia} />;
    case "code":
    case "output":
      return <CodeItem item={item} text={text} anim={anim} glowStyle={glowStyle} self={self} />;
    case "callout":
      return <Callout item={item} anim={anim} glowStyle={glowStyle} ink={ink} accent={accent} self={self} look={lesson?.style?.callouts} />;
    case "table":
      return (
        <table style={{ ...anim, ...glowStyle, borderCollapse: "collapse", margin: "0.3em 0", fontSize: "0.9em", alignSelf: self }}>
          <tbody>
            {(item.rows || []).map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => {
                  const Cell = r === 0 ? "th" : "td";
                  return <Cell key={c} style={{ border: `1px solid ${ink}40`, padding: "0.2em 0.6em", textAlign: "left", fontWeight: r === 0 ? 700 : 400, color: r === 0 ? accent : undefined }} dangerouslySetInnerHTML={{ __html: inline(cell) }} />;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      );
    default:
      return <div style={{ ...line, margin: "0.2em 0", lineHeight: 1.45, ...anim, ...glowStyle }} dangerouslySetInnerHTML={{ __html: inline(text) }} />;
  }
}

export default function BoardPlayer({ lesson, recording = false, startSignal = 0, onEnded, autoPlay = false, onMedia, onClipMedia, showCaptions = true, watermark = "", onPosition, jump }) {
  const style = { ...DEFAULT_STYLE, ...(lesson?.style || {}) };
  const segments = useMemo(() => lesson?.segments || [], [lesson]);
  const timeline = useMemo(() => lessonTimeline(segments), [segments]);
  const starts = useMemo(() => timeline.map((x) => x.start), [timeline]);
  const total = timeline.reduce((sum, x) => sum + x.duration, 0);
  // Every clip of the lesson in order (voice, silence, pauses), on one clock.
  const clips = useMemo(() => timeline.flatMap((x) => x.clips.map((c) => ({ ...c, start: x.start + c.start }))), [timeline]);
  const clipAt = useCallback((t) => {
    let i = 0;
    while (i < clips.length - 1 && clips[i + 1].start <= t + 1e-6) i += 1;
    return i;
  }, [clips]);
  // Which segment is playing at time t.
  const indexAt = useCallback((t) => Math.max(0, starts.filter((s) => s <= t + 1e-6).length - 1), [starts]);
  // A video clip's own lines, each at its second into the clip, cut at the
  // clip's end (boardTimeline.js).
  const spoken = useMemo(() => clips.flatMap((c) => (c.lines || []).map((l) => {
    const at = Math.min(c.dur, Math.max(0, Number(l.at) || 0));
    const len = l.durationSeconds || Math.max(1, String(l.text || "").split(/\s+/).filter(Boolean).length / 2.4 + 0.3);
    return { url: l.audioUrl || null, text: l.text, start: c.start + at, dur: Math.max(0, Math.min(len, c.dur - at)) };
  })).filter((x) => x.dur > 0), [clips]);
  const spokenAt = useCallback((t) => spoken.find((x) => t >= x.start - 1e-6 && t < x.start + x.dur), [spoken]);

  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [captions, setCaptions] = useState(showCaptions);
  useEffect(() => setCaptions(showCaptions), [showCaptions]);
  // Volume and speed; a recording always plays at full volume and speed.
  const [prefs, setPrefs] = useState(loadPrefs);
  const volume = recording ? 1 : prefs.volume;
  const muted = recording ? false : prefs.muted;
  const rate = recording ? 1 : prefs.rate;
  const rateRef = useRef(rate);
  const changePrefs = (patch) => setPrefs((p) => { const next = { ...p, ...patch }; savePrefs(next); return next; });
  const [full, setFull] = useState(false);
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(800);
  const [scale, setScale] = useState(1);
  const [lift, setLift] = useState(0);
  const stageRef = useRef(null);
  const contentRef = useRef(null);
  const audioRef = useRef(null);
  // A video clip's line being spoken.
  const lineRef = useRef(null);
  const clock = useRef({ base: 0, at: 0 });
  const timeRef = useRef(0);
  timeRef.current = time;

  const segIndex = indexAt(time);
  const seg = segments[segIndex];
  // This part's own board colour, if it has one; else the lesson's.
  const look = lookOf(seg?.background);
  const BOARD = look?.board || style.board;
  const INK = look?.ink || style.ink;
  const ACCENT = look?.accent || style.accent;
  const layout = seg?.layout || "stack";
  // Captions: the sentence being spoken (nothing during a pause).
  const clipNow = clips[clipAt(time)];
  const lineNow = clipNow?.kind === "video" ? spokenAt(time) : null;
  const caption = clipNow ? (clipNow.kind === "pause" ? "" : clipNow.kind === "video" ? lineNow?.text || "" : clipNow.text || seg?.say || "") : "";
  // The clip item playing now, if any, and where in its video.
  const videoKey = clipNow?.kind === "video" ? `${indexAt(clipNow.start)}-${clipNow.item}` : null;
  // Past its end (a frozen last frame), it rests there.
  const videoLocal = clipNow?.kind === "video" ? Math.min(clipNow.to, clipNow.from + Math.max(0, time - clipNow.start)) : 0;
  const videoFrozen = clipNow?.kind === "video" && time - clipNow.start >= clipNow.to - clipNow.from - 1e-3;
  const videos = useRef(new Map());

  // Board: from the last newBoard up to now; each item of the current
  // segment once its time comes (its cue, see boardTimeline.js).
  const glowKeys = new Set();
  const shown = useMemo(() => {
    const items = [];
    const alias = new Map();
    for (let i = 0; i <= segIndex && i < segments.length; i += 1) {
      const board = segments[i].board || [];
      for (let k = 0; k < board.length; k += 1) {
        const at = starts[i] + (timeline[i].times[k] || 0);
        if (i === segIndex && at > time + 1e-6) continue;
        if (board[k].type === "newBoard") {
          // Items marked "keep" stay through a new board (until removed).
          const gone = new Set(items.filter((x) => x.remove).map((x) => x.remove));
          const kept = items.filter((x) => x.item?.keep && !gone.has(x.key));
          items.length = 0;
          items.push(...kept);
        }
        else if (board[k].type === "pause") continue;
        else if (board[k].type === "highlight") items.push({ highlight: board[k].ref, emphasis: board[k].emphasis || "glow", key: `${i}-${k}`, seg: i, at });
        else if (board[k].type === "remove") items.push({ remove: board[k].ref, exit: board[k].exit || "fade", key: `${i}-${k}`, seg: i, at });
        else if (board[k].type === "camera") items.push({ camera: board[k], key: `${i}-${k}`, seg: i, at });
        else {
          const entry = { item: board[k], key: `${i}-${k}`, seg: i, at, times: timeline[i].frames?.[k]?.map((x) => starts[i] + x) || null };
          // The next step of a working line takes that line's place; the
          // old line fades out under it (ghost).
          // A step from a line already changed follows it to its latest step.
          let ref = board[k].from;
          for (let n = 0; ref && alias.has(ref) && n < 50; n += 1) ref = alias.get(ref);
          const j = ref ? items.findIndex((x) => x.item && x.key === ref) : -1;
          // prev: the keys it replaced, so a camera move aimed at an earlier
          // step still finds it.
          if (j >= 0) { alias.set(items[j].key, entry.key); items[j] = { ...entry, ghost: items[j].item, prev: [...(items[j].prev || []), items[j].key] }; }
          else items.push(entry);
        }
      }
    }
    return items;
  }, [segIndex, segments, starts, timeline, time]);
  // Where the board was last wiped for room (a key in shown); back to the
  // start when that step is no longer shown (seeking back).
  const [pageStart, setPageStart] = useState(null);
  const startAt = Math.max(0, shown.findIndex((x) => x.key === pageStart));
  const onBoard = useMemo(() => {
    if (!(pageStart && shown.some((x) => x.key === pageStart))) return shown;
    // Kept items stay when the board is wiped for room, too.
    const gone = new Set(shown.filter((x) => x.remove).map((x) => x.remove));
    // A working line's next step stays with the page it was written on.
    const since = shown[startAt]?.at ?? 0;
    return [...shown.slice(0, startAt).filter((x) => (x.item?.keep && !gone.has(x.key)) || (x.ghost && x.at >= since)), ...shown.slice(startAt)];
  }, [shown, pageStart, startAt]);
  useEffect(() => {
    if (pageStart && !shown.some((x) => x.key === pageStart)) setPageStart(null);
  }, [shown, pageStart]);
  // A highlight item marks an earlier step again while its segment plays;
  // it takes no room itself. Its emphasis: glow (as before), or a mark.
  const emphasis = new Map();
  for (const x of shown) {
    if (!x.highlight || x.seg !== segIndex) continue;
    if (x.emphasis === "glow") glowKeys.add(x.highlight);
    emphasis.set(x.highlight, x.emphasis);
  }
  // Removed items: faded away (gone once faded), or struck or crossed out.
  const removed = new Map();
  for (const x of shown) if (x.remove) removed.set(x.remove, x);
  const spotlight = [...emphasis].find(([, e]) => e === "spotlight")?.[0] || null;
  // The pointer: on the item the latest "point" highlight names.
  const pointKey = [...emphasis].reverse().find(([, e]) => e === "point")?.[0] || null;
  // The camera: the latest camera move on this board.
  const camera = [...shown].reverse().find((x) => x.camera) || null;
  const visible = onBoard.filter((x) => x.item && !(removed.get(x.key)?.exit === "fade" && time - removed.get(x.key).at > 0.5));
  // The newest step(s): everything that appeared at the latest moment
  // (items set to appear together all animate in).
  const latest = visible.reduce((m, x) => Math.max(m, x.at), -1);
  const freshKeys = new Set(visible.filter((x) => x.at === latest).map((x) => x.key));
  const freshKey = visible.length ? visible[visible.length - 1].key : null;

  // A full-board picture, flipbook, clip or diagram covers the board while
  // it is the newest item; it never takes room on the board itself.
  const fullNow = visible.length && isFull(visible[visible.length - 1].item) ? visible[visible.length - 1] : null;
  const inFlow = visible.filter((x) => !isFull(x.item));
  // A clip's playing state: under the voice from its cue, or holding it.
  const clipFor = (item, key, at) => {
    if (item.type !== "clip") return null;
    if (item.voice === "over") {
      const overLen = Math.max(0.5, Number(item.seconds) || 5);
      return {
        active: time >= at - 1e-3 && time < at + overLen + (Number(item.freeze) || 0), local: (Number(item.start) || 0) + Math.min(overLen, Math.max(0, time - at)), playing: playing && time - at < overLen, muted, volume: volume * (item.duck ?? 0.25), rate,
        register: () => {},
      };
    }
    return {
      active: videoKey === key, local: videoLocal, playing: playing && !videoFrozen, muted, volume: lineNow ? volume * 0.25 : volume, rate,
      register: (el, drop) => (drop ? videos.current.delete(key) : videos.current.set(key, el)),
    };
  };
  // What's playing, for the editor: the segment and the newest item.
  const newest = shown.reduce((m, x) => (!m || x.at >= m.at ? x : m), null);
  const position = `${segIndex}|${newest && newest.seg === segIndex ? newest.key : ""}`;
  useEffect(() => {
    if (!onPosition || !segments.length) return;
    const [seg, item] = position.split("|");
    onPosition({ segment: Number(seg), item: item || null, playing });
  }, [position, playing]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stage size, and shrink the board when it holds more than fits.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  useLayoutEffect(() => {
    const c = contentRef.current;
    const st = stageRef.current;
    if (!c || !st) return;
    const top = style.logo || style.name ? (style.corner[0] === "t" ? 0.12 : 0.06) : 0.06;
    const room = st.clientHeight * ((captions && seg ? 0.84 : 0.96) - top - (style.corner[0] === "b" && (style.logo || style.name) ? 0.08 : 0));
    const fit = room / Math.max(1, c.scrollHeight);
    // Out of room: a fresh board from the newest step, keeping everything
    // that appeared with it (items set to appear together stay together).
    // If that group alone is on the board already, it just shrinks to fit.
    const group = visible.findIndex((x) => x.at === latest);
    if (fit < MIN_SCALE && group > 0) { setPageStart(visible[group].key); return; }
    const k = Math.min(1, fit);
    setScale(k);
    // A centred part: the board's content in the middle, top to bottom.
    setLift(layout === "center" ? Math.max(0, (room - c.scrollHeight * k) / 2) : 0);
  }, [visible.length, freshKey, width, captions, seg, layout]); // eslint-disable-line react-hooks/exhaustive-deps

  // The camera: zoom onto the item a camera move names, centring it (kept
  // inside the board); back to the whole board when it names none.
  const camRef = useRef(null);
  const [cam, setCam] = useState({ z: 1, x: 0, y: 0, s: 1 });
  const camNow = useRef(cam);
  camNow.current = cam;
  const camKey = camera ? camera.key : "";
  useLayoutEffect(() => {
    const st = stageRef.current;
    const layer = camRef.current;
    if (!st || !layer) return;
    const move = camera?.camera;
    const seconds = Number(move?.seconds) || 1;
    // A move on an item with no zoom set yet uses the editor's default.
    const zoom = move?.ref ? Number(move.zoom) || 1.6 : 1;
    const refKey = move?.ref ? (onBoard.find((x) => x.prev?.includes(move.ref))?.key || move.ref) : null;
    const host = refKey ? layer.querySelector(`[data-bp-key="${refKey}"]`) : null;
    const target = host?.firstElementChild || host;
    if (!target || !(zoom > 1)) {
      if (camNow.current.z !== 1 || camNow.current.x || camNow.current.y) setCam({ z: 1, x: 0, y: 0, s: seconds });
      return;
    }
    const W = st.clientWidth;
    const H = st.clientHeight;
    const sr = st.getBoundingClientRect();
    const d = sr.width / (W || 1) || 1;
    // All of an item: its words or picture, not the full-width line they
    // sit in (a short line is centred on itself, not on the board's middle).
    let box = target.getBoundingClientRect();
    if (!(move.area && move.area.w > 0)) {
      const range = document.createRange();
      range.selectNodeContents(target);
      const r = range.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) box = r;
    }
    const tr = areaOf(box, move.area);
    const c = camNow.current;
    // Where it is on the board before the current zoom.
    const cx = (((tr.left + tr.width / 2) - sr.left) / d - c.x) / c.z;
    const cy = (((tr.top + tr.height / 2) - sr.top) / d - c.y) / c.z;
    const z = Math.min(3, zoom);
    // Centred on it, letting the view run a quarter past the board's edge:
    // kept strictly inside, items near the top (or a side) all gave the
    // same view, so a second move onto the next line didn't move at all.
    const x = Math.min(W / 4, Math.max(W - z * W - W / 4, W / 2 - z * cx));
    const y = Math.min(H / 4, Math.max(H - z * H - H / 4, H / 2 - z * cy));
    if (Math.abs(x - c.x) > 0.5 || Math.abs(y - c.y) > 0.5 || Math.abs(z - c.z) > 0.01) setCam({ z, x, y, s: seconds });
  }, [camKey, width, scale]); // eslint-disable-line react-hooks/exhaustive-deps

  // The pointer glides to the item's words (under them, pointing up),
  // measured on the board as laid out; it fades when no item is pointed at.
  const [pointer, setPointer] = useState(null);
  useLayoutEffect(() => {
    const layer = camRef.current;
    const host = pointKey && layer ? layer.querySelector(`[data-bp-key="${pointKey}"]`) : null;
    const el = host?.querySelector(":scope > :not([aria-hidden])") || host;
    if (!el) { setPointer((p) => (p?.on ? { ...p, on: false } : p)); return; }
    const range = document.createRange();
    range.selectNodeContents(el);
    let r = range.getBoundingClientRect();
    if (!r.width) r = el.getBoundingClientRect();
    const lr = layer.getBoundingClientRect();
    const k = lr.width / (layer.offsetWidth || 1) || 1;
    setPointer({ x: (r.left + Math.min(r.width / 2, 120 * k) - lr.left) / k, y: (r.bottom - lr.top) / k, on: true });
  }, [pointKey, width, scale, visible.length, cam.z]); // eslint-disable-line react-hooks/exhaustive-deps

  // A recording loads every sound file before it starts: the clock holds
  // still while a file is loading, which shows as a pause in the video.
  const blobUrls = useRef(new Map());
  const srcOf = (u) => blobUrls.current.get(u) || u;
  const preloadAll = useCallback(async () => {
    const urls = [...new Set([...clips.map((c) => c.url), ...spoken.map((x) => x.url)].filter(Boolean))];
    let at = 0;
    const work = async () => {
      while (at < urls.length) {
        const u = urls[at++];
        if (blobUrls.current.has(u)) continue;
        try {
          const r = await fetch(u, { credentials: "include" });
          if (r.ok) blobUrls.current.set(u, URL.createObjectURL(await r.blob()));
        } catch { /* played from its address instead */ }
      }
    };
    await Promise.all([work(), work(), work(), work()]);
  }, [clips, spoken]);
  // Started as soon as a recording player opens, so it's usually done
  // before the recording begins.
  const preloaded = useRef(null);
  useEffect(() => { if (recording) preloaded.current = preloadAll(); }, [recording, preloadAll]);
  useEffect(() => () => { for (const u of blobUrls.current.values()) URL.revokeObjectURL(u); }, []);

  // Audio for the current clip, kept in step with the clock. The next clip's
  // file is fetched ahead, so moving to the next sentence doesn't wait.
  const prefetched = useRef(new Set());
  const syncAudio = useCallback((t, play) => {
    const a = audioRef.current;
    if (!a) return;
    const i = clipAt(t);
    const c = clips[i];
    const next = clips.slice(i + 1).find((x) => x.url);
    if (next && !prefetched.current.has(next.url)) {
      prefetched.current.add(next.url);
      const pre = new Audio();
      pre.preload = "auto";
      pre.src = next.url;
    }
    if (!c?.url) { a.pause(); a.dataset.clip = ""; return; }
    if (a.dataset.clip !== String(i)) {
      if (a.dataset.src !== c.url) { a.src = srcOf(c.url); a.dataset.src = c.url; }
      a.dataset.clip = String(i);
    }
    // A new file resets the speed to the default one, so set both.
    a.defaultPlaybackRate = rateRef.current;
    a.playbackRate = rateRef.current;
    const local = c.from + Math.max(0, t - c.start);
    if (Math.abs(a.currentTime - local) > 0.3) a.currentTime = local;
    if (play) a.play().catch(() => {});
    else a.pause();
  }, [clips, clipAt]);

  // A clip's line: its own audio, started at its time. The recording takes
  // its sound like a clip's (onClipMedia).
  const syncLine = useCallback((t, play) => {
    const a = lineRef.current;
    if (!a) return;
    const x = spokenAt(t);
    if (!x?.url) { if (!a.paused) a.pause(); return; }
    if (a.dataset.src !== x.url) { a.src = srcOf(x.url); a.dataset.src = x.url; }
    a.defaultPlaybackRate = rateRef.current;
    a.playbackRate = rateRef.current;
    const local = t - x.start;
    if (Math.abs(a.currentTime - local) > 0.3) a.currentTime = local;
    if (play) {
      onClipMedia?.(a);
      if (a.paused) a.play().catch(() => {});
    } else if (!a.paused) a.pause();
  }, [spokenAt, onClipMedia]);

  const play = useCallback(() => {
    const base = timeRef.current >= total - 0.05 ? 0 : timeRef.current;
    timeRef.current = base;
    setTime(base);
    clock.current = { base, at: performance.now() };
    setPlaying(true);
  }, [total]);
  const pause = () => setPlaying(false);
  const seek = (t) => {
    const v = Math.min(Math.max(0, t), total);
    setTime(v);
    clock.current = { base: v, at: performance.now() };
    syncAudio(v, playing);
    syncLine(v, playing);
  };

  // The clock: from the voice during a voiced clip, else from time (pauses,
  // silent clips, a clip whose audio failed).
  useEffect(() => {
    if (!playing) { audioRef.current?.pause(); lineRef.current?.pause(); return undefined; }
    syncAudio(timeRef.current, true);
    let raf;
    const tick = () => {
      const a = audioRef.current;
      const i = clipAt(timeRef.current);
      const c = clips[i];
      let t;
      if (c?.url && a && a.dataset.clip === String(i) && !a.error) {
        // Follows the voice; holds still while it is still loading.
        if (a.ended || a.currentTime >= c.to - 0.02) t = c.start + c.dur;
        else if (a.paused || a.readyState < 3) t = timeRef.current;
        else t = c.start + Math.min(Math.max(0, a.currentTime - c.from), c.dur);
        clock.current = { base: t, at: performance.now() };
      } else {
        t = clock.current.base + ((performance.now() - clock.current.at) / 1000) * rateRef.current;
        // A clip still loading holds the clock.
        if (c?.kind === "video") {
          const v = videos.current.get(`${indexAt(c.start)}-${c.item}`);
          if (v && !v.error && v.readyState < 3) { t = timeRef.current; clock.current = { base: t, at: performance.now() }; }
        }
      }
      if (t >= total - 1e-3) {
        setTime(total);
        setPlaying(false);
        onEnded?.();
        return;
      }
      if (clipAt(t) !== i) { clock.current = { base: t, at: performance.now() }; syncAudio(t, true); }
      syncLine(t, true);
      setTime(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, clips, total, syncAudio, syncLine, onEnded, clipAt, indexAt]);

  // Speed: restart the clock from now at the new rate; volume on the voice.
  useEffect(() => {
    rateRef.current = rate;
    clock.current = { base: timeRef.current, at: performance.now() };
    for (const a of [audioRef.current, lineRef.current]) if (a) { a.defaultPlaybackRate = rate; a.playbackRate = rate; }
  }, [rate]);
  useEffect(() => {
    for (const a of [audioRef.current, lineRef.current]) if (a) { a.volume = volume; a.muted = muted; }
  }, [volume, muted]);
  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === wrapRef.current);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  useEffect(() => { onMedia?.({ stage: stageRef.current, audio: audioRef.current }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (autoPlay) play(); }, [autoPlay]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!recording || !startSignal) return;
    (preloaded.current || preloadAll()).then(() => { setTime(0); timeRef.current = 0; play(); });
  }, [startSignal]); // eslint-disable-line react-hooks/exhaustive-deps
  // The editor's "play from here" and "play this part".
  const stopAt = useRef(null);
  useEffect(() => {
    if (!jump || starts[jump.segment] === undefined) return;
    const t = starts[jump.segment];
    stopAt.current = jump.only ? (starts[jump.segment + 1] ?? total) : null;
    timeRef.current = t;
    setTime(t);
    clock.current = { base: t, at: performance.now() };
    if (jump.play) { syncAudio(t, true); setPlaying(true); } else { syncAudio(t, playing); syncLine(t, playing); }
  }, [jump?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (stopAt.current === null) return;
    if (!playing) { stopAt.current = null; return; }
    if (time >= stopAt.current - 0.05) { stopAt.current = null; setPlaying(false); }
  }, [time, playing]);

  if (!segments.length) return null;
  const font = Math.max(11, width / 38);

  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else wrapRef.current?.requestFullscreen?.();
  };
  const toPart = (d) => {
    // Back: the start of this part, or the one before when just started.
    const i = d < 0 && time - starts[segIndex] > 2 ? segIndex : Math.min(segments.length - 1, Math.max(0, segIndex + d));
    seek(starts[i]);
  };
  const setVolume = (v) => changePrefs({ volume: Math.round(Math.min(1, Math.max(0, v)) * 100) / 100, muted: v <= 0 });
  const toggleMute = () => changePrefs({ muted: !muted, volume: !muted || volume > 0 ? volume : 1 });
  const onKey = (e) => {
    if (recording || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = e.target.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    const k = e.key.toLowerCase();
    // Space on a focused button already presses that button.
    if (tag === "BUTTON" && k === " ") return;
    const act = {
      " ": () => (playing ? pause() : play()),
      k: () => (playing ? pause() : play()),
      arrowleft: () => seek(time - 5),
      arrowright: () => seek(time + 5),
      arrowup: () => setVolume((muted ? 0 : volume) + 0.1),
      arrowdown: () => setVolume((muted ? 0 : volume) - 0.1),
      m: toggleMute,
      c: () => setCaptions(!captions),
      f: toggleFull,
    }[k];
    if (!act) return;
    e.preventDefault();
    act();
  };
  const btn = { border: "1px solid rgba(128,128,128,0.4)", background: "transparent", color: "inherit", borderRadius: 6, height: 28, minWidth: 30, padding: "0 6px", cursor: "pointer", fontSize: 12, lineHeight: 1, display: "inline-flex", alignItems: "center", justifyContent: "center" };
  const narrow = width < 520;
  const loud = muted || volume === 0 ? "🔇" : volume < 0.5 ? "🔈" : "🔊";
  const fullWidth = "min(100%, calc((100vh - 90px) * 16 / 9))";

  return (
    <div ref={wrapRef} tabIndex={recording ? undefined : 0} onKeyDown={onKey}
      style={{ width: "100%", userSelect: "none", outline: "none", ...(full ? { background: "#000", color: "#fff", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", padding: 12, boxSizing: "border-box" } : null) }}>
      <style>{`@keyframes bp-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}@keyframes bp-draw{to{stroke-dashoffset:0}}@keyframes bp-fade{to{opacity:1}}@keyframes bp-slide{from{opacity:0;transform:translateX(-1.6em)}to{opacity:1;transform:none}}@keyframes bp-pop{0%{opacity:0;transform:scale(.6)}100%{opacity:1;transform:none}}@keyframes bp-zoom{from{opacity:0;transform:scale(1.3)}to{opacity:1;transform:none}}@keyframes bp-wipe{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}@keyframes bp-reveal{from{clip-path:circle(0% at 30% 50%);filter:grayscale(1)}60%{filter:grayscale(1)}to{clip-path:circle(150% at 30% 50%);filter:none}}@keyframes bp-out{to{opacity:0;transform:translateY(-4px)}}@keyframes bp-pulse{0%,100%{transform:none}50%{transform:scale(1.06)}}@keyframes bp-kb-in{from{transform:scale(1)}to{transform:scale(1.18)}}@keyframes bp-kb-out{from{transform:scale(1.18)}to{transform:scale(1)}}@keyframes bp-kb-left{from{transform:scale(1.12) translateX(4%)}to{transform:scale(1.12) translateX(-4%)}}@keyframes bp-kb-right{from{transform:scale(1.12) translateX(-4%)}to{transform:scale(1.12) translateX(4%)}}@keyframes bp-morph{from{opacity:0;filter:blur(3px);transform:translateY(-0.25em)}to{opacity:1;filter:none;transform:none}}@keyframes bp-sweep{from{background-size:0% 100%}to{background-size:100% 100%}}.bp-math-left .katex-display>.katex{text-align:left}.bp-math-center .katex-display>.katex{text-align:center}.bp-math-right .katex-display>.katex{text-align:right}.bp-hl{color:inherit;background:linear-gradient(${ACCENT}55,${ACCENT}55) no-repeat;background-size:100% 100%;animation:bp-sweep 700ms ease-out 300ms both;border-radius:3px;padding:0 0.1em}`}</style>
      <div
        ref={stageRef}
        onClick={recording ? undefined : () => (playing ? pause() : play())}
        onContextMenu={recording ? undefined : (e) => e.preventDefault()}
        style={{ position: "relative", width: full ? fullWidth : "100%", aspectRatio: "16 / 9", background: BOARD, color: INK, transition: "background-color 600ms ease, color 600ms ease", borderRadius: recording ? 0 : 12, overflow: "hidden", cursor: recording ? "default" : "pointer", fontFamily: "Inter, 'Noto Sans Bengali', system-ui, sans-serif", fontSize: font, boxShadow: recording ? "none" : "inset 0 0 0 1px rgba(0,0,0,0.08)" }}
      >
        <div ref={camRef} style={{ position: "absolute", inset: 0, transformOrigin: "0 0", transform: cam.z === 1 && !cam.x && !cam.y ? "none" : `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})`, transition: `transform ${cam.s}s ease-in-out` }}>
          <div ref={contentRef} style={{ position: "absolute", left: "6%", right: "6%", top: `calc(${(style.logo || style.name) && style.corner[0] === "t" ? "12%" : "6%"} + ${lift}px)`, display: "flex", flexDirection: layout === "split" ? "row" : "column", gap: layout === "split" ? "4%" : undefined, alignItems: layout === "split" ? "flex-start" : undefined, transform: `scale(${scale})`, transformOrigin: "top left", width: `${88 / scale}%` }}>
            {(layout === "split" ? [inFlow.filter((x) => !MEDIA.includes(x.item.type)), inFlow.filter((x) => MEDIA.includes(x.item.type))] : [inFlow]).map((col, ci) => {
              // Items set beside the one above share a row with it. The row
              // is there from its first item on (when the next one is set
              // beside it), so nothing moves house when the rest come in.
              const groups = [];
              col.forEach((x, n) => {
                if (x.item.row && n > 0) groups[groups.length - 1].push(n);
                else groups.push([n]);
              });
              const inRow = new Set();
              for (const g of groups) {
                const [si, ki] = col[g[0]].key.split("-").map(Number);
                const next = (segments[si]?.board || []).slice(ki + 1).find((b) => !UNSHOWN.includes(b.type));
                g.opens = g.length > 1 || Boolean(next?.row);
                if (g.opens) g.forEach((n) => inRow.add(col[n].key));
              }
              const items = col.map(({ item, key, at, times, ghost }) => {
                const gone = removed.get(key);
                const emph = emphasis.get(key);
                const fx = {
                  ...(gone?.exit === "fade" ? { animation: "bp-out 500ms ease-in forwards" } : null),
                  ...(gone && gone.exit !== "fade" ? { opacity: 0.45, transition: "opacity 400ms" } : null),
                  ...(spotlight && spotlight !== key ? { opacity: 0.22, transition: "opacity 400ms" } : null),
                  ...(emph === "pulse" ? { animation: "bp-pulse 900ms ease-in-out 2" } : null),
                };
                const marks = [
                  ...(["underline", "circle", "arrow"].includes(emph) ? [emph] : []),
                  ...(gone && gone.exit !== "fade" ? [gone.exit] : []),
                ];
                return (
                  <div key={key} data-bp-key={key} style={{ position: "relative", display: "flex", flexDirection: "column", ...(inRow.has(key) ? { flex: "0 1 auto", minWidth: 0 } : null) }}>
                    {ghost && freshKeys.has(key) && (
                      <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", animation: "bp-out 450ms ease-in forwards" }}>
                        <Item item={ghost} lesson={lesson} fresh={false} accent={ACCENT} ink={INK} board={BOARD} glow={false} fx={null} now={time} at={0} times={null} clip={null} centered={layout === "center"} />
                      </div>
                    )}
                    <Item item={item} lesson={lesson} fresh={freshKeys.has(key)} accent={ACCENT} ink={INK} board={BOARD} glow={glowKeys.has(key)} onClipMedia={onClipMedia}
                      fx={fx} now={time} at={at} times={times} centered={layout === "center"}
                      typed={typeable(item) ? Math.max(0, Math.floor((time - at) * TYPE_CPS)) : undefined}
                      clip={clipFor(item, key, at)} />
                    {marks.length > 0 && <ItemMarks kinds={marks} color={ACCENT} warm={WARM} />}
                  </div>
                );
              });
              const rowed = groups.flatMap((g) => {
                if (!g.opens) return g.map((n) => items[n]);
                const head = col[g[0]];
                const align = head.item.align || (layout === "center" ? "center" : null);
                return [<div key={`row-${head.key}`} style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", gap: "3%", justifyContent: SELF[align] || "flex-start" }}>{g.map((n) => items[n])}</div>];
              });
              return layout === "split" ? <div key={ci} style={{ flex: ci ? "1 1 0" : "1.2 1 0", minWidth: 0, display: "flex", flexDirection: "column" }}>{rowed}</div> : rowed;
            })}
          </div>
          {pointer && (
            <div aria-hidden style={{ position: "absolute", left: pointer.x, top: pointer.y, width: "1.9em", height: "1.9em", margin: "-0.16em 0 0 -0.16em", opacity: pointer.on ? 1 : 0, transition: "left 700ms cubic-bezier(.4,0,.2,1), top 700ms cubic-bezier(.4,0,.2,1), opacity 300ms", pointerEvents: "none", filter: "drop-shadow(0 0.08em 0.15em rgba(0,0,0,0.3))", zIndex: 2 }}>
              <svg viewBox="0 0 24 24" width="100%" height="100%"><path d="M2 2 L2 19 L7 14.5 L10.5 22 L13.5 20.7 L10 13.3 L16.5 13.3 Z" fill={ACCENT} stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" /></svg>
            </div>
          )}
          {fullNow && (
            // A full-board item: over the whole board until the next item.
            <div data-bp-key={fullNow.key} style={{ position: "absolute", inset: 0, background: BOARD, overflow: "hidden" }}>
              <FullItem item={fullNow.item} lesson={lesson} fresh={freshKeys.has(fullNow.key)} onClipMedia={onClipMedia}
                now={time} at={fullNow.at} times={fullNow.times} clip={clipFor(fullNow.item, fullNow.key, fullNow.at)} />
            </div>
          )}
        </div>
        {(style.logo || style.name) && (
          <div style={{ position: "absolute", [style.corner[0] === "t" ? "top" : "bottom"]: "3.5%", [style.corner[1] === "l" ? "left" : "right"]: "3%", display: "flex", alignItems: "center", gap: "0.4em", opacity: 0.85, pointerEvents: "none", flexDirection: style.corner[1] === "l" ? "row" : "row-reverse" }}>
            {style.logo && <img src={style.logo} alt="" style={{ height: "2.1em", maxWidth: "7em", objectFit: "contain" }} />}
            {style.name && <span style={{ fontSize: "0.72em", fontWeight: 600, color: INK }}>{style.name}</span>}
          </div>
        )}
        {captions && caption && (playing || time > 0) && (
          <div style={{ position: "absolute", left: "5%", right: "5%", bottom: style.corner[0] === "b" && (style.logo || style.name) ? "14%" : "4%", textAlign: "center" }}>
            <span style={{ background: "rgba(20,24,32,0.82)", color: "#fff", padding: "0.25em 0.6em", borderRadius: 6, fontSize: "0.72em", lineHeight: 1.6, boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone" }}>{caption}</span>
          </div>
        )}
        {!recording && <Watermark text={watermark} color={INK} />}
        {!recording && !playing && time === 0 && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: `${BOARD}99` }}>
            <div style={{ width: "3.2em", height: "3.2em", borderRadius: "50%", background: ACCENT, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 6px 20px rgba(0,0,0,0.25)" }}>
              <div style={{ width: 0, height: 0, borderTop: "0.6em solid transparent", borderBottom: "0.6em solid transparent", borderLeft: "0.95em solid #fff", marginLeft: "0.2em" }} />
            </div>
          </div>
        )}
      </div>
      <audio ref={audioRef} preload="auto" style={{ display: "none" }} />
      <audio ref={lineRef} preload="auto" style={{ display: "none" }} />
      {!recording && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, fontSize: 13, flexWrap: "wrap", width: full ? fullWidth : "100%" }}>
          <button type="button" onClick={() => (playing ? pause() : play())} aria-label={playing ? "Pause" : "Play"} title={playing ? "Pause (space)" : "Play (space)"}
            style={{ border: "none", background: ACCENT, color: "#fff", borderRadius: 8, width: 36, height: 30, cursor: "pointer", fontWeight: 700 }}>
            {playing ? "❚❚" : "▶"}
          </button>
          {segments.length > 1 && <button type="button" onClick={() => toPart(-1)} aria-label="Previous part" title="Previous part" style={btn}>⏮</button>}
          <button type="button" onClick={() => seek(time - 10)} aria-label="Back 10 seconds" title="Back 10 s (←: 5 s)" style={btn}>↺10</button>
          <button type="button" onClick={() => seek(time + 10)} aria-label="Forward 10 seconds" title="Forward 10 s (→: 5 s)" style={btn}>10↻</button>
          {segments.length > 1 && <button type="button" onClick={() => toPart(1)} aria-label="Next part" title="Next part" style={btn}>⏭</button>}
          <input type="range" min={0} max={total} step={0.1} value={time} onChange={(e) => seek(Number(e.target.value))} aria-label="Seek"
            style={{ flex: 1, minWidth: narrow ? "100%" : 80, order: narrow ? -1 : 0, accentColor: ACCENT }} />
          <span style={{ fontVariantNumeric: "tabular-nums", opacity: 0.75, minWidth: 82, textAlign: "right" }}>{fmt(time)} / {fmt(total)}</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, marginLeft: narrow ? "auto" : 0 }}>
            <button type="button" onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"} title="Mute (m)" style={{ ...btn, border: "none", minWidth: 24, padding: 0, fontSize: 15 }}>{loud}</button>
            <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} onChange={(e) => setVolume(Number(e.target.value))} aria-label="Volume" title="Volume (up/down keys)"
              style={{ width: 70, accentColor: ACCENT }} />
          </span>
          <select value={rate} onChange={(e) => changePrefs({ rate: Number(e.target.value) })} aria-label="Speed" title="Speed"
            style={{ ...btn, padding: "0 4px", background: full ? "#000" : "transparent", fontWeight: 600 }}>
            {SPEEDS.map((r) => <option key={r} value={r} style={{ color: "#000" }}>{r}×</option>)}
          </select>
          <button type="button" onClick={() => setCaptions(!captions)} aria-pressed={captions} title="Captions (c)"
            style={{ ...btn, border: `1px solid ${captions ? ACCENT : "rgba(128,128,128,0.4)"}`, background: captions ? ACCENT : "transparent", color: captions ? "#fff" : "inherit", fontSize: 11, fontWeight: 700 }}>CC</button>
          <button type="button" onClick={toggleFull} aria-label={full ? "Exit full screen" : "Full screen"} title="Full screen (f)" style={btn}>⛶</button>
        </div>
      )}
    </div>
  );
}
