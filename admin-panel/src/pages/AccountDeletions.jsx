import { useState } from "react";
import { UserX, Settings2, Check, X } from "lucide-react";
import {
  useGetDeletionRequestsQuery, useApproveDeletionMutation, useRejectDeletionMutation,
  useGetDeletionSettingsQuery, useUpdateDeletionSettingsMutation, useGetDeletionCountsQuery,
} from "../api/accountApi";
import { Loading, ErrorNote, Empty, Pager, Field, useConfirm } from "../components/bits";
import { useSeen } from "../hooks/useSeen";
import NewTag from "../components/NewTag";

// Students asking to delete their account, and the rules for it.

const STATUS = {
  pending: { label: "Grace period", cls: "" },
  awaiting: { label: "Needs approval", cls: "pill-warn" },
  completed: { label: "Deleted", cls: "pill-bad" },
  cancelled: { label: "Cancelled by student", cls: "" },
  rejected: { label: "Rejected", cls: "" },
};
const day = (d) => new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export default function AccountDeletions() {
  const [tab, setTab] = useState("requests");
  const isNew = useSeen("deletions");
  const { data: counts } = useGetDeletionCountsQuery();
  return (
    <div className="page">
      <div className="page-head"><h1>Account deletions</h1></div>
      <div className="row-tight" style={{ marginBottom: 4, flexWrap: "wrap" }}>
        {[["requests", "Requests", UserX], ["settings", "Settings", Settings2]].map(([value, label, Icon]) => (
          <button key={value} className={`pill pill-btn row-tight${tab === value ? " pill-on" : ""}`} style={{ gap: 5 }} onClick={() => setTab(value)}>
            <Icon size={12} /> {label}
            {value === "requests" && counts?.awaiting > 0 && <span className="tab-count tnum" title="Need approval">{counts.awaiting}</span>}
          </button>
        ))}
      </div>
      {tab === "requests" ? <Requests isNew={isNew} counts={counts} /> : <DeletionSettings />}
    </div>
  );
}

function Requests({ isNew, counts }) {
  const [status, setStatus] = useState("active");
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useGetDeletionRequestsQuery({ status, page });
  const [approve, { error: approveError }] = useApproveDeletionMutation();
  const [reject, { error: rejectError }] = useRejectDeletionMutation();
  const [rejecting, setRejecting] = useState(null);
  const [note, setNote] = useState("");
  const confirm = useConfirm();
  const requests = data?.requests || [];

  return (
    <div className="stack">
      <div className="row-tight">
        <select className="select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="active">Open (grace period or needs approval)</option>
          <option value="awaiting">Needs approval{counts?.awaiting ? ` (${counts.awaiting})` : ""}</option>
          <option value="completed">Deleted</option>
          <option value="cancelled">Cancelled</option>
          <option value="rejected">Rejected</option>
          <option value="">Everything</option>
        </select>
      </div>
      <ErrorNote error={error || approveError || rejectError} />
      {isLoading ? <Loading /> : requests.length ? (
        <>
          <div className="list">
            {requests.map((r) => (
              <div key={r._id} className="list-row" style={{ alignItems: "flex-start" }}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row-tight" style={{ marginBottom: 4, flexWrap: "wrap" }}>
                    <NewTag show={isNew(r.createdAt)} />
                    <span className={`pill ${STATUS[r.status]?.cls || ""}`}>{STATUS[r.status]?.label}</span>
                    <span className="small" style={{ fontWeight: 500 }}>{r.name}</span>
                    <span className="muted small">{r.contact}</span>
                  </div>
                  {r.reason && <p className="small" style={{ margin: "2px 0" }}>“{r.reason}”</p>}
                  <div className="muted small">
                    Asked {day(r.createdAt)}
                    {["pending", "awaiting"].includes(r.status) ? ` · due ${day(r.scheduledFor)}` : ""}
                    {r.completedAt ? ` · deleted ${day(r.completedAt)}` : ""}
                    {r.handledBy?.name ? ` · by ${r.handledBy.name}` : ""}
                    {r.note ? ` · note: ${r.note}` : ""}
                  </div>
                  {rejecting === r._id && (
                    <div className="stack" style={{ marginTop: 8, gap: 6 }}>
                      <textarea className="input textarea" style={{ minHeight: 60 }} placeholder="Why the account is kept (the student reads this)" value={note} onChange={(e) => setNote(e.target.value)} />
                      <div className="row-tight">
                        <button className="btn btn-sm btn-primary" disabled={!note.trim()} onClick={async () => { await reject({ id: r._id, note }).unwrap().catch(() => {}); setRejecting(null); setNote(""); }}>Send</button>
                        <button className="btn btn-sm btn-quiet" onClick={() => setRejecting(null)}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
                {["pending", "awaiting"].includes(r.status) && rejecting !== r._id && (
                  <div className="row-tight">
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={async () => {
                        if (await confirm({ title: `Delete ${r.name}'s account now?`, body: "Their personal data is erased. This can't be undone.", confirmLabel: "Delete now", tone: "danger" })) approve(r._id);
                      }}
                    >
                      <Check size={13} /> {r.status === "awaiting" ? "Approve" : "Delete now"}
                    </button>
                    <button className="btn btn-sm btn-quiet" onClick={() => setRejecting(r._id)}><X size={13} /> Reject</button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <Pager page={data?.page || 1} pages={data?.pages || 1} total={data?.total || 0} onChange={setPage} />
        </>
      ) : (
        <Empty icon={UserX} title="No requests" hint="Students ask from their Account page." />
      )}
    </div>
  );
}

function DeletionSettings() {
  const { data, isLoading } = useGetDeletionSettingsQuery();
  const [save, { isLoading: saving, error }] = useUpdateDeletionSettingsMutation();
  const [form, setForm] = useState(null);
  if (isLoading) return <Loading />;
  const value = form || data?.accountDeletion || {};
  const set = (patch) => setForm({ ...value, ...patch });

  return (
    <div className="card stack" style={{ maxWidth: 560 }}>
      <label className="spread" style={{ cursor: "pointer" }}>
        <span className="grow">
          <span style={{ display: "block" }}>Students can ask to delete their account</span>
          <span className="hint">Off: the option is hidden and they have to contact support.</span>
        </span>
        <input type="checkbox" checked={value.enabled !== false} onChange={(e) => set({ enabled: e.target.checked })} />
      </label>
      <Field label="Grace period (days)" hint="Time to change their mind. 0 = no grace period.">
        <input className="input" type="number" min="0" max="365" style={{ maxWidth: 110 }} value={value.graceDays ?? 14} onChange={(e) => set({ graceDays: Number(e.target.value) })} />
      </Field>
      <label className="spread" style={{ cursor: "pointer" }}>
        <span className="grow">
          <span style={{ display: "block" }}>Delete automatically after the grace period</span>
          <span className="hint">Off: requests wait here for an owner or admin to approve.</span>
        </span>
        <input type="checkbox" checked={value.autoDelete !== false} onChange={(e) => set({ autoDelete: e.target.checked })} />
      </label>
      <p className="muted small" style={{ margin: 0 }}>
        Deleting erases the profile, chats, doubts, practice history, support tickets and conduct record. Payment records and exam results stay, under "Deleted student".
      </p>
      <ErrorNote error={error} />
      <div className="row-tight" style={{ justifyContent: "flex-end" }}>
        <button className="btn btn-primary" disabled={!form || saving} onClick={async () => { await save(value).unwrap().catch(() => {}); setForm(null); }}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
