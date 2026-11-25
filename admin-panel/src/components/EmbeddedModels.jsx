import { useEffect, useState } from "react";
import {
  Download, Check, HardDrive, Cpu, Sparkles, AlertTriangle, RefreshCw, Trash2, Eye, Square,
} from "lucide-react";
import {
  useGetEmbeddedModelsQuery,
  usePullEmbeddedModelMutation,
  useGetEmbeddedPullStatusQuery,
  useDeleteEmbeddedModelMutation,
  useStopEmbeddedModelMutation,
} from "../api/aiApi";
import { Loading, useConfirm } from "./bits";

// Unlike LocalModels.jsx, there is no "reachable"/"not reachable" state and
// no command-line fallback: this downloads straight into this server's own
// disk and runs inside this same process (ai/embedded.js), so a model is
// either installed or it isn't — never unreachable, and never something to
// paste into a terminal.
export default function EmbeddedModels({ currentModel, onUse, gpu = "auto", onGpu }) {
  const { data, isLoading, refetch } = useGetEmbeddedModelsQuery();
  const [pull, { error: pullError }] = usePullEmbeddedModelMutation();
  const [remove, { error: removeError }] = useDeleteEmbeddedModelMutation();
  const [stop, { isLoading: stopping }] = useStopEmbeddedModelMutation();
  const confirm = useConfirm();

  // Started locally the instant a Download button is clicked, not derived
  // from `data.pulls` — that query was fetched once on mount and nothing
  // invalidates it mid-download, so waiting for it to show a "downloading"
  // entry before turning polling on means the click appears to do nothing
  // until the panel happens to refetch some other way. This starts the
  // poll immediately and clears an id once the poll itself reports the job
  // is no longer running, so it self-heals even if the click's own POST
  // response is slow or fails after already starting the server-side pull.
  const [pending, setPending] = useState(() => new Set());
  const anyPulling = pending.size > 0 || (data?.pulls || []).some((p) => p.status === "downloading");
  const status = useGetEmbeddedPullStatusQuery(undefined, {
    pollingInterval: anyPulling ? 1200 : 0,
  });

  // Once the poll confirms a job is no longer downloading (done, failed, or
  // simply never appears — e.g. the POST itself failed before creating a
  // server-side entry), the optimistic "pending" flag is no longer needed;
  // real status from the server takes over the button's display.
  useEffect(() => {
    if (!status.data || pending.size === 0) return;
    setPending((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const id of prev) {
        const job = status.data.pulls.find((p) => p.id === id);
        if (job && job.status !== "downloading") {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.data]);

  if (isLoading) return <div className="card"><Loading label="Checking installed models" /></div>;

  const pulls = status.data?.pulls || data?.pulls || [];
  const pullOf = (id) => pulls.find((p) => p.id === id);
  const installedIds = new Set((data?.installed || []).map((m) => m.id));

  const startPull = (id) => {
    setPending((prev) => new Set(prev).add(id));
    pull({ id })
      .unwrap()
      .catch(() => {
        // The banner below already surfaces pullError; just stop treating
        // this one as pending so the button goes back to "Download".
        setPending((prev) => { const next = new Set(prev); next.delete(id); return next; });
      });
  };

  return (
    <div className="card stack">
      <div className="spread">
        <h2>Built-in models</h2>
        <button className="icon-btn" title="Check again" onClick={() => refetch()}>
          <RefreshCw size={15} />
        </button>
      </div>

      <p className="hint" style={{ margin: 0 }}>
        Runs directly inside this server — no Ollama, no separate service, no
        address to configure. Slower than a real provider, and only the two
        models marked "Vision" can read an attached image, but works with
        nothing else to set up.
        {" "}
        {data?.installed.length === 0
          ? "Nothing downloaded yet."
          : `${data.installed.length} model${data.installed.length === 1 ? "" : "s"} downloaded.`}
      </p>

      <div className="card-quiet stack" style={{ gap: 6 }}>
        <div className="spread" style={{ gap: 8, flexWrap: "wrap" }}>
          <div className="row-tight" style={{ gap: 6 }}><Cpu size={15} /> <b>GPU</b></div>
          {onGpu && (
            <div className="row-tight" style={{ gap: 4 }}>
              {[["auto", "Use when available"], ["off", "CPU only"]].map(([v, l]) => (
                <button key={v} type="button" className={`pill pill-btn${gpu === v ? " pill-on" : ""}`} onClick={() => gpu !== v && onGpu(v)}>{l}</button>
              ))}
            </div>
          )}
        </div>
        <span className="hint">
          {gpu === "off"
            ? "Always runs on the CPU."
            : data?.gpu?.backends?.length
              ? `Found: ${data.gpu.note}. The model loads onto it, and falls back to the CPU if that fails.`
              : `No GPU found (${data?.gpu?.note || "checking"}), so it runs on the CPU.`}
          {data?.device && ` Running now on the ${data.device.backend === "cpu" ? "CPU" : `GPU (${data.device.backend}${data.device.offload ? `, ${data.device.offload.layers}/${data.device.offload.of} layers` : ""})`}.`}
        </span>
        {data?.gpuFailed && gpu !== "off" && (
          <span className="hint" style={{ color: "var(--warning)" }}>
            The GPU ({data.gpuFailed.backend}) did not start, so the CPU is used: {data.gpuFailed.reason}
          </span>
        )}
      </div>

      {pullError && (
        <div className="banner banner-bad row-tight">
          <AlertTriangle size={16} />
          <span>{pullError?.data?.message || "That download could not be started."}</span>
        </div>
      )}
      {removeError && (
        <div className="banner banner-bad row-tight">
          <AlertTriangle size={16} />
          <span>{removeError?.data?.message || "That model could not be removed."}</span>
        </div>
      )}

      <div className="stack" style={{ gap: 8 }}>
        {(data?.catalogue || []).map((model) => {
          const installed = installedIds.has(model.id);
          const job = pullOf(model.id);
          // Optimistically busy the instant the button is clicked (pending),
          // and busy for real once the poll confirms it — covers the gap
          // before the first poll response comes back.
          const busy = job?.status === "downloading" || (pending.has(model.id) && !job);
          const inUse = currentModel === model.id;
          // "In use" (selected in AiConfig) and "Running" (a live process
          // actually holding RAM right now) are different things — the
          // process is only spawned on first use after a restart, or after
          // being stopped, so the selected model can be idle.
          const running = data?.running === model.id;

          return (
            <div
              key={model.id}
              className="card-quiet stack"
              style={{
                gap: 9,
                outline: inUse ? "2px solid var(--accent)" : "none",
                outlineOffset: -2,
              }}
            >
              <div className="spread">
                <div className="grow">
                  <div className="row-tight" style={{ flexWrap: "wrap", marginBottom: 3 }}>
                    <strong style={{ fontWeight: 500 }}>{model.label}</strong>
                    {model.vision && (
                      <span className="pill pill-ok row-tight" style={{ gap: 4 }} title="Can read an attached image, like a doubt photo">
                        <Eye size={11} /> Vision
                      </span>
                    )}
                    {model.recommended && (
                      <span className="pill pill-ai row-tight" style={{ gap: 4 }}>
                        <Sparkles size={11} /> Recommended
                      </span>
                    )}
                    {inUse && <span className="pill pill-ok">In use</span>}
                    {running && (
                      <span className="pill pill-ai row-tight" style={{ gap: 4 }} title="A live server process for this model is running right now">
                        Running
                      </span>
                    )}
                    {installed && !inUse && (
                      <span className="pill pill-ok row-tight" style={{ gap: 4 }}>
                        <Check size={11} /> Downloaded
                      </span>
                    )}
                  </div>

                  <div className="row-tight muted small" style={{ gap: 12 }}>
                    <span className="row-tight" style={{ gap: 4 }}>
                      <HardDrive size={12} /> {model.sizeGb} GB download
                    </span>
                    <span className="row-tight" style={{ gap: 4 }}>
                      <Cpu size={12} /> {model.ramGb} GB RAM
                    </span>
                  </div>
                </div>

                {installed ? (
                  <div className="row-tight">
                    {!inUse && (
                      <button className="btn btn-sm btn-quiet" onClick={() => onUse(model.id)}>
                        Use this
                      </button>
                    )}
                    {inUse && (
                      <button
                        className="btn btn-sm btn-quiet"
                        title="Deselect this model — AI calls stop working until another model is picked. Needed before you can delete it, if it's the only one you've downloaded."
                        onClick={() => onUse("")}
                      >
                        Stop using
                      </button>
                    )}
                    {inUse && (
                      <button
                        className="btn btn-sm btn-quiet"
                        disabled={stopping || !running}
                        title={
                          running
                            ? "Stop the server process without deleting the model — it restarts automatically next time it's needed"
                            : "Not running right now — nothing to stop"
                        }
                        onClick={() => stop()}
                      >
                        <Square size={12} /> Stop
                      </button>
                    )}
                    <button
                      className="icon-btn icon-btn-danger"
                      title={inUse ? "Stop using it first (see \"Stop using\" above), then delete" : "Delete from this server"}
                      disabled={inUse}
                      onClick={async () => {
                        const yes = await confirm({
                          title: `Delete ${model.label}?`,
                          body: "Removes the downloaded file from this server. You can download it again later.",
                          confirmLabel: "Delete",
                        });
                        if (yes) remove(model.id);
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ) : busy ? (
                  <span className="pill tnum">{job?.percent ?? 0}%</span>
                ) : job?.status === "done" ? (
                  <button className="btn btn-sm btn-ok" onClick={() => { refetch(); onUse(model.id); }}>
                    <Check size={14} /> Use it
                  </button>
                ) : (
                  <button className="btn btn-sm" onClick={() => startPull(model.id)}>
                    <Download size={14} /> Download
                  </button>
                )}
              </div>

              {busy && (
                <div className="stack" style={{ gap: 5 }}>
                  <div className="progress">
                    <div className="progress-bar" style={{ width: `${job?.percent ?? 0}%` }} />
                  </div>
                  <span className="hint">Downloading — this can take several minutes.</span>
                </div>
              )}

              {job?.status === "failed" && (
                <div className="banner banner-bad row-tight">
                  <AlertTriangle size={15} />
                  <span>{job.error}</span>
                </div>
              )}

              <p className="hint" style={{ margin: 0 }}>{model.note}</p>

              <div className="row-tight" style={{ flexWrap: "wrap", gap: 5 }}>
                {model.good.map((g) => (
                  <span className="pill pill-ok" key={g}>{g}</span>
                ))}
                {model.weak.map((w) => (
                  <span className="pill pill-warn" key={w}>Not for {w.toLowerCase()}</span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
