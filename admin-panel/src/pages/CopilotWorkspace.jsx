import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Send, Check, Loader2, Search, Plus, Inbox, ShieldCheck, Bot, Trash2 } from "lucide-react";
import {
  useGetAgentRunsQuery, useCreateAgentRunMutation, useReviseAgentRunMutation, useDecideAgentStepsMutation, useCancelAgentRunMutation, useDeleteAgentRunMutation,
} from "../api/agentApi";
import { ErrorNote, useConfirm } from "../components/bits";
import { AGENT_ICONS, CopilotIcon } from "../components/AgentIcons";
import { RunSteps, FormRun, RUN_STATUS, CAPABILITIES, ago } from "./Agents";

// The copilot as a workspace: requests on the left, the conversation in
// the middle, the plan on the right. Same requests, plans and approvals as
// the classic page (Agents.jsx); only the layout differs.
export default function CopilotWorkspace({ status, modeText, switcher }) {
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => { const t = setTimeout(() => setQ(search.trim()), 350); return () => clearTimeout(t); }, [search]);
  const [fast, setFast] = useState(false);
  const runsQ = useGetAgentRunsQuery({ status: "", agent: "", q, page: 1 }, { pollingInterval: fast ? 2000 : 15000 });
  const waitingQ = useGetAgentRunsQuery({ status: "waiting", agent: "", q: "", page: 1 }, { pollingInterval: fast ? 2000 : 15000 });
  const runs = runsQ.data?.runs || [];
  useEffect(() => setFast(runs.some((r) => ["planning", "running"].includes(r.status))), [runs]);
  const [selectedId, setSelectedId] = useState(null);
  const selected = runs.find((r) => r._id === selectedId) || (waitingQ.data?.runs || []).find((r) => r._id === selectedId) || null;
  const [text, setText] = useState("");
  const [create, { isLoading: creating, error: createError }] = useCreateAgentRunMutation();
  const [revise, { isLoading: revising, error: reviseError }] = useReviseAgentRunMutation();
  const [decide, { isLoading: deciding }] = useDecideAgentStepsMutation();
  const [cancel] = useCancelAgentRunMutation();
  const [remove, { isLoading: removing, error: removeError }] = useDeleteAgentRunMutation();
  const confirm = useConfirm();
  // Same as the classic page: anything still waiting is cancelled first; nothing done is undone.
  const del = async (run) => {
    const ok = await confirm({
      title: "Delete this request?",
      body: run.status === "awaiting" ? "Its steps waiting for approval are cancelled. Nothing it already did is undone." : "It's removed from this page. Nothing it already did is undone.",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    const r = await remove(run._id);
    if (!r.error && run._id === selectedId) setSelectedId(null);
  };
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);

  const follow = selected && selected.agent === "copilot" && selected.canRevise;
  const send = async () => {
    const t = text.trim();
    if (!t) return;
    if (follow) {
      const r = await revise({ id: selected._id, message: t });
      if (!r.error) { setText(""); setFast(true); }
    } else {
      const r = await create({ request: t, timezone: tz, form: false });
      if (!r.error) { setText(""); setSelectedId(r.data?._id || null); setFast(true); }
    }
  };

  // The conversation: the saved chat, or (older requests) the request and reply.
  const chat = selected
    ? (selected.chat?.length ? selected.chat : [{ from: "staff", text: selected.request }, ...(selected.reply ? [{ from: "agent", text: selected.reply }] : [])])
    : [];
  const RunIcon = (selected && AGENT_ICONS[selected.agent]) || Bot;
  const waiting = (waitingQ.data?.runs || []).filter((r) => r.status === "awaiting");
  const pending = selected ? selected.steps.filter((s) => s.needsApproval) : [];
  const busy = selected && ["planning", "running"].includes(selected.status);

  return (
    <div className="page cw-page">
      <div className="spread" style={{ gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <div className="row-tight" style={{ gap: 8, flexWrap: "wrap" }}>
          <h1 className="row-tight" style={{ gap: 10, margin: 0 }}><CopilotIcon size={24} style={{ color: "var(--primary)" }} /> Copilot</h1>
          {(status?.background || []).map((a) => {
            const Icon = AGENT_ICONS[a.key] || Bot;
            return (
              <span key={a.key} className="pill row-tight" style={{ gap: 5 }} title={a.enabled ? "On" : "Off"}>
                <span className="cw-dot" style={{ background: a.enabled ? "var(--correct)" : "var(--border)" }} />
                <Icon size={12} /> {a.label}
              </span>
            );
          })}
        </div>
        <div className="row-tight" style={{ gap: 8 }}>
          {modeText && <span className="pill row-tight" style={{ gap: 5 }}><ShieldCheck size={12} /> {modeText}</span>}
          {switcher}
        </div>
      </div>

      {waiting.length > 0 && (
        <div className="cw-waiting">
          <strong className="row-tight" style={{ gap: 6 }}><Inbox size={15} /> {waiting.length} waiting for you</strong>
          {waiting.slice(0, 4).map((r) => (
            <span key={r._id} className="cw-wait-item">
              <button className="link-btn" onClick={() => setSelectedId(r._id)}>{r.request.length > 48 ? `${r.request.slice(0, 48)}…` : r.request}</button>
              {!r.form && (
                <button className="btn btn-sm btn-primary" disabled={deciding} onClick={() => decide({ id: r._id, stepIds: "all", approve: true })}><Check size={12} /> Approve</button>
              )}
            </span>
          ))}
        </div>
      )}

      <div className="cw-grid">
        <div className="card cw-col">
          <div className="spread cw-head">
            <strong>Requests</strong>
            <button className="btn btn-sm" onClick={() => { setSelectedId(null); setText(""); }}><Plus size={13} /> New</button>
          </div>
          <div className="search-wrap" style={{ padding: "8px 10px" }}>
            <Search size={14} className="search-icon" style={{ left: 20 }} />
            <input className="input" style={{ paddingLeft: 32 }} placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value.slice(0, 100))} />
          </div>
          <div className="cw-scroll">
            {runs.map((r) => {
              const [cls, label] = RUN_STATUS[r.status] || ["pill", r.status];
              return (
                <button key={r._id} className={`cw-item${r._id === selectedId ? " cw-item-on" : ""}`} onClick={() => setSelectedId(r._id)}>
                  <span className="cw-item-title">{r.request}</span>
                  <span className="hint row-tight" style={{ gap: 6 }}><span className={cls}>{label}</span>{ago(r.createdAt)}</span>
                </button>
              );
            })}
            {!runsQ.isLoading && runs.length === 0 && <div className="hint" style={{ padding: 14 }}>No requests yet.</div>}
          </div>
        </div>

        <div className="card cw-col">
          <div className="spread cw-head">
            <strong>{selected ? (selected.agent === "copilot" ? "Conversation" : selected.agentLabel) : "New request"}</strong>
            {selected && !busy && (
              <button className="icon-btn icon-btn-danger" title="Delete" aria-label="Delete request" disabled={removing} onClick={() => del(selected)}><Trash2 size={14} /></button>
            )}
          </div>
          <div className="cw-scroll cw-thread">
            {!selected && (
              <div className="stack" style={{ gap: 8 }}>
                <span className="hint">What it can do: tap one for an example to edit.</span>
                <div className="row-tight" style={{ gap: 6, flexWrap: "wrap" }}>
                  {CAPABILITIES.map(([Icon, label, example]) => (
                    <button key={label} className="pill pill-btn row-tight" style={{ gap: 5 }} title={example} onClick={() => setText(example)}><Icon size={12} /> {label}</button>
                  ))}
                </div>
                <span className="hint">
                  {status?.batches?.length ? <>Can act on: {status.batches.map((b) => b.name).join(", ")}</> : "Not switched on for any batch yet: Batch → What is included → Admin copilot."}
                </span>
              </div>
            )}
            {chat.map((m, i) => (
              m.from === "staff"
                ? <div key={i} className="cw-me">{m.text}</div>
                : <div key={i} className="row-tight" style={{ gap: 8, alignItems: "flex-start" }}><span className="agent-avatar"><RunIcon size={16} /></span><div className="cw-ai">{m.text}</div></div>
            ))}
            {selected?.drawers?.length > 0 && <div className="hint">Using: {selected.drawers.join(" · ")}</div>}
            {busy && <div className="hint row-tight" style={{ gap: 6 }}><Loader2 size={13} className="spin" /> {selected.status === "planning" ? "Planning…" : "Working…"}</div>}
            {selected?.error && selected.status === "failed" && <div className="small" style={{ color: "var(--incorrect)" }}>{selected.error}</div>}
          </div>
          <div className="cw-compose">
            <textarea
              className="textarea"
              rows={2}
              placeholder={follow ? "Change the plan, or ask for more…" : selected ? "Start a new request with New." : "Tell it what to do, in your own words…"}
              disabled={Boolean(selected) && !follow}
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 2000))}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }}
            />
            <div className="spread" style={{ gap: 8, marginTop: 6 }}>
              <span className="hint">Ctrl+Enter to send</span>
              <button className="btn btn-primary" disabled={creating || revising || !text.trim() || (Boolean(selected) && !follow) || !status?.available} onClick={send}>
                <Send size={14} /> {creating || revising ? "Sending…" : "Send"}
              </button>
            </div>
            {!status?.available && <div className="hint" style={{ marginTop: 6 }}>{status?.reason} <Link to="/settings?tab=ai&sub=agents">Open AI settings</Link></div>}
            <ErrorNote error={createError || reviseError || removeError} />
          </div>
        </div>

        <div className="card cw-col">
          <div className="spread cw-head">
            <strong>Plan</strong>
            {selected?.steps?.length > 0 && <span className="hint">{selected.steps.length} step{selected.steps.length === 1 ? "" : "s"}</span>}
          </div>
          <div className="cw-scroll" style={{ padding: 12 }}>
            {!selected && <div className="hint">The plan for a request shows here: each step, what it changes, and approve or reject.</div>}
            {selected && !selected.steps.length && <div className="hint">{busy ? "Planning…" : "No steps."}</div>}
            {selected?.form && selected.status === "awaiting" ? <FormRun key={selected._id} run={selected} /> : selected?.steps?.length > 0 && <RunSteps run={selected} />}
          </div>
          {selected && ["awaiting", "running", "planning"].includes(selected.status) && (
            <div className="row-tight cw-foot" style={{ gap: 8 }}>
              {pending.length > 1 && !selected.form && (
                <button className="btn btn-sm btn-primary" disabled={deciding} onClick={() => decide({ id: selected._id, stepIds: "all", approve: true })}><Check size={13} /> Approve all {pending.length}</button>
              )}
              <span className="grow" />
              <button className="btn btn-sm btn-quiet" onClick={() => cancel(selected._id)}>Cancel request</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
