import { useEffect, useRef, useState } from "react";
import { FONT, hasMath, mathImage } from "../utils/mathImage";
import useNoTouchSelect, { NO_TOUCH_SELECT } from "./useNoTouchSelect";
import { Pencil, Minus, MoveUpRight, MoveHorizontal, Ellipsis, Braces, Square, Circle, Type, Eraser, Undo2, Redo2, Trash2, X, Check, Loader2 } from "lucide-react";

// A drawing pad for a board picture: freehand pen, line, dotted line,
// arrow, two-ended arrow, curly bracket, box, circle, text and eraser on a blank page (transparent, so it sits on any
// board colour, or white) or on top of an existing picture. Shapes are kept
// as a list and redrawn, so undo is exact. onSave(blob) gets a PNG.

const W = 1200;
const H = 750;
const TOOLS = [
  ["pen", "Pen", Pencil], ["line", "Line", Minus], ["dotted", "Dotted", Ellipsis], ["arrow", "Arrow", MoveUpRight],
  ["double", "Two-way arrow", MoveHorizontal], ["brace", "Bracket", Braces],
  ["rect", "Box", Square], ["circle", "Circle", Circle], ["text", "Text", Type], ["eraser", "Eraser", Eraser],
];
const COLORS = ["#111827", "#2563eb", "#e11d48", "#16a34a", "#f59e0b", "#7c3aed", "#ffffff"];
const SIZES = [["S", 3], ["M", 6], ["L", 11]];

// An arrowhead at `tip`, pointing away from `from`.
const arrowHead = (ctx, from, tip, size) => {
  const ang = Math.atan2(tip.y - from.y, tip.x - from.x);
  const head = Math.max(14, size * 4);
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x - head * Math.cos(ang - 0.45), tip.y - head * Math.sin(ang - 0.45));
  ctx.lineTo(tip.x - head * Math.cos(ang + 0.45), tip.y - head * Math.sin(ang + 0.45));
  ctx.closePath();
  ctx.fill();
};

// A curly bracket from a to b, its point bulging to the right of a→b
// (drag the other way to flip it). Two quadratic halves meeting at the tip.
const brace = (ctx, a, b) => {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 2) return;
  const dx = (a.x - b.x) / len;
  const dy = (a.y - b.y) / len;
  const w = Math.min(40, Math.max(12, len * 0.08));
  const q = 0.6;
  const at = (t, k) => ({ x: a.x - t * len * dx + k * w * dy, y: a.y - t * len * dy - k * w * dx });
  const tip = at(0.5, 1);
  const half = (start, c1, c2) => {
    ctx.moveTo(start.x, start.y);
    ctx.quadraticCurveTo(c1.x, c1.y, c2.x, c2.y);
    // The second curve's control mirrors the first (SVG's "T").
    ctx.quadraticCurveTo(2 * c2.x - c1.x, 2 * c2.y - c1.y, tip.x, tip.y);
  };
  ctx.beginPath();
  half(a, at(0, q), at(0.25, 1 - q));
  half(b, at(1, q), at(0.75, 1 - q));
  ctx.stroke();
};

const drawShape = (ctx, s) => {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = s.size;
  if (s.tool === "eraser") {
    ctx.globalCompositeOperation = "destination-out";
    ctx.lineWidth = s.size * 4;
  }
  const [a, b] = [s.points[0], s.points[s.points.length - 1]];
  if (s.tool === "pen" || s.tool === "eraser") {
    ctx.beginPath();
    s.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    if (s.points.length === 1) ctx.lineTo(a.x + 0.1, a.y);
    ctx.stroke();
  } else if (["line", "dotted", "arrow", "double"].includes(s.tool)) {
    // Dotted: round dots, spaced by the pen size.
    if (s.tool === "dotted") ctx.setLineDash([0.1, s.size * 2.6]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    if (s.tool === "arrow" || s.tool === "double") arrowHead(ctx, a, b, s.size);
    if (s.tool === "double") arrowHead(ctx, b, a, s.size);
  } else if (s.tool === "brace") {
    brace(ctx, a, b);
  } else if (s.tool === "rect") {
    ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  } else if (s.tool === "circle") {
    ctx.beginPath();
    ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (s.tool === "text" && s.img) {
    // Text with maths, drawn beforehand (utils/mathImage.js).
    ctx.drawImage(s.img, a.x, a.y - s.h / 2, s.w, s.h);
  } else if (s.tool === "text") {
    ctx.font = FONT(s.size * 6 + 14);
    ctx.textBaseline = "middle";
    ctx.fillText(s.text, a.x, a.y);
  }
  ctx.restore();
};

export default function DrawPad({ base, onCancel, onSave, saving = false }) {
  const canvasRef = useRef(null);
  useNoTouchSelect(canvasRef);
  const layerRef = useRef(null);
  const [baseImg, setBaseImg] = useState(null);
  const [baseError, setBaseError] = useState("");
  const [background, setBackground] = useState("transparent");
  const [tool, setTool] = useState("pen");
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(6);
  const [text, setText] = useState("");
  const [shapes, setShapes] = useState([]);
  const [undone, setUndone] = useState([]);
  const [current, setCurrent] = useState(null);
  const [typesetting, setTypesetting] = useState(false);
  const [textError, setTextError] = useState("");

  // Drawing on an existing picture: fetched as a blob so the canvas can
  // still be saved (a cross-site image would lock it).
  useEffect(() => {
    if (!base) return undefined;
    let url;
    fetch(base, { credentials: "include" })
      .then((r) => { if (!r.ok) throw new Error(); return r.blob(); })
      .then((blob) => {
        url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => setBaseImg(img);
        img.src = url;
      })
      .catch(() => setBaseError("That picture couldn't be loaded for drawing; starting on a blank page."));
    return () => url && URL.revokeObjectURL(url);
  }, [base]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!layerRef.current) {
      layerRef.current = document.createElement("canvas");
      layerRef.current.width = W;
      layerRef.current.height = H;
    }
    const layer = layerRef.current.getContext("2d");
    layer.clearRect(0, 0, W, H);
    [...shapes, ...(current ? [current] : [])].forEach((s) => drawShape(layer, s));
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, W, H);
    if (background === "white") { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H); }
    if (baseImg) {
      const k = Math.min(W / baseImg.naturalWidth, H / baseImg.naturalHeight);
      const w = baseImg.naturalWidth * k;
      const h = baseImg.naturalHeight * k;
      ctx.drawImage(baseImg, (W - w) / 2, (H - h) / 2, w, h);
    }
    ctx.drawImage(layerRef.current, 0, 0);
  }, [shapes, current, background, baseImg]);

  const at = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  const down = (e) => {
    e.preventDefault(); // no iPad selection menu on a held touch
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = at(e);
    if (tool === "text") {
      if (!text.trim() || typesetting) return;
      const shape = { tool, color, size, text: text.trim(), points: [p] };
      if (!hasMath(shape.text)) {
        setShapes((s) => [...s, shape]);
        setUndone([]);
        return;
      }
      // $...$ maths: drawn as a picture first, then placed.
      setTypesetting(true);
      setTextError("");
      mathImage(shape.text, { color, px: size * 6 + 14 })
        .then((m) => { setShapes((s) => [...s, { ...shape, ...m }]); setUndone([]); })
        .catch(() => setTextError("That maths couldn't be drawn. Check the LaTeX between the $ signs."))
        .finally(() => setTypesetting(false));
      return;
    }
    setCurrent({ tool, color, size, points: [p] });
  };
  const move = (e) => {
    if (!current) return;
    const p = at(e);
    setCurrent((c) => ({ ...c, points: c.tool === "pen" || c.tool === "eraser" ? [...c.points, p] : [c.points[0], p] }));
  };
  const up = () => {
    if (!current) return;
    setShapes((s) => [...s, current]);
    setUndone([]);
    setCurrent(null);
  };
  const undo = () => { if (!shapes.length) return; setUndone((u) => [shapes[shapes.length - 1], ...u]); setShapes((s) => s.slice(0, -1)); };
  const redo = () => { if (!undone.length) return; setShapes((s) => [...s, undone[0]]); setUndone((u) => u.slice(1)); };
  const save = () => canvasRef.current.toBlob((blob) => blob && onSave(blob), "image/png");

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(10,12,18,0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
      <div className="card stack" style={{ width: "min(1100px, 100%)", maxHeight: "96vh", overflow: "auto", gap: 10 }}>
        <div className="spread">
          <strong>Draw a picture</strong>
          <div className="row-tight" style={{ gap: 6 }}>
            <button type="button" className="btn btn-sm btn-quiet" onClick={onCancel}><X size={14} /> Cancel</button>
            <button type="button" className="btn btn-sm btn-primary" disabled={saving || !shapes.length && !baseImg} onClick={save}>
              {saving ? <Loader2 size={14} className="spin" /> : <Check size={14} />} Use this picture
            </button>
          </div>
        </div>
        <div className="row-tight" style={{ gap: 6, flexWrap: "wrap" }}>
          {TOOLS.map(([v, l, Icon]) => (
            <button key={v} type="button" title={l} className={`btn btn-sm ${tool === v ? "btn-primary" : "btn-quiet"}`} onClick={() => setTool(v)}><Icon size={14} /> {l}</button>
          ))}
        </div>
        <div className="row-tight" style={{ gap: 10, flexWrap: "wrap" }}>
          <div className="row-tight" style={{ gap: 4 }}>
            {COLORS.map((c) => (
              <button key={c} type="button" title={c} onClick={() => setColor(c)}
                style={{ width: 24, height: 24, borderRadius: "50%", background: c, cursor: "pointer", border: color === c ? "3px solid var(--accent, #2563eb)" : "1px solid rgba(128,128,128,0.5)" }} />
            ))}
          </div>
          <div className="row-tight" style={{ gap: 4 }}>
            {SIZES.map(([l, v]) => <button key={l} type="button" className={`btn btn-sm ${size === v ? "btn-primary" : "btn-quiet"}`} onClick={() => setSize(v)}>{l}</button>)}
          </div>
          {tool === "text" && <input className="input" style={{ width: 260 }} value={text} placeholder="Type, then click. Maths as $x^2$" onChange={(e) => setText(e.target.value)} />}
          {typesetting && <Loader2 size={15} className="spin" />}
          {!baseImg && (
            <select className="select" style={{ width: 160 }} value={background} onChange={(e) => setBackground(e.target.value)}>
              <option value="transparent">See-through page</option>
              <option value="white">White page</option>
            </select>
          )}
          <span className="grow" />
          <button type="button" className="icon-btn" title="Undo" disabled={!shapes.length} onClick={undo}><Undo2 size={15} /></button>
          <button type="button" className="icon-btn" title="Redo" disabled={!undone.length} onClick={redo}><Redo2 size={15} /></button>
          <button type="button" className="icon-btn icon-btn-danger" title="Clear the drawing" disabled={!shapes.length} onClick={() => { setUndone([]); setShapes([]); }}><Trash2 size={15} /></button>
        </div>
        {baseError && <span className="hint">{baseError}</span>}
        {textError && <span className="small" style={{ color: "var(--danger, #c62828)" }}>{textError}</span>}
        <canvas ref={canvasRef} width={W} height={H} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
          style={{ ...NO_TOUCH_SELECT, width: "100%", aspectRatio: `${W} / ${H}`, touchAction: "none", cursor: tool === "text" ? "text" : "crosshair", borderRadius: 8, border: "1px solid rgba(128,128,128,0.4)",
            // A checkerboard shows which parts are see-through.
            background: "repeating-conic-gradient(#e5e7eb 0% 25%, #ffffff 0% 50%) 50% / 24px 24px" }} />
      </div>
    </div>
  );
}
