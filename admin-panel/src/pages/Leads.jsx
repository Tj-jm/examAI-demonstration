import { useState } from "react";
import { Link } from "react-router-dom";
import { Users, Download, Send, Trash2, Copy, Eye } from "lucide-react";
import { useGetLeadsQuery, useUpdateLeadMutation, useDeleteLeadMutation, useMessageLeadsMutation, useGetInterestedQuery } from "../api/leadApi";
import { useGetBatchesQuery } from "../api/contentApi";
import { Loading, ErrorNote, Empty, Pager, useConfirm } from "../components/bits";
import { useGetBadgesQuery } from "../api/badgeApi";
import { useSeen } from "../hooks/useSeen";
import NewTag from "../components/NewTag";
import SearchSelect from "../components/SearchSelect";

const STATUS = {
  new: { label: "New", className: "pill pill-warn" },
  contacted: { label: "Contacted", className: "pill" },
  joined: { label: "Joined", className: "pill pill-ok" },
  lost: { label: "Not interested", className: "pill" },
};

// Leads: people who filled in the landing page's interest form, and signed-in
// students who looked at a batch's plans without buying (backend utils/leads.js).
export default function Leads() {
  const [tab, setTab] = useState("form");
  const isNew = useSeen("leads");
  const { data: badges } = useGetBadgesQuery();
  const fresh = badges?.counts?.leads || 0;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Leads</h1>
          <p className="muted small" style={{ margin: "2px 0 0" }}>
            People who asked to hear from you, and students who looked at a course's plans but didn't buy.
          </p>
        </div>
      </div>
      <div className="row-tight" style={{ marginBottom: 12, flexWrap: "wrap" }}>
        <button className={`pill pill-btn${tab === "form" ? " pill-on" : ""}`} onClick={() => setTab("form")}>Interest form{fresh > 0 && <span className="tab-count tnum">{fresh}</span>}</button>
        <button className={`pill pill-btn${tab === "looked" ? " pill-on" : ""}`} onClick={() => setTab("looked")}>Looked at plans</button>
      </div>
      {tab === "form" ? <FormLeads isNew={isNew} /> : <LookedAtPlans />}
    </div>
  );
}

function FormLeads({ isNew }) {
  const confirm = useConfirm();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [batch, setBatch] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [compose, setCompose] = useState(null); // { channel, subject, text }
  const [result, setResult] = useState("");
  const { data, isLoading, error } = useGetLeadsQuery({ page, status, batch, search });
  const { data: batches } = useGetBatchesQuery({});
  const [update, updateState] = useUpdateLeadMutation();
  const [remove] = useDeleteLeadMutation();
  const [message, messageState] = useMessageLeadsMutation();

  const leads = data?.leads || [];
  const toggle = (id) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allOnPage = leads.length > 0 && leads.every((l) => selected.has(l._id));

  const send = async () => {
    try {
      const r = await message({ ids: [...selected], ...compose }).unwrap();
      setResult(`Sent ${r.sent}.${r.skipped ? ` ${r.skipped} had no ${compose.channel === "email" ? "email" : "phone number"}.` : ""}${r.failed ? ` ${r.failed} failed.` : ""}`);
      setCompose(null);
      setSelected(new Set());
    } catch { /* shown below */ }
  };

  const exportUrl = `/api/leads/export?status=${status}&batch=${batch}&search=${encodeURIComponent(search)}`;
  const batchList = batches || [];

  return (
    <>
      <div className="row-tight" style={{ marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        {[["", "All"], ...Object.entries(STATUS).map(([k, v]) => [k, `${v.label}${data?.counts ? ` · ${data.counts[k]}` : ""}`])].map(([value, label]) => (
          <button key={value} className={`pill pill-btn${status === value ? " pill-on" : ""}`} onClick={() => { setStatus(value); setPage(1); }}>{label}</button>
        ))}
        <SearchSelect className="select" style={{ width: "auto" }} value={batch} onChange={(e) => { setBatch(e.target.value); setPage(1); }}>
          <option value="">Any course</option>
          {(Array.isArray(batchList) ? batchList : []).map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
        </SearchSelect>
        <input className="input" style={{ width: 200 }} placeholder="Search name, phone, email" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <a className="btn btn-sm" href={exportUrl}><Download size={14} /> CSV</a>
      </div>

      {selected.size > 0 && (
        <div className="card stack" style={{ marginBottom: 12 }}>
          <div className="row-tight" style={{ flexWrap: "wrap" }}>
            <strong className="small">{selected.size} selected</strong>
            <button className="btn btn-sm" onClick={() => setCompose({ channel: "sms", subject: "", text: "" })}><Send size={14} /> SMS</button>
            <button className="btn btn-sm" onClick={() => setCompose({ channel: "email", subject: "", text: "" })}><Send size={14} /> Email</button>
            <button className="btn btn-sm btn-quiet" onClick={() => setSelected(new Set())}>Clear</button>
          </div>
          {compose && (
            <div className="stack">
              {compose.channel === "email" && (
                <input className="input" placeholder="Subject" maxLength={120} value={compose.subject} onChange={(e) => setCompose({ ...compose, subject: e.target.value })} />
              )}
              <textarea className="textarea" rows={3} maxLength={1000} value={compose.text} onChange={(e) => setCompose({ ...compose, text: e.target.value })}
                placeholder="{name}, thanks for your interest in our HSC batch. Classes start 1 November. Call 01XXXXXXXXX or sign up at yoursite.com." />
              <span className="hint">{"{name}"} becomes their first name. Leads you message are marked contacted.</span>
              <div className="row-tight">
                <button className="btn btn-primary btn-sm" disabled={!compose.text.trim() || messageState.isLoading} onClick={send}>
                  {messageState.isLoading ? "Sending…" : `Send ${compose.channel === "email" ? "email" : "SMS"}`}
                </button>
                <button className="btn btn-sm btn-quiet" onClick={() => setCompose(null)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
      {result && <div className="banner banner-ok" style={{ marginBottom: 12 }}>{result}</div>}

      <ErrorNote error={error || updateState.error || messageState.error} />
      {isLoading ? <Loading /> : !leads.length ? (
        <Empty icon={Users} title="No leads yet"
          hint={<>Switch on the <Link to="/landing-page">landing page</Link>'s Interest form so visitors can leave their number.</>} />
      ) : (
        <div className="list">
          <label className="list-row small" style={{ gap: 8 }}>
            <input type="checkbox" checked={allOnPage} onChange={(e) => setSelected((s) => {
              const next = new Set(s);
              for (const l of leads) { if (e.target.checked) next.add(l._id); else next.delete(l._id); }
              return next;
            })} />
            Select this page
          </label>
          {leads.map((l) => (
            <div key={l._id} className="list-row" style={{ alignItems: "flex-start", gap: 10 }}>
              <input type="checkbox" checked={selected.has(l._id)} onChange={() => toggle(l._id)} style={{ marginTop: 4 }} />
              <div className="grow stack" style={{ gap: 4 }}>
                <div className="row-tight" style={{ flexWrap: "wrap" }}>
                  <NewTag show={isNew(l.createdAt)} />
                  <strong>{l.name}</strong>
                  <span className={STATUS[l.status]?.className || "pill"}>{STATUS[l.status]?.label || l.status}</span>
                  {l.batch?.name && <span className="muted small">· {l.batch.name}</span>}
                </div>
                <span className="small tnum">
                  {[l.phone && <a key="p" href={`tel:${l.phone}`}>{l.phone}</a>, l.email && <a key="e" href={`mailto:${l.email}`}>{l.email}</a>].filter(Boolean).reduce((a, b) => [a, " · ", b])}
                </span>
                {l.message && <span className="small">“{l.message}”</span>}
                <span className="muted small">
                  {new Date(l.createdAt).toLocaleString()}
                  {l.ref ? ` · referral ${l.ref}` : ""}
                  {l.messages ? ` · ${l.messages} message${l.messages === 1 ? "" : "s"} sent` : ""}
                  {l.student ? ` · signed up as ${l.student.name || "a student"}` : ""}
                </span>
                <input className="input" style={{ maxWidth: 480 }} placeholder="Notes" defaultValue={l.notes}
                  onBlur={(e) => e.target.value !== (l.notes || "") && update({ id: l._id, notes: e.target.value })} />
              </div>
              <div className="stack" style={{ gap: 6, alignItems: "flex-end" }}>
                <select className="select" style={{ width: "auto" }} value={l.status} onChange={(e) => update({ id: l._id, status: e.target.value })}>
                  {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
                <button className="icon-btn icon-btn-danger" title="Delete" onClick={async () => {
                  if (await confirm({ title: "Delete this lead?", body: `${l.name} will be removed from the list.`, confirmLabel: "Delete", tone: "danger" })) remove(l._id);
                }}><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
      {data && <Pager page={data.page} pages={data.pages} total={data.total} onChange={setPage} />}
    </>
  );
}

function LookedAtPlans() {
  const [page, setPage] = useState(1);
  const [days, setDays] = useState(14);
  const [batch, setBatch] = useState("");
  const [note, setNote] = useState("");
  const { data, isLoading, error } = useGetInterestedQuery({ page, days, batch });
  const { data: batches } = useGetBatchesQuery({});
  const batchList = batches || [];
  const rows = data?.rows || [];

  const copy = async (field) => {
    const values = [...new Set(rows.map((r) => r.student[field]).filter(Boolean))];
    try {
      await navigator.clipboard.writeText(values.join(field === "email" ? ", " : "\n"));
      setNote(`Copied ${values.length} ${field === "email" ? "emails" : "phone numbers"} from this page.`);
    } catch {
      setNote("Couldn't copy in this browser.");
    }
  };

  return (
    <>
      <div className="row-tight" style={{ marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <select className="select" style={{ width: "auto" }} value={days} onChange={(e) => { setDays(Number(e.target.value)); setPage(1); }}>
          {[3, 7, 14, 30, 60].map((d) => <option key={d} value={d}>Last {d} days</option>)}
        </select>
        <SearchSelect className="select" style={{ width: "auto" }} value={batch} onChange={(e) => { setBatch(e.target.value); setPage(1); }}>
          <option value="">Any course</option>
          {(Array.isArray(batchList) ? batchList : []).map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
        </SearchSelect>
        <button className="btn btn-sm" disabled={!rows.length} onClick={() => copy("email")}><Copy size={14} /> Copy emails</button>
        <button className="btn btn-sm" disabled={!rows.length} onClick={() => copy("phone")}><Copy size={14} /> Copy phones</button>
      </div>
      <p className="hint" style={{ marginTop: 0 }}>
        Signed-in students who opened a course's plans and haven't bought it. To message them all, a <Link to="/automations">Checkout not finished</Link> automation or a <Link to="/campaigns">campaign</Link> to that course works well.
      </p>
      {note && <div className="banner banner-ok" style={{ marginBottom: 12 }}>{note}</div>}
      <ErrorNote error={error} />
      {isLoading ? <Loading /> : !rows.length ? (
        <Empty icon={Eye} title="Nobody yet" hint="Students who open a course's plans without buying show up here." />
      ) : (
        <div className="list">
          {rows.map((r) => (
            <div key={`${r.student._id}:${r.batch._id}`} className="list-row">
              <div className="grow stack" style={{ gap: 2 }}>
                <div className="row-tight" style={{ flexWrap: "wrap" }}>
                  <Link to={`/students/${r.student._id}`}><strong>{r.student.name}</strong></Link>
                  <span className="muted small">· {r.batch.name}</span>
                  {r.student.optedOut && <span className="pill">No offers</span>}
                </div>
                <span className="small tnum">{[r.student.email, r.student.phone].filter(Boolean).join(" · ") || "—"}</span>
              </div>
              <div className="small muted tnum" style={{ textAlign: "right" }}>
                <div>{r.views} view{r.views === 1 ? "" : "s"}</div>
                <div>{new Date(r.lastAt).toLocaleDateString()}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      {data && <Pager page={data.page} pages={data.pages} total={data.total} onChange={setPage} />}
    </>
  );
}
