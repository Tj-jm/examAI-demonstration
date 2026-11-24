import { useState } from "react";
import { useGetRepresentativesQuery, useGetTeamSellersQuery, useGetTeamDoubtSolversQuery } from "../api/contentApi";
import { Users, BadgePercent, HelpCircle, UserRound } from "lucide-react";
import { ErrorNote } from "./bits";
import SearchSelect from "./SearchSelect";

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
const PRESETS = [
  ["7d", "7 days", () => [ymd(daysAgo(6)), ymd(new Date())]],
  ["30d", "30 days", () => [ymd(daysAgo(29)), ymd(new Date())]],
  ["month", "This month", () => { const d = new Date(); return [ymd(new Date(d.getFullYear(), d.getMonth(), 1)), ymd(d)]; }],
  ["lastMonth", "Last month", () => { const d = new Date(); return [ymd(new Date(d.getFullYear(), d.getMonth() - 1, 1)), ymd(new Date(d.getFullYear(), d.getMonth(), 0))]; }],
  ["year", "This year", () => [ymd(new Date(new Date().getFullYear(), 0, 1)), ymd(new Date())]],
  ["all", "All time", () => ["", ""]],
];
const presetRange = (key) => PRESETS.find(([k]) => k === key)[2]();

// Team pay: sellers' sales and commission, doubt solvers' answered doubts
// and pay (backend utils/teamPay.js). Each tab has its own person and date
// range, separate from the page filters. Rates: Settings → Grading.
export default function TeamPay({ money, Table }) {
  const [tab, setTab] = useState("sellers");
  return (
    <div className="card stack">
      <div className="spread" style={{ flexWrap: "wrap", gap: 8 }}>
        <div className="row-tight"><Users size={16} className="muted" /><h2 style={{ fontSize: 15 }}>Team</h2></div>
        <div className="row-tight">
          {[["sellers", "Sellers", BadgePercent], ["doubts", "Doubt solvers", HelpCircle]].map(([key, label, Icon]) => (
            <button key={key} className={`pill pill-btn row-tight${tab === key ? " pill-on" : ""}`} style={{ gap: 5 }} onClick={() => setTab(key)}>
              <Icon size={12} /> {label}
            </button>
          ))}
        </div>
      </div>
      {tab === "sellers" ? <SellersTab money={money} Table={Table} /> : <DoubtSolversTab money={money} Table={Table} />}
    </div>
  );
}

function useRange() {
  const [preset, setPreset] = useState("month");
  const [from, setFrom] = useState(() => presetRange("month")[0]);
  const [to, setTo] = useState(() => presetRange("month")[1]);
  const pick = (key) => { const [f, t] = presetRange(key); setPreset(key); setFrom(f); setTo(t); };
  const bar = (
    <div className="row-tight" style={{ flexWrap: "wrap" }}>
      {PRESETS.map(([key, label]) => (
        <button key={key} className={`pill pill-btn${preset === key ? " pill-on" : ""}`} onClick={() => pick(key)}>{label}</button>
      ))}
      <input className="input" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPreset(""); }} aria-label="From" />
      <span className="muted small">to</span>
      <input className="input" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPreset(""); }} aria-label="To" />
    </div>
  );
  return { from: from || undefined, to: to || undefined, bar };
}

function Initials({ name }) {
  const text = String(name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return (
    <span style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--primary-soft, var(--surface-2, var(--border)))", color: "var(--primary)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
      {text || <UserRound size={13} />}
    </span>
  );
}

function Tile({ label, value, sub }) {
  return (
    <div className="card-quiet stack" style={{ gap: 2, padding: "10px 14px", borderLeft: "3px solid var(--primary)" }}>
      <span className="muted small">{label}</span>
      <strong style={{ fontSize: 19 }} className="tnum">{value}</strong>
      {sub && <span className="muted small">{sub}</span>}
    </div>
  );
}

function ShareBar({ value, max }) {
  return (
    <div style={{ height: 6, borderRadius: 3, background: "var(--border)", minWidth: 60 }}>
      <div style={{ width: `${max ? Math.max(2, (value / max) * 100) : 0}%`, height: "100%", borderRadius: 3, background: "var(--primary)" }} />
    </div>
  );
}

function SellersTab({ money, Table }) {
  const { from, to, bar } = useRange();
  const [seller, setSeller] = useState("");
  const { data: reps } = useGetRepresentativesQuery();
  const { data, isFetching, error } = useGetTeamSellersQuery({ from, to, seller: seller || undefined });
  const rows = data?.rows || [];
  const totals = new Map();
  for (const r of rows) for (const t of r.totals) {
    const e = totals.get(t.currency) || { revenue: 0, commission: 0, count: 0 };
    e.revenue += t.revenue; e.commission += t.commission || 0; e.count += t.count;
    totals.set(t.currency, e);
  }
  const max = Math.max(0, ...rows.map((r) => r.sales));
  return (
    <div className="stack">
      <div className="row-tight" style={{ flexWrap: "wrap" }}>
        <select className="select" value={seller} onChange={(e) => setSeller(e.target.value)}>
          <option value="">Every seller</option>
          {(reps || []).map((r) => <option key={r._id} value={r._id}>{r.name}</option>)}
        </select>
        {bar}
        {isFetching && <span className="muted small">Updating…</span>}
      </div>
      <ErrorNote error={error} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
        <Tile label="Sales" value={[...totals.values()].reduce((n, t) => n + t.count, 0)} sub={seller ? "This seller" : `${rows.length} seller${rows.length === 1 ? "" : "s"}`} />
        {[...totals.entries()].map(([cur, t]) => (
          <Tile key={cur} label={`Revenue · ${cur}`} value={money(t.revenue, cur)} sub={data?.sellerPercent ? `Commission ${money(t.commission, cur)} (${data.sellerPercent}%)` : "Set a commission in Settings → Grading"} />
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="hint" style={{ margin: 0 }}>No sellers yet. Invite a representative from Team.</p>
      ) : (
        <Table
          headers={["Seller", "Sales", "Share", "Revenue", "Discount given", "Commission"]}
          rows={rows.map((r) => [
            <span key="n" className="row-tight" style={{ gap: 8 }}><Initials name={r.user.name} /><span>{r.user.name}{r.user.isActive === false && <span className="muted small"> · inactive</span>}</span></span>,
            r.sales,
            <ShareBar key="b" value={r.sales} max={max} />,
            r.totals.length ? r.totals.map((t) => money(t.revenue, t.currency)).join(" · ") : "—",
            r.totals.length ? r.totals.map((t) => money(t.discount, t.currency)).join(" · ") : "—",
            r.totals.length && data.sellerPercent ? r.totals.map((t) => money(t.commission, t.currency)).join(" · ") : "—",
          ])}
        />
      )}
    </div>
  );
}

function DoubtSolversTab({ money, Table }) {
  const { from, to, bar } = useRange();
  const [solver, setSolver] = useState("");
  const { data: all } = useGetTeamDoubtSolversQuery({});
  const { data, isFetching, error } = useGetTeamDoubtSolversQuery({ from, to, solver: solver || undefined });
  const rows = data?.rows || [];
  const answered = rows.reduce((n, r) => n + r.answered, 0);
  const max = Math.max(0, ...rows.map((r) => r.answered));
  const cur = data?.currency || "";
  return (
    <div className="stack">
      <div className="row-tight" style={{ flexWrap: "wrap" }}>
        <SearchSelect className="select" value={solver} onChange={(e) => setSolver(e.target.value)}>
          <option value="">Every doubt solver</option>
          {(all?.rows || []).map((r) => <option key={r.user._id} value={r.user._id}>{r.user.identifier || r.user.name}</option>)}
        </SearchSelect>
        {bar}
        {isFetching && <span className="muted small">Updating…</span>}
      </div>
      <ErrorNote error={error} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
        <Tile label="Doubts answered" value={answered} sub={solver ? "This doubt solver" : `${rows.length} people`} />
        <Tile label="Pay" value={data?.doubtRate ? money(answered * data.doubtRate, cur) : "—"} sub={data?.doubtRate ? `${money(data.doubtRate, cur)} per doubt` : "Set a rate in Settings → Grading"} />
      </div>
      {rows.length === 0 ? (
        <p className="hint" style={{ margin: 0 }}>No doubt solvers yet.</p>
      ) : (
        <Table
          headers={["Doubt solver", "Answered", "Share", "Pay"]}
          rows={rows.map((r) => [
            <span key="n" className="row-tight" style={{ gap: 8 }}><Initials name={r.user.identifier || r.user.name} /><span>{r.user.identifier || r.user.name}{r.user.role !== "doubtSolver" && <span className="muted small"> · {r.user.role}</span>}</span></span>,
            r.answered,
            <ShareBar key="b" value={r.answered} max={max} />,
            r.amount != null ? money(r.amount, cur) : "—",
          ])}
        />
      )}
    </div>
  );
}
