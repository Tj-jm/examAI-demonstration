import { useCallback, useEffect, useRef, useState } from "react";
import {
  Crop, RotateCcw, RotateCw, FlipHorizontal2, FlipVertical2, Scaling, SunMedium, MoveUpRight,
  Type, Highlighter, Eraser, Square, Undo2, Redo2, X, Check, Loader2,
} from "lucide-react";
import useNoTouchSelect, { NO_TOUCH_SELECT } from "./useNoTouchSelect";

// A small editor for a question's images: crop, rotate, flip, resize,
// brightness/contrast, and marks (arrow, box, text, highlight, whiteout).
// Plain canvas, no library. Works on the image's full resolution; the screen
// shows a scaled copy and pointer positions are mapped back.
//
// `source` is a File/Blob or a url. onSave(blob) gets the edited image in
// the source's own format (JPEG stays JPEG, anything else becomes PNG).

const TOOLS = [
  ["crop", "Crop", Crop],
  ["arrow", "Arrow", MoveUpRight],
  ["box", "Box", Square],
  ["text", "Text", Type],
  ["highlight", "Highlight", Highlighter],
  ["whiteout", "Whiteout", Eraser],
];
const COLORS = ["#e11d48", "#2563eb", "#16a34a", "#111827", "#f59e0b"];
const HISTORY = 25;

const cloneCanvas = (src) => {
  const c = document.createElement("canvas");
  c.width = src.width;
  c.height = src.height;
  c.getContext("2d").drawImage(src, 0, 0);
  return c;
};

// Loads a url or blob into a canvas. A url is fetched as a blob first, so a
// picture on other storage doesn't taint the canvas (which would block saving).
const loadSource = async (source) => {
  const blob = source instanceof Blob ? source : await (await fetch(source, { credentials: "include" })).blob();
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("That image could not be opened."));
      i.src = url;
    });
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext("2d").drawImage(img, 0, 0);
    return { canvas: c, type: blob.type };
  } finally {
    URL.revokeObjectURL(url);
  }
};

const normRect = (a, b) => ({
  x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y),
});

const drawArrow = (ctx, a, b, color, width) => {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const head = width * 4.5;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x - Math.cos(angle) * head * 0.8, b.y - Math.sin(angle) * head * 0.8);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x - head * Math.cos(angle - Math.PI / 7), b.y - head * Math.sin(angle - Math.PI / 7));
  ctx.lineTo(b.x - head * Math.cos(angle + Math.PI / 7), b.y - head * Math.sin(angle + Math.PI / 7));
  ctx.closePath();
  ctx.fill();
};

// One mark, in image coordinates, onto a context.
const drawMark = (ctx, mark, stroke) => {
  const { tool, a, b, color } = mark;
  if (tool === "arrow") drawArrow(ctx, a, b, color, stroke);
  if (tool === "box" || tool === "highlight" || tool === "whiteout") {
    const r = normRect(a, b);
    if (tool === "box") {
      ctx.strokeStyle = color;
      ctx.lineWidth = stroke;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    } else {
      ctx.fillStyle = tool === "whiteout" ? "#ffffff" : "rgba(250, 204, 21, 0.38)";
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }
  }
  if (tool === "text" && mark.text) {
    ctx.fillStyle = color;
    ctx.font = `600 ${mark.size}px system-ui, sans-serif`;
    ctx.textBaseline = "top";
    ctx.fillText(mark.text, a.x, a.y);
  }
};

// Brightness and contrast baked into the pixels (-100..100 each), with the
// same formulas as the CSS filter the screen previews with (see
// filterPreview): brightness multiplies, contrast scales around mid-grey.
// What is saved is what was shown.
const adjust = (canvas, brightness, contrast) => {
  const out = cloneCanvas(canvas);
  const ctx = out.getContext("2d");
  const data = ctx.getImageData(0, 0, out.width, out.height);
  const bm = 1 + brightness / 100;
  const cm = 1 + contrast / 100;
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v += 1) lut[v] = Math.round((Math.min(255, v * bm) - 127.5) * cm + 127.5);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    px[i] = lut[px[i]];
    px[i + 1] = lut[px[i + 1]];
    px[i + 2] = lut[px[i + 2]];
  }
  ctx.putImageData(data, 0, 0);
  return out;
};

export default function ImageEditor({ source, onCancel, onSave, saving = false }) {
  const [image, setImage] = useState(null); // committed canvas
  const [type, setType] = useState("image/png");
  const [loadError, setLoadError] = useState(null);
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);
  const [tool, setTool] = useState("crop");
  const [color, setColor] = useState(COLORS[0]);
  const [text, setText] = useState("");
  const [textSize, setTextSize] = useState("m");
  const [drag, setDrag] = useState(null); // { a, b } while dragging
  const [cropRect, setCropRect] = useState(null);
  const [tune, setTune] = useState({ brightness: 0, contrast: 0 });
  const [resizeW, setResizeW] = useState("");
  const view = useRef(null);
  useNoTouchSelect(view, Boolean(image));

  useEffect(() => {
    let live = true;
    loadSource(source)
      .then(({ canvas, type: t }) => {
        if (!live) return;
        setImage(canvas);
        setType(t === "image/jpeg" ? "image/jpeg" : "image/png");
        setResizeW(String(canvas.width));
      })
      .catch((err) => live && setLoadError(err.message || "That image could not be opened."));
    return () => { live = false; };
  }, [source]);

  const stroke = image ? Math.max(3, Math.round(Math.max(image.width, image.height) / 220)) : 3;
  const fontSize = image ? Math.round(Math.max(image.width, image.height) * ({ s: 0.03, m: 0.045, l: 0.07 }[textSize])) : 24;

  // Every edit replaces the image and records the old one for undo.
  const commit = useCallback((next) => {
    setPast((p) => [...p.slice(-(HISTORY - 1)), image]);
    setFuture([]);
    setImage(next);
    setResizeW(String(next.width));
    setCropRect(null);
  }, [image]);

  const undo = () => {
    if (!past.length) return;
    setFuture((f) => [image, ...f]);
    const prev = past[past.length - 1];
    setPast((p) => p.slice(0, -1));
    setImage(prev);
    setResizeW(String(prev.width));
    setCropRect(null);
  };
  const redo = () => {
    if (!future.length) return;
    setPast((p) => [...p, image]);
    const next = future[0];
    setFuture((f) => f.slice(1));
    setImage(next);
    setResizeW(String(next.width));
  };

  // ------------------------------------------------------------ transforms
  const rotate = (dir) => {
    const c = document.createElement("canvas");
    c.width = image.height;
    c.height = image.width;
    const ctx = c.getContext("2d");
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate((dir * Math.PI) / 2);
    ctx.drawImage(image, -image.width / 2, -image.height / 2);
    commit(c);
  };
  const flip = (horizontal) => {
    const c = document.createElement("canvas");
    c.width = image.width;
    c.height = image.height;
    const ctx = c.getContext("2d");
    ctx.translate(horizontal ? c.width : 0, horizontal ? 0 : c.height);
    ctx.scale(horizontal ? -1 : 1, horizontal ? 1 : -1);
    ctx.drawImage(image, 0, 0);
    commit(c);
  };
  const applyCrop = () => {
    const r = cropRect;
    if (!r || r.w < 4 || r.h < 4) return;
    const c = document.createElement("canvas");
    c.width = Math.round(r.w);
    c.height = Math.round(r.h);
    c.getContext("2d").drawImage(image, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
    commit(c);
  };
  const applyResize = () => {
    const w = Math.round(Number(resizeW));
    if (!w || w < 16 || w === image.width) return;
    const h = Math.max(1, Math.round((image.height / image.width) * w));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, w, h);
    commit(c);
  };
  const applyTune = () => {
    if (!tune.brightness && !tune.contrast) return;
    commit(adjust(image, tune.brightness, tune.contrast));
    setTune({ brightness: 0, contrast: 0 });
  };

  // ------------------------------------------------------------ drawing
  const toImage = (event) => {
    const rect = view.current.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * image.width;
    const y = ((event.clientY - rect.top) / rect.height) * image.height;
    return { x: Math.max(0, Math.min(image.width, x)), y: Math.max(0, Math.min(image.height, y)) };
  };

  const down = (event) => {
    event.preventDefault(); // no iPad selection menu on a held touch
    if (!image) return;
    const p = toImage(event);
    if (tool === "text") {
      if (!text.trim()) return;
      const c = cloneCanvas(image);
      drawMark(c.getContext("2d"), { tool: "text", a: p, color, text: text.trim(), size: fontSize }, stroke);
      commit(c);
      return;
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDrag({ a: p, b: p });
  };
  const move = (event) => {
    if (!drag) return;
    setDrag((d) => ({ ...d, b: toImage(event) }));
  };
  const up = () => {
    if (!drag) return;
    const { a, b } = drag;
    setDrag(null);
    if (Math.hypot(a.x - b.x, a.y - b.y) < 3) return;
    if (tool === "crop") {
      setCropRect(normRect(a, b));
      return;
    }
    const c = cloneCanvas(image);
    drawMark(c.getContext("2d"), { tool, a, b, color }, stroke);
    commit(c);
  };

  // Paint the screen copy: the image, the live mark or crop box, the tune preview.
  useEffect(() => {
    const canvas = view.current;
    if (!canvas || !image) return;
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);
    const box = tool === "crop" ? (drag ? normRect(drag.a, drag.b) : cropRect) : null;
    if (box) {
      ctx.fillStyle = "rgba(15, 23, 42, 0.5)";
      ctx.fillRect(0, 0, image.width, box.y);
      ctx.fillRect(0, box.y + box.h, image.width, image.height - box.y - box.h);
      ctx.fillRect(0, box.y, box.x, box.h);
      ctx.fillRect(box.x + box.w, box.y, image.width - box.x - box.w, box.h);
      ctx.setLineDash([stroke * 3, stroke * 2]);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = Math.max(2, stroke / 1.5);
      ctx.strokeRect(box.x, box.y, box.w, box.h);
      ctx.setLineDash([]);
    } else if (drag) {
      drawMark(ctx, { tool, a: drag.a, b: drag.b, color }, stroke);
    }
  }, [image, drag, cropRect, tool, color, stroke]);

  const save = async () => {
    // Nothing changed: hand back the original file untouched (no re-encode).
    if (!past.length && !tune.brightness && !tune.contrast) {
      if (source instanceof Blob) onSave(source, source.type);
      else onCancel();
      return;
    }
    const baked = tune.brightness || tune.contrast ? adjust(image, tune.brightness, tune.contrast) : image;
    const blob = await new Promise((resolve) => baked.toBlob(resolve, type, 0.92));
    if (blob) onSave(blob, type);
  };

  // Keyboard: Ctrl/Cmd+Z undo, Shift for redo, Enter applies a crop.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
      if (e.key === "Enter" && tool === "crop" && cropRect && e.target.tagName !== "INPUT") applyCrop();
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const filterPreview = tune.brightness || tune.contrast
    ? `brightness(${1 + tune.brightness / 100}) contrast(${1 + tune.contrast / 100})`
    : "none";

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="dialog image-editor" role="dialog" aria-label="Edit image">
        <div className="spread" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Edit image</h2>
          <div className="row-tight">
            <button type="button" className="icon-btn" onClick={undo} disabled={!past.length} title="Undo (Ctrl+Z)"><Undo2 size={15} /></button>
            <button type="button" className="icon-btn" onClick={redo} disabled={!future.length} title="Redo (Ctrl+Shift+Z)"><Redo2 size={15} /></button>
            <button type="button" className="icon-btn" onClick={onCancel} title="Close"><X size={15} /></button>
          </div>
        </div>

        {loadError ? (
          <p className="hint" style={{ color: "var(--incorrect)" }}>{loadError}</p>
        ) : !image ? (
          <div className="row-tight muted small"><Loader2 size={14} className="spin" /> Opening…</div>
        ) : (
          <div className="image-editor-body">
            <div className="image-editor-tools stack" style={{ gap: 10 }}>
              <div className="image-editor-grid">
                {TOOLS.map(([key, label, Icon]) => (
                  <button
                    key={key}
                    type="button"
                    className={`btn btn-sm ${tool === key ? "btn-primary" : "btn-quiet"}`}
                    onClick={() => { setTool(key); setCropRect(null); }}
                    title={label}
                  >
                    <Icon size={14} /> {label}
                  </button>
                ))}
              </div>

              {tool === "crop" && (
                <div className="stack" style={{ gap: 6 }}>
                  <span className="hint">Drag over the part to keep.</span>
                  <button type="button" className="btn btn-sm" disabled={!cropRect} onClick={applyCrop}><Check size={14} /> Apply crop</button>
                </div>
              )}
              {["arrow", "box", "text"].includes(tool) && (
                <div className="row-tight" style={{ gap: 6 }}>
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={`Colour ${c}`}
                      onClick={() => setColor(c)}
                      style={{ width: 22, height: 22, borderRadius: "50%", background: c, border: color === c ? "3px solid var(--text)" : "2px solid var(--border)", cursor: "pointer" }}
                    />
                  ))}
                </div>
              )}
              {tool === "text" && (
                <div className="stack" style={{ gap: 6 }}>
                  <input className="input" placeholder="Text to place" value={text} onChange={(e) => setText(e.target.value)} />
                  <div className="row-tight" style={{ gap: 4 }}>
                    {["s", "m", "l"].map((s) => (
                      <button key={s} type="button" className={`btn btn-sm ${textSize === s ? "btn-primary" : "btn-quiet"}`} onClick={() => setTextSize(s)}>
                        {s.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  <span className="hint">Then click where it goes.</span>
                </div>
              )}
              {["arrow", "box", "highlight", "whiteout"].includes(tool) && <span className="hint">Drag on the image.</span>}

              <hr style={{ width: "100%" }} />
              <div className="row-tight" style={{ gap: 4, flexWrap: "wrap" }}>
                <button type="button" className="icon-btn" onClick={() => rotate(-1)} title="Rotate left"><RotateCcw size={15} /></button>
                <button type="button" className="icon-btn" onClick={() => rotate(1)} title="Rotate right"><RotateCw size={15} /></button>
                <button type="button" className="icon-btn" onClick={() => flip(true)} title="Flip horizontally"><FlipHorizontal2 size={15} /></button>
                <button type="button" className="icon-btn" onClick={() => flip(false)} title="Flip vertically"><FlipVertical2 size={15} /></button>
              </div>

              <div className="stack" style={{ gap: 4 }}>
                <span className="label row-tight" style={{ margin: 0, gap: 4 }}><Scaling size={13} /> Width (px)</span>
                <div className="row-tight" style={{ gap: 4 }}>
                  <input className="input tnum" type="number" min="16" style={{ maxWidth: 100 }} value={resizeW} onChange={(e) => setResizeW(e.target.value)} />
                  <button type="button" className="btn btn-sm btn-quiet" onClick={applyResize} disabled={Number(resizeW) === image.width}>Resize</button>
                </div>
                <span className="hint tnum">{image.width} × {image.height}</span>
              </div>

              <div className="stack" style={{ gap: 4 }}>
                <span className="label row-tight" style={{ margin: 0, gap: 4 }}><SunMedium size={13} /> Brightness</span>
                <input type="range" min="-60" max="60" value={tune.brightness} onChange={(e) => setTune({ ...tune, brightness: Number(e.target.value) })} />
                <span className="label" style={{ margin: 0 }}>Contrast</span>
                <input type="range" min="-60" max="60" value={tune.contrast} onChange={(e) => setTune({ ...tune, contrast: Number(e.target.value) })} />
                {(tune.brightness !== 0 || tune.contrast !== 0) && (
                  <div className="row-tight" style={{ gap: 4 }}>
                    <button type="button" className="btn btn-sm" onClick={applyTune}>Apply</button>
                    <button type="button" className="btn btn-sm btn-quiet" onClick={() => setTune({ brightness: 0, contrast: 0 })}>Reset</button>
                  </div>
                )}
              </div>
            </div>

            <div className="image-editor-stage">
              <canvas
                ref={view}
                onPointerDown={down}
                onPointerMove={move}
                onPointerUp={up}
                onPointerCancel={() => setDrag(null)}
                style={{ ...NO_TOUCH_SELECT, filter: filterPreview, cursor: tool === "text" ? "text" : "crosshair", touchAction: "none" }}
              />
            </div>
          </div>
        )}

        <div className="row-tight" style={{ justifyContent: "flex-end", marginTop: 14 }}>
          <button type="button" className="btn btn-quiet" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!image || saving} onClick={save}>
            {saving ? "Saving…" : "Save image"}
          </button>
        </div>
      </div>
    </div>
  );
}
