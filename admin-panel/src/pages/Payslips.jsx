import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Wallet, Plus, Printer, Trash2, Send, Check, Upload, X, Sparkles } from "lucide-react";
import {
  useGetPayslipsQuery, useGetPayslipPeopleQuery, useLazyPreviewPayslipQuery, useGetPayslipQuery,
  useCreatePayslipMutation, useUpdatePayslipMutation, useIssuePayslipMutation, usePayPayslipMutation,
  useDeletePayslipMutation, useUploadPayslipProofMutation,
} from "../api/payslipApi";
import { useGetSettingsQuery } from "../api/contentApi";
import { Loading, ErrorNote, Empty, Pager, Field, useConfirm } from "../components/bits";
import PayslipSheet, { money, day, StatusPill, STATUS, ROLE_LABEL } from "../components/PayslipSheet";
import ClassPayAdmin from "../components/ClassPay";
import SearchSelect from "../components/SearchSelect";

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const PERIODS = [
  ["lastMonth", "Last month", () => { const d = new Date(); return [ymd(new Date(d.getFullYear(), d.getMonth() - 1, 1)), ymd(new Date(d.getFullYear(), d.getMonth(), 0))]; }],
  ["month", "This month", () => { const d = new Date(); return [ymd(new Date(d.getFullYear(), d.getMonth(), 1)), ymd(d)]; }],
  ["2w", "Last 2 weeks", () => { const d = new Date(); const s = new Date(); s.setDate(d.getDate() - 13); return [ymd(s), ymd(d)]; }],
];

// Team payslips: owner and admin make, issue and pay them (backend
// controllers/admin/payslipController.js). Members see theirs on My payslips.
export default function Payslips() {
  const { me } = useOutletContext();
  const allowed = ["owner", "admin"].includes(me.role);
  const [filters, setFilters] = useState({ user: "", role: "", status: "", from: "", to: "" });
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [tab, setTab] = useState("slips");
  const key = JSON.stringify(filters);
  useEffect(() => { setPage(1); }, [key]);

  const params = Object.fromEntries(Object.entries({ ...filters, page }).filter(([, v]) => v !== ""));
  const { data, isLoading, isFetching, error } = useGetPayslipsQuery(params, { skip: !allowed });
  const { data: people } = useGetPayslipPeopleQuery(undefined, { skip: !allowed });
  const set = (k, v) => setFilters({ ...filters, [k]: v });
  const filtered = Object.values(filters).some(Boolean);

  if (!allowed) {
    return <div className="page"><Empty icon={Wallet} title="Not available" hint="This page is limited to owner and admin accounts." /></div>;
  }

  return (
    <div className="page">
      <div className="page-head spread">
        <div>
          <h1>Payslips</h1>
          <p className="muted small" style={{ margin: "2px 0 0" }}>Pay graders, doubt solvers, teachers and sellers, and keep a record of it.</p>
        </div>
        <button className="btn" onClick={() => setCreating(true)}><Plus size={15} /> New payslip</button>
      </div>

      <div className="row-tight" style={{ marginBottom: 12 }}>
        {[["slips", "Payslips"], ["classes", "Class pay"]].map(([k, l]) => (
          <button key={k} className={`pill pill-btn${tab === k ? " pill-on" : ""}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === "classes" ? <ClassPayAdmin /> : (
      <div className="stack">
        {data?.summary?.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            {data.summary.map((s) => (
              <div key={s.currency} className="stack" style={{ display: "contents" }}>
                <div className="card stack" style={{ gap: 4, borderTop: "3px solid var(--warning)" }}>
                  <span className="muted small">Still to pay · {s.currency}</span>
                  <strong style={{ fontSize: 22 }} className="tnum">{money(s.due, s.currency)}</strong>
                  <span className="muted small">{s.dueCount} payslip{s.dueCount === 1 ? "" : "s"}</span>
                </div>
                <div className="card stack" style={{ gap: 4, borderTop: "3px solid var(--correct)" }}>
                  <span className="muted small">Paid · {s.currency}</span>
                  <strong style={{ fontSize: 22 }} className="tnum">{money(s.paid, s.currency)}</strong>
                  <span className="muted small">{s.paidCount} payslip{s.paidCount === 1 ? "" : "s"}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="row-tight" style={{ flexWrap: "wrap" }}>
          <SearchSelect className="select" value={filters.user} onChange={(e) => set("user", e.target.value)}>
            <option value="">Everyone</option>
            {(people || []).map((p) => <option key={p._id} value={p._id}>{p.name} · {ROLE_LABEL[p.role] || p.role}</option>)}
          </SearchSelect>
          <SearchSelect className="select" value={filters.role} onChange={(e) => set("role", e.target.value)}>
            <option value="">Every role</option>
            {["grader", "teacher", "doubtSolver", "representative", "admin"].map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </SearchSelect>
          <div className="row-tight">
            {[["", "All"], ...Object.entries(STATUS).map(([k, [l]]) => [k, l])].map(([k, l]) => (
              <button key={k} className={`pill pill-btn${filters.status === k ? " pill-on" : ""}`} onClick={() => set("status", k)}>{l}</button>
            ))}
          </div>
          <label className="row-tight small">Period ends from <input className="input" type="date" value={filters.from} onChange={(e) => set("from", e.target.value)} style={{ marginLeft: 6 }} /></label>
          <label className="row-tight small">to <input className="input" type="date" value={filters.to} onChange={(e) => set("to", e.target.value)} style={{ marginLeft: 6 }} /></label>
          {filtered && <button className="btn btn-sm btn-quiet" onClick={() => setFilters({ user: "", role: "", status: "", from: "", to: "" })}>Clear filters</button>}
          {isFetching && <span className="muted small">Updating…</span>}
        </div>

        <ErrorNote error={error} />

        {isLoading ? <Loading /> : !data?.items?.length ? (
          <Empty icon={Wallet} title={filtered ? "No payslips match" : "No payslips yet"} hint={filtered ? "Try clearing a filter." : "Make one with New payslip. It fills in from grading, doubts and sales."} />
        ) : (
          <div className="card" style={{ padding: 0, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
              <thead>
                <tr>
                  {["Number", "Team member", "Period", "Total", "Status", "Paid"].map((h) => (
                    <th key={h} style={{ textAlign: "left", padding: "10px 12px", borderBottom: "1px solid var(--border)", color: "var(--text-muted)", fontWeight: 500 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.items.map((p) => (
                  <tr key={p._id} onClick={() => setOpenId(p._id)} style={{ cursor: "pointer" }}>
                    <td style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }} className="tnum">{p.number}</td>
                    <td style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
                      <strong>{p.name}</strong> <span className="muted small">· {ROLE_LABEL[p.role] || p.role}</span>
                    </td>
                    <td style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }} className="small">{day(p.periodFrom)} – {day(p.periodTo)}</td>
                    <td style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }} className="tnum"><strong>{money(p.total, p.currency)}</strong></td>
                    <td style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}><StatusPill status={p.status} /></td>
                    <td style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }} className="small muted">{p.payment?.paidAt ? `${day(p.payment.paidAt)} · ${p.payment.method}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ padding: "8px 12px" }}>
              <Pager page={data.page} pages={data.pages} total={data.total} onChange={setPage} />
            </div>
          </div>
        )}
      </div>
      )}

      {creating && <PayslipEditor people={people || []} onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); setOpenId(id); }} />}
      {openId && <PayslipDialog id={openId} people={people || []} onClose={() => setOpenId(null)} />}
    </div>
  );
}

const KINDS = [["bonus", "Bonus"], ["deduction", "Deduction"], ["other", "Other"], ["grading", "Grading"], ["doubts", "Doubts"], ["classes", "Live classes"], ["sales", "Sales commission"]];

// Pick a team member: narrow by role, then search by name or email.
const ROLE_ORDER = ["teacher", "grader", "doubtSolver", "representative", "admin"];
function PersonPicker({ people, value, onChange }) {
  const [role, setRole] = useState("");
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const counts = Object.fromEntries(ROLE_ORDER.map((r) => [r, people.filter((p) => p.role === r).length]));
  const shown = people
    .filter((p) => (!role || p.role === role) && (!needle || `${p.name} ${p.email || ""}`.toLowerCase().includes(needle)))
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || String(a.name).localeCompare(String(b.name)));
  const picked = people.find((p) => String(p._id) === String(value));

  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row-tight" style={{ flexWrap: "wrap", gap: 6 }}>
        <button type="button" className={`pill pill-btn${!role ? " pill-on" : ""}`} onClick={() => setRole("")}>All {people.length}</button>
        {ROLE_ORDER.filter((r) => counts[r]).map((r) => (
          <button key={r} type="button" className={`pill pill-btn${role === r ? " pill-on" : ""}`} onClick={() => setRole(r)}>{ROLE_LABEL[r]} {counts[r]}</button>
        ))}
      </div>
      <input className="input" placeholder="Search by name or email" value={q} onChange={(e) => setQ(e.target.value)} />
      <div style={{ maxHeight: 200, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
        {shown.map((p) => {
          const on = String(p._id) === String(value);
          return (
            <button key={p._id} type="button" onClick={() => onChange(String(p._id))} className="spread"
              style={{ width: "100%", padding: "7px 10px", border: "none", borderBottom: "1px solid var(--border)", background: on ? "var(--primary-soft, var(--surface-2))" : "none", color: "inherit", font: "inherit", cursor: "pointer", textAlign: "left" }}>
              <span><strong>{p.name}</strong>{p.email && <span className="muted small"> · {p.email}</span>}</span>
              <span className="muted small">{ROLE_LABEL[p.role] || p.role}{p.isActive === false ? " · inactive" : ""}</span>
            </button>
          );
        })}
        {!shown.length && <div className="small muted" style={{ padding: 8 }}>No one matches.</div>}
      </div>
      {picked && <span className="small">Picked: <strong>{picked.name}</strong> · {ROLE_LABEL[picked.role] || picked.role}</span>}
    </div>
  );
}

// New payslip, or edits to one that isn't paid yet.
function PayslipEditor({ people, slip, onClose, onSaved }) {
  const { data: settings } = useGetSettingsQuery();
  const [user, setUser] = useState(slip ? String(slip.user) : "");
  const [from, setFrom] = useState(slip?.periodFrom ? slip.periodFrom.slice(0, 10) : PERIODS[0][2]()[0]);
  const [to, setTo] = useState(slip?.periodTo ? slip.periodTo.slice(0, 10) : PERIODS[0][2]()[1]);
  const [currency, setCurrency] = useState(slip?.currency || "");
  const [lines, setLines] = useState(slip?.lines || []);
  const [note, setNote] = useState(slip?.note || "");
  const [filled, setFilled] = useState(Boolean(slip));
  const [preview, { isFetching: filling, error: fillError }] = useLazyPreviewPayslipQuery();
  const [create, { isLoading: creating, error: createError }] = useCreatePayslipMutation();
  const [update, { isLoading: updating, error: updateError }] = useUpdatePayslipMutation();
  const cur = (currency || settings?.defaultCurrency || "").toUpperCase();
  const total = lines.reduce((n, l) => n + (l.kind === "deduction" ? -Math.abs(Number(l.amount) || 0) : Number(l.amount) || 0), 0);

  const fill = async () => {
    const out = await preview({ user, from, to, currency: cur || undefined }).unwrap();
    setCurrency(out.currency || cur);
    setLines([...out.lines, ...lines.filter((l) => ["bonus", "deduction", "other"].includes(l.kind))]);
    setFilled(true);
  };

  const setLine = (i, patch) => setLines(lines.map((l, j) => {
    if (j !== i) return l;
    const next = { ...l, ...patch };
    if (("quantity" in patch || "rate" in patch) && next.quantity !== null && next.rate !== null && next.quantity !== "" && next.rate !== "") {
      next.amount = next.kind === "sales" ? next.amount : Math.round(Number(next.quantity) * Number(next.rate) * 100) / 100;
    }
    return next;
  }));

  const save = async (issue) => {
    const body = { from, to, currency: cur, lines, note };
    if (slip) {
      await update({ id: slip._id, ...body }).unwrap();
      onSaved(slip._id);
    } else {
      const made = await create({ ...body, user, issue }).unwrap();
      onSaved(made._id);
    }
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog stack" style={{ maxWidth: 720 }}>
        <div className="spread">
          <h3 style={{ margin: 0 }}>{slip ? `Edit ${slip.number}` : "New payslip"}</h3>
          <button className="btn btn-quiet btn-sm" onClick={onClose} aria-label="Close"><X size={15} /></button>
        </div>

        {!slip && (
          <Field label="Team member">
            <PersonPicker people={people} value={user} onChange={(id) => { setUser(id); setFilled(false); }} />
          </Field>
        )}

        <div className="row-tight" style={{ flexWrap: "wrap" }}>
          {PERIODS.map(([k, l, fn]) => (
            <button key={k} className="pill pill-btn" onClick={() => { const [f, t] = fn(); setFrom(f); setTo(t); setFilled(false); }}>{l}</button>
          ))}
          <input className="input" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setFilled(false); }} aria-label="From" />
          <span className="muted small">to</span>
          <input className="input" type="date" value={to} onChange={(e) => { setTo(e.target.value); setFilled(false); }} aria-label="To" />
          <input className="input" value={cur} onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))} style={{ width: 70 }} aria-label="Currency" placeholder="BDT" />
        </div>

        {!slip && (
          <div className="row-tight">
            <button className="btn btn-quiet" disabled={!user || filling} onClick={fill}>
              <Sparkles size={14} /> {filling ? "Working it out…" : filled ? "Fill again from activity" : "Fill from activity"}
            </button>
            <span className="muted small">Grading, live classes, doubts answered and sales commission in this period.</span>
          </div>
        )}
        <ErrorNote error={fillError} />
        {filled && lines.length === 0 && <p className="hint" style={{ margin: 0 }}>Nothing earned in this period. Add a line by hand if you're paying anyway.</p>}

        {lines.length > 0 && (
          <div className="stack" style={{ gap: 6 }}>
            {lines.map((l, i) => (
              <div key={i} className="row-tight" style={{ flexWrap: "wrap", gap: 6 }}>
                <select className="select" value={l.kind} onChange={(e) => setLine(i, { kind: e.target.value })} style={{ width: 130 }}>
                  {KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
                <input className="input" value={l.label} onChange={(e) => setLine(i, { label: e.target.value })} placeholder="What it's for" style={{ flex: 1, minWidth: 160 }} />
                <input className="input tnum" type="number" value={l.quantity ?? ""} onChange={(e) => setLine(i, { quantity: e.target.value === "" ? null : Number(e.target.value) })} placeholder="Qty" style={{ width: 70 }} />
                <input className="input tnum" type="number" value={l.rate ?? ""} onChange={(e) => setLine(i, { rate: e.target.value === "" ? null : Number(e.target.value) })} placeholder={l.kind === "sales" ? "%" : "Rate"} style={{ width: 80 }} />
                <input className="input tnum" type="number" value={l.amount} onChange={(e) => setLine(i, { amount: e.target.value })} placeholder="Amount" style={{ width: 110 }} />
                <button className="btn btn-quiet btn-sm" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Remove line"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        )}

        <div className="row-tight" style={{ flexWrap: "wrap" }}>
          <button className="btn btn-sm btn-quiet" onClick={() => setLines([...lines, { kind: "bonus", label: "Bonus", quantity: null, rate: null, amount: 0 }])}><Plus size={13} /> Bonus</button>
          <button className="btn btn-sm btn-quiet" onClick={() => setLines([...lines, { kind: "deduction", label: "Deduction", quantity: null, rate: null, amount: 0 }])}><Plus size={13} /> Deduction</button>
          <button className="btn btn-sm btn-quiet" onClick={() => setLines([...lines, { kind: "other", label: "", quantity: null, rate: null, amount: 0 }])}><Plus size={13} /> Other line</button>
          <span className="grow" />
          <strong className="tnum">Total {money(total, cur || "")}</strong>
        </div>

        <Field label="Note" hint="Shown to the team member.">
          <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>

        <ErrorNote error={createError || updateError} />
        <div className="row-tight" style={{ gap: 8, justifyContent: "flex-end" }}>
          <button className="btn btn-quiet" onClick={onClose}>Cancel</button>
          {slip ? (
            <button className="btn" disabled={updating || !lines.length} onClick={() => save(false)}>{updating ? "Saving…" : "Save"}</button>
          ) : (
            <>
              <button className="btn btn-quiet" disabled={creating || !user || !lines.length} onClick={() => save(false)}>Save draft</button>
              <button className="btn" disabled={creating || !user || !lines.length} onClick={() => save(true)}><Send size={14} /> Issue</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PayslipDialog({ id, people, onClose }) {
  const confirm = useConfirm();
  const { data: slip, isLoading, error } = useGetPayslipQuery(id);
  const [issue, { isLoading: issuing, error: issueError }] = useIssuePayslipMutation();
  const [remove, { error: removeError }] = useDeletePayslipMutation();
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);

  if (editing && slip) return <PayslipEditor people={people} slip={slip} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />;

  const editable = slip && ["draft", "issued", "disputed"].includes(slip.status);

  return (
    <div className="overlay" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog stack" style={{ maxWidth: 680 }}>
        <div className="spread no-print">
          <h3 style={{ margin: 0 }}>Payslip</h3>
          <button className="btn btn-quiet btn-sm" onClick={onClose} aria-label="Close"><X size={15} /></button>
        </div>
        <ErrorNote error={error || issueError || removeError} />
        {isLoading || !slip ? <Loading /> : (
          <>
            <PayslipSheet slip={slip} />
            {paying ? <PayForm slip={slip} onDone={() => setPaying(false)} /> : (
              <div className="row-tight no-print" style={{ gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                {editable && (
                  <button className="btn btn-quiet" onClick={async () => {
                    if (await confirm({ title: "Delete this payslip?", body: "It hasn't been paid, so nothing else changes.", confirmLabel: "Delete", tone: "danger" })) {
                      await remove(slip._id).unwrap();
                      onClose();
                    }
                  }}><Trash2 size={14} /> Delete</button>
                )}
                <button className="btn btn-quiet" onClick={() => window.print()}><Printer size={14} /> Print</button>
                {editable && <button className="btn btn-quiet" onClick={() => setEditing(true)}>Edit</button>}
                {["draft", "disputed"].includes(slip.status) && (
                  <button className="btn btn-quiet" disabled={issuing} onClick={() => issue(slip._id)}><Send size={14} /> {slip.status === "disputed" ? "Re-issue" : "Issue"}</button>
                )}
                {editable && <button className="btn" onClick={() => setPaying(true)}><Check size={14} /> Mark paid</button>}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PayForm({ slip, onDone }) {
  const [method, setMethod] = useState("bKash");
  const [reference, setReference] = useState("");
  const [paidAt, setPaidAt] = useState(ymd(new Date()));
  const [proofUrl, setProofUrl] = useState("");
  const [pay, { isLoading, error }] = usePayPayslipMutation();
  const [upload, { isLoading: uploading, error: uploadError }] = useUploadPayslipProofMutation();

  return (
    <div className="card-quiet stack no-print">
      <strong>Record the payment</strong>
      <div className="row" style={{ flexWrap: "wrap", gap: 10 }}>
        <Field label="Method">
          <input className="input" list="pay-methods" value={method} onChange={(e) => setMethod(e.target.value)} style={{ width: 150 }} />
          <datalist id="pay-methods">{["bKash", "Nagad", "Rocket", "Bank transfer", "Cash", "PayPal", "Wise"].map((m) => <option key={m} value={m} />)}</datalist>
        </Field>
        <Field label="Transaction ID / reference">
          <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} style={{ width: 200 }} />
        </Field>
        <Field label="Paid on">
          <input className="input" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
        </Field>
      </div>
      <div className="row-tight" style={{ flexWrap: "wrap" }}>
        <label className="btn btn-quiet btn-sm" style={{ cursor: "pointer" }}>
          <Upload size={13} /> {uploading ? "Uploading…" : proofUrl ? "Change proof picture" : "Add proof picture"}
          <input type="file" accept="image/*" hidden onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) setProofUrl((await upload(file).unwrap()).url);
          }} />
        </label>
        {proofUrl && <img src={proofUrl} alt="Payment proof" style={{ height: 48, borderRadius: 6, border: "1px solid var(--border)" }} />}
      </div>
      <ErrorNote error={error || uploadError} />
      <div className="row-tight" style={{ gap: 8, justifyContent: "flex-end" }}>
        <button className="btn btn-quiet" onClick={onDone}>Cancel</button>
        <button className="btn" disabled={isLoading || uploading || !method.trim()} onClick={async () => {
          await pay({ id: slip._id, method, reference, paidAt, proofUrl: proofUrl || undefined }).unwrap();
          onDone();
        }}><Check size={14} /> {isLoading ? "Saving…" : `Paid ${money(slip.total, slip.currency)}`}</button>
      </div>
    </div>
  );
}
