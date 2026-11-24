import { useEffect, useState } from "react";
import { School } from "lucide-react";
import { useAssignStudentIdsMutation, useGetSettingsQuery, useUpdateSettingsMutation } from "../api/contentApi";
import { ErrorNote, Field, Loading } from "../components/bits";
import { PRESETS } from "../terms";

// Settings → Institution: what kind of place this is, the words both apps
// use for its parts, and whether it sells access.
const WORDS = [
  ["batch", "A batch (one group of students)"],
  ["batches", "Batches (plural)"],
  ["program", "A program (a group of batches)"],
  ["programs", "Programs (plural)"],
  ["teacher", "A teacher"],
  ["teachers", "Teachers (plural)"],
  ["org", "The institution itself"],
];

// The pattern filled in for a sample student (backend utils/studentIdPattern.js).
const preview = (p) => p.replace(/\{(INIT|H4|P2|YYYY|YY|#{1,8})\}/g, (_, t) => {
  const y = String(new Date().getFullYear());
  return { INIT: "TJ", H4: "7KQ2", P2: "58", YYYY: y, YY: y.slice(-2) }[t] ?? "42".padStart(t.length, "0");
});

export default function InstitutionSettings() {
  const { data: settings, isLoading } = useGetSettingsQuery();
  const [update, { isLoading: saving, error }] = useUpdateSettingsMutation();
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(false);
  const [assignIds, { isLoading: assigning, error: assignError }] = useAssignStudentIdsMutation();
  const [assigned, setAssigned] = useState(null);

  useEffect(() => {
    if (settings && !form) {
      const inst = settings.institution || {};
      setForm({ type: inst.type || "coaching", labels: { ...(inst.labels || {}) }, sales: inst.sales !== false, studentIdLogin: inst.studentIdLogin === true, studentIdPattern: inst.studentIdPattern || "" });
    }
  }, [settings, form]);

  if (isLoading || !form) return <div className="card"><Loading /></div>;
  const preset = PRESETS[form.type] || PRESETS.coaching;
  const set = (patch) => { setSaved(false); setForm({ ...form, ...patch }); };

  return (
    <div className="card stack">
      <div className="row-tight"><School size={17} className="muted" /><h2>Institution</h2></div>
      <p className="hint" style={{ margin: 0 }}>
        What kind of place this is. It changes the words staff and students
        read: a school has classes in grades, a university has courses in
        departments, a bootcamp has cohorts in tracks. Nothing else changes.
      </p>

      <Field label="Type">
        <select className="select" style={{ maxWidth: 280 }} value={form.type} onChange={(e) => set({ type: e.target.value })}>
          {Object.entries(PRESETS).map(([value, p]) => <option key={value} value={value}>{p.label}</option>)}
        </select>
      </Field>

      <div className="stack" style={{ gap: 8 }}>
        <span className="label">Words (leave empty for the type's own)</span>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
          {WORDS.map(([key, label]) => (
            <Field key={key} label={label}>
              <input
                className="input"
                maxLength={40}
                placeholder={preset[key]}
                value={form.labels[key] || ""}
                onChange={(e) => set({ labels: { ...form.labels, [key]: e.target.value } })}
              />
            </Field>
          ))}
        </div>
      </div>

      <label className="spread" style={{ padding: "10px 0", borderTop: "1px solid var(--border)", cursor: "pointer" }}>
        <span className="grow stack" style={{ gap: 2 }}>
          <span>Sell access (plans, prices and checkout)</span>
          <span className="hint" style={{ margin: 0 }}>
            Off for a school or university that doesn't charge students here:
            plans, prices, coupons and checkout are hidden, and students get
            access from staff (Students → Grant access, or Students → Import).
          </span>
        </span>
        <input type="checkbox" checked={form.sales} onChange={(e) => set({ sales: e.target.checked })} />
      </label>

      <label className="spread" style={{ padding: "10px 0", borderTop: "1px solid var(--border)", cursor: "pointer" }}>
        <span className="grow stack" style={{ gap: 2 }}>
          <span>Students log in with their student ID</span>
          <span className="hint" style={{ margin: 0 }}>
            Student ID and password, no email or text message needed. For
            students added by Students → Import or with a student ID. Staff
            reset forgotten passwords (Students → the student → Reset password).
          </span>
        </span>
        <input type="checkbox" checked={form.studentIdLogin} onChange={(e) => set({ studentIdLogin: e.target.checked })} />
      </label>

      <div className="stack" style={{ gap: 6, padding: "10px 0", borderTop: "1px solid var(--border)" }}>
        <Field label="Student ID pattern (empty: IDs only by hand)">
          <input
            className="input"
            style={{ maxWidth: 360, fontFamily: "monospace" }}
            maxLength={60}
            placeholder="EAI{YY}-{INIT}{H4}-{####}"
            value={form.studentIdPattern}
            onChange={(e) => set({ studentIdPattern: e.target.value.toUpperCase() })}
          />
        </Field>
        <span className="hint" style={{ margin: 0 }}>
          {"{INIT}"} name initials, {"{H4}"} 4-character code from the phone or email (can't be read back),
          {" {P2}"} last 2 phone digits, {"{YY}"} or {"{YYYY}"} year joined, {"{####}"} running number (required).
          Each student gets one when their profile is complete; it never changes after.
        </span>
        {form.studentIdPattern && <span className="small">Example: <b style={{ fontFamily: "monospace" }}>{preview(form.studentIdPattern)}</b></span>}
        <div className="row-tight">
          <button
            className="btn btn-quiet"
            disabled={assigning || !settings.institution?.studentIdPattern || form.studentIdPattern !== settings.institution?.studentIdPattern}
            onClick={async () => setAssigned((await assignIds().unwrap()).assigned)}
          >
            {assigning ? "Assigning" : "Give IDs to students without one"}
          </button>
          {assigned !== null && <span className="small muted">{assigned} student{assigned === 1 ? "" : "s"} given an ID.</span>}
        </div>
        <ErrorNote error={assignError} />
      </div>

      <ErrorNote error={error} />
      <div className="row-tight">
        <button
          className="btn"
          disabled={saving}
          onClick={async () => {
            await update({ institution: form }).unwrap();
            setSaved(true);
          }}
        >
          {saving ? "Saving" : "Save"}
        </button>
        {saved && <span className="small muted">Saved.</span>}
      </div>
    </div>
  );
}
