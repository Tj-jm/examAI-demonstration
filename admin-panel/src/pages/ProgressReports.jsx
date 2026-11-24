import { useEffect, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import { Send, RotateCw, ExternalLink } from "lucide-react";
import {
  useGetProgressReportSettingsQuery, useUpdateProgressReportSettingsMutation, useGetProgressReportBatchesQuery,
  useGetProgressReportLogQuery, useResendProgressReportMutation,
} from "../api/contentApi";
import { Loading, ErrorNote, Empty, Field, Pager, pageSlice } from "../components/bits";
import BatchReportSettings from "../components/BatchReportSettings";
import { useTerms } from "../terms";

const FREQ = { weekly: "Weekly", biweekly: "Every 2 weeks", monthly: "Monthly" };
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const STATUS = { sent: ["Sent", "pill-good"], partial: ["Partly sent", ""], failed: ["Failed", "pill-bad"], nothing: ["No contact", ""], sending: ["Sending", ""] };

// Settings that apply to every batch (owner, admin).
function GlobalSettings() {
  const { data, isLoading, error } = useGetProgressReportSettingsQuery();
  const [save, state] = useUpdateProgressReportSettingsMutation();
  const [form, setForm] = useState(null);
  useEffect(() => { if (data) setForm({ enabled: data.enabled, timezone: data.timezone || "", phoneCountry: data.phoneCountry || "", smsMonthlyCap: data.smsMonthlyCap || 0, smsPartCost: data.smsPartCost || 0, studentCanEditGuardian: data.studentCanEditGuardian, linkDays: data.linkDays || 60 }); }, [data]);
  if (error) return <ErrorNote error={error} />;
  if (isLoading || !form) return <Loading />;
  const set = (patch) => setForm({ ...form, ...patch });
  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>Settings</h2>
      <label className="row-tight"><input type="checkbox" checked={form.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> <strong>Progress reports on</strong> <span className="muted small">— each batch then chooses its own schedule</span></label>
      <div className="row-tight" style={{ flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
        <Field label="Time zone" hint={`In use: ${data.timezoneUsed}`}><input className="input" placeholder="e.g. Asia/Dhaka" value={form.timezone} onChange={(e) => set({ timezone: e.target.value })} /></Field>
        <Field label="Country for local numbers" hint="Two letters, e.g. BD"><input className="input" style={{ width: 90 }} maxLength={2} value={form.phoneCountry} onChange={(e) => set({ phoneCountry: e.target.value.toUpperCase() })} /></Field>
        <Field label="SMS parts a month" hint="0 = no limit"><input className="input tnum" type="number" min={0} style={{ width: 120 }} value={form.smsMonthlyCap} onChange={(e) => set({ smsMonthlyCap: e.target.value })} /></Field>
        <Field label={`Cost of one SMS part${data.currency ? ` (${data.currency})` : ""}`} hint="For estimates only"><input className="input tnum" type="number" min={0} step="0.01" style={{ width: 120 }} value={form.smsPartCost} onChange={(e) => set({ smsPartCost: e.target.value })} /></Field>
        <Field label="Report links work for (days)"><input className="input tnum" type="number" min={1} max={365} style={{ width: 100 }} value={form.linkDays} onChange={(e) => set({ linkDays: e.target.value })} /></Field>
      </div>
      <label className="row-tight small"><input type="checkbox" checked={form.studentCanEditGuardian} onChange={(e) => set({ studentCanEditGuardian: e.target.checked })} /> Students may change a guardian contact staff entered (off: they can only add one when none is on record)</label>
      <div className="row-tight small muted" style={{ flexWrap: "wrap", gap: 16 }}>
        <span>SMS: {data.smsReady ? "ready" : "not set up (SMS_PROVIDER)"}</span>
        <span>Email: {data.emailReady ? "ready" : "not set up (SMTP_*)"}</span>
        <span>SMS parts this month: <span className="tnum">{data.usedThisMonth}</span>{data.smsMonthlyCap ? ` of ${data.smsMonthlyCap}` : ""}</span>
      </div>
      <ErrorNote error={state.error} />
      <div><button className="btn" disabled={state.isLoading} onClick={() => save(form)}>{state.isLoading ? "Saving" : "Save settings"}</button></div>
    </div>
  );
}

function Log({ batchId, canResend }) {
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useGetProgressReportLogQuery({ batch: batchId || undefined, status: status || undefined, kind: kind || undefined, page });
  const [resend, resendState] = useResendProgressReportMutation();
  useEffect(() => setPage(1), [batchId, status, kind]);
  return (
    <div className="card stack" style={{ padding: 0 }}>
      <div className="spread" style={{ padding: "16px 16px 0", flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ margin: 0 }}>Delivery log</h2>
        <div className="row-tight">
          <select className="select" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All reports</option>
            <option value="periodic">Scheduled reports</option>
            <option value="result">Exam results</option>
          </select>
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any status</option>
            <option value="sent">Sent</option>
            <option value="partial">Partly sent</option>
            <option value="failed">Failed</option>
            <option value="nothing">No contact</option>
          </select>
        </div>
      </div>
      <ErrorNote error={error || resendState.error} />
      {isLoading ? <Loading /> : !data?.reports.length ? <div style={{ padding: 16 }}><Empty icon={Send} title="Nothing sent yet" hint="Reports appear here as they go out." /></div> : (
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead><tr><th>When</th><th>Student</th><th>Report</th><th>Messages</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {data.reports.map((r) => {
                const [label, tone] = STATUS[r.status] || [r.status, ""];
                return (
                  <tr key={r._id}>
                    <td className="small tnum" style={{ whiteSpace: "nowrap" }}>{new Date(r.createdAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</td>
                    <td>{r.student?.name || "—"}<div className="muted small">{r.batch?.name}</div></td>
                    <td className="small" style={{ maxWidth: 360 }}>
                      <span className="pill" style={{ marginRight: 6 }}>{r.kind === "result" ? "Result" : "Report"}</span>
                      <span className="muted">{r.smsText}</span>
                    </td>
                    <td className="small">
                      {r.deliveries.map((d) => (
                        <div key={d._id} title={d.error || ""} style={{ whiteSpace: "nowrap" }}>
                          <span className={d.status === "sent" ? "" : "muted"}>{d.recipient === "guardian" ? "Guardian" : "Student"} {d.channel === "sms" ? "SMS" : "email"}</span>
                          {" · "}<span className={`pill ${d.status === "sent" ? "pill-good" : d.status === "failed" ? "pill-bad" : ""}`}>{d.status}</span>
                          {d.error && <span className="muted"> {d.error}</span>}
                        </div>
                      ))}
                      {!r.deliveries.length && <span className="muted">No phone or email on record</span>}
                    </td>
                    <td><span className={`pill ${tone}`}>{label}</span>{r.openedAt && <div className="muted small">Opened</div>}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {r.link && <a className="btn btn-sm btn-quiet" href={r.link} target="_blank" rel="noreferrer" aria-label="Open report"><ExternalLink size={13} /></a>}
                      {canResend && ["partial", "failed"].includes(r.status) && <button className="btn btn-sm btn-quiet" disabled={resendState.isLoading} onClick={() => resend(r._id)}><RotateCw size={13} /> Resend</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ padding: "0 16px 16px" }}><Pager page={page} pages={data?.pages} total={data?.total} onChange={setPage} /></div>
    </div>
  );
}

// Progress reports: weekly/fortnightly/monthly summaries and instant exam
// results to students and guardians by SMS and email (backend
// utils/progressReports.js).
export default function ProgressReports() {
  const terms = useTerms();
  const { me } = useOutletContext() || {};
  const isAdmin = ["owner", "admin"].includes(me?.role);
  const [params, setParams] = useSearchParams();
  const batchId = params.get("batch") || "";
  const { data, isLoading } = useGetProgressReportBatchesQuery();
  const batches = data?.batches || [];
  const [page, setPage] = useState(1);
  const shown = pageSlice(batches, page, 20);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Progress reports</h1>
        <p className="muted small" style={{ margin: "2px 0 0" }}>Each student's exams, rank, missed exams, live classes and work, sent to them and their guardian by SMS and email, with a link to the full report.</p>
      </div>
      <div className="stack">
        {isAdmin && <GlobalSettings />}
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          {isLoading ? <Loading /> : (
            <table className="table">
              <thead><tr><th>{terms.Batch}</th><th>Reports</th><th>Schedule</th><th>To</th><th>Exam results</th><th></th></tr></thead>
              <tbody>
                {shown.items.map((b) => (
                  <tr key={b._id} style={batchId === String(b._id) ? { background: "var(--bg-alt, rgba(0,0,0,.03))" } : undefined}>
                    <td><strong>{b.name}</strong>{!b.isActive && <span className="muted small"> · inactive</span>}</td>
                    <td>{b.enabled ? <span className="pill pill-good">On</span> : <span className="muted">Off</span>}</td>
                    <td className="small">{b.enabled ? `${FREQ[b.frequency]}, ${b.frequency === "monthly" ? `day ${b.monthDay}` : DAYS[b.weekday]} ${b.hour}:00 · ${b.language === "bn" ? "বাংলা" : "English"}` : "—"}</td>
                    <td className="small">{b.enabled ? [b.student.sms || b.student.email ? `Student (${[b.student.sms && "SMS", b.student.email && "email"].filter(Boolean).join(", ")})` : null, b.guardian.sms || b.guardian.email ? `Guardian (${[b.guardian.sms && "SMS", b.guardian.email && "email"].filter(Boolean).join(", ")})` : null].filter(Boolean).join(" · ") : "—"}</td>
                    <td>{b.instantResult ? <span className="pill pill-good">On</span> : <span className="muted">Off</span>}</td>
                    <td><button className="btn btn-sm btn-quiet" onClick={() => setParams(batchId === String(b._id) ? {} : { batch: b._id })}>{batchId === String(b._id) ? "Close" : "Set up"}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div style={{ padding: "0 16px" }}><Pager page={shown.page} pages={shown.pages} total={shown.total} onChange={setPage} /></div>
        </div>
        {batchId && <BatchReportSettings key={batchId} batchId={batchId} canSend={isAdmin} />}
        <Log batchId={batchId} canResend={isAdmin} />
      </div>
    </div>
  );
}
