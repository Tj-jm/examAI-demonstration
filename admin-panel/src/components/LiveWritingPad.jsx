import { useCallback, useEffect, useRef, useState } from "react";
import { useRoomContext, useConnectionState } from "@livekit/components-react";
import { RoomEvent, ConnectionState } from "livekit-client";
import {
  Pen, Highlighter, Eraser, Minus, MoveUpRight, RectangleHorizontal, Circle, Undo2, Redo2, Trash2,
  Plus, ChevronLeft, ChevronRight, EyeOff, X, Square, Rows3, Grid3x3, FileX, Ruler, DraftingCompass, Calculator, Delete,
} from "lucide-react";
import useNoTouchSelect, { NO_TOUCH_SELECT } from "./useNoTouchSelect";
import { evaluate, format } from "./calculator/evaluate";

// The writing pad in the in-app classroom: pages of paper (blank, lined or
// grid) the host writes on with a pen, mouse or stylus while every student
// watches it fill in. Synced over the room's data channel (topic "pad"):
// each stroke is sent as it is drawn, then once more whole when the pen
// lifts. Whoever joins late asks the host for every page; a host who
// rejoins gets the pages back from a student. Plain styles so both apps
// share this file (keep the two copies the same).
//
// A page can also carry a picture (an uploaded image or a screenshot,
// fitted to the page) and a question card (a question from the bank, drawn
// as an image by the host) across its top. Both are image urls each device
// loads for itself; the writing goes on top.
//
// The host also has a ruler and a protractor to lay on the page (a stroke
// started on the ruler's edge runs along it), and a calculator whose
// display sits in the page's corner. Everyone sees them, and the class
// recording does too; they are not part of the saved pages.

export const PAD_W = 1600;
export const PAD_H = 900;
const TOPIC = "pad";
const CHUNK = 12000; // characters per data message, well under LiveKit's limit
const MAX_PTS = 600; // a longer freehand stroke goes on as a new one
const COLORS = ["#111111", "#6b7280", "#1e4fd8", "#0891b2", "#d32f2f", "#db2777", "#2e7d32", "#65a30d", "#7b1fa2", "#ef6c00", "#ca8a04", "#8b4513"];
const WIDTHS = [3, 6, 12];
const FREE = ["pen", "highlighter", "eraser"];
// A line drawn with dots or dashes, for the toolbar.
const LineIcon = ({ dash }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><line x1="2" y1="14" x2="14" y2="2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray={dash} /></svg>
);
const Dotted = () => <LineIcon dash="0.1 3.6" />;
const Dashed = () => <LineIcon dash="4 3" />;
const TOOLS = [
  ["pen", "Pen", Pen], ["highlighter", "Highlighter", Highlighter], ["eraser", "Eraser", Eraser],
  ["line", "Straight line", Minus], ["dotted", "Dotted line", Dotted], ["dashed", "Dashed line", Dashed], ["arrow", "Arrow", MoveUpRight],
  ["rect", "Rectangle", RectangleHorizontal], ["circle", "Circle", Circle],
];
const LINES = ["line", "dotted", "dashed", "arrow"];

// The ruler and protractor, in page units. The ruler's top edge is its
// straight edge; (x, y) is that edge's left end and `a` its angle. The
// protractor's (x, y) is the middle of its base.
const RULER_L = 1000;
const RULER_H = 90;
const PROT_R = 260;
const SNAP = 30; // how close to the ruler's edge a stroke starts to follow it
const HANDLE = 28;
const local = (o, p) => {
  const dx = p[0] - o.x;
  const dy = p[1] - o.y;
  return { along: dx * Math.cos(o.a) + dy * Math.sin(o.a), across: -dx * Math.sin(o.a) + dy * Math.cos(o.a) };
};
const onRulerEdge = (r, p) => {
  if (!r) return null;
  const { along, across } = local(r, p);
  if (along < -SNAP || along > RULER_L + SNAP || across < -SNAP || across > 8) return null;
  const t = Math.min(RULER_L, Math.max(0, along));
  return [Math.round(r.x + t * Math.cos(r.a)), Math.round(r.y + t * Math.sin(r.a))];
};
// What a press at p would grab: an instrument's turn handle or its body.
const grab = (ins, p) => {
  const { ruler, prot } = ins;
  if (ruler) {
    const l = local(ruler, p);
    if (Math.hypot(l.along - RULER_L, l.across - RULER_H / 2) < HANDLE) return { key: "ruler", mode: "turn" };
  }
  if (prot) {
    const l = local(prot, p);
    if (Math.hypot(l.along - (PROT_R + 26), l.across) < HANDLE) return { key: "prot", mode: "turn" };
  }
  if (ruler) {
    const l = local(ruler, p);
    if (l.along >= 0 && l.along <= RULER_L && l.across > 8 && l.across <= RULER_H) return { key: "ruler", mode: "move" };
  }
  if (prot) {
    const l = local(prot, p);
    if (Math.hypot(l.along, l.across) <= PROT_R && l.across <= 6) return { key: "prot", mode: "move" };
  }
  return null;
};

const drawRuler = (ctx, r) => {
  ctx.save();
  ctx.translate(r.x, r.y);
  ctx.rotate(r.a);
  ctx.fillStyle = "rgba(255, 236, 160, 0.8)";
  ctx.strokeStyle = "rgba(120, 100, 20, 0.75)";
  ctx.lineWidth = 2;
  ctx.fillRect(0, 0, RULER_L, RULER_H);
  ctx.strokeRect(0, 0, RULER_L, RULER_H);
  // Millimetre marks, a number every centimetre (100 units).
  ctx.strokeStyle = "rgba(60, 50, 10, 0.85)";
  ctx.fillStyle = "rgba(60, 50, 10, 0.9)";
  ctx.font = "600 17px system-ui, sans-serif";
  ctx.textAlign = "center";
  for (let i = 0; 10 + i * 10 <= RULER_L - 30; i += 1) {
    const x = 10 + i * 10;
    const len = i % 10 === 0 ? 32 : i % 5 === 0 ? 22 : 12;
    ctx.lineWidth = i % 10 === 0 ? 2 : 1.2;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, len); ctx.stroke();
    if (i % 10 === 0) ctx.fillText(String(i / 10), x, len + 18);
  }
  const deg = Math.round((((r.a * 180) / Math.PI) % 360 + 360) % 360);
  ctx.textAlign = "left";
  ctx.fillText(`${deg}°`, 14, RULER_H - 10);
  // The turn handle.
  ctx.beginPath();
  ctx.arc(RULER_L, RULER_H / 2, 17, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "rgba(60, 50, 10, 0.9)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("⟳", RULER_L, RULER_H / 2 + 1);
  ctx.restore();
};

const drawProtractor = (ctx, p) => {
  const R = PROT_R;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.a);
  ctx.beginPath();
  ctx.moveTo(-R, 0);
  ctx.arc(0, 0, R, Math.PI, 0);
  ctx.closePath();
  ctx.fillStyle = "rgba(190, 225, 255, 0.55)";
  ctx.fill();
  ctx.strokeStyle = "rgba(30, 80, 140, 0.85)";
  ctx.lineWidth = 2;
  ctx.stroke();
  // Degree marks: the outer numbers count from the right, the inner from
  // the left.
  ctx.fillStyle = "rgba(20, 60, 110, 0.95)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let d = 0; d <= 180; d += 1) {
    const t = (d * Math.PI) / 180;
    const len = d % 10 === 0 ? 24 : d % 5 === 0 ? 15 : 8;
    const [c, s] = [Math.cos(t), -Math.sin(t)];
    ctx.lineWidth = d % 10 === 0 ? 1.8 : 1;
    ctx.beginPath(); ctx.moveTo(c * R, s * R); ctx.lineTo(c * (R - len), s * (R - len)); ctx.stroke();
    if (d % 10 === 0) {
      ctx.font = "600 15px system-ui, sans-serif";
      ctx.fillText(String(d), c * (R - 40), s * (R - 40));
      ctx.font = "13px system-ui, sans-serif";
      ctx.fillText(String(180 - d), c * (R - 64), s * (R - 64));
    }
  }
  // The centre mark.
  ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(10, 0); ctx.moveTo(0, -10); ctx.lineTo(0, 0); ctx.stroke();
  // The turn handle, past the right end of the base.
  ctx.beginPath();
  ctx.arc(R + 26, 0, 17, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "rgba(20, 60, 110, 0.95)";
  ctx.font = "600 17px system-ui, sans-serif";
  ctx.fillText("⟳", R + 26, 1);
  ctx.restore();
};

// The calculator's display, in the page's top right corner.
const drawCalc = (ctx, c) => {
  const w = 430;
  const x = PAD_W - w - 16;
  const y = 16;
  const hist = (c.hist || []).slice(0, 5);
  const h = 118 + hist.length * 30;
  ctx.save();
  ctx.fillStyle = "rgba(24, 28, 36, 0.92)";
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(x, y, w, h, 14) : ctx.rect(x, y, w, h);
  ctx.fill();
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  const fit = (text, font, max) => {
    ctx.font = font;
    let t = text;
    while (t.length > 1 && ctx.measureText(t).width > max) t = t.slice(1);
    return t === text ? t : `…${t.slice(1)}`;
  };
  let ty = y + 30;
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  for (const line of hist) {
    ctx.fillText(fit(`${line.expr} = ${format(line.v)}`, "20px ui-monospace, monospace", w - 32), x + w - 16, ty);
    ty += 30;
  }
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.textAlign = "left";
  ctx.font = "600 15px system-ui, sans-serif";
  ctx.fillText(c.deg === false ? "RAD" : "DEG", x + 16, y + 26);
  ctx.textAlign = "right";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(fit(c.expr || "0", "30px ui-monospace, monospace", w - 32), x + w - 16, ty + 14);
  ctx.fillStyle = c.err ? "#fca5a5" : "#86efac";
  const out = c.err ? c.err : c.out != null ? `= ${format(c.out)}` : "";
  ctx.fillText(fit(out, `600 ${c.err ? 22 : 36}px ui-monospace, monospace`, w - 32), x + w - 16, ty + 62);
  ctx.restore();
};

const PAPERS = [["blank", "Blank", Square], ["lined", "Lined", Rows3], ["grid", "Grid", Grid3x3]];

const enc = new TextEncoder();
const dec = new TextDecoder();
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const newPage = (paper = "lined") => ({ id: uid(), paper, strokes: [] });

const roleOf = (p) => {
  try {
    return JSON.parse(p?.metadata || "{}").role || "";
  } catch {
    return "";
  }
};

// Splits a list of strokes into messages small enough to send.
const chunks = (list) => {
  const out = [];
  let batch = [];
  let size = 0;
  for (const s of list) {
    const n = JSON.stringify(s).length;
    if (batch.length && size + n > CHUNK) {
      out.push(batch);
      batch = [];
      size = 0;
    }
    batch.push(s);
    size += n;
  }
  out.push(batch);
  return out;
};

// The paper itself, drawn under the ink.
const drawPaper = (ctx, paper) => {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, PAD_W, PAD_H);
  if (paper === "blank") return;
  ctx.lineWidth = 2;
  if (paper === "grid") {
    ctx.strokeStyle = "#e1e6ee";
    for (let x = 50; x < PAD_W; x += 50) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, PAD_H); ctx.stroke(); }
    for (let y = 50; y < PAD_H; y += 50) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(PAD_W, y); ctx.stroke(); }
    return;
  }
  ctx.strokeStyle = "#cfd8e6";
  for (let y = 110; y < PAD_H; y += 56) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(PAD_W, y); ctx.stroke(); }
  ctx.strokeStyle = "#f2b8b8";
  ctx.beginPath(); ctx.moveTo(110, 0); ctx.lineTo(110, PAD_H); ctx.stroke();
};

// Pictures for pages, loaded once per url. Read as a blob where the server
// allows it, so the page can still be recorded and saved; otherwise as a
// plain image (shows, but may block saving).
const images = new Map();
const blobImage = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(); return r.blob(); }).then((b) => createImageBitmap(b));
const plainImage = (url, cors) => new Promise((ok, fail) => {
  const img = new Image();
  if (cors) img.crossOrigin = "anonymous";
  img.onload = () => ok(img);
  img.onerror = fail;
  img.src = url;
});
export const padImage = (url) => {
  if (!images.has(url)) {
    images.set(url, blobImage(url).catch(() => plainImage(url, true)).catch(() => plainImage(url, false)).catch(() => { images.delete(url); return null; }));
  }
  return images.get(url);
};

// Where a page's question card and picture go, in page units.
const cardBox = (img) => {
  const s = Math.min(1, (PAD_W - 120) / img.width, (PAD_H * 0.55) / img.height);
  return { x: 60, y: 28, w: img.width * s, h: img.height * s };
};
// The paper, then the question card, then the picture fitted below it.
const paintPage = async (ctx, page, stale) => {
  drawPaper(ctx, page?.paper || "blank");
  if (!page || (!page.q && !page.bg)) return;
  const [card, pic] = await Promise.all([page.q ? padImage(page.q) : null, page.bg ? padImage(page.bg) : null]);
  if (stale()) return;
  let top = 0;
  if (card) {
    const b = cardBox(card);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(b.x - 12, b.y - 10, b.w + 24, b.h + 20);
    ctx.strokeStyle = "#c7d0dd";
    ctx.lineWidth = 2;
    ctx.strokeRect(b.x - 12, b.y - 10, b.w + 24, b.h + 20);
    ctx.drawImage(card, b.x, b.y, b.w, b.h);
    top = b.y + b.h + 24;
  }
  if (pic) {
    const room = { x: 30, y: top + 10, w: PAD_W - 60, h: PAD_H - top - 30 };
    if (room.h < 60) return;
    const s = Math.min(room.w / pic.width, room.h / pic.height);
    const w = pic.width * s;
    const h = pic.height * s;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(room.x + (room.w - w) / 2, room.y, w, h);
    ctx.drawImage(pic, room.x + (room.w - w) / 2, room.y, w, h);
  }
};

// A page as one JPEG (paper, question card, picture, writing), for saving.
// Throws if a picture the server wouldn't share has locked the canvas.
export const pageImage = async (page) => {
  const c = document.createElement("canvas");
  c.width = PAD_W;
  c.height = PAD_H;
  await paintPage(c.getContext("2d"), page, () => false);
  const ink = document.createElement("canvas");
  ink.width = PAD_W;
  ink.height = PAD_H;
  const ictx = ink.getContext("2d");
  for (const s of page.strokes) drawStroke(ictx, s);
  c.getContext("2d").drawImage(ink, 0, 0);
  const blob = await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.88));
  if (!blob) throw new Error("The page couldn't be saved as an image.");
  return blob;
};

// One stroke: points are [x, y] in page units. Shapes use the first and
// last point.
const drawStroke = (ctx, s) => {
  const pts = s.pts;
  if (!pts?.length) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = s.color;
  ctx.lineWidth = s.tool === "highlighter" ? s.w * 4 : s.tool === "eraser" ? s.w * 5 : s.w;
  if (s.tool === "highlighter") ctx.globalAlpha = 0.35;
  if (s.tool === "eraser") ctx.globalCompositeOperation = "destination-out";
  const [a, b] = [pts[0], pts[pts.length - 1]];
  ctx.beginPath();
  if (FREE.includes(s.tool)) {
    // Smoothed through the midpoints between samples.
    ctx.moveTo(a[0], a[1]);
    if (pts.length === 1) ctx.lineTo(a[0] + 0.1, a[1]);
    for (let i = 1; i < pts.length - 1; i += 1) {
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
    }
    if (pts.length > 1) ctx.lineTo(b[0], b[1]);
  } else if (LINES.includes(s.tool)) {
    if (s.tool === "dotted") ctx.setLineDash([0.1, s.w * 2.6 + 4]);
    if (s.tool === "dashed") ctx.setLineDash([s.w * 4 + 8, s.w * 3 + 6]);
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    if (s.tool === "arrow") {
      const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const head = 18 + s.w * 2.5;
      for (const side of [-1, 1]) {
        ctx.moveTo(b[0], b[1]);
        ctx.lineTo(b[0] - head * Math.cos(angle + side * 0.45), b[1] - head * Math.sin(angle + side * 0.45));
      }
    }
  } else if (s.tool === "rect") {
    ctx.rect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
  } else if (s.tool === "circle") {
    ctx.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2 || 0.5, Math.abs(b[1] - a[1]) / 2 || 0.5, 0, 0, Math.PI * 2);
  }
  ctx.stroke();
  ctx.restore();
};

export function useWritingPad({ isHost }) {
  const room = useRoomContext();
  const connection = useConnectionState();
  // The pages, with their strokes. The host starts with one blank page;
  // students get theirs from the host.
  const pages = useRef(isHost ? [newPage()] : []);
  const [ui, setUi] = useState({ open: false, cur: isHost ? pages.current[0].id : null });
  const uiRef = useRef(ui);
  uiRef.current = ui;
  // Bumped whenever the current page must be drawn again from scratch.
  const [rev, setRev] = useState(0);
  const redraw = () => setRev((n) => n + 1);
  const live = useRef(new Map()); // stroke id -> the stroke still being drawn (students)
  const done = useRef(new Set()); // strokes already finished, so a late progress message is ignored
  const redo = useRef(new Map()); // page id -> strokes taken back (host)
  const stash = useRef(new Map()); // page id -> strokes a clear removed, for undo (host)
  const layerBack = useRef(new Map()); // page id -> { key, url } an undo took off, for redo (host)
  const view = useRef(null); // set by the sheet on screen: { add, live }
  // The pad on screen, for the recording feed (LiveBoardFeed.js).
  const [box, boxRef] = useState(null);

  const [, setTick] = useState(0);
  const bumpTools = () => setTick((n) => n + 1);

  // The ruler and protractor ({ x, y, a } or null), and the calculator.
  const [ins, setIns] = useState({ ruler: null, prot: null });
  const insRef = useRef(ins);
  insRef.current = ins;
  const [calc, setCalcState] = useState({ open: false, expr: "", out: null, err: "", deg: true, hist: [] });
  const calcRef = useRef(calc);
  calcRef.current = calc;

  // Counts the host's changes, so unsaved work can be noticed.
  const changes = useRef(0);
  const touched = () => { changes.current += 1; };

  const pageOf = (id) => pages.current.find((p) => p.id === id);

  const publish = useCallback((obj, to) => {
    room.localParticipant
      .publishData(enc.encode(JSON.stringify(obj)), { reliable: true, topic: TOPIC, ...(to ? { destinationIdentities: to } : {}) })
      .catch(() => {});
  }, [room]);

  const stateMsg = (t = "st") => ({
    t, open: uiRef.current.open, cur: uiRef.current.cur, ins: insRef.current, calc: calcRef.current,
    pages: pages.current.map((p) => ({ id: p.id, paper: p.paper, ...(p.bg ? { bg: p.bg } : {}), ...(p.q ? { q: p.q } : {}) })),
  });
  const sendPage = (p, to, r) => chunks(p.strokes).forEach((ss, i) => publish({ t: "sk", pg: p.id, ss, first: i === 0, ...(r ? { r: true } : {}) }, to));
  const sendAll = (to, r) => pages.current.forEach((p) => sendPage(p, to, r));

  // Takes the host's list of pages, keeping the strokes already here.
  const applyState = (d) => {
    pages.current = (d.pages || []).map((m) => {
      const have = pageOf(m.id);
      return { id: m.id, paper: m.paper, bg: m.bg || null, q: m.q || null, strokes: have ? have.strokes : [] };
    });
    setUi({ open: Boolean(d.open), cur: d.cur });
    if (d.ins) setIns({ ruler: d.ins.ruler || null, prot: d.ins.prot || null });
    if (d.calc) setCalcState(d.calc);
    redraw();
  };

  const synced = useRef(false);
  const recovered = useRef(false);
  const onData = useRef(null);
  onData.current = (payload, from, topic) => {
    if (topic !== TOPIC) return;
    let d;
    try {
      d = JSON.parse(dec.decode(payload));
    } catch {
      return;
    }
    const fromHost = roleOf(from) === "host";
    if (isHost) {
      const asker = from?.identity || d.id;
      if (d.t === "hello" && asker) {
        // Someone joined late: send them the pad as it is. (A brand-new
        // participant may not be known yet, so the request names itself.)
        publish(stateMsg(), [asker]);
        sendAll([asker]);
      }
      // A student handing back the pad after this host rejoined. Taken only
      // while nothing has been written here yet.
      if (d.t === "rst" && !recovered.current && pages.current.every((p) => !p.strokes.length)) {
        recovered.current = true;
        applyState(d);
      }
      if (d.t === "sk" && d.r && recovered.current) {
        const p = pageOf(d.pg);
        if (p) { p.strokes = d.first ? d.ss : [...p.strokes, ...d.ss]; redraw(); }
      }
      return;
    }
    if (!fromHost) return;
    if (d.t === "st") {
      synced.current = true;
      applyState(d);
    } else if (d.t === "recover" && from?.identity) {
      // The host rejoined and lost the pad: hand it back.
      if (!pages.current.length) return;
      publish(stateMsg("rst"), [from.identity]);
      sendAll([from.identity], true);
    } else if (d.t === "sp") {
      if (done.current.has(d.s.id)) return;
      const s = live.current.get(d.s.id) || { ...d.s, pg: d.pg, pts: [] };
      s.pts = d.rep ? d.pts : [...s.pts, ...d.pts];
      live.current.set(d.s.id, s);
      if (d.pg === uiRef.current.cur) view.current?.live();
    } else if (d.t === "sc") {
      live.current.delete(d.s.id);
      done.current.add(d.s.id);
      const p = pageOf(d.pg);
      if (!p || p.strokes.some((x) => x.id === d.s.id)) return;
      p.strokes.push(d.s);
      if (d.pg === uiRef.current.cur) { view.current?.add(d.s); view.current?.live(); }
    } else if (d.t === "un") {
      const p = pageOf(d.pg);
      if (p) { p.strokes = p.strokes.filter((x) => x.id !== d.id); if (d.pg === uiRef.current.cur) redraw(); }
    } else if (d.t === "cl") {
      const p = pageOf(d.pg);
      if (p) { p.strokes = []; if (d.pg === uiRef.current.cur) redraw(); }
    } else if (d.t === "sk") {
      const p = pageOf(d.pg);
      if (p) { p.strokes = d.first ? d.ss : [...p.strokes, ...d.ss]; if (d.pg === uiRef.current.cur) redraw(); }
    } else if (d.t === "in") {
      setIns({ ruler: d.ruler || null, prot: d.prot || null });
    } else if (d.t === "ca") {
      setCalcState(d.c);
    }
  };
  useEffect(() => {
    const handler = (payload, participant, kind, topic) => onData.current(payload, participant, topic);
    room.on(RoomEvent.DataReceived, handler);
    return () => { room.off(RoomEvent.DataReceived, handler); };
  }, [room]);

  // Students ask for the pad once connected, and keep asking for a little
  // while until the host answers (the host may still be joining too).
  useEffect(() => {
    if (isHost || connection !== ConnectionState.Connected) return undefined;
    synced.current = false;
    let tries = 0;
    let timer;
    const ask = () => {
      if (synced.current || tries >= 8) return;
      tries += 1;
      publish({ t: "hello", id: room.localParticipant.identity });
      timer = setTimeout(ask, 2000);
    };
    timer = setTimeout(ask, 600);
    return () => clearTimeout(timer);
  }, [isHost, connection, publish, room]);

  // Host: once connected, ask one student for the pad in case this is a
  // rejoin. Nobody has one on a fresh start, and nothing happens.
  useEffect(() => {
    if (!isHost || connection !== ConnectionState.Connected) return undefined;
    let tries = 0;
    let timer;
    const ask = () => {
      if (recovered.current || tries >= 3) return;
      const students = [...room.remoteParticipants.values()].filter((p) => roleOf(p) !== "host").map((p) => p.identity).sort();
      const who = students[tries];
      tries += 1;
      if (who) publish({ t: "recover" }, [who]);
      timer = setTimeout(ask, 2500);
    };
    timer = setTimeout(ask, 1300);
    return () => clearTimeout(timer);
  }, [isHost, connection, publish, room]);

  // ---- host actions ----
  const share = (next) => {
    touched();
    uiRef.current = { ...uiRef.current, ...next };
    setUi(uiRef.current);
    publish(stateMsg());
  };
  const setOpen = (open) => share({ open });
  const go = (id) => { if (pageOf(id)) { share({ cur: id }); redraw(); } };
  const addPage = () => {
    const cur = pageOf(uiRef.current.cur);
    const p = newPage(cur?.paper || "lined");
    const at = pages.current.indexOf(cur);
    pages.current.splice(at + 1, 0, p);
    go(p.id);
  };
  const deletePage = () => {
    if (pages.current.length <= 1) return;
    const at = pages.current.findIndex((p) => p.id === uiRef.current.cur);
    pages.current.splice(at, 1);
    go(pages.current[Math.max(0, at - 1)].id);
  };
  const setPaper = (paper) => {
    const p = pageOf(uiRef.current.cur);
    if (!p || p.paper === paper) return;
    p.paper = paper;
    share({});
    redraw();
  };

  // A picture or question card ({ bg: url } or { q: url }) goes on the
  // current page while it is still empty, else on a new page after it.
  const place = (layer) => {
    const cur = pageOf(uiRef.current.cur);
    const empty = cur && !cur.strokes.length && !cur.bg && !cur.q;
    if (empty) {
      layerBack.current.delete(cur.id);
      Object.assign(cur, layer);
      share({});
      redraw();
      return;
    }
    const p = { ...newPage(cur?.paper || "lined"), ...layer };
    pages.current.splice(pages.current.indexOf(cur) + 1, 0, p);
    go(p.id);
  };
  // Takes the picture or question card off the current page.
  const removeLayer = (key) => {
    const cur = pageOf(uiRef.current.cur);
    if (!cur?.[key]) return;
    cur[key] = null;
    share({});
    redraw();
  };

  // The instruments and calculator go out at most every 50 ms while they
  // change (a ruler being dragged), the last state always.
  const later = useRef({});
  const soon = (key, send) => {
    if (later.current[key]) return;
    later.current[key] = setTimeout(() => { later.current[key] = null; send(); }, 50);
  };
  const setInstrument = (key, val) => {
    insRef.current = { ...insRef.current, [key]: val };
    setIns(insRef.current);
    soon("in", () => publish({ t: "in", ...insRef.current }));
  };
  const setCalc = (next) => {
    calcRef.current = { ...calcRef.current, ...next };
    setCalcState(calcRef.current);
    soon("ca", () => publish({ t: "ca", c: calcRef.current }));
  };

  // Progress of the stroke being drawn, sent every 60 ms.
  const buf = useRef(null);
  const flushTimer = useRef(null);
  const flush = () => {
    flushTimer.current = null;
    const b = buf.current;
    if (!b || !b.pts.length) return;
    const { s, pg, rep } = b;
    publish({ t: "sp", pg, s: { id: s.id, tool: s.tool, color: s.color, w: s.w }, pts: b.pts, ...(rep ? { rep: true } : {}) });
    buf.current = { ...b, pts: [] };
  };
  const progress = (s, pts, rep = false) => {
    const pg = uiRef.current.cur;
    if (!buf.current || buf.current.s.id !== s.id) buf.current = { s, pg, pts: [], rep };
    buf.current.pts = rep ? pts : [...buf.current.pts, ...pts];
    if (!flushTimer.current) flushTimer.current = setTimeout(flush, 60);
  };
  const commit = (s) => {
    clearTimeout(flushTimer.current);
    flushTimer.current = null;
    buf.current = null;
    const p = pageOf(uiRef.current.cur);
    if (!p) return;
    p.strokes.push(s);
    touched();
    redo.current.delete(p.id);
    stash.current.delete(p.id);
    layerBack.current.delete(p.id);
    publish({ t: "sc", pg: p.id, s });
    bumpTools(); // no redraw: the sheet already drew it
  };
  const undo = () => {
    const p = pageOf(uiRef.current.cur);
    if (!p) return;
    if (!p.strokes.length && stash.current.has(p.id)) {
      // Undoing a clear brings the page back.
      p.strokes = stash.current.get(p.id);
      stash.current.delete(p.id);
      touched();
      sendPage(p);
      redraw();
      return;
    }
    const s = p.strokes.pop();
    if (!s) {
      // Nothing written left: undo takes off the picture or question card
      // (placed only on an empty page, so it came before the writing).
      const key = p.bg ? "bg" : p.q ? "q" : null;
      if (!key) return;
      layerBack.current.set(p.id, { key, url: p[key] });
      removeLayer(key);
      return;
    }
    touched();
    redo.current.set(p.id, [...(redo.current.get(p.id) || []), s]);
    publish({ t: "un", pg: p.id, id: s.id });
    redraw();
  };
  const redoStroke = () => {
    const p = pageOf(uiRef.current.cur);
    const back = p && layerBack.current.get(p.id);
    if (back && !p.strokes.length && !p[back.key]) {
      // The picture first: it was there before the writing.
      layerBack.current.delete(p.id);
      p[back.key] = back.url;
      share({});
      redraw();
      return;
    }
    const list = p && redo.current.get(p.id);
    if (!list?.length) return;
    const s = list.pop();
    p.strokes.push(s);
    touched();
    publish({ t: "sc", pg: p.id, s });
    redraw();
  };
  const clearPage = () => {
    const p = pageOf(uiRef.current.cur);
    if (!p || !p.strokes.length) return;
    stash.current.set(p.id, p.strokes);
    touched();
    redo.current.delete(p.id);
    p.strokes = [];
    publish({ t: "cl", pg: p.id });
    redraw();
  };

  const current = pageOf(ui.cur);
  return {
    ui, rev, room, box, boxRef, view, live, pages, changes,
    // Pages with anything on them.
    used: () => pages.current.filter((p) => p.strokes.length || p.bg || p.q),
    current, index: pages.current.indexOf(current), count: pages.current.length,
    canUndo: Boolean(current && (current.strokes.length || stash.current.has(current.id) || current.bg || current.q)),
    canRedo: Boolean(current && (redo.current.get(current.id)?.length || layerBack.current.has(current.id))),
    setOpen, go, addPage, deletePage, setPaper, place, removeLayer, progress, commit, undo, redo: redoStroke, clearPage,
    ins, setInstrument, calc, setCalc,
  };
}

// A toolbar button's look (also for buttons passed in as `tools`).
export const btn = (on) => ({
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4, minWidth: 30, height: 30, padding: "0 7px",
  borderRadius: 8, border: "1px solid", borderColor: on ? "#2fa58e" : "rgba(255,255,255,0.18)", cursor: "pointer",
  background: on ? "rgba(47,165,142,0.3)" : "transparent", color: on ? "#e6fff9" : "rgba(255,255,255,0.85)", font: "inherit", fontSize: 12.5, whiteSpace: "nowrap",
});
const group = { display: "inline-flex", alignItems: "center", gap: 5, flexWrap: "nowrap" };
const sep = <span style={{ width: 1, alignSelf: "stretch", background: "rgba(255,255,255,0.15)", margin: "0 2px" }} />;

// The host's calculator keys. The display is drawn on the page (drawCalc),
// so the class sees each key as it is pressed.
const KEYS = [
  ["2nd", "DEG", "(", ")", "⌫"],
  ["sin", "cos", "tan", "π", "C"],
  ["log", "ln", "√", "x²", "xʸ"],
  ["7", "8", "9", "÷", "n!"],
  ["4", "5", "6", "×", "%"],
  ["1", "2", "3", "-", "e"],
  ["0", ".", "ANS", "+", "="],
];
const INS = { sin: "sin(", cos: "cos(", tan: "tan(", log: "log(", ln: "ln(", "√": "√(", "x²": "^2", "xʸ": "^", "n!": "!" };
// What a key does after 2nd, and its label then.
const ALT = { sin: ["sin⁻¹", "asin("], cos: ["cos⁻¹", "acos("], tan: ["tan⁻¹", "atan("], log: ["10ˣ", "10^("], ln: ["eˣ", "e^("], "√": ["∛", "cbrt("], "x²": ["x³", "^3"] };
const PIECES = ["asin(", "acos(", "atan(", "sin(", "cos(", "tan(", "log(", "ln(", "cbrt(", "√(", "10^(", "e^(", "ANS"];
export function calcPress(c, key, second = false) {
  if (key === "C") return { expr: "", out: null, err: "" };
  if (key === "DEG") return { deg: !c.deg };
  if (key === "⌫") {
    const piece = PIECES.find((x) => c.expr.endsWith(x));
    return { expr: piece ? c.expr.slice(0, -piece.length) : c.expr.slice(0, -1), out: null, err: "" };
  }
  if (key === "=") {
    if (!c.expr) return {};
    try {
      const v = evaluate(c.expr, { deg: c.deg !== false, ans: c.ans || 0 });
      if (v === null) return {};
      return { out: v, ans: v, err: "", done: true, hist: [{ expr: c.expr, v }, ...(c.hist || [])].slice(0, 5) };
    } catch (e) {
      return { err: e.message || "Check the expression" };
    }
  }
  const ins = (second && ALT[key]?.[1]) || INS[key] || key;
  const op = "+-×÷".includes(ins) || /^[\^!%]/.test(ins);
  // After =, an operator carries on from the answer; anything else starts afresh.
  if (c.done) return { expr: (op ? format(c.out) : "") + ins, out: null, err: "", done: false };
  return { expr: c.expr + ins, out: null, err: "", done: false };
}

function CalcPad({ pad }) {
  const c = pad.calc;
  const [second, setSecond] = useState(false);
  const press = (key) => {
    if (key === "2nd") { setSecond(!second); return; }
    pad.setCalc(calcPress(c, key, second && Boolean(ALT[key])));
    if (ALT[key]) setSecond(false);
  };
  const pressRef = useRef(press);
  pressRef.current = press;
  // Dragged by its title bar, so it never sits on what's being written.
  const [pos, setPos] = useState(null); // { left, top } in the pad area
  const boxRef = useRef(null);
  const dragRef = useRef(null);
  const dragDown = (e) => {
    if (e.target.closest("button")) return;
    const el = boxRef.current;
    const area = el.offsetParent.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    dragRef.current = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top, area, w: r.width, h: r.height };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const dragMove = (e) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    setPos({
      left: Math.min(Math.max(0, e.clientX - d.area.left - d.dx), d.area.width - d.w),
      top: Math.min(Math.max(0, e.clientY - d.area.top - d.dy), d.area.height - d.h),
    });
  };
  const dragUp = (e) => { if (dragRef.current?.id === e.pointerId) dragRef.current = null; };
  // A physical keyboard too, while no text field has the focus.
  useEffect(() => {
    const map = { "*": "×", "/": "÷", x: "×", Enter: "=", "=": "=", Backspace: "⌫", Escape: "C" };
    const onKey = (e) => {
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const k = map[e.key] || (/^[0-9.+\-^()!%e]$/.test(e.key) ? (e.key === "!" ? "n!" : e.key === "^" ? "xʸ" : e.key) : null);
      if (!k) return;
      e.preventDefault();
      pressRef.current(k);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div ref={boxRef} style={{ ...NO_TOUCH_SELECT, position: "absolute", ...(pos || { right: 8, bottom: 8 }), zIndex: 3, width: 232, padding: 8, borderRadius: 12, background: "rgba(20,22,26,0.94)", color: "#fff", boxShadow: "0 8px 24px rgba(0,0,0,0.3)" }}>
      <div onPointerDown={dragDown} onPointerMove={dragMove} onPointerUp={dragUp} onPointerCancel={dragUp} title="Drag to move"
        style={{ display: "flex", alignItems: "center", marginBottom: 6, fontSize: 12, opacity: 0.8, cursor: "move", touchAction: "none" }}>
        <Calculator size={13} style={{ marginRight: 5 }} /> Calculator <span style={{ flex: 1 }} />
        <button type="button" aria-label="Close the calculator" style={{ ...btn(false), height: 24, minWidth: 24, padding: 0 }} onClick={() => pad.setCalc({ open: false })}><X size={13} /></button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 4 }}>
        {KEYS.flat().map((k) => (
          <button key={k} type="button" onClick={() => press(k)}
            style={{ ...btn(k === "=" || (k === "DEG" && c.deg === false) || (k === "2nd" && second)), height: 32, minWidth: 0, padding: 0, fontSize: k.length > 2 ? 11.5 : 14, fontWeight: /\d|\./.test(k) && k.length === 1 ? 600 : 400, background: k === "=" ? "#2fa58e" : /^[0-9.]$/.test(k) ? "rgba(255,255,255,0.1)" : "transparent" }}>
            {k === "⌫" ? <Delete size={14} /> : k === "DEG" ? (c.deg === false ? "RAD" : "DEG") : second && ALT[k] ? ALT[k][0] : k}
          </button>
        ))}
      </div>
    </div>
  );
}

// The colour in use, and a palette under it: twelve inks and any other.
function ColourPick({ color, onPick }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const off = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("pointerdown", off, true);
    return () => document.removeEventListener("pointerdown", off, true);
  }, [open]);
  return (
    <span ref={ref} style={{ position: "relative", display: "inline-flex" }}>
      <button type="button" title="Ink colour" aria-label="Ink colour" style={btn(open)} onClick={() => setOpen(!open)}>
        <span style={{ width: 18, height: 18, borderRadius: "50%", background: color, border: "2px solid #fff" }} />
      </button>
      {open && (
        <div style={{ position: "absolute", top: 36, left: 0, zIndex: 20, padding: 8, borderRadius: 10, background: "rgba(20,22,26,0.97)", boxShadow: "0 8px 24px rgba(0,0,0,0.35)", display: "grid", gridTemplateColumns: "repeat(6, 24px)", gap: 6 }}>
          {COLORS.map((c) => (
            <button key={c} type="button" title={c} aria-label={`Colour ${c}`} onClick={() => { onPick(c); setOpen(false); }}
              style={{ width: 24, height: 24, borderRadius: "50%", background: c, cursor: "pointer", padding: 0, border: color === c ? "2px solid #fff" : "2px solid transparent", boxShadow: color === c ? "0 0 0 2px #2fa58e" : "none" }} />
          ))}
          <label title="Any colour" style={{ gridColumn: "span 6", display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "rgba(255,255,255,0.85)", cursor: "pointer", marginTop: 2 }}>
            <input type="color" value={color} onChange={(e) => onPick(e.target.value)} style={{ width: 28, height: 24, padding: 0, border: "none", background: "transparent", cursor: "pointer" }} />
            Any colour…
          </label>
        </div>
      )}
    </span>
  );
}

// The pad over the stage, when open. `hidden` lets someone look at the
// video instead without closing it for everyone. `confirm` (host) asks
// before a page is deleted; without it pages can't be deleted.
// `tools` (host): more buttons for the toolbar (the admin's picture and
// question importer).
export default function LiveWritingPad({ pad, isHost, hidden, confirm, onHide, tools }) {
  const [tool, setTool] = useState("pen");
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(WIDTHS[0]);
  const wrapRef = useRef(null);
  const sheetRef = useRef(null);
  const paperRef = useRef(null);
  const inkRef = useRef(null);
  const liveRef = useRef(null);
  const toolRef = useRef(null);
  const drag = useRef(null);
  const stroke = useRef(null);
  const penSeen = useRef(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const shown = pad.ui.open && !hidden;
  useNoTouchSelect(sheetRef, shown && isHost);

  // The page keeps 16:9 inside whatever room the stage leaves.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const fit = () => {
      const r = el.getBoundingClientRect();
      const w = Math.min(r.width, (r.height * PAD_W) / PAD_H);
      setSize({ w: Math.floor(w), h: Math.floor((w * PAD_H) / PAD_W) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [shown]);

  const page = pad.current;
  const drawLive = useCallback(() => {
    const ctx = liveRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, PAD_W, PAD_H);
    const ink = inkRef.current?.getContext("2d");
    for (const s of pad.live.current.values()) {
      if (s.pg !== pad.ui.cur) continue;
      // Erasing twice is harmless, so the eraser works on the ink as it goes.
      if (s.tool === "eraser") { if (ink) drawStroke(ink, s); } else drawStroke(ctx, s);
    }
  }, [pad.live, pad.ui.cur]);

  useEffect(() => {
    pad.view.current = { add: (s) => { const ink = inkRef.current?.getContext("2d"); if (ink) drawStroke(ink, s); }, live: drawLive };
    return () => { pad.view.current = null; };
  }, [pad.view, drawLive]);

  // The whole page again: paper, every stroke, anything still being drawn.
  const painted = useRef(0);
  useEffect(() => {
    const paper = paperRef.current?.getContext("2d");
    const ink = inkRef.current?.getContext("2d");
    if (!paper || !ink) return;
    const n = (painted.current += 1);
    paintPage(paper, page, () => n !== painted.current);
    ink.clearRect(0, 0, PAD_W, PAD_H);
    for (const s of page?.strokes || []) drawStroke(ink, s);
    drawLive();
  }, [page, page?.paper, page?.bg, page?.q, pad.rev, shown, drawLive]);

  // The ruler, protractor and calculator display, on their own layer.
  useEffect(() => {
    const ctx = toolRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, PAD_W, PAD_H);
    if (pad.ins.prot) drawProtractor(ctx, pad.ins.prot);
    if (pad.ins.ruler) drawRuler(ctx, pad.ins.ruler);
    if (pad.calc.open) drawCalc(ctx, pad.calc);
  }, [pad.ins, pad.calc, shown]);

  const toggleInstrument = (key) => {
    if (pad.ins[key]) { pad.setInstrument(key, null); return; }
    pad.setInstrument(key, key === "ruler" ? { x: (PAD_W - RULER_L) / 2, y: PAD_H * 0.55, a: 0 } : { x: PAD_W / 2, y: PAD_H * 0.62, a: 0 });
  };

  const point = (e) => {
    const r = liveRef.current.getBoundingClientRect();
    return [Math.round(((e.clientX - r.left) / r.width) * PAD_W), Math.round(((e.clientY - r.top) / r.height) * PAD_H)];
  };

  const begin = (pt, edge = false) => {
    stroke.current = { edge, s: { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, tool, color, w: width, pts: [pt] } };
    pad.progress(stroke.current.s, [pt], edge || !FREE.includes(tool));
  };
  const finish = () => {
    const cur = stroke.current;
    if (!cur) return;
    stroke.current = null;
    const s = cur.s;
    if ((cur.edge || !FREE.includes(s.tool)) && s.pts.length < 2) s.pts = [s.pts[0], s.pts[0]];
    const ink = inkRef.current.getContext("2d");
    drawStroke(ink, s);
    liveRef.current.getContext("2d").clearRect(0, 0, PAD_W, PAD_H);
    pad.commit(s);
  };

  const down = (e) => {
    e.preventDefault();
    if (e.pointerType === "pen") penSeen.current = true;
    // Once a stylus is in use, a finger or resting palm draws nothing.
    if (e.pointerType === "touch" && penSeen.current) return;
    if (e.button > 0 || stroke.current || drag.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt = point(e);
    // Moving or turning the ruler or protractor.
    const hit = grab(pad.ins, pt);
    if (hit) {
      const from = pad.ins[hit.key];
      drag.current = { ...hit, pointer: e.pointerId, start: pt, from, turn0: from.a - Math.atan2(pt[1] - from.y, pt[0] - from.x) };
      return;
    }
    // A line started on the ruler's edge runs along it.
    const edge = tool !== "eraser" && tool !== "rect" && tool !== "circle" ? onRulerEdge(pad.ins.ruler, pt) : null;
    begin(edge || pt, Boolean(edge));
    stroke.current.pointer = e.pointerId;
  };
  const move = (e) => {
    const d = drag.current;
    if (d && d.pointer === e.pointerId) {
      const pt = point(e);
      if (d.mode === "move") {
        pad.setInstrument(d.key, { ...d.from, x: d.from.x + pt[0] - d.start[0], y: d.from.y + pt[1] - d.start[1] });
      } else {
        let a = Math.atan2(pt[1] - d.from.y, pt[0] - d.from.x) + d.turn0;
        // Settles on whole 15° steps when close.
        const step = Math.PI / 12;
        if (Math.abs(a - Math.round(a / step) * step) < 0.035) a = Math.round(a / step) * step;
        pad.setInstrument(d.key, { ...d.from, a });
      }
      return;
    }
    const cur = stroke.current;
    if (!cur || cur.pointer !== e.pointerId) return;
    const s = cur.s;
    const live = liveRef.current.getContext("2d");
    if (cur.edge) {
      const end = onRulerEdge({ ...pad.ins.ruler }, point(e)) || (() => {
        // Off the edge: keep to the ruler's line anyway.
        const r = pad.ins.ruler;
        const { along } = local(r, point(e));
        const t = Math.min(RULER_L, Math.max(0, along));
        return [Math.round(r.x + t * Math.cos(r.a)), Math.round(r.y + t * Math.sin(r.a))];
      })();
      s.pts = [s.pts[0], end];
      live.clearRect(0, 0, PAD_W, PAD_H);
      drawStroke(live, s);
      pad.progress(s, s.pts, true);
      return;
    }
    if (!FREE.includes(s.tool)) {
      s.pts = [s.pts[0], point(e)];
      live.clearRect(0, 0, PAD_W, PAD_H);
      drawStroke(live, s);
      pad.progress(s, s.pts, true);
      return;
    }
    const added = [];
    for (const ev of e.nativeEvent.getCoalescedEvents?.() || [e.nativeEvent]) {
      const pt = point(ev);
      const last = s.pts[s.pts.length - 1];
      if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) < 2) continue;
      s.pts.push(pt);
      added.push(pt);
    }
    if (!added.length) return;
    if (s.tool === "eraser") {
      drawStroke(inkRef.current.getContext("2d"), { ...s, pts: s.pts.slice(-3) });
    } else {
      live.clearRect(0, 0, PAD_W, PAD_H);
      drawStroke(live, s);
    }
    pad.progress(s, added);
    // A very long stroke is finished and carried on as a new one, so no
    // single message gets too big.
    if (s.pts.length >= MAX_PTS) {
      const last = s.pts[s.pts.length - 1];
      const pointer = cur.pointer;
      finish();
      begin(last);
      stroke.current.pointer = pointer;
    }
  };
  const up = (e) => {
    if (drag.current?.pointer === e.pointerId) { drag.current = null; return; }
    if (stroke.current?.pointer === e.pointerId) finish();
  };

  const removePage = async () => {
    if (pad.count <= 1 || !confirm) return;
    if (await confirm({ title: "Delete this page?", body: "The page is removed for everyone.", confirmLabel: "Delete" })) pad.deletePage();
  };

  if (!pad.ui.open && !pad.box) return null;
  return (
    <div ref={pad.boxRef} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 72, zIndex: 5, background: "#d9dee6", borderRadius: 8, overflow: "hidden", display: shown ? "flex" : "none", flexDirection: "column" }}>
      {isHost && (
        <div data-pad-toolbar="" style={{ ...NO_TOUCH_SELECT, display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", padding: 6, background: "rgba(20,22,26,0.94)", color: "#fff" }}>
          <span style={group}>{TOOLS.map(([v, label, Icon]) => (
            <button key={v} type="button" title={label} aria-label={label} style={btn(tool === v)} onClick={() => setTool(v)}><Icon size={15} /></button>
          ))}</span>
          {sep}
          <ColourPick color={color} onPick={(c) => { setColor(c); if (tool === "eraser") setTool("pen"); }} />
          {sep}
          <span style={group}>{WIDTHS.map((w) => (
            <button key={w} type="button" title={`Width ${w}`} aria-label={`Width ${w}`} style={btn(width === w)} onClick={() => setWidth(w)}>
              <span style={{ width: Math.min(14, w + 2), height: Math.min(14, w + 2), borderRadius: "50%", background: "currentColor" }} />
            </button>
          ))}</span>
          {sep}
          <span style={group}>
            <button type="button" title="Ruler: drag to move, turn with the round handle; a line started on its edge runs along it" aria-label="Ruler" style={btn(Boolean(pad.ins.ruler))} onClick={() => toggleInstrument("ruler")}><Ruler size={15} /></button>
            <button type="button" title="Protractor: drag to move, turn with the round handle" aria-label="Protractor" style={btn(Boolean(pad.ins.prot))} onClick={() => toggleInstrument("prot")}><DraftingCompass size={15} /></button>
            <button type="button" title="Calculator: everyone sees its display" aria-label="Calculator" style={btn(pad.calc.open)} onClick={() => pad.setCalc({ open: !pad.calc.open })}><Calculator size={15} /></button>
          </span>
          {sep}
          <span style={group}><button type="button" title="Undo" aria-label="Undo" style={btn(false)} disabled={!pad.canUndo} onClick={pad.undo}><Undo2 size={15} style={{ opacity: pad.canUndo ? 1 : 0.4 }} /></button>
          <button type="button" title="Redo" aria-label="Redo" style={btn(false)} disabled={!pad.canRedo} onClick={pad.redo}><Redo2 size={15} style={{ opacity: pad.canRedo ? 1 : 0.4 }} /></button>
          <button type="button" title="Clear this page (undo brings it back)" aria-label="Clear page" style={btn(false)} onClick={pad.clearPage}><Trash2 size={15} /></button></span>
          {sep}
          <span style={group}>{PAPERS.map(([v, label, Icon]) => (
            <button key={v} type="button" title={`${label} paper`} aria-label={`${label} paper`} style={btn(page?.paper === v)} onClick={() => pad.setPaper(v)}><Icon size={14} /></button>
          ))}</span>
          {sep}
          {tools && <span style={group}>{tools}</span>}
          {(page?.q || page?.bg) && (
            <span style={group}>
              {page.q && <button type="button" title="Take the question off this page" style={btn(false)} onClick={() => pad.removeLayer("q")}><X size={13} /> Question</button>}
              {page.bg && <button type="button" title="Take the picture off this page" style={btn(false)} onClick={() => pad.removeLayer("bg")}><X size={13} /> Picture</button>}
            </span>
          )}
          {(tools || page?.q || page?.bg) && sep}
          <span style={group}><button type="button" title="Previous page" aria-label="Previous page" style={btn(false)} disabled={pad.index <= 0} onClick={() => pad.go(pad.pages.current[pad.index - 1].id)}><ChevronLeft size={15} style={{ opacity: pad.index <= 0 ? 0.4 : 1 }} /></button>
          <span style={{ fontSize: 12.5, minWidth: 64, textAlign: "center" }}>Page {pad.index + 1} of {pad.count}</span>
          <button type="button" title="Next page" aria-label="Next page" style={btn(false)} disabled={pad.index >= pad.count - 1} onClick={() => pad.go(pad.pages.current[pad.index + 1].id)}><ChevronRight size={15} style={{ opacity: pad.index >= pad.count - 1 ? 0.4 : 1 }} /></button>
          <button type="button" title="New page after this one" style={btn(false)} onClick={pad.addPage}><Plus size={15} /> Page</button>
          {pad.count > 1 && confirm && <button type="button" title="Delete this page" aria-label="Delete page" style={btn(false)} onClick={removePage}><FileX size={15} /></button>}</span>
          <span style={{ flex: 1 }} />
          <span style={group}>{onHide && <button type="button" style={btn(false)} onClick={onHide}><EyeOff size={14} /> Hide for me</button>}
          <button type="button" style={btn(false)} onClick={() => pad.setOpen(false)}><X size={14} /> Close for everyone</button></span>
        </div>
      )}
      <div ref={wrapRef} style={{ flex: 1, minHeight: 0, position: "relative", margin: 8 }}>
        <div ref={sheetRef} style={{ ...NO_TOUCH_SELECT, position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: size.w, height: size.h, background: "#fff", boxShadow: "0 4px 18px rgba(0,0,0,0.18)", borderRadius: 4, overflow: "hidden", touchAction: "none" }}>
          {[paperRef, inkRef, toolRef, liveRef].map((ref, i) => (
            <canvas key={i} ref={ref} width={PAD_W} height={PAD_H}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none", pointerEvents: i === 3 && isHost ? "auto" : "none", cursor: tool === "eraser" ? "cell" : "crosshair" }}
              {...(i === 3 && isHost ? { onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerCancel: up } : {})} />
          ))}
        </div>
        {isHost && pad.calc.open && <CalcPad pad={pad} />}
        {!isHost && pad.count > 0 && (
          <span style={{ position: "absolute", right: 8, bottom: 4, fontSize: 12, color: "#4b5563", background: "rgba(255,255,255,0.85)", padding: "1px 8px", borderRadius: 999 }}>
            Page {pad.index + 1} of {pad.count}
          </span>
        )}
      </div>
    </div>
  );
}
