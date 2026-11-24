import { createContext, useContext, useState } from "react";
import {
  AlertTriangle, Check, ListChecks, CircleDot, FileText, Lock, ChevronLeft, ChevronRight,
  Eye, EyeOff, BookOpen,
} from "lucide-react";
import SearchSelect from "./SearchSelect";

export const Spinner = () => <span className="spinner" aria-label="Loading" />;

export const Loading = ({ label = "Loading" }) => (
  <div className="empty">
    <Spinner /> <span style={{ marginLeft: 8 }}>{label}</span>
  </div>
);

// Errors say what happened and what to do about it. The backend already writes
// messages in that voice, so they are shown as written.
export const ErrorNote = ({ error }) => {
  if (!error) return null;
  const message = error?.data?.message || error?.message || "Something went wrong. Try again.";
  return (
    <div className="banner banner-bad row-tight">
      <AlertTriangle size={16} style={{ flexShrink: 0 }} />
      <span>{message}</span>
    </div>
  );
};

// An empty screen is an invitation to act, so it always carries the action.
export const Empty = ({ icon: Icon, title, hint, action }) => (
  <div className="empty">
    {Icon && <Icon size={26} strokeWidth={1.4} style={{ opacity: 0.4, marginBottom: 10 }} />}
    <div style={{ fontSize: 15, color: "var(--text)", marginBottom: 4 }}>{title}</div>
    {hint && <div className="small" style={{ marginBottom: 16 }}>{hint}</div>}
    {action}
  </div>
);

export const Field = ({ label, hint, children }) => (
  <label className="field">
    <span className="label">{label}</span>
    {children}
    {hint && <span className="hint">{hint}</span>}
  </label>
);

// A single dropdown for "which topic, or which chapter's whole pool" —
// grouped by chapter (<optgroup>) so scanning it reads as a step through
// the chapters rather than one flat list where a topic and a same-named
// chapter-pool entry from a different chapter sit side by side. This is
// the second step of "subject, then topic/chapter" — callers render their
// own subject select first and pass it only the chapters already scoped to
// that subject (see QuestionEditor.jsx and Questions.jsx); it never
// renders a subject step itself.
//
// `value`/`onChange` carry the same "topic:<id>" / "chapter:<id>" string
// encoding questionModel.js's resolveFiling() expects. `passageOnly` drops
// every topic option, since a passage question can only ever be
// chapter-pool (see the Passage discriminator).
export const FilingSelect = ({
  chapters, value, onChange, passageOnly, placeholder = "Choose a topic, or a chapter for the chapter pool",
  className = "select", style,
}) => (
  <SearchSelect className={className} style={style} value={value || ""} onChange={(e) => onChange(e.target.value)}>
    <option value="">{placeholder}</option>
    {(chapters || []).map((chapter) => (
      <optgroup key={chapter._id} label={chapter.title}>
        <option value={`chapter:${chapter._id}`}>(whole chapter — chapter pool)</option>
        {!passageOnly && (chapter.topics || []).map((topic) => (
          <option key={topic._id} value={`topic:${topic._id}`}>{topic.title}</option>
        ))}
      </optgroup>
    ))}
  </SearchSelect>
);

// Every password field in the admin panel was a plain type="password" input
// with no way to check what you just typed — Team.jsx's password-reset
// dialog was the one place that had a show/hide toggle. Pulled out here so
// every field (login, setup, invite-accept, settings, student
// create/edit/reset-password) gets the same eye toggle instead of each
// screen inventing or skipping it, and defaults to visible: typing a
// password blind is the exception worth opting into, not the default.
export const PasswordInput = ({ value, onChange, className = "input", visibleByDefault = true, ...rest }) => {
  const [visible, setVisible] = useState(visibleByDefault);
  return (
    <div className="row-tight">
      <input
        {...rest}
        className={className}
        type={visible ? "text" : "password"}
        value={value}
        onChange={onChange}
        style={{ flex: 1, ...(rest.style || {}) }}
      />
      <button
        type="button"
        className="icon-btn"
        onClick={() => setVisible((v) => !v)}
        title={visible ? "Hide password" : "Show password"}
        aria-label={visible ? "Hide password" : "Show password"}
      >
        {visible ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
};

// Each question type gets its own icon and colour so a bank of hundreds is
// scannable without reading.
const TYPES = {
  mcq: { label: "Multiple choice", icon: CircleDot, cls: "" },
  mtf: { label: "True / false", icon: ListChecks, cls: "pill-ok" },
  written: { label: "Written", icon: FileText, cls: "pill-ai" },
  // Chapter-pool only — see questionModel.js's Passage discriminator.
  passage: { label: "Passage", icon: BookOpen, cls: "pill-warn" },
};

export const TypePill = ({ type, compact = false }) => {
  const meta = TYPES[type];
  if (!meta) return <span className="pill">{type}</span>;
  const Icon = meta.icon;
  return (
    <span className={`pill row-tight ${meta.cls}`} style={{ gap: 5 }}>
      <Icon size={12} strokeWidth={2} />
      {!compact && meta.label}
    </span>
  );
};

export const typeLabel = (type) => TYPES[type]?.label || type;

// ---------------------------------------------------------------- confirm

// window.confirm is unstyled, unthemeable and blocks the whole tab. Every
// destructive action in the panel routes through this instead, and every one
// of them names what is about to disappear.
const ConfirmContext = createContext(() => {});

export const useConfirm = () => useContext(ConfirmContext);
// confirm({ title, body, confirmLabel, cancelLabel, tone }) — tone: "danger"
// (default) renders the confirm button red, for anything that destroys data.
// tone: "neutral" renders it as a plain button, for a consequential but
// reversible action (unpublishing, closing something to students) that
// should read as "serious, think about it" without the danger's connotation
// of "this cannot be undone", which would be a false alarm.

export function ConfirmProvider({ children }) {
  const [request, setRequest] = useState(null);

  const confirm = (options) =>
    new Promise((resolve) => {
      setRequest({ ...options, resolve });
    });

  const answer = (value) => {
    if (request) request.resolve(value);
    setRequest(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}

      {request && (
        <div
          className="overlay"
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.target === e.currentTarget && answer(false)}
        >
          <div className="dialog stack">
            <div className="row-tight">
              <span className="dialog-icon"><AlertTriangle size={17} /></span>
              <h3>{request.title}</h3>
            </div>

            {request.body && (
              <p className="muted small" style={{ margin: 0, lineHeight: 1.6 }}>
                {request.body}
              </p>
            )}

            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn btn-sm btn-quiet" onClick={() => answer(false)} autoFocus>
                {request.cancelLabel || "Cancel"}
              </button>
              <button className={`btn btn-sm ${request.tone === "neutral" ? "" : "btn-danger"}`} onClick={() => answer(true)}>
                {request.confirmLabel || "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

// ---------------------------------------------------------------- roles

// The backend enforces all of this. Hiding the controls a teacher cannot use
// is about not offering an action that will be refused, not about security.
const ADMIN_ONLY = [
  "manageTeam", "manageSubjects", "managePrograms", "manageBatches",
  "managePlans", "deleteStudents", "manageAi", "deleteExams", "manageStudents",
];

export const useCan = (me) => (action) => {
  if (!me) return false;
  if (me.role === "owner" || me.role === "admin") return true;
  return !ADMIN_ONLY.includes(action);
};

export const TeacherLocked = ({ what, by = "an owner or admin" }) => (
  <div className="card row-tight">
    <Lock size={16} className="muted" />
    <span className="muted small">{what} is managed by {by}.</span>
  </div>
);

export const Verdict = ({ ok, children }) => (
  <div className={`banner ${ok ? "banner-ok" : "banner-bad"} row-tight`}>
    {ok ? <Check size={16} /> : <AlertTriangle size={16} />}
    <span>{children}</span>
  </div>
);

// Page controls for any list backed by the {page, pages, total} shape the
// backend's paginated list endpoints already return (exams, submissions,
// and now questions). One component rather than each screen inventing its
// own — the exam-builder question picker fetched a flat batch of up to 40
// results and sliced to 12 with no way to see anything past that; this is
// what replaces it, and what the main Questions list gets too, since it had
// exactly the same gap.
// One page of a list that is already all here (a tree, a list other pages
// share): which items show, and the numbers Pager needs. start is the first
// item's index in the whole list.
export const pageSlice = (items, page, size = 25) => {
  const list = items || [];
  const pages = Math.max(1, Math.ceil(list.length / size));
  const at = Math.min(Math.max(1, page || 1), pages);
  return { items: list.slice((at - 1) * size, at * size), page: at, pages, total: list.length, start: (at - 1) * size };
};

export const Pager = ({ page, pages, total, onChange }) => {
  if (!pages || pages <= 1) return null;

  return (
    <div className="row spread" style={{ marginTop: 8 }}>
      <span className="muted small">{total} result{total === 1 ? "" : "s"}</span>
      <div className="row-tight">
        <button
          type="button"
          className="btn btn-sm btn-quiet"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="muted small tnum" style={{ minWidth: 64, textAlign: "center" }}>
          Page {page} of {pages}
        </span>
        <button
          type="button"
          className="btn btn-sm btn-quiet"
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
};

// A download from the API: fetched here, so a problem shows next to the
// button (not as a raw error page). Same look as a link button.
export function DownloadButton({ href, className = "btn btn-sm", children, filename = "download", onClick }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const go = async (e) => {
    onClick?.(e);
    setBusy(true); setMsg("");
    try {
      const r = await fetch(href, { credentials: "include" });
      if (!r.ok) { const j = await r.json().catch(() => ({})); setMsg(j.message || "Couldn't download it. Try again."); return; }
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = (r.headers.get("content-disposition") || "").match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i)?.[1] || filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      setMsg("Couldn't reach the server. Try again.");
    } finally { setBusy(false); }
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <button type="button" className={className} disabled={busy} onClick={go}>{children}</button>
      {busy && <Spinner />}
      {msg && <span className="small" style={{ color: "var(--incorrect)" }}>{msg}</span>}
    </span>
  );
}
