import { Fragment, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Save } from "lucide-react";
import { useGetClassPayQuery, useGetMyClassPayQuery, useSetClassRateMutation } from "../api/payslipApi";
import { useGetSettingsQuery, useUpdateSettingsMutation } from "../api/contentApi";
import { Loading, ErrorNote, Field } from "./bits";
import { money, ROLE_LABEL } from "./PayslipSheet";

// Class pay (backend utils/classPay.js): each teacher's rate for live
// classes, the rules every class is paid by, and what each class earned.
// Payslips → Class pay for owner and admin; My payslips → My classes for a
// teacher, read only.

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const PERIODS = [
  ["month", "This month", () => { const d = new Date(); return [ymd(new Date(d.getFullYear(), d.getMonth(), 1)), ymd(d)]; }],
  ["lastMonth", "Last month", () => { const d = new Date(); return [ymd(new Date(d.getFullYear(), d.getMonth() - 1, 1)), ymd(new Date(d.getFullYear(), d.getMonth(), 0))]; }],
  ["2w", "Last 2 weeks", () => { const d = new Date(); const s = new Date(); s.setDate(d.getDate() - 13); return [ymd(s), ymd(d)]; }],
];

const OUTCOME = {
  paid: ["Paid", "pill-ok"],
  short: ["Too short", ""],
  empty: ["No students", ""],
  lateCancel: ["Cancelled late", "pill-warn"],
  cancelled: ["Cancelled", ""],
  noShow: ["Didn't join", "pill-bad"],
  notHeld: ["Not held", ""],
  upcoming: ["Upcoming", ""],
  live: ["Live now", "pill-warn"],
};

const hours = (minutes) => `${Math.round((minutes / 60) * 100) / 100} h`;
const when = (d) => new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function usePeriod() {
  const [key, setKey] = useState("month");
  const [[from, to], setRange] = useState(() => PERIODS[0][2]());
  const bar = (
    <div className="row-tight" style={{ flexWrap: "wrap" }}>
      {PERIODS.map(([k, label, fn]) => (
        <button key={k} className={`pill pill-btn${key === k ? " pill-on" : ""}`} onClick={() => { setKey(k); setRange(fn()); }}>{label}</button>
      ))}
      <input className="input" type="date" value={from} onChange={(e) => { setKey(""); setRange([e.target.value, to]); }} aria-label="From" />
      <span className="muted small">to</span>
      <input className="input" type="date" value={to} onChange={(e) => { setKey(""); setRange([from, e.target.value]); }} aria-label="To" />
    </div>
  );
  return { from: from || undefined, to: to || undefined, bar };
}

// One person's classes in the period: length, where it came from, pay.
export function ClassList({ classes, mode, currency }) {
  if (!classes?.length) return <p className="hint" style={{ margin: 0 }}>No classes in this period.</p>;
  const cell = { padding: "7px 8px", borderBottom: "1px solid var(--border)" };
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            {["Class", "When", "Scheduled", "Ran", mode === "hour" ? "Paid time" : null, "", "Pay"].filter((h) => h !== null).map((h, i) => (
              <th key={i} style={{ ...cell, textAlign: "left", color: "var(--text-muted)", fontWeight: 500 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {classes.map((c) => {
            const [label, cls] = OUTCOME[c.outcome] || [c.outcome, ""];
            return (
              <tr key={c._id}>
                <td style={cell}><strong>{c.title}</strong>{c.batch?.name && <span className="muted small"> · {c.batch.name}</span>}</td>
                <td style={cell} className="small">{when(c.scheduledAt)}</td>
                <td style={cell} className="tnum small">{c.scheduledMinutes} min</td>
                <td style={cell} className="tnum small">{c.minutes != null ? <span title={`From ${c.source}`}>{c.minutes} min{c.source === "scheduled" ? " *" : ""}</span> : "—"}</td>
                {mode === "hour" && <td style={cell} className="tnum small">{c.paidMinutes ? hours(c.paidMinutes) : "—"}</td>}
                <td style={cell}><span className={`pill ${cls}`}>{label}</span></td>
                <td style={{ ...cell, color: c.amount < 0 ? "var(--incorrect)" : undefined }} className="tnum">{c.amount ? money(c.amount, currency) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {classes.some((c) => c.source === "scheduled") && (
        <p className="hint" style={{ margin: "6px 0 0" }}>* No real start and end was recorded, so the scheduled length is used.</p>
      )}
    </div>
  );
}

function Totals({ row, currency }) {
  const t = row.totals;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
      <div className="card-quiet stack" style={{ gap: 2, padding: "10px 14px", borderLeft: "3px solid var(--primary)" }}>
        <span className="muted small">Classes paid</span>
        <strong style={{ fontSize: 19 }} className="tnum">{t.paid}</strong>
        {row.mode === "hour" && <span className="muted small">{hours(t.paidMinutes)}</span>}
      </div>
      <div className="card-quiet stack" style={{ gap: 2, padding: "10px 14px", borderLeft: "3px solid var(--correct)" }}>
        <span className="muted small">Pay</span>
        <strong style={{ fontSize: 19 }} className="tnum">{money(t.amount, currency)}</strong>
        <span className="muted small">{row.rate ? `${money(row.rate, currency)} per ${row.mode}` : "No rate set"}</span>
      </div>
      {(t.lateCancel > 0 || t.noShow > 0) && (
        <div className="card-quiet stack" style={{ gap: 2, padding: "10px 14px", borderLeft: "3px solid var(--warning)" }}>
          <span className="muted small">Also counted</span>
          {t.lateCancel > 0 && <span className="small">{t.lateCancel} cancelled late · {money(t.lateCancelAmount, currency)}</span>}
          {t.noShow > 0 && <span className="small">{t.noShow} not joined · {money(t.noShowAmount, currency)}</span>}
        </div>
      )}
    </div>
  );
}

// The rules every class is paid by (settings.classPay).
function Rules({ onSaved }) {
  const { data: settings, isLoading } = useGetSettingsQuery();
  const [update, { isLoading: saving, error, isSuccess }] = useUpdateSettingsMutation();
  const [form, setForm] = useState(null);
  useEffect(() => {
    if (settings && !form) {
      setForm({ minMinutes: 10, payEmpty: true, roundMinutes: 15, graceMinutes: 15, lateCancelHours: 2, lateCancelPercent: 0, noShowDeduction: 0, ...(settings.classPay || {}) });
    }
  }, [settings, form]);
  if (isLoading || !form) return <Loading />;
  const set = (k, v) => setForm({ ...form, [k]: v });
  const cur = settings?.defaultCurrency || "";
  const num = (k, props) => <input className="input tnum" type="number" min="0" style={{ width: 100 }} value={form[k]} onChange={(e) => set(k, e.target.value)} {...props} />;

  return (
    <div className="card stack">
      <h2 style={{ fontSize: 15 }}>Rules</h2>
      <p className="hint" style={{ margin: 0 }}>Apply to every class. Each teacher's rate, and whether they get overtime, is set below.</p>
      <div className="row" style={{ flexWrap: "wrap", gap: 14 }}>
        <Field label="Shortest class paid (minutes)" hint="A class that ran shorter isn't paid.">{num("minMinutes", { max: 600 })}</Field>
        <Field label="Round hourly time to" hint="Each class, to the nearest step.">
          <select className="select" value={form.roundMinutes} onChange={(e) => set("roundMinutes", Number(e.target.value))}>
            {[1, 5, 15, 30].map((m) => <option key={m} value={m}>{m === 1 ? "the minute" : `${m} minutes`}</option>)}
          </select>
        </Field>
        <Field label="Extra time paid without overtime (minutes)" hint="A class pays at most its scheduled length plus this, unless the teacher gets overtime.">{num("graceMinutes", { max: 600 })}</Field>
      </div>
      <label className="row-tight" style={{ cursor: "pointer", gap: 8 }}>
        <input type="checkbox" checked={Boolean(form.payEmpty)} onChange={(e) => set("payEmpty", e.target.checked)} />
        <span className="small">Pay for a class no student joined</span>
      </label>
      <div className="row" style={{ flexWrap: "wrap", gap: 14 }}>
        <Field label="Cancelled late: within (hours)" hint="Of the start time.">{num("lateCancelHours", { max: 168, step: 0.5 })}</Field>
        <Field label="…pays (% of the class)" hint="0: a cancelled class isn't paid.">{num("lateCancelPercent", { max: 100 })}</Field>
        <Field label={`Taken off when a teacher doesn't join${cur ? ` (${cur})` : ""}`} hint="In-app classes only, where joining is recorded. 0: nothing taken off.">{num("noShowDeduction", { step: 0.01 })}</Field>
      </div>
      <ErrorNote error={error} />
      <div className="row-tight" style={{ gap: 8 }}>
        <button className="btn" disabled={saving} onClick={async () => {
          await update({ classPay: { ...form } }).unwrap();
          onSaved?.();
        }}>{saving ? "Saving…" : "Save rules"}</button>
        {isSuccess && !saving && <span className="small muted">Saved.</span>}
      </div>
    </div>
  );
}

// A teacher's rate, edited in place.
function RateCells({ row, currency }) {
  const [setRate, { isLoading, error }] = useSetClassRateMutation();
  const [form, setForm] = useState({ mode: row.mode, rate: row.rate, overtime: row.overtime });
  useEffect(() => { setForm({ mode: row.mode, rate: row.rate, overtime: row.overtime }); }, [row.mode, row.rate, row.overtime]);
  const changed = form.mode !== row.mode || Number(form.rate) !== row.rate || form.overtime !== row.overtime;
  return (
    <>
      <td style={{ padding: "8px" }} onClick={(e) => e.stopPropagation()}>
        <div className="row-tight" style={{ gap: 6, flexWrap: "wrap" }}>
          <input className="input tnum" type="number" min="0" step="0.01" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} style={{ width: 90 }} aria-label={`Rate (${currency})`} />
          <select className="select" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })} aria-label="Paid by">
            <option value="hour">per hour</option>
            <option value="class">per class</option>
          </select>
          {changed && (
            <button className="btn btn-sm" disabled={isLoading} onClick={() => setRate({ userId: row.user._id, ...form, rate: Number(form.rate) || 0 })}>
              <Save size={13} /> Save
            </button>
          )}
        </div>
        <ErrorNote error={error} />
      </td>
      <td style={{ padding: "8px" }} onClick={(e) => e.stopPropagation()}>
        <label className="row-tight small" style={{ cursor: form.mode === "hour" ? "pointer" : "default", gap: 6 }} title={form.mode === "class" ? "Per-class pay doesn't depend on length." : undefined}>
          <input type="checkbox" checked={Boolean(form.overtime)} disabled={form.mode === "class"} onChange={(e) => setForm({ ...form, overtime: e.target.checked })} />
          Overtime
        </label>
      </td>
    </>
  );
}

// Payslips → Class pay.
export default function ClassPayAdmin() {
  const { from, to, bar } = usePeriod();
  const { data, isLoading, isFetching, error, refetch } = useGetClassPayQuery({ from, to });
  const [open, setOpen] = useState(null);
  const [role, setRole] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("role");
  const cur = data?.rules?.currency || "";
  const all = data?.rows || [];
  // Narrow by role, search by name or email, then sort.
  const ROLES = ["teacher", "admin", "owner"];
  const needle = q.trim().toLowerCase();
  const SORTS = {
    role: (a, b) => ROLES.indexOf(a.user.role) - ROLES.indexOf(b.user.role) || String(a.user.name).localeCompare(String(b.user.name)),
    name: (a, b) => String(a.user.name).localeCompare(String(b.user.name)),
    pay: (a, b) => b.totals.amount - a.totals.amount,
    classes: (a, b) => b.totals.paid - a.totals.paid,
    rate: (a, b) => b.rate - a.rate,
  };
  const rows = all
    .filter((r) => (!role || (role === "unset" ? !r.rate : r.user.role === role)) && (!needle || `${r.user.name} ${r.user.email || ""}`.toLowerCase().includes(needle)))
    .sort(SORTS[sort]);
  const cell = { padding: "8px", borderBottom: "1px solid var(--border)" };

  return (
    <div className="stack">
      <Rules onSaved={refetch} />
      <div className="card stack">
        <div className="spread" style={{ flexWrap: "wrap", gap: 8 }}>
          <h2 style={{ fontSize: 15 }}>Teachers</h2>
          {isFetching && <span className="muted small">Updating…</span>}
        </div>
        <p className="hint" style={{ margin: 0 }}>
          Everyone on a class (its host and its teachers) gets full pay at their own rate{cur ? `, in ${cur}` : ""}. Rate 0: not paid for classes.
          New payslip → Fill from activity adds these classes.
        </p>
        {bar}
        <div className="row-tight" style={{ flexWrap: "wrap", gap: 6 }}>
          <button className={`pill pill-btn${!role ? " pill-on" : ""}`} onClick={() => setRole("")}>All {all.length}</button>
          {ROLES.filter((r) => all.some((x) => x.user.role === r)).map((r) => (
            <button key={r} className={`pill pill-btn${role === r ? " pill-on" : ""}`} onClick={() => setRole(r)}>
              {ROLE_LABEL[r]} {all.filter((x) => x.user.role === r).length}
            </button>
          ))}
          {all.some((x) => !x.rate) && (
            <button className={`pill pill-btn${role === "unset" ? " pill-on" : ""}`} onClick={() => setRole("unset")}>No rate {all.filter((x) => !x.rate).length}</button>
          )}
          <input className="input" placeholder="Search by name or email" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 240 }} />
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
            <option value="role">Sort: role, then name</option>
            <option value="name">Sort: name</option>
            <option value="pay">Sort: pay, highest first</option>
            <option value="classes">Sort: classes, most first</option>
            <option value="rate">Sort: rate, highest first</option>
          </select>
        </div>
        <ErrorNote error={error} />
        {isLoading ? <Loading /> : !all.length ? <p className="hint" style={{ margin: 0 }}>No teachers yet.</p> : !rows.length ? <p className="hint" style={{ margin: 0 }}>No one matches.</p> : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
              <thead>
                <tr>
                  {["Teacher", "Rate", "", "Classes paid", "Time paid", "Pay"].map((h, i) => (
                    <th key={i} style={{ ...cell, textAlign: "left", color: "var(--text-muted)", fontWeight: 500 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isOpen = open === String(r.user._id);
                  return (
                    <Fragment key={r.user._id}>
                      <tr onClick={() => setOpen(isOpen ? null : String(r.user._id))} style={{ cursor: "pointer" }}>
                        <td style={cell}>
                          <span className="row-tight" style={{ gap: 6 }}>
                            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            <strong>{r.user.name}</strong>
                            <span className="muted small">· {ROLE_LABEL[r.user.role] || r.user.role}{r.user.isActive === false ? " · inactive" : ""}</span>
                          </span>
                        </td>
                        <RateCells row={r} currency={cur} />
                        <td style={cell} className="tnum">{r.totals.paid}</td>
                        <td style={cell} className="tnum">{r.mode === "hour" ? hours(r.totals.paidMinutes) : "—"}</td>
                        <td style={cell} className="tnum"><strong>{money(r.totals.amount, cur)}</strong></td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={6} style={{ ...cell, background: "var(--surface-alt, transparent)" }}>
                            <ClassList classes={r.classes} mode={r.mode} currency={cur} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// My payslips → My classes: a teacher's own classes and what they come to,
// before any payslip.
export function MyClassPay() {
  const { from, to, bar } = usePeriod();
  const { data, isLoading, error } = useGetMyClassPayQuery({ from, to });
  const row = data?.row;
  const cur = data?.rules?.currency || "";
  if (!isLoading && (!row || (!row.rate && !row.classes.length))) return null;
  return (
    <div className="card stack">
      <h2 style={{ fontSize: 15 }}>My classes</h2>
      <p className="hint" style={{ margin: 0 }}>What your live classes come to so far. The payslip an admin issues is what's paid.</p>
      {bar}
      <ErrorNote error={error} />
      {isLoading || !row ? <Loading /> : (
        <>
          <Totals row={row} currency={cur} />
          <ClassList classes={row.classes} mode={row.mode} currency={cur} />
        </>
      )}
    </div>
  );
}
