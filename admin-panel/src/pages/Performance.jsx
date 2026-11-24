import { useEffect, useRef, useState } from "react";
import { Check, X, Library, Trash2, RotateCw, Database, Sparkles, Play, Pause, Zap, MemoryStick, KeyRound, Server, Activity, SlidersHorizontal, Radio } from "lucide-react";
import CountUp from "../components/CountUp";
import Latex from "../components/Latex";
import {
  useGetPerformanceQuery, useUpdatePerformanceMutation, useGetPerformanceStatusQuery, useClearPerformanceCacheMutation,
  useGetSavedAiResultsQuery, useReviewSavedAiResultMutation, useDeleteSavedAiResultMutation,
} from "../api/performanceApi";
import { Loading, ErrorNote, Empty, Field, Pager, useConfirm } from "../components/bits";
import LiveClassMonitor from "../components/LiveClassMonitor";

// Performance (its own page, /performance): what Redis, the cache, the
// queue and autosave are doing right now, and the settings that trade
// speed and AI cost against freshness. Backend: controllers/admin/performanceController.js.

const CACHE_GROUPS = [
  ["dashboard", "Student home", "Each batch's lectures and exams."],
  ["practice", "Practice", "Topic lists and question counts."],
  ["archive", "Archive", "Boards, years, subjects and topics."],
  ["landing", "Landing page", "The public home page."],
  ["access", "Access checks", "Who can open which batch, checked on every batch page. Kept at most a minute; a purchase or refund is seen at once."],
];

const SAVED_COSTS = [
  ["practice-similar-saved", "Saved similar questions"],
  ["archive-similar-saved", "Archive: saved similar questions"],
  ["practice-hint-saved", "Saved hint"],
  ["archive-hint-saved", "Archive: saved hint"],
  ["practice-explain-saved", "Saved explanation"],
  ["archive-explain-saved", "Archive: saved explanation"],
];

const Choice = ({ value, onChange, options }) => (
  <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
    {options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
  </select>
);

const num = (v) => (v === null || v === undefined ? "—" : Number(v).toLocaleString());

// ---------------------------------------------------------------- live view
// Hand-rolled SVG, like UsageChart: no charting library in this panel. The
// status is polled every few seconds and the last five minutes kept here,
// so the lines move while the page is open.

const POLL_MS = 5000;
const KEEP = 60; // five minutes of points

const bytes = (n) => {
  if (n === null || n === undefined) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v < 10 && i ? 1 : 0)} ${units[i]}`;
};

const since = (s) => {
  if (!s && s !== 0) return "—";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
};

const KEY_KINDS = {
  rl: "Request limits",
  ce: "Cached pages",
  cv: "Cache versions",
  as: "Exam autosave",
  job: "Job progress",
  jobs: "Job progress",
  lb: "Leaderboards",
  lbv: "Leaderboards",
  lock: "Locks",
  bull: "Background queue",
};
const KIND_COLORS = ["var(--primary)", "var(--accent)", "var(--correct)", "var(--warning)", "var(--ai)", "var(--incorrect)", "var(--text-muted)"];

// A line through recent values. Gaps (null) break nothing: they are skipped.
function Spark({ points, color = "var(--primary)", height = 40, fill = true, max: fixedMax }) {
  const values = points.map((p) => (Number.isFinite(p) ? p : null));
  const real = values.filter((v) => v !== null);
  if (real.length < 2) return <div style={{ height }} className="perf-spark-empty small muted">Collecting…</div>;
  const w = 200;
  const max = fixedMax ?? Math.max(1, ...real) * 1.1;
  const step = w / (values.length - 1);
  const coords = values
    .map((v, i) => (v === null ? null : [i * step, height - 2 - (v / max) * (height - 4)]))
    .filter(Boolean);
  const line = coords.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${coords[coords.length - 1][0].toFixed(1)},${height} L${coords[0][0].toFixed(1)},${height} Z`;
  const [lx, ly] = coords[coords.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ width: "100%", height, display: "block", overflow: "visible" }}>
      {fill && <path d={area} fill={color} opacity="0.12" />}
      <path d={line} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r="3" fill={color} className="perf-dot" />
    </svg>
  );
}

// A ring filled to `value` of 100.
function Ring({ value, color = "var(--primary)", size = 120, label, sub }) {
  const r = 46;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className="stack" style={{ alignItems: "center", gap: 6, flex: "1 1 140px", maxWidth: 200 }}>
      <svg viewBox="0 0 120 120" style={{ width: size, height: size }}>
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--surface-alt)" strokeWidth="12" />
        <circle
          cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} transform="rotate(-90 60 60)"
          style={{ transition: "stroke-dashoffset 800ms cubic-bezier(.2,.8,.2,1)" }}
        />
        <text x="60" y="58" textAnchor="middle" dominantBaseline="middle" style={{ font: "600 22px var(--font)", fill: "var(--text)" }}>
          {value === null || value === undefined ? "—" : `${Math.round(v)}%`}
        </text>
        {label && <text x="60" y="80" textAnchor="middle" style={{ font: "11px var(--font)", fill: "var(--text-muted)" }}>{label}</text>}
      </svg>
      {sub && <span className="small muted" style={{ textAlign: "center" }}>{sub}</span>}
    </div>
  );
}

// Labelled horizontal bars that grow to their value.
function Bars({ rows, empty = "Nothing yet" }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <span className="small muted">{empty}</span>;
  return (
    <div className="stack" style={{ gap: 8 }}>
      {rows.map((r) => (
        <div key={r.label} className="stack" style={{ gap: 3 }}>
          <div className="spread small"><span>{r.label}</span><span className="tnum muted">{r.text ?? num(r.value)}</span></div>
          <div className="perf-track"><div className="perf-fill" style={{ width: `${(r.value / max) * 100}%`, background: r.color || "var(--primary)" }} /></div>
        </div>
      ))}
    </div>
  );
}

function Tile({ Icon, label, value, sub, points, color, max }) {
  return (
    <div className="card perf-tile stack" style={{ gap: 6 }}>
      <div className="row-tight small muted" style={{ gap: 6 }}><Icon size={14} style={{ color }} /> {label}</div>
      <strong className="perf-big tnum"><CountUp value={value} /></strong>
      {points && <Spark points={points} color={color} max={max} />}
      {sub && <span className="small muted">{sub}</span>}
    </div>
  );
}

function Live() {
  const [paused, setPaused] = useState(false);
  const { data, isLoading, error, refetch, isFetching, fulfilledTimeStamp } = useGetPerformanceStatusQuery(undefined, {
    pollingInterval: paused ? 0 : POLL_MS,
    skipPollingIfUnfocused: true,
  });
  const [clear, clearState] = useClearPerformanceCacheMutation();
  const confirm = useConfirm();
  const [history, setHistory] = useState([]);
  const last = useRef(null);
  const [, tick] = useState(0);

  // One point per answer; rates come from the change since the last one.
  useEffect(() => {
    if (!data?.at || last.current?.at === data.at) return;
    const prev = last.current;
    const r = data.redis || {};
    const sameServer = prev && prev.server?.pid === data.server?.pid && prev.server?.host === data.server?.host;
    const dHits = sameServer ? data.cache.hits - prev.cache.hits : null;
    const dMiss = sameServer ? data.cache.misses - prev.cache.misses : null;
    const reads = dHits !== null && dHits >= 0 && dMiss >= 0 ? dHits + dMiss : null;
    const point = {
      ops: r.opsPerSec ?? null,
      memory: r.memoryBytes ?? null,
      ping: r.pingMs ?? null,
      keys: r.keys?.total ?? null,
      reads: reads === null ? null : reads / (POLL_MS / 1000),
      hitRate: reads ? (dHits / reads) * 100 : null,
      held: data.autosave?.held ?? null,
      rss: data.server?.rssBytes ?? null,
    };
    last.current = data;
    setHistory((h) => [...h, point].slice(-KEEP));
  }, [data]);

  // "Updated 3s ago" keeps counting between answers.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  if (error) return <ErrorNote error={error} />;
  if (isLoading) return <Loading />;

  const r = data.redis || {};
  const isRedis = r.backend === "redis";
  const up = isRedis ? r.connected : true;
  const series = (k) => history.map((p) => p[k]);
  const q = data.queue;
  const jobs = q?.jobs ? Object.entries(q.jobs) : [];
  const reuse = data.reuse?.last30Days || [];
  const served = reuse.reduce((n, x) => n + x.served, 0);
  const savedUsd = reuse.reduce((n, x) => n + x.savedUsd, 0);
  const ago = fulfilledTimeStamp ? Math.max(0, Math.round((Date.now() - fulfilledTimeStamp) / 1000)) : null;

  const kinds = {};
  for (const [k, n] of Object.entries(r.keys?.groups || {})) {
    const label = KEY_KINDS[k] || k;
    kinds[label] = (kinds[label] || 0) + n;
  }
  const keyRows = Object.entries(kinds)
    .sort((a, b) => b[1] - a[1])
    .map(([label, value], i) => ({ label, value, color: KIND_COLORS[i % KIND_COLORS.length] }));

  const memMax = r.maxBytes || r.peakBytes || null;
  const memPct = memMax && r.memoryBytes ? (r.memoryBytes / memMax) * 100 : null;
  const redisHit = r.keyspaceHits + r.keyspaceMisses ? (r.keyspaceHits / (r.keyspaceHits + r.keyspaceMisses)) * 100 : null;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="card perf-hero">
        <div className="row-tight" style={{ gap: 14, alignItems: "center" }}>
          <span className={`perf-pulse${up ? "" : " perf-pulse-bad"}${paused ? " perf-pulse-paused" : ""}`} />
          <div className="stack" style={{ gap: 2 }}>
            <strong style={{ fontSize: 18 }}>
              {isRedis ? (r.connected ? "Redis connected" : "Redis not reachable") : "Running without Redis"}
            </strong>
            <span className="small muted">
              {isRedis
                ? r.connected
                  ? `Redis ${r.version || ""} · up ${since(r.uptimeS)} · ${num(r.clients)} connection(s) · ping ${r.pingMs} ms`
                  : r.error || "Requests still go through; shared features wait for it to come back."
                : "Everything works on one server. Set REDIS_URL to share state between servers."}
            </span>
          </div>
        </div>
        <div className="row-tight" style={{ gap: 8, flexWrap: "wrap" }}>
          <span className="small muted">{paused ? "Paused" : ago === null ? "" : `Updated ${ago}s ago`}</span>
          <button type="button" className="btn btn-sm btn-quiet" onClick={() => setPaused(!paused)}>
            {paused ? <><Play size={14} /> Resume</> : <><Pause size={14} /> Pause</>}
          </button>
          <button type="button" className="btn btn-sm btn-quiet" onClick={refetch} disabled={isFetching}>
            <RotateCw size={14} className={isFetching ? "spin" : ""} /> Refresh
          </button>
        </div>
      </div>

      <div className="perf-grid">
        {isRedis && r.connected && (
          <>
            <Tile Icon={Zap} label="Redis commands / second" value={num(r.opsPerSec)} points={series("ops")} color="var(--primary)" sub={`${num(r.commands)} since Redis started`} />
            <Tile Icon={MemoryStick} label="Redis memory" value={bytes(r.memoryBytes)} points={series("memory")} color="var(--accent)" sub={`Peak ${bytes(r.peakBytes)}${r.maxBytes ? ` · limit ${bytes(r.maxBytes)}` : " · no limit set"}`} />
            <Tile Icon={KeyRound} label="Keys for this app" value={num(r.keys?.total)} points={series("keys")} color="var(--ai)" sub={r.keys?.capped ? "Counted up to 20,000" : "Under this app's prefix"} />
          </>
        )}
        <Tile Icon={Database} label="Cached reads / second" value={series("reads").slice(-1)[0] === null || !history.length ? "—" : (series("reads").slice(-1)[0] || 0).toFixed(1)} points={series("reads")} color="var(--correct)" sub={`${num(data.cache.hits)} hits · ${num(data.cache.misses)} misses on this server`} />
        <Tile Icon={Server} label="This server's memory" value={bytes(data.server?.rssBytes)} points={series("rss")} color="var(--warning)" sub={`${data.server?.host} · up ${since(data.server?.uptimeS)} · load ${data.server?.load?.toFixed(2)} on ${data.server?.cpus} CPU`} />
      </div>

      <div className="perf-grid perf-grid-wide">
        <div className="card stack" style={{ gap: 12 }}>
          <h3 style={{ margin: 0 }}>Cache</h3>
          <div className="row-tight" style={{ gap: 16, justifyContent: "space-around", alignItems: "flex-start", flexWrap: "wrap" }}>
            <Ring value={data.cache.hitRate} color="var(--correct)" label="from cache" sub="App pages, since this server started" />
            {isRedis && r.connected && <Ring value={redisHit} color="var(--primary)" label="key hits" sub="Every Redis lookup, since Redis started" />}
          </div>
          <div className="stack" style={{ gap: 4 }}>
            <span className="small muted">Hit rate, last five minutes</span>
            <Spark points={series("hitRate")} color="var(--correct)" max={100} height={56} />
          </div>
          {data.cache.errors ? <span className="small" style={{ color: "var(--incorrect)" }}>{num(data.cache.errors)} cache error(s): those reads went to the database.</span> : null}
          <ErrorNote error={clearState.error} />
          <div>
            <button
              type="button"
              className="btn btn-sm btn-quiet"
              disabled={clearState.isLoading}
              onClick={async () => { if (await confirm({ title: "Clear all caches?", body: "Every server works the cached pages out again from the database. Nothing is lost.", confirmLabel: "Clear" })) clear(); }}
            >
              <Database size={14} /> {clearState.isLoading ? "Clearing" : "Clear all caches"}
            </button>
          </div>
        </div>

        {isRedis && r.connected && (
          <div className="card stack" style={{ gap: 12 }}>
            <h3 style={{ margin: 0 }}>What Redis holds</h3>
            {memPct !== null && (
              <div className="stack" style={{ gap: 4 }}>
                <div className="spread small"><span>Memory {r.maxBytes ? "of limit" : "of peak"}</span><span className="tnum muted">{Math.round(memPct)}%</span></div>
                <div className="perf-track perf-track-lg"><div className="perf-fill" style={{ width: `${memPct}%`, background: memPct > 85 ? "var(--incorrect)" : "var(--accent)" }} /></div>
              </div>
            )}
            <Bars rows={keyRows} empty="No keys yet" />
          </div>
        )}

        <div className="card stack" style={{ gap: 12 }}>
          <h3 style={{ margin: 0 }}>Exam autosave</h3>
          <div className="row-tight" style={{ gap: 8 }}>
            <span className={`pill ${data.autosave?.mode === "buffered" ? "pill-good" : ""}`}>{data.autosave?.mode === "buffered" ? "Buffered in Redis" : "Straight to the database"}</span>
          </div>
          {data.autosave?.mode === "buffered" ? (
            <>
              <div className="stack" style={{ gap: 4 }}>
                <span className="small muted">Attempts waiting to be written</span>
                <Spark points={series("held")} color="var(--warning)" height={56} />
              </div>
              <div className="perf-stats">
                <div><strong className="tnum"><CountUp value={num(data.autosave.held)} /></strong><span className="small muted">waiting now</span></div>
                <div><strong className="tnum"><CountUp value={num(data.autosave.written)} /></strong><span className="small muted">written by this server</span></div>
                <div><strong className="tnum"><CountUp value={num(data.autosave.failed)} /></strong><span className="small muted">writes retried</span></div>
              </div>
            </>
          ) : (
            <span className="small muted">Each answer is written as it is given. Buffering (Settings tab) needs Redis.</span>
          )}
          {data.autosave?.swept ? <span className="small muted">{num(data.autosave.swept)} timed-out attempt(s) closed by the sweeper</span> : null}
        </div>

        <div className="card stack" style={{ gap: 12 }}>
          <div className="spread">
            <h3 style={{ margin: 0 }}>Background jobs</h3>
            <span className="small muted">{q?.backend === "redis" ? "In Redis: survive a restart" : "In this server"}</span>
          </div>
          {jobs.length ? jobs.map(([name, c]) => {
            const total = Math.max(1, (c.waiting || 0) + (c.active || 0) + (c.failed || 0) + (c.completed || 0));
            const part = (n, color) => (n ? <div style={{ width: `${(n / total) * 100}%`, background: color }} title={String(n)} /> : null);
            return (
              <div key={name} className="stack" style={{ gap: 4 }}>
                <div className="spread small">
                  <span>{name === "exam-report" ? "Exam reports" : name}</span>
                  <span className="muted tnum">{num(c.waiting)} waiting · {num(c.active)} running · {num(c.failed)} failed</span>
                </div>
                <div className="perf-track perf-stack">
                  {part(c.completed, "var(--correct)")}
                  {part(c.active, "var(--primary)")}
                  {part(c.waiting, "var(--warning)")}
                  {part(c.failed, "var(--incorrect)")}
                </div>
              </div>
            );
          }) : <span className="small muted">None yet</span>}
        </div>

        {data.reuse && (reuse.length > 0 || data.reuse.saved?.active) ? (
          <div className="card stack" style={{ gap: 12 }}>
            <h3 style={{ margin: 0 }}>Saved AI results · 30 days</h3>
            <div className="perf-stats">
              <div><strong className="tnum"><CountUp value={num(served)} /></strong><span className="small muted">served again</span></div>
              <div><strong className="tnum"><CountUp value={`$${savedUsd.toFixed(2)}`} /></strong><span className="small muted">AI calls not made</span></div>
              <div><strong className="tnum"><CountUp value={num(data.reuse.saved?.pending_review || 0)} /></strong><span className="small muted">waiting for review</span></div>
            </div>
            <Bars rows={reuse.slice().sort((a, b) => b.served - a.served).map((x, i) => ({ label: x.feature, value: x.served, color: KIND_COLORS[i % KIND_COLORS.length] }))} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SettingsForm() {
  const { data, isLoading, error } = useGetPerformanceQuery();
  const [save, state] = useUpdatePerformanceMutation();
  const [form, setForm] = useState(null);
  useEffect(() => {
    if (data) {
      setForm({
        cache: { ...data.cache }, reuse: { ...data.reuse }, background: { ...data.background },
        leaderboard: data.leaderboard, leaderboardMinutes: data.leaderboardMinutes,
        autosave: data.autosave, autosaveFlushSeconds: data.autosaveFlushSeconds, savedCosts: { ...data.savedCosts },
      });
    }
  }, [data]);
  if (error) return <ErrorNote error={error} />;
  if (isLoading || !form) return <Loading />;
  const set = (group, patch) => setForm({ ...form, [group]: { ...form[group], ...patch } });
  const top = (patch) => setForm({ ...form, ...patch });
  const noRedis = !data.redis;

  return (
    <div className="stack">
      <div className="card stack">
        <h2 style={{ margin: 0 }}>Cached pages</h2>
        <p className="muted small" style={{ margin: 0 }}>Pages every student sees the same are worked out once and kept. An edit drops them at once; the age below is only a safety net.</p>
        {CACHE_GROUPS.map(([key, label, hint]) => (
          <label key={key} className="row-tight">
            <input type="checkbox" checked={form.cache[key] !== false} onChange={(e) => set("cache", { [key]: e.target.checked })} />
            <span><strong>{label}</strong> <span className="muted small">— {hint}</span></span>
          </label>
        ))}
        <Field label="Keep for at most (minutes)">
          <input className="input tnum" type="number" min={1} max={1440} style={{ width: 120 }} value={form.cache.maxAgeMinutes} onChange={(e) => set("cache", { maxAgeMinutes: Number(e.target.value) })} />
        </Field>
      </div>

      {data.ai && (
        <div className="card stack">
          <h2 style={{ margin: 0 }}>Saved AI results</h2>
          <p className="muted small" style={{ margin: 0 }}>Serve an AI result made for one student to the next who asks the same thing, instead of a new AI call. Editing a question's text, options or answer stops its old results being served.</p>
          <div className="row-tight" style={{ flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
            <Field label="Similar questions">
              <Choice value={form.reuse.similar} onChange={(v) => set("reuse", { similar: v })} options={[["mix", "Mix saved and new"], ["saved", "Saved when there is one"], ["fresh", "Always new"]]} />
            </Field>
            {form.reuse.similar === "mix" && (
              <>
                <Field label="Sets kept per question"><input className="input tnum" type="number" min={1} max={20} style={{ width: 90 }} value={form.reuse.poolSize} onChange={(e) => set("reuse", { poolSize: Number(e.target.value) })} /></Field>
                <Field label="Serve each set this often, then make another"><input className="input tnum" type="number" min={1} max={10000} style={{ width: 110 }} value={form.reuse.servesPerSet} onChange={(e) => set("reuse", { servesPerSet: Number(e.target.value) })} /></Field>
              </>
            )}
            <Field label="New sets">
              <Choice value={form.reuse.approval} onChange={(v) => set("reuse", { approval: v })} options={[["auto", "Served at once"], ["review", "Wait for my approval"]]} />
            </Field>
          </div>
          <div className="row-tight" style={{ flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
            <Field label="Hints"><Choice value={form.reuse.hints} onChange={(v) => set("reuse", { hints: v })} options={[["saved", "Saved when there is one"], ["fresh", "Always new"]]} /></Field>
            {form.reuse.hints !== "fresh" && (
              <Field label="New saved hints"><Choice value={form.reuse.hintApproval || "auto"} onChange={(v) => set("reuse", { hintApproval: v })} options={[["auto", "Served at once"], ["review", "Wait for my approval"]]} /></Field>
            )}
            <Field label="Explanations of a wrong answer"><Choice value={form.reuse.explanations} onChange={(v) => set("reuse", { explanations: v })} options={[["saved", "Saved when there is one"], ["fresh", "Always new"]]} /></Field>
            <Field label="A student is charged for a saved result">
              <Choice value={form.reuse.savedCharge} onChange={(v) => set("reuse", { savedCharge: v })} options={[["reduced", "The saved prices below"], ["full", "The normal price"], ["free", "Nothing"]]} />
            </Field>
          </div>
          {form.reuse.savedCharge === "reduced" && (
            <div className="row-tight" style={{ flexWrap: "wrap", gap: 12 }}>
              {SAVED_COSTS.map(([key, label]) => (
                <Field key={key} label={`${label} (credits)`}>
                  <input className="input tnum" type="number" min={0} max={1000} style={{ width: 90 }} value={form.savedCosts[key]} onChange={(e) => set("savedCosts", { [key]: Number(e.target.value) })} />
                </Field>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="card stack">
        <h2 style={{ margin: 0 }}>Background work</h2>
        <div className="row-tight" style={{ flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
          {data.ai && (
            <Field label="AI report on an exam result" hint="In the background, handing in never waits for the AI. The result page shows the report when it's ready.">
              <Choice value={form.background.examReport} onChange={(v) => set("background", { examReport: v })} options={[["queued", "In the background"], ["instant", "While the student waits"]]} />
            </Field>
          )}
          <Field label="Document runs at once" hint="Across every server. More wait their turn.">
            <input className="input tnum" type="number" min={1} max={20} style={{ width: 90 }} value={form.background.ingestConcurrency} onChange={(e) => set("background", { ingestConcurrency: Number(e.target.value) })} />
          </Field>
        </div>
      </div>

      <div className="card stack">
        <h2 style={{ margin: 0 }}>Leaderboards and exams</h2>
        <div className="row-tight" style={{ flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
          <Field label="Leaderboards">
            <Choice value={form.leaderboard} onChange={(v) => top({ leaderboard: v })} options={[["live", "Live: move as exams are graded"], ["periodic", "Refreshed every few minutes"]]} />
          </Field>
          {form.leaderboard === "periodic" && (
            <Field label="Every (minutes)"><input className="input tnum" type="number" min={1} max={1440} style={{ width: 90 }} value={form.leaderboardMinutes} onChange={(e) => top({ leaderboardMinutes: Number(e.target.value) })} /></Field>
          )}
          <Field label="Exam autosave" hint={noRedis ? "Buffering needs Redis (REDIS_URL); without it every save goes straight to the database." : "Buffered: answers are held in Redis and written every few seconds and on hand-in. For large exams."}>
            <Choice value={form.autosave} onChange={(v) => top({ autosave: v })} options={[["buffered", "Buffered"], ["direct", "Straight to the database"]]} />
          </Field>
          {form.autosave === "buffered" && !noRedis && (
            <Field label="Write every (seconds)"><input className="input tnum" type="number" min={2} max={120} style={{ width: 90 }} value={form.autosaveFlushSeconds} onChange={(e) => top({ autosaveFlushSeconds: Number(e.target.value) })} /></Field>
          )}
        </div>
      </div>

      <ErrorNote error={state.error} />
      <div><button className="btn" disabled={state.isLoading} onClick={() => save(form)}>{state.isLoading ? "Saving" : state.isSuccess ? "Saved" : "Save settings"}</button></div>
    </div>
  );
}

const KINDS = { similar: "Similar questions", hint: "Hints", explanation: "Explanation" };
const STATES = { active: ["Served", "pill-good"], pending_review: ["Waiting for review", ""], retired: ["Retired", "pill-bad"] };

const Preview = ({ row }) => {
  if (row.kind === "hint") return <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>{(row.hints || []).map((h, i) => <li key={i}><Latex>{h}</Latex></li>)}</ol>;
  if (row.kind === "explanation") return <Latex as="div" className="small">{row.payload?.explanation || JSON.stringify(row.payload)}</Latex>;
  return (
    <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>
      {(row.payload?.questions || []).map((q, i) => (
        <li key={i} style={{ marginBottom: 8 }}>
          <Latex as="div">{q.question}</Latex>
          <div className="muted" style={{ display: "flex", flexWrap: "wrap", gap: "2px 14px", marginTop: 2 }}>
            {(q.options || []).map((o) => (
              <span key={o.key} style={o.key === q.correctOption ? { color: "var(--correct)", fontWeight: 600 } : undefined}>
                {o.key === q.correctOption ? "✓ " : ""}{o.key}) <Latex>{o.text}</Latex>
              </span>
            ))}
          </div>
          {q.explanation && <Latex as="div" className="muted" style={{ marginTop: 2 }}>{q.explanation}</Latex>}
        </li>
      ))}
    </ol>
  );
};

function SavedResults() {
  const [status, setStatus] = useState("pending_review");
  const [kind, setKind] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);
  const { data, isLoading, error } = useGetSavedAiResultsQuery({ status: status || undefined, kind: kind || undefined, page });
  const [review, reviewState] = useReviewSavedAiResultMutation();
  const [remove, removeState] = useDeleteSavedAiResultMutation();
  const confirm = useConfirm();
  const [added, setAdded] = useState(null);
  const busy = reviewState.isLoading || removeState.isLoading;
  const del = async (id) => {
    if (await confirm({ title: "Delete this saved result?", body: "It is removed for good and never served again. Retire keeps it without serving it.", confirmLabel: "Delete", tone: "danger" })) {
      if (open === id) setOpen(null);
      remove(id);
    }
  };
  useEffect(() => setPage(1), [status, kind]);
  const act = async (id, action) => {
    const out = await review({ id, action }).unwrap().catch(() => null);
    if (action === "add-to-bank" && out) setAdded(out.added);
  };
  return (
    <div className="card stack" style={{ padding: 0 }}>
      <div className="spread" style={{ padding: "16px 16px 0", flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ margin: 0 }}>Saved AI results</h2>
        <div className="row-tight">
          <select className="select" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">Every kind</option>
            {Object.entries(KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any state</option>
            {Object.entries(STATES).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
      </div>
      <ErrorNote error={error || reviewState.error || removeState.error} />
      {added !== null && <p className="small" style={{ margin: "0 16px" }}>{added} question{added === 1 ? "" : "s"} added to Review.</p>}
      {isLoading ? <Loading /> : !data?.items.length ? (
        <div style={{ padding: 16 }}><Empty icon={Sparkles} title={status === "pending_review" ? "Nothing waiting for review" : "Nothing saved yet"} hint="Results are saved as students use similar questions, hints and explanations." /></div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead><tr><th>Question</th><th>Kind</th><th>Served</th><th>State</th><th></th></tr></thead>
            <tbody>
              {data.items.map((row) => (
                <tr key={row._id} style={{ verticalAlign: "top" }}>
                  <td style={{ maxWidth: 420 }}>
                    <button type="button" onClick={() => setOpen(open === row._id ? null : row._id)} style={{ textAlign: "left", background: "none", border: 0, padding: 0, color: "inherit", textDecoration: "underline", cursor: "pointer", font: "inherit" }}>
                      {row.question?.question
                        ? <Latex as="span" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{row.question.question}</Latex>
                        : "(question deleted)"}
                    </button>
                    {open === row._id && <div style={{ marginTop: 8 }}><Preview row={row} /></div>}
                  </td>
                  <td className="small">{KINDS[row.kind]}{row.variant ? <span className="muted"> · {row.variant}</span> : null}</td>
                  <td className="tnum">{row.servedCount}</td>
                  <td><span className={`pill ${STATES[row.status][1]}`}>{STATES[row.status][0]}</span></td>
                  <td className="row-tight" style={{ justifyContent: "flex-end" }}>
                    {row.status !== "active" && <button type="button" className="btn btn-sm btn-quiet" disabled={busy} onClick={() => act(row._id, "approve")}><Check size={14} /> Serve</button>}
                    {row.status !== "retired" && <button type="button" className="btn btn-sm btn-quiet" disabled={busy} onClick={() => act(row._id, "reject")}><X size={14} /> Retire</button>}
                    {row.kind === "similar" && <button type="button" className="btn btn-sm btn-quiet" disabled={busy} onClick={() => act(row._id, "add-to-bank")} title="Copies the set into the question bank, waiting in Review"><Library size={14} /> To question bank</button>}
                    <button type="button" className="btn btn-sm btn-quiet" style={{ color: "var(--incorrect)" }} disabled={busy} onClick={() => del(row._id)} title="Delete for good"><Trash2 size={14} /> Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: "0 16px 16px" }}><Pager page={data.page} pages={data.pages} total={data.total} onChange={setPage} /></div>
        </div>
      )}
    </div>
  );
}

const ago = (ms) => {
  const m = Math.round(Math.abs(ms) / 60000);
  return m < 1 ? "under a minute" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

export default function Performance() {
  const { data } = useGetPerformanceQuery();
  const [tab, setTab] = useState(() => new URLSearchParams(window.location.search).get("tab") || "live");
  const TABS = [
    ["live", "Live", Activity],
    ["classes", "Live classes", Radio],
    ["settings", "Settings", SlidersHorizontal],
    ...(data?.ai ? [["saved", "Saved AI results", Sparkles]] : []),
  ];
  return (
    <div className="page">
      <div className="page-head">
        <h1>Performance</h1>
      </div>
      <div className="row-tight" style={{ marginBottom: 16, flexWrap: "wrap" }}>
        {TABS.map(([value, label, Icon]) => (
          <button key={value} className={`pill pill-btn row-tight${tab === value ? " pill-on" : ""}`} style={{ gap: 5 }} onClick={() => setTab(value)}>
            <Icon size={12} /> {label}
          </button>
        ))}
      </div>
      {tab === "live" && <Live />}
      {tab === "classes" && <LiveClassMonitor />}
      {tab === "settings" && <SettingsForm />}
      {tab === "saved" && data?.ai && <SavedResults />}
    </div>
  );
}
