import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, Upload, PenLine, Eraser, Check, X } from "lucide-react";
import { useUploadSignatureMutation } from "../api/contentApi";
import { ErrorNote } from "./bits";
import useNoTouchSelect, { NO_TOUCH_SELECT } from "./useNoTouchSelect";

// Signatures for certificates and report cards: up to `max` people, each
// with a name, a role and an optional picture of their signature, uploaded
// (a photo or scan) or drawn here with a mouse, finger or stylus.

const PAD_W = 600;
const PAD_H = 200;
const INKS = [["Black", "#111827"], ["Blue", "#1d3fb8"]];

// The drawn or scanned strokes only, cropped to the ink with a small margin.
// `clearPaper` turns light pixels see-through so a photo of a signature on
// white paper sits on the certificate without a box around it.
const toTrimmedPng = (source, { clearPaper }) =>
  new Promise((resolve) => {
    const w = source.width;
    const h = source.height;
    const work = document.createElement("canvas");
    work.width = w;
    work.height = h;
    const ctx = work.getContext("2d");
    ctx.drawImage(source, 0, 0);
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = (y * w + x) * 4;
        if (clearPaper) {
          const light = (d[i] + d[i + 1] + d[i + 2]) / 3;
          // Fade the paper out, keep the ink; the band in between stays soft.
          if (light > 200) d[i + 3] = 0;
          else if (light > 150) d[i + 3] = Math.round(d[i + 3] * (200 - light) / 50);
        }
        if (d[i + 3] > 24) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return resolve(null);
    ctx.putImageData(img, 0, 0);
    const pad = 8;
    const sx = Math.max(0, minX - pad);
    const sy = Math.max(0, minY - pad);
    const sw = Math.min(w, maxX + pad) - sx;
    const sh = Math.min(h, maxY + pad) - sy;
    // At most 800px wide: plenty for print, small to store.
    const scale = Math.min(1, 800 / sw);
    const out = document.createElement("canvas");
    out.width = Math.round(sw * scale);
    out.height = Math.round(sh * scale);
    out.getContext("2d").drawImage(work, sx, sy, sw, sh, 0, 0, out.width, out.height);
    out.toBlob((blob) => resolve(blob), "image/png");
  });

function DrawPad({ onDone, onCancel, busy }) {
  const ref = useRef(null);
  const wrap = useRef(null);
  const drawing = useRef(null);
  const [ink, setInk] = useState(INKS[0][1]);
  const [empty, setEmpty] = useState(true);
  // Touches are cancelled on the canvas only: around it the ink, Clear,
  // Cancel and Use buttons must still get their taps.
  useNoTouchSelect(ref);
  useNoTouchSelect(wrap, true, { menusOnly: true });

  useEffect(() => {
    const c = ref.current;
    const ratio = window.devicePixelRatio || 1;
    c.width = PAD_W * ratio;
    c.height = PAD_H * ratio;
    c.getContext("2d").scale(ratio, ratio);
  }, []);

  const point = (e) => {
    const r = ref.current.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * PAD_W, y: ((e.clientY - r.top) / r.height) * PAD_H, p: e.pressure || 0.5 };
  };
  const down = (e) => {
    e.preventDefault();
    ref.current.setPointerCapture(e.pointerId);
    drawing.current = point(e);
  };
  const move = (e) => {
    if (!drawing.current) return;
    const ctx = ref.current.getContext("2d");
    const next = point(e);
    const last = drawing.current;
    ctx.strokeStyle = ink;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // A pen's pressure thickens the line; a mouse draws at a steady weight.
    ctx.lineWidth = e.pointerType === "pen" ? 1.5 + next.p * 3 : 2.6;
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.quadraticCurveTo(last.x, last.y, (last.x + next.x) / 2, (last.y + next.y) / 2);
    ctx.lineTo(next.x, next.y);
    ctx.stroke();
    drawing.current = next;
    if (empty) setEmpty(false);
  };
  const up = () => { drawing.current = null; };
  const clear = () => {
    ref.current.getContext("2d").clearRect(0, 0, PAD_W, PAD_H);
    setEmpty(true);
  };

  return (
    <div ref={wrap} className="stack" style={{ gap: 8, ...NO_TOUCH_SELECT }}>
      <canvas
        ref={ref}
        aria-label="Signature pad"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        style={{ width: "100%", maxWidth: PAD_W, aspectRatio: `${PAD_W} / ${PAD_H}`, background: "#fff", border: "1px dashed var(--border)", borderRadius: 8, touchAction: "none", cursor: "crosshair" }}
      />
      <div className="row-tight" style={{ flexWrap: "wrap", gap: 8 }}>
        {INKS.map(([label, color]) => (
          <button key={color} type="button" className={`btn btn-sm ${ink === color ? "" : "btn-quiet"}`} onClick={() => setInk(color)}>
            <span style={{ width: 10, height: 10, borderRadius: 5, background: color, display: "inline-block" }} /> {label}
          </button>
        ))}
        <button type="button" className="btn btn-sm btn-quiet" onClick={clear} disabled={empty}><Eraser size={14} /> Clear</button>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn btn-sm btn-quiet" onClick={onCancel}><X size={14} /> Cancel</button>
        <button type="button" className="btn btn-sm" disabled={empty || busy} onClick={async () => onDone(await toTrimmedPng(ref.current, { clearPaper: false }))}>
          <Check size={14} /> {busy ? "Saving" : "Use this signature"}
        </button>
      </div>
      <p className="muted small" style={{ margin: 0 }}>Sign in the box with a mouse, finger or stylus.</p>
    </div>
  );
}

function SignatureRow({ value, onChange, onRemove }) {
  const [mode, setMode] = useState(null); // draw
  const [clearPaper, setClearPaper] = useState(true);
  const [upload, { isLoading, error }] = useUploadSignatureMutation();
  const fileRef = useRef(null);

  const send = async (blob) => {
    if (!blob) return;
    try {
      const { url } = await upload(new File([blob], "signature.png", { type: "image/png" })).unwrap();
      onChange({ ...value, image: url });
      setMode(null);
    } catch { /* shown */ }
  };

  const pickFile = async (file) => {
    if (!file) return;
    const bitmap = await createImageBitmap(file).catch(() => null);
    if (!bitmap) return;
    // Large phone photos are scaled down before the paper is cleared.
    const scale = Math.min(1, 1600 / bitmap.width);
    const c = document.createElement("canvas");
    c.width = Math.round(bitmap.width * scale);
    c.height = Math.round(bitmap.height * scale);
    c.getContext("2d").drawImage(bitmap, 0, 0, c.width, c.height);
    await send(await toTrimmedPng(c, { clearPaper }));
  };

  return (
    <div className="card-quiet stack" style={{ gap: 8 }}>
      <div className="row-tight" style={{ flexWrap: "wrap", gap: 8 }}>
        <input className="input" placeholder="Name" value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} style={{ flex: "1 1 160px" }} />
        <input className="input" placeholder="Role, e.g. Principal" value={value.role} onChange={(e) => onChange({ ...value, role: e.target.value })} style={{ flex: "1 1 160px" }} />
        <button type="button" className="btn btn-sm btn-quiet" aria-label="Remove signer" onClick={onRemove}><Trash2 size={14} /></button>
      </div>
      <div className="row-tight" style={{ flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <div style={{ width: 180, height: 64, border: "1px solid var(--border)", borderRadius: 8, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
          {value.image ? <img src={value.image} alt="Signature" style={{ maxWidth: "100%", maxHeight: "100%" }} /> : <span className="muted small">No signature picture</span>}
        </div>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ""; }} />
        <button type="button" className="btn btn-sm btn-quiet" disabled={isLoading} onClick={() => fileRef.current?.click()}><Upload size={14} /> {isLoading && mode !== "draw" ? "Uploading" : "Upload"}</button>
        <button type="button" className="btn btn-sm btn-quiet" onClick={() => setMode(mode === "draw" ? null : "draw")}><PenLine size={14} /> Draw</button>
        {value.image && <button type="button" className="btn btn-sm btn-quiet" onClick={() => onChange({ ...value, image: null })}>Remove picture</button>}
        <label className="row-tight small muted"><input type="checkbox" checked={clearPaper} onChange={(e) => setClearPaper(e.target.checked)} /> Remove white paper from uploads</label>
      </div>
      {mode === "draw" && <DrawPad busy={isLoading} onDone={send} onCancel={() => setMode(null)} />}
      <ErrorNote error={error} />
    </div>
  );
}

export default function SignatureFields({ value, onChange, max = 3, label = "Signatures" }) {
  const list = value || [];
  const set = (i, next) => onChange(list.map((s, j) => (j === i ? next : s)));
  return (
    <div className="stack">
      <span className="label">{label} (up to {max})</span>
      {list.map((s, i) => (
        <SignatureRow key={i} value={s} onChange={(next) => set(i, next)} onRemove={() => onChange(list.filter((_, j) => j !== i))} />
      ))}
      {list.length < max && (
        <button type="button" className="btn btn-sm btn-quiet" style={{ alignSelf: "flex-start" }} onClick={() => onChange([...list, { name: "", role: "", image: null }])}>
          <Plus size={14} /> Add a signature
        </button>
      )}
    </div>
  );
}

// How a signature shows on a printed page: the picture above a line, then
// the name and role.
export function SignatureBlock({ s, width = 200 }) {
  return (
    <div style={{ minWidth: width, textAlign: "center" }}>
      <div style={{ height: 56, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
        {s.image && <img src={s.image} alt="" style={{ maxHeight: 56, maxWidth: width }} />}
      </div>
      <div style={{ borderTop: "1px solid #111", paddingTop: 4, fontWeight: 600 }}>{s.name || " "}</div>
      {s.role && <div style={{ color: "#555", fontSize: 12 }}>{s.role}</div>}
    </div>
  );
}
