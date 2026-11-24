import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Send, MessageSquareText, Mail } from "lucide-react";
import { useGetProgressReportBatchQuery, useUpdateProgressReportBatchMutation, useSendProgressReportsNowMutation } from "../api/contentApi";
import { Loading, ErrorNote, Field, useConfirm } from "./bits";

// One batch's progress reports (backend utils/progressReports.js): on/off,
// how often and when, who gets them by SMS or email, the language, rank,
// and the instant result message. Used on the batch page and on
// Progress reports.

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const hourLabel = (h) => `${((h + 11) % 12) + 1}:00 ${h < 12 ? "am" : "pm"}`;

function Toggle({ checked, onChange, children, hint }) {
  return (
    <label className="spread" style={{ padding: "8px 0", borderTop: "1px solid var(--border)", cursor: "pointer", gap: 12 }}>
      <span className="grow">
        <span>{children}</span>
        {hint && <span className="muted small" style={{ display: "block" }}>{hint}</span>}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export default function BatchReportSettings({ batchId, canSend = false }) {
  const { data, isLoading, error } = useGetProgressReportBatchQuery(batchId);
  const [save, saveState] = useUpdateProgressReportBatchMutation();
  const [sendNow, sendState] = useSendProgressReportsNowMutation();
  const confirm = useConfirm();
  const [form, setForm] = useState(null);
  const [note, setNote] = useState("");

  useEffect(() => { if (data) setForm(data.settings); }, [data]);
  if (error) return <ErrorNote error={error} />;
  if (isLoading || !form) return <Loading />;

  const p = data.preview;
  const set = (patch) => setForm({ ...form, ...patch });
  const dirty = JSON.stringify(form) !== JSON.stringify(data.settings);
  const submit = async () => {
    try { await save({ id: batchId, ...form }).unwrap(); setNote("Saved."); } catch { /* shown */ }
  };
  const runNow = async () => {
    const ok = await confirm({
      title: "Send reports now?",
      body: `A report for the last ${form.frequency === "monthly" ? "30" : form.frequency === "biweekly" ? "14" : "7"} days goes to everyone on this batch's register: about ${p.sms} SMS (${p.smsParts} parts) and ${p.emails} emails.`,
      confirmLabel: "Send now",
      tone: "neutral",
    });
    if (!ok) return;
    try {
      const r = await sendNow({ id: batchId }).unwrap();
      setNote(`${r.students} students: ${r.sent} messages sent, ${r.failed} failed, ${r.skipped} skipped${r.nothing ? `, ${r.nothing} with no contact` : ""}.`);
    } catch { /* shown */ }
  };

  return (
    <div className="stack">
      <div className="card stack">
        <div className="spread">
          <h2 style={{ margin: 0 }}>Progress reports</h2>
          <Link className="btn btn-sm btn-quiet" to={`/grading/progress-reports?batch=${batchId}`}>Delivery log</Link>
        </div>
        <Toggle checked={form.enabled} onChange={(v) => set({ enabled: v })} hint="A summary of exams, rank, missed exams, live classes and work not handed in, with a link to the full report.">
          Send progress reports for this batch
        </Toggle>

        <div className="row-tight" style={{ flexWrap: "wrap", gap: 12, alignItems: "flex-end", opacity: form.enabled ? 1 : 0.6 }}>
          <Field label="How often">
            <select className="select" value={form.frequency} onChange={(e) => set({ frequency: e.target.value })}>
              <option value="weekly">Every week</option>
              <option value="biweekly">Every 2 weeks</option>
              <option value="monthly">Every month</option>
            </select>
          </Field>
          {form.frequency === "monthly" ? (
            <Field label="Day of the month">
              <select className="select" value={form.monthDay} onChange={(e) => set({ monthDay: Number(e.target.value) })}>
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
          ) : (
            <Field label="Day">
              <select className="select" value={form.weekday} onChange={(e) => set({ weekday: Number(e.target.value) })}>
                {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select>
            </Field>
          )}
          <Field label="Time">
            <select className="select" value={form.hour} onChange={(e) => set({ hour: Number(e.target.value) })}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
            </select>
          </Field>
          <Field label="Language">
            <select className="select" value={form.language} onChange={(e) => set({ language: e.target.value })}>
              <option value="en">English</option>
              <option value="bn">বাংলা (Bangla)</option>
            </select>
          </Field>
        </div>
        {p.next && form.enabled && <p className="muted small" style={{ margin: 0 }}>Next: {new Date(p.next).toLocaleString(undefined, { weekday: "long", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} ({p.timezone})</p>}

        <div style={{ overflowX: "auto" }}>
          <table className="table" style={{ maxWidth: 460 }}>
            <thead><tr><th>Who</th><th><MessageSquareText size={13} /> SMS</th><th><Mail size={13} /> Email</th></tr></thead>
            <tbody>
              {[["student", "Student"], ["guardian", "Guardian"]].map(([key, label]) => (
                <tr key={key}>
                  <td>{label}</td>
                  <td><input type="checkbox" aria-label={`${label} SMS`} checked={form[key].sms} onChange={(e) => set({ [key]: { ...form[key], sms: e.target.checked } })} /></td>
                  <td><input type="checkbox" aria-label={`${label} email`} checked={form[key].email} onChange={(e) => set({ [key]: { ...form[key], email: e.target.checked } })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Toggle checked={form.showRank} onChange={(v) => set({ showRank: v })} hint="Position in the batch for each exam and for the period.">Show rank</Toggle>
        <Toggle checked={form.instantResult} onChange={(v) => set({ instantResult: v })} hint="One short SMS/email to the same people as each exam is graded (exams set to show results at once). Uses the recipients above.">
          Send each exam result as it's graded
        </Toggle>

        <ErrorNote error={saveState.error || sendState.error} />
        <div className="row-tight" style={{ flexWrap: "wrap", gap: 8 }}>
          <button className="btn" disabled={!dirty || saveState.isLoading} onClick={submit}>{saveState.isLoading ? "Saving" : "Save"}</button>
          {canSend && <button className="btn btn-quiet" disabled={dirty || sendState.isLoading} onClick={runNow} title={dirty ? "Save first" : ""}><Send size={14} /> {sendState.isLoading ? "Sending" : "Send now"}</button>}
          {note && <span className="muted small">{note}</span>}
        </div>
      </div>

      <div className="card stack">
        <h3 style={{ margin: 0 }}>Preview</h3>
        {p.sample ? (
          <div className="card-quiet" style={{ whiteSpace: "pre-wrap", fontFamily: "ui-monospace, monospace", fontSize: 13 }}>{p.sample.text}</div>
        ) : <p className="muted">Nobody on the register yet.</p>}
        {p.sample && <p className="muted small" style={{ margin: 0 }}>{p.sample.name}'s message · {p.sample.text.length} characters · {p.sample.parts} SMS part{p.sample.parts === 1 ? "" : "s"}{form.language === "bn" ? " (Bangla uses 70 characters a part)" : ""}</p>}
        <div className="row-tight" style={{ flexWrap: "wrap", gap: 16 }}>
          <span><strong className="tnum">{p.coverage.students}</strong> <span className="muted small">students</span></span>
          <span><strong className="tnum">{p.coverage.guardianPhone}</strong> <span className="muted small">guardian phones</span></span>
          <span><strong className="tnum">{p.coverage.guardianEmail}</strong> <span className="muted small">guardian emails</span></span>
          <span><strong className="tnum">{p.sms}</strong> <span className="muted small">SMS · {p.smsParts} parts{p.cost !== null ? ` · about ${p.cost} ${p.currency}` : ""} per send</span></span>
          <span><strong className="tnum">{p.emails}</strong> <span className="muted small">emails per send</span></span>
          {p.coverage.noRecipient > 0 && <span className="muted small">{p.coverage.noRecipient} students have nobody to send to</span>}
        </div>
        {(!p.smsReady || !p.emailReady || !p.hasLink) && (
          <div className="card-quiet small">
            {!p.smsReady && <div>SMS isn't set up (SMS_PROVIDER), so SMS will be skipped.</div>}
            {!p.emailReady && <div>Email isn't set up (SMTP_*), so emails will be skipped.</div>}
            {!p.hasLink && <div>Reports go out without a link: set CLIENT_URL_STUDENT, or the canonical address under Settings → SEO.</div>}
          </div>
        )}
        {p.coverage.students > 0 && p.coverage.guardianPhone + p.coverage.guardianEmail < p.coverage.students && (
          <p className="muted small" style={{ margin: 0 }}>Add guardian contacts on each student's page, or in bulk with Students → Import (Guardian phone / Guardian email columns).</p>
        )}
      </div>
    </div>
  );
}
