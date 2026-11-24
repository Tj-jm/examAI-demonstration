import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ShieldAlert, ArrowLeft, Search, MessageSquareWarning, Flag, Ban, Sparkles, Check, X, RotateCcw, Settings2, LifeBuoy,
} from "lucide-react";
import {
  useGetConductListQuery, useGetConductRecordQuery, useActOnStudentMutation, useUpdateConductEventMutation,
  useGetConductSettingsQuery, useUpdateConductSettingsMutation,
  useGetConductCountsQuery,
} from "../api/accountApi";
import { useGetBatchesQuery } from "../api/contentApi";
import { useSeen } from "../hooks/useSeen";
import NewTag from "../components/NewTag";
import { Loading, ErrorNote, Empty, Pager, Field, pageSlice } from "../components/bits";
import AiWrite, { AiTranslate } from "../components/AiWrite";
import AwayLimitFields from "../components/AwayLimitFields";
import { useTerms } from "../terms";
import SearchSelect from "../components/SearchSelect";

// Admin → Conduct: every student with something on their record in one
// place — abusive messages, exam integrity flags, disqualifications — and
// the actions staff take. Everything done here notifies the student.

const KIND = {
  abuse: { label: "Abusive message", Icon: MessageSquareWarning, cls: "pill-bad" },
  examViolation: { label: "Exam flags", Icon: Flag, cls: "pill-warn" },
  disqualified: { label: "Disqualified", Icon: Ban, cls: "pill-bad" },
  warning: { label: "Warning sent", Icon: ShieldAlert, cls: "" },
  action: { label: "Action", Icon: Check, cls: "" },
};
const ACTION_LABEL = {
  warn: "Warning", pauseAi: "AI paused", resumeAi: "AI resumed", suspend: "Suspended", reactivate: "Reactivated",
};
const SOURCE = { "course-chat": "course chat", doubt: "a doubt", exam: "an exam", staff: "staff", auto: "the automatic rule" };

const day = (d) => new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const restrictions = (s) => {
  const now = new Date();
  const out = [];
  if (s?.isActive === false) out.push(["Deactivated", "pill-bad"]);
  else if (s?.suspendedUntil && new Date(s.suspendedUntil) > now) out.push([`Suspended to ${day(s.suspendedUntil)}`, "pill-bad"]);
  if (s?.aiPausedUntil && new Date(s.aiPausedUntil) > now) {
    out.push([new Date(s.aiPausedUntil).getFullYear() > 2900 ? "AI paused" : `AI paused to ${day(s.aiPausedUntil)}`, "pill-warn"]);
  }
  return out;
};

export default function Conduct() {
  const [params, setParams] = useSearchParams();
  const openId = params.get("student");
  const [tab, setTab] = useState("list");
  const isNew = useSeen("conduct");
  const { data: counts } = useGetConductCountsQuery();
  if (openId) return <StudentRecord id={openId} onClose={() => setParams({})} />;
  return (
    <div className="page">
      <div className="page-head"><h1>Conduct</h1></div>
      <div className="row-tight" style={{ marginBottom: 4, flexWrap: "wrap" }}>
        {[["list", "Students", ShieldAlert], ["settings", "Automatic rule", Settings2]].map(([value, label, Icon]) => (
          <button key={value} className={`pill pill-btn row-tight${tab === value ? " pill-on" : ""}`} style={{ gap: 5 }} onClick={() => setTab(value)}>
            <Icon size={12} /> {label}
            {value === "list" && counts?.open > 0 && <span className="tab-count tnum">{counts.open}</span>}
          </button>
        ))}
      </div>
      {tab === "list" ? <StudentList onOpen={(id) => setParams({ student: id })} isNew={isNew} /> : <RuleSettings />}
    </div>
  );
}

function StudentList({ onOpen, isNew }) {
  const terms = useTerms();
  const [kind, setKind] = useState("");
  const [batchId, setBatchId] = useState("");
  const [status, setStatus] = useState("open");
  const [days, setDays] = useState("");
  const [minFlags, setMinFlags] = useState("");
  const [restricted, setRestricted] = useState(false);
  const [sort, setSort] = useState("recent");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useGetConductListQuery({
    kind, batchId, status, days, minFlags, restricted: restricted ? "1" : undefined, sort, search: query, page,
  });
  const { data: batches } = useGetBatchesQuery({});
  const set = (setter) => (value) => { setter(value); setPage(1); };
  const rows = data?.rows || [];

  return (
    <div className="stack">
      <form onSubmit={(e) => { e.preventDefault(); set(setQuery)(search); }} className="search-wrap">
        <Search size={15} className="search-icon" />
        <input className="input" style={{ paddingLeft: 36 }} placeholder="Search by student name, email or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
      </form>
      <div className="row-tight" style={{ flexWrap: "wrap" }}>
        <select className="select" value={status} onChange={(e) => set(setStatus)(e.target.value)}>
          <option value="open">Needs a look</option>
          <option value="all">Everything (not dismissed)</option>
        </select>
        <select className="select" value={kind} onChange={(e) => set(setKind)(e.target.value)}>
          <option value="">Every kind</option>
          <option value="abuse">Abusive messages</option>
          <option value="examViolation">Exam flags</option>
          <option value="disqualified">Disqualifications</option>
        </select>
        <SearchSelect className="select" value={batchId} onChange={(e) => set(setBatchId)(e.target.value)}>
          <option value="">Every {terms.batch}</option>
          {(batches || []).map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
        </SearchSelect>
        <select className="select" value={days} onChange={(e) => set(setDays)(e.target.value)}>
          <option value="">Any time</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
        <select className="select" value={minFlags} onChange={(e) => set(setMinFlags)(e.target.value)}>
          <option value="">Any number of entries</option>
          <option value="2">2 or more</option>
          <option value="3">3 or more</option>
          <option value="5">5 or more</option>
        </select>
        <select className="select" value={sort} onChange={(e) => set(setSort)(e.target.value)}>
          <option value="recent">Most recent</option>
          <option value="most">Most entries</option>
        </select>
        <label className="row-tight small" style={{ cursor: "pointer" }}>
          <input type="checkbox" checked={restricted} onChange={(e) => set(setRestricted)(e.target.checked)} /> Restricted now
        </label>
      </div>
      <p className="muted small tnum" style={{ margin: 0 }}>{data?.total ?? 0} student{data?.total === 1 ? "" : "s"}</p>
      <ErrorNote error={error} />
      {isLoading ? <Loading /> : rows.length ? (
        <>
          <div className="list">
            {rows.map((r) => (
              <button key={r._id} className="list-row" style={{ textAlign: "left" }} onClick={() => onOpen(r._id)}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="small row-tight" style={{ fontWeight: 500 }}>{r.student?.name || "Student"} <NewTag show={r.open > 0 && isNew(r.last)} /></div>
                  <div className="muted small">{r.student?.email || r.student?.phoneNumber}</div>
                  <div className="row-tight" style={{ marginTop: 6, flexWrap: "wrap" }}>
                    {r.abuse > 0 && <span className="pill pill-bad">{r.abuse} abusive</span>}
                    {r.examViolation > 0 && <span className="pill pill-warn">{r.examViolation} exam flag{r.examViolation === 1 ? "" : "s"}</span>}
                    {r.disqualified > 0 && <span className="pill pill-bad">{r.disqualified} disqualified</span>}
                    {r.open > 0 && <span className="pill pill-on">{r.open} new</span>}
                    {restrictions(r.student).map(([label, cls]) => <span key={label} className={`pill ${cls}`}>{label}</span>)}
                  </div>
                </div>
                <span className="muted small">{day(r.last)}</span>
              </button>
            ))}
          </div>
          <Pager page={data?.page || 1} pages={data?.pages || 1} total={data?.total || 0} onChange={setPage} />
        </>
      ) : (
        <Empty icon={ShieldAlert} title="Nothing here" hint="Abusive messages, exam flags and disqualifications show up here." />
      )}
    </div>
  );
}

function StudentRecord({ id, onClose }) {
  const { data, isLoading, error } = useGetConductRecordQuery(id);
  const [act, { isLoading: acting, error: actError }] = useActOnStudentMutation();
  const [updateEvent] = useUpdateConductEventMutation();
  const [action, setAction] = useState("warn");
  const [days, setDays] = useState("7");
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(null);
  const [page, setPage] = useState(1);

  if (isLoading) return <div className="page"><Loading /></div>;
  if (error) return <div className="page"><ErrorNote error={error} /></div>;
  const { student, events } = data;
  const shown = pageSlice(events, page, 20);
  const timed = action === "pauseAi" || action === "suspend";

  const submit = async () => {
    try {
      const out = await act({ id, action, days: timed ? Number(days) : undefined, message }).unwrap();
      setDone(`${out.label}. The student was notified.`);
      setMessage("");
    } catch {
      setDone(null);
    }
  };

  return (
    <div className="page">
      <div className="page-head spread">
        <div>
          <h1 style={{ margin: 0 }}>{student.name}</h1>
          <p className="muted small" style={{ margin: "2px 0 0" }}>{student.email || student.phoneNumber} · joined {day(student.createdAt)}</p>
          <div className="row-tight" style={{ marginTop: 6, flexWrap: "wrap" }}>
            {restrictions(student).length ? restrictions(student).map(([label, cls]) => <span key={label} className={`pill ${cls}`}>{label}</span>) : <span className="pill pill-ok">No restrictions</span>}
          </div>
        </div>
        <button className="btn btn-sm btn-quiet" onClick={onClose}><ArrowLeft size={14} /> Back</button>
      </div>

      <div className="stack">
        <div className="card stack">
          <span className="label">Take action</span>
          <div className="row-tight" style={{ flexWrap: "wrap" }}>
            <select className="select" value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="warn">Send a warning</option>
              <option value="pauseAi">Pause AI features</option>
              <option value="resumeAi">Resume AI features</option>
              <option value="suspend">Suspend the account</option>
              <option value="reactivate">Reactivate the account</option>
            </select>
            {timed && (
              <select className="select" value={days} onChange={(e) => setDays(e.target.value)}>
                <option value="1">1 day</option>
                <option value="3">3 days</option>
                <option value="7">7 days</option>
                <option value="14">14 days</option>
                <option value="30">30 days</option>
                <option value="0">{action === "suspend" ? "Permanently" : "Until I lift it"}</option>
              </select>
            )}
          </div>
          <div className="row-tight" style={{ gap: 4, justifyContent: "flex-end", flexWrap: "wrap" }}>
            <AiWrite
              task="conductMessage"
              input={{ action, studentId: id, days: timed ? days : undefined }}
              promptLabel="Anything to say? What happened, what you expect"
              placeholder="e.g. Rude messages to the tutor this week."
              title="Write the message from this student's record"
              onResult={(d) => setMessage(d.message)}
            />
            <AiTranslate value={message} onChange={setMessage} />
          </div>
          <textarea
            className="input textarea"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={action === "warn" ? "The warning the student will read" : "Message to the student (optional)"}
          />
          <div className="row-tight" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
            <span className="muted small">The student is notified. Open entries are marked handled.</span>
            <button className={`btn ${action === "suspend" ? "btn-danger" : "btn-primary"}`} disabled={acting || (action === "warn" && !message.trim())} onClick={submit}>
              {acting ? "Saving…" : "Apply"}
            </button>
          </div>
          <ErrorNote error={actError} />
          {done && <p className="small" style={{ margin: 0, color: "var(--correct)" }}>{done}</p>}
        </div>

        <span className="label">Record</span>
        {events.length === 0 ? <Empty icon={ShieldAlert} title="Nothing on record" /> : (
          <div className="list">
            {shown.items.map((e) => {
              const meta = KIND[e.kind] || KIND.action;
              return (
                <div key={e._id} className="list-row" style={{ alignItems: "flex-start", opacity: e.status === "dismissed" ? 0.55 : 1 }}>
                  <meta.Icon size={16} className="muted" style={{ marginTop: 2, flexShrink: 0 }} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="row-tight" style={{ flexWrap: "wrap", marginBottom: 3 }}>
                      <span className={`pill ${meta.cls}`}>{e.kind === "action" ? ACTION_LABEL[e.action] || "Action" : meta.label}</span>
                      {e.kind === "examViolation" && <span className="pill">{e.count} flag{e.count === 1 ? "" : "s"}</span>}
                      {e.flaggedBy && <span className="pill row-tight" style={{ gap: 4 }}>{e.flaggedBy === "ai" ? <><Sparkles size={11} /> judged by AI</> : "word list"}</span>}
                      {e.status === "open" && <span className="pill pill-on">New</span>}
                      {e.status === "dismissed" && <span className="pill">Dismissed</span>}
                      {e.appealTicket && <span className="pill row-tight" style={{ gap: 4 }}><LifeBuoy size={11} /> Appealed</span>}
                    </div>
                    {e.text && <p className="small" style={{ margin: "2px 0", whiteSpace: "pre-wrap" }}>{e.kind === "abuse" ? `“${e.text}”` : e.text}</p>}
                    <div className="muted small">
                      {day(e.createdAt)}
                      {e.source ? ` · from ${SOURCE[e.source] || e.source}` : ""}
                      {e.exam?.title ? ` · ${e.exam.title}` : ""}
                      {e.batch?.name ? ` · ${e.batch.name}` : ""}
                      {e.until ? ` · until ${day(e.until)}` : ""}
                      {e.by?.name ? ` · by ${e.by.name}` : ""}
                    </div>
                  </div>
                  {["abuse", "examViolation", "disqualified"].includes(e.kind) && (
                    <div className="row-tight">
                      {e.status === "open" && (
                        <button className="icon-btn" title="Mark handled" onClick={() => updateEvent({ id: e._id, status: "handled" })}><Check size={14} /></button>
                      )}
                      {e.status !== "dismissed" && e.kind !== "disqualified" && (
                        <button className="icon-btn" title="Dismiss as a false alarm" onClick={() => updateEvent({ id: e._id, status: "dismissed" })}><X size={14} /></button>
                      )}
                      {e.status === "dismissed" && (
                        <button className="icon-btn" title="Restore" onClick={() => updateEvent({ id: e._id, status: "open" })}><RotateCcw size={14} /></button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <Pager page={shown.page} pages={shown.pages} total={shown.total} onChange={setPage} />
      </div>
    </div>
  );
}

function RuleSettings() {
  const { data, isLoading } = useGetConductSettingsQuery();
  const [save, { isLoading: saving, error }] = useUpdateConductSettingsMutation();
  const [form, setForm] = useState(null);
  if (isLoading) return <Loading />;
  const value = form || data?.conduct || {};
  const set = (patch) => setForm({ ...value, ...patch });

  return (
    <div className="card stack" style={{ maxWidth: 560 }}>
      <label className="spread" style={{ cursor: "pointer" }}>
        <span className="grow">
          <span style={{ display: "block" }}>Pause AI features automatically</span>
          <span className="hint">After repeated abusive messages. Dismissed flags don't count. Staff can lift it any time.</span>
        </span>
        <input type="checkbox" checked={Boolean(value.autoPause)} onChange={(e) => set({ autoPause: e.target.checked })} />
      </label>
      <div className="row-tight" style={{ flexWrap: "wrap", opacity: value.autoPause ? 1 : 0.5 }}>
        <Field label="Abusive messages">
          <input className="input" type="number" min="1" style={{ maxWidth: 90 }} value={value.flags ?? 3} onChange={(e) => set({ flags: Number(e.target.value) })} />
        </Field>
        <Field label="Within (days)">
          <input className="input" type="number" min="1" style={{ maxWidth: 90 }} value={value.windowDays ?? 30} onChange={(e) => set({ windowDays: Number(e.target.value) })} />
        </Field>
        <Field label="Pause for (days)">
          <input className="input" type="number" min="1" style={{ maxWidth: 90 }} value={value.pauseDays ?? 7} onChange={(e) => set({ pauseDays: Number(e.target.value) })} />
        </Field>
      </div>
      <div className="spread" style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
        <span className="grow">
          <span style={{ display: "block" }}>Exam flags before an attempt shows here</span>
          <span className="hint">Tab switches and pastes during one exam. Fewer than this stay on the paper for the grader only.</span>
        </span>
        <input className="input" type="number" min="1" style={{ maxWidth: 90 }} value={value.examFlags ?? 3} onChange={(e) => set({ examFlags: Number(e.target.value) })} />
      </div>
      <div className="stack" style={{ gap: 8, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
        <span>
          <span style={{ display: "block" }}>Flag during exams</span>
          <span className="hint">Off: not watched and not logged.</span>
        </span>
        {[
          ["tabSwitch", "Tab switch or app switch", "The exam page is hidden: another tab, app, or the window minimised."],
          ["leftWindow", "Left the window", "Another window or app is in front for over 2 seconds while the exam is still on screen."],
          ["paste", "Paste into an answer", "Text pasted into a written answer."],
          ["leftPage", "Left the exam page", "Moved to another page of the app during the exam."],
        ].map(([key, label, hint]) => (
          <label key={key} className="row-tight" style={{ gap: 8, alignItems: "flex-start" }}>
            <input type="checkbox" checked={value.watch?.[key] !== false} onChange={(e) => set({ watch: { ...(value.watch || {}), [key]: e.target.checked } })} />
            <span><span style={{ display: "block" }}>{label}</span><span className="hint">{hint}</span></span>
          </label>
        ))}
      </div>
      <div className="stack" style={{ gap: 8, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
        <span>
          <span style={{ display: "block" }}>Away limit for new exams</span>
          <span className="hint">When a student is away from an exam (another tab or app, or off the exam page) longer than this in one go. Each exam can change it.</span>
        </span>
        <AwayLimitFields mode={value.awayMode || "off"} minutes={value.awayMinutes ?? 5} onChange={(patch) => set(patch)} />
      </div>
      <ErrorNote error={error} />
      <div className="row-tight" style={{ justifyContent: "flex-end" }}>
        <button className="btn btn-primary" disabled={!form || saving} onClick={async () => { await save(value).unwrap().catch(() => {}); setForm(null); }}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
