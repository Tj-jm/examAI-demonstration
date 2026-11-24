import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useOutletContext, useParams } from "react-router-dom";
import {
  ArrowLeft, Save, Play, Download, Sparkles, Plus, Trash2, Copy, ChevronUp, ChevronDown, Upload, X, ListOrdered, LayoutGrid, Wand2, FileText,
} from "lucide-react";
import {
  useGetSlideDeckQuery, useGetSlideItemsQuery, useSaveSlideDeckMutation, useSlideOutlineMutation, useSlideGenerateMutation, useSlideRewriteMutation, useSlideFileTextMutation,
} from "../api/slideApi";
import { useGetBatchQuery, useGetTreeQuery, useUploadMediaMutation } from "../api/contentApi";
import { Loading, ErrorNote, Field, useConfirm, DownloadButton, Spinner } from "../components/bits";
import { useCtrlS, useUnsaved } from "../components/ListTools";
import SlideView, { FitSlide } from "../components/SlideView";
import Latex from "../components/Latex";
import { SLIDE_LOOKS, SLIDE_PRESETS, SLIDE_FONTS } from "../utils/slideLooks";
import { exportPptx } from "../utils/slidePptx";

// Admin → Batch → Slides → a deck (backend controllers/admin/slideController.js).
// Set up: the source, a brief and the look; the AI's outline, edited; then
// the slides it writes, edited one by one. Present, .pptx and PDF.

const LAYOUTS = [
  ["title", "Title"], ["section", "Section divider"], ["bullets", "Bullets"], ["twoCol", "Two columns"],
  ["imageText", "Picture and text"], ["quote", "Quote or definition"], ["code", "Code"], ["quiz", "Quiz question"],
];
const LANGS = [["en", "English"], ["bn", "Bangla"], ["hi", "Hindi"], ["ar", "Arabic"], ["ur", "Urdu"], ["es", "Spanish"], ["fr", "French"]];
const FIELDS = ["title", "brief", "slideCount", "language", "source", "look", "footer", "outline", "slides", "published", "allowDownload"];
const pick = (d) => Object.fromEntries(FIELDS.map((k) => [k, d[k]]));
const lines = (a) => (a || []).join("\n");
const unlines = (t) => String(t).split("\n");
const clean = (a) => a.map((x) => x.trim()).filter(Boolean);
const blank = (layout) => ({ layout, title: "", subtitle: "", bullets: [], leftTitle: "", rightTitle: "", left: [], right: [], image: "", imagePrompt: "", code: "", codeLang: "", quote: "", by: "", quiz: { question: "", options: ["", "", "", ""], answer: 0 }, notes: "" });
const mono = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: 13 };
const SAMPLE = { layout: "bullets", title: "Newton's Second Law", bullets: ["Force equals mass times acceleration: $F = ma$", "Double the force, double the acceleration", "Unit: newton (N)"] };

// A callback ref, so it starts measuring when the element appears.
const useWidth = () => {
  const [w, setW] = useState(0);
  const ro = useRef(null);
  const ref = useCallback((el) => {
    ro.current?.disconnect();
    if (!el) return;
    ro.current = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.current.observe(el);
  }, []);
  return [ref, w];
};

const Picture = ({ id, deck, onPick, onClear, label }) => {
  const [upload, state] = useUploadMediaMutation();
  const url = deck.pictures?.[id];
  return (
    <div className="row-tight" style={{ gap: 6, flexWrap: "wrap" }}>
      {url && <img src={url} alt="" style={{ height: 40, maxWidth: 120, objectFit: "contain", border: "1px solid var(--border)", borderRadius: 6 }} />}
      <label className="btn btn-sm btn-quiet" style={{ cursor: "pointer" }}>
        <Upload size={13} /> {url ? "Change" : label}
        <input type="file" accept="image/*" hidden onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          const r = await upload({ file: f, folder: "lectures" });
          if (r.data?._id) onPick(r.data._id, r.data.url);
        }} />
      </label>
      {url && <button type="button" className="icon-btn" title="Remove" onClick={onClear}><X size={14} /></button>}
      {state.isLoading && <Spinner />}
      <ErrorNote error={state.error} />
    </div>
  );
};

function LookPanel({ deck, set, addPicture }) {
  const look = deck.look || {};
  const setLook = (p) => set({ look: { ...look, ...p } });
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 }}>
        {SLIDE_PRESETS.map((p) => (
          <button key={p} type="button" onClick={() => setLook({ preset: p })}
            style={{ padding: 4, borderRadius: 8, cursor: "pointer", background: "none", border: `2px solid ${look.preset === p ? "var(--accent, var(--primary))" : "var(--border)"}` }}>
            <div style={{ borderRadius: 4, overflow: "hidden" }}><FitSlide deck={{ ...deck, look: { ...look, preset: p } }} slide={SAMPLE} total={0} /></div>
            <div className="small" style={{ marginTop: 4, fontWeight: look.preset === p ? 700 : 400 }}>{SLIDE_LOOKS[p].label}</div>
          </button>
        ))}
      </div>
      {look.preset === "custom" && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="row-tight" style={{ gap: 12, flexWrap: "wrap" }}>
            {[["bg", "Background"], ["text", "Text"], ["accent", "Accent"]].map(([k, label]) => (
              <label key={k} className="row-tight small" style={{ gap: 6 }}>
                <input type="color" value={look[k] || SLIDE_LOOKS.custom[k]} onChange={(e) => setLook({ [k]: e.target.value })} /> {label}
              </label>
            ))}
          </div>
          <div className="row-tight" style={{ gap: 8, flexWrap: "wrap" }}>
            {[["headFont", "Headings"], ["bodyFont", "Text"]].map(([k, label]) => (
              <label key={k} className="small stack" style={{ gap: 2 }}>{label}
                <select className="select" value={look[k] || ""} onChange={(e) => setLook({ [k]: e.target.value })}>
                  <option value="">Inter</option>
                  {Object.entries(SLIDE_FONTS).filter(([f]) => f !== "inter").map(([f, v]) => <option key={f} value={f}>{v.label}</option>)}
                </select>
              </label>
            ))}
          </div>
          <Picture id={look.bgImage} deck={deck} label="Background picture" onPick={(id, url) => { addPicture(id, url); setLook({ bgImage: id }); }} onClear={() => setLook({ bgImage: "" })} />
        </div>
      )}
      <Picture id={look.logo} deck={deck} label="Upload a logo" onPick={(id, url) => { addPicture(id, url); setLook({ logo: id }); }} onClear={() => setLook({ logo: "" })} />
      {!look.logo && (
        <label className="row-tight small" style={{ gap: 6 }}>
          <input type="checkbox" checked={look.siteLogo !== false} onChange={(e) => setLook({ siteLogo: e.target.checked })} />
          Otherwise show the institution logo{deck.pictures?.site ? "" : " (none is set in Settings yet)"}
        </label>
      )}
      <h3 style={{ marginTop: 8 }}>Students</h3>
      <label className="row-tight small"><input type="checkbox" checked={Boolean(deck.published)} onChange={(e) => set({ published: e.target.checked })} /> Show to students in this batch</label>
      {deck.published && <label className="row-tight small"><input type="checkbox" checked={Boolean(deck.allowDownload)} onChange={(e) => set({ allowDownload: e.target.checked })} /> Let them download the PDF</label>}
      <span className="hint">Speaker notes are never shown to students. The batch needs &quot;Lecture slides&quot; ticked under Overview → What is included.</span>
      <h3 style={{ marginTop: 8 }}>Footer and logo</h3>
      <label className="row-tight small"><input type="checkbox" checked={deck.footer?.show !== false} onChange={(e) => set({ footer: { ...deck.footer, show: e.target.checked } })} /> Footer</label>
      {deck.footer?.show !== false && (
        <>
          <input className="input" placeholder="Footer text (course or batch name)" value={deck.footer?.text || ""} onChange={(e) => set({ footer: { ...deck.footer, text: e.target.value } })} />
          <label className="row-tight small"><input type="checkbox" checked={deck.footer?.numbers !== false} onChange={(e) => set({ footer: { ...deck.footer, numbers: e.target.checked } })} /> Slide numbers</label>
        </>
      )}
    </div>
  );
}

const TYPE_LABEL = { mcq: "MCQ", mtf: "True/false", written: "Written", passage: "Passage", coding: "Coding" };

// A list of checkboxes. With `emptyIsAll`, an empty list means every item
// (the default, so new lectures or questions in a chapter are included).
function TickList({ items, picked = [], setPicked, label, emptyIsAll = false, empty }) {
  const all = items.map((x) => x._id);
  const on = (id) => (emptyIsAll && !picked.length) || picked.includes(id);
  const count = emptyIsAll && !picked.length ? items.length : picked.filter((id) => all.includes(id)).length;
  const toggle = (id) => {
    const base = emptyIsAll && !picked.length ? all : picked;
    const next = base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
    if (emptyIsAll && !next.length) return; // at least one stays ticked
    setPicked(emptyIsAll && next.length === all.length ? [] : next);
  };
  if (!items.length) return <span className="hint">{empty}</span>;
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="spread">
        <span className="small muted">{count} of {items.length} {label} ticked</span>
        <div className="row-tight" style={{ gap: 4 }}>
          <button type="button" className="btn btn-sm btn-quiet" onClick={() => setPicked(emptyIsAll ? [] : all)}>All</button>
          {!emptyIsAll && <button type="button" className="btn btn-sm btn-quiet" onClick={() => setPicked([])}>None</button>}
        </div>
      </div>
      <div style={{ maxHeight: 280, overflow: "auto", border: "1px solid var(--border)", borderRadius: 10, padding: 6 }}>
        {items.map((x, i) => (
          <div key={x._id}>
            {x.group && x.group !== items[i - 1]?.group && <div className="small muted" style={{ fontWeight: 700, padding: "6px 4px 2px" }}>{x.group}</div>}
            <label className="row-tight small" style={{ gap: 8, padding: "4px", alignItems: "flex-start", cursor: "pointer" }}>
              <input type="checkbox" checked={on(x._id)} onChange={() => toggle(x._id)} style={{ marginTop: 2 }} />
              <span style={{ flex: 1, minWidth: 0 }}>{x.label}</span>
              {x.tag && <span className="pill" style={{ fontSize: 11 }}>{x.tag}</span>}
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChapterSelect({ ours, src, setSrc, placeholder = "Choose a chapter" }) {
  const chapter = ours.flatMap((s) => s.chapters || []).find((c) => c._id === src.chapter);
  return (
    <div className="row-tight" style={{ gap: 8, flexWrap: "wrap" }}>
      <select className="select" style={{ minWidth: 240 }} value={src.chapter || ""} onChange={(e) => setSrc({ chapter: e.target.value || null, topic: null, questions: [], ...(src.kind === "chapter" ? { lectures: [] } : {}) })}>
        <option value="">{placeholder}</option>
        {ours.map((s) => (
          <optgroup key={s._id} label={s.title}>
            {(s.chapters || []).map((c) => <option key={c._id} value={c._id}>{c.title}</option>)}
          </optgroup>
        ))}
      </select>
      {chapter?.topics?.length > 0 && (
        <select className="select" style={{ minWidth: 200 }} value={src.topic || ""} onChange={(e) => setSrc({ topic: e.target.value || null, questions: [], ...(src.kind === "chapter" ? { lectures: [] } : {}) })}>
          <option value="">The whole chapter</option>
          {chapter.topics.map((t) => <option key={t._id} value={t._id}>{t.title}</option>)}
        </select>
      )}
      {!ours.length && <span className="hint">This batch has no subjects ticked, so there are no chapters to pick. Tick them on the batch&apos;s Overview.</span>}
    </div>
  );
}

const lectureItems = (ls, grouped) => (ls || []).map((l) => ({
  _id: l._id, label: l.title, group: grouped ? l.chapter?.title || "No chapter" : undefined, tag: l.notes ? undefined : "No notes",
}));
const questionItems = (qs, mcqOnly) => (qs || []).filter((q) => !mcqOnly || q.type === "mcq").map((q) => ({
  _id: q._id, label: <Latex>{q.question}</Latex>, tag: `${TYPE_LABEL[q.type] || q.type}${q.solved ? "" : " · no solution"}`,
}));

function Source({ deck, set, isAdmin }) {
  const src = deck.source || {};
  const setSrc = (p) => set({ source: { ...src, ...p } });
  const { data: batchData } = useGetBatchQuery(deck.batch);
  const batch = batchData?.batch;
  const { data: tree } = useGetTreeQuery();
  const wantsItems = ["chapter", "lectures", "questions"].includes(src.kind);
  const { data: items, isFetching } = useGetSlideItemsQuery(
    { id: deck._id, chapter: src.kind === "lectures" ? null : src.chapter, topic: src.kind === "lectures" ? null : src.topic },
    { skip: !wantsItems || (src.kind !== "lectures" && !src.chapter) },
  );
  // The quiz questions of a lectures deck come from a chapter of their own.
  const { data: quizItems } = useGetSlideItemsQuery({ id: deck._id, chapter: src.chapter, topic: src.topic }, { skip: src.kind !== "lectures" || !src.chapter });
  const [fileText, reading] = useSlideFileTextMutation();
  const subjects = new Set((batch?.subjects || []).map((s) => String(s?._id || s)));
  const ours = (tree || []).filter((s) => subjects.has(String(s._id)));
  const kinds = [
    ["chapter", "Chapter of this batch"], ["lectures", "Lectures"], ["questions", "Questions"],
    ["text", "Text or a file"],
  ];
  const quiz = src.questionMode === "quiz";
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row-tight" style={{ gap: 6, flexWrap: "wrap" }}>
        {kinds.map(([k, label]) => (
          <button key={k} type="button" className={`pill pill-btn${src.kind === k ? " pill-on" : ""}`} onClick={() => setSrc({ kind: k, lectures: [], questions: [] })}>{label}</button>
        ))}
      </div>

      {src.kind === "chapter" && (
        <>
          <ChapterSelect ours={ours} src={src} setSrc={setSrc} />
          <span className="hint">The AI writes the slides from the notes of the ticked lectures, and uses the ticked MCQs for quiz slides.</span>
          {src.chapter && (isFetching ? <Spinner /> : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
              <TickList items={lectureItems(items?.lectures)} picked={src.lectures} setPicked={(v) => setSrc({ lectures: v })} label="lectures" emptyIsAll empty="No lecture of this chapter is in this batch. The AI works from the questions and your brief." />
              <TickList items={questionItems(items?.questions, true)} picked={src.questions} setPicked={(v) => setSrc({ questions: v })} label="MCQs" emptyIsAll empty="No MCQs in this chapter for quiz slides." />
            </div>
          ))}
        </>
      )}

      {src.kind === "lectures" && (
        <>
          <span className="hint">Tick the lectures, from any chapter. The AI writes the slides from their notes.</span>
          {isFetching ? <Spinner /> : <TickList items={lectureItems(items?.lectures, true)} picked={src.lectures} setPicked={(v) => setSrc({ lectures: v })} label="lectures" empty="No lectures are in this batch yet." />}
          <div className="stack" style={{ gap: 6, marginTop: 4 }}>
            <strong className="small">Quiz slides (optional)</strong>
            <span className="hint">Pick a chapter and tick MCQs for quiz slides. Without any, the AI uses MCQs from the lectures&apos; chapters.</span>
            <ChapterSelect ours={ours} src={src} setSrc={setSrc} placeholder="No chapter: use the lectures' own" />
            {src.chapter && <TickList items={questionItems(quizItems?.questions, true)} picked={src.questions} setPicked={(v) => setSrc({ questions: v })} label="MCQs" empty="No MCQs in this chapter." />}
          </div>
        </>
      )}

      {src.kind === "questions" && (
        <>
          <div className="row-tight" style={{ gap: 6, flexWrap: "wrap" }}>
            <button type="button" className={`pill pill-btn${quiz ? "" : " pill-on"}`} onClick={() => setSrc({ questionMode: "revision" })}>Revision: each question, then its answer</button>
            <button type="button" className={`pill pill-btn${quiz ? " pill-on" : ""}`} onClick={() => setSrc({ questionMode: "quiz", questions: [] })}>Quiz: MCQs, answer on a key press</button>
          </div>
          <ChapterSelect ours={ours} src={src} setSrc={setSrc} />
          <span className="hint">Made straight from the questions, no AI: each one as written, {quiz ? "with its answer shown when you press A." : "then its answer and solution. Code solutions get a code slide."} Full solutions go in the speaker notes. Up to 80 questions.</span>
          {src.chapter && (isFetching ? <Spinner /> : (
            <TickList items={questionItems(items?.questions, quiz)} picked={src.questions} setPicked={(v) => setSrc({ questions: v })} label="questions" emptyIsAll empty={quiz ? "No MCQs in this chapter." : "No published questions in this chapter for this batch."} />
          ))}
        </>
      )}

      {src.kind === "text" && (
        <div className="stack" style={{ gap: 6 }}>
          <textarea className="textarea" rows={8} placeholder="Paste notes, a syllabus or a chapter" value={src.text || ""} onChange={(e) => setSrc({ text: e.target.value })} />
          <div className="row-tight">
            <label className="btn btn-sm btn-quiet" style={{ cursor: "pointer" }}>
              <FileText size={13} /> Read a PDF, Word or PowerPoint file
              <input type="file" hidden accept=".pdf,.docx,.pptx,.txt" onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                const r = await fileText(f);
                if (r.data?.text) setSrc({ text: r.data.text });
              }} />
            </label>
            {reading.isLoading && <Spinner />}
          </div>
          <ErrorNote error={reading.error} />
        </div>
      )}
    </div>
  );
}

function OutlineEditor({ outline, setOutline, deck, addPicture }) {
  const put = (i, p) => setOutline(outline.map((o, j) => (j === i ? { ...o, ...p } : o)));
  const move = (i, d) => { const n = [...outline]; [n[i], n[i + d]] = [n[i + d], n[i]]; setOutline(n); };
  return (
    <div className="stack" style={{ gap: 8 }}>
      {outline.map((o, i) => (
        <div key={i} className="row-tight" style={{ gap: 8, alignItems: "flex-start", padding: 8, border: "1px solid var(--border)", borderRadius: 10 }}>
          <strong className="small muted" style={{ width: 22, paddingTop: 8 }}>{i + 1}</strong>
          <div className="stack" style={{ gap: 6, flex: 1 }}>
            <div className="row-tight" style={{ gap: 6 }}>
              <input className="input" style={{ flex: 1, minWidth: 0 }} placeholder="Slide title" value={o.title} onChange={(e) => put(i, { title: e.target.value })} />
              <select className="select" style={{ width: 180, flex: "none" }} value={o.layout} onChange={(e) => put(i, { layout: e.target.value })}>
                {LAYOUTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            <textarea className="textarea" rows={Math.max(2, o.points.length)} placeholder="Points, one per line" value={lines(o.points)} onChange={(e) => put(i, { points: unlines(e.target.value) })} />
            {o.layout === "imageText" && (
              <Picture id={o.image} deck={deck} label="Upload a picture" onPick={(pid, url) => { addPicture(pid, url); put(i, { image: pid }); }} onClear={() => put(i, { image: "" })} />
            )}
          </div>
          <div className="stack" style={{ gap: 2 }}>
            <button type="button" className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} title="Up"><ChevronUp size={15} /></button>
            <button type="button" className="icon-btn" disabled={i === outline.length - 1} onClick={() => move(i, 1)} title="Down"><ChevronDown size={15} /></button>
            <button type="button" className="icon-btn icon-btn-danger" onClick={() => setOutline(outline.filter((_, j) => j !== i))} title="Remove"><Trash2 size={15} /></button>
          </div>
        </div>
      ))}
      <button type="button" className="btn btn-sm btn-quiet" style={{ alignSelf: "flex-start" }} onClick={() => setOutline([...outline, { title: "New slide", points: [], layout: "bullets" }])}><Plus size={13} /> Add a slide</button>
    </div>
  );
}

function SlideFields({ deck, slide, put, addPicture, onRewrite, rewriting }) {
  const [ask, setAsk] = useState("");
  const L = slide.layout;
  const q = slide.quiz || { question: "", options: [], answer: 0 };
  const listField = (k, label) => (
    <Field label={label}><textarea className="textarea" rows={Math.max(3, (slide[k] || []).length + 1)} value={lines(slide[k])} onChange={(e) => put({ [k]: unlines(e.target.value) })} placeholder="One per line" /></Field>
  );
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row-tight" style={{ gap: 8, flexWrap: "wrap" }}>
        <select className="select" value={L} onChange={(e) => put({ layout: e.target.value })}>
          {LAYOUTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <input className="input" style={{ flex: 1, minWidth: 200 }} placeholder="Ask AI to change this slide (shorter, add an example, make it a comparison...)" value={ask} onChange={(e) => setAsk(e.target.value)} />
        <button type="button" className="btn btn-sm" disabled={rewriting} onClick={() => onRewrite(ask)}>{rewriting ? <Spinner /> : <Wand2 size={14} />} Rewrite</button>
      </div>
      {L !== "quote" && <Field label="Title"><input className="input" value={slide.title} onChange={(e) => put({ title: e.target.value })} /></Field>}
      {(L === "title" || L === "section") && <Field label="Subtitle"><input className="input" value={slide.subtitle} onChange={(e) => put({ subtitle: e.target.value })} /></Field>}
      {(L === "bullets" || L === "imageText") && listField("bullets", "Bullets")}
      {L === "imageText" && (
        <Field label="Picture" hint={slide.imagePrompt ? `Suggested: ${slide.imagePrompt}` : undefined}>
          <Picture id={slide.image} deck={deck} label="Upload a picture" onPick={(id, url) => { addPicture(id, url); put({ image: id }); }} onClear={() => put({ image: "" })} />
        </Field>
      )}
      {L === "twoCol" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div className="stack" style={{ gap: 6 }}><input className="input" placeholder="Left heading" value={slide.leftTitle} onChange={(e) => put({ leftTitle: e.target.value })} />{listField("left", "Left")}</div>
          <div className="stack" style={{ gap: 6 }}><input className="input" placeholder="Right heading" value={slide.rightTitle} onChange={(e) => put({ rightTitle: e.target.value })} />{listField("right", "Right")}</div>
        </div>
      )}
      {L === "code" && (
        <>
          <Field label="Language"><input className="input" style={{ width: 160 }} value={slide.codeLang} onChange={(e) => put({ codeLang: e.target.value })} /></Field>
          <Field label="Code"><textarea className="textarea" rows={10} spellCheck={false} style={mono} value={slide.code} onChange={(e) => put({ code: e.target.value })} /></Field>
        </>
      )}
      {L === "quote" && (
        <>
          <Field label="Quote or definition"><textarea className="textarea" rows={3} value={slide.quote} onChange={(e) => put({ quote: e.target.value })} /></Field>
          <Field label="By or source"><input className="input" value={slide.by} onChange={(e) => put({ by: e.target.value })} /></Field>
        </>
      )}
      {L === "quiz" && (
        <>
          <Field label="Question"><textarea className="textarea" rows={2} value={q.question} onChange={(e) => put({ quiz: { ...q, question: e.target.value } })} /></Field>
          {(q.options.length ? q.options : ["", ""]).map((o, i, all) => (
            <div key={i} className="row-tight" style={{ gap: 6 }}>
              <input type="radio" checked={q.answer === i} onChange={() => put({ quiz: { ...q, answer: i } })} title="The right answer" />
              <strong className="small">{"ABCDEF"[i]}</strong>
              <input className="input" style={{ flex: 1 }} value={o} onChange={(e) => put({ quiz: { ...q, options: all.map((x, j) => (j === i ? e.target.value : x)) } })} />
              {all.length > 2 && <button type="button" className="icon-btn" onClick={() => put({ quiz: { ...q, options: all.filter((_, j) => j !== i), answer: q.answer >= i && q.answer > 0 ? q.answer - 1 : q.answer } })}><X size={14} /></button>}
            </div>
          ))}
          {q.options.length < 6 && <button type="button" className="btn btn-sm btn-quiet" style={{ alignSelf: "flex-start" }} onClick={() => put({ quiz: { ...q, options: [...q.options, ""] } })}><Plus size={13} /> Option</button>}
          <span className="hint">The answer shows when you press A while presenting.</span>
        </>
      )}
      <Field label="Speaker notes" hint="Only you see these: in presenter view and in the .pptx file.">
        <textarea className="textarea" rows={4} value={slide.notes} onChange={(e) => put({ notes: e.target.value })} />
      </Field>
    </div>
  );
}

export default function SlideEditor() {
  const { id } = useParams();
  const { me } = useOutletContext();
  const confirm = useConfirm();
  const { data, isLoading, error } = useGetSlideDeckQuery(id);
  const [save, saving] = useSaveSlideDeckMutation();
  const [outlineAi, outlining] = useSlideOutlineMutation();
  const [generateAi, generating] = useSlideGenerateMutation();
  const [rewriteAi, rewriting] = useSlideRewriteMutation();
  const [deck, setDeck] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState(null);
  const [sel, setSel] = useState(0);
  const [exporting, setExporting] = useState("");
  const [stageRef, stageW] = useWidth();
  const isAdmin = ["owner", "admin"].includes(me?.role);

  useEffect(() => { if (data && !dirty) setDeck(data); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  // Closing the tab or following a link asks first while unsaved; Ctrl+S saves.
  useUnsaved(dirty);
  const saveRef = useRef(null);
  useCtrlS(() => saveRef.current?.());

  if (isLoading || !deck) return <div className="page"><ErrorNote error={error} /><Loading /></div>;
  const set = (p) => { setDeck((d) => ({ ...d, ...p })); setDirty(true); };
  const addPicture = (pid, url) => setDeck((d) => ({ ...d, pictures: { ...d.pictures, [pid]: url } }));
  const take = (r) => { if (r.data) { setDeck(r.data); setDirty(false); } return r; };
  const view = tab || (deck.slides.length ? "slides" : "setup");
  const slides = deck.slides;
  const cur = slides[Math.min(sel, slides.length - 1)];
  const setSlides = (next) => set({ slides: next });
  const put = (p) => setSlides(slides.map((s, j) => (j === sel ? { ...s, ...p } : s)));
  const tidy = (d) => ({
    ...pick(d),
    outline: d.outline.map((o) => ({ ...o, points: clean(o.points) })),
    slides: d.slides.map((s) => ({ ...s, bullets: clean(s.bullets), left: clean(s.left), right: clean(s.right), quiz: { ...s.quiz, options: clean(s.quiz?.options || []) } })),
  });
  const doSave = async () => take(await save({ id, ...tidy(deck) }));
  saveRef.current = () => { if (dirty && !saving.isLoading) doSave(); };
  const doOutline = async () => take(await outlineAi({ id, ...tidy(deck) }));
  const fromQuestions = deck.source?.kind === "questions";
  const doGenerate = async () => {
    if (slides.length && !(await confirm(fromQuestions
      ? { title: "Make the slides again?", body: "Every slide is made again from the questions. The slides you have now are replaced.", confirmLabel: "Replace them", tone: "neutral" }
      : { title: "Write the slides again?", body: "The AI writes every slide from the outline. The slides you have now are replaced.", confirmLabel: "Replace them", tone: "neutral" }))) return;
    const r = take(await generateAi({ id, ...tidy(deck) }));
    if (r.data) { setTab("slides"); setSel(0); }
  };
  const doRewrite = async (ask) => {
    const r = await rewriteAi({ id, slide: cur, ask });
    if (r.data?.slide) put({ ...r.data.slide, _id: cur._id });
  };
  const addSlide = (layout) => { const n = [...slides]; n.splice(sel + 1, 0, blank(layout)); setSlides(n); setSel(sel + 1); };
  const move = (i, d) => { const n = [...slides]; [n[i], n[i + d]] = [n[i + d], n[i]]; setSlides(n); setSel(i + d); };
  const present = async () => { if (dirty) await doSave(); window.open(`${import.meta.env.BASE_URL}slides/${id}/present`, "_blank"); };
  const pptx = async () => { setExporting("pptx"); try { await exportPptx(deck); } finally { setExporting(""); } };
  const busy = outlining.isLoading || generating.isLoading;

  return (
    <div className="page" style={{ maxWidth: 1440 }}>
      <div className="spread" style={{ flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
        <div className="row-tight" style={{ gap: 8, flex: 1, minWidth: 260 }}>
          <Link to={`/batches/${deck.batch}`} className="icon-btn" title="Back to the batch"><ArrowLeft size={17} /></Link>
          <input className="input" style={{ fontSize: 18, fontWeight: 700, flex: 1 }} value={deck.title} onChange={(e) => set({ title: e.target.value })} />
        </div>
        <div className="row-tight" style={{ gap: 6, flexWrap: "wrap" }}>
          <button type="button" className={`btn btn-sm${view === "setup" ? "" : " btn-quiet"}`} onClick={() => setTab("setup")}><ListOrdered size={14} /> {fromQuestions ? "Source" : "Source and outline"}</button>
          <button type="button" className={`btn btn-sm${view === "slides" ? "" : " btn-quiet"}`} disabled={!slides.length} onClick={() => setTab("slides")}><LayoutGrid size={14} /> Slides</button>
          <button type="button" className="btn btn-sm" disabled={saving.isLoading || !dirty} onClick={doSave} title="Ctrl+S">{dirty ? <span className="dirty-dot" /> : <Save size={14} />} {saving.isLoading ? "Saving" : dirty ? "Save" : "Saved"}</button>
          <button type="button" className="btn btn-sm btn-quiet" disabled={!slides.length} onClick={present}><Play size={14} /> Present</button>
          <button type="button" className="btn btn-sm btn-quiet" disabled={!slides.length || !!exporting} onClick={pptx}>{exporting ? <Spinner /> : <Download size={14} />} .pptx</button>
          {slides.length > 0 && (dirty
            ? <button type="button" className="btn btn-sm btn-quiet" disabled title="Save first"><Download size={14} /> PDF</button>
            : <DownloadButton className="btn btn-sm btn-quiet" href={`/api/slides/${id}/pdf`} filename="slides.pdf"><Download size={14} /> PDF</DownloadButton>)}
        </div>
      </div>
      <ErrorNote error={saving.error || outlining.error || generating.error || rewriting.error} />

      {view === "setup" && (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(280px, 1fr)", gap: 16, alignItems: "start" }}>
          <div className="stack">
            <div className="card stack">
              <h3>1. What the slides are about</h3>
              <Source deck={deck} set={set} isAdmin={isAdmin} />
              {fromQuestions ? (
                <button type="button" className="btn" style={{ alignSelf: "flex-start" }} disabled={busy || !deck.source?.chapter && !deck.source?.questions?.length} onClick={doGenerate}>
                  {generating.isLoading ? <Spinner /> : <LayoutGrid size={15} />} {slides.length ? "Make the slides again" : "Make the slides"}
                </button>
              ) : (<>
              <Field label="Brief (optional)" hint="Level, focus, what to leave out, examples to use.">
                <textarea className="textarea" rows={3} value={deck.brief} onChange={(e) => set({ brief: e.target.value })} placeholder="For HSC first-year students; keep it visual; end with two numerical problems." />
              </Field>
              <div className="row-tight" style={{ gap: 12, flexWrap: "wrap" }}>
                <Field label="About how many slides"><input className="input" type="number" min={3} max={40} style={{ width: 90 }} value={deck.slideCount} onChange={(e) => set({ slideCount: Number(e.target.value) || 12 })} /></Field>
                <Field label="Language">
                  <select className="select" value={deck.language} onChange={(e) => set({ language: e.target.value })}>{LANGS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                </Field>
              </div>
              <button type="button" className="btn" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={doOutline}>
                {outlining.isLoading ? <Spinner /> : <Sparkles size={15} />} {deck.outline.length ? "Make the outline again" : "Make the outline"}
              </button>
              </>)}
            </div>
            {!fromQuestions && deck.outline.length > 0 && (
              <div className="card stack">
                <h3>2. The outline</h3>
                <p className="hint" style={{ margin: 0 }}>Change, reorder or remove slides, then let the AI write them.</p>
                <OutlineEditor outline={deck.outline} setOutline={(o) => set({ outline: o })} deck={deck} addPicture={addPicture} />
                <button type="button" className="btn" style={{ alignSelf: "flex-start" }} disabled={busy || deck.outline.length < 2} onClick={doGenerate}>
                  {generating.isLoading ? <Spinner /> : <Sparkles size={15} />} Write the slides
                </button>
                {generating.isLoading && <span className="hint">This can take a minute.</span>}
              </div>
            )}
          </div>
          <div className="card stack">
            <h3>Look</h3>
            <LookPanel deck={deck} set={set} addPicture={addPicture} />
          </div>
        </div>
      )}

      {view === "slides" && cur && (
        <div style={{ display: "grid", gridTemplateColumns: "190px minmax(0, 1fr) 300px", gap: 14, alignItems: "start" }}>
          <div className="stack" style={{ gap: 8, maxHeight: "calc(100vh - 160px)", overflow: "auto", paddingRight: 4 }}>
            {slides.map((s, i) => (
              <div key={s._id || i} style={{ position: "relative" }}>
                <button type="button" onClick={() => setSel(i)} style={{ display: "block", padding: 0, background: "none", cursor: "pointer", borderRadius: 6, overflow: "hidden", border: `2px solid ${i === sel ? "var(--accent, var(--primary))" : "var(--border)"}` }}>
                  <SlideView deck={deck} slide={s} index={i} total={slides.length} width={170} editing />
                </button>
                <span className="small muted" style={{ position: "absolute", left: -2, top: -2, background: "var(--surface)", borderRadius: 4, padding: "0 4px" }}>{i + 1}</span>
              </div>
            ))}
            <select className="select" value="" onChange={(e) => e.target.value && addSlide(e.target.value)}>
              <option value="">+ Add a slide</option>
              {LAYOUTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          <div className="stack" style={{ gap: 12 }}>
            <div ref={stageRef} style={{ width: "100%" }}>
              {stageW > 0 && <div style={{ boxShadow: "0 4px 18px rgba(0,0,0,0.12)", borderRadius: 8, overflow: "hidden" }}><SlideView deck={deck} slide={cur} index={sel} total={slides.length} width={stageW} editing answer /></div>}
            </div>
            <div className="row-tight" style={{ gap: 4 }}>
              <button type="button" className="icon-btn" disabled={sel === 0} onClick={() => move(sel, -1)} title="Move up"><ChevronUp size={16} /></button>
              <button type="button" className="icon-btn" disabled={sel === slides.length - 1} onClick={() => move(sel, 1)} title="Move down"><ChevronDown size={16} /></button>
              <button type="button" className="icon-btn" title="Duplicate" onClick={() => { const n = [...slides]; const { _id, ...copy } = cur; n.splice(sel + 1, 0, copy); setSlides(n); setSel(sel + 1); }}><Copy size={16} /></button>
              <button type="button" className="icon-btn icon-btn-danger" title="Delete this slide" disabled={slides.length < 2} onClick={() => { setSlides(slides.filter((_, j) => j !== sel)); setSel(Math.max(0, sel - 1)); }}><Trash2 size={16} /></button>
              <span className="hint" style={{ marginLeft: 8 }}>Slide {sel + 1} of {slides.length}</span>
            </div>
            <div className="card"><SlideFields key={sel} deck={deck} slide={cur} put={put} addPicture={addPicture} onRewrite={doRewrite} rewriting={rewriting.isLoading} /></div>
          </div>
          <div className="card stack">
            <h3>Look</h3>
            <LookPanel deck={deck} set={set} addPicture={addPicture} />
          </div>
        </div>
      )}
    </div>
  );
}
