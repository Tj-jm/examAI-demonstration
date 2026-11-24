import { useRef, useEffect, useState } from "react";
import { X, Pencil, Circle, Check, Type, Eraser, Trash2, Save, Undo2, Hand, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { useSaveAnnotationMutation } from "../api/contentApi";
import useNoTouchSelect, { NO_TOUCH_SELECT } from "./useNoTouchSelect";

const PAGE_WIDTH = 800;
const COLORS = ["#e53935", "#1e88e5", "#43a047", "#000000"];

// A saved annotation is the overlay alone — pen strokes, shape stamps, and
// typed notes on an otherwise transparent canvas — never the background
// baked in together with it. That's what keeps this genuinely re-editable:
// the background (the student's original text/images) is regenerated fresh
// every time this opens, and the eraser only ever has to clear pixels on
// this one layer. Flattening the two together on save would have looked
// identical the first time, but reopening it later would have made every
// past mark a permanent, un-erasable part of the "original" content.
export default function ScriptDoodler({ submission, answer, onClose, totalMarks, draft, onDraftChange, onSaveMark, savingMark, isGraded }) {
  const bgCanvasRef = useRef(null);
  const annotCanvasRef = useRef(null);
  const wrapRef = useRef(null);
  const drawing = useRef(false);
  const lastPoint = useRef(null);
  const history = useRef([]);

  // On a touch screen it opens on "Move", so a finger scrolls and pinches
  // the script instead of drawing on it; pick Pen to mark.
  // A mark above what the answer is out of can't be saved.
  const overMax = Boolean(totalMarks) && draft !== "" && Number(draft) > Number(totalMarks);
  const [tool, setTool] = useState(() => (typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches ? "move" : "pen"));
  // Page width on screen: 1 = the page's own 800px; "fit" = the box's width.
  const [zoom, setZoom] = useState("fit");
  const [color, setColor] = useState(COLORS[0]);
  const [textPrompt, setTextPrompt] = useState(null); // { x, y } while placing a note
  const [textDraft, setTextDraft] = useState("");
  const [canvasSize, setCanvasSize] = useState({ w: PAGE_WIDTH, h: 400 });
  // While moving, touches must reach the browser so it can scroll.
  useNoTouchSelect(annotCanvasRef, true, { menusOnly: tool === "move" });
  const [ready, setReady] = useState(false);
  const [saveAnnotation, { isLoading: saving, error: saveError }] = useSaveAnnotationMutation();
  const [saved, setSaved] = useState(false);

  // Rebuilds the background canvas every time this opens. If this answer
  // already has a saved annotatedImage, that becomes the background as-is
  // — it already contains the student's original text/images plus every
  // mark from every past session, flattened together. Only when nothing
  // has ever been saved does this fall back to rendering the student's
  // raw answerText/answerImages from scratch. Either way, the annotation
  // layer itself always starts blank: new marks this session, not a
  // replay of old ones (those are already baked into the background).
  useEffect(() => {
    let cancelled = false;
    const imageUrl = (index) => `/api/grading/${submission._id}/answers/${answer._id}/images/${index}`;

    (async () => {
      const bg = bgCanvasRef.current;
      const ctx = bg.getContext("2d");

      if (answer.annotatedImage) {
        try {
          const img = await loadImage(imageUrl("annotated"));
          if (cancelled) return;
          bg.width = img.width;
          bg.height = img.height;
          ctx.drawImage(img, 0, 0);

          const annot = annotCanvasRef.current;
          annot.width = img.width;
          annot.height = img.height;
          annot.getContext("2d").clearRect(0, 0, img.width, img.height);

          history.current = [annot.getContext("2d").getImageData(0, 0, img.width, img.height)];
          setCanvasSize({ w: img.width, h: img.height });
          setReady(true);
          return;
        } catch {
          // A previously-saved image that fails to load falls through to
          // rebuilding from the raw answer below, rather than leaving the
          // tool stuck unable to open at all.
        }
      }

      const blocks = [];
      let y = 0;

      if (answer.answerText?.trim()) {
        ctx.font = "16px system-ui, sans-serif";
        const lines = wrapText(ctx, answer.answerText.trim(), PAGE_WIDTH - 80);
        const h = lines.length * 26 + 60;
        blocks.push({ kind: "text", lines, y: y + 30 });
        y += h;
      }

      if (answer.answerImages?.length > 0) {
        for (let i = 0; i < answer.answerImages.length; i += 1) {
          try {
            const img = await loadImage(imageUrl(i));
            const w = PAGE_WIDTH - 40;
            const h = (img.height / img.width) * w;
            blocks.push({ kind: "image", img, x: 20, y: y + 20, w, h });
            y += h + 40;
          } catch {
            // A broken/unreachable image just gets skipped — one bad url
            // shouldn't stop the rest of the script from being usable.
          }
        }
      }

      const totalHeight = Math.max(y + 20, 300);
      if (cancelled) return;

      bg.width = PAGE_WIDTH;
      bg.height = totalHeight;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, PAGE_WIDTH, totalHeight);
      ctx.fillStyle = "#1a1a1a";
      ctx.font = "16px system-ui, sans-serif";

      for (const block of blocks) {
        if (block.kind === "text") {
          let ty = block.y;
          for (const line of block.lines) {
            ctx.fillText(line, 40, ty);
            ty += 26;
          }
        } else {
          ctx.drawImage(block.img, block.x, block.y, block.w, block.h);
        }
      }

      const annot = annotCanvasRef.current;
      annot.width = PAGE_WIDTH;
      annot.height = totalHeight;
      annot.getContext("2d").clearRect(0, 0, PAGE_WIDTH, totalHeight);

      history.current = [annot.getContext("2d").getImageData(0, 0, PAGE_WIDTH, totalHeight)];
      setCanvasSize({ w: PAGE_WIDTH, h: totalHeight });
      setReady(true);
    })();

    return () => { cancelled = true; };
  }, [answer]);

  const pushHistory = () => {
    const ctx = annotCanvasRef.current.getContext("2d");
    history.current.push(ctx.getImageData(0, 0, canvasSize.w, canvasSize.h));
    if (history.current.length > 25) history.current.shift();
  };

  const undo = () => {
    if (history.current.length <= 1) return;
    history.current.pop();
    const snapshot = history.current[history.current.length - 1];
    annotCanvasRef.current.getContext("2d").putImageData(snapshot, 0, 0);
  };

  const clearAll = () => {
    const ctx = annotCanvasRef.current.getContext("2d");
    pushHistory();
    ctx.clearRect(0, 0, canvasSize.w, canvasSize.h);
  };

  // The fit width as a zoom factor, so +/- step on from what's shown.
  const fitZoom = () => Math.min(1, (wrapRef.current?.clientWidth || canvasSize.w) / canvasSize.w);

  const pointerPos = (e) => {
    const rect = annotCanvasRef.current.getBoundingClientRect();
    const scale = canvasSize.w / rect.width;
    return { x: (e.clientX - rect.left) * scale, y: (e.clientY - rect.top) * scale };
  };

  const stampShape = (ctx, shape, x, y) => {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 3;
    if (shape === "circle") {
      ctx.beginPath();
      ctx.ellipse(x, y, 26, 18, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (shape === "tick") {
      ctx.beginPath();
      ctx.moveTo(x - 14, y);
      ctx.lineTo(x - 4, y + 12);
      ctx.lineTo(x + 16, y - 14);
      ctx.stroke();
    } else if (shape === "cross") {
      ctx.beginPath();
      ctx.moveTo(x - 12, y - 12);
      ctx.lineTo(x + 12, y + 12);
      ctx.moveTo(x + 12, y - 12);
      ctx.lineTo(x - 12, y + 12);
      ctx.stroke();
    }
  };

  const onPointerDown = (e) => {
    if (tool === "move") return; // the browser scrolls and pinches
    e.preventDefault(); // no iPad selection menu on a held touch
    const { x, y } = pointerPos(e);

    if (tool === "text") {
      setTextPrompt({ x, y });
      setTextDraft("");
      return;
    }

    const ctx = annotCanvasRef.current.getContext("2d");
    pushHistory();

    if (tool === "circle" || tool === "tick" || tool === "cross") {
      stampShape(ctx, tool, x, y);
      return;
    }

    drawing.current = true;
    lastPoint.current = { x, y };
    annotCanvasRef.current.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e) => {
    if (!drawing.current) return;
    const { x, y } = pointerPos(e);
    const ctx = annotCanvasRef.current.getContext("2d");

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineWidth = 22;
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
    }

    ctx.beginPath();
    ctx.moveTo(lastPoint.current.x, lastPoint.current.y);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
    lastPoint.current = { x, y };
  };

  const onPointerUp = () => {
    drawing.current = false;
  };

  const placeText = () => {
    if (!textDraft.trim() || !textPrompt) { setTextPrompt(null); return; }
    const ctx = annotCanvasRef.current.getContext("2d");
    pushHistory();
    ctx.fillStyle = color;
    ctx.font = "italic 15px system-ui, sans-serif";
    ctx.fillText(textDraft.trim(), textPrompt.x, textPrompt.y);
    setTextPrompt(null);
    setTextDraft("");
  };

  const save = async () => {
    // Flattened here, not kept as two separate layers server-side — this
    // combined image is what a teacher's "Grade with AI" reasoning,
    // another teacher opening this later, and the student's own result
    // page all see from now on. Reopening the doodler itself uses this
    // exact flattened image as its next background (see the effect
    // above), so a second editing pass draws on top of everything from
    // the first, the same way a real second pass with a pen would.
    const combined = document.createElement("canvas");
    combined.width = canvasSize.w;
    combined.height = canvasSize.h;
    const cctx = combined.getContext("2d");
    cctx.drawImage(bgCanvasRef.current, 0, 0);
    cctx.drawImage(annotCanvasRef.current, 0, 0);

    const blob = await new Promise((resolve) => combined.toBlob(resolve, "image/png"));
    const file = new File([blob], "annotation.png", { type: "image/png" });
    await saveAnnotation({ submissionId: submission._id, answerId: answer._id, file }).unwrap();
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog stack" style={{ width: "min(1400px, 96vw)", maxWidth: "min(1400px, 96vw)", maxHeight: "92vh" }}>
        <div className="spread">
          <div className="row-tight">
            <Pencil size={16} />
            <h3 style={{ margin: 0 }}>Script view</h3>
          </div>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="row-tight" style={{ flexWrap: "wrap", gap: 6 }}>
          {[
            ["move", Hand, "Move"],
            ["pen", Pencil, "Pen"],
            ["circle", Circle, "Circle"],
            ["tick", Check, "Tick"],
            ["cross", X, "Cross"],
            ["text", Type, "Add note"],
            ["eraser", Eraser, "Eraser"],
          ].map(([key, Icon, label]) => (
            <button
              key={key}
              type="button"
              title={label}
              className={`btn btn-sm ${tool === key ? "" : "btn-quiet"}`}
              onClick={() => setTool(key)}
            >
              <Icon size={14} /> {label}
            </button>
          ))}

          <span style={{ width: 1, alignSelf: "stretch", background: "var(--border)" }} />

          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              title={c}
              style={{
                width: 22, height: 22, borderRadius: "50%", background: c, cursor: "pointer",
                border: color === c ? "2px solid var(--fg, #fff)" : "2px solid transparent",
                boxShadow: "0 0 0 1px var(--border)",
              }}
            />
          ))}

          <span style={{ width: 1, alignSelf: "stretch", background: "var(--border)" }} />

          <button type="button" className="icon-btn" title="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, (z === "fit" ? fitZoom() : z) - 0.25))}><ZoomOut size={14} /></button>
          <button type="button" className="icon-btn" title="Zoom in" onClick={() => setZoom((z) => Math.min(3, (z === "fit" ? fitZoom() : z) + 0.25))}><ZoomIn size={14} /></button>
          <button type="button" className="icon-btn" title="Fit to width" onClick={() => setZoom("fit")}><Maximize2 size={14} /></button>

          <span style={{ width: 1, alignSelf: "stretch", background: "var(--border)" }} />

          <button type="button" className="icon-btn" title="Undo" onClick={undo}><Undo2 size={14} /></button>
          <button type="button" className="icon-btn icon-btn-danger" title="Clear all marks" onClick={clearAll}><Trash2 size={14} /></button>
        </div>

        <p className="hint" style={{ margin: 0 }}>
          Saving replaces the script shown everywhere — the grading queue, the student's own result, and
          this view next time it's opened — with the marked-up version. The eraser only removes marks made
          in this session; anything saved in an earlier session is already part of the page itself.
        </p>

        {saveError && <div className="banner banner-bad">{saveError.data?.message || "Could not save this."}</div>}

        <div
          ref={wrapRef}
          style={{
            position: "relative", overflow: "auto", maxHeight: "62vh", border: "1px solid var(--border)",
            borderRadius: 8, background: "#2a2a2a",
          }}
        >
          <div style={{ position: "relative", width: zoom === "fit" ? "100%" : canvasSize.w * zoom, maxWidth: zoom === "fit" ? canvasSize.w : "none", margin: "0 auto" }}>
            <canvas ref={bgCanvasRef} style={{ display: "block", width: "100%" }} />
            <canvas
              ref={annotCanvasRef}
              style={{ ...NO_TOUCH_SELECT, position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: tool === "move" ? "pan-x pan-y pinch-zoom" : "none", cursor: tool === "move" ? "grab" : tool === "text" ? "text" : "crosshair" }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
            />
            {textPrompt && (
              <div
                className="row-tight"
                style={{
                  position: "absolute", left: (textPrompt.x / canvasSize.w) * 100 + "%", top: (textPrompt.y / canvasSize.h) * 100 + "%",
                  background: "var(--surface, #1c1c1c)", padding: 6, borderRadius: 6, boxShadow: "0 4px 14px rgba(0,0,0,0.4)", zIndex: 5,
                }}
              >
                <input
                  autoFocus
                  className="input"
                  style={{ width: 160 }}
                  value={textDraft}
                  onChange={(e) => setTextDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") placeText(); if (e.key === "Escape") setTextPrompt(null); }}
                  placeholder="Note…"
                />
                <button className="btn btn-sm" onClick={placeText}>Add</button>
              </div>
            )}
          </div>
          {!ready && <div className="hint" style={{ padding: 16 }}>Loading script…</div>}
        </div>

        <div className="spread" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
          <div className="row" style={{ alignItems: "flex-end" }}>
            <div className="field">
              <span className="label">Marks{totalMarks ? ` (of ${totalMarks})` : ""}</span>
              <input
                className="input tnum"
                type="number"
                min="0"
                max={totalMarks || undefined}
                step="0.5"
                style={{ width: 90 }}
                value={draft}
                onChange={(e) => onDraftChange(e.target.value)}
              />
              {overMax && <span className="hint" style={{ color: "var(--bad, #e53935)" }}>Out of {totalMarks}</span>}
            </div>
            <button
              className="btn btn-sm"
              disabled={savingMark || draft === "" || overMax}
              onClick={() => onSaveMark(Number(draft))}
            >
              {isGraded ? "Update mark" : "Save mark"}
            </button>
          </div>

          <div className="row-tight">
            <button className="btn btn-sm btn-quiet" onClick={onClose}>Close</button>
            <button className="btn btn-sm btn-quiet" disabled={saving || !ready} onClick={save}>
              <Save size={14} /> {saving ? "Saving…" : saved ? "Saved ✓" : "Save markup"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function wrapText(ctx, text, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Pages come through this server (gradingController getAnswerImage), not
// straight from storage: a canvas that is saved needs same-origin images,
// and storage on another host often sends no CORS headers.
async function loadImage(url) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`Image ${res.status}`);
  const objectUrl = URL.createObjectURL(await res.blob());
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = objectUrl;
    });
  } finally {
    // The image is decoded once loaded; drawImage doesn't need the url.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
}
