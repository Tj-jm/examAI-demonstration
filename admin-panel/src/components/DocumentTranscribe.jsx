import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ScanText, Upload, Square, Copy, Download, Check, AlertTriangle, Loader2, Sparkles } from "lucide-react";
import { useTranscribePagesMutation, useQuestionsFromTextMutation, useGetIngestStatusQuery, useGetIngestJobsQuery, useCancelIngestJobMutation } from "../api/aiApi";
import { ErrorNote, Field, FilingSelect } from "./bits";
import Latex from "./Latex";

// Reads a PDF or a picture of a page with AI vision and gives it back: the
// text exactly as printed (maths in LaTeX) and every figure cut out as a
// picture. Nothing is saved as questions — it's for copying into notes,
// lectures or the question editor (backend ingestController.transcribeDocument).

const IMAGE_LINE = /^!\[([^\]]*)\]\(([^)]+)\)$/;
// Pictures keep their permanent app link (/api/stream/file/…): pasted into
// lecture notes it works for students and in the mobile app. An address
// made absolute here would be the admin panel's own, which students can't
// always reach.
const pageMarkdown = (page) => `## Page ${page.page}\n\n${page.text || ""}`;

const save = (blob, name) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

// The text as shown: maths drawn, figures as pictures, one printed line per line.
function PageView({ text }) {
  return (
    <div className="stack" style={{ gap: 4 }}>
      {String(text || "").split("\n").map((line, i) => {
        const pic = line.trim().match(IMAGE_LINE);
        if (pic) return <img key={i} src={pic[2]} alt={pic[1]} style={{ maxWidth: "100%", maxHeight: 320, objectFit: "contain", alignSelf: "flex-start", border: "1px solid var(--line, #ddd)", borderRadius: 6 }} />;
        if (!line.trim()) return <div key={i} style={{ height: 6 }} />;
        return <Latex key={i} as="div">{line}</Latex>;
      })}
    </div>
  );
}

const PICTURE = ["image/png", "image/jpeg", "image/webp"];

const MAKE_TYPES = [["mcq", "Multiple choice"], ["mtf", "True / false"], ["written", "Written"], ["passage", "Passage"]];

// The read text made into questions of one type, filed for review.
function MakeQuestions({ tree, text }) {
  const [subject, setSubject] = useState("");
  const [filing, setFiling] = useState("");
  const [type, setType] = useState("mcq");
  const [writeSolutions, setWriteSolutions] = useState(false);
  const [make, made] = useQuestionsFromTextMutation();
  const chapters = (tree || []).find((s) => s._id === subject)?.chapters || [];
  const [kind, refId] = filing.split(":");
  const topicId = kind === "topic" ? refId : undefined;
  const chapterId = kind === "chapter" ? refId : undefined;
  const blocked = type === "passage" && kind === "topic";
  return (
    <div className="card-quiet stack">
      <strong className="small">Make questions from this text</strong>
      <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <Field label="Subject">
          <select className="select" value={subject} onChange={(e) => { setSubject(e.target.value); setFiling(""); }}>
            <option value="">Choose a subject</option>
            {(tree || []).map((s) => <option key={s._id} value={s._id}>{s.title}</option>)}
          </select>
        </Field>
        {subject && (
          <Field label="Topic or chapter">
            <FilingSelect chapters={chapters} value={filing} onChange={setFiling} placeholder="Choose a topic or chapter" />
          </Field>
        )}
      </div>
      <div className="row-tight" style={{ flexWrap: "wrap" }}>
        {MAKE_TYPES.map(([value, label]) => (
          <button key={value} type="button" className={`pill pill-btn${type === value ? " pill-on" : ""}`} onClick={() => setType(value)}>{label}</button>
        ))}
        <button type="button" className={`pill pill-btn${writeSolutions ? " pill-on" : ""}`}
          title="On: AI writes its own step-by-step solution for every question. Off: printed solutions are copied; AI writes a short one only where none is printed."
          onClick={() => setWriteSolutions(!writeSolutions)}>
          {writeSolutions ? "AI writes solutions" : "Printed solutions"}
        </button>
      </div>
      {blocked && <p className="hint" style={{ margin: 0 }}>Passage questions can only be filed under a chapter.</p>}
      <button type="button" className="btn btn-primary" style={{ alignSelf: "flex-start" }}
        disabled={!(topicId || chapterId) || blocked || made.isLoading}
        onClick={() => make({ text, type, topicId, chapterId, writeSolutions })}>
        {made.isLoading ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} Make {MAKE_TYPES.find(([v]) => v === type)[1].toLowerCase()} questions
      </button>
      <ErrorNote error={made.error} />
      {made.data && (
        <div className="banner banner-ok row-tight">
          <Check size={16} />
          <span>{made.data.message} <Link to={`/review?${topicId ? `topic=${topicId}` : `chapter=${chapterId}&topic=none`}`} style={{ textDecoration: "underline" }}>Review them</Link></span>
        </div>
      )}
    </div>
  );
}

export default function DocumentTranscribe({ enabled, tree, picture }) {
  const input = useRef(null);
  const [file, setFile] = useState(null);
  const [pages, setPages] = useState("");
  const [language, setLanguage] = useState("");
  const [raw, setRaw] = useState(false);
  const [copied, setCopied] = useState(false);
  const [start, started] = useTranscribePagesMutation();
  const card = useRef(null);
  const takePicture = (f) => {
    setFile(f);
    card.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  // A picture handed over by the document card above.
  useEffect(() => { if (picture) takePicture(picture); }, [picture]);
  const preview = useMemo(() => (file && PICTURE.includes(file.type) ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const [cancel, { isLoading: stopping }] = useCancelIngestJobMutation();

  // Coming back to the page picks up the latest reading run.
  const { data: myJobs } = useGetIngestJobsQuery();
  const [jobId, setJobId] = useState(null);
  useEffect(() => {
    if (jobId) return;
    const latest = myJobs?.jobs?.find((j) => j.mode === "transcribe");
    if (latest) setJobId(latest.jobId);
  }, [myJobs, jobId]);

  const [poll, setPoll] = useState(1500);
  const status = useGetIngestStatusQuery(jobId, { skip: !jobId, pollingInterval: poll });
  const job = status.currentData;
  const running = job?.status === "running";
  useEffect(() => { setPoll(!job || running ? 1500 : 0); }, [job, running]);
  useEffect(() => {
    if (window.location.hash === "#read-pages") document.getElementById("read-pages")?.scrollIntoView({ block: "start" });
  }, []);

  const isPdf = file?.type === "application/pdf";
  const run = async () => {
    const r = await start({ file, pages: isPdf ? pages.trim() : "", language: language.trim() });
    if (!r.error) { setPoll(1500); setJobId(r.data.jobId); }
  };

  const result = job?.result?.pages || [];
  const allText = result.filter((p) => p.text).map(pageMarkdown).join("\n\n");
  const allFigures = result.flatMap((p) => p.figures.filter((f) => f.url));
  const copyAll = async () => {
    await navigator.clipboard.writeText(allText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const downloadFigure = async (f) => {
    const blob = await (await fetch(f.url, { credentials: "include" })).blob();
    save(blob, `${f.id}${f.caption ? `-${f.caption.replace(/[^\wঀ-৿-]+/g, "_").slice(0, 40)}` : ""}.png`);
  };
  const base = (job?.filename || "pages").replace(/\.[a-z0-9]+(\s|$)/i, "$1").replace(/[^\wঀ-৿() -]+/g, "_").trim();

  return (
    <div className="card stack" id="read-pages" ref={card} style={{ scrollMarginTop: 16 }}>
      <div className="row-tight"><ScanText size={17} className="muted" /><h2>Read text and figures</h2></div>
      <p className="hint" style={{ margin: 0 }}>
        AI reads a PDF or a picture of a page: the text exactly as printed (maths as LaTeX) and every figure cut out
        as its own picture. Copy or download them, or make them into questions.
        Pages read before are reused at no cost.
      </p>

      <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <Field label="File" hint={file ? `${file.name} · ${(file.size / 1e6).toFixed(1)} MB` : "PDF, PNG, JPG or WebP"}>
          <div className="row-tight">
            <input ref={input} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" style={{ display: "none" }}
              onChange={(e) => setFile(e.target.files?.[0] || null)} />
            <button type="button" className="btn btn-sm" onClick={() => input.current?.click()}><Upload size={14} /> {file ? "Change file" : "Choose file"}</button>
          </div>
        </Field>
        {isPdf && (
          <Field label="Pages" hint="Empty: every page">
            <input className="input" style={{ width: 140 }} value={pages} placeholder="e.g. 30-32, 40" onChange={(e) => setPages(e.target.value)} />
          </Field>
        )}
        <Field label="Language" hint="Empty: as printed">
          <input className="input" style={{ width: 140 }} value={language} placeholder="e.g. Bangla" onChange={(e) => setLanguage(e.target.value)} />
        </Field>
        <button type="button" className="btn btn-primary" disabled={!enabled || !file || started.isLoading || running} onClick={run}>
          {started.isLoading ? <Loader2 size={14} className="spin" /> : <ScanText size={14} />} Read pages
        </button>
      </div>
      {preview && (
        <img src={preview} alt="" style={{ maxWidth: 260, maxHeight: 180, objectFit: "contain", alignSelf: "flex-start", border: "1px solid var(--line, #ddd)", borderRadius: 6 }} />
      )}
      <ErrorNote error={started.error} />

      {running && (
        <div className="stack" style={{ gap: 6 }}>
          <div className="row-tight small">
            <Loader2 size={14} className="spin" />
            <span className="grow">
              {job.waiting ? "Waiting for another document run to finish…" : job.phase === "figures" ? "Cutting out figures…" : job.scansTotal ? `Reading page ${Math.min(job.scansDone + 1, job.scansTotal)} of ${job.scansTotal}…` : "Getting the pages ready…"}
            </span>
            <button type="button" className="btn btn-sm btn-quiet" disabled={stopping} onClick={() => cancel(jobId)}><Square size={12} /> Stop</button>
          </div>
          <div className="progress"><div className="progress-bar" style={{ width: `${job.phase === "figures" ? 100 : job.scansTotal ? Math.round((job.scansDone / job.scansTotal) * 100) : 0}%` }} /></div>
        </div>
      )}

      {job && !running && job.error && (
        <div className="banner banner-warn row-tight"><AlertTriangle size={15} style={{ flexShrink: 0 }} /><span>{job.error}</span></div>
      )}
      {job && !running && job.failures?.length > 0 && (
        <p className="hint" style={{ margin: 0 }}>
          {job.failures.map((f) => `Page ${f.page}: ${f.reason}`).join(" · ")}
        </p>
      )}

      {result.length > 0 && !running && (
        <>
          <div className="row-tight" style={{ gap: 8, flexWrap: "wrap" }}>
            <strong className="grow small">{job.filename} · {result.filter((p) => p.text).length} page{result.length === 1 ? "" : "s"} · {allFigures.length} figure{allFigures.length === 1 ? "" : "s"}</strong>
            <button type="button" className="btn btn-sm" onClick={() => setRaw(!raw)}>{raw ? "Show as printed" : "Show raw text"}</button>
            <button type="button" className="btn btn-sm" onClick={copyAll}>{copied ? <Check size={14} /> : <Copy size={14} />} Copy all text</button>
            <button type="button" className="btn btn-sm" onClick={() => save(new Blob([allText], { type: "text/markdown" }), `${base}.md`)}><Download size={14} /> Download text (.md)</button>
            {allFigures.length > 0 && (
              <button type="button" className="btn btn-sm" onClick={async () => { for (const f of allFigures) await downloadFigure(f); }}><Download size={14} /> Download all figures</button>
            )}
          </div>

          <MakeQuestions tree={tree} text={allText} />

          {result.map((p) => (
            <div key={p.page} className="stack" style={{ gap: 8, borderTop: "1px solid var(--line, #e5e7eb)", paddingTop: 10 }}>
              <strong className="small">Page {p.page}</strong>
              {p.text === null ? <span className="hint">Not read.</span>
                : raw ? <textarea className="textarea" readOnly rows={Math.min(18, p.text.split("\n").length + 1)} value={p.text} style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }} />
                  : <PageView text={p.text} />}
              {p.figures.length > 0 && (
                <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
                  {p.figures.map((f) => (
                    <div key={f.id} className="stack" style={{ gap: 4, width: 170 }}>
                      {f.url ? <img src={f.url} alt={f.caption} style={{ width: "100%", height: 110, objectFit: "contain", background: "#fff", border: "1px solid var(--line, #ddd)", borderRadius: 6 }} />
                        : <div className="hint" style={{ height: 110, display: "flex", alignItems: "center", justifyContent: "center", border: "1px dashed var(--line, #ccc)", borderRadius: 6, padding: 6, textAlign: "center" }}>{f.problem}</div>}
                      <span className="small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.caption}>{f.caption || f.id}</span>
                      {f.url && <button type="button" className="btn btn-sm btn-quiet" onClick={() => downloadFigure(f)}><Download size={13} /> Download</button>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
