import { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useSearchParams } from "react-router-dom";
import { User, BadgeCheck, SlidersHorizontal, ShieldCheck, Camera } from "lucide-react";
import { useGetSelfQuery, useUpdateSelfMutation, useUploadSelfPhotoMutation, useChangePasswordMutation } from "../api/authApi";
import { Field, ErrorNote, Loading, PasswordInput } from "../components/bits";
import { ROLE_INFO, OFF_FEATURES } from "../constants/roles";
import { Appearance } from "./Settings";
import { setMode } from "../uiSlice";

// My profile: everyone's own page. Details and pay-out, what their role
// is, their settings (look, alerts, away), and sign-in safety.
const TABS = [["profile", "Profile", User], ["role", "My role", BadgeCheck], ["settings", "Settings", SlidersHorizontal], ["security", "Sign-in", ShieldCheck]];

export default function MyProfile() {
  const [sp, setSp] = useSearchParams();
  const tab = TABS.some(([k]) => k === sp.get("tab")) ? sp.get("tab") : "profile";
  const { data, isLoading, error } = useGetSelfQuery();
  if (isLoading || !data) return <div className="page"><ErrorNote error={error} /><Loading /></div>;
  return (
    <div className="page">
      <div className="page-head row" style={{ gap: 14, alignItems: "center" }}>
        <Avatar data={data} size={56} />
        <div>
          <h1 style={{ margin: 0 }}>{data.name}</h1>
          <span className="muted small">{ROLE_INFO[data.role]?.label || data.role} · {data.email}{data.streak > 1 ? ` · 🔥 ${data.streak}-day streak` : ""}</span>
        </div>
      </div>
      <div className="row-tight" style={{ gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {TABS.map(([k, l, Icon]) => <button key={k} className={`pill pill-btn row-tight${tab === k ? " pill-on" : ""}`} style={{ gap: 5 }} onClick={() => setSp({ tab: k })}><Icon size={13} /> {l}</button>)}
      </div>
      {tab === "profile" && <Profile data={data} />}
      {tab === "role" && <Role data={data} />}
      {tab === "settings" && <Prefs data={data} />}
      {tab === "security" && <Security data={data} />}
    </div>
  );
}

export function Avatar({ data, size = 40 }) {
  const url = data?.profile?.photoUrl || data?.profile?.photo?.url;
  const initials = String(data?.name || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return url
    ? <img src={url} alt="" style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover" }} />
    : <span style={{ width: size, height: size, borderRadius: "50%", display: "grid", placeItems: "center", background: "var(--primary)", color: "var(--primary-fg, #fff)", fontWeight: 700, fontSize: size * 0.38 }}>{initials}</span>;
}

function Profile({ data }) {
  const [save, saving] = useUpdateSelfMutation();
  const [upload, uploading] = useUploadSelfPhotoMutation();
  const file = useRef(null);
  const [f, setF] = useState(() => ({
    name: data.name, phone: data.phone,
    payout: { method: "none", account: "", holder: "", bank: "", branch: "", ...data.payout },
    profile: data.profile ? { headline: data.profile.headline || "", subjects: (data.profile.subjects || []).join(", "), qualifications: data.profile.qualifications || "", experienceYears: data.profile.experienceYears ?? "", bio: data.profile.bio || "" } : null,
  }));
  const [done, setDone] = useState(false);
  const pay = f.payout;
  const setPay = (x) => setF({ ...f, payout: { ...pay, ...x } });
  const submit = async () => {
    setDone(false);
    const res = await save({ name: f.name, phone: f.phone, payout: f.payout, ...(f.profile ? { profile: f.profile } : {}) });
    if (!res.error) setDone(true);
  };
  return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <div className="card stack">
        <b>Details</b>
        {data.profile && (
          <div className="row" style={{ gap: 12, alignItems: "center" }}>
            <Avatar data={data} size={64} />
            <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const x = e.target.files?.[0]; if (x) upload(x); e.target.value = ""; }} />
            <button className="btn btn-quiet btn-sm row-tight" disabled={uploading.isLoading} onClick={() => file.current?.click()}><Camera size={14} /> {uploading.isLoading ? "Uploading…" : "Change photo"}</button>
            <ErrorNote error={uploading.error} />
          </div>
        )}
        <div className="row" style={{ flexWrap: "wrap" }}>
          <Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Phone (team only)"><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="01XXXXXXXXX" /></Field>
        </div>
        <span className="hint" style={{ margin: 0 }}>Email ({data.email}) and role are changed by an admin.</span>
      </div>

      {f.profile && (
        <div className="card stack">
          <b>Public profile</b>
          <span className="hint" style={{ margin: 0 }}>What students and visitors see on the landing page and your batches. {data.profile.public === false ? "An admin has it hidden right now." : ""}</span>
          <Field label="Headline"><input className="input" maxLength={120} value={f.profile.headline} onChange={(e) => setF({ ...f, profile: { ...f.profile, headline: e.target.value } })} placeholder="Physics teacher, 8 years with HSC students" /></Field>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <Field label="Subjects" hint="Comma separated."><input className="input" value={f.profile.subjects} onChange={(e) => setF({ ...f, profile: { ...f.profile, subjects: e.target.value } })} /></Field>
            <Field label="Years teaching"><input className="input tnum" type="number" min={0} max={80} style={{ width: 110 }} value={f.profile.experienceYears} onChange={(e) => setF({ ...f, profile: { ...f.profile, experienceYears: e.target.value } })} /></Field>
          </div>
          <Field label="Qualifications"><input className="input" maxLength={300} value={f.profile.qualifications} onChange={(e) => setF({ ...f, profile: { ...f.profile, qualifications: e.target.value } })} /></Field>
          <Field label="About you"><textarea className="textarea" rows={4} maxLength={2000} value={f.profile.bio} onChange={(e) => setF({ ...f, profile: { ...f.profile, bio: e.target.value } })} /></Field>
        </div>
      )}

      {data.role !== "owner" && (
        <div className="card stack">
          <b>Where your pay goes</b>
          <span className="hint" style={{ margin: 0 }}>Shown to admins when they pay your payslip.</span>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <Field label="Method"><select className="select" value={pay.method} onChange={(e) => setPay({ method: e.target.value })}>{[["none", "Not set"], ["bkash", "bKash"], ["nagad", "Nagad"], ["rocket", "Rocket"], ["bank", "Bank"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
            {pay.method !== "none" && <Field label={pay.method === "bank" ? "Account number" : "Number"}><input className="input" value={pay.account} onChange={(e) => setPay({ account: e.target.value })} /></Field>}
            {pay.method !== "none" && <Field label="Account name"><input className="input" value={pay.holder} onChange={(e) => setPay({ holder: e.target.value })} /></Field>}
          </div>
          {pay.method === "bank" && (
            <div className="row" style={{ flexWrap: "wrap" }}>
              <Field label="Bank"><input className="input" value={pay.bank} onChange={(e) => setPay({ bank: e.target.value })} /></Field>
              <Field label="Branch"><input className="input" value={pay.branch} onChange={(e) => setPay({ branch: e.target.value })} /></Field>
            </div>
          )}
        </div>
      )}
      <ErrorNote error={saving.error} />
      <div className="row-tight"><button className="btn btn-primary" disabled={saving.isLoading} onClick={submit}>Save</button>{done && <span className="muted small">Saved.</span>}</div>
    </div>
  );
}

function Role({ data }) {
  const info = ROLE_INFO[data.role] || { label: data.role, does: [], cannot: [] };
  const off = OFF_FEATURES.filter(([k]) => data.duty.off.includes(k));
  return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <div className="card stack">
        <b>{info.label}</b>
        <div className="row" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 24 }}>
          <div className="grow"><span className="label">You can</span><ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{info.does.map((t) => <li key={t}>{t}</li>)}</ul></div>
          {info.cannot.length > 0 && <div className="grow"><span className="label">You can't</span><ul style={{ margin: "4px 0 0", paddingLeft: 18 }} className="muted">{info.cannot.map((t) => <li key={t}>{t}</li>)}</ul></div>}
        </div>
      </div>
      <div className="card stack">
        <b>Your responsibilities</b>
        {data.duty.note ? <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{data.duty.note}</p> : <span className="hint" style={{ margin: 0 }}>Your admin hasn't written anything here yet.</span>}
        {data.duty.goal > 0 && <span className="small">Weekly goal: <b className="tnum">{data.duty.goal}</b></span>}
        {off.length > 0 && <span className="small">Turned off for you: {off.map(([, l]) => l).join(", ")}. Ask an admin if you need it.</span>}
      </div>
      <span className="hint" style={{ margin: 0 }}>Questions about your work or pay go to your admin.</span>
    </div>
  );
}

function Prefs({ data }) {
  const dispatch = useDispatch();
  const ui = useSelector((s) => s.ui);
  const [save, saving] = useUpdateSelfMutation();
  const [p, setP] = useState(() => ({ alerts: true, sound: true, quietFrom: "", quietTo: "", fontScale: 100, ...data.prefs }));
  const [away, setAway] = useState(() => ({ until: data.away?.until ? String(data.away.until).slice(0, 10) : "", note: data.away?.note || "" }));
  const put = (x) => { const next = { ...p, ...x }; setP(next); save({ prefs: x }); };
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      <Appearance team={!["owner", "admin"].includes(data.role)} ui={{ ...ui, layout: !["owner", "admin"].includes(data.role) && ["modern", "dock", "launcher"].includes(ui.layout) ? "sidebar" : ui.layout }} dispatch={(a) => { dispatch(a); if (a.type === setMode.type) save({ prefs: { theme: a.payload } }); }} />
      <div className="card stack">
        <b>Text size</b>
        <div className="row-tight" style={{ gap: 6 }}>{[90, 100, 110, 125].map((n) => <button key={n} className={`pill pill-btn${p.fontScale === n ? " pill-on" : ""}`} onClick={() => put({ fontScale: n })}>{n}%</button>)}</div>
      </div>
      <div className="card stack">
        <b>Alerts</b>
        <label className="row-tight small"><input type="checkbox" checked={p.alerts} onChange={(e) => put({ alerts: e.target.checked })} /> Tell me when new work arrives (a desktop alert while the panel is open)</label>
        <label className="row-tight small"><input type="checkbox" checked={p.sound} disabled={!p.alerts} onChange={(e) => put({ sound: e.target.checked })} /> With a sound</label>
        <div className="row" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
          <Field label="Quiet from"><input className="input" type="time" value={p.quietFrom} onChange={(e) => put({ quietFrom: e.target.value })} /></Field>
          <Field label="Quiet until"><input className="input" type="time" value={p.quietTo} onChange={(e) => put({ quietTo: e.target.value })} /></Field>
          {(p.quietFrom || p.quietTo) && <button className="btn btn-quiet btn-sm" onClick={() => put({ quietFrom: "", quietTo: "" })}>No quiet hours</button>}
        </div>
      </div>
      <div className="card stack">
        <b>Away</b>
        <span className="hint" style={{ margin: 0 }}>On leave? Admins see it and nothing new is assigned to you until then.</span>
        {data.away?.until
          ? <div className="row-tight" style={{ gap: 8 }}><span className="pill pill-warn">Away until {new Date(data.away.until).toLocaleDateString()}</span>{data.away.note && <span className="muted small">{data.away.note}</span>}<button className="btn btn-quiet btn-sm" onClick={() => save({ away: { until: null } })}>I'm back</button></div>
          : (
            <div className="row" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
              <Field label="Away until"><input className="input" type="date" min={tomorrow} value={away.until} onChange={(e) => setAway({ ...away, until: e.target.value })} /></Field>
              <Field label="Note (optional)"><input className="input" maxLength={200} value={away.note} onChange={(e) => setAway({ ...away, note: e.target.value })} placeholder="Exam week, family trip…" /></Field>
              <button className="btn btn-sm" disabled={!away.until || saving.isLoading} onClick={() => save({ away })}>Go away</button>
            </div>
          )}
      </div>
      <ErrorNote error={saving.error} />
    </div>
  );
}

function Security({ data }) {
  const [change, changing] = useChangePasswordMutation();
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "" });
  const short = (a) => (/Mobile|Android|iPhone/i.test(a) ? "Phone" : "Computer") + (/Edg\//.test(a) ? " · Edge" : /Chrome\//.test(a) ? " · Chrome" : /Firefox\//.test(a) ? " · Firefox" : /Safari\//.test(a) ? " · Safari" : "");
  return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <div className="card stack">
        <b>Change password</b>
        <div className="stack" style={{ maxWidth: 340, gap: 10 }}>
          <Field label="Current password"><PasswordInput visibleByDefault={false} value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></Field>
          <Field label="New password"><PasswordInput visibleByDefault={false} value={pw.newPassword} placeholder="At least 8 characters" onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /></Field>
          <button className="btn" style={{ alignSelf: "flex-start" }} disabled={changing.isLoading || pw.newPassword.length < 8 || !pw.currentPassword} onClick={async () => { const r = await change(pw); if (!r.error) window.location.assign(`${import.meta.env.BASE_URL || "/"}login`.replace(/\/\/+/g, "/")); }}>Change it</button>
        </div>
        <ErrorNote error={changing.error} />
        <span className="hint" style={{ margin: 0 }}>Changing it signs you out everywhere, here too.</span>
      </div>
      <div className="card stack">
        <b>Sign-ins</b>
        <span className="hint" style={{ margin: 0 }}>Your account is signed in one place at a time: signing in somewhere new signs out the old one. Don't recognise a sign-in? Change your password.</span>
        <table className="table small"><thead><tr><th>When</th><th>Device</th><th>Address</th></tr></thead>
          <tbody>{data.logins.map((l, i) => <tr key={i}><td>{new Date(l.at).toLocaleString()}{i === 0 ? " (latest)" : ""}</td><td>{short(l.agent || "")}</td><td className="muted">{l.ip}</td></tr>)}
            {!data.logins.length && <tr><td colSpan={3} className="muted">Shown from your next sign-in.</td></tr>}</tbody></table>
      </div>
    </div>
  );
}

// The account's saved look and text size, applied wherever they sign in.
export function useSelfLook(me) {
  const dispatch = useDispatch();
  const mode = useSelector((s) => s.ui.mode);
  const theme = me?.prefs?.theme;
  useEffect(() => { if (theme && theme !== mode) dispatch(setMode(theme)); }, [theme]); // eslint-disable-line react-hooks/exhaustive-deps
  const scale = me?.prefs?.fontScale || 100;
  // Only the page content: zooming the whole page makes the shell taller
  // than the window, and its bottom can't be scrolled to.
  useEffect(() => {
    let el = document.getElementById("self-scale");
    if (!el) { el = document.createElement("style"); el.id = "self-scale"; document.head.appendChild(el); }
    el.textContent = scale === 100 ? "" : `.main > * { zoom: ${scale / 100}; }`;
  }, [scale]);
}
