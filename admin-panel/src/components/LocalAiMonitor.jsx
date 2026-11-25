import { useState } from "react";
import { Cpu, Clock, Loader2, Pause, Play, Gauge, MemoryStick } from "lucide-react";
import { useGetLocalAiQuery } from "../api/performanceApi";
import { Loading, ErrorNote, Empty } from "./bits";

// Performance → Local AI: what the built-in model (Settings → AI →
// Built-in) is doing. The request running now (loading the model, reading
// the prompt, writing, with tokens so far), the ones waiting their turn
// (it answers one at a time), and the last 50 that finished. Backend:
// ai/embedded.js activity().

const POLL_MS = 2000;

const secs = (ms) => {
  if (ms === null || ms === undefined) return "—";
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
};
const clock = (t) => (t ? new Date(t).toLocaleTimeString() : "—");
// "practice-explain" / "writtenGrading" -> "Practice explain" / "Written grading"
const label = (f) => {
  if (!f) return "AI request";
  const s = String(f).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]+/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const STATE = {
  waiting: ["Waiting", "var(--text-muted)"],
  loading: ["Loading model", "var(--warning)"],
  generating: ["Working", "var(--primary)"],
  done: ["Done", "var(--correct)"],
  failed: ["Failed", "var(--incorrect)"],
  stopped: ["Stopped", "var(--text-muted)"],
};
const StateTag = ({ state }) => {
  const [text, color] = STATE[state] || [state, "var(--text-muted)"];
  return <span className="pill" style={{ color, borderColor: color, fontWeight: 600 }}>{text}</span>;
};

function Stat({ Icon, name, value, sub }) {
  return (
    <div className="card stack" style={{ gap: 4 }}>
      <div className="row-tight hint" style={{ gap: 6 }}><Icon size={14} /> {name}</div>
      <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
      {sub && <div className="hint">{sub}</div>}
    </div>
  );
}

export default function LocalAiMonitor() {
  const [paused, setPaused] = useState(false);
  const { data, isLoading, error } = useGetLocalAiQuery(undefined, { pollingInterval: paused ? 0 : POLL_MS });
  if (isLoading) return <Loading />;
  if (error) return <ErrorNote error={error} />;

  const { server, running, waiting = [], log = [], machine, context, averageTokensPerSecond, now } = data || {};
  const p = running?.progress;
  const elapsed = running?.startedAt ? now - running.startedAt : null;
  const phase = running?.state === "loading" ? "Loading the model into memory" : p?.phase === "writing" ? "Writing the answer" : running ? "Reading the prompt" : null;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="spread">
        <p className="hint" style={{ margin: 0 }}>
          The built-in model answers one request at a time on this server's CPU. Updates every {POLL_MS / 1000} seconds.
        </p>
        <button type="button" className="btn btn-sm btn-quiet" onClick={() => setPaused((v) => !v)}>
          {paused ? <><Play size={13} /> Resume</> : <><Pause size={13} /> Pause</>}
        </button>
      </div>

      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <Stat Icon={Cpu} name="Model" value={server ? server.model : "Not loaded"} sub={server ? `${server.device?.backend && server.device.backend !== "cpu" ? `GPU (${server.device.backend}${server.device.offload ? `, ${server.device.offload.layers}/${server.device.offload.of} layers` : ""})` : "CPU"} · loaded ${clock(server.loadedAt)} · ${context.toLocaleString()} token context` : "Loads on the next request"} />
        <Stat Icon={Clock} name="Waiting" value={waiting.length} sub={waiting.length ? `Oldest waiting ${secs(now - waiting[0].queuedAt)}` : "No queue"} />
        <Stat Icon={Gauge} name="Speed" value={averageTokensPerSecond ? `${averageTokensPerSecond} tok/s` : "—"} sub="Average of the last 10 answers" />
        <Stat Icon={MemoryStick} name="Server" value={`${machine?.freeMemGb ?? "—"} GB free`} sub={`of ${machine?.totalMemGb ?? "—"} GB · ${machine?.cpus ?? "—"} CPU threads`} />
      </div>

      {data?.gpuFailed && (
        <div className="banner banner-warn">The GPU ({data.gpuFailed.backend}) did not start, so the model runs on the CPU: {data.gpuFailed.reason}</div>
      )}

      <div className="card stack" style={{ gap: 10 }}>
        <b>Now</b>
        {running ? (
          <div className="stack" style={{ gap: 6 }}>
            <div className="row-tight" style={{ gap: 8, flexWrap: "wrap" }}>
              <Loader2 size={15} className="spin" />
              <b>{label(running.feature)}</b>
              <StateTag state={running.state} />
              {running.image && <span className="pill">With image</span>}
            </div>
            <div className="small">{phase} · {secs(elapsed)} so far</div>
            <div className="hint">
              Prompt about {(p?.promptTokens || running.promptTokens).toLocaleString()} tokens
              {p?.written ? ` · ${p.written.toLocaleString()} of up to ${running.maxTokens.toLocaleString()} tokens written` : ` · up to ${running.maxTokens.toLocaleString()} tokens to write`}
              {p?.tokensPerSecond ? ` · ${p.tokensPerSecond} tok/s` : ""}
            </div>
          </div>
        ) : <span className="hint">Idle.</span>}
      </div>

      {waiting.length > 0 && (
        <div className="card stack" style={{ gap: 8 }}>
          <b>In line</b>
          <table className="table">
            <thead><tr><th>#</th><th>Request</th><th>Waiting</th><th>Prompt</th></tr></thead>
            <tbody>
              {waiting.map((j, i) => (
                <tr key={j.id}>
                  <td>{i + 1}</td>
                  <td>{label(j.feature)}{j.image ? " (image)" : ""}</td>
                  <td>{secs(now - j.queuedAt)}</td>
                  <td>~{j.promptTokens.toLocaleString()} tokens</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card stack" style={{ gap: 8 }}>
        <b>Log</b>
        {log.length ? (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead><tr><th>Ended</th><th>Request</th><th>Result</th><th>Waited</th><th>Took</th><th>Tokens in / out</th><th>Speed</th></tr></thead>
              <tbody>
                {log.map((l) => (
                  <tr key={l.id} title={l.error || ""}>
                    <td>{clock(l.endedAt)}</td>
                    <td>{label(l.feature)}{l.image ? " (image)" : ""}</td>
                    <td><StateTag state={l.state} />{l.finishReason === "length" && <span className="hint"> cut off</span>}</td>
                    <td>{secs(l.waitMs)}</td>
                    <td>{secs(l.ms)}</td>
                    <td>{l.promptTokens ? l.promptTokens.toLocaleString() : "—"} / {l.completionTokens ? l.completionTokens.toLocaleString() : "—"}</td>
                    <td>{l.tokensPerSecond ? `${l.tokensPerSecond} tok/s` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty icon={Cpu} title="No requests yet" hint="Since the backend last started." />}
      </div>
    </div>
  );
}
