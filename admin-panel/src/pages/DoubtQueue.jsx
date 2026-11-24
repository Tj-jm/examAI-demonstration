import { useState, useRef, lazy, Suspense } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import {
  useGetDoubtQueueQuery, useGetDoubtQuery, useResolveDoubtMutation, useDeleteDoubtMutation,
  useUploadDoubtAnswerImageMutation,
  useGetMySolvedDoubtsQuery, useGetMyDoubtStatsQuery,
  useGetDoubtSolversQuery, useGetSolverStatsQuery,
  useGetReviewRequestsQuery, useDecideDoubtReviewMutation,
  useGetSubjectsQuery, useGetBatchesQuery,
} from "../api/contentApi";
import {
  HelpCircle, ArrowLeft, Sparkles, User, History, Wallet, ShieldAlert,
  Check, X, RotateCcw, Trash2, ImagePlus, Loader2, Search, Camera, PenLine,
} from "lucide-react";
import { Loading, ErrorNote, Empty, Field, useConfirm, Pager } from "../components/bits";
import Latex from "../components/Latex";
import LatexInserter from "../components/LatexInserter";
import { useTerms } from "../terms";
import { useGetBadgesQuery } from "../api/badgeApi";
import { useSeen } from "../hooks/useSeen";
import NewTag from "../components/NewTag";
import SearchSelect from "../components/SearchSelect";
import { useUnsaved } from "../components/ListTools";

const DrawPad = lazy(() => import("../components/DrawPad"));

// A doubt solver's entire admin panel is this one page — see
// middleware/representativeGate.js and layout/Shell.jsx for how that's
// enforced. Tabs, not separate routes: "Queue" is the open work, "My
// history" is what they've already done, "Payment summary" is the
// date-range count they and whoever pays them both need to agree on.
// "Review requests" only exists for owner/admin — deciding whether a
// student's complaint about someone's answer has merit is deliberately not
// something the person who wrote that answer gets to judge themselves.
export default function DoubtQueue() {
  const { me } = useOutletContext();
  const isSolver = ["doubtSolver", "teacher"].includes(me.role);
  // The open doubt, the tab and the queue's filters live in the url, so a
  // reload or Back keeps the place and a doubt can be linked to.
  const [params, setParams] = useSearchParams();
  const openId = params.get("doubt");
  const tab = params.get("tab") || "queue";
  const setParam = (key, value, { keep = true } = {}) => {
    const next = keep ? new URLSearchParams(params) : new URLSearchParams();
    if (value) next.set(key, value); else next.delete(key);
    setParams(next);
  };
  const setOpenId = (id) => setParam("doubt", id);
  const setTab = (value) => setParam("tab", value === "queue" ? "" : value, { keep: false });
  const isNew = useSeen("doubts");
  const { data: badges } = useGetBadgesQuery();
  const waiting = { queue: badges?.counts?.doubts, reviews: badges?.counts?.doubtReviews };

  if (openId) return <ResolveDoubt key={openId} id={openId} onClose={() => setOpenId(null)} onOpen={setOpenId} />;

  const TABS = [
    ["queue", "Queue", HelpCircle],
    ["mine", isSolver ? "My history" : "History", History],
    ["payment", "Payment summary", Wallet],
    !isSolver && ["reviews", "Review requests", ShieldAlert],
  ].filter(Boolean);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Doubts</h1>
      </div>

      <div className="row-tight" style={{ marginBottom: 4, flexWrap: "wrap" }}>
        {TABS.map(([value, label, Icon]) => (
          <button
            key={value}
            className={`pill pill-btn row-tight${tab === value ? " pill-on" : ""}`}
            style={{ gap: 5 }}
            onClick={() => setTab(value)}
          >
            <Icon size={12} /> {label}
            {waiting[value] > 0 && <span className="tab-count tnum">{waiting[value]}</span>}
          </button>
        ))}
      </div>

      {tab === "queue" && <QueueTab onOpen={setOpenId} isNew={isNew} />}
      {tab === "mine" && <HistoryTab isSolver={isSolver} onOpen={setOpenId} />}
      {tab === "payment" && <PaymentTab isSolver={isSolver} />}
      {tab === "reviews" && !isSolver && <ReviewRequestsTab isNew={isNew} />}
    </div>
  );
}

// ---------------------------------------------------------------- queue

// "5m", "3h", "2d": how long a doubt has waited.
const waitingFor = (at) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)}h`;
  return `${Math.round(mins / 1440)}d`;
};

// The queue's filters, read from the url (shared with ResolveDoubt's "next").
const queueFilters = (params) => ({
  batchId: params.get("batch") || undefined,
  subjectId: params.get("subject") || undefined,
  search: params.get("q") || undefined,
});

function QueueTab({ onOpen, isNew }) {
  const terms = useTerms();
  const [params, setParams] = useSearchParams();
  const batchId = params.get("batch") || "";
  const subjectId = params.get("subject") || "";
  const query = params.get("q") || "";
  const page = Number(params.get("page")) || 1;
  const [search, setSearch] = useState(query);
  const set = (key) => (value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== "page") next.delete("page");
    setParams(next, { replace: true });
  };
  const setBatchId = set("batch");
  const setSubjectId = set("subject");
  const setQuery = set("q");
  const setPage = (n) => set("page")(n > 1 ? String(n) : "");

  const { data, isLoading, error } = useGetDoubtQueueQuery({ ...queueFilters(params), page });
  const { data: subjects } = useGetSubjectsQuery();
  const { data: batches } = useGetBatchesQuery({});

  const doubts = data?.doubts || [];

  // Any filter change re-searches from the top — a stale page 3 with a new
  // filter applied could easily be past the end of the new, smaller result
  // set and render nothing.
  const applyFilter = (setter) => (value) => setter(value);

  return (
    <div className="stack">
      <p className="muted small tnum" style={{ margin: 0 }}>{data?.total ?? doubts.length} waiting</p>

      <form onSubmit={(e) => { e.preventDefault(); applyFilter(setQuery)(search); }} className="search-wrap">
        <Search size={15} className="search-icon" />
        <input
          className="input"
          style={{ paddingLeft: 36 }}
          placeholder="Search by student name, email or phone"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </form>

      <div className="row-tight" style={{ flexWrap: "wrap" }}>
        <SearchSelect className="select" value={subjectId} onChange={(e) => applyFilter(setSubjectId)(e.target.value)}>
          <option value="">Any subject</option>
          {(subjects || []).map((s) => <option key={s._id} value={s._id}>{s.title}</option>)}
        </SearchSelect>
        <SearchSelect className="select" value={batchId} onChange={(e) => applyFilter(setBatchId)(e.target.value)}>
          <option value="">Any {terms.batch}</option>
          {(batches || []).map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
        </SearchSelect>
      </div>

      <ErrorNote error={error} />

      {isLoading ? (
        <Loading />
      ) : doubts.length ? (
        <>
          <div className="list">
            {doubts.map((d) => (
              <button key={d._id} className="list-row" style={{ textAlign: "left" }} onClick={() => onOpen(d._id)}>
                <div className="grow">
                  <div className="row-tight" style={{ marginBottom: 4, flexWrap: "wrap" }}>
                    <NewTag show={isNew(d.escalatedAt || d.createdAt)} />
                    <span className={`pill row-tight ${d.mode === "ai" ? "pill-warn" : ""}`} style={{ gap: 4 }}>
                      {d.mode === "ai" ? <Sparkles size={11} /> : <User size={11} />}
                      {d.mode === "ai" ? "Escalated from AI" : "Asked for a human"}
                    </span>
                    {/* resolvedBy set on an "escalated" doubt only happens via
                        an approved review — a brand-new escalation never has
                        one yet, so this pill only ever appears on a reopened
                        item, which is exactly when it's worth calling out. */}
                    {d.resolvedBy && (
                      <span className="pill row-tight" style={{ gap: 4 }}>
                        <RotateCcw size={11} /> Review — your original answer
                      </span>
                    )}
                  </div>
                  <div className="small truncate" style={{ maxWidth: 480 }}>{d.question}</div>
                  <div className="muted small" style={{ marginTop: 3 }}>
                    {d.student?.name || d.student?.email || d.student?.phoneNumber}
                    {d.batch?.name ? ` · ${d.batch.name}` : ""}
                  </div>
                </div>
                <span className="muted small tnum" title={new Date(d.escalatedAt || d.createdAt).toLocaleString()}>{waitingFor(d.escalatedAt || d.createdAt)}</span>
              </button>
            ))}
          </div>
          <Pager page={data?.page || 1} pages={data?.pages || 1} total={data?.total || 0} onChange={setPage} />
        </>
      ) : (
        <Empty
          icon={HelpCircle}
          title={batchId || subjectId || query ? "Nothing matches" : "Nothing waiting"}
          hint={batchId || subjectId || query ? "Try other filters." : "Escalated doubts and direct human requests land here."}
        />
      )}
    </div>
  );
}

// A doubt-solver reply's own image attach — deliberately not the shared
// ImagePicker component: that one uploads through /api/media/upload, which
// a doubtSolver's restricted role gate can't reach (see
// representativeGate.js). This uploads through /api/doubts/upload-image
// instead, the one image route that role is actually allowed.
// Three ways in: a file, the camera (on a phone), or drawing — on a blank
// page or over the student's own photo.
function AnswerImagePicker({ url, onChange, studentImage }) {
  const input = useRef(null);
  const camera = useRef(null);
  const [upload, { isLoading }] = useUploadDoubtAnswerImageMutation();
  const [preview, setPreview] = useState(url || null);
  const [drawing, setDrawing] = useState(null);

  const pick = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) send(file);
  };

  const send = async (file) => {
    const localUrl = URL.createObjectURL(file);
    setPreview(localUrl);

    try {
      const { url: uploaded } = await upload(file).unwrap();
      setPreview(uploaded);
      onChange(uploaded);
    } catch {
      setPreview(url || null);
    } finally {
      URL.revokeObjectURL(localUrl);
    }
  };

  const clear = () => {
    setPreview(null);
    onChange(null);
  };

  return (
    <div className="row-tight" style={{ gap: 8, flexWrap: "wrap" }}>
      {preview && (
        <div className="thumb">
          <img src={preview} alt="" />
          <button type="button" className="thumb-remove" onClick={clear} title="Remove image">
            <X size={13} />
          </button>
        </div>
      )}
      <button
        type="button"
        className="btn btn-sm btn-quiet"
        onClick={() => input.current?.click()}
        disabled={isLoading}
      >
        {isLoading ? <Loader2 size={13} className="spin" /> : <ImagePlus size={13} />}
        {preview ? "Replace image" : "Attach an image"}
      </button>
      <button type="button" className="btn btn-sm btn-quiet" onClick={() => camera.current?.click()} disabled={isLoading}>
        <Camera size={13} /> Take a photo
      </button>
      <button type="button" className="btn btn-sm btn-quiet" onClick={() => setDrawing({ base: null })} disabled={isLoading}>
        <PenLine size={13} /> Draw
      </button>
      {studentImage && (
        <button type="button" className="btn btn-sm btn-quiet" onClick={() => setDrawing({ base: studentImage })} disabled={isLoading}>
          <PenLine size={13} /> Mark up their photo
        </button>
      )}
      <input ref={input} type="file" accept="image/*" hidden onChange={pick} />
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
      {drawing && (
        <Suspense fallback={null}>
          <DrawPad
            base={drawing.base}
            saving={isLoading}
            onCancel={() => setDrawing(null)}
            onSave={async (blob) => { await send(new File([blob], "drawing.png", { type: "image/png" })); setDrawing(null); }}
          />
        </Suspense>
      )}
    </div>
  );
}

function ResolveDoubt({ id, onClose, onOpen }) {
  const { me } = useOutletContext();
  const isSolver = ["doubtSolver", "teacher"].includes(me.role);
  const confirm = useConfirm();
  const { data, isLoading, error } = useGetDoubtQuery(id);
  const [resolve, { isLoading: saving, error: saveError }] = useResolveDoubtMutation();
  const [deleteDoubt, { isLoading: deleting }] = useDeleteDoubtMutation();
  const [answer, setAnswer] = useState("");
  const [answerImage, setAnswerImage] = useState(null);
  const answerRef = useRef(null);
  // The queue as filtered, for "Resolve and next".
  const [params] = useSearchParams();
  const { data: queue } = useGetDoubtQueueQuery({ ...queueFilters(params), page: 1 });
  const typed = Boolean(answer.trim() || answerImage);
  const { leave, clear } = useUnsaved(typed);

  if (isLoading) return <Loading />;
  if (error) return <div className="page"><ErrorNote error={error} /></div>;

  const doubt = data.doubt;
  const alreadyResolved = doubt.status === "resolved";
  const isReReview = Boolean(doubt.resolvedBy) && doubt.status === "escalated";
  const next = (queue?.doubts || []).find((d) => d._id !== id);
  const send = async (goNext) => {
    if (!answer.trim() || saving) return;
    try {
      await resolve({ id, answer, answerImage }).unwrap();
    } catch {
      return; // shown above the answer
    }
    clear();
    if (goNext && next) onOpen(next._id); else onClose();
  };
  const firstLine = String(doubt.question || "").split("\n")[0].replace(/\$[^$]*\$/g, "…").trim();

  return (
    <div className="page">
      <div className="page-head spread">
        <div>
          <div className="row-tight" style={{ marginBottom: 4, flexWrap: "wrap" }}>
            <span className={`pill row-tight ${doubt.mode === "ai" ? "pill-warn" : ""}`} style={{ gap: 4 }}>
              {doubt.mode === "ai" ? <Sparkles size={11} /> : <User size={11} />}
              {doubt.mode === "ai" ? "Escalated from AI" : "Asked for a human"}
            </span>
            {alreadyResolved && <span className="pill pill-ok">Resolved</span>}
            {isReReview && <span className="pill row-tight" style={{ gap: 4 }}><RotateCcw size={11} /> Reopened by review</span>}
          </div>
          <h1 className="clamp-2" title={doubt.question}>{firstLine.length > 90 ? `${firstLine.slice(0, 90)}…` : firstLine || "Doubt"}</h1>
          <p className="muted small" style={{ margin: "2px 0 0" }}>
            {doubt.student?.name || doubt.student?.email} · {doubt.batch?.name} · waiting {waitingFor(doubt.escalatedAt || doubt.createdAt)}
            {!isSolver && doubt.resolvedBy && (
              <> · resolved by {doubt.resolvedBy.identifier || doubt.resolvedBy.name}{doubt.resolvedBy.isDeleted ? " (deleted)" : ""}</>
            )}
          </p>
        </div>
        <div className="row-tight">
          {!isSolver && (
            <button
              className="icon-btn icon-btn-danger"
              title="Delete this doubt"
              disabled={deleting}
              onClick={async () => {
                const yes = await confirm({
                  title: "Delete this doubt?",
                  body: "This removes the question and answer permanently for everyone, including the student. There's no undo.",
                  confirmLabel: "Delete",
                });
                if (yes) {
                  await deleteDoubt(id).unwrap();
                  onClose();
                }
              }}
            >
              <Trash2 size={14} />
            </button>
          )}
          <button className="btn btn-sm btn-quiet" onClick={() => { const back = new URLSearchParams(params); back.delete("doubt"); leave(`/doubts${back.toString() ? `?${back}` : ""}`); }}>
            <ArrowLeft size={14} /> Queue
          </button>
        </div>
      </div>

      <div className="stack">
        <div className="card stack">
          <span className="label">The question</span>
          <Latex as="p" style={{ margin: 0, whiteSpace: "pre-wrap" }}>{doubt.question}</Latex>
          {doubt.questionImage && (
            <img src={doubt.questionImage} alt="" style={{ maxWidth: "100%", borderRadius: 8 }} />
          )}
        </div>

        {doubt.aiAnswer && (
          <div className="card-quiet stack">
            <div className="row-tight"><Sparkles size={14} className="muted" /><span className="label">What the AI said (the student wasn't satisfied)</span></div>
            <Latex as="p" className="small muted" style={{ margin: 0, whiteSpace: "pre-wrap" }}>{doubt.aiAnswer}</Latex>
          </div>
        )}

        {isReReview && (
          <div className="card-quiet stack" style={{ borderColor: "var(--warning)" }}>
            <div className="row-tight"><RotateCcw size={14} className="muted" /><span className="label">Why the student asked for another look</span></div>
            <Latex as="p" className="small" style={{ margin: 0, whiteSpace: "pre-wrap" }}>{doubt.review?.reason}</Latex>
            <div className="muted small" style={{ marginTop: 4 }}>Your previous answer:</div>
            <Latex as="p" className="small muted" style={{ margin: 0, whiteSpace: "pre-wrap" }}>{doubt.humanAnswer}</Latex>
            {doubt.humanAnswerImage && (
              <img src={doubt.humanAnswerImage} alt="" style={{ maxWidth: "100%", borderRadius: 8 }} />
            )}
          </div>
        )}

        {alreadyResolved ? (
          <div className="card stack">
            <span className="label">{isSolver ? "Your answer" : "Answer"}</span>
            <Latex as="p" style={{ margin: 0, whiteSpace: "pre-wrap" }}>{doubt.humanAnswer}</Latex>
            {doubt.humanAnswerImage && (
              <img src={doubt.humanAnswerImage} alt="" style={{ maxWidth: "100%", borderRadius: 8 }} />
            )}
          </div>
        ) : (
          <div className="card stack">
            <ErrorNote error={saveError} />
            <label className="field">
              <span className="spread">
                <span className="label">{isReReview ? "Updated answer" : "Your answer"}</span>
                <LatexInserter textareaRef={answerRef} value={answer} onChange={setAnswer} />
              </span>
              <textarea
                ref={answerRef}
                className="input"
                rows={6}
                autoFocus
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); send(true); }
                }}
                placeholder="Write the answer this student will see"
              />
            </label>
            {answer.includes("$") && (
              <div className="card stack" style={{ background: "var(--surface-alt)", padding: 10 }}>
                <span className="label">Preview</span>
                <Latex as="p" style={{ margin: 0, whiteSpace: "pre-wrap" }}>{answer}</Latex>
              </div>
            )}
            <AnswerImagePicker url={answerImage} onChange={setAnswerImage} studentImage={doubt.questionImage} />
            <div className="row-tight" style={{ gap: 8, flexWrap: "wrap" }}>
              {next && (
                <button className="btn" disabled={!answer.trim() || saving} onClick={() => send(true)} title="Ctrl+Enter">
                  {saving ? "Saving" : isReReview ? "Save and next doubt" : "Resolve and next"}
                </button>
              )}
              <button className={`btn${next ? " btn-quiet" : ""}`} disabled={!answer.trim() || saving} onClick={() => send(false)} title={next ? undefined : "Ctrl+Enter"}>
                {saving ? "Saving" : isReReview ? "Save updated answer" : "Resolve"}
              </button>
              <span className="hint">The student sees it straight away.{next ? " Ctrl+Enter resolves and opens the next one." : ""}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- history

// For a doubt-solver this is still just their own — the backend enforces
// that regardless of what's sent here, so there's no solver picker to show
// them at all. For owner/admin it's everyone's by default, narrowed with
// the same solver picker the payment tab uses, since seeing who answered
// what is exactly the point of an oversight view.
function HistoryTab({ isSolver, onOpen }) {
  const [page, setPage] = useState(1);
  const [solverId, setSolverId] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const { data: solvers } = useGetDoubtSolversQuery(undefined, { skip: isSolver });
  const { data, isLoading, error } = useGetMySolvedDoubtsQuery({
    page,
    solverId: !isSolver && solverId ? solverId : undefined,
    search: query || undefined,
  });
  const doubts = data?.doubts || [];

  return (
    <div className="stack">
      <form
        onSubmit={(e) => { e.preventDefault(); setQuery(search); setPage(1); }}
        className="search-wrap"
      >
        <Search size={15} className="search-icon" />
        <input
          className="input"
          style={{ paddingLeft: 36 }}
          placeholder="Search by student name, email or phone"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </form>

      {!isSolver && (
        <select
          className="select"
          value={solverId}
          onChange={(e) => { setSolverId(e.target.value); setPage(1); }}
          style={{ maxWidth: 260 }}
        >
          <option value="">Everyone</option>
          {(solvers || []).map((s) => (
            <option key={s._id} value={s._id}>{s.identifier || s.name}</option>
          ))}
        </select>
      )}

      <ErrorNote error={error} />
      {isLoading ? (
        <Loading />
      ) : doubts.length === 0 ? (
        <Empty icon={History} title="Nothing solved yet" hint="Resolved doubts show up here." />
      ) : (
        <div className="list">
          {doubts.map((d) => (
            <button
              key={d._id}
              className="list-row"
              style={{ textAlign: "left", alignItems: "flex-start" }}
              onClick={() => onOpen(d._id)}
            >
              <div className="grow">
                <div className="row-tight" style={{ marginBottom: 4, flexWrap: "wrap" }}>
                  {d.review?.decision === "approved" && (
                    <span className="pill row-tight" style={{ gap: 4 }}><RotateCcw size={11} /> Updated after review</span>
                  )}
                  {d.review?.decision === "rejected" && (
                    <span className="pill">Review requested, kept as-is</span>
                  )}
                </div>
                <div className="small truncate" style={{ maxWidth: 480 }}>{d.question}</div>
                <div className="muted small truncate" style={{ maxWidth: 480, marginTop: 2 }}>{d.humanAnswer}</div>
                <div className="muted small" style={{ marginTop: 3 }}>
                  {d.student?.name} {d.batch?.name ? `· ${d.batch.name}` : ""}
                  {!isSolver && d.resolvedBy && ` · ${d.resolvedBy.identifier || d.resolvedBy.name}${d.resolvedBy.isDeleted ? " (deleted)" : ""}`}
                </div>
              </div>
              <span className="muted small">{new Date(d.resolvedAt).toLocaleDateString()}</span>
            </button>
          ))}
        </div>
      )}
      {data && data.pages > 1 && (
        <div className="row spread">
          <button className="btn btn-sm btn-quiet" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span className="muted small">Page {data.page} of {data.pages}</span>
          <button className="btn btn-sm btn-quiet" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------- payment

// The one thing this whole tab exists for: a number both the solver and
// whoever pays them can look at and agree on, for a date range that maps
// onto however payment periods actually work at this institution — weekly,
// monthly, whatever. "My own" is shown to everyone, not just doubtSolver
// accounts — an owner or admin who personally resolves doubts deserves the
// same no-picker-needed self-view, not just whoever holds that one role.
// Owner/admin additionally get the picker, to check anyone else's count.
function PaymentTab({ isSolver }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [solverId, setSolverId] = useState("");

  const { data: solvers } = useGetDoubtSolversQuery(undefined, { skip: isSolver });

  const mine = useGetMyDoubtStatsQuery({ from: from || undefined, to: to || undefined });
  const theirs = useGetSolverStatsQuery(
    { id: solverId, from: from || undefined, to: to || undefined },
    { skip: isSolver || !solverId }
  );

  return (
    <div className="stack" style={{ maxWidth: 420 }}>
      <div className="card stack">
        <div className="row-tight"><Wallet size={16} className="muted" /><h2 style={{ fontSize: 15 }}>My payment summary</h2></div>
        <p className="hint" style={{ margin: 0 }}>How many doubts you've personally resolved in a date range.</p>

        <div className="row">
          <Field label="From"><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>

        {mine.isLoading ? (
          <Loading />
        ) : (
          <div className="card-quiet" style={{ padding: 16, textAlign: "center" }}>
            <div style={{ fontSize: 32, fontWeight: 600 }} className="tnum">{mine.data?.count ?? 0}</div>
            <div className="muted small">
              doubt{mine.data?.count === 1 ? "" : "s"} solved
              {from || to ? " in this range" : " in total"}
            </div>
          </div>
        )}
      </div>

      {!isSolver && (
        <div className="card stack">
          <h2 style={{ fontSize: 15 }}>Check someone else</h2>
          <p className="hint" style={{ margin: 0 }}>Pick anyone who's resolved a doubt to get their count for the same range.</p>
          <Field label="Solver">
            <select className="select" value={solverId} onChange={(e) => setSolverId(e.target.value)}>
              <option value="">Choose someone</option>
              {(solvers || []).map((s) => (
                <option key={s._id} value={s._id}>{s.identifier || s.name}</option>
              ))}
            </select>
          </Field>

          {solverId && (
            theirs.isLoading ? (
              <Loading />
            ) : (
              <div className="card-quiet" style={{ padding: 16, textAlign: "center" }}>
                <div style={{ fontSize: 32, fontWeight: 600 }} className="tnum">{theirs.data?.count ?? 0}</div>
                <div className="muted small">
                  doubt{theirs.data?.count === 1 ? "" : "s"} solved
                  {from || to ? " in this range" : " in total"}
                </div>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- reviews

function ReviewRequestsTab({ isNew }) {
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useGetReviewRequestsQuery({ page });
  const [decide, { isLoading: deciding }] = useDecideDoubtReviewMutation();
  const doubts = data?.doubts || [];

  return (
    <div className="stack">
      <p className="muted small" style={{ margin: 0 }}>
        Approving reopens the doubt for its original solver to update. Either way, this is the
        only review this doubt will ever get.
      </p>

      <ErrorNote error={error} />

      {isLoading ? (
        <Loading />
      ) : doubts.length === 0 ? (
        <Empty icon={ShieldAlert} title="Nothing waiting" hint="A student's review request shows up here until it's decided." />
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          {doubts.map((d) => (
            <div key={d._id} className="card stack">
              <div className="muted small">
                <NewTag show={isNew(d.review?.requestedAt)} />{" "}
                {d.student?.name || d.student?.email} · {d.batch?.name} ·
                {" "}answered by {d.resolvedBy
                  ? `${d.resolvedBy.identifier || d.resolvedBy.name}${d.resolvedBy.isDeleted ? " (deleted)" : ""}`
                  : "someone since removed"}
              </div>
              <div className="small truncate">{d.question}</div>

              <div className="card-quiet stack" style={{ gap: 4 }}>
                <span className="label">Current answer</span>
                <Latex as="p" className="small" style={{ margin: 0, whiteSpace: "pre-wrap" }}>{d.humanAnswer}</Latex>
                {d.humanAnswerImage && (
                  <img src={d.humanAnswerImage} alt="" style={{ maxWidth: "100%", borderRadius: 8 }} />
                )}
              </div>

              <div className="card-quiet stack" style={{ gap: 4, borderColor: "var(--warning)" }}>
                <span className="label">Why the student is asking for another look</span>
                <Latex as="p" className="small" style={{ margin: 0, whiteSpace: "pre-wrap" }}>{d.review?.reason}</Latex>
              </div>

              <div className="row-tight">
                <button
                  className="btn btn-sm"
                  disabled={deciding}
                  onClick={() => decide({ id: d._id, approve: true })}
                >
                  <Check size={13} /> Approve — reopen for the solver
                </button>
                <button
                  className="btn btn-sm btn-quiet"
                  disabled={deciding}
                  onClick={() => decide({ id: d._id, approve: false })}
                >
                  <X size={13} /> Reject — keep as final
                </button>
              </div>
            </div>
          ))}
          <Pager page={data?.page || 1} pages={data?.pages || 1} total={data?.total || 0} onChange={setPage} />
        </div>
      )}
    </div>
  );
}
