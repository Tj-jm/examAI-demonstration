import { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { useAiPictureMutation, useAiDiagramMutation } from "../api/aiImageApi";
import { ErrorNote } from "./bits";

// The AI button inside ImagePicker (backend/ai/images.js).
//
// kind "picture": a notice cover or landing image, made by the image model
// and saved straight away (onPicture gets the media).
// kind "diagram": a question or solution diagram, drawn by the text model as
// SVG, turned into a PNG here and handed back (onDiagram gets the blob) so
// the image editor opens on it for the teacher to check and fix.

// SVG to PNG at 2x, on white. Loaded as an <img>, so nothing in it can run.
const svgToPng = (svg) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => {
    const w = img.naturalWidth || 800;
    const h = img.naturalHeight || 500;
    const canvas = document.createElement("canvas");
    canvas.width = w * 2;
    canvas.height = h * 2;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't draw the diagram."))), "image/png");
  };
  img.onerror = () => reject(new Error("The AI's drawing couldn't be read. Try again."));
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
});

export default function AiImageButton({ kind = "picture", purpose = "notice", context = "", compact = false, defaultShape = "wide", label, onPicture, onDiagram }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [shape, setShape] = useState(defaultShape);
  const [localError, setLocalError] = useState(null);
  const [picture, pictureState] = useAiPictureMutation();
  const [diagram, diagramState] = useAiDiagramMutation();
  const busy = pictureState.isLoading || diagramState.isLoading;
  const error = localError || pictureState.error || diagramState.error;

  useEffect(() => {
    if (!open) return undefined;
    const esc = (e) => e.key === "Escape" && !busy && setOpen(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, busy]);

  const openDialog = () => {
    setLocalError(null);
    pictureState.reset();
    diagramState.reset();
    setText(kind === "picture" ? context : "");
    setOpen(true);
  };

  const run = async () => {
    setLocalError(null);
    try {
      if (kind === "picture") {
        const media = await picture({ prompt: text.trim(), purpose, shape }).unwrap();
        setOpen(false);
        onPicture(media);
      } else {
        const { svg } = await diagram({ prompt: text.trim(), context }).unwrap();
        const blob = await svgToPng(svg);
        setOpen(false);
        onDiagram(blob);
      }
    } catch (e) {
      if (!e?.data) setLocalError(e);
    }
  };

  const isPicture = kind === "picture";
  return (
    <>
      <button type="button" className={compact ? "icon-btn" : "btn btn-sm btn-quiet"} onClick={openDialog}
        title={isPicture ? "Make a picture with AI" : "Draw a diagram with AI"}>
        <Sparkles size={compact ? 15 : 13} />{!compact && (label || (isPicture ? "AI picture" : "AI diagram"))}
      </button>

      {open && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && setOpen(false)}>
          <div className="dialog stack" style={{ maxWidth: 480 }} role="dialog" aria-label={isPicture ? "AI picture" : "AI diagram"}>
            <div className="spread">
              <div className="row-tight"><Sparkles size={16} /><h3 style={{ margin: 0 }}>{isPicture ? "Make a picture" : "Draw a diagram"}</h3></div>
              <button type="button" className="icon-btn" onClick={() => setOpen(false)} disabled={busy} title="Close"><X size={15} /></button>
            </div>
            <label className="stack" style={{ gap: 6 }}>
              <span className="label">{isPicture ? "Describe the picture" : `What should it show?${context ? " (optional)" : ""}`}</span>
              <textarea
                className="textarea"
                rows={4}
                autoFocus
                value={text}
                placeholder={isPicture
                  ? "e.g. Students studying together in a bright library"
                  : "e.g. Two resistors of 4 Ω and 6 Ω in parallel across a 12 V battery"}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
            {isPicture && (
              <div className="row-tight" role="radiogroup" aria-label="Shape">
                <span className="label" style={{ marginRight: 4 }}>Shape</span>
                {[["wide", "Wide"], ["square", "Square"], ["tall", "Tall"]].map(([v, l]) => (
                  <button key={v} type="button" role="radio" aria-checked={shape === v}
                    className={`pill pill-btn${shape === v ? " pill-on" : ""}`} onClick={() => setShape(v)}>{l}</button>
                ))}
              </div>
            )}
            <span className="hint">
              {isPicture
                ? "No words are drawn into the picture. Put text in the notice itself."
                : `Made from ${context ? "the question text and " : ""}your description. It opens in the editor so you can check labels and values before saving.`}
            </span>
            <ErrorNote error={error} />
            <div className="row-tight" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
              <button type="button" className="btn" onClick={run} disabled={busy || (isPicture ? !text.trim() : !text.trim() && !context)}>
                <Sparkles size={14} /> {busy ? (isPicture ? "Making… (up to a minute)" : "Drawing…") : (isPicture ? "Make picture" : "Draw")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
