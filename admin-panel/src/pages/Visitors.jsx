import { useState } from "react";
import { BarChart3, Compass, Filter, Megaphone, BookOpen, FileText, Smartphone, Clock, MapPin } from "lucide-react";
import { useGetVisitorsQuery, useSetVisitorLocationMutation } from "../api/audienceApi";
import { useUpdateSettingsMutation } from "../api/contentApi";
import { Loading, ErrorNote, Empty, Pager, pageSlice } from "../components/bits";
import UsageChart from "../components/UsageChart";
import { useTerms } from "../terms";

const pct = (part, whole) => (whole ? `${Math.round((part / whole) * 1000) / 10}%` : "–");
const money = (amount, currency) => `${currency ? `${currency} ` : ""}${Math.round(amount || 0).toLocaleString()}`;
const countryName = (code) => {
  try {
    return new Intl.DisplayNames(undefined, { type: "region" }).of(code) || code;
  } catch {
    return code;
  }
};
const DEVICES = { mobile: "Phone", tablet: "Tablet", desktop: "Computer", app: "Mobile app" };

// Visitors: where people come from, how far they get before paying, and
// which course pages are looked at but not bought (backend utils/visitors.js).
export default function Visitors() {
  const terms = useTerms();
  const [days, setDays] = useState(30);
  const { data, isLoading, isFetching, error } = useGetVisitorsQuery(days);
  const [updateSettings, updateState] = useUpdateSettingsMutation();

  const toggle = () => updateSettings({ studentUi: { trackVisitors: !data.tracking } });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Visitors</h1>
          <p className="muted small" style={{ margin: "2px 0 0" }}>
            Everyone who opens the student site or app, signed in or not. Counted on your own server: no Google Analytics, no third-party scripts, nothing personal before sign-in.
          </p>
        </div>
        {data && (
          <button className={`btn btn-sm${data.tracking ? " btn-quiet" : ""}`} onClick={toggle} disabled={updateState.isLoading}>
            {data.tracking ? "Stop counting visits" : "Start counting visits"}
          </button>
        )}
      </div>

      <div className="row-tight" style={{ marginBottom: 12, flexWrap: "wrap" }}>
        {[7, 30, 90].map((d) => (
          <button key={d} className={`pill pill-btn${days === d ? " pill-on" : ""}`} onClick={() => setDays(d)}>Last {d} days</button>
        ))}
        {isFetching && <span className="muted small">Updating…</span>}
      </div>

      <ErrorNote error={error || updateState.error} />
      {data && !data.tracking && <p className="hint">Visits are not being counted. The numbers below are from before it was switched off.</p>}

      {isLoading ? (
        <Loading />
      ) : !data ? null : data.totals.sessions === 0 ? (
        <Empty icon={BarChart3} title="No visits yet" hint="Visits show up here as soon as someone opens the student site. Share a link with ?utm_source=facebook (or youtube, sms…) to see which post brought them." />
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
            <Tile label="Visitors" value={data.totals.visitors} sub={`${data.totals.newVisitors} new`} />
            <Tile label="Visits" value={data.totals.sessions} sub={`${data.totals.views} pages opened`} />
            <Tile label="Sign-ups" value={data.totals.signups} sub={`${pct(data.totals.signups, data.totals.newVisitors)} of new visitors`} />
            <Tile label="Paid" value={data.totals.paid} sub={`${pct(data.totals.paid, data.totals.newVisitors)} of new visitors`} />
            <Tile label="Revenue from new visitors" value={money(data.totals.revenue, data.currency)} />
          </div>

          <Section icon={BarChart3} title="Visitors per day">
            <UsageChart byDay={data.byDay.map((d) => ({ _id: d.day, calls: d.visitors }))} unit="visitor" />
          </Section>

          <Section icon={Filter} title="From first visit to payment (new visitors)">
            <Funnel funnel={data.funnel} />
            <p className="hint" style={{ margin: 0 }}>
              Sign-ups, checkouts and payments count once a visitor signs in on that device. A big drop between two steps is where to look: the sign-up form, the plan prices, or the payment page.
            </p>
          </Section>

          <Section icon={Compass} title="Where visitors come from">
            <Table
              headers={["Source", "Visits", "New visitors", "Sign-ups", "Paid", "Conversion", "Revenue"]}
              rows={data.sources.map((s) => [s.source, s.sessions, s.visitors, s.signups, s.paid, pct(s.paid, s.visitors), money(s.revenue, data.currency)])}
            />
            <p className="hint" style={{ margin: 0 }}>
              Tag the links you post so they land in the right row: add ?utm_source=facebook&amp;utm_campaign=hsc-batch to any link. Campaign messages and referral codes are tagged for you.
            </p>
          </Section>

          {data.campaigns.length > 0 && (
            <Section icon={Megaphone} title="Campaigns and codes">
              <Table
                headers={["Campaign", "Code", "New visitors", "Opened plans", "Sign-ups", "Paid", "Revenue"]}
                rows={data.campaigns.map((c) => [c.campaign || "–", c.coupon || "–", c.visitors, c.plans, c.signups, c.paid, money(c.revenue, data.currency)])}
              />
            </Section>
          )}

          {data.courses.length > 0 && (
            <Section icon={BookOpen} title={`${terms.Batch || "Course"} plans: looked at vs bought`}>
              <Table
                headers={[terms.Batch || "Course", "Plan page views", "Checkouts started", "Sales", "Sale per view", "Revenue"]}
                rows={data.courses.map((c) => [c.name, c.planViews, c.checkouts, c.sales, pct(c.sales, c.planViews), money(c.revenue, data.currency)])}
              />
              <p className="hint" style={{ margin: 0 }}>Many views and few sales usually means the price, the plan names or the description need work. Checkouts with no sale mean people quit at payment.</p>
            </Section>
          )}


          <Places data={data} />

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
            <Section icon={FileText} title="Most opened pages">
              <Table headers={["Page", "Views"]} rows={data.pages.map((p) => [p.path, p.views])} />
            </Section>
            <div className="stack" style={{ gap: 16 }}>
              <Section icon={Smartphone} title="Devices">
                <Bars rows={data.devices.map((d) => [DEVICES[d.device] || d.device, d.sessions])} />
              </Section>
              <Section icon={Clock} title={`Busy hours (${data.timezone})`}>
                <Hours hours={data.hours} />
              </Section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Places({ data }) {
  const [setLocation, state] = useSetVisitorLocationMutation();
  const loc = data.location || {};
  const rows = data.places || [];
  return (
    <Section icon={MapPin} title="Where visitors are">
      <div className="row-tight" style={{ flexWrap: "wrap", gap: 8 }}>
        <button className={`btn btn-sm${loc.enabled ? " btn-quiet" : ""}`} onClick={() => setLocation(!loc.enabled)} disabled={state.isLoading}>
          {state.isLoading ? "Downloading the location database…" : loc.enabled ? "Stop looking up cities" : "Look up visitors' cities"}
        </button>
        {loc.enabled && loc.ready && loc.updatedAt && <span className="muted small">Location database from {new Date(loc.updatedAt).toLocaleDateString()}, refreshed monthly.</span>}
        {loc.downloading && <span className="muted small">Downloading…</span>}
      </div>
      <ErrorNote error={state.error} />
      {loc.error && <p className="hint" style={{ margin: 0 }}>Location lookup problem: {loc.error} It retries on the next visit.</p>}
      {rows.length === 0 ? (
        <p className="hint" style={{ margin: 0 }}>
          {loc.enabled
            ? "Cities show up here for visits from now on."
            : "Switch this on to see visitors' country, division and city, worked out from their IP address on your own server (the address itself is never kept). It uses about 130 MB of server memory. Behind Cloudflare with visitor location headers on, cities show without it."}
        </p>
      ) : (
        <Table
          headers={["City", "Region", "Country", "Visits", "New visitors", "Sign-ups", "Paid", "Revenue"]}
          rows={rows.map((r) => [r.city || "–", r.region || "–", countryName(r.country), r.sessions, r.visitors, r.signups, r.paid, money(r.revenue, data.currency)])}
        />
      )}
      {loc.enabled && <p className="muted small" style={{ margin: 0 }}>IP location data by <a href="https://db-ip.com" target="_blank" rel="noreferrer">DB-IP</a>. City accuracy is rough on mobile data: phone networks often show the operator's city.</p>}
    </Section>
  );
}

function Tile({ label, value, sub }) {
  return (
    <div className="card stack" style={{ gap: 4 }}>
      <div className="muted small">{label}</div>
      <div className="tnum" style={{ fontSize: 22, fontWeight: 600 }}>{typeof value === "number" ? value.toLocaleString() : value}</div>
      {sub && <div className="muted small">{sub}</div>}
    </div>
  );
}

function Funnel({ funnel }) {
  const steps = [
    ["New visitors", funnel.visitors],
    ["Opened sign-up", funnel.register],
    ["Signed up", funnel.signups],
    ["Opened plans", funnel.plans],
    ["Started checkout", funnel.checkouts],
    ["Paid", funnel.paid],
  ];
  const top = Math.max(1, funnel.visitors);
  return (
    <div className="stack" style={{ gap: 6 }}>
      {steps.map(([label, n], i) => (
        <div key={label} style={{ display: "grid", gridTemplateColumns: "130px 1fr 110px", alignItems: "center", gap: 10, fontSize: 13.5 }}>
          <span>{label}</span>
          <div style={{ background: "var(--border)", borderRadius: 6, height: 18, overflow: "hidden" }}>
            <div style={{ width: `${Math.max(n ? 2 : 0, (n / top) * 100)}%`, height: "100%", background: "var(--primary)", borderRadius: 6 }} />
          </div>
          <span className="tnum muted">{n.toLocaleString()}{i > 0 ? ` · ${pct(n, steps[i - 1][1])}` : ""}</span>
        </div>
      ))}
    </div>
  );
}

function Bars({ rows }) {
  const total = rows.reduce((s, [, n]) => s + n, 0) || 1;
  return (
    <div className="stack" style={{ gap: 6 }}>
      {rows.map(([label, n]) => (
        <div key={label} style={{ display: "grid", gridTemplateColumns: "100px 1fr 60px", alignItems: "center", gap: 10, fontSize: 13.5 }}>
          <span>{label}</span>
          <div style={{ background: "var(--border)", borderRadius: 6, height: 14, overflow: "hidden" }}>
            <div style={{ width: `${(n / total) * 100}%`, height: "100%", background: "var(--primary)" }} />
          </div>
          <span className="tnum muted">{pct(n, total)}</span>
        </div>
      ))}
    </div>
  );
}

function Hours({ hours }) {
  const max = Math.max(1, ...hours);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 80 }}>
        {hours.map((n, h) => (
          <div key={h} title={`${h}:00 · ${n} visits`} style={{ flex: 1, height: `${Math.max(n ? 4 : 1, (n / max) * 100)}%`, background: n ? "var(--primary)" : "var(--border)", borderRadius: 2 }} />
        ))}
      </div>
      <div className="muted small" style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
        <span>0:00</span><span>6:00</span><span>12:00</span><span>18:00</span><span>23:00</span>
      </div>
    </div>
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
              <th key={h} style={{ textAlign: "left", padding: "6px 10px", borderBottom: "1px solid var(--border)", color: "var(--text-muted)", fontWeight: 500, whiteSpace: "nowrap" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.items.map((row, i) => (
            <tr key={shown.start + i}>
              {row.map((cell, j) => (
                <td key={j} className={j >= 1 ? "tnum" : ""} style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)", wordBreak: j === 0 ? "break-word" : undefined }}>
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
