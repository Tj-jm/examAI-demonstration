import { useState } from "react";
import { Plug, Lock, Check, X, ShieldCheck, History, PlugZap } from "lucide-react";
import { useGetConnectionsQuery, useSaveConnectionMutation, useTestConnectionMutation } from "../api/connectionsApi";
import { ErrorNote, Field, Loading, PasswordInput } from "./bits";

// Settings → Connections: email, SMS, Zoom, video hosts, file storage and
// LiveKit credentials, typed here instead of in the server's .env (backend
// utils/serviceCredentials.js). Encrypted at rest; a secret is never shown
// again, only its last four characters. Anything set in .env wins and is
// locked here.
export default function Connections() {
  const { data, isLoading, error } = useGetConnectionsQuery();
  const [open, setOpen] = useState(null);
  if (isLoading) return <Loading />;
  if (error) return <ErrorNote error={error} />;

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="card stack" style={{ gap: 6 }}>
        <div className="row-tight"><ShieldCheck size={17} className="muted" /><h2 style={{ margin: 0 }}>Connections</h2></div>
        <p className="hint" style={{ margin: 0, lineHeight: 1.6 }}>
          Credentials for outside services. They're encrypted with the server's ENCRYPTION_KEY, and a secret is never shown again.
          Saving asks for your password, and every owner gets an email when one changes. Anything in the server's .env file wins and is locked here.
        </p>
        {!data.encryption && <p className="small" style={{ margin: 0, color: "var(--incorrect)" }}>ENCRYPTION_KEY isn't set on the server, so nothing can be saved here yet.</p>}
      </div>

      {data.services.map((sv) => (
        <ServiceCard key={sv.id} sv={sv} open={open === sv.id} onToggle={() => setOpen(open === sv.id ? null : sv.id)} />
      ))}

      {data.audit?.length > 0 && (
        <div className="card stack" style={{ gap: 6 }}>
          <div className="row-tight"><History size={15} className="muted" /><strong>Recent changes</strong></div>
          {data.audit.slice(0, 10).map((a, i) => (
            <div key={i} className="small spread" style={{ gap: 8, flexWrap: "wrap" }}>
              <span><strong>{a.service}</strong>: {[...a.keys.map((k) => `changed ${k}`), ...a.cleared.map((k) => `removed ${k}`)].join(", ")}</span>
              <span className="muted">{a.by || "—"}{a.ip ? ` · ${a.ip}` : ""} · {new Date(a.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ServiceCard({ sv, open, onToggle }) {
  const [entered, setEntered] = useState({});
  const [password, setPassword] = useState("");
  const [save, { isLoading: saving, error: saveError, reset: resetSave }] = useSaveConnectionMutation();
  const [test, { data: tested, isLoading: testing, reset: resetTest }] = useTestConnectionMutation();
  const [done, setDone] = useState(false);

  const value = (f) => (f.key in entered ? entered[f.key] : f.secret ? "" : f.value || "");
  const picked = (key) => value(sv.fields.find((f) => f.key === key) || {});
  const groupKey = sv.id === "sms" ? "SMS_PROVIDER" : sv.id === "storage" ? "STORAGE_PROVIDER" : null;
  const group = groupKey ? picked(groupKey) : null;
  const visible = sv.fields.filter((f) => !f.group || f.group === group);
  const changes = Object.keys(entered).length > 0;

  const submit = async () => {
    await save({ service: sv.id, values: entered, password }).unwrap();
    setEntered({});
    setPassword("");
    setDone(true);
    resetTest();
  };

  return (
    <div className="card stack" style={{ gap: 10 }}>
      <div className="spread" style={{ gap: 8 }}>
        <div className="stack" style={{ gap: 2 }}>
          <strong className="row-tight" style={{ gap: 6 }}><Plug size={14} className="muted" /> {sv.label}</strong>
          <span className="muted small">{sv.hint}</span>
        </div>
        <div className="row-tight" style={{ gap: 8 }}>
          {sv.configured ? <span className="pill pill-ok row-tight" style={{ gap: 4 }}><Check size={11} /> Set up</span> : <span className="pill">Not set</span>}
          <button type="button" className="btn btn-quiet" onClick={() => { onToggle(); resetSave(); setDone(false); }}>{open ? "Close" : "Configure"}</button>
        </div>
      </div>

      {open && (
        <div className="stack" style={{ gap: 10 }}>
          {visible.map((f) => (
            <Field
              key={f.key}
              label={`${f.label}${f.optional ? "" : " *"}`}
              hint={f.envLocked
                ? `Set by ${f.key} in the server's .env. Change it there.`
                : f.secret && f.saved
                  ? `Saved, ending ${f.last4}. Leave blank to keep it.`
                  : f.key}
            >
              {f.options ? (
                <select className="select" disabled={f.envLocked} value={f.envLocked ? f.value || "" : value(f)} onChange={(e) => setEntered({ ...entered, [f.key]: e.target.value })}>
                  {f.options.filter(([v]) => v !== "local" || (f.envLocked ? f.value : value(f)) === "local").map(([v, l]) => <option key={v || "none"} value={v}>{l}</option>)}
                </select>
              ) : (
                <div className="row-tight" style={{ gap: 6 }}>
                  {f.envLocked && <Lock size={13} className="muted" />}
                  <input
                    className="input grow"
                    type={f.secret ? "password" : "text"}
                    autoComplete="new-password"
                    disabled={f.envLocked}
                    placeholder={f.envLocked ? (f.secret ? "Set in .env" : f.value || "Set in .env") : f.secret && f.saved ? "••••••••" : f.placeholder}
                    value={f.envLocked ? (f.secret ? "" : f.value || "") : value(f)}
                    onChange={(e) => setEntered({ ...entered, [f.key]: e.target.value })}
                  />
                  {!f.envLocked && f.saved && (
                    <button type="button" className="icon-btn icon-btn-danger" title="Remove the saved value" onClick={() => setEntered({ ...entered, [f.key]: "" })}><X size={13} /></button>
                  )}
                </div>
              )}
            </Field>
          ))}

          {sv.id === "storage" && group === "s3" && (
            <p className="hint" style={{ margin: 0 }}>Files already uploaded stay where they are. Switch before you upload much, or move old files yourself.</p>
          )}

          {changes && (
            <Field label="Your password" hint="Needed to save credentials.">
              <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} visibleByDefault={false} autoComplete="current-password" />
            </Field>
          )}
          <ErrorNote error={saveError} />
          {tested && (
            <p className="small row-tight" style={{ margin: 0, gap: 6, color: tested.ok ? "var(--correct)" : "var(--incorrect)" }}>
              {tested.ok ? <Check size={13} /> : <X size={13} />} {tested.message}
            </p>
          )}
          {done && !changes && <p className="small muted" style={{ margin: 0 }}>Saved. It's in use now on every server.</p>}
          <div className="row-tight" style={{ gap: 8 }}>
            <button type="button" className="btn" disabled={saving || !changes || !password} onClick={submit}>{saving ? "Saving…" : "Save"}</button>
            <button type="button" className="btn btn-quiet" disabled={testing || changes} title={changes ? "Save first, then test" : ""} onClick={() => test(sv.id)}>
              <PlugZap size={14} /> {testing ? "Testing…" : "Test connection"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
