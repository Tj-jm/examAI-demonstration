import { useState, useRef } from "react";
import { useOutletContext } from "react-router-dom";
import { LifeBuoy, ArrowLeft, Search, ImagePlus, Loader2, X, Send, User } from "lucide-react";
import {
  useGetTicketsQuery, useGetTicketQuery, useGetTicketAssigneesQuery,
  useReplyToTicketMutation, useUpdateTicketMutation, useUploadTicketImageMutation,
  useGetSupportSettingsQuery, useUpdateSupportSettingsMutation,
  useGetTicketCountsQuery,
} from "../api/accountApi";
import { useGetBatchesQuery } from "../api/contentApi";
import { Loading, ErrorNote, Empty, Pager } from "../components/bits";
import { useTerms } from "../terms";
import { useSeen } from "../hooks/useSeen";
import SearchSelect from "../components/SearchSelect";

const CATEGORY_LABEL = {
  payment: "Payment", technical: "Technical", content: "Content", account: "Account", appeal: "Appeal", other: "Other",
};
const STATUS = {
  open: { label: "Waiting on us", cls: "pill-warn" },
  waiting: { label: "Waiting on student", cls: "" },
  resolved: { label: "Resolved", cls: "pill-ok" },
};

// Support tickets from students. Owner/admin see every ticket and assign
// them; a teacher sees the ones assigned to them.
export default function SupportTickets() {
  const { me } = useOutletContext();
  const [openId, setOpenId] = useState(null);
  useSeen("support");
  if (openId) return <TicketView id={openId} me={me} onClose={() => setOpenId(null)} />;
  return <TicketList me={me} onOpen={setOpenId} />;
}

function TicketList({ me, onOpen }) {
  const terms = useTerms();
  const manager = ["owner", "admin"].includes(me.role);
  const [status, setStatus] = useState("active");
  const [category, setCategory] = useState("");
  const [batchId, setBatchId] = useState("");
  const [assigned, setAssigned] = useState("");
  const [unread, setUnread] = useState(false);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading, error } = useGetTicketsQuery({
    status, category, batchId, assigned, search: query, unread: unread ? "1" : undefined, page,
  });
  const { data: batches } = useGetBatchesQuery({});
  const { data: counts } = useGetTicketCountsQuery();
  const { data: assignees } = useGetTicketAssigneesQuery(undefined, { skip: !manager });
  const set = (setter) => (value) => { setter(value); setPage(1); };
  const tickets = data?.tickets || [];

  return (
    <div className="page">
      <div className="page-head spread">
        <h1>Support</h1>
        {manager && <ReopenWindow />}
      </div>
      <div className="stack">
        <form onSubmit={(e) => { e.preventDefault(); set(setQuery)(search); }} className="search-wrap">
          <Search size={15} className="search-icon" />
          <input className="input" style={{ paddingLeft: 36 }} placeholder="Search subject, or student name, email or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
        </form>

        <div className="row-tight" style={{ flexWrap: "wrap" }}>
          <select className="select" value={status} onChange={(e) => set(setStatus)(e.target.value)}>
            <option value="active">Not resolved</option>
            <option value="open">Waiting on us{counts?.open ? ` (${counts.open})` : ""}</option>
            <option value="waiting">Waiting on student</option>
            <option value="resolved">Resolved</option>
            <option value="">Every status</option>
          </select>
          <select className="select" value={category} onChange={(e) => set(setCategory)(e.target.value)}>
            <option value="">Every category</option>
            {Object.entries(CATEGORY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <SearchSelect className="select" value={batchId} onChange={(e) => set(setBatchId)(e.target.value)}>
            <option value="">Every {terms.batch}</option>
            {(batches || []).map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
          </SearchSelect>
          {manager && (
            <SearchSelect className="select" value={assigned} onChange={(e) => set(setAssigned)(e.target.value)}>
              <option value="">Anyone</option>
              <option value="me">Assigned to me</option>
              <option value="none">Unassigned</option>
              {(assignees?.users || []).filter((u) => u._id !== me._id).map((u) => <option key={u._id} value={u._id}>{u.name}</option>)}
            </SearchSelect>
          )}
          <label className="row-tight small" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={unread} onChange={(e) => set(setUnread)(e.target.checked)} /> Unread only
            {counts?.unread > 0 && <span className="tab-count tnum">{counts.unread}</span>}
          </label>
        </div>

        <p className="muted small tnum" style={{ margin: 0 }}>{data?.total ?? 0} ticket{data?.total === 1 ? "" : "s"}</p>
        <ErrorNote error={error} />

        {isLoading ? <Loading /> : tickets.length ? (
          <>
            <div className="list">
              {tickets.map((t) => (
                <button key={t._id} className="list-row" style={{ textAlign: "left" }} onClick={() => onOpen(t._id)}>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="row-tight" style={{ marginBottom: 4, flexWrap: "wrap" }}>
                      <span className={`pill ${STATUS[t.status]?.cls || ""}`}>{STATUS[t.status]?.label}</span>
                      <span className="pill">{CATEGORY_LABEL[t.category]}</span>
                      {t.unreadByStaff && <span className="pill pill-on">New</span>}
                    </div>
                    <div className="small truncate" style={{ fontWeight: t.unreadByStaff ? 600 : 400, maxWidth: 520 }}>{t.subject}</div>
                    <div className="muted small" style={{ marginTop: 3 }}>
                      {t.student?.name || t.student?.email || t.student?.phoneNumber}
                      {t.batch?.name ? ` · ${t.batch.name}` : ""}
                      {t.assignedTo?.name ? ` · ${t.assignedTo.name}` : " · unassigned"}
                    </div>
                  </div>
                  <span className="muted small">{new Date(t.lastActivityAt).toLocaleDateString()}</span>
                </button>
              ))}
            </div>
            <Pager page={data?.page || 1} pages={data?.pages || 1} total={data?.total || 0} onChange={setPage} />
          </>
        ) : (
          <Empty icon={LifeBuoy} title="No tickets here" hint="Tickets students open from Help & support land here." />
        )}
      </div>
    </div>
  );
}

// How long a student's reply can reopen a resolved ticket.
function ReopenWindow() {
  const { data } = useGetSupportSettingsQuery();
  const [save, { isLoading }] = useUpdateSupportSettingsMutation();
  const days = data?.support?.reopenDays ?? 7;
  return (
    <label className="row-tight small muted" title="A student's reply reopens a resolved ticket within this window; after it, the ticket is closed and they open a new one.">
      Reopen window
      <select className="select" value={days} disabled={isLoading} onChange={(e) => save({ reopenDays: Number(e.target.value) })}>
        {[[0, "None (closed when resolved)"], [3, "3 days"], [7, "7 days"], [14, "14 days"], [30, "30 days"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        {![0, 3, 7, 14, 30].includes(days) && <option value={days}>{days} days</option>}
      </select>
    </label>
  );
}

function ReplyImages({ images, onChange }) {
  const input = useRef(null);
  const [upload, { isLoading }] = useUploadTicketImageMutation();
  const pick = async (e) => {
    const files = [...(e.target.files || [])].slice(0, 4 - images.length);
    e.target.value = "";
    const added = [];
    for (const file of files) {
      try {
        added.push((await upload(file).unwrap()).url);
      } catch {
        // skipped
      }
    }
    if (added.length) onChange([...images, ...added]);
  };
  return (
    <div className="row-tight" style={{ gap: 8, flexWrap: "wrap" }}>
      {images.map((url) => (
        <div className="thumb" key={url}>
          <img src={url} alt="" />
          <button type="button" className="thumb-remove" onClick={() => onChange(images.filter((u) => u !== url))} title="Remove image"><X size={13} /></button>
        </div>
      ))}
      {images.length < 4 && (
        <button type="button" className="btn btn-sm btn-quiet" onClick={() => input.current?.click()} disabled={isLoading}>
          {isLoading ? <Loader2 size={13} className="spin" /> : <ImagePlus size={13} />} Attach image
        </button>
      )}
      <input ref={input} type="file" hidden multiple accept="image/png,image/jpeg,image/webp" onChange={pick} />
    </div>
  );
}

function TicketView({ id, me, onClose }) {
  const manager = ["owner", "admin"].includes(me.role);
  const { data, isLoading, error } = useGetTicketQuery(id);
  const { data: assignees } = useGetTicketAssigneesQuery(undefined, { skip: !manager });
  const [reply, { isLoading: sending, error: replyError }] = useReplyToTicketMutation();
  const [update, { error: updateError }] = useUpdateTicketMutation();
  const [text, setText] = useState("");
  const [images, setImages] = useState([]);
  const [after, setAfter] = useState("waiting");

  if (isLoading) return <div className="page"><Loading /></div>;
  if (error) return <div className="page"><ErrorNote error={error} /></div>;
  const t = data.ticket;

  const send = async () => {
    try {
      await reply({ id, text, images, status: after }).unwrap();
      setText("");
      setImages([]);
    } catch {
      // shown below
    }
  };

  return (
    <div className="page">
      <div className="page-head spread">
        <div style={{ minWidth: 0 }}>
          <div className="row-tight" style={{ marginBottom: 4, flexWrap: "wrap" }}>
            <span className={`pill ${STATUS[t.status]?.cls || ""}`}>{STATUS[t.status]?.label}</span>
            <span className="pill">{CATEGORY_LABEL[t.category]}</span>
          </div>
          <h1 style={{ margin: 0 }}>{t.subject}</h1>
          <p className="muted small" style={{ margin: "2px 0 0" }}>
            <User size={12} style={{ verticalAlign: -1 }} /> {t.student?.name} · {t.student?.email || t.student?.phoneNumber}
            {t.batch?.name ? ` · ${t.batch.name}` : ""} · opened {new Date(t.createdAt).toLocaleString()}
            {t.student && t.student.isActive === false ? " · account inactive" : ""}
          </p>
        </div>
        <button className="btn btn-sm btn-quiet" onClick={onClose}><ArrowLeft size={14} /> Back</button>
      </div>

      <div className="stack">
        <div className="row-tight" style={{ flexWrap: "wrap" }}>
          <select className="select" value={t.status} onChange={(e) => update({ id, status: e.target.value })}>
            <option value="open">Waiting on us</option>
            <option value="waiting">Waiting on student</option>
            <option value="resolved">Resolved</option>
          </select>
          {manager && (
            <SearchSelect className="select" value={t.assignedTo?._id || ""} onChange={(e) => update({ id, assignedTo: e.target.value || null })}>
              <option value="">Unassigned</option>
              {(assignees?.users || []).map((u) => <option key={u._id} value={u._id}>{u.name}{u._id === me._id ? " (me)" : ""}</option>)}
            </SearchSelect>
          )}
        </div>
        <ErrorNote error={updateError} />

        {t.messages.map((m) => (
          <div key={m._id} className={m.from === "student" ? "card stack" : "card-quiet stack"} style={{ gap: 6 }}>
            <span className="muted small">
              {m.from === "student" ? t.student?.name || "Student" : m.author?.name || "Staff"} · {new Date(m.at).toLocaleString()}
            </span>
            {m.text && <p className="small" style={{ margin: 0, whiteSpace: "pre-wrap" }}>{m.text}</p>}
            {m.images?.length > 0 && (
              <div className="row-tight" style={{ flexWrap: "wrap", gap: 8 }}>
                {m.images.map((url) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer"><img src={url} alt="" style={{ maxWidth: 220, maxHeight: 220, borderRadius: 8, display: "block" }} /></a>
                ))}
              </div>
            )}
          </div>
        ))}

        <div className="card stack">
          <span className="label">Reply</span>
          <textarea className="input textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder="Write to the student…" />
          <ReplyImages images={images} onChange={setImages} />
          <div className="row-tight" style={{ justifyContent: "flex-end", flexWrap: "wrap" }}>
            <span className="muted small">then mark as</span>
            <select className="select" value={after} onChange={(e) => setAfter(e.target.value)}>
              <option value="waiting">Waiting on student</option>
              <option value="resolved">Resolved</option>
              <option value="open">Still waiting on us</option>
            </select>
            <button className="btn btn-primary" disabled={(!text.trim() && !images.length) || sending} onClick={send}>
              <Send size={14} /> {sending ? "Sending…" : "Send"}
            </button>
          </div>
          <ErrorNote error={replyError} />
        </div>
      </div>
    </div>
  );
}
