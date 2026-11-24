import { useState } from "react";
import { Ban, RotateCcw } from "lucide-react";
import { useDisqualifySubmissionMutation, useReinstateSubmissionMutation } from "../api/contentApi";
import { ErrorNote } from "./bits";
import AiWrite, { AiTranslate } from "./AiWrite";

// Owner/admin only, reversible — a status layered on top of grading, not a
// replacement for it (see backend/models/submissionModel.js's `disqualified`
// sub-doc). Shared between Grading.jsx (GradeOne, reached while a
// submission is still in the queue) and Submissions.jsx (general oversight,
// the only page that can reach a submission that never entered the queue at
// all, e.g. an all-objective exam that went straight to "graded") — same
// backend action either way.
export default function DisqualifyControl({ submissionId, status, disqualified, canAct }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [disqualify, { isLoading: disqualifying, error: disqualifyError }] = useDisqualifySubmissionMutation();
  const [reinstate, { isLoading: reinstating, error: reinstateError }] = useReinstateSubmissionMutation();

  const isDisqualified = status === "disqualified";
  // Set only once a reinstate has actually happened — absent for a
  // submission that's never been touched, and for one still disqualified
  // right now (that state renders the banner below instead).
  const history = !isDisqualified && disqualified?.reinstatedAt ? disqualified : null;

  const handleDisqualify = async () => {
    if (!reason.trim()) return;
    try {
      await disqualify({ submissionId, reason: reason.trim() }).unwrap();
      setReason("");
      setOpen(false);
    } catch {
      // error surfaced below via disqualifyError
    }
  };

  if (isDisqualified) {
    return (
      <div className="banner banner-bad stack" style={{ gap: 6 }}>
        <div className="row-tight" style={{ gap: 6 }}>
          <Ban size={14} />
          <span className="label" style={{ margin: 0 }}>Disqualified</span>
        </div>
        <p className="small" style={{ margin: 0 }}>{disqualified?.reason || "No reason given."}</p>
        {disqualified?.by && (
          <p className="muted small" style={{ margin: 0 }}>
            By {disqualified.by.name}{disqualified.by.isDeleted ? " (deleted)" : ""}
            {disqualified.at ? ` on ${new Date(disqualified.at).toLocaleString()}` : ""}
          </p>
        )}
        <ErrorNote error={reinstateError} />
        {canAct && (
          <button
            type="button"
            className="btn btn-sm btn-quiet"
            style={{ alignSelf: "flex-start" }}
            disabled={reinstating}
            onClick={() => reinstate(submissionId)}
          >
            <RotateCcw size={13} /> {reinstating ? "Reinstating…" : "Reinstate"}
          </button>
        )}
      </div>
    );
  }

  const historyNote = history && (
    <p className="muted small" style={{ margin: 0 }}>
      Previously disqualified{history.by ? ` by ${history.by.name}` : ""}
      {history.at ? ` on ${new Date(history.at).toLocaleString()}` : ""} — reinstated
      {history.reinstatedBy ? ` by ${history.reinstatedBy.name}` : ""}
      {history.reinstatedAt ? ` on ${new Date(history.reinstatedAt).toLocaleString()}` : ""}.
    </p>
  );

  if (!canAct) return historyNote || null;

  return (
    <div className="stack" style={{ gap: 6 }}>
      {historyNote}
      <ErrorNote error={disqualifyError} />
      {!open ? (
        <button
          type="button"
          className="btn btn-sm btn-danger"
          style={{ alignSelf: "flex-start" }}
          onClick={() => setOpen(true)}
        >
          <Ban size={13} /> Disqualify
        </button>
      ) : (
        <div className="card-quiet stack" style={{ gap: 6 }}>
          <div className="row-tight" style={{ gap: 4, justifyContent: "flex-end", flexWrap: "wrap" }}>
            <AiWrite
              task="conductMessage"
              input={{ action: "disqualify", submissionId }}
              promptLabel="Why? Anything the student should know"
              placeholder="e.g. Left the exam tab 6 times and pasted answers."
              title="Write the reason from this attempt's integrity flags"
              onResult={(d) => setReason(d.message)}
            />
            <AiTranslate value={reason} onChange={setReason} />
          </div>
          <textarea
            className="input"
            rows={2}
            placeholder="Reason (shown to the student)…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="row-tight" style={{ gap: 6 }}>
            <button
              type="button"
              className="btn btn-sm btn-danger"
              disabled={disqualifying || !reason.trim()}
              onClick={handleDisqualify}
            >
              {disqualifying ? "Disqualifying…" : "Confirm disqualify"}
            </button>
            <button type="button" className="btn btn-sm btn-quiet" onClick={() => { setOpen(false); setReason(""); }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
