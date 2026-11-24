import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import {
  useGetEarningsSummaryQuery, useGetEarningsSourcesQuery, useGetEarningsTrendQuery,
  useGetEarningsTransactionsQuery, useGetEarningsOptionsQuery, useGetBatchesQuery, useGetRepresentativesQuery,
} from "../api/contentApi";
import { DollarSign, Download, Sparkles, Users, CreditCard, Compass, TrendingUp, Receipt, Search } from "lucide-react";
import { Loading, ErrorNote, Empty, Pager, pageSlice } from "../components/bits";
import { useTerms } from "../terms";
import TeamPay from "../components/TeamPay";
import SearchSelect from "../components/SearchSelect";

const money = (amount, currency) =>
  `${currency} ${Number(amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const buildQuery = (params) => {
  const clean = Object.entries(params).filter(([, v]) => v !== undefined && v !== "");
  return clean.length ? `?${new URLSearchParams(Object.fromEntries(clean))}` : "";
};

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };

// Quick ranges. The page opens on the last 30 days so a large store never
// sums its whole history just to show the first screen.
const PRESETS = [
  ["today", "Today", () => [ymd(new Date()), ymd(new Date())]],
  ["7d", "7 days", () => [ymd(daysAgo(6)), ymd(new Date())]],
  ["30d", "30 days", () => [ymd(daysAgo(29)), ymd(new Date())]],
  ["month", "This month", () => { const d = new Date(); return [ymd(new Date(d.getFullYear(), d.getMonth(), 1)), ymd(d)]; }],
  ["lastMonth", "Last month", () => { const d = new Date(); return [ymd(new Date(d.getFullYear(), d.getMonth() - 1, 1)), ymd(new Date(d.getFullYear(), d.getMonth(), 0))]; }],
  ["year", "This year", () => [ymd(new Date(new Date().getFullYear(), 0, 1)), ymd(new Date())]],
  ["all", "All time", () => ["", ""]],
];
const presetRange = (key) => PRESETS.find(([k]) => k === key)[2]();

// Owner/admin only — see routes/admin/earningsRoutes.js. This page is not
// reachable at all for any other role: the nav link itself is hidden (see
// layout/Shell.jsx's roles filter), and this component re-checks on its own
// rather than trusting the nav to be the only thing standing in the way,
// since a role-restricted route the frontend still renders full financial
// tables into is a strictly worse failure than a route that isn't linked.
export default function Earnings() {
  const terms = useTerms();
  const { me } = useOutletContext();
  const [preset, setPreset] = useState("30d");
  const [from, setFrom] = useState(() => presetRange("30d")[0]);
  const [to, setTo] = useState(() => presetRange("30d")[1]);
  const [batch, setBatch] = useState("");
  const [kind, setKind] = useState("");
  const [provider, setProvider] = useState("");
  const [currency, setCurrency] = useState("");
  const [coupon, setCoupon] = useState("");
  const [seller, setSeller] = useState("");

  const allowed = ["owner", "admin"].includes(me.role);
  const params = {
    from: from || undefined, to: to || undefined, batch: batch || undefined, kind: kind || undefined,
    provider: provider || undefined, currency: currency || undefined, coupon: coupon.trim() || undefined,
    seller: seller || undefined,
  };
  const { data, isLoading, isFetching, error } = useGetEarningsSummaryQuery(params, { skip: !allowed });
  const { data: sources } = useGetEarningsSourcesQuery(params, { skip: !allowed });
  const { data: trend } = useGetEarningsTrendQuery(params, { skip: !allowed });
  const { data: options } = useGetEarningsOptionsQuery(undefined, { skip: !allowed });
  const { data: batches } = useGetBatchesQuery({});
  const { data: reps } = useGetRepresentativesQuery(undefined, { skip: !allowed });

  const pickPreset = (key) => {
    const [f, t] = presetRange(key);
    setPreset(key);
    setFrom(f);
    setTo(t);
  };
  const filtered = batch || kind || provider || currency || coupon || seller;
  const clearFilters = () => { setBatch(""); setKind(""); setProvider(""); setCurrency(""); setCoupon(""); setSeller(""); };

  if (!allowed) {
    return (
      <div className="page">
        <Empty icon={DollarSign} title="Not available" hint="This page is limited to owner and admin accounts." />
      </div>
    );
  }

  // A plain link, not a fetch+blob dance — this is a normal same-origin
  // browser download and the session cookie rides along automatically,
  // exactly like any other navigation to this API.
  const exportUrl = `/api/earnings/export${buildQuery(params)}`;

  return (
    <div className="page">
      <div className="page-head spread">
        <div>
          <h1>Earnings</h1>
          <p className="muted small" style={{ margin: "2px 0 0" }}>
            Revenue from completed purchases — refunded and pending ones are never counted.
          </p>
        </div>
        <a className="btn" href={exportUrl} target="_blank" rel="noreferrer">
          <Download size={15} /> Export as Excel
        </a>
      </div>

      <div className="stack">
        <div className="row-tight" style={{ flexWrap: "wrap" }}>
          {PRESETS.map(([key, label]) => (
            <button key={key} className={`pill pill-btn${preset === key ? " pill-on" : ""}`} onClick={() => pickPreset(key)}>
              {label}
            </button>
          ))}
          <label className="row-tight small">
            From
            <input className="input" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPreset(""); }} style={{ marginLeft: 6 }} />
          </label>
          <label className="row-tight small">
            To
            <input className="input" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPreset(""); }} style={{ marginLeft: 6 }} />
          </label>
        </div>
        <div className="row-tight" style={{ flexWrap: "wrap" }}>
          <SearchSelect className="select" value={batch} onChange={(e) => setBatch(e.target.value)}>
            <option value="">Every {terms.batch}</option>
            {(batches || []).map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
          </SearchSelect>
          <select className="select" value={provider} onChange={(e) => setProvider(e.target.value)}>
            <option value="">Every payment method</option>
            {(options?.providers || []).map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          {(options?.currencies || []).length > 1 && (
            <select className="select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              <option value="">Every currency</option>
              {options.currencies.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {(reps || []).length > 0 && (
            <select className="select" value={seller} onChange={(e) => setSeller(e.target.value)}>
              <option value="">Every seller</option>
              {reps.map((r) => <option key={r._id} value={r._id}>{r.name}</option>)}
            </select>
          )}
          <input className="input" placeholder="Coupon code" value={coupon} onChange={(e) => setCoupon(e.target.value)} style={{ width: 140 }} />
          <div className="row-tight">
            {[["", "Everything"], ["batch", `${terms.Batch} access`], ["ai-credits", "AI packs"]].map(([value, label]) => (
              <button
                key={value}
                className={`pill pill-btn${kind === value ? " pill-on" : ""}`}
                onClick={() => setKind(value)}
              >
                {label}
              </button>
            ))}
          </div>
          {filtered && <button className="btn btn-sm btn-quiet" onClick={clearFilters}>Clear filters</button>}
          {isFetching && <span className="muted small">Updating…</span>}
        </div>

        <ErrorNote error={error} />

        {isLoading ? (
          <Loading />
        ) : !data || data.currencyTotals.length === 0 ? (
          <Empty icon={DollarSign} title="No earnings in this range" hint="Try widening the date range or clearing a filter." />
        ) : (
          <>
            {/* One card per currency, never blended into a single number —
                summing $1 and ৳1 together would be a real bug, not a
                simplification, on a platform that can run more than one
                gateway at once. */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
              {data.currencyTotals.map((row) => (
                <div key={row.currency} className="card stack" style={{ gap: 6, borderTop: "3px solid var(--primary)" }}>
                  <div className="row-tight muted small"><DollarSign size={13} /> {row.currency}</div>
                  <div style={{ fontSize: 22, fontWeight: 600 }}>{money(row.grandTotal, row.currency)}</div>
                  <div className="muted small">
                    {money(row.batchTotal, row.currency)} batch · {money(row.aiTotal, row.currency)} AI packs
                  </div>
                  <div className="muted small tnum">{row.count} transaction{row.count === 1 ? "" : "s"}</div>
                </div>
              ))}
            </div>

            {trend?.rows?.length > 0 && <Trend trend={trend} />}

            <Transactions params={params} />

            <Section icon={Users} title={`By ${terms.batch}`}>
              {data.byBatch.length === 0 ? (
                <p className="hint" style={{ margin: 0 }}>No {terms.batch}-access purchases in this range.</p>
              ) : (
                <Table
                  headers={["Batch", "Currency", "Total", "Transactions"]}
                  rows={data.byBatch.map((r) => [r.batchName, r.currency, money(r.total, r.currency), r.count])}
                />
              )}
            </Section>

            <Section icon={Sparkles} title="AI packs">
              {data.aiPacks.length === 0 ? (
                <p className="hint" style={{ margin: 0 }}>No AI credit pack purchases in this range.</p>
              ) : (
                <Table
                  headers={["Batch", "Currency", "Total", "Credits sold", "Transactions"]}
                  rows={data.aiPacks.map((r) => [r.batchName, r.currency, money(r.total, r.currency), r.credits, r.count])}
                />
              )}
            </Section>

            <Section icon={CreditCard} title="By payment method">
              <Table
                headers={["Provider", "Currency", "Total", "Transactions"]}
                rows={data.byProvider.map((r) => [r.provider, r.currency, money(r.total, r.currency), r.count])}
              />
            </Section>

            {sources && <SalesSources sources={sources} />}
          </>
        )}

        <TeamPay money={money} Table={Table} />
      </div>
    </div>
  );
}

// Revenue over time as bars, one chart per currency (amounts in different
// currencies never share an axis). Buckets are days, weeks or months,
// picked by the server from the range.
function Trend({ trend }) {
  const byCurrency = new Map();
  for (const r of trend.rows) {
    if (!byCurrency.has(r.currency)) byCurrency.set(r.currency, []);
    byCurrency.get(r.currency).push(r);
  }
  const unit = { day: "Daily", week: "Weekly", month: "Monthly" }[trend.unit];
  return (
    <Section icon={TrendingUp} title={`${unit} revenue`}>
      {[...byCurrency.entries()].map(([currency, rows]) => {
        const max = Math.max(1, ...rows.map((r) => r.total));
        const best = rows.reduce((a, b) => (b.total > a.total ? b : a), rows[0]);
        return (
          <div key={currency} className="stack" style={{ gap: 4 }}>
            {byCurrency.size > 1 && <span className="label">{currency}</span>}
            <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 120, borderBottom: "1px solid var(--border)" }}>
              {rows.map((r) => (
                <div
                  key={r.at}
                  title={`${r.at}${trend.unit === "week" ? " (week)" : ""}: ${money(r.total, currency)} · ${r.count} sale${r.count === 1 ? "" : "s"}`}
                  style={{ flex: 1, minWidth: 2, height: `${Math.max(1, (r.total / max) * 100)}%`, background: r === best ? "var(--primary)" : "var(--border-strong, var(--border))", borderRadius: "2px 2px 0 0" }}
                />
              ))}
            </div>
            <div className="row spread muted small">
              <span>{rows[0].at}</span>
              <span>Best: {best.at} · {money(best.total, currency)}</span>
              <span>{rows[rows.length - 1].at}</span>
            </div>
          </div>
        );
      })}
    </Section>
  );
}

// Every sale in the range, a page at a time, with a search.
function Transactions({ params }) {
  const terms = useTerms();
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const key = JSON.stringify(params);
  useEffect(() => { setPage(1); }, [key, search]);
  useEffect(() => {
    const t = setTimeout(() => setSearch(q.trim()), 400);
    return () => clearTimeout(t);
  }, [q]);
  const { data, isFetching } = useGetEarningsTransactionsQuery({ ...params, q: search || undefined, page });
  return (
    <Section icon={Receipt} title="Sales">
      <div className="row-tight">
        <Search size={14} className="muted" />
        <input className="input" placeholder="Student name, email, phone or payment ID" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 340, flex: 1 }} />
        {isFetching && <span className="muted small">Loading…</span>}
      </div>
      {data && data.items.length === 0 ? (
        <p className="hint" style={{ margin: 0 }}>No sales match.</p>
      ) : data ? (
        <>
          <Table
            headers={["Date", "Student", "Item", "Paid", "Coupon", "Method", "Payment ID"]}
            rows={data.items.map((p) => [
              new Date(p.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }),
              p.student ? `${p.student.name || "—"}${p.student.email || p.student.phone ? ` (${p.student.email || p.student.phone})` : ""}` : "(removed student)",
              p.kind === "ai-credits" ? `AI pack${p.credits ? ` · ${p.credits} credits` : ""}${p.batch ? ` · ${p.batch.name}` : ""}` : (p.batch?.name || `(deleted ${terms.batch})`),
              money(p.amountPaid, p.currency),
              p.couponCode || "—",
              p.provider,
              p.transactionId || p.providerRef || "—",
            ])}
          />
          <Pager page={data.page} pages={data.pages} total={data.total} onChange={setPage} />
        </>
      ) : null}
    </Section>
  );
}

const SOURCE_LABEL = {
  referral: "Referral code",
  campaign: "Campaign",
  shortLink: "Short link",
  representative: "Representative's coupon",
  coupon: "Other coupon",
  manual: "Recorded by hand",
  direct: "Direct (no code or link)",
};

// Where sales came from. Each sale counts once, under the first that
// applies: referral, short link, representative, coupon, by hand, direct.
function SalesSources({ sources }) {
  const parts = [
    ["Campaigns", sources.campaigns || [], ["Campaign", "Sent to", "Opened", "Currency", "Total", "Sales"],
      (r) => [r.name, r.recipients ?? "—", r.clicks ?? "—", r.currency, money(r.total, r.currency), r.count]],
    ["Coupons", sources.coupons, ["Code", "Currency", "Total", "Sales"], (r) => [r.code, r.currency, money(r.total, r.currency), r.count]],
    ["Short links", sources.shortLinks, ["Link", "Coupon", "Batch", "Clicks (all time)", "Currency", "Total", "Sales"],
      (r) => [`/r/${r.code}`, r.coupon || "—", r.batch || "—", r.clicks ?? "—", r.currency, money(r.total, r.currency), r.count]],
    ["Representatives", sources.representatives, ["Name", "Currency", "Total", "Sales"], (r) => [r.email ? `${r.name} (${r.email})` : r.name, r.currency, money(r.total, r.currency), r.count]],
    ["Students who referred friends", sources.referrers, ["Student", "Currency", "Total", "Friends' purchases"], (r) => [r.contact ? `${r.name} (${r.contact})` : r.name, r.currency, money(r.total, r.currency), r.count]],
  ];
  return (
    <Section icon={Compass} title="Where sales came from">
      {sources.bySource.length === 0 ? (
        <p className="hint" style={{ margin: 0 }}>No sales in this range.</p>
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          <Table
            headers={["Source", "Currency", "Total", "Discount given", "Sales"]}
            rows={sources.bySource.map((r) => [SOURCE_LABEL[r.source] || r.source, r.currency, money(r.total, r.currency), money(r.discount, r.currency), r.count])}
          />
          <p className="hint" style={{ margin: 0 }}>
            Each sale counts once, under the first of: referral code, campaign (opened in the 7 days before), short link, representative's coupon, other coupon, recorded by hand, direct.
          </p>
          {parts.filter(([, rows]) => rows.length > 0).map(([title, rows, headers, toRow]) => (
            <div key={title} className="stack" style={{ gap: 6 }}>
              <span className="label">{title}</span>
              <Table headers={headers} rows={rows.map(toRow)} />
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function Section({ icon: Icon, title, children }) {
  return (
    <div className="card stack">
      <div className="row-tight"><Icon size={16} className="muted" /><h2 style={{ fontSize: 15 }}>{title}</h2></div>
      {children}
    </div>
  );
}

function Table({ headers, rows }) {
  const [page, setPage] = useState(1);
  const shown = pageSlice(rows, page, 25);
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h} style={{ textAlign: "left", padding: "6px 10px", borderBottom: "1px solid var(--border)", color: "var(--text-muted)", fontWeight: 500 }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.items.map((row, i) => (
            <tr key={shown.start + i}>
              {row.map((cell, j) => (
                <td key={j} className={j >= 2 ? "tnum" : ""} style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <Pager page={shown.page} pages={shown.pages} total={shown.total} onChange={setPage} />
    </div>
  );
}
