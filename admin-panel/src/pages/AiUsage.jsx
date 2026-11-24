import { useState } from "react";
import CountUp from "../components/CountUp";
import { useGetAiUsageQuery } from "../api/aiApi";
import { BarChart3, DollarSign, Zap, AlertTriangle, Wallet } from "lucide-react";
import { Loading, ErrorNote, Empty } from "../components/bits";
import { useTerms } from "../terms";

const RANGES = [7, 30, 90];

// The per-student table here is the piece that didn't exist before this —
// getAiUsage already returned platform-wide totals and a per-feature
// breakdown, but there was no way to see who was actually driving that
// number. A cap-reached complaint was previously undiagnosable beyond
// "someone hit the limit" with no way to say who or how much.
export default function AiUsage() {
  const terms = useTerms();
  const [days, setDays] = useState(30);
  const { data, isLoading, error } = useGetAiUsageQuery(days);

  return (
    <div className="page">
      <div className="page-head spread">
        <div>
          <h1>AI usage</h1>
          <p className="muted small" style={{ margin: "2px 0 0" }}>Spend, calls and who's using them</p>
        </div>
        <div className="row-tight">
          {RANGES.map((n) => (
            <button
              key={n}
              className={`pill pill-btn${days === n ? " pill-on" : ""}`}
              onClick={() => setDays(n)}
            >
              {n}d
            </button>
          ))}
        </div>
      </div>

      <div className="stack">
        <ErrorNote error={error} />
        {isLoading ? (
          <Loading />
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
              <StatCard icon={DollarSign} label="Spend" value={`$${(data.totals.cost || 0).toFixed(2)}`} />
              <StatCard icon={Zap} label="Calls" value={data.totals.calls || 0} />
              <StatCard icon={AlertTriangle} label="Failures" value={data.totals.failures || 0} />
              <StatCard icon={BarChart3} label="Avg latency" value={data.totals.avgLatencyMs ? `${Math.round(data.totals.avgLatencyMs)}ms` : "—"} />
            </div>

            <div className="card stack">
              <h2>By feature</h2>
              {data.byFeature.length === 0 ? (
                <p className="hint" style={{ margin: 0 }}>No AI calls in this window.</p>
              ) : (
                <table className="table">
                  <thead>
                    <tr><th>Feature</th><th>Calls</th><th>Cost</th><th>Failures</th></tr>
                  </thead>
                  <tbody>
                    {data.byFeature.map((f) => (
                      <tr key={f._id}>
                        <td>{f._id}</td>
                        <td className="tnum">{f.calls}</td>
                        <td className="tnum">${f.cost.toFixed(2)}</td>
                        <td className="tnum">{f.failures}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="card stack">
              <div className="row-tight"><Wallet size={16} className="muted" /><h2>By student</h2></div>
              {data.byStudent.length === 0 ? (
                <Empty icon={Wallet} title="No student AI usage yet" hint="Once students start using AI features, who's using how much shows up here." />
              ) : (
                <table className="table">
                  <thead>
                    <tr><th>Student</th><th>{terms.Batch}</th><th>Calls</th><th>Via credit</th><th>Cost</th></tr>
                  </thead>
                  <tbody>
                    {data.byStudent.map((s, i) => (
                      <tr key={i}>
                        <td>{s.studentName || s.studentEmail || s.studentPhone || "—"}</td>
                        {/* batchId is explicitly null, not missing, for every archive AI call (see archiveController.js) — labeled rather than left blank, so it doesn't read as a data gap. */}
                        <td className="muted">{s.batchName || (s.batchId ? "—" : "Archive")}</td>
                        <td className="tnum">{s.calls}</td>
                        <td className="tnum">{s.creditPaidCalls || 0}</td>
                        <td className="tnum">${s.cost.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="row-tight muted small" style={{ marginBottom: 6 }}><Icon size={13} />{label}</div>
      <div className="tnum" style={{ fontSize: 20, fontWeight: 500 }}><CountUp value={value} /></div>
    </div>
  );
}
