import { useState } from "react";
import {
  Download, Check, HardDrive, Cpu, Sparkles, AlertTriangle, RefreshCw, Copy,
} from "lucide-react";
import {
  useGetLocalModelsQuery,
  usePullModelMutation,
  useGetPullStatusQuery,
} from "../api/aiApi";
import { Loading } from "./bits";

// Ollama can install a model over its own HTTP api, so this downloads from the
// panel rather than sending the buyer to a terminal. Servers that cannot do
// that get the command to run instead — an honest fallback beats a button that
// silently does nothing.
export default function LocalModels({ currentModel, onUse }) {
  const { data, isLoading, refetch } = useGetLocalModelsQuery();
  const [pull, { error: pullError }] = usePullModelMutation();
  const [copied, setCopied] = useState(null);

  // Only polled while something is actually downloading.
  const anyPulling = (data?.pulls || []).some((p) => p.status === "downloading");
  const status = useGetPullStatusQuery(undefined, {
    pollingInterval: anyPulling ? 1200 : 0,
    skip: !data?.reachable,
  });

  if (isLoading) return <div className="card"><Loading label="Looking for a model server" /></div>;

  const pulls = status.data?.pulls || data?.pulls || [];
  const pullOf = (name) => pulls.find((p) => p.name === name);
  const installedNames = new Set((data?.installed || []).map((m) => m.name));

  const copyCommand = async (name) => {
    await navigator.clipboard.writeText(`ollama pull ${name}`);
    setCopied(name);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="card stack">
      <div className="spread">
        <h2>Models on this machine</h2>
        <button className="icon-btn" title="Check again" onClick={() => refetch()}>
          <RefreshCw size={15} />
        </button>
      </div>

      {!data?.reachable ? (
        <>
          <div className="banner banner-warn row-tight">
            <AlertTriangle size={16} style={{ flexShrink: 0 }} />
            <span>{data?.reason || "No model server found."}</span>
          </div>
          <p className="hint" style={{ margin: 0 }}>
            Install Ollama from ollama.com, start it, then set the address above
            to <code>http://localhost:11434/v1</code> and save.
          </p>
        </>
      ) : (
        <p className="hint" style={{ margin: 0 }}>
          {data.installed.length === 0
            ? "Nothing installed yet. Pick one below."
            : `${data.installed.length} model${data.installed.length === 1 ? "" : "s"} installed.`}
        </p>
      )}

      {pullError && (
        <div className="banner banner-bad row-tight">
          <AlertTriangle size={16} />
          <span>{pullError?.data?.message || "That download could not be started."}</span>
        </div>
      )}

      <div className="stack" style={{ gap: 8 }}>
        {(data?.catalogue || []).map((model) => {
          const installed = installedNames.has(model.name);
          const job = pullOf(model.name);
          const busy = job?.status === "downloading";
          const inUse = currentModel === model.name;

          return (
            <div
              key={model.name}
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
                    {model.recommended && (
                      <span className="pill pill-ai row-tight" style={{ gap: 4 }}>
                        <Sparkles size={11} /> Recommended
                      </span>
                    )}
                    {inUse && <span className="pill pill-ok">In use</span>}
                    {installed && !inUse && (
                      <span className="pill pill-ok row-tight" style={{ gap: 4 }}>
                        <Check size={11} /> Installed
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
                  inUse ? null : (
                    <button className="btn btn-sm btn-quiet" onClick={() => onUse(model.name)}>
                      Use this
                    </button>
                  )
                ) : busy ? (
                  <span className="pill tnum">{job.percent}%</span>
                ) : job?.status === "done" ? (
                  <button className="btn btn-sm btn-ok" onClick={() => { refetch(); onUse(model.name); }}>
                    <Check size={14} /> Use it
                  </button>
                ) : data?.reachable ? (
                  <button className="btn btn-sm" onClick={() => pull({ name: model.name })}>
                    <Download size={14} /> Download
                  </button>
                ) : (
                  <button className="btn btn-sm btn-quiet" onClick={() => copyCommand(model.name)}>
                    <Copy size={14} /> {copied === model.name ? "Copied" : "Command"}
                  </button>
                )}
              </div>

              {busy && (
                <div className="stack" style={{ gap: 5 }}>
                  <div className="progress">
                    <div className="progress-bar" style={{ width: `${job.percent}%` }} />
                  </div>
                  <span className="hint">{job.stage || "Downloading"} — this can take several minutes.</span>
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

      {data?.installed?.length > 0 && (
        <details>
          <summary className="hint" style={{ cursor: "pointer" }}>
            Other models already on this machine
          </summary>
          <div className="stack" style={{ gap: 5, marginTop: 10 }}>
            {data.installed
              .filter((m) => !(data.catalogue || []).some((c) => c.name === m.name))
              .map((m) => (
                <div className="spread small" key={m.name} style={{ padding: "6px 0" }}>
                  <span className="grow">{m.name}</span>
                  {m.sizeGb && <span className="tnum muted">{m.sizeGb} GB</span>}
                  <button className="btn btn-sm btn-ghost" onClick={() => onUse(m.name)}>Use</button>
                </div>
              ))}
          </div>
        </details>
      )}
    </div>
  );
}
