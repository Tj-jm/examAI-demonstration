import { useNavigate } from "react-router-dom";
import { Flag, ShieldAlert } from "lucide-react";
import { useUpdateConductEventMutation } from "../api/accountApi";
import { ErrorNote } from "./bits";

// An attempt's exam integrity flags (tab switches, pastes): what, when into
// the exam, and — for owner/admin — where they stand on the student's
// conduct record, with the record's handled/dismissed controls right here.
// Shared by Grading and Submissions.

const LABELS = {
  "tab-hidden": ["tab switch", "tab switches"],
  "answer-paste": ["paste into a written answer", "pastes into a written answer"],
  "window-blur": ["left the window", "times left the window"],
  "fullscreen-exit": ["fullscreen exit", "fullscreen exits"],
  "left-exam": ["left the exam page", "times left the exam page"],
};
const label = (type, n = 1) => (LABELS[type] ? LABELS[type][n === 1 ? 0 : 1] : type);

const STATUS = {
  open: ["pill-warn", "Open"],
  handled: ["pill-ok", "Handled"],
  dismissed: ["", "Dismissed"],
};

// "12:04 in" — minutes and seconds after the attempt started.
const into = (at, startedAt) => {
  if (!startedAt || !at) return null;
  const s = Math.max(0, Math.round((new Date(at) - new Date(startedAt)) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} in`;
};

const AWAY = ["tab-hidden", "left-exam"];

// "2:31" — how long a student was away.
const clock = (ms) => {
  const s = Math.max(1, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// A tab switch or leaving the page: how long, or that they never came back.
const awayFor = (v, open) => {
  if (!AWAY.includes(v.type)) return null;
  if (v.backAt) return `away ${clock(new Date(v.backAt) - new Date(v.at))}`;
  return open ? "still away" : "didn't come back";
};

export default function ExamFlags({ submission, onChanged }) {
  const navigate = useNavigate();
  const [update, { isLoading, error }] = useUpdateConductEventMutation();
  const violations = submission.violations || [];
  if (!violations.length) return null;

  const counts = new Map();
  for (const v of violations) counts.set(v.type, (counts.get(v.type) || 0) + 1);
  const awayMs = violations
    .filter((v) => AWAY.includes(v.type) && v.backAt)
    .reduce((sum, v) => sum + (new Date(v.backAt) - new Date(v.at)), 0);
  const open = submission.status === "in_progress";
  const { conduct } = submission;
  const event = conduct?.event;
  const studentId = submission.student?._id;

  const setStatus = async (status) => {
    await update({ id: event._id, status }).unwrap().catch(() => {});
    onChanged?.();
  };

  return (
    <div className="card-quiet stack" style={{ gap: 8 }}>
      <div className="row-tight" style={{ gap: 6 }}>
        <Flag size={14} className="muted" />
        <span className="label" style={{ margin: 0 }}>
          {violations.length} flag{violations.length === 1 ? "" : "s"} during this attempt
        </span>
      </div>
      <p className="hint" style={{ margin: 0 }}>
        Informational only — doesn't affect scoring.{" "}
        {[...counts.entries()].map(([type, n]) => `${n} ${label(type, n)}`).join(", ")}
        {awayMs > 0 && `; away ${clock(awayMs)} in all`}.
      </p>

      {submission.awayEnd?.mode && (
        <span className={`pill ${submission.awayEnd.mode === "abandon" ? "pill-bad" : "pill-warn"}`} style={{ alignSelf: "flex-start" }}>
          {submission.awayEnd.mode === "abandon" ? "Abandoned" : "Auto-submitted"}: away{" "}
          {submission.awayEnd.back ? clock(submission.awayEnd.awayMs) : `over ${submission.awayEnd.limitMinutes}:00, didn't come back`}
        </span>
      )}

      <div className="row-tight" style={{ flexWrap: "wrap", gap: 6 }}>
        {violations.map((v, i) => (
          <span key={v._id || i} className="pill small tnum" title={v.at ? new Date(v.at).toLocaleString() : ""}>
            {into(v.at, submission.startedAt) || (v.at ? new Date(v.at).toLocaleTimeString() : "")} · {label(v.type)}
            {awayFor(v, open) && ` · ${awayFor(v, open)}`}
          </span>
        ))}
      </div>

      {conduct && (
        <div className="stack" style={{ gap: 6, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
          <div className="row-tight" style={{ flexWrap: "wrap", gap: 6 }}>
            <ShieldAlert size={14} className="muted" />
            {event ? (
              <>
                <span className="small">On the conduct record</span>
                <span className={`pill ${STATUS[event.status]?.[0] || ""}`}>{STATUS[event.status]?.[1] || event.status}</span>
              </>
            ) : (
              <span className="small muted">
                Not on the conduct record — an attempt goes there at {conduct.line} flag{conduct.line === 1 ? "" : "s"}.
              </span>
            )}
            {studentId && (
              <button className="btn btn-sm btn-quiet" onClick={() => navigate(`/conduct?student=${studentId}`)}>
                Student's record{conduct.attemptsOnRecord ? ` · ${conduct.attemptsOnRecord} flagged exam${conduct.attemptsOnRecord === 1 ? "" : "s"}` : ""}
              </button>
            )}
          </div>
          {event && (
            <div className="row-tight" style={{ flexWrap: "wrap", gap: 6 }}>
              {event.status !== "handled" && (
                <button className="btn btn-sm" disabled={isLoading} onClick={() => setStatus("handled")}>Mark handled</button>
              )}
              {event.status !== "dismissed" && (
                <button className="btn btn-sm btn-quiet" disabled={isLoading} onClick={() => setStatus("dismissed")}>Dismiss as a false alarm</button>
              )}
              {event.status !== "open" && (
                <button className="btn btn-sm btn-quiet" disabled={isLoading} onClick={() => setStatus("open")}>Reopen</button>
              )}
            </div>
          )}
          <ErrorNote error={error} />
        </div>
      )}
    </div>
  );
}
