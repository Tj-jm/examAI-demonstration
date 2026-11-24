import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Square, X, Check, AlertTriangle } from "lucide-react";
import { useGetIngestJobsQuery, useCancelIngestJobMutation } from "../api/aiApi";

// Document runs take minutes. The server keeps working whatever page the
// admin is on; this card, shown on every page, is how they keep track of it
// — progress, a Stop button, and a link to Review when it's done.

const DISMISSED_KEY = "examai.ingestJobs.dismissed";

const readDismissed = () => {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) || "[]");
  } catch {
    return [];
  }
};

export const reviewLink = (review) =>
  review
    ? `/review?${review.topicId ? `topic=${review.topicId}` : `chapter=${review.chapterId}&topic=none`}&topicName=${encodeURIComponent(review.label || "")}`
    : "/review";

const progressText = (job) =>
  job.waiting
    ? "Waiting for another document run to finish"
    : job.phase === "figures"
    ? "Cutting out figures"
    : job.phase === "scanning"
    ? `Reading page ${Math.min(job.scansDone + 1, job.scansTotal)} of ${job.scansTotal}`
    : `${job.mode === "extract" ? "Extracting" : "Generating"} · section ${job.completed} of ${job.steps}`;

export default function IngestJobs() {
  const [dismissed, setDismissed] = useState(readDismissed);
  // Quick while something is running, occasional otherwise — a new run
  // started from the Generate page also refreshes this at once.
  const [interval, setInterval_] = useState(30000);
  const { data } = useGetIngestJobsQuery(undefined, { pollingInterval: interval });
  const anyRunning = Boolean(data?.jobs?.some((j) => j.status === "running"));
  useEffect(() => {
    setInterval_(anyRunning ? 2500 : 30000);
  }, [anyRunning]);
  const [cancel, { isLoading: stopping }] = useCancelIngestJobMutation();

  const dismiss = (jobId) => {
    const next = [...dismissed, jobId].slice(-50);
    setDismissed(next);
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
    } catch {
      // remembering is a convenience only
    }
  };

  const visible = (data?.jobs || []).filter((j) => j.status === "running" || !dismissed.includes(j.jobId));
  if (visible.length === 0) return null;

  return (
    <div
      className="stack"
      style={{ position: "fixed", right: 16, bottom: 16, zIndex: 50, gap: 8, width: "min(340px, calc(100vw - 32px))" }}
    >
      {visible.map((job) => (
        <div key={job.jobId} className="card stack" style={{ gap: 6, padding: 12, boxShadow: "0 6px 24px rgba(0,0,0,.18)" }}>
          <div className="row-tight" style={{ alignItems: "flex-start" }}>
            {job.status === "running" ? (
              <Loader2 size={15} className="spin" style={{ flexShrink: 0, marginTop: 2 }} />
            ) : job.status === "done" && job.written > 0 ? (
              <Check size={15} style={{ flexShrink: 0, marginTop: 2, color: "var(--ok)" }} />
            ) : (
              <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2 }} />
            )}
            <span className="grow small" style={{ minWidth: 0 }}>
              <strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={job.filename}>
                {job.filename}
              </strong>
              {job.mode === "transcribe" && job.status !== "running"
                ? job.status === "done" ? `${job.written} page${job.written === 1 ? "" : "s"} read. Open Generate to see them.` : job.error || "The run failed."
                : job.status === "running"
                ? job.mode === "transcribe" ? progressText(job) : `${progressText(job)} · ${job.written} so far`
                : job.status === "done"
                  ? job.written > 0
                    ? `${job.written} question${job.written === 1 ? "" : "s"} ready for review.`
                    : job.error || "No questions were found."
                  : job.error || (job.status === "cancelled" ? "Stopped." : "The run failed.")}
            </span>
            {job.status !== "running" && (
              <button className="icon-btn" title="Dismiss" onClick={() => dismiss(job.jobId)}>
                <X size={14} />
              </button>
            )}
          </div>

          {job.status === "running" && (
            <div className="progress">
              <div className="progress-bar" style={{ width: `${job.percent}%` }} />
            </div>
          )}

          <div className="row-tight">
            {job.status === "running" && (
              <button className="btn btn-sm btn-quiet" disabled={stopping} onClick={() => cancel(job.jobId)}>
                <Square size={12} /> Stop
              </button>
            )}
            {job.mode === "transcribe" && job.status !== "running" && job.written > 0 && (
              <Link className="btn btn-sm" to={{ pathname: "/generate", hash: "read-pages" }} onClick={() => dismiss(job.jobId)}>
                Open
              </Link>
            )}
            {job.mode !== "transcribe" && job.written > 0 && (
              <Link className="btn btn-sm" to={reviewLink(job.review)} onClick={() => job.status !== "running" && dismiss(job.jobId)}>
                Review
              </Link>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
