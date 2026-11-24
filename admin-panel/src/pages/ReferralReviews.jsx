import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Clock, ArrowRight, Check, X, ChevronDown } from "lucide-react";
import { useGetPendingReferralsQuery, useGetBatchesQuery, useDecideReferralMutation, useGetSubmissionStaffQuery } from "../api/contentApi";
import { Loading, ErrorNote, Empty, Pager, TypePill, useConfirm } from "../components/bits";
import Latex from "../components/Latex";
import { useSeen } from "../hooks/useSeen";
import NewTag from "../components/NewTag";
import SearchSelect from "../components/SearchSelect";
import { StatusStrip, FilterChips, SearchBox } from "../components/ListTools";

const VIEW_LABEL = { pending: "Waiting for a decision", regrading: "Being regraded", done: "Finished or rejected" };

// "asked 3h ago", "asked 2 days ago".
const ago = (at) => {
  if (!at) return "";
  const mins = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 60000));
  if (mins < 60) return `${mins} min ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)} days ago`;
};

export default function ReferralReviews() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const page = Number(params.get("page")) || 1;
  const view = params.get("view") || "pending";
  const batch = params.get("batch") || "";
  const q = params.get("q") || "";
  const [search, setSearch] = useState(q);
  const setFilter = (k, v) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    if (k !== "page") next.delete("page");
    setParams(next, { replace: true });
  };
  const { data: batchData } = useGetBatchesQuery({});
  const batches = Array.isArray(batchData?.batches) ? batchData.batches : Array.isArray(batchData) ? batchData : [];
  const { data, isLoading, isFetching, error } = useGetPendingReferralsQuery({ page, view, batch: batch || undefined, q: q || undefined, counts: "true" });
  const referrals = data?.submissions || [];
  const counts = data?.counts || {};
  const isNew = useSeen("referrals");
  const clearAll = () => { setSearch(""); setParams(view === "pending" ? {} : { view }, { replace: true }); };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Regrade requests</h1>
          <p className="muted small" style={{ margin: "2px 0 0" }}>
            Students asking for another look at a marked exam. Oldest first.
          </p>
        </div>
      </div>

      <div className="stack">
        <StatusStrip
          value={view === "pending" ? "" : view}
          onChange={(v) => setFilter("view", v)}
          items={[
            { key: "", label: VIEW_LABEL.pending, count: counts.pending, tone: counts.pending ? "warn" : undefined },
            { key: "regrading", label: VIEW_LABEL.regrading, count: counts.regrading },
            { key: "done", label: VIEW_LABEL.done, count: counts.done, tone: "ok" },
          ]}
        />
        <div className="row-tight" style={{ flexWrap: "wrap", gap: 8 }}>
          <SearchBox value={search} onChange={setSearch} onSubmit={(v) => setFilter("q", v.trim())} placeholder="Student name, email or ID" />
          <SearchSelect className="select" style={{ maxWidth: 220 }} value={batch} onChange={(e) => setFilter("batch", e.target.value)}>
            <option value="">Any batch</option>
            {batches.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
          </SearchSelect>
        </div>
        <FilterChips
          onClearAll={clearAll}
          chips={[
            q && { key: "q", label: `"${q}"`, onClear: () => { setSearch(""); setFilter("q", ""); } },
            batch && { key: "batch", label: batches.find((b) => b._id === batch)?.name || "Batch", onClear: () => setFilter("batch", "") },
          ]}
        />
        <ErrorNote error={error} />

        {isLoading ? (
          <Loading />
        ) : referrals.length === 0 ? (
          <Empty
            icon={Clock}
            title={batch || q ? "Nothing matches" : view === "pending" ? "No requests waiting" : "Nothing here"}
            hint={batch || q ? "Try other filters." : "Regrade requests students send show up here for approval or rejection."}
            action={batch || q ? <button className="btn btn-quiet" onClick={clearAll}>Clear filters</button> : undefined}
          />
        ) : (
          <div className="stack" style={{ gap: 12, opacity: isFetching ? 0.7 : 1, transition: "opacity 120ms ease" }}>
            {referrals.map((submission) => (
              <ReferralCard
                key={submission._id}
                submission={submission}
                isNew={view === "pending" && isNew(submission.referral?.requestedAt)}
                onOpen={() => navigate(view === "regrading" ? `/grading/${submission._id}` : `/referrals/${submission._id}`)}
              />
            ))}
            <Pager page={data?.page || 1} pages={data?.pages || 1} total={data?.total || 0} onChange={(p) => setFilter("page", p > 1 ? String(p) : "")} />
          </div>
        )}
      </div>
    </div>
  );
}

function ReferralCard({ submission, onOpen, isNew }) {
  const referral = submission.referral || {};
  const pending = !referral.decision;
  const [deciding, setDeciding] = useState(false);
  const flagged = submission.flagged || [];

  return (
    <div className="card stack">
      <div className="spread" style={{ alignItems: "flex-start", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div className="row-tight" style={{ gap: 6, flexWrap: "wrap", marginBottom: 2 }}>
            <NewTag show={isNew} />
            <span style={{ fontWeight: 600 }}>{submission.exam?.title}</span>
            {referral.requestedAt && (
              <span className={`pill tnum${pending ? " pill-warn" : ""}`} title={new Date(referral.requestedAt).toLocaleString()}>
                asked {ago(referral.requestedAt)}
              </span>
            )}
          </div>
          <div className="muted small">
            {submission.student?.name || submission.student?.email}
            {submission.student?.studentId ? ` (${submission.student.studentId})` : ""}
            {submission.batch?.name ? ` · ${submission.batch.name}` : ""}
            {" · attempt " + submission.attempt}
            {submission.submittedAt ? ` · sat ${new Date(submission.submittedAt).toLocaleDateString()}` : ""}
          </div>
          {referral.decision && (
            <div className="small" style={{ marginTop: 4 }}>
              {referral.decision === "rejected" ? "Rejected" : submission.status === "grading"
                ? `Regrading: ${referral.routeMode === "pool" ? "anyone on the batch" : referral.routeMode === "grader" ? `with ${referral.routeTo?.identifier || referral.routeTo?.name || "a grader"}` : "with the first marker"}${referral.routeUntil ? `, open to all after ${new Date(referral.routeUntil).toLocaleString()}` : ""}`
                : "Regrade finished"}
              {referral.decidedAt ? <span className="muted"> · decided {new Date(referral.decidedAt).toLocaleDateString()}</span> : null}
            </div>
          )}
        </div>
        <div className="row-tight" style={{ gap: 6, flexShrink: 0 }}>
          {pending && (
            <button className={`btn btn-sm${deciding ? "" : " btn-quiet"}`} onClick={() => setDeciding(!deciding)}>
              Decide here <ChevronDown size={13} style={{ transform: deciding ? "rotate(180deg)" : "none", transition: "transform 120ms ease" }} />
            </button>
          )}
          <button className="btn btn-sm" onClick={onOpen} style={{ whiteSpace: "nowrap" }}>
            {submission.status === "grading" && referral.decision === "approved" ? "Open the regrade" : "Open submission"} <ArrowRight size={13} />
          </button>
        </div>
      </div>

      <div className="card-quiet stack" style={{ gap: 4 }}>
        <span className="label">Why the student is asking for another look</span>
        <Latex as="p" className="small" style={{ margin: 0, whiteSpace: "pre-wrap" }}>
          {referral.reason}
        </Latex>
      </div>

      {flagged.length > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          <span className="label">{flagged.length === 1 ? "1 question flagged" : `${flagged.length} questions flagged`}</span>
          {flagged.map((question, i) => (
            <div key={question._id} className="row-tight small" style={{ gap: 8, alignItems: "flex-start" }}>
              <span className="muted tnum" style={{ flexShrink: 0 }}>{i + 1}.</span>
              <TypePill type={question.type} compact />
              <Latex as="span" className="grow clamp-2">{question.text}</Latex>
            </div>
          ))}
        </div>
      )}

      {pending && deciding && <DecidePanel submissionId={submission._id} onDone={() => setDeciding(false)} />}
    </div>
  );
}

// Approve (with who regrades and a note for them) or reject, without
// opening the submission. Both are final for the student, so both confirm.
function DecidePanel({ submissionId, onDone }) {
  const confirm = useConfirm();
  const [note, setNote] = useState("");
  const [route, setRoute] = useState("original");
  const { data: staff } = useGetSubmissionStaffQuery(submissionId);
  const [decide, { isLoading, error }] = useDecideReferralMutation();

  const go = async (approve) => {
    const yes = await confirm(approve
      ? { title: "Approve the regrade?", body: "The flagged written answers go back for marking, and the student is told.", confirmLabel: "Approve", tone: "neutral" }
      : { title: "Reject the request?", body: "The current marks stay final, and the student is told.", confirmLabel: "Reject" });
    if (!yes) return;
    try {
      await decide({ submissionId, approve, comment: approve ? note.trim() || null : null, route: approve ? route : undefined }).unwrap();
      onDone();
    } catch { /* shown below */ }
  };

  return (
    <div className="card-quiet stack" style={{ gap: 10 }}>
      <label className="field">
        <span className="label">Who does the regrade</span>
        <SearchSelect className="select" style={{ maxWidth: 360 }} value={route} onChange={(e) => setRoute(e.target.value)}>
          <option value="original">Whoever marked each answer first</option>
          <option value="pool">Anyone on the batch</option>
          {(staff || []).map((u) => <option key={u._id} value={u._id}>{u.name} ({u.role})</option>)}
        </SearchSelect>
      </label>
      <label className="field">
        <span className="label">Note for the teacher (optional)</span>
        <textarea className="input" rows={2} placeholder="What to re-check…" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <ErrorNote error={error} />
      <div className="row-tight" style={{ gap: 8 }}>
        <button className="btn btn-sm" disabled={isLoading} onClick={() => go(true)}><Check size={13} /> Approve regrade</button>
        <button className="btn btn-sm btn-danger" disabled={isLoading} onClick={() => go(false)}><X size={13} /> Reject</button>
        <button className="btn btn-sm btn-quiet" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}
