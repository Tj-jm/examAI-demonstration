import { useState } from "react";
import { Radio, Users, Cpu, MemoryStick, Wifi, Server, AlertTriangle, Video, Mic, MonitorUp, Hand, Circle, ChevronDown, ChevronRight } from "lucide-react";
import { useGetLiveMonitorQuery, useGetLiveHistoryQuery, useGetPerformanceQuery, useUpdatePerformanceMutation } from "../api/performanceApi";
import { Loading, ErrorNote, Empty, Field } from "./bits";

// Performance → Live classes: the in-app (LiveKit) classes right now, the
// servers, capacity against the limit, and history. Backend:
// utils/liveMonitor.js.

const POLL_MS = 5000;

const bytes = (n) => {
  if (n === null || n === undefined) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v < 10 && i ? 1 : 0)} ${units[i]}`;
};
const rate = (n) => (n === null || n === undefined ? "—" : `${bytes(n)}/s`);
const pct = (n) => (n === null || n === undefined ? "—" : `${Math.round(n)}%`);
const tone = (p, alert = 90) => (p === null || p === undefined ? "var(--text-muted)" : p >= alert ? "var(--incorrect)" : p >= 70 ? "var(--warning)" : "var(--correct)");
const ago = (d) => {
  if (!d) return "—";
  const m = Math.max(0, Math.round((Date.now() - new Date(d)) / 60000));
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
};

const QUALITY = {
  excellent: ["Excellent", "var(--correct)"],
  good: ["Good", "var(--correct)"],
  poor: ["Poor", "var(--warning)"],
  lost: ["Lost", "var(--incorrect)"],
};

function Meter({ label, value, sub, alert, Icon }) {
  const v = value === null || value === undefined ? null : Math.max(0, Math.min(100, value));
  const color = tone(v, alert);
  return (
    <div className="card stack" style={{ gap: 6 }}>
      <div className="row-tight small muted" style={{ gap: 6 }}>{Icon && <Icon size={14} style={{ color }} />} {label}</div>
      <strong className="tnum" style={{ fontSize: 22, color: v === null ? undefined : color }}>{pct(v)}</strong>
      <div style={{ height: 8, borderRadius: 4, background: "var(--surface-alt, var(--border))", overflow: "hidden" }}>
        <div style={{ width: `${v ?? 0}%`, height: "100%", background: color, transition: "width 600ms ease" }} />
      </div>
      {sub && <span className="small muted">{sub}</span>}
    </div>
  );
}

function Stat({ Icon, label, value, sub, color = "var(--primary)" }) {
  return (
    <div className="card stack" style={{ gap: 4, borderTop: `3px solid ${color}` }}>
      <div className="row-tight small muted" style={{ gap: 6 }}><Icon size={14} style={{ color }} /> {label}</div>
      <strong className="tnum" style={{ fontSize: 24 }}>{value}</strong>
      {sub && <span className="small muted">{sub}</span>}
    </div>
  );
}

function QualityBar({ q, total }) {
  if (!total) return <span className="muted small">—</span>;
  const known = Object.values(q).reduce((n, v) => n + v, 0);
  return (
    <div className="stack" style={{ gap: 3, minWidth: 120 }}>
      <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", background: "var(--border)" }}>
        {Object.entries(QUALITY).map(([k, [, color]]) => (q[k] ? <div key={k} title={`${QUALITY[k][0]}: ${q[k]}`} style={{ width: `${(q[k] / total) * 100}%`, background: color, opacity: k === "excellent" ? 1 : 0.8 }} /> : null))}
      </div>
      <span className="muted" style={{ fontSize: 11 }}>
        {known ? `${q.poor + q.lost} weak of ${known} reporting` : "No reports yet"}
      </span>
    </div>
  );
}

function ClassRow({ c, alert }) {
  const [open, setOpen] = useState(false);
  const total = c.people.length;
  return (
    <>
      <tr onClick={() => setOpen(!open)} style={{ cursor: "pointer" }}>
        <td style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
          <div className="row-tight" style={{ gap: 6 }}>
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <div className="stack" style={{ gap: 1 }}>
              <strong>{c.title}</strong>
              <span className="muted small">{c.batch}{c.host ? ` · ${c.host}` : ""}{c.mode === "webinar" ? " · webinar" : ""}</span>
            </div>
          </div>
        </td>
        <td style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }} className="tnum">
          <strong style={{ fontSize: 16 }}>{c.students}</strong> <span className="muted small">students</span>
          {c.hosts > 0 && <div className="muted small">+{c.hosts} staff</div>}
        </td>
        <td style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }} className="tnum small">{c.joinedSoFar} joined · {ago(c.liveSince)}</td>
        <td style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}><QualityBar q={c.quality} total={total} /></td>
        <td style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }} className="small">
          <span className="row-tight" style={{ gap: 8 }}>
            <span title="Cameras on"><Video size={13} /> {c.publishing.camera}</span>
            <span title="Mics on"><Mic size={13} /> {c.publishing.mic}</span>
            <span title="Screens shared"><MonitorUp size={13} /> {c.publishing.screen}</span>
          </span>
        </td>
        <td style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
          {!c.reachable ? <span className="pill pill-bad">No answer</span> : c.recording ? <span className="pill pill-bad row-tight" style={{ gap: 4 }}><Circle size={8} fill="currentColor" /> Recording</span> : <span className="pill pill-ok">Live</span>}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6} style={{ padding: "0 12px 12px 34px", borderBottom: "1px solid var(--border)", background: "var(--surface-alt, transparent)" }}>
            {total === 0 ? <p className="muted small" style={{ margin: "10px 0 0" }}>Nobody in the room right now.</p> : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 6 }}>
                <thead>
                  <tr>{["Name", "Role", "Connection", "In for", "On"].map((h) => <th key={h} style={{ textAlign: "left", padding: "6px 8px", color: "var(--text-muted)", fontWeight: 500 }}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {[...c.people].sort((a, b) => (["lost", "poor"].includes(b.quality) ? 1 : 0) - (["lost", "poor"].includes(a.quality) ? 1 : 0)).map((p) => (
                    <tr key={p.identity}>
                      <td style={{ padding: "5px 8px" }}>{p.name || "—"} {p.hand && <Hand size={12} style={{ color: "var(--warning)", verticalAlign: -2 }} />}</td>
                      <td style={{ padding: "5px 8px" }} className="muted">{p.role === "student" ? "Student" : "Staff"}</td>
                      <td style={{ padding: "5px 8px" }}>
                        {p.quality ? <span className="row-tight" style={{ gap: 5 }}><Wifi size={12} style={{ color: QUALITY[p.quality][1] }} /> {QUALITY[p.quality][0]}</span> : <span className="muted">—</span>}
                      </td>
                      <td style={{ padding: "5px 8px" }} className="tnum">{ago(p.joinedAt)}</td>
                      <td style={{ padding: "5px 8px" }} className="row-tight muted">
                        {p.camera && <Video size={12} />} {p.mic && <Mic size={12} />} {p.screen && <MonitorUp size={12} />}
                        {!p.camera && !p.mic && !p.screen && "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function LimitSettings({ current }) {
  const { data } = useGetPerformanceQuery();
  const [update, { isLoading, error, isSuccess }] = useUpdatePerformanceMutation();
  const [form, setForm] = useState(null);
  const live = form || data?.live || current;
  if (!live) return null;
  const set = (k, v) => setForm({ ...live, [k]: v });
  return (
    <div className="card stack">
      <div className="row-tight"><Server size={16} className="muted" /><h2 style={{ fontSize: 15 }}>Capacity limit</h2></div>
      <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>
        <Field label="Most people at once (all classes)" hint="What your LiveKit server can carry. 0 means not set. A 4-core, 8 GB server: about 150 with cameras off for students, 50 to 80 with cameras on.">
          <input className="input tnum" type="number" min="0" value={live.maxParticipants ?? 0} onChange={(e) => set("maxParticipants", Number(e.target.value) || 0)} style={{ width: 120 }} />
        </Field>
        <Field label="Warn from (%)">
          <input className="input tnum" type="number" min="10" max="100" value={live.alertPercent ?? 90} onChange={(e) => set("alertPercent", Number(e.target.value) || 90)} style={{ width: 90 }} />
        </Field>
        <Field label="When it's full">
          <label className="row-tight" style={{ gap: 8 }}>
            <input type="checkbox" checked={Boolean(live.blockWhenFull)} onChange={(e) => set("blockWhenFull", e.target.checked)} />
            <span>Stop new students joining ("This class is full")</span>
          </label>
        </Field>
      </div>
      <ErrorNote error={error} />
      <div className="row-tight" style={{ gap: 8 }}>
        <button className="btn" disabled={isLoading || !form} onClick={() => update({ live }).unwrap().then(() => setForm(null))}>{isLoading ? "Saving…" : "Save"}</button>
        {isSuccess && !form && <span className="small muted">Saved.</span>}
      </div>
    </div>
  );
}

function History() {
  const [days, setDays] = useState(7);
  const { data, isFetching } = useGetLiveHistoryQuery(days);
  const rows = data?.byDay || [];
  const hours = data?.byHour || [];
  const max = Math.max(1, ...rows.map((r) => r.peak));
  const hourMax = Math.max(1, ...hours.map((h) => h.avg));
  return (
    <div className="card stack">
      <div className="spread" style={{ flexWrap: "wrap", gap: 8 }}>
        <div className="row-tight"><Radio size={16} className="muted" /><h2 style={{ fontSize: 15 }}>History</h2></div>
        <div className="row-tight">
          {[7, 30].map((d) => <button key={d} className={`pill pill-btn${days === d ? " pill-on" : ""}`} onClick={() => setDays(d)}>{d} days</button>)}
          {isFetching && <span className="muted small">Loading…</span>}
        </div>
      </div>
      {!rows.length ? <p className="hint" style={{ margin: 0 }}>Nothing yet. A sample is taken every 5 minutes while a class is live.</p> : (
        <>
          {data.busiest && (
            <p className="small" style={{ margin: 0 }}>
              Busiest: <strong>{data.busiest.people} people</strong> in {data.busiest.rooms} class{data.busiest.rooms === 1 ? "" : "es"}, {new Date(data.busiest.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
            </p>
          )}
          <div className="stack" style={{ gap: 4 }}>
            <span className="label">Most people at once, per day</span>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 120, borderBottom: "1px solid var(--border)" }}>
              {rows.map((r) => (
                <div key={r.day} title={`${r.day}: ${r.peak} people, ${r.rooms} classes${r.cpu != null ? `, LiveKit CPU ${Math.round(r.cpu)}%` : ""}`}
                  style={{ flex: 1, minWidth: 3, height: `${Math.max(2, (r.peak / max) * 100)}%`, background: "var(--primary)", borderRadius: "3px 3px 0 0", opacity: 0.85 }} />
              ))}
            </div>
            <div className="spread muted small"><span>{rows[0].day}</span><span>{rows[rows.length - 1].day}</span></div>
          </div>
          <div className="stack" style={{ gap: 4 }}>
            <span className="label">Busiest hours (average people)</span>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(24, 1fr)", gap: 2 }}>
              {Array.from({ length: 24 }, (_, h) => {
                const row = hours.find((x) => x.hour === h);
                const a = row ? row.avg / hourMax : 0;
                return <div key={h} title={`${String(h).padStart(2, "0")}:00 · avg ${row?.avg ?? 0}, peak ${row?.peak ?? 0}`} style={{ height: 26, borderRadius: 3, background: a ? `color-mix(in srgb, var(--primary) ${Math.round(15 + a * 85)}%, transparent)` : "var(--border)" }} />;
              })}
            </div>
            <div className="spread muted" style={{ fontSize: 11 }}><span>00:00</span><span>12:00</span><span>23:00</span></div>
          </div>
        </>
      )}
    </div>
  );
}

export default function LiveClassMonitor() {
  const [paused, setPaused] = useState(false);
  const { data, isLoading, error, isFetching } = useGetLiveMonitorQuery(undefined, { pollingInterval: paused ? 0 : POLL_MS, skipPollingIfUnfocused: true });

  if (isLoading) return <Loading />;
  if (error) return <ErrorNote error={error} />;
  if (!data?.configured) {
    return <Empty icon={Radio} title="In-app live classes aren't set up" hint="Set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET on the server (LIVEKIT_SETUP.md)." />;
  }

  const { totals, capacity, app, livekit, classes, settings } = data;
  const alert = settings?.alertPercent || 90;
  return (
    <div className="stack">
      <div className="spread" style={{ flexWrap: "wrap", gap: 8 }}>
        <div className="row-tight small muted" style={{ gap: 6 }}>
          <span className="perf-dot" style={{ width: 8, height: 8, borderRadius: "50%", background: paused ? "var(--text-muted)" : "var(--correct)", display: "inline-block" }} />
          {paused ? "Paused" : `Updates every ${POLL_MS / 1000} seconds`}{isFetching && !paused ? " · updating" : ""}
        </div>
        <button className="btn btn-sm btn-quiet" onClick={() => setPaused(!paused)}>{paused ? "Resume" : "Pause"}</button>
      </div>

      {!data.reachable && (
        <div className="card row-tight" style={{ gap: 8, borderLeft: "3px solid var(--incorrect)" }}>
          <AlertTriangle size={16} style={{ color: "var(--incorrect)" }} /> The LiveKit server didn't answer for at least one class. Check that it's running.
        </div>
      )}
      {capacity?.alert && (
        <div className="card row-tight" style={{ gap: 8, borderLeft: "3px solid var(--incorrect)" }}>
          <AlertTriangle size={16} style={{ color: "var(--incorrect)" }} />
          {capacity.full ? `Full: ${totals.people} of ${capacity.max} people.${settings.blockWhenFull ? " New students are being turned away." : ""}` : `Nearly full: ${capacity.usedPercent}% of the limit (${totals.people} of ${capacity.max}).`}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
        <Stat Icon={Radio} label="Classes live" value={totals.rooms} sub={data.recordingsRunning ? `${data.recordingsRunning} recording` : "None recording"} color="var(--incorrect)" />
        <Stat Icon={Users} label="Students in class" value={totals.students} sub={`${totals.hosts} staff · ${totals.people} in all`} />
        <Meter Icon={Server} label="Capacity used" value={capacity?.usedPercent} alert={alert} sub={capacity?.max ? `${totals.people} of ${capacity.max} people` : "Set a limit below"} />
        <Meter Icon={Cpu} label="LiveKit CPU" value={livekit?.available ? livekit.cpuPercent : null} alert={alert} sub={livekit?.available ? (livekit.warmingUp ? "Measuring…" : `Memory ${bytes(livekit.memoryBytes)}`) : "Metrics off"} />
        <Meter Icon={Cpu} label="App server CPU" value={app.cpuPercent} alert={alert} sub={`${app.cores} cores · 1-minute load`} />
        <Meter Icon={MemoryStick} label="App server memory" value={app.memoryUsedPercent} alert={alert} sub={`of ${bytes(app.memoryTotalBytes)}`} />
      </div>

      <div className="card stack" style={{ gap: 8 }}>
        <div className="row-tight"><Wifi size={16} className="muted" /><h2 style={{ fontSize: 15 }}>LiveKit server</h2></div>
        {livekit?.available ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }} className="small">
            <div className="stack" style={{ gap: 2 }}><span className="muted">Traffic in</span><strong className="tnum">{rate(livekit.bytesInPerSec)}</strong></div>
            <div className="stack" style={{ gap: 2 }}><span className="muted">Traffic out</span><strong className="tnum">{rate(livekit.bytesOutPerSec)}</strong></div>
            <div className="stack" style={{ gap: 2 }}><span className="muted">Packets in / out</span><strong className="tnum">{livekit.packetsInPerSec == null ? "—" : `${Math.round(livekit.packetsInPerSec)} / ${Math.round(livekit.packetsOutPerSec || 0)} per s`}</strong></div>
            <div className="stack" style={{ gap: 2 }}><span className="muted">Lost / resent packets</span><strong className="tnum">{livekit.lossPerSec == null ? "—" : `${livekit.lossPerSec.toFixed(1)} per s`}</strong></div>
            <div className="stack" style={{ gap: 2 }}><span className="muted">Streams sent / received</span><strong className="tnum">{livekit.tracksPublished ?? "—"} / {livekit.tracksSubscribed ?? "—"}</strong></div>
          </div>
        ) : <p className="hint" style={{ margin: 0 }}>{livekit?.reason || "Metrics off."} Room counts, capacity and connection quality work without it.</p>}
      </div>

      {classes.length === 0 ? (
        <Empty icon={Radio} title="No in-app class is live" hint="Classes appear here as soon as a teacher starts one." />
      ) : (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
            <thead>
              <tr>{["Class", "In now", "So far", "Connections", "Sharing", ""].map((h) => <th key={h} style={{ textAlign: "left", padding: "10px 12px", borderBottom: "1px solid var(--border)", color: "var(--text-muted)", fontWeight: 500 }}>{h}</th>)}</tr>
            </thead>
            <tbody>{classes.map((c) => <ClassRow key={c._id} c={c} alert={alert} />)}</tbody>
          </table>
        </div>
      )}

      <History />
      <LimitSettings current={settings} />
    </div>
  );
}
