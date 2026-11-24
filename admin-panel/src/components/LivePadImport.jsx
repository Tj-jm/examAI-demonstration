import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ImagePlus, ClipboardPaste, MonitorUp, FileQuestion, Loader2, X, Search, Save, Check } from "lucide-react";
import { useUploadMediaMutation, useGetQuestionsQuery, useGetQuestionTagsQuery, useSaveLivePadNotesMutation } from "../api/contentApi";
import { btn, pageImage } from "./LiveWritingPad";
import Latex from "./Latex";
import { FONT, mathImage, runsOf } from "../utils/mathImage";
import SearchSelect from "./SearchSelect";

// The host's extra writing-pad buttons: put a picture on a page (a file,
// a pasted image or a snapshot of a screen or window) or a question from
// the bank (only questions tagged "live class"). Each is uploaded once and
// the page carries its url, so every student loads the same image.

const MAX_SIDE = 2000;
const CARD_W = 1400; // the question card, in page units (the page is 1600 wide)
const PX = 34;
const LINE = Math.round(PX * 1.6);
const LIVE_TAG = /live[\s_-]*class/i;

const toJpeg = (source, w, h) => {
  const s = Math.min(1, MAX_SIDE / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * s);
  c.height = Math.round(h * s);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(source, 0, 0, c.width, c.height);
  return new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.9));
};

const fileToJpeg = async (file) => {
  const bmp = await createImageBitmap(file);
  return toJpeg(bmp, bmp.width, bmp.height);
};

const loadImg = async (url) => {
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error();
    return await createImageBitmap(await r.blob());
  } catch {
    return null;
  }
};

// A question's text without markdown, every kind of maths as $...$ (the
// card draws $...$).
const plain = (t) => String(t || "")
  .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
  .replace(/\*\*|__/g, "")
  .replace(/^#+\s*/gm, "")
  .replace(/\$\$([\s\S]+?)\$\$/g, (m, x) => `$${x.replace(/\s*\n\s*/g, " ")}$`)
  .replace(/\\\[([\s\S]+?)\\\]/g, (m, x) => `$${x.replace(/\s*\n\s*/g, " ")}$`)
  .replace(/\\\(([\s\S]+?)\\\)/g, (m, x) => `$${x}$`);

// The question as one picture: words wrapped to the card's width, $maths$
// drawn by MathJax, its picture under the text, then the options.
async function questionCard(q) {
  const paras = [];
  if (q.context) paras.push(...plain(q.context).split(/\n+/));
  paras.push(...plain(`${q.partLabel ? `(${q.partLabel}) ` : ""}${q.question}`).split(/\n+/));
  const opts = (q.options || []).map((o) => plain(`(${o.key}) ${o.text || ""}`));

  const measure = document.createElement("canvas").getContext("2d");
  measure.font = FONT(PX);
  const space = measure.measureText(" ").width;
  // Each paragraph into lines of placed pieces.
  const lines = [];
  const layout = async (text) => {
    const pieces = [];
    for (const run of runsOf(text.trim())) {
      if (run.math) {
        const m = await mathImage(`$${run.math}$`, { px: PX }).catch(() => null);
        if (m) pieces.push({ img: m.img, w: m.w, h: m.h });
        else pieces.push({ text: `$${run.math}$`, w: measure.measureText(`$${run.math}$`).width });
      } else {
        for (const word of run.text.split(/(\s+)/)) {
          if (!word) continue;
          pieces.push(/^\s+$/.test(word) ? { space: true, w: space } : { text: word, w: measure.measureText(word).width });
        }
      }
    }
    let line = { items: [], w: 0, h: LINE };
    for (const piece of pieces) {
      if (piece.space && !line.items.length) continue;
      if (!piece.space && line.w + piece.w > CARD_W && line.items.length) {
        lines.push(line);
        line = { items: [], w: 0, h: LINE };
      }
      line.items.push({ ...piece, x: line.w });
      line.w += piece.w;
      if (piece.img) line.h = Math.max(line.h, piece.h + 12);
    }
    if (line.items.length) lines.push(line);
  };
  for (const p of paras) if (p.trim()) await layout(p);
  const pic = q.questionImage?.url ? await loadImg(q.questionImage.url) : null;
  const picBox = pic ? (() => { const s = Math.min(1, CARD_W / pic.width, 360 / pic.height); return { w: pic.width * s, h: pic.height * s }; })() : null;
  const firstOption = lines.length;
  for (const o of opts) await layout(o);

  const width = Math.ceil(Math.max(...lines.map((l) => l.w), picBox?.w || 0, 200));
  const height = Math.ceil(lines.reduce((n, l) => n + l.h, 0) + (picBox ? picBox.h + 16 : 0) + 8);
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#111827";
  ctx.font = FONT(PX);
  ctx.textBaseline = "middle";
  let y = 0;
  lines.forEach((l, i) => {
    if (i === firstOption && picBox) {
      ctx.drawImage(pic, 0, y + 8, picBox.w, picBox.h);
      y += picBox.h + 16;
    }
    for (const it of l.items) {
      if (it.img) ctx.drawImage(it.img, it.x, y + (l.h - it.h) / 2, it.w, it.h);
      else if (it.text) ctx.fillText(it.text, it.x, y + l.h / 2);
    }
    y += l.h;
  });
  if (picBox && firstOption >= lines.length) ctx.drawImage(pic, 0, y + 8, picBox.w, picBox.h);
  return new Promise((ok) => c.toBlob(ok, "image/png"));
}

function QuestionPicker({ onPick, onClose, busy }) {
  const { data: allTags, isLoading: tagsLoading } = useGetQuestionTagsQuery();
  const tags = (allTags || []).filter((t) => LIVE_TAG.test(t));
  const [tag, setTag] = useState("");
  const [search, setSearch] = useState("");
  const [typed, setTyped] = useState("");
  const [page, setPage] = useState(1);
  const useTag = tag || tags[0] || "";
  useEffect(() => { const t = setTimeout(() => { setSearch(typed); setPage(1); }, 350); return () => clearTimeout(t); }, [typed]);
  const { data, isFetching } = useGetQuestionsQuery({ tag: useTag, search: search || undefined, page, limit: 12 }, { skip: !useTag });
  const list = data?.questions || [];
  // On the page body: the room's own text colour and the toolbar's
  // no-select rules stay out of it.
  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(10,12,18,0.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }} onClick={onClose}>
      <div className="card stack" style={{ width: "min(760px, 100%)", maxHeight: "86vh", overflow: "auto", gap: 10, color: "var(--text)" }} onClick={(e) => e.stopPropagation()}>
        <div className="spread">
          <strong>Question from the bank</strong>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><X size={16} /></button>
        </div>
        {tagsLoading ? <span className="hint">Loading…</span> : !tags.length ? (
          <p className="hint" style={{ margin: 0 }}>No question is tagged “live class” yet. In the question bank, add the tag <strong>live class</strong> to the questions you want to use in class.</p>
        ) : (
          <>
            <div className="row-tight" style={{ gap: 8, flexWrap: "wrap" }}>
              {tags.length > 1 && (
                <SearchSelect className="select" style={{ width: 180 }} value={useTag} onChange={(e) => { setTag(e.target.value); setPage(1); }}>
                  {tags.map((t) => <option key={t} value={t}>{t}</option>)}
                </SearchSelect>
              )}
              <div className="row-tight grow" style={{ gap: 6, minWidth: 200 }}>
                <Search size={15} />
                <input className="input grow" placeholder="Search the question text" value={typed} onChange={(e) => setTyped(e.target.value)} />
              </div>
              {(isFetching || busy) && <Loader2 size={16} className="spin" />}
            </div>
            {!isFetching && !list.length && <p className="hint" style={{ margin: 0 }}>No questions found.</p>}
            <div className="stack" style={{ gap: 6 }}>
              {list.map((q) => (
                <div key={q._id} className="row-tight" style={{ gap: 10, padding: "8px 10px", border: "1px solid var(--border, rgba(128,128,128,0.3))", borderRadius: 8, alignItems: "flex-start" }}>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <Latex as="div" style={{ overflow: "hidden", maxHeight: "4.8em", lineHeight: 1.6 }}>{q.question}</Latex>
                    <span className="hint small">{q.type === "mcq" ? `MCQ · ${(q.options || []).length} options` : q.type}{q.questionImage?.url ? " · picture" : ""}{q.topic?.title ? ` · ${q.topic.title}` : ""}</span>
                  </div>
                  <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => onPick(q)}>Use</button>
                </div>
              ))}
            </div>
            {(data?.pages || 1) > 1 && (
              <div className="row-tight" style={{ gap: 8, justifyContent: "center" }}>
                <button type="button" className="btn btn-sm btn-quiet" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
                <span className="small">Page {page} of {data.pages}</span>
                <button type="button" className="btn btn-sm btn-quiet" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Next</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

// Saving the pad's pages as the class's notes: each page uploaded as an
// image, then put together as one PDF on the server, which attaches it to
// the lecture made from the recording and shows it on the class page.
export function usePadNotes(id, pad) {
  const [upload] = useUploadMediaMutation();
  const [saveNotes] = useSaveLivePadNotesMutation();
  const [state, setState] = useState({ busy: false, step: "", error: "", savedAt: null, pages: 0 });
  const savedChanges = useRef(-1);
  const dirty = () => pad.used().length > 0 && pad.changes.current !== savedChanges.current;
  const save = async () => {
    const pages = pad.used();
    if (!pages.length || state.busy) return false;
    const at = pad.changes.current;
    setState((s) => ({ ...s, busy: true, error: "" }));
    try {
      const media = [];
      for (let i = 0; i < pages.length; i += 1) {
        setState((s) => ({ ...s, step: `${i + 1}/${pages.length}` }));
        let blob;
        try {
          blob = await pageImage(pages[i]);
        } catch {
          throw new Error(`Page ${i + 1} couldn't be saved: a picture on it can't be copied. Take that picture off and try again.`);
        }
        const m = await upload({ file: new File([blob], `pad-page-${i + 1}.jpg`, { type: "image/jpeg" }), folder: "lectures" }).unwrap();
        media.push(m._id);
      }
      const r = await saveNotes({ id, media }).unwrap();
      savedChanges.current = at;
      setState({ busy: false, step: "", error: "", savedAt: r.savedAt, pages: r.pages });
      return true;
    } catch (e) {
      setState((s) => ({ ...s, busy: false, step: "", error: e?.data?.message || e?.message || "Couldn't save the notes. Try again." }));
      return false;
    }
  };
  return { ...state, save, dirty };
}

// `active`: the pad is open on this screen, so a pasted image goes on it.
// `notes`: usePadNotes, for the Save notes button.
export default function LivePadImport({ pad, active, notes }) {
  const [upload] = useUploadMediaMutation();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [picking, setPicking] = useState(false);
  const fileRef = useRef(null);

  const put = async (what, blob, layer, name) => {
    if (!blob) return;
    setBusy(what);
    setError("");
    try {
      const media = await upload({ file: new File([blob], name, { type: blob.type }), folder: "general" }).unwrap();
      if (!media?.url) throw new Error();
      pad.place({ [layer]: media.url });
      return true;
    } catch (e) {
      setError(e?.data?.message || "Couldn't put that on the pad. Try again.");
      return false;
    } finally {
      setBusy("");
    }
  };
  const putFile = async (file) => {
    if (!file?.type?.startsWith("image/")) { setError("Choose an image file."); return; }
    try {
      await put("image", await fileToJpeg(file), "bg", `pad-${Date.now()}.jpg`);
    } catch {
      setError("That image couldn't be read.");
    }
  };

  // Ctrl+V / Cmd+V with an image copied (a snip, a copied picture): onto
  // the pad. Some tools put it only in the clipboard's items, not its files.
  // Ctrl+Z undoes, Ctrl+Y or Ctrl+Shift+Z redoes, while the pad is open.
  const putRef = useRef(putFile);
  putRef.current = putFile;
  const padRef = useRef(pad);
  padRef.current = pad;
  useEffect(() => {
    if (!active) return undefined;
    const typing = (e) => e.target?.closest?.("input, textarea, [contenteditable]");
    const onPaste = (e) => {
      if (typing(e)) return;
      const cd = e.clipboardData;
      const file = [...(cd?.files || [])].find((f) => f.type.startsWith("image/"))
        || [...(cd?.items || [])].find((i) => i.kind === "file" && i.type.startsWith("image/"))?.getAsFile();
      if (!file) return;
      e.preventDefault();
      putRef.current(file);
    };
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || typing(e)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); padRef.current.undo(); }
      else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); padRef.current.redo(); }
    };
    window.addEventListener("paste", onPaste);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("paste", onPaste); window.removeEventListener("keydown", onKey); };
  }, [active]);

  // The Paste button: reads an image from the clipboard (the browser asks
  // once for permission).
  const canRead = Boolean(navigator.clipboard?.read);
  const pasteNow = async () => {
    setError("");
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (type) {
          const blob = await item.getType(type);
          await putFile(new File([blob], "pasted", { type }));
          return;
        }
      }
      setError("There's no picture in the clipboard. Take a snip or copy a picture first.");
    } catch {
      setError("The browser didn't let the pad read the clipboard. Press Ctrl+V instead.");
    }
  };

  // One still from a screen, window or tab the host picks.
  const snap = async () => {
    setError("");
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    } catch {
      return; // cancelled
    }
    try {
      const v = document.createElement("video");
      v.muted = true;
      v.srcObject = stream;
      await v.play();
      await new Promise((r) => setTimeout(r, 350));
      const blob = await toJpeg(v, v.videoWidth, v.videoHeight);
      await put("screen", blob, "bg", `screen-${Date.now()}.jpg`);
    } catch {
      setError("Couldn't take the screenshot.");
    } finally {
      stream.getTracks().forEach((t) => t.stop());
    }
  };

  const pick = async (q) => {
    setBusy("question");
    setError("");
    let blob;
    try {
      blob = await questionCard(q);
    } catch {
      setBusy("");
      setError("That question couldn't be drawn.");
      return;
    }
    if (await put("question", blob, "q", `question-${q._id}.png`)) setPicking(false);
  };

  const spin = (what, Icon) => (busy === what ? <Loader2 size={15} className="spin" /> : <Icon size={15} />);
  return (
    <>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { putFile(e.target.files?.[0]); e.target.value = ""; }} />
      <button type="button" title="Put a picture on the pad (or paste one with Ctrl+V)" style={btn(false)} disabled={Boolean(busy)} onClick={() => fileRef.current?.click()}>{spin("image", ImagePlus)} Picture</button>
      {canRead && <button type="button" title="Put the picture you copied or snipped on the pad (or press Ctrl+V)" style={btn(false)} disabled={Boolean(busy)} onClick={pasteNow}><ClipboardPaste size={15} /> Paste</button>}
      {navigator.mediaDevices?.getDisplayMedia && (
        <button type="button" title="Snapshot of a screen, window or tab" style={btn(false)} disabled={Boolean(busy)} onClick={snap}>{spin("screen", MonitorUp)} Screenshot</button>
      )}
      <button type="button" title="A question from the bank (tagged live class)" style={btn(false)} disabled={Boolean(busy)} onClick={() => setPicking(true)}>{spin("question", FileQuestion)} Question</button>
      {notes && (
        <button type="button" title="Save every page as a PDF: it goes with the class's recording lecture and on the students' class page" style={btn(false)} disabled={notes.busy || !pad.used().length} onClick={notes.save}>
          {notes.busy ? <Loader2 size={15} className="spin" /> : notes.dirty() ? <Save size={15} /> : <Check size={15} />}
          {notes.busy ? `Saving ${notes.step}…` : notes.dirty() || !notes.savedAt ? "Save notes" : `Saved ${notes.pages} page${notes.pages === 1 ? "" : "s"}`}
        </button>
      )}
      {(error || notes?.error) && <span style={{ fontSize: 12, color: "#ffb4b4", maxWidth: 280 }}>{error || notes.error}</span>}
      {picking && <QuestionPicker busy={busy === "question"} onPick={pick} onClose={() => setPicking(false)} />}
    </>
  );
}
