import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { Clapperboard, Sparkles, Mic, Trash2, Plus, X, Eye, EyeOff, Save, ChevronUp, ChevronDown, RotateCcw, Play, Crop, Wand2, Copy, CopyPlus, ClipboardPaste, Smile } from "lucide-react";
import {
  useGetVideoLessonQuery, useGenerateVideoLessonMutation, useUpdateVideoLessonMutation,
  useVoiceVideoLessonMutation, useStopVideoLessonVoiceMutation, useDeleteVideoLessonMutation, useReviseVideoLessonPartMutation, useHumanizeVideoLessonPartMutation,
  useGetLectureQuery,
} from "../api/contentApi";
import { useAiDiagramMutation } from "../api/aiImageApi";
import { ErrorNote, Field, useConfirm } from "./bits";
import BoardPlayer, { MarkShapes, ItemPreview } from "./BoardPlayer";
import { sentencesOf, cueIndex } from "./boardTimeline";
import VideoExport from "./VideoExport";
import DrawPad from "./DrawPad";
import ImageEditor from "./ImageEditor";

// The AI video lesson for a question's solution or a lecture: write the
// script with AI, edit it, add the voice, preview, publish, and record it
// as a video file. Backend: controllers/admin/videoLessonController.js.
const ITEM_TYPES = [
  ["heading", "Heading"], ["text", "Text"], ["math", "Equation"], ["list", "List"], ["table", "Table"],
  ["answer", "Answer box"], ["callout", "Callout / thought"], ["code", "Code"], ["output", "Program output"], ["image", "Picture"], ["aipicture", "AI picture"], ["diagram", "AI diagram"], ["highlight", "Highlight earlier"],
  ["pause", "Pause (hold the board)"], ["clip", "Video clip"], ["newBoard", "Clear board"],
  ["sequence", "Picture sequence (flipbook)"], ["camera", "Camera zoom"], ["remove", "Remove / cross out earlier"],
  ["graph", "Graph (plotted)"], ["numberline", "Number line"],
];
// Effects (BoardPlayer.jsx): how an item comes on, how a highlight marks,
// how a removal looks, a picture's slow zoom or pan.
const ENTERS = [["", "Fade up (default)"], ["slide", "Slide in"], ["pop", "Pop"], ["zoom", "Zoom in"], ["wipe", "Wipe"], ["write", "Handwritten"], ["draw", "Draw / reveal"], ["type", "Typewriter"], ["morph", "Change in place"]];
const EMPHASES = [["glow", "Glow"], ["pulse", "Pulse"], ["underline", "Underline"], ["circle", "Circle"], ["arrow", "Arrow"], ["spotlight", "Spotlight (dim the rest)"], ["point", "Pointer moves to it"]];
const EXITS = [["fade", "Fade away"], ["strike", "Strike through"], ["cross", "Cross out"]];
const MOTIONS = [["", "Still"], ["in", "Slow zoom in"], ["out", "Slow zoom out"], ["left", "Slow pan left"], ["right", "Slow pan right"]];
const ZOOMS = [1.3, 1.6, 2, 2.5, 3];
const BACKGROUNDS = [["", "Lesson board"], ["whiteboard", "Whiteboard"], ["blackboard", "Blackboard"], ["greenboard", "Greenboard"], ["dark", "Dark"]];
const LAYOUTS = [["", "Stacked"], ["center", "Centred (title card)"], ["split", "Split (pictures right)"]];
const CODE_LANGS = [["", "Plain"], ["c", "C"], ["cpp", "C++"], ["python", "Python"], ["java", "Java"], ["javascript", "JavaScript"], ["html", "HTML"], ["sql", "SQL"]];
const NO_ENTER = ["newBoard", "pause", "highlight", "remove", "camera"];
// A picture file from a paste or a drop, if there is one.
const pictureFileOf = (dt) => [...(dt?.files || [])].find((f) => /^image\/(png|jpeg|webp)$/.test(f.type)) || null;
const sendPicture = async (lessonId, file) => {
  const res = await fetch(`/api/video-lessons/${lessonId}/image`, { method: "POST", credentials: "include", headers: { "Content-Type": file.type }, body: file });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || `Upload failed (${res.status}).`);
  return body;
};
// What AI can do to one part (backend videoLessonController reviseSegment).
const PART_ACTIONS = [["redo", "Again"], ["elaborate", "More detail"], ["concise", "Shorter"], ["simpler", "Simpler"], ["custom", "As I say…"]];
const MAX_ITEMS = 20;
// The first words of a sentence: how a pause names the sentence it follows.
const opening = (sentence) => sentence.split(/\s+/).slice(0, 6).join(" ");
const CALLOUT_KINDS = [["think", "Thought"], ["idea", "Key idea"], ["tip", "Tip"], ["warning", "Common mistake"], ["note", "Note"], ["question", "Ask yourself"]];
// The pictures in a lecture's written notes (markdown image links), in order.
const notePicturesOf = (markdown) => {
  const out = [];
  for (const m of (markdown || "").matchAll(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g)) {
    if (!out.some((x) => x.url === m[2])) out.push({ name: m[1], url: m[2] });
  }
  return out;
};
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Mark colours; null: the video's own mark colour.
const MARK_COLORS = [[null, "Default"], ["#e8590c", "Orange"], ["#e53935", "Red"], ["#1e88e5", "Blue"], ["#2e7d32", "Green"], ["#8e24aa", "Purple"], ["#f9a825", "Yellow"], ["#212121", "Black"], ["#ffffff", "White"]];
const withColor = (m, c) => { const { color, ...rest } = m; return c ? { ...rest, color: c } : rest; };
function ColorDots({ value, onPick }) {
  return (
    <span className="row-tight" style={{ gap: 3 }}>
      {MARK_COLORS.map(([c, l]) => (
        <button key={l} type="button" title={l} onClick={(e) => { e.stopPropagation(); onPick(c); }}
          style={{ width: 18, height: 18, borderRadius: "50%", padding: 0, cursor: "pointer", border: (value || null) === c ? "2px solid var(--accent, #2f6fdf)" : "1px solid rgba(128,128,128,0.5)",
            background: c || "repeating-linear-gradient(45deg, #e8590c 0 4px, #fff 4px 8px)", boxShadow: (value || null) === c ? "0 0 0 2px #fff inset" : "none" }} />
      ))}
    </span>
  );
}

// The board in its own browser window, so it can sit beside (or on another
// screen from) the script being edited. Still part of this page: play
// position, follow and jumps work as before. Closing that window brings it back.
export function PopOut({ title, onClose, children }) {
  const [box, setBox] = useState(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const w = window.open("", "examai-video-board", "width=960,height=600");
    if (!w) { closeRef.current("blocked"); return undefined; }
    const d = w.document;
    d.title = title;
    d.head.innerHTML = "";
    d.body.innerHTML = "";
    for (const a of document.documentElement.attributes) d.documentElement.setAttribute(a.name, a.value);
    document.querySelectorAll('link[rel="stylesheet"], style').forEach((n) => d.head.appendChild(n.cloneNode(true)));
    d.body.style.cssText = "margin:0;padding:12px;background:var(--surface, #fff);box-sizing:border-box";
    const div = d.createElement("div");
    d.body.appendChild(div);
    setBox(div);
    const gone = () => closeRef.current();
    w.addEventListener("pagehide", gone);
    return () => { w.removeEventListener("pagehide", gone); w.close(); setBox(null); };
  }, [title]);
  return box ? createPortal(children, box) : null;
}

const MARK_TOOLS = [["circle", "Circle"], ["dashcircle", "Dashed circle"], ["oval", "Oval"], ["dashoval", "Dashed oval"], ["arrow", "Arrow"], ["double", "Double arrow"], ["dasharrow", "Dashed arrow"], ["underline", "Line"], ["dashed", "Dashed line"],
  ["box", "Box"], ["dashbox", "Dashed box"], ["highlight", "Highlighter"], ["dim", "Dim the rest"], ["cross", "Cross"], ["tick", "Tick"], ["number", "Number"], ["label", "Label"]];

// Copy and paste of a part or a board item, between parts and between
// videos (kept in this browser, so another video's editor can paste it).
const CLIP_KEY = "examai.videoClipboard";
const readClip = () => {
  try { return JSON.parse(localStorage.getItem(CLIP_KEY) || "null"); } catch { return null; }
};
function useVideoClipboard() {
  const [clip, setClip] = useState(readClip);
  useEffect(() => {
    const sync = (e) => { if (!e || e.key === CLIP_KEY) setClip(readClip()); };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  const copy = (value) => {
    try { localStorage.setItem(CLIP_KEY, JSON.stringify(value)); } catch { /* storage off: this tab only */ }
    setClip(value);
  };
  const clear = () => { try { localStorage.removeItem(CLIP_KEY); } catch { /* storage off */ } setClip(null); };
  return { clip, copy, clear };
}
const plain = (x) => JSON.parse(JSON.stringify(x));
// A board item made ready for another video: its question or solution
// picture becomes an upload of that same file, and a highlight of an
// earlier item loses its pointer (it named a place in the old video).
const portItem = (b, fromLesson, toLesson) => {
  const item = plain(b);
  if (!fromLesson || fromLesson._id === toLesson._id) return item;
  if (item.type === "image" && (item.src === "question" || item.src === "solution" || !item.src)) {
    const url = item.src === "solution" ? fromLesson.solutionImageUrl : fromLesson.imageUrl;
    return { ...item, src: "upload", media: null, url: url || null };
  }
  if (item.type === "highlight") return { ...item, ref: null };
  return item;
};
// Pasted at part `part`, after `at` items already there. In a copied group,
// a highlight, camera or remove step aimed at another item of the group is
// aimed at its pasted copy; aimed elsewhere, it keeps an earlier part's
// item in the same video, else it's cleared (pick the target again).
const pasteItems = (clip, lesson, part, at) => {
  const keys = clip?.keys || [];
  const map = new Map(keys.map((k, j) => [k, `${part}-${at + j}`]));
  const same = !clip?.from || clip.from._id === lesson._id;
  return (clip?.items || []).map((b) => {
    const item = portItem(b, clip.from, lesson);
    if (!b.ref || !["highlight", "camera", "remove"].includes(b.type)) return item;
    if (map.has(b.ref)) return { ...item, ref: map.get(b.ref) };
    const refPart = Number(String(b.ref).split("-")[0]);
    return { ...item, ref: same && refPart < part ? b.ref : null };
  });
};

const draftOf = (lesson) => ({
  title: lesson.title,
  look: lesson.look || null,
  segments: lesson.segments.map((s) => ({ _id: s._id, say: s.say, background: s.background || null, layout: s.layout || null, board: s.board.map((b) => ({ ...b })) })),
});

// A short name for a board item, for the highlight picker.
const itemLabel = (b) => {
  if (b.type === "sequence") return `Picture sequence (${(b.frames || []).length})`;
  const t = b.text || b.latex || (b.items || []).join(", ") || (b.fns || []).map((f) => f.expr).join(", ") || (b.rows || []).map((r) => r.join(" ")).join(" / ") || b.caption || b.prompt || b.type;
  return String(t).replace(/[$=]/g, "").slice(0, 50);
};

// Marks over a picture: pick a tool, then click (circle: one side, then
// the opposite side, so it passes through both; arrow and underline:
// start, then end; box and dim: two corners; label: where it goes).
function MarkEditor({ url, marks, onChange, onClose }) {
  const [tool, setTool] = useState("circle");
  const [first, setFirst] = useState(null);
  const [labelText, setLabelText] = useState("");
  const [color, setColor] = useState(null);
  const [aspect, setAspect] = useState(0.75);
  const boxRef = useRef(null);
  const at = (e) => {
    const r = boxRef.current.getBoundingClientRect();
    return { x: Math.round(((e.clientX - r.left) / r.width) * 1000) / 10, y: Math.round(((e.clientY - r.top) / r.height) * 1000) / 10 };
  };
  const click = (e) => {
    const p = at(e);
    if (tool === "number") {
      const n = labelText.trim() || String(marks.filter((m) => m.kind === "number").length + 1);
      onChange([...marks, withColor({ kind: "number", x: p.x, y: p.y, text: n.slice(0, 3) }, color)]);
      return;
    }
    if (tool === "label") {
      if (!labelText.trim()) return;
      onChange([...marks, withColor({ kind: "label", x: p.x, y: p.y, text: labelText.trim() }, color)]);
      return;
    }
    if (!first) { setFirst(p); return; }
    if (tool === "circle" || tool === "dashcircle") {
      // Stored as centre and a point on the edge: the middle of the two
      // clicks, and the second click.
      const cx = Math.round(((first.x + p.x) / 2) * 10) / 10;
      const cy = Math.round(((first.y + p.y) / 2) * 10) / 10;
      onChange([...marks, withColor({ kind: tool, x: cx, y: cy, x2: p.x, y2: p.y }, color)]);
      setFirst(null);
      return;
    }
    onChange([...marks, withColor({ kind: tool, x: first.x, y: first.y, x2: p.x, y2: p.y }, color)]);
    setFirst(null);
  };
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(10,12,18,0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div className="card stack" style={{ maxWidth: 900, width: "100%", maxHeight: "94vh", overflow: "auto" }}>
        <div className="spread">
          <strong>Marks on the picture</strong>
          <button type="button" className="btn btn-sm btn-primary" onClick={onClose}>Done</button>
        </div>
        <div className="row-tight" style={{ gap: 6, flexWrap: "wrap" }}>
          {MARK_TOOLS.map(([v, l]) => (
            <button key={v} type="button" className={`btn btn-sm ${tool === v ? "btn-primary" : "btn-quiet"}`} onClick={() => { setTool(v); setFirst(null); }}>{l}</button>
          ))}
          {tool === "label" && <input className="input" style={{ width: 180 }} value={labelText} placeholder="Label text, maths as $x^2$" onChange={(e) => setLabelText(e.target.value)} />}
          {tool === "number" && <input className="input" style={{ width: 90 }} value={labelText} maxLength={3} placeholder="auto 1, 2…" onChange={(e) => setLabelText(e.target.value)} />}
          <span className="hint">
            {tool === "label" ? "Type the label, then click where it goes." : tool === "number" ? "Click where each number goes (empty: counts up)." : first ? "Now click the end point." : tool === "circle" || tool === "dashcircle" ? "Click one side, then the opposite side: the circle passes through both." : ["oval", "dashoval", "box", "dashbox", "highlight", "dim", "cross", "tick"].includes(tool) ? "Click one corner, then the opposite corner." : "Click the start, then the end."}
          </span>
        </div>
        <div className="row-tight" style={{ gap: 8, flexWrap: "wrap" }}>
          <span className="small muted">Colour of new marks</span>
          <ColorDots value={color} onPick={setColor} />
        </div>
        <div ref={boxRef} onClick={click} style={{ position: "relative", alignSelf: "center", cursor: "crosshair", lineHeight: 0 }}>
          <img src={url} alt="" style={{ maxWidth: "100%", maxHeight: "60vh", display: "block" }} draggable={false}
            onLoad={(e) => e.currentTarget.naturalWidth && setAspect(e.currentTarget.naturalHeight / e.currentTarget.naturalWidth)} />
          <MarkShapes marks={marks} color="#e8590c" aspect={aspect} />
          {first && <span style={{ position: "absolute", left: `${first.x}%`, top: `${first.y}%`, width: 8, height: 8, marginLeft: -4, marginTop: -4, borderRadius: "50%", background: "#e53935" }} />}
        </div>
        <div className="stack" style={{ gap: 4 }}>
          {marks.map((m, i) => (
            <div key={i} className="row-tight small" style={{ gap: 8 }}>
              <span className="grow">{i + 1}. {m.kind}{m.text ? `: ${m.text}` : ""}</span>
              <ColorDots value={m.color} onPick={(c) => onChange(marks.map((x, j) => (j === i ? withColor(x, c) : x)))} />
              <button type="button" className="icon-btn icon-btn-danger" title="Remove" onClick={() => onChange(marks.filter((_, j) => j !== i))}><X size={13} /></button>
            </div>
          ))}
          {!marks.length && <span className="hint">No marks yet. They are drawn in order, one after another, when the picture appears.</span>}
        </div>
      </div>
    </div>
  );
}

// When an item appears: as the voice says its cue, or with the item before.
function CueEditor({ item, say, first, onChange }) {
  const found = !item.cue || cueIndex(say, item.cue) >= 0;
  return (
    <div className="row-tight small" style={{ gap: 8, flexWrap: "wrap", paddingLeft: 4 }}>
      <span className="muted">Appears</span>
      {!first && (
        <label className="row-tight" style={{ gap: 4 }}>
          <input type="checkbox" checked={Boolean(item.with)} onChange={(e) => onChange({ ...item, with: e.target.checked, ...(e.target.checked ? { cue: "" } : {}) })} />
          with the item above
        </label>
      )}
      {!item.with && (
        <>
          <span className="muted">when the voice says</span>
          <input className="input" style={{ width: 220, padding: "3px 8px", fontSize: 13, borderColor: found ? undefined : "var(--danger, #c62828)" }} value={item.cue || ""}
            placeholder="a few words from the narration" onChange={(e) => onChange({ ...item, cue: e.target.value })} />
          <span className="hint" style={{ color: found ? undefined : "var(--danger, #c62828)" }}>
            {item.cue ? (found ? "✓" : "Not in the narration: it will be timed between its neighbours.") : "Empty: timed between its neighbours."}
          </span>
        </>
      )}
    </div>
  );
}

// A clip: a short video uploaded here, or a part of the lecture's (or the
// solution's) own video. It plays on the board while the voice waits, at
// the place picked like a pause's.
const CLIP_MAX_MB = 100;
function ClipEditor({ item, lesson, sentences, onChange }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const preview = useRef(null);
  const source = lesson.sourceVideo;
  const fromSource = Boolean(source && item.media?.key && item.media.key === source.media.key);
  const upload = async (file) => {
    if (!file) return;
    if (file.size > CLIP_MAX_MB * 1e6) { setError(`Keep clips under ${CLIP_MAX_MB} MB: trim it first.`); return; }
    setUploading(true);
    setError("");
    try {
      const res = await fetch(`/api/video-lessons/${lesson._id}/clip`, { method: "POST", credentials: "include", headers: { "Content-Type": file.type }, body: file });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || `Upload failed (${res.status}).`);
      onChange({ ...item, media: body.media, url: body.url, start: 0 });
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  };
  const here = () => Math.round((preview.current?.currentTime || 0) * 10) / 10;
  const end = (Number(item.start) || 0) + (Number(item.seconds) || 0);
  return (
    <div className="grow stack" style={{ gap: 6 }}>
      <div className="row-tight" style={{ gap: 6, flexWrap: "wrap" }}>
        {source && (
          <select className="select" style={{ width: 190 }} value={fromSource ? "source" : "upload"}
            onChange={(e) => (e.target.value === "source" ? onChange({ ...item, media: source.media, url: source.url }) : onChange({ ...item, media: null, url: null, start: 0 }))}>
            <option value="upload">Uploaded clip</option>
            <option value="source">Part of {lesson.lecture ? "the lecture's" : "the solution"} video</option>
          </select>
        )}
        {!fromSource && (
          <label className="btn btn-sm" style={{ cursor: "pointer" }}>
            {uploading ? "Uploading…" : item.media?.key ? "Replace clip" : "Upload clip (MP4/WebM)"}
            <input type="file" accept="video/mp4,video/webm" hidden onChange={(e) => upload(e.target.files?.[0])} />
          </label>
        )}
        <label className="row-tight small" style={{ gap: 4 }}>
          <input type="checkbox" checked={item.sound !== false} onChange={(e) => onChange({ ...item, sound: e.target.checked })} /> Its own sound
        </label>
        <select className="select" style={{ width: 110 }} value={item.size || "large"} onChange={(e) => onChange({ ...item, size: e.target.value })}>
          <option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option><option value="full">Full board</option>
        </select>
      </div>
      {item.url && (
        <div className="row-tight" style={{ gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
          <video ref={preview} src={item.url} controls preload="metadata" style={{ height: 120, maxWidth: 220, borderRadius: 6, background: "#000" }}
            onLoadedMetadata={(e) => { e.currentTarget.currentTime = Number(item.start) || 0; }} />
          <div className="stack" style={{ gap: 6 }}>
            <div className="row-tight" style={{ gap: 6, flexWrap: "wrap" }}>
              <span className="small muted">From</span>
              <input className="input tnum" type="number" min={0} step={0.1} style={{ width: 80 }} value={item.start ?? 0} onChange={(e) => onChange({ ...item, start: Math.max(0, Number(e.target.value)) })} />
              <span className="small muted">s, for</span>
              <input className="input tnum" type="number" min={0.5} max={180} step={0.5} style={{ width: 80 }} value={item.seconds ?? 5} onChange={(e) => onChange({ ...item, seconds: Math.min(180, Math.max(0.5, Number(e.target.value))) })} />
              <span className="small muted">s</span>
            </div>
            <div className="row-tight" style={{ gap: 6, flexWrap: "wrap" }}>
              <button type="button" className="btn btn-sm btn-quiet" onClick={() => onChange({ ...item, start: here(), seconds: Math.max(0.5, Math.round((end - here()) * 10) / 10) || 5 })}>Start here</button>
              <button type="button" className="btn btn-sm btn-quiet" onClick={() => here() > (Number(item.start) || 0) && onChange({ ...item, seconds: Math.min(180, Math.round((here() - (Number(item.start) || 0)) * 10) / 10) })}>End here</button>
            </div>
            <span className="hint">Play the preview to the spot, then press Start here or End here. At most 3 minutes.</span>
          </div>
        </div>
      )}
      <div className="row-tight" style={{ gap: 6, flexWrap: "wrap" }}>
        <select className="select" style={{ width: 200 }} value={item.voice === "over" ? "over" : "pause"} onChange={(e) => onChange({ ...item, voice: e.target.value === "over" ? "over" : null, ...(e.target.value === "over" ? { duck: item.duck ?? 0.25 } : {}) })}>
          <option value="pause">Voice waits while it plays</option>
          <option value="over">Voice talks over it</option>
        </select>
        {item.voice === "over" ? (
          <label className="row-tight small" style={{ gap: 4 }} title="Its own sound under the voice">
            Its sound <input type="range" min={0} max={1} step={0.05} value={item.duck ?? 0.25} onChange={(e) => onChange({ ...item, duck: Number(e.target.value) })} style={{ width: 90 }} /> {Math.round((item.duck ?? 0.25) * 100)}%
          </label>
        ) : (
          <>
            <span className="small muted">plays</span>
            <select className="select" style={{ maxWidth: 300 }} value={item.after ?? ""} onChange={(e) => onChange({ ...item, after: e.target.value })}>
              <option value="^">at the start, before the voice begins</option>
              {sentences.slice(0, -1).map((x, i) => <option key={i} value={opening(x)}>after the sentence “{opening(x)}…”</option>)}
              <option value="">at the end, after the last sentence</option>
            </select>
          </>
        )}
        <span className="small muted">last frame holds</span>
        <input className="input tnum" type="number" min={0} max={10} step={0.5} style={{ width: 64 }} value={item.freeze ?? 0} onChange={(e) => onChange({ ...item, freeze: Number(e.target.value) || null })} />
        <span className="small muted">s</span>
        <input className="input grow" style={{ minWidth: 160 }} value={item.caption || ""} placeholder="Caption (optional)" onChange={(e) => onChange({ ...item, caption: e.target.value })} />
      </div>
      {item.voice === "over" && <span className="hint">Starts when the voice says the words below, and plays under it; its own sound is turned down.</span>}
      {item.voice !== "over" && item.media?.key && <ClipLines item={item} here={() => Math.max(0, Math.round((here() - (Number(item.start) || 0)) * 10) / 10)} onChange={onChange} />}
      {!item.media?.key && <span className="hint">{source ? "Upload a clip, or pick a part of the video." : "Upload a clip."}</span>}
      {error && <span className="small" style={{ color: "var(--danger, #c62828)" }}>{error}</span>}
    </div>
  );
}

// Lines spoken at set seconds into a clip (seconds from where the clip
// starts on the board). Each gets its own voice with "Make voice"; its own
// sound is turned down while one is spoken.
const lineSeconds = (l) => l.durationSeconds || Math.max(1, String(l.text || "").split(/\s+/).filter(Boolean).length / 2.4 + 0.3);
function ClipLines({ item, here, onChange }) {
  const lines = item.lines || [];
  const length = (Number(item.seconds) || 5) + (Number(item.freeze) || 0);
  const set = (next) => onChange({ ...item, lines: next });
  const edit = (i, patch) => set(lines.map((l, j) => (j === i ? { ...l, ...patch, ...(patch.text !== undefined ? { audioUrl: null, durationSeconds: null } : {}) } : l)));
  const add = (at) => set([...lines, { at: Math.min(length, at), text: "" }].sort((x, y) => x.at - y.at));
  return (
    <div className="stack" style={{ gap: 4 }}>
      <span className="small muted">Lines spoken during the clip (seconds from its start)</span>
      {lines.map((l, i) => {
        const next = lines[i + 1];
        const ends = (Number(l.at) || 0) + lineSeconds(l);
        const clash = next ? ends > (Number(next.at) || 0) + 0.05 : ends > length + 0.05;
        return (
          <div key={i} className="stack" style={{ gap: 2 }}>
            <div className="row-tight" style={{ gap: 6 }}>
              <input className="input tnum" type="number" min={0} max={length} step={0.1} style={{ width: 72 }} value={l.at ?? 0}
                onChange={(e) => edit(i, { at: Math.min(length, Math.max(0, Number(e.target.value) || 0)) })}
                onBlur={() => set([...lines].sort((x, y) => x.at - y.at))} />
              <span className="small muted">s</span>
              <input className="input grow" value={l.text || ""} maxLength={300} placeholder="What the voice says here" onChange={(e) => edit(i, { text: e.target.value })} />
              <span className="small muted tnum" title={l.durationSeconds ? "Voiced length" : "Estimated length"}>{l.durationSeconds ? "" : "~"}{lineSeconds(l).toFixed(1)}s</span>
              <button type="button" className="icon-btn icon-btn-danger" title="Remove line" onClick={() => set(lines.filter((_, j) => j !== i))}><X size={13} /></button>
            </div>
            {clash && l.text && <span className="small" style={{ color: "var(--warning, #b26a00)" }}>{next ? `Runs past ${next.at}s, where the next line starts.` : `Runs past the clip's end (${length}s): it is cut off.`}</span>}
          </div>
        );
      })}
      <div className="row-tight" style={{ gap: 6, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-sm btn-quiet" disabled={lines.length >= 20} onClick={() => add(lines.length ? Math.min(length, (Number(lines[lines.length - 1].at) || 0) + lineSeconds(lines[lines.length - 1])) : 0)}>Add line</button>
        <button type="button" className="btn btn-sm btn-quiet" disabled={lines.length >= 20} title="At where the preview is" onClick={() => add(here())}>Add line here</button>
        {lines.length > 0 && <span className="hint">Press Make voice after saving to voice new or changed lines.</span>}
      </div>
    </div>
  );
}

// Show only a part of a picture: drag a box over it.
function RegionPicker({ url, crop, onSave, onClose }) {
  const boxRef = useRef(null);
  const [box, setBox] = useState(crop || null);
  const [from, setFrom] = useState(null);
  const at = (e) => {
    const r = boxRef.current.getBoundingClientRect();
    return { x: Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)), y: Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100)) };
  };
  const span = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
  const round = (b) => ({ x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10, w: Math.round(b.w * 10) / 10, h: Math.round(b.h * 10) / 10 });
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(10,12,18,0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div className="card stack" style={{ maxWidth: 900, width: "100%", maxHeight: "94vh", overflow: "auto" }}>
        <div className="spread">
          <strong>Show only a part</strong>
          <div className="row-tight" style={{ gap: 6 }}>
            <button type="button" className="btn btn-sm btn-quiet" onClick={() => onSave(null)}>Whole picture</button>
            <button type="button" className="btn btn-sm" onClick={onClose}>Cancel</button>
            <button type="button" className="btn btn-sm btn-primary" disabled={!box || box.w < 5 || box.h < 5} onClick={() => onSave(round(box))}>Use this part</button>
          </div>
        </div>
        <span className="hint">Drag a box over the part to show. The picture itself isn't changed.</span>
        <div ref={boxRef} style={{ position: "relative", alignSelf: "center", cursor: "crosshair", lineHeight: 0, userSelect: "none", touchAction: "none" }}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); const p = at(e); setFrom(p); setBox({ ...p, w: 0, h: 0 }); }}
          onPointerMove={(e) => from && setBox(span(from, at(e)))}
          onPointerUp={(e) => { if (from) setBox(span(from, at(e))); setFrom(null); }}>
          <img src={url} alt="" draggable={false} style={{ maxWidth: "100%", maxHeight: "60vh", display: "block" }} />
          {box && <span style={{ position: "absolute", left: `${box.x}%`, top: `${box.y}%`, width: `${box.w}%`, height: `${box.h}%`, border: "2px solid #e53935", boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)" }} />}
        </div>
      </div>
    </div>
  );
}

// Where a camera move zooms: all of an earlier item, or a part of it
// dragged over the item as it shows on the board.
function AreaPicker({ target, lesson, area, onSave, onClose }) {
  const itemRef = useRef(null);
  const wrapRef = useRef(null);
  const [rect, setRect] = useState(null);
  const [box, setBox] = useState(area || null);
  const [from, setFrom] = useState(null);
  // The item's box inside the preview; again as its pictures load.
  useEffect(() => {
    const measure = () => {
      const el = itemRef.current;
      const wrap = wrapRef.current;
      if (!el || !wrap) return;
      const a = el.getBoundingClientRect();
      const b = wrap.getBoundingClientRect();
      setRect({ left: a.left - b.left, top: a.top - b.top, width: a.width, height: a.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (itemRef.current) ro.observe(itemRef.current);
    return () => ro.disconnect();
  }, []);
  const at = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)), y: Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100)) };
  };
  const span = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
  const round = (b) => ({ x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10, w: Math.round(b.w * 10) / 10, h: Math.round(b.h * 10) / 10 });
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(10,12,18,0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div className="card stack" style={{ maxWidth: 820, width: "100%", maxHeight: "94vh", overflow: "auto" }}>
        <div className="spread">
          <strong>Zoom on</strong>
          <div className="row-tight" style={{ gap: 6 }}>
            <button type="button" className="btn btn-sm btn-quiet" onClick={() => onSave(null)}>All of it</button>
            <button type="button" className="btn btn-sm" onClick={onClose}>Cancel</button>
            <button type="button" className="btn btn-sm btn-primary" disabled={!box || box.w < 5 || box.h < 5} onClick={() => onSave(round(box))}>This part</button>
          </div>
        </div>
        <span className="hint">Drag a box over the part to zoom on. The camera centres on it at the zoom you set.</span>
        <div style={{ overflowX: "auto" }}>
          <div ref={wrapRef} style={{ position: "relative", width: 760, margin: "0 auto", borderRadius: 8, overflow: "hidden" }}>
            <ItemPreview item={target.item} lesson={lesson} background={target.background} boxRef={itemRef} />
            {rect && (
              <div style={{ position: "absolute", ...rect, cursor: "crosshair", userSelect: "none", touchAction: "none", outline: "1px dashed rgba(128,128,128,0.7)" }}
                onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); const p = at(e); setFrom(p); setBox({ ...p, w: 0, h: 0 }); }}
                onPointerMove={(e) => from && setBox(span(from, at(e)))}
                onPointerUp={(e) => { if (from) setBox(span(from, at(e))); setFrom(null); }}>
                {box && <span style={{ position: "absolute", left: `${box.x}%`, top: `${box.y}%`, width: `${box.w}%`, height: `${box.h}%`, border: "2px solid #e53935", boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)", pointerEvents: "none" }} />}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// A picture sequence: pictures shown one after another in one place.
function SequenceEditor({ item, lesson, say, notePictures, onChange }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const frames = item.frames || [];
  const setFrames = (next) => onChange({ ...item, frames: next });
  const add = async (files) => {
    const list = [...(files || [])].filter((f) => /^image\/(png|jpeg|webp)$/.test(f.type)).slice(0, 12 - frames.length);
    if (!list.length) return;
    setBusy(true);
    setError("");
    try {
      const added = [];
      for (const f of list) {
        const body = await sendPicture(lesson._id, f);
        added.push({ media: body.media, url: body.url, cue: "", caption: "" });
      }
      setFrames([...frames, ...added]);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const fromNotes = async (url) => {
    if (!url) return;
    try {
      const blob = await (await fetch(url, { credentials: "include" })).blob();
      if (!blob.type.startsWith("image/")) throw new Error("That picture could not be read.");
      await add([new File([blob], "notes-picture", { type: blob.type })]);
    } catch (e) {
      setError(e.message);
    }
  };
  const move = (i, d) => {
    const next = [...frames];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setFrames(next);
  };
  return (
    <div className="grow stack" style={{ gap: 6 }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); add(e.dataTransfer?.files); }}
      onPaste={(e) => { const f = pictureFileOf(e.clipboardData); if (f) { e.preventDefault(); add([f]); } }}>
      <div className="row-tight" style={{ gap: 6, flexWrap: "wrap" }}>
        <label className="btn btn-sm" style={{ cursor: "pointer" }}>
          {busy ? "Uploading…" : "Add pictures"}
          <input type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => add(e.target.files)} />
        </label>
        {notePictures.length > 0 && (
          <select className="select" style={{ width: 170 }} value="" disabled={busy} onChange={(e) => fromNotes(e.target.value)}>
            <option value="">From the notes…</option>
            {notePictures.map((p, n) => <option key={p.url} value={p.url}>{p.name || `Picture ${n + 1}`}</option>)}
          </select>
        )}
        <span className="small muted">each</span>
        <input className="input tnum" type="number" min={0.3} max={10} step={0.1} style={{ width: 70 }} value={item.seconds ?? 1} onChange={(e) => onChange({ ...item, seconds: Number(e.target.value) })} />
        <span className="small muted">s</span>
        <select className="select" style={{ width: 110 }} value={item.transition || "fade"} onChange={(e) => onChange({ ...item, transition: e.target.value })}>
          <option value="fade">Crossfade</option><option value="cut">Cut</option>
        </select>
        <label className="row-tight small" style={{ gap: 4 }}><input type="checkbox" checked={Boolean(item.loop)} onChange={(e) => onChange({ ...item, loop: e.target.checked })} /> Loop</label>
        <select className="select" style={{ width: 110 }} value={item.size || "medium"} onChange={(e) => onChange({ ...item, size: e.target.value })}>
          <option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option><option value="full">Full board</option>
        </select>
      </div>
      {frames.map((f, i) => {
        const found = !f.cue || cueIndex(say, f.cue) >= 0;
        return (
          <div key={i} className="row-tight" style={{ gap: 6, flexWrap: "wrap" }}>
            <span className="small muted tnum" style={{ width: 18 }}>{i + 1}</span>
            {f.url ? <img src={f.url} alt="" style={{ height: 44, maxWidth: 80, objectFit: "contain", borderRadius: 4, background: "#fff" }} /> : <span className="hint">missing</span>}
            <input className="input" style={{ width: 200, borderColor: found ? undefined : "var(--danger, #c62828)" }} value={f.cue || ""} placeholder={i ? "shows when the voice says…" : "first: with the item"}
              onChange={(e) => setFrames(frames.map((x, j) => (j === i ? { ...x, cue: e.target.value } : x)))} />
            <input className="input grow" style={{ minWidth: 120 }} value={f.caption || ""} placeholder="Caption (optional)" onChange={(e) => setFrames(frames.map((x, j) => (j === i ? { ...x, caption: e.target.value } : x)))} />
            <button type="button" className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)}><ChevronUp size={13} /></button>
            <button type="button" className="icon-btn" disabled={i === frames.length - 1} onClick={() => move(i, 1)}><ChevronDown size={13} /></button>
            <button type="button" className="icon-btn icon-btn-danger" onClick={() => setFrames(frames.filter((_, j) => j !== i))}><X size={13} /></button>
          </div>
        );
      })}
      <span className="hint">{frames.length ? "Each picture shows at its words, else that many seconds after the one before. Paste or drop pictures here too." : "Add 2 or more pictures (or paste / drop them here): they play one after another in one place."}</span>
      {error && <span className="small" style={{ color: "var(--danger, #c62828)" }}>{error}</span>}
    </div>
  );
}

function ItemEditor({ item, onChange, onRemove, onMove, onCopy, onDuplicate, first, last, lesson, earlier, say, active, notePictures = [], selected = false, onSelect }) {
  const t = item.type;
  const [marking, setMarking] = useState(false);
  const [cropping, setCropping] = useState(false);
  const [picking, setPicking] = useState(false);
  const [drawDiagram, diagramState] = useAiDiagramMutation();
  const [uploading, setUploading] = useState(false);
  // null, or { base }: the drawing pad, blank or over the current picture.
  const [drawing, setDrawing] = useState(null);
  const [error, setError] = useState("");
  const pictureUrl = item.src === "upload" ? item.url : item.src === "solution" ? lesson.solutionImageUrl : lesson.imageUrl;
  const camTarget = t === "camera" && item.ref ? earlier.find((x) => x.key === item.ref) : null;
  const upload = async (file) => {
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const body = await sendPicture(lesson._id, file);
      // A drawing over an AI diagram makes it a picture: it can't be drawn
      // again with AI after that.
      const { svg, prompt, build, stepCues, seconds, ...rest } = item;
      onChange(t === "diagram"
        ? { ...rest, type: "image", src: "upload", media: body.media, url: body.url, marks: [], crop: null, size: item.size || "large" }
        : { ...item, src: "upload", media: body.media, url: body.url, marks: [], crop: null });
      setDrawing(null);
      setCropping(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  };
  // An AI picture from a description, kept as this lesson's upload.
  const [aiPrompt, setAiPrompt] = useState(null);
  const [making, setMaking] = useState(false);
  const makeAi = async () => {
    setMaking(true);
    setError("");
    try {
      const res = await fetch(`/api/video-lessons/${lesson._id}/ai-image`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: aiPrompt }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || `The picture couldn't be made (${res.status}).`);
      onChange({ ...item, src: "upload", media: body.media, url: body.url, marks: [] });
      setAiPrompt(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setMaking(false);
    }
  };
  // A picture from the lecture's notes: copied in as this lesson's own upload.
  const fromNotes = async (url) => {
    if (!url) return;
    setError("");
    try {
      const blob = await (await fetch(url, { credentials: "include" })).blob();
      if (!blob.type.startsWith("image/")) throw new Error("That picture could not be read.");
      await upload(new File([blob], "notes-picture", { type: blob.type }));
    } catch (e) {
      setError(e.message);
    }
  };
  const sentences = sentencesOf(say);
  const runDiagram = async () => {
    setError("");
    try {
      const out = await drawDiagram({ prompt: item.prompt || "", context: `${lesson.title || ""}\n${say}`.slice(0, 2500), build: Boolean(item.build) }).unwrap();
      onChange({ ...item, svg: out.svg, caption: item.caption || out.caption || "" });
    } catch (e) {
      setError(e?.data?.message || "The diagram couldn't be drawn. Try again.");
    }
  };
  const over = t === "clip" && item.voice === "over";
  // A picture pasted or dropped onto a picture item replaces it.
  const takePicture = (e, dt) => {
    if (t !== "image") return;
    const f = pictureFileOf(dt);
    if (!f) return;
    e.preventDefault();
    upload(f);
  };
  return (
    <div className="stack" style={{ gap: 4, padding: 6, borderRadius: 8, background: active ? "var(--accent-soft, rgba(47,111,223,0.12))" : undefined, transition: "background 200ms" }}
      onDragOver={t === "image" ? (e) => e.preventDefault() : undefined}
      onDrop={t === "image" ? (e) => takePicture(e, e.dataTransfer) : undefined}
      onPaste={t === "image" ? (e) => takePicture(e, e.clipboardData) : undefined}>
      <div className="row-tight" style={{ gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        {onSelect && <input type="checkbox" title="Select for group copy (shift-click: a range)" checked={selected} onChange={() => {}} onClick={onSelect} />}
        <select className="select" style={{ width: 140 }} value={t} onChange={(e) => e.target.value === "aipicture" ? (onChange({ ...item, type: "image", src: "upload" }), setAiPrompt("")) : onChange({ ...item, type: e.target.value, ...(e.target.value === "callout" && !item.kind ? { kind: "think" } : {}), ...(e.target.value === "pause" && !item.seconds ? { seconds: 2 } : {}), ...(e.target.value === "clip" ? { seconds: item.seconds || 5, start: item.start || 0, sound: item.sound !== false, size: item.size || "large", after: item.after ?? "" } : {}), ...(e.target.value === "image" && !item.src ? { src: lesson.imageUrl ? "question" : lesson.solutionImageUrl ? "solution" : "upload" } : {}), ...(e.target.value === "sequence" ? { frames: item.frames || [], seconds: item.type === "sequence" ? item.seconds : 1, transition: item.transition || "fade", size: item.size || "medium" } : {}), ...(e.target.value === "camera" ? { zoom: item.zoom || 1.6, seconds: 1 } : {}), ...(e.target.value === "remove" ? { exit: item.exit || "cross" } : {}) })}>
          {ITEM_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {t === "newBoard" && <span className="hint">Wipes the board before what follows.</span>}
        {!NO_ENTER.includes(t) && (
          <select className="select" style={{ width: 120 }} title="How it comes on" value={item.enter || ""} onChange={(e) => onChange({ ...item, enter: e.target.value || null })}>
            {ENTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        )}
        {!first && !NO_ENTER.includes(t) && (
          <select className="select" style={{ width: 130 }} title="Below the item above, or beside it in one row" value={item.row ? "row" : ""} onChange={(e) => onChange({ ...item, row: e.target.value === "row" || null })}>
            <option value="">Below the one above</option>
            <option value="row">Beside the one above</option>
          </select>
        )}
        {!NO_ENTER.includes(t) && (
          <label className="small" title="Stays on the board through New board steps, until a Remove step takes it off" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <input type="checkbox" checked={!!item.keep} onChange={(e) => onChange({ ...item, keep: e.target.checked || null })} /> Keep on new board
          </label>
        )}
        {!["newBoard", "highlight", "pause", "remove", "camera"].includes(t) && (
          <select className="select" style={{ width: 90 }} title="Where it sits on the board" value={item.align || ""} onChange={(e) => onChange({ ...item, align: e.target.value || null })}>
            <option value="">{t === "math" ? "Centre" : "Left"} (default)</option>
            <option value="left">Left</option>
            <option value="center">Centre</option>
            <option value="right">Right</option>
          </select>
        )}
        <span className="row-tight" style={{ gap: 2, marginLeft: "auto", flexWrap: "nowrap" }}>
        <button type="button" className="icon-btn" title="Copy (paste into any part or another video)" onClick={onCopy}><Copy size={13} /></button>
        <button type="button" className="icon-btn" title="Duplicate here" onClick={onDuplicate}><CopyPlus size={13} /></button>
        <button type="button" className="icon-btn" title="Move up" disabled={first} onClick={() => onMove(-1)}><ChevronUp size={14} /></button>
        <button type="button" className="icon-btn" title="Move down" disabled={last} onClick={() => onMove(1)}><ChevronDown size={14} /></button>
        <button type="button" className="icon-btn icon-btn-danger" title="Remove" onClick={onRemove}><X size={14} /></button>
        </span>
      </div>
      {t !== "newBoard" && (
        <div className="row-tight" style={{ gap: 6, alignItems: "flex-start", flexWrap: "wrap" }}>
        {t === "math" && (
          <div className="grow stack" style={{ gap: 6 }}>
            <input className="input" value={item.latex || ""} placeholder="LaTeX, no $ signs. \\hl{...} marks what changed" onChange={(e) => onChange({ ...item, latex: e.target.value })} />
            <select className="select" title="Show it as the next step of an earlier line: it takes that line's place" value={item.from || ""} onChange={(e) => onChange({ ...item, from: e.target.value || null })}>
              <option value="">A new line</option>
              {earlier.map((x) => <option key={x.key} value={x.key}>Next step of {x.label}</option>)}
            </select>
          </div>
        )}
        {t === "list" && (
          <div className="grow stack" style={{ gap: 4 }}>
            <textarea className="textarea" rows={Math.max(2, (item.items || []).length)} value={(item.items || []).join("\n")} placeholder="One point per line. ==Highlight== a part." onChange={(e) => onChange({ ...item, items: e.target.value.split("\n") })} />
            <label className="small" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <input type="checkbox" checked={!!item.check} onChange={(e) => onChange({ ...item, check: e.target.checked || null })} /> Show as ticks
            </label>
          </div>
        )}
        {(t === "graph" || t === "numberline") && <PlotFields item={item} onChange={onChange} />}
        {t === "table" && (
          <textarea className="textarea grow" rows={Math.max(3, (item.rows || []).length)} value={(item.rows || []).map((r) => r.join(" | ")).join("\n")} placeholder={"One row per line, cells split by |\nQuantity | Value\nu | 20 m/s"}
            onChange={(e) => onChange({ ...item, rows: e.target.value.split("\n").map((r) => r.split("|").map((c) => c.trim())) })} />
        )}
        {(t === "code" || t === "output") && (
          <div className="grow stack" style={{ gap: 6 }}>
            <textarea className="textarea" rows={Math.min(14, Math.max(3, String(item.text || "").split("\n").length))} spellCheck={false}
              style={{ fontFamily: "ui-monospace, Consolas, monospace", fontSize: 13, whiteSpace: "pre", overflowX: "auto" }}
              value={item.text || ""} placeholder={t === "code" ? "The code, as it should look" : "What the program prints"}
              onKeyDown={(e) => {
                if (e.key !== "Tab") return;
                e.preventDefault();
                const el = e.currentTarget;
                const { selectionStart: a, selectionEnd: b } = el;
                onChange({ ...item, text: `${el.value.slice(0, a)}    ${el.value.slice(b)}` });
                requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = a + 4; });
              }}
              onChange={(e) => onChange({ ...item, text: e.target.value })} />
            <div className="row-tight" style={{ gap: 6, flexWrap: "wrap" }}>
              {t === "code" && (
                <select className="select" style={{ width: 130 }} title="Language (for colours)" value={item.lang || ""} onChange={(e) => onChange({ ...item, lang: e.target.value || null })}>
                  {CODE_LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              )}
              <input className="input grow" value={item.caption || ""} placeholder="Caption (optional)" onChange={(e) => onChange({ ...item, caption: e.target.value })} />
            </div>
          </div>
        )}
        {["heading", "text", "answer"].includes(t) && <input className="input grow" value={item.text || ""} placeholder="Maths as $...$, ==highlight== a part" onChange={(e) => onChange({ ...item, text: e.target.value })} />}
        {t === "callout" && (
          <>
            <select className="select" style={{ width: 175 }} value={item.kind || "note"} onChange={(e) => onChange({ ...item, kind: e.target.value })}>
              {CALLOUT_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input className="input grow" value={item.text || ""} placeholder={item.kind === "think" ? "What a student might think…" : "Text, maths as $...$"} onChange={(e) => onChange({ ...item, text: e.target.value })} />
          </>
        )}
        {t === "highlight" && (
          <>
            <select className="select grow" value={item.ref || ""} onChange={(e) => onChange({ ...item, ref: e.target.value })}>
              <option value="">Pick an earlier item…</option>
              {earlier.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </select>
            <select className="select" style={{ width: 150 }} title="How it is marked" value={item.emphasis || "glow"} onChange={(e) => onChange({ ...item, emphasis: e.target.value === "glow" ? null : e.target.value })}>
              {EMPHASES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </>
        )}
        {t === "remove" && (
          <>
            <select className="select grow" value={item.ref || ""} onChange={(e) => onChange({ ...item, ref: e.target.value })}>
              <option value="">Pick an earlier item…</option>
              {earlier.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </select>
            <select className="select" style={{ width: 140 }} value={item.exit || "fade"} onChange={(e) => onChange({ ...item, exit: e.target.value })}>
              {EXITS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </>
        )}
        {t === "camera" && (
          <>
            <select className="select grow" value={item.ref || ""} onChange={(e) => onChange({ ...item, ref: e.target.value || null, area: null, zoom: e.target.value ? item.zoom || 1.6 : 1 })}>
              <option value="">Back to the whole board</option>
              {earlier.map((x) => <option key={x.key} value={x.key}>Zoom on {x.label}</option>)}
            </select>
            {item.ref && (
              <>
                <button type="button" className="btn btn-sm" disabled={!camTarget} title="Zoom on all of it, or on a part you pick" onClick={() => setPicking(true)}>{item.area ? "Part ✓" : "All of it"}</button>
                <select className="select" style={{ width: 80 }} title="How close" value={item.zoom || 1.6} onChange={(e) => onChange({ ...item, zoom: Number(e.target.value) })}>
                  {ZOOMS.map((z) => <option key={z} value={z}>{z}×</option>)}
                </select>
              </>
            )}
            <input className="input tnum" type="number" min={0.3} max={5} step={0.1} style={{ width: 64 }} title="Seconds the move takes" value={item.seconds ?? 1} onChange={(e) => onChange({ ...item, seconds: Number(e.target.value) })} />
            <span className="small muted" style={{ paddingTop: 8 }}>s</span>
          </>
        )}
        {t === "sequence" && <SequenceEditor item={item} lesson={lesson} say={say} notePictures={notePictures} onChange={onChange} />}
        {t === "image" && (
          <div className="grow row-tight" style={{ gap: 6, flexWrap: "wrap" }}>
            <select className="select" style={{ width: 150 }} value={item.src || "question"} onChange={(e) => onChange({ ...item, src: e.target.value, marks: [] })}>
              <option value="question" disabled={!lesson.imageUrl}>Question figure</option>
              <option value="solution" disabled={!lesson.solutionImageUrl}>Solution picture</option>
              <option value="upload">Uploaded picture</option>
            </select>
            {notePictures.length > 0 && (
              <select className="select" style={{ width: 170 }} value="" disabled={uploading} onChange={(e) => fromNotes(e.target.value)}>
                <option value="">From the notes…</option>
                {notePictures.map((p, n) => <option key={p.url} value={p.url}>{p.name || `Picture ${n + 1}`}</option>)}
              </select>
            )}
            {item.src === "upload" && (
              <label className="btn btn-sm" style={{ cursor: "pointer" }}>
                {uploading ? "Uploading…" : item.media?.key ? "Replace picture" : "Upload picture"}
                <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => upload(e.target.files?.[0])} />
              </label>
            )}
            <button type="button" className="btn btn-sm" disabled={uploading || !pictureUrl} onClick={() => setCropping(true)} title="Crop, rotate or mark up a copy of this picture"><Crop size={13} /> Crop / edit</button>
            <button type="button" className="btn btn-sm" disabled={uploading || making} onClick={() => setAiPrompt(aiPrompt === null ? item.caption || "" : null)}><Sparkles size={13} /> AI picture</button>
            <button type="button" className="btn btn-sm" disabled={uploading} onClick={() => setDrawing({ base: null })}>Draw picture</button>
            {pictureUrl && <button type="button" className="btn btn-sm btn-quiet" disabled={uploading} onClick={() => setDrawing({ base: pictureUrl })}>Draw on it</button>}
            <select className="select" style={{ width: 110 }} value={item.size || "medium"} onChange={(e) => onChange({ ...item, size: e.target.value })}>
              <option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option><option value="full">Full board</option>
            </select>
            <button type="button" className="btn btn-sm" disabled={!pictureUrl} onClick={() => setMarking(true)}>Marks ({(item.marks || []).length})</button>
            <button type="button" className="btn btn-sm" disabled={!pictureUrl} title="Show only a part of the picture (it isn't changed)" onClick={() => setPicking(true)}>{item.crop ? "Part shown ✓" : "Show a part"}</button>
            <select className="select" style={{ width: 140 }} title="Slow zoom or pan while it's on the board" value={item.motion || ""} onChange={(e) => onChange({ ...item, motion: e.target.value || null })}>
              {MOTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input className="input grow" style={{ minWidth: 160 }} value={item.caption || ""} placeholder="Caption (optional)" onChange={(e) => onChange({ ...item, caption: e.target.value })} />
          </div>
        )}
        {t === "diagram" && (
          <div className="grow stack" style={{ gap: 6 }}>
            <div className="row-tight" style={{ gap: 6, flexWrap: "wrap" }}>
              <input className="input grow" style={{ minWidth: 200 }} value={item.prompt || ""} placeholder="What to draw: e.g. a block on a 30° slope with weight, normal force and friction labelled" onChange={(e) => onChange({ ...item, prompt: e.target.value })} />
              <button type="button" className="btn btn-sm" disabled={diagramState.isLoading || !(item.prompt || "").trim()} onClick={runDiagram}>
                <Sparkles size={13} /> {diagramState.isLoading ? "Drawing…" : item.svg ? "Draw again" : "Draw with AI"}
              </button>
              <select className="select" style={{ width: 110 }} value={item.size || "large"} onChange={(e) => onChange({ ...item, size: e.target.value })}>
                <option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option><option value="full">Full board</option>
              </select>
              <label className="row-tight small" style={{ gap: 4 }} title="Drawn step by step. Draw it again after ticking this.">
                <input type="checkbox" checked={Boolean(item.build)} onChange={(e) => onChange({ ...item, build: e.target.checked })} /> Step by step
              </label>
            </div>
            {item.build && (
              <div className="row-tight" style={{ gap: 6, flexWrap: "wrap" }}>
                <textarea className="textarea grow" rows={2} style={{ minWidth: 220 }} value={(item.stepCues || []).join("\n")} placeholder={"One line per step, from step 1: the words that bring it in (step 1 can stay empty: it comes with the diagram)"}
                  onChange={(e) => onChange({ ...item, stepCues: e.target.value.split("\n") })} />
                <span className="small muted">else every</span>
                <input className="input tnum" type="number" min={0.3} max={10} step={0.1} style={{ width: 64 }} value={item.seconds ?? 1.5} onChange={(e) => onChange({ ...item, seconds: Number(e.target.value) })} />
                <span className="small muted">s</span>
                {item.svg && !/data-step=/.test(item.svg) && <span className="hint">This drawing has no steps yet: press Draw again.</span>}
              </div>
            )}
            <div className="row-tight" style={{ gap: 8, alignItems: "flex-start" }}>
              {item.svg
                ? <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(item.svg)}`} alt="" style={{ height: 90, border: "1px solid var(--line, #ddd)", borderRadius: 6, background: "#fff" }} />
                : <span className="hint">Not drawn yet: it doesn't show until it is.</span>}
              {item.svg && <button type="button" className="btn btn-sm btn-quiet" disabled={uploading} title="Add lines or labels by hand. It becomes a picture: it can't be drawn again with AI after that." onClick={() => setDrawing({ base: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(item.svg)}` })}>Draw on it</button>}
              <input className="input grow" value={item.caption || ""} placeholder="Caption (optional)" onChange={(e) => onChange({ ...item, caption: e.target.value })} />
            </div>
          </div>
        )}
        {t === "pause" && (
          <div className="grow row-tight" style={{ gap: 6, flexWrap: "wrap" }}>
            <span className="small muted">Hold the board, no voice, for</span>
            <input className="input tnum" type="number" min={0.5} max={30} step={0.5} style={{ width: 70 }} value={item.seconds ?? 2} onChange={(e) => onChange({ ...item, seconds: Number(e.target.value) })} />
            <span className="small muted">s,</span>
            <select className="select" style={{ maxWidth: 300 }} value={item.after ?? ""} onChange={(e) => onChange({ ...item, after: e.target.value })}>
              <option value="^">at the start, before the voice begins</option>
              {sentences.slice(0, -1).map((x, i) => <option key={i} value={opening(x)}>after the sentence “{opening(x)}…”</option>)}
              <option value="">at the end, after the last sentence</option>
            </select>
          </div>
        )}
        {t === "clip" && <ClipEditor item={item} lesson={lesson} sentences={sentences} onChange={onChange} />}
        </div>
      )}
      {error && <span className="small" style={{ color: "var(--danger, #c62828)" }}>{error}</span>}
      {t === "image" && aiPrompt !== null && (
        <div className="row-tight" style={{ gap: 6, flexWrap: "wrap" }}>
          <input className="input grow" style={{ minWidth: 220 }} autoFocus value={aiPrompt} maxLength={600} placeholder="What it shows: e.g. a convex lens focusing sunlight onto paper, close up"
            onChange={(e) => setAiPrompt(e.target.value)} onKeyDown={(e) => e.key === "Enter" && aiPrompt.trim() && !making && makeAi()} />
          <button type="button" className="btn btn-sm btn-primary" disabled={making || !aiPrompt.trim()} onClick={makeAi}>{making ? "Making…" : "Make picture"}</button>
          <span className="hint">For real things and scenes. Labelled drawings, graphs and set-ups with values: use AI diagram.</span>
        </div>
      )}
      {t === "image" && pictureUrl && (
        <div className="row-tight" style={{ gap: 8, alignItems: "flex-start" }}>
          <img src={pictureUrl} alt="" style={{ height: 90, maxWidth: 220, objectFit: "contain", border: "1px solid var(--line, #ddd)", borderRadius: 6, background: "#fff" }} />
          {item.caption && <span className="small muted">{item.caption}</span>}
        </div>
      )}
      {t === "image" && !pictureUrl && <span className="hint">{item.src === "upload" ? "Upload a picture." : "This picture doesn't exist; pick another source."}</span>}
      {(!["newBoard", "pause", "clip"].includes(t) || over) && <CueEditor item={item} say={say} first={first} onChange={onChange} />}
      {picking && camTarget && <AreaPicker target={camTarget} lesson={lesson} area={item.area} onClose={() => setPicking(false)} onSave={(area) => { onChange({ ...item, area }); setPicking(false); }} />}
      {picking && t === "image" && pictureUrl && <RegionPicker url={pictureUrl} crop={item.crop} onClose={() => setPicking(false)} onSave={(crop) => { onChange({ ...item, crop }); setPicking(false); }} />}
      {cropping && pictureUrl && <ImageEditor source={pictureUrl} saving={uploading} onCancel={() => setCropping(false)} onSave={(blob) => upload(new File([blob], "picture.png", { type: blob.type || "image/png" }))} />}
      {drawing && <DrawPad base={drawing.base} saving={uploading} onCancel={() => setDrawing(null)} onSave={(blob) => upload(new File([blob], "drawing.png", { type: "image/png" }))} />}
      {marking && pictureUrl && <MarkEditor url={pictureUrl} marks={item.marks || []} onChange={(marks) => onChange({ ...item, marks })} onClose={() => setMarking(false)} />}
    </div>
  );
}

// Writing the script or making the voice runs on the server; this shows
// how far it is. A script has no real progress to report, so its bar
// follows the time it usually takes and waits near the end.
// Lines of numbers typed freely, read when the field is left: a graph's
// curves and points, a number line's points and spans.
function LinesField({ value, parse, rows = 2, placeholder, onCommit }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return <textarea className="textarea" rows={Math.max(rows, text.split("\n").length)} value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onBlur={() => onCommit(text.split("\n").map((l) => l.trim()).filter(Boolean).map(parse).filter(Boolean))} />;
}
const numOrNull = (v) => (v === "" || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
function PlotFields({ item, onChange }) {
  const graph = item.type === "graph";
  const range = (key, i, v) => {
    const r = [...(item[key] || (key === "xRange" ? [-5, 5] : [null, null]))];
    r[i] = numOrNull(v);
    onChange({ ...item, [key]: r.every((x) => x !== null) ? r : key === "xRange" ? item[key] : null });
  };
  const pair = (key, label) => (
    <span className="row-tight small" style={{ gap: 4, alignItems: "center" }}>{label}
      <input className="input tnum" type="number" style={{ width: 70 }} defaultValue={item[key]?.[0] ?? ""} onBlur={(e) => range(key, 0, e.target.value)} /> to
      <input className="input tnum" type="number" style={{ width: 70 }} defaultValue={item[key]?.[1] ?? ""} onBlur={(e) => range(key, 1, e.target.value)} />
    </span>
  );
  return (
    <div className="grow stack" style={{ gap: 6 }}>
      {graph && (
        <LinesField value={(item.fns || []).map((f) => (f.label ? `${f.expr} | ${f.label}` : f.expr)).join("\n")} placeholder={"One curve per line: y = ... | label\nx^2 - 4 | y = x² − 4\nsin(x)"}
          parse={(l) => { const [expr, label] = l.split("|").map((x) => x.trim()); return expr ? { expr, label: label || "" } : null; }}
          onCommit={(fns) => onChange({ ...item, fns: fns.slice(0, 3) })} />
      )}
      <div className="row-tight" style={{ gap: 10, flexWrap: "wrap" }}>
        {pair("xRange", "x from")}
        {graph && pair("yRange", "y from (empty: auto)")}
      </div>
      <LinesField value={(item.points || []).map((p) => (graph ? [p.x, p.y, p.label] : [p.x, p.label, p.open ? "open" : ""]).filter((x) => x !== undefined && x !== null && x !== "").join(", ")).join("\n")}
        placeholder={graph ? "Points, one per line: x, y, label\n2, 0, (2, 0)" : "Points, one per line: x, label, open\n2, 2, open"}
        parse={(l) => {
          const [a, b, ...rest] = l.split(",").map((x) => x.trim());
          if (numOrNull(a) === null) return null;
          if (graph) return numOrNull(b) === null ? null : { x: Number(a), y: Number(b), label: rest.join(", ") };
          const open = rest.includes("open") || b === "open";
          return { x: Number(a), label: b === "open" ? "" : b || "", ...(open ? { open: true } : {}) };
        }}
        onCommit={(points) => onChange({ ...item, points: points.slice(0, 8) })} />
      {!graph && (
        <LinesField value={(item.spans || []).map((x) => `${x.a} to ${x.b}`).join("\n")} placeholder={"Shaded spans, one per line: 2 to 5"}
          parse={(l) => { const m = /^(-?[\d.]+)\s*(?:to|,|-)\s*(-?[\d.]+)$/.exec(l); return m ? { a: Number(m[1]), b: Number(m[2]) } : null; }}
          onCommit={(spans) => onChange({ ...item, spans: spans.slice(0, 3) })} />
      )}
      <input className="input" value={item.caption || ""} placeholder="Caption (optional)" onChange={(e) => onChange({ ...item, caption: e.target.value })} />
    </div>
  );
}

function JobProgress({ job }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const seconds = Math.max(0, Math.round((now - new Date(job.startedAt).getTime()) / 1000));
  const pct = job.kind === "voice"
    ? (job.total ? (job.done / job.total) * 100 : 0)
    : Math.min(95, (seconds / (job.expectSeconds || 60)) * 100);
  const label = job.kind === "voice"
    ? `Making the voice: ${job.done} of ${job.total} parts`
    : `${job.kind === "script" && job.total === 3 ? ["Planning the lesson", "Writing the script", "Checking the script"][Math.min(2, job.done)] : "Writing the script"}… ${seconds}s${seconds > (job.expectSeconds || 60) ? " (taking longer than usual)" : ""}`;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="spread small"><span>{label}</span><span className="muted">{Math.round(pct)}%</span></div>
      <div style={{ height: 8, borderRadius: 99, background: "var(--border, rgba(128,128,128,0.25))", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: "var(--accent, #2f6fdf)", transition: "width 0.5s linear" }} />
      </div>
      <span className="hint">It runs on the server: you can leave this page and come back.</span>
    </div>
  );
}

// With editTo, a view only: the player and its state, and a link to the
// editor where the script is written, voiced, published and recorded.
// `notes`: the lecture's written content as currently typed (the editor
// passes it so unsaved pictures show too); otherwise the saved notes are read.
export default function VideoLessonPanel({ question, lecture, editTo, notes }) {
  const target = question ? { question } : { lecture };
  const { data: lectureDoc } = useGetLectureQuery(lecture, { skip: !lecture || notes !== undefined });
  const notePictures = notePicturesOf(notes !== undefined ? notes : lectureDoc?.bodyMarkdown);
  // Replace a word or phrase in every part's narration at once (say "miu" for every "mu").
  const [swap, setSwap] = useState({ find: "", with: "", whole: true, matchCase: false });
  const [swapNote, setSwapNote] = useState("");
  const [polling, setPolling] = useState(false);
  const { data, isFetching } = useGetVideoLessonQuery(target, { pollingInterval: polling ? 2000 : 0 });
  const [generate, gen] = useGenerateVideoLessonMutation();
  const [update, upd] = useUpdateVideoLessonMutation();
  const [voice, voi] = useVoiceVideoLessonMutation();
  const [stopVoice, stopping] = useStopVideoLessonVoiceMutation();
  const [remove] = useDeleteVideoLessonMutation();
  const [revise, rev] = useReviseVideoLessonPartMutation();
  const [humanize, hum] = useHumanizeVideoLessonPartMutation();
  // A humanized narration waiting for Keep or Discard: { i, say, board, lost }.
  const [human, setHuman] = useState(null);
  const confirm = useConfirm();
  const clipboard = useVideoClipboard();
  const clip = clipboard.clip;
  const fromOf = () => ({ _id: lesson._id, imageUrl: lesson.imageUrl || null, solutionImageUrl: lesson.solutionImageUrl || null });
  // What the preview is playing (BoardPlayer onPosition), to mark it in the
  // script; follow: keep that part in view while it plays.
  const [position, setPosition] = useState(null);
  const [follow, setFollow] = useState(true);
  // The board in its own window (PopOut); "blocked": the browser stopped it.
  const [popped, setPopped] = useState(false);
  const [jump, setJump] = useState(null);
  const partRefs = useRef([]);
  // A part's AI menu: { index, action, instruction } while it's open.
  const [aiPart, setAiPart] = useState(null);
  // A new part for AI to write after part `index`: { index, instruction }.
  const [newPart, setNewPart] = useState(null);
  const lesson = data?.lesson;
  const voiceReady = data?.voice?.ready;
  const job = lesson?.job;
  const working = job?.status === "running";
  const hasScript = Boolean(lesson?.segments?.length);
  useEffect(() => { setPolling(working); }, [working]);

  const [open, setOpen] = useState(() => !editTo && window.location.hash === "#ai-video");
  const panelRef = useRef(null);
  useEffect(() => {
    if (open && !editTo && window.location.hash === "#ai-video") panelRef.current?.scrollIntoView({ block: "start" });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [language, setLanguage] = useState("");
  const [minutes, setMinutes] = useState(8);
  const [teach, setTeach] = useState("");
  const [material, setMaterial] = useState("");
  const from = "source";
  const [draft, setDraft] = useState(null);
  const justSaved = useRef(false);

  // The editable copy follows the saved lesson (after a save, a new script,
  // new voice), except while it holds edits not yet saved.
  const synced = useRef(null);
  useEffect(() => {
    if (!hasScript) { setDraft(null); synced.current = null; return; }
    // Read now: the updater below runs later, after these are reset.
    const fresh = draftOf(lesson);
    const before = synced.current;
    const saved = justSaved.current;
    setDraft((d) => (!d || !before || saved || JSON.stringify(d) === before ? fresh : d));
    synced.current = JSON.stringify(fresh);
    justSaved.current = false;
  }, [lesson?._id, lesson?.updatedAt, hasScript]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (lesson?.language) setLanguage(lesson.language); }, [lesson?.language]);

  const dirty = Boolean(hasScript && draft && JSON.stringify(draft) !== JSON.stringify(draftOf(lesson)));
  useEffect(() => {
    if (!follow || !position?.playing) return;
    partRefs.current[position.segment]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [position?.segment, position?.playing, follow]);
  // The part replaced by what AI wrote (not saved until "Save script").
  const runRevise = async () => {
    const { index, action, instruction } = aiPart;
    const r = await revise({ id: lesson._id, index, action, instruction, segments: draft.segments }).catch(() => null);
    if (!r || r.error) return;
    const fresh = r.data.segments.map((sg, k) => ({ ...(k === 0 ? { _id: draft.segments[index]._id } : {}), say: sg.say, board: sg.board }));
    setDraft((d) => ({ ...d, segments: [...d.segments.slice(0, index), ...fresh, ...d.segments.slice(index + 1)] }));
    setAiPart(null);
  };
  // A new part written by AI from the teacher's words, put in after the
  // part (not saved until "Save script").
  const runNewPart = async () => {
    const { index, instruction } = newPart;
    const r = await revise({ id: lesson._id, index, action: "new", instruction, segments: draft.segments }).catch(() => null);
    if (!r || r.error) return;
    const fresh = r.data.segments.map((sg) => ({ say: sg.say, board: sg.board }));
    setDraft((d) => ({ ...d, segments: [...d.segments.slice(0, index + 1), ...fresh, ...d.segments.slice(index + 1)] }));
    setNewPart(null);
  };
  const runHumanize = async (i) => {
    setHuman({ i, busy: true });
    const r = await humanize({ id: lesson._id, index: i, segments: draft.segments }).catch(() => null);
    if (!r || r.error) { setHuman({ i, error: r?.error?.data?.message || "Couldn't humanize. Try again." }); return; }
    setHuman({ i, ...r.data });
  };
  const keepHuman = () => { setSeg(human.i, { say: human.say, board: human.board }); setHuman(null); };
  const needVoice = lesson ? lesson.segments.filter((s) => !s.audioCurrent).length : 0;

  const setSeg = (i, patch) => setDraft((d) => ({ ...d, segments: d.segments.map((s, k) => (k === i ? { ...s, ...patch } : s)) }));
  const moveSeg = (i, dir) => setDraft((d) => {
    const segs = [...d.segments];
    const j = i + dir;
    if (j < 0 || j >= segs.length) return d;
    [segs[i], segs[j]] = [segs[j], segs[i]];
    return { ...d, segments: segs };
  });

  const runGenerate = async () => {
    if (hasScript && !(await confirm({ title: "Write a new script?", body: "The current script, its voice and any edits are replaced. It stays unpublished until you publish it again.", confirmLabel: "Rewrite" }))) return;
    const r = await generate({ ...target, language, ...(teach ? { style: teach } : {}), ...(lecture ? { minutes, material } : {}) });
    if (!r.error) setPolling(true);
  };
  // A picture pasted into a part (not onto a picture item) becomes a new
  // picture item at the end of its board.
  const [pasteNote, setPasteNote] = useState(null);
  // Board items ticked for a group copy: in one part at a time.
  const [sel, setSel] = useState({ i: -1, ks: [], last: -1 });
  const pick = (i, k, shift) => setSel((cur) => {
    const ks = cur.i === i ? [...cur.ks] : [];
    if (shift && cur.i === i && cur.last >= 0) {
      for (let x = Math.min(cur.last, k); x <= Math.max(cur.last, k); x += 1) if (!ks.includes(x)) ks.push(x);
    } else if (ks.includes(k)) ks.splice(ks.indexOf(k), 1);
    else ks.push(k);
    return { i, ks: ks.sort((a, b) => a - b), last: k };
  });
  const pastePicture = async (i, file) => {
    if (draft.segments[i].board.length >= MAX_ITEMS) { setPasteNote({ i, text: `A part holds at most ${MAX_ITEMS} items.` }); return; }
    setPasteNote({ i, text: "Adding the picture…" });
    try {
      const body = await sendPicture(lesson._id, file);
      setDraft((d) => ({ ...d, segments: d.segments.map((sg, k) => (k === i ? { ...sg, board: [...sg.board, { type: "image", src: "upload", media: body.media, url: body.url, marks: [], size: "medium" }] } : sg)) }));
      setPasteNote(null);
    } catch (e) {
      setPasteNote({ i, text: e.message });
    }
  };
  const save = () => { justSaved.current = true; return update({ id: lesson._id, title: draft.title, look: draft.look || null, segments: draft.segments.map((s) => ({ ...s, board: s.board.map((b) => (b.type === "list" ? { ...b, items: (b.items || []).filter((x) => x.trim()) } : b)) })) })
    .then((r) => {
      if (r.error) { justSaved.current = false; return; }
      // The saved copy, as the server tidied it, even if nothing changed.
      const fresh = draftOf(r.data.lesson);
      synced.current = JSON.stringify(fresh);
      setDraft(fresh);
    }); };
  const runVoice = async (redo = false) => {
    if (redo && !(await confirm({ title: "Make the whole voice again?", body: "Every part is voiced again with the voice set in Settings now. A recorded video keeps its old sound until you record it again.", confirmLabel: "Redo voice" }))) return;
    const r = await voice({ id: lesson._id, redo });
    if (!r.error) setPolling(true);
  };

  const what = question ? "solution" : "lecture";
  if (editTo) {
    return (
      <div className="card stack">
        <div className="spread">
          <div className="row-tight" style={{ gap: 8 }}>
            <Clapperboard size={17} className="muted" />
            <h2 style={{ margin: 0 }}>AI video</h2>
            {working && <span className="pill">{job.kind === "voice" ? "Making voice…" : "Writing…"}</span>}
            {hasScript && <span className={`pill ${lesson.published ? "pill-ok" : "pill-warn"}`}>{lesson.published ? "Published" : "Draft"}</span>}
            {hasScript && !working && needVoice > 0 && voiceReady && <span className="pill">{needVoice} without voice</span>}
          </div>
          <div className="row-tight" style={{ gap: 6 }}>
            {hasScript && !working && <VideoExport lesson={lesson} disabled={needVoice > 0 && voiceReady} question={question} lecture={lecture} />}
            <Link className="btn btn-sm" to={{ pathname: editTo, hash: "ai-video" }}><Clapperboard size={14} /> {hasScript ? "Edit video" : `Make ${what} video`}</Link>
          </div>
        </div>
        {working && (
          <div className="row-tight" style={{ gap: 8, alignItems: "center" }}>
            <div className="grow"><JobProgress job={job} /></div>
            {(job.kind === "voice" || job.kind === "script") && (
              <button type="button" className="btn btn-sm btn-quiet" disabled={stopping.isLoading} title={job.kind === "voice" ? "Stop now; what's voiced is kept" : "Stop now; the old script is kept"} onClick={() => stopVoice(lesson._id)}>
                <X size={13} /> {stopping.isLoading ? "Stopping…" : "Stop"}
              </button>
            )}
          </div>
        )}
        {job?.status === "failed" && (
          <div className="row-tight" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <p className="hint grow" style={{ margin: 0, color: "var(--danger, #c62828)" }}>{job.kind === "voice" ? "Voice" : "Script"}: {job.error}</p>
            {job.kind === "voice" && needVoice > 0 && voiceReady && (
              <button type="button" className="btn btn-sm" disabled={voi.isLoading || dirty} title={dirty ? "Save your edits first" : "Voice the parts still without voice"} onClick={() => runVoice()}>
                <RotateCcw size={13} /> Try again ({needVoice})
              </button>
            )}
          </div>
        )}
        {hasScript ? <BoardPlayer lesson={lesson} /> : !working && !isFetching && <p className="hint" style={{ margin: 0 }}>No AI video yet.</p>}
      </div>
    );
  }
  return (
    <div className="card stack" id="ai-video" ref={panelRef} style={{ scrollMarginTop: 16 }}>
      <div className="spread" style={{ cursor: "pointer" }} onClick={() => setOpen(!open)}>
        <div className="row-tight" style={{ gap: 8 }}>
          <Clapperboard size={17} className="muted" />
          <h2 style={{ margin: 0 }}>AI video</h2>
          {working && <span className="pill">{job.kind === "voice" ? "Making voice…" : "Writing…"}</span>}
          {hasScript && <span className={`pill ${lesson.published ? "pill-ok" : "pill-warn"}`}>{lesson.published ? "Published" : "Draft"}</span>}
          {hasScript && !working && needVoice > 0 && voiceReady && <span className="pill">{needVoice} without voice</span>}
        </div>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </div>

      {open && (
        <>
          <p className="hint" style={{ margin: 0 }}>
            {question
              ? "A short board video that walks through this question's solution, step by step. It explains the solution above, so save that first."
              : "A board lecture made from this lecture's notes, readable attachments and anything you paste below."}
            {" "}Students see it once published.
          </p>

          {from === "source" && (<>
          <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <Field label="Language" hint="Empty: same as the source.">
              <input className="input" style={{ width: 160 }} value={language} placeholder="e.g. Bangla" onChange={(e) => setLanguage(e.target.value)} />
            </Field>
            <Field label="Teaching style">
              <select className="select" style={{ width: 170 }} value={teach} onChange={(e) => setTeach(e.target.value)}>
                <option value="">AI picks</option>
                <option value="steps">Step by step</option>
                <option value="concept">Idea first</option>
                <option value="story">Story / real life</option>
                <option value="trick">Exam trick</option>
              </select>
            </Field>
            {lecture && (
              <Field label="Length (minutes)">
                <input className="input tnum" type="number" min={3} max={20} style={{ width: 90 }} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
              </Field>
            )}
            <button type="button" className="btn" disabled={gen.isLoading || working} onClick={runGenerate}>
              <Sparkles size={14} /> {working && job.kind === "script" ? "Writing…" : hasScript ? "Rewrite with AI" : `Make ${what} video with AI`}
            </button>
          </div>
          {lecture && (
            <Field label="Extra material (optional)" hint="Pasted text the lecture should teach from, on top of its notes and attachments.">
              <textarea className="textarea" rows={3} value={material} onChange={(e) => setMaterial(e.target.value)} />
            </Field>
          )}
          </>)}
          <ErrorNote error={gen.error} />
          {working && (
          <div className="row-tight" style={{ gap: 8, alignItems: "center" }}>
            <div className="grow"><JobProgress job={job} /></div>
            {(job.kind === "voice" || job.kind === "script") && (
              <button type="button" className="btn btn-sm btn-quiet" disabled={stopping.isLoading} title={job.kind === "voice" ? "Stop now; what's voiced is kept" : "Stop now; the old script is kept"} onClick={() => stopVoice(lesson._id)}>
                <X size={13} /> {stopping.isLoading ? "Stopping…" : "Stop"}
              </button>
            )}
          </div>
        )}
          {job?.status === "failed" && (
          <div className="row-tight" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <p className="hint grow" style={{ margin: 0, color: "var(--danger, #c62828)" }}>{job.kind === "voice" ? "Voice" : "Script"}: {job.error}</p>
            {job.kind === "voice" && needVoice > 0 && voiceReady && (
              <button type="button" className="btn btn-sm" disabled={voi.isLoading || dirty} title={dirty ? "Save your edits first" : "Voice the parts still without voice"} onClick={() => runVoice()}>
                <RotateCcw size={13} /> Try again ({needVoice})
              </button>
            )}
          </div>
        )}

          {isFetching && !lesson && <p className="hint">Loading…</p>}

          {hasScript && draft && (
            <>
              {/* Stays in view while the script scrolls, so the part marked as
                  playing and the board can be watched together. */}
              {popped === true ? (
                <>
                  <PopOut title={`${lesson.title || "AI video"} · board`} onClose={(why) => setPopped(why === "blocked" ? "blocked" : false)}>
                    <BoardPlayer lesson={{ ...lesson, segments: lesson.segments }} onPosition={setPosition} jump={jump} />
                  </PopOut>
                  <div className="row-tight" style={{ gap: 8, padding: "8px 12px", border: "1px dashed var(--line, #d0d4dc)", borderRadius: 8 }}>
                    <span className="grow small muted">The board is playing in its own window. Save your edits to see them there.</span>
                    <button type="button" className="btn btn-sm" onClick={() => setPopped(false)}>Bring it back</button>
                  </div>
                </>
              ) : (
                <div style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--surface)", paddingBottom: 6 }}>
                  <div style={{ maxWidth: 640, margin: "0 auto" }}>
                    <BoardPlayer lesson={{ ...lesson, segments: lesson.segments }} onPosition={setPosition} jump={jump} />
                  </div>
                  <div className="row-tight" style={{ gap: 8, justifyContent: "center", marginTop: 4 }}>
                    <button type="button" className="btn btn-sm btn-quiet" title="Play the board in its own window, beside the script" onClick={() => setPopped(true)}>Pop out board ↗</button>
                    {popped === "blocked" && <span className="small" style={{ color: "var(--danger, #c62828)" }}>The browser blocked the window: allow pop-ups for this site.</span>}
                  </div>
                </div>
              )}
              <label className="row-tight small muted" style={{ gap: 6 }}>
                <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
                Follow playback in the script (the part and item playing are marked)
              </label>

              <div className="row-tight" style={{ gap: 8, flexWrap: "wrap" }}>
                {needVoice > 0 || working || !voiceReady ? (
                  <button type="button" className="btn btn-sm" disabled={voi.isLoading || working || !voiceReady || dirty} onClick={() => runVoice()} title={dirty ? "Save your edits first" : ""}>
                    <Mic size={14} /> {working && job.kind === "voice" ? "Making voice…" : `Make voice (${needVoice})`}
                  </button>
                ) : (
                  <button type="button" className="btn btn-sm" disabled={voi.isLoading || dirty} onClick={() => runVoice(true)} title={dirty ? "Save your edits first" : "Voice every part again"}>
                    <Mic size={14} /> Redo voice
                  </button>
                )}
                <button type="button" className="btn btn-sm" disabled={upd.isLoading || dirty || working} title={dirty ? "Save your edits first" : ""} onClick={() => update({ id: lesson._id, published: !lesson.published })}>
                  {lesson.published ? <><EyeOff size={14} /> Unpublish</> : <><Eye size={14} /> Publish</>}
                </button>
                <VideoExport lesson={lesson} disabled={dirty || working || (needVoice > 0 && voiceReady)} question={question} lecture={lecture} />
                <button type="button" className="btn btn-sm btn-danger" onClick={async () => { if (await confirm({ title: "Delete this AI video?", body: "The script and its voice are deleted. A video already recorded from it stays where it was saved.", confirmLabel: "Delete", tone: "danger" })) remove(lesson._id); }}>
                  <Trash2 size={14} /> Delete
                </button>
              </div>
              {!voiceReady && <p className="hint" style={{ margin: 0 }}>No voice is set up, so it plays with captions. <Link to="/settings?tab=ai&sub=voice">Set up a voice</Link></p>}
              {dirty && <p className="hint" style={{ margin: 0 }}>Unsaved edits: save the script to publish or record.</p>}
              <ErrorNote error={voi.error} />

              <div className="stack" style={{ gap: 10 }}>
                <div className="spread">
                  <strong>Script</strong>
                  <div className="row-tight" style={{ gap: 8 }}>
                    {dirty && <button type="button" className="btn btn-sm btn-quiet" onClick={() => setDraft(draftOf(lesson))}><RotateCcw size={13} /> Undo edits</button>}
                    <button type="button" className="btn btn-sm btn-primary" disabled={!dirty || upd.isLoading || (working && job.kind === "script")} onClick={save}><Save size={13} /> {upd.isLoading ? "Saving…" : "Save script"}</button>
                  </div>
                </div>
                <ErrorNote error={upd.error} />
                {/* Unsaved edits: Save stays in reach anywhere down a long script. */}
                {dirty && (
                  <div role="region" aria-label="Unsaved script" className="row-tight"
                    style={{ position: "fixed", right: 24, bottom: 24, zIndex: 50, gap: 8, padding: "8px 10px", alignItems: "center",
                      background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", boxShadow: "0 6px 24px rgba(0,0,0,0.18)" }}>
                    <span className="small muted">Unsaved edits</span>
                    <button type="button" className="btn btn-sm btn-quiet" onClick={() => setDraft(draftOf(lesson))}><RotateCcw size={13} /> Undo</button>
                    <button type="button" className="btn btn-sm btn-primary" disabled={upd.isLoading || (working && job.kind === "script")} onClick={save}><Save size={13} /> {upd.isLoading ? "Saving…" : "Save script"}</button>
                  </div>
                )}
                <Field label="Title"><input className="input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></Field>
                <Field label="Board look for this video" hint="Over the site's look (Settings → video board). A part can still have its own board below.">
                  <div className="row-tight" style={{ gap: 6, flexWrap: "wrap" }}>
                    <select className="select" style={{ width: 200 }} value={draft.look?.preset || ""} onChange={(e) => setDraft({ ...draft, look: { preset: e.target.value || null, ...(e.target.value === "custom" ? { board: draft.look?.board || "#fbfaf6", ink: draft.look?.ink || "#1d2330", accent: draft.look?.accent || "#2f6fdf" } : {}) } })}>
                      <option value="">The site's (default)</option>
                      {BACKGROUNDS.slice(1).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      <option value="custom">Custom colours</option>
                    </select>
                    {draft.look?.preset === "custom" && [["board", "Board"], ["ink", "Writing"], ["accent", "Accent"]].map(([k, l]) => (
                      <label key={k} className="row-tight small" style={{ gap: 4 }}>{l}
                        <input type="color" value={draft.look[k] || "#000000"} onChange={(e) => setDraft({ ...draft, look: { ...draft.look, [k]: e.target.value } })} />
                      </label>
                    ))}
                  </div>
                </Field>
                <div className="stack" style={{ gap: 6 }}>
                  <span className="label">Replace in narration</span>
                  <div className="row-tight" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    <input className="input" style={{ width: 160 }} placeholder="Find (e.g. mu)" value={swap.find} onChange={(e) => { setSwap({ ...swap, find: e.target.value }); setSwapNote(""); }} />
                    <input className="input" style={{ width: 160 }} placeholder="Replace with (e.g. miu)" value={swap.with} onChange={(e) => setSwap({ ...swap, with: e.target.value })} />
                    <label className="row-tight small" style={{ gap: 4, cursor: "pointer" }}>
                      <input type="checkbox" checked={swap.whole} onChange={(e) => setSwap({ ...swap, whole: e.target.checked })} /> Whole words
                    </label>
                    <label className="row-tight small" style={{ gap: 4, cursor: "pointer" }}>
                      <input type="checkbox" checked={swap.matchCase} onChange={(e) => setSwap({ ...swap, matchCase: e.target.checked })} /> Match case
                    </label>
                    <button type="button" className="btn btn-sm" disabled={!swap.find.trim()} onClick={() => {
                      const find = swap.find.trim();
                      // Whole words: not inside a longer word ("mu" but not "much").
                      const pattern = swap.whole ? `(?<![\\p{L}\\p{N}])${escapeRegex(find)}(?![\\p{L}\\p{N}])` : escapeRegex(find);
                      const re = new RegExp(pattern, swap.matchCase ? "gu" : "giu");
                      let count = 0;
                      const segments = draft.segments.map((sg) => ({ ...sg, say: sg.say.replace(re, () => { count += 1; return swap.with; }) }));
                      if (count) setDraft({ ...draft, segments });
                      setSwapNote(count ? `Replaced ${count}. Save the script, then add the voice again for the changed parts.` : "Not found in the narration.");
                    }}>Replace all</button>
                  </div>
                  {swapNote && <span className="hint">{swapNote}</span>}
                </div>
                <ErrorNote error={rev.error} />
                {clip && (
                  <div className="row-tight small" style={{ gap: 8, padding: "6px 10px", borderRadius: 8, background: "var(--surface-alt, rgba(128,128,128,0.08))" }}>
                    <ClipboardPaste size={13} className="muted" />
                    <span className="grow">
                      Copied {clip.kind === "part" ? "a part" : (clip.items?.length || 0) > 1 ? `${clip.items.length} board items` : `a board item (${itemLabel(clip.items?.[0] || {}) || "item"})`}
                      {clip.from?._id && clip.from._id !== lesson._id ? " from another video" : ""}. Paste it with the button under any part.
                    </span>
                    <button type="button" className="btn btn-sm btn-quiet" onClick={clipboard.clear}>Clear</button>
                  </div>
                )}
                {draft.segments.map((s, i) => {
                  const saved = lesson.segments.find((x) => x._id === s._id);
                  const savedIndex = lesson.segments.findIndex((x) => x._id === s._id);
                  const running = position && savedIndex >= 0 && position.segment === savedIndex && (position.playing || position.item);
                  return (
                    <div key={s._id || `new-${i}`} ref={(el) => { partRefs.current[i] = el; }} className="card-quiet stack"
                      onPaste={(e) => { if (e.defaultPrevented) return; const f = pictureFileOf(e.clipboardData); if (f) { e.preventDefault(); pastePicture(i, f); } }}
                      style={{ gap: 8, padding: 12, scrollMarginTop: 430, outline: running ? "2px solid var(--accent, #2f6fdf)" : "none", outlineOffset: 2, transition: "outline-color 200ms" }}>
                      <div className="spread">
                        <span className="small muted">
                          Part {i + 1}
                          {running && <span className="pill pill-ok" style={{ marginLeft: 6 }}>{position.playing ? "Playing" : "Here"}</span>}
                          {saved?.audioCurrent && saved.say === s.say ? " · voiced" : voiceReady ? " · needs voice" : ""}
                        </span>
                        <div className="row-tight">
                          <button type="button" className="btn btn-sm btn-quiet" disabled={savedIndex < 0} title={savedIndex < 0 ? "Save the script to play this part" : "Play from this part"}
                            onClick={() => setJump({ segment: savedIndex, nonce: Date.now(), play: true })}><Play size={13} /> Play here</button>
                          <button type="button" className="btn btn-sm btn-quiet" disabled={savedIndex < 0} title={savedIndex < 0 ? "Save the script to play this part" : "Play only this part, then stop"}
                            onClick={() => setJump({ segment: savedIndex, nonce: Date.now(), play: true, only: true })}><Play size={13} /> Play this board</button>
                          <button type="button" className="btn btn-sm btn-quiet" disabled={hum.isLoading || !s.say?.trim()} title="Make this part's narration sound like a real teacher talking; the board stays"
                            onClick={() => runHumanize(i)}><Smile size={13} /> {hum.isLoading && human?.i === i ? "Humanizing…" : "Humanize"}</button>
                          <button type="button" className="btn btn-sm btn-quiet" disabled={rev.isLoading} onClick={() => setAiPart(aiPart?.index === i ? null : { index: i, action: "redo", instruction: "" })}><Wand2 size={13} /> AI</button>
                          <button type="button" className="btn btn-sm btn-quiet" disabled={rev.isLoading} title="AI writes a whole new part, with its board, to go after this one"
                            onClick={() => setNewPart(newPart?.index === i ? null : { index: i, instruction: "" })}><Plus size={13} /> AI part after</button>
                          <button type="button" className="icon-btn" title="Copy this part (paste here or in another video)" onClick={() => clipboard.copy({ kind: "part", from: fromOf(), parts: [{ say: s.say, board: plain(s.board) }] })}><Copy size={13} /></button>
                          <button type="button" className="icon-btn" title="Duplicate this part" onClick={() => setDraft((d) => ({ ...d, segments: [...d.segments.slice(0, i + 1), { say: s.say, board: plain(s.board) }, ...d.segments.slice(i + 1)] }))}><CopyPlus size={13} /></button>
                          <button type="button" className="icon-btn" title="Move up" disabled={i === 0} onClick={() => moveSeg(i, -1)}><ChevronUp size={14} /></button>
                          <button type="button" className="icon-btn" title="Move down" disabled={i === draft.segments.length - 1} onClick={() => moveSeg(i, 1)}><ChevronDown size={14} /></button>
                          <button type="button" className="icon-btn icon-btn-danger" title="Remove part" disabled={draft.segments.length <= 2} onClick={() => setDraft((d) => ({ ...d, segments: d.segments.filter((_, k) => k !== i) }))}><Trash2 size={13} /></button>
                        </div>
                      </div>
                      {aiPart?.index === i && (
                        <div className="row-tight" style={{ gap: 6, flexWrap: "wrap", padding: 8, borderRadius: 8, background: "var(--surface, rgba(128,128,128,0.08))" }}>
                          {PART_ACTIONS.map(([v, l]) => (
                            <button key={v} type="button" className={`btn btn-sm ${aiPart.action === v ? "btn-primary" : "btn-quiet"}`} onClick={() => setAiPart({ ...aiPart, action: v })}>{l}</button>
                          ))}
                          {aiPart.action === "custom" && (
                            <input className="input grow" style={{ minWidth: 220 }} value={aiPart.instruction} placeholder="e.g. add a worked example, use simpler words, show the formula first"
                              onChange={(e) => setAiPart({ ...aiPart, instruction: e.target.value })} />
                          )}
                          <button type="button" className="btn btn-sm" disabled={rev.isLoading || (aiPart.action === "custom" && !aiPart.instruction.trim())} onClick={runRevise}>
                            <Sparkles size={13} /> {rev.isLoading ? "Writing…" : "Do it"}
                          </button>
                          <span className="hint">Replaces this part in the script below; save to keep it, or Undo edits.</span>
                        </div>
                      )}
                      {newPart?.index === i && (
                        <div className="row-tight" style={{ gap: 6, flexWrap: "wrap", padding: 8, borderRadius: 8, background: "var(--surface, rgba(128,128,128,0.08))" }}>
                          <textarea className="textarea grow" rows={2} style={{ minWidth: 240 }} autoFocus value={newPart.instruction} maxLength={500}
                            placeholder="What this part shows or explains: e.g. show why the friction force points up the slope, with a diagram"
                            onChange={(e) => setNewPart({ ...newPart, instruction: e.target.value })} />
                          <button type="button" className="btn btn-sm" disabled={rev.isLoading || !newPart.instruction.trim()} onClick={runNewPart}>
                            <Sparkles size={13} /> {rev.isLoading ? "Writing…" : "Write it"}
                          </button>
                          <span className="hint">Goes in after Part {i + 1}, with its own board; save to keep it.</span>
                        </div>
                      )}
                      {human?.i === i && !human.busy && (
                        <div className="stack" style={{ gap: 8, padding: 8, borderRadius: 8, background: "var(--surface, rgba(128,128,128,0.08))" }}>
                          {human.error ? <span className="small" style={{ color: "var(--danger, #c0392b)" }}>{human.error}</span> : (
                            <>
                              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
                                <div className="stack" style={{ gap: 4 }}><span className="label">Now</span><span className="small muted" style={{ whiteSpace: "pre-wrap" }}>{s.say}</span></div>
                                <div className="stack" style={{ gap: 4 }}><span className="label">Humanized</span><span className="small" style={{ whiteSpace: "pre-wrap" }}>{human.say}</span></div>
                              </div>
                              {human.lost > 0 && <span className="hint">{human.lost} board item{human.lost === 1 ? "" : "s"} lost {human.lost === 1 ? "its" : "their"} cue and will show at the default time; set the cue again if needed.</span>}
                            </>
                          )}
                          <div className="row-tight">
                            {!human.error && <button type="button" className="btn btn-sm" onClick={keepHuman}>Keep</button>}
                            {!human.error && <button type="button" className="btn btn-sm btn-quiet" disabled={hum.isLoading} onClick={() => runHumanize(i)}>Try again</button>}
                            <button type="button" className="btn btn-sm btn-quiet" onClick={() => setHuman(null)}>{human.error ? "Close" : "Discard"}</button>
                            <span className="hint">Kept text replaces this part's narration; save the script, then voice it again.</span>
                          </div>
                        </div>
                      )}
                      <Field label="Narration (spoken)">
                        <textarea className="textarea" rows={2} value={s.say} onChange={(e) => setSeg(i, { say: e.target.value })} />
                      </Field>
                      <div className="row-tight small" style={{ gap: 6, flexWrap: "wrap" }}>
                        <span className="muted">This part's board</span>
                        <select className="select" style={{ width: 150 }} value={s.background && !s.background.startsWith("#") ? s.background : s.background ? "colour" : ""}
                          onChange={(e) => setSeg(i, { background: e.target.value === "colour" ? "#fff6d5" : e.target.value || null })}>
                          {BACKGROUNDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          <option value="colour">A colour…</option>
                        </select>
                        {s.background?.startsWith("#") && <input type="color" value={s.background} onChange={(e) => setSeg(i, { background: e.target.value })} />}
                        <span className="muted">Layout</span>
                        <select className="select" style={{ width: 180 }} value={s.layout || ""} onChange={(e) => setSeg(i, { layout: e.target.value || null })}>
                          {LAYOUTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </div>
                      <span className="label">On the board</span>
                      {sel.i === i && sel.ks.length > 0 && (
                        <div className="row-tight small" style={{ gap: 8, alignItems: "center" }}>
                          <span>{sel.ks.length} selected</span>
                          <button type="button" className="btn btn-sm btn-quiet" onClick={() => { clipboard.copy({ kind: "item", from: fromOf(), items: sel.ks.map((k) => plain(s.board[k])), keys: sel.ks.map((k) => `${i}-${k}`) }); setSel({ i: -1, ks: [], last: -1 }); }}><Copy size={13} /> Copy</button>
                          <button type="button" className="btn btn-sm btn-quiet" onClick={() => setSel({ i, ks: s.board.map((_, k) => k), last: -1 })}>Select all</button>
                          <button type="button" className="btn btn-sm btn-quiet" onClick={() => setSel({ i: -1, ks: [], last: -1 })}>Clear</button>
                        </div>
                      )}
                      {pasteNote?.i === i && <span className="hint">{pasteNote.text}</span>}
                      {s.board.map((b, k) => (
                        <ItemEditor key={k} item={b} lesson={lesson} say={s.say} notePictures={notePictures}
                          active={Boolean(running && position.item === `${savedIndex}-${k}` && saved?.say === s.say)}
                          earlier={draft.segments.slice(0, i + 1).flatMap((sg, si) => sg.board.map((x, xi) => ({ x, key: `${si}-${xi}`, si, xi })))
                            .filter(({ x, si, xi }) => !["highlight", "newBoard", "remove", "camera", "pause"].includes(x.type) && (si < i || xi < k))
                            .map(({ x, key, si }) => ({ key, label: `Part ${si + 1}: ${itemLabel(x)}`, item: x, background: draft.segments[si].background }))}
                          onChange={(nb) => setSeg(i, { board: s.board.map((x, j) => (j === k ? nb : x)) })}
                          onRemove={() => setSeg(i, { board: s.board.filter((_, j) => j !== k) })}
                          onCopy={() => clipboard.copy({ kind: "item", from: fromOf(), items: [plain(b)], keys: [`${i}-${k}`] })}
                          selected={sel.i === i && sel.ks.includes(k)} onSelect={(e) => pick(i, k, e.shiftKey)}
                          onDuplicate={() => s.board.length < MAX_ITEMS && setSeg(i, { board: [...s.board.slice(0, k + 1), plain(b), ...s.board.slice(k + 1)] })}
                          first={k === 0} last={k === s.board.length - 1}
                          onMove={(dir) => {
                            const board = [...s.board];
                            [board[k], board[k + dir]] = [board[k + dir], board[k]];
                            setSeg(i, { board });
                          }} />
                      ))}
                      <div className="row-tight" style={{ gap: 6 }}>
                        <button type="button" className="btn btn-sm btn-quiet" disabled={s.board.length >= MAX_ITEMS} onClick={() => setSeg(i, { board: [...s.board, { type: "text", text: "" }] })}><Plus size={13} /> Board item</button>
                        <span className="hint" style={{ alignSelf: "center" }}>Tip: paste a picture here to add it.</span>
                        <button type="button" className="btn btn-sm btn-quiet" onClick={() => setDraft((d) => ({ ...d, segments: [...d.segments.slice(0, i + 1), { say: "", board: [] }, ...d.segments.slice(i + 1)] }))}><Plus size={13} /> Part after this</button>
                        {clip?.kind === "item" && (
                          <button type="button" className="btn btn-sm btn-quiet" disabled={s.board.length + (clip.items?.length || 0) > MAX_ITEMS}
                            title={s.board.length + (clip.items?.length || 0) > MAX_ITEMS ? `A part holds at most ${MAX_ITEMS} items.` : itemLabel(clip.items?.[0] || {})}
                            onClick={() => setSeg(i, { board: [...s.board, ...pasteItems(clip, lesson, i, s.board.length)] })}><ClipboardPaste size={13} /> {(clip.items?.length || 0) > 1 ? `Paste ${clip.items.length} items` : "Paste item"}</button>
                        )}
                        {clip?.kind === "part" && (
                          <button type="button" className="btn btn-sm btn-quiet"
                            onClick={() => setDraft((d) => ({ ...d, segments: [...d.segments.slice(0, i + 1), ...(clip.parts || []).map((p) => ({ say: p.say, board: p.board.map((b) => portItem(b, clip.from, lesson)) })), ...d.segments.slice(i + 1)] }))}>
                            <ClipboardPaste size={13} /> Paste part after this</button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
