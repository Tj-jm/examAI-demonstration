import { useEffect, useState } from "react";
import { AgentsGlyph, CopilotIcon, GradingAgentIcon, AfterClassAgentIcon, AtRiskAgentIcon, SupportAgentIcon, TutorAgentIcon, MarketingAgentIcon } from "./AgentIcons";
import { useGetAiConfigQuery, useUpdateAiConfigMutation } from "../api/aiApi";
import { ErrorNote, Field } from "./bits";
import { useTerms } from "../terms";
import { ClipboardCheck } from "lucide-react";

// Settings → AI → Agents: the master switch, each agent's switch and how
// much it may do without asking. Each batch also has to allow it
// (Batch → What is included).
const MODES = [
  ["ask", "Ask before every action", "Nothing happens until you approve it."],
  ["safe", "Drafts by itself, asks before anything students see", "Draft exams and questions are made straight away; publishing, notices and classes wait for approval."],
  ["auto", "Do everything by itself", "Every step runs as soon as it's planned. You can still see everything it did."],
];

function ModePicker({ name, value, onChange, publishWord }) {
  return (
    <Field label="How much it may do without asking">
      <div className="stack" style={{ gap: 8 }}>
        {MODES.map(([v, l, h]) => (
          <label key={v} className="row-tight" style={{ gap: 8, alignItems: "flex-start", cursor: "pointer" }}>
            <input type="radio" name={`${name}-mode`} checked={value === v} onChange={() => onChange(v)} style={{ marginTop: 3 }} />
            <span>
              <span style={{ fontWeight: 500 }}>{l}</span>
              <div className="hint">{v === "safe" && publishWord ? `Drafts run straight away; ${publishWord} waits for approval.` : h}</div>
            </span>
          </label>
        ))}
      </div>
    </Field>
  );
}

export default function AgentSettings() {
  const terms = useTerms();
  const { data: config } = useGetAiConfigQuery();
  const [update, { isLoading: saving, error, isSuccess }] = useUpdateAiConfigMutation();
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(null);
  useEffect(() => {
    if (config && !form) {
      const a = config.agents || {};
      const initial = {
        enabled: Boolean(a.enabled),
        dailyRunsPerUser: a.dailyRunsPerUser ?? 40,
        copilot: { enabled: a.copilot?.enabled !== false, mode: a.copilot?.mode || "safe", roles: a.copilot?.roles || ["owner", "admin"], view: a.copilot?.view || "classic" },
        grading: { enabled: Boolean(a.grading?.enabled), mode: a.grading?.mode || "safe", minConfidence: a.grading?.minConfidence ?? 0.85 },
        tutor: { enabled: Boolean(a.tutor?.enabled), eveningNudge: a.tutor?.eveningNudge !== false },
        support: { enabled: Boolean(a.support?.enabled), mode: a.support?.mode || "ask", doubts: a.support?.doubts !== false, tickets: a.support?.tickets !== false, knowledge: a.support?.knowledge || "" },
        atRisk: { enabled: Boolean(a.atRisk?.enabled), mode: a.atRisk?.mode || "ask", scoreDrop: a.atRisk?.scoreDrop ?? 15, lowScore: a.atRisk?.lowScore ?? 40, quietDays: a.atRisk?.quietDays ?? 10 },
        afterClass: { enabled: Boolean(a.afterClass?.enabled), mode: a.afterClass?.mode || "safe", quizSize: a.afterClass?.quizSize ?? 5, quiz: a.afterClass?.quiz !== false, absentees: a.afterClass?.absentees !== false },
        marketing: { enabled: Boolean(a.marketing?.enabled), mode: a.marketing?.mode || "ask", minAudience: a.marketing?.minAudience ?? 5, channels: { app: a.marketing?.channels?.app !== false, sms: Boolean(a.marketing?.channels?.sms), email: Boolean(a.marketing?.channels?.email) } },
        assignment: { enabled: Boolean(a.assignment?.enabled), mode: a.assignment?.mode || "ask", returnGrades: Boolean(a.assignment?.returnGrades), reminders: a.assignment?.reminders !== false },
      };
      setForm(initial);
      setSaved(JSON.stringify(initial));
    }
  }, [config, form]);
  if (!form) return null;
  const dirty = saved !== JSON.stringify(form);
  const setC = (patch) => setForm({ ...form, copilot: { ...form.copilot, ...patch } });
  const setG = (patch) => setForm({ ...form, grading: { ...form.grading, ...patch } });
  const setAs = (patch) => setForm({ ...form, assignment: { ...form.assignment, ...patch } });
  const setA = (patch) => setForm({ ...form, afterClass: { ...form.afterClass, ...patch } });
  const setR = (patch) => setForm({ ...form, atRisk: { ...form.atRisk, ...patch } });
  const setS = (patch) => setForm({ ...form, support: { ...form.support, ...patch } });
  const setM = (patch) => setForm({ ...form, marketing: { ...form.marketing, ...patch } });
  const toggleRole = (r) => setC({ roles: form.copilot.roles.includes(r) ? form.copilot.roles.filter((x) => x !== r) : [...form.copilot.roles, r] });

  return (
    <div className="card stack">
      <div className="row-tight"><AgentsGlyph size={18} className="muted" /><h2>Agents</h2></div>
      <p className="hint" style={{ margin: 0 }}>
        Agents plan and carry out work for you, such as making an exam from the bank, posting a notice or scheduling a class.
        They use the same actions staff use, only on batches where you switch each one on (Batch → What is included), and every step is logged on the Agents page.
      </p>
      <label className="row-tight" style={{ gap: 8, cursor: "pointer" }}>
        <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
        <strong>Turn on agents</strong>
      </label>

      {form.enabled && (
        <div className="card-quiet stack" style={{ gap: 12 }}>
          <label className="row-tight" style={{ gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={form.copilot.enabled} onChange={(e) => setC({ enabled: e.target.checked })} />
            <CopilotIcon size={16} style={{ flex: "none" }} /><span><strong>Admin copilot</strong>: makes exams from the bank, publishes them, posts notices, schedules live classes</span>
          </label>
          {form.copilot.enabled && (
            <>
              <ModePicker name="copilot" value={form.copilot.mode} onChange={(mode) => setC({ mode })} />
              <Field label="Page layout" hint="Classic: one column of requests. Workspace: requests, chat and plan side by side. Each person can switch on the page.">
                <div className="row-tight" style={{ gap: 6 }}>
                  {[["classic", "Classic"], ["workspace", "Workspace"]].map(([k, t]) => (
                    <button key={k} type="button" className={`pill pill-btn${form.copilot.view === k ? " pill-on" : ""}`} onClick={() => setC({ view: k })}>{t}</button>
                  ))}
                </div>
              </Field>
              <Field label="Who can use it" hint="Teachers can't make exams or notices themselves, so they can't use the copilot either.">
                <div className="row-tight" style={{ gap: 16 }}>
                  {["owner", "admin"].map((r) => (
                    <label key={r} className="row-tight" style={{ gap: 6, cursor: "pointer" }}>
                      <input type="checkbox" checked={form.copilot.roles.includes(r)} onChange={() => toggleRole(r)} /> {r === "owner" ? "Owner" : "Admins"}
                    </label>
                  ))}
                </div>
              </Field>
            </>
          )}

          <hr className="divider" />
          <label className="row-tight" style={{ gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={form.grading.enabled} onChange={(e) => setG({ enabled: e.target.checked })} />
            <GradingAgentIcon size={16} style={{ flex: "none" }} /><span><strong>Grading agent</strong>: every 10 minutes, AI-marks written answers waiting for grading and offers to apply the marks of scripts it's sure about</span>
          </label>
          {form.grading.enabled && (
            <>
              <ModePicker name="grading" value={form.grading.mode} onChange={(mode) => setG({ mode })} publishWord="applying marks (students are told their result)" />
              <Field label={`Apply only when every answer is at least ${Math.round(form.grading.minConfidence * 100)}% confident`} hint="Less sure answers wait for a teacher, with the AI's suggested mark already filled in. Needs “Grade written answers” on, and AI help + AI-assisted grading on the batch.">
                <input type="range" min={0.5} max={1} step={0.05} value={form.grading.minConfidence} onChange={(e) => setG({ minConfidence: Number(e.target.value) })} style={{ width: 260 }} />
              </Field>
            </>
          )}

          <hr className="divider" />
          <label className="row-tight" style={{ gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={form.assignment.enabled} onChange={(e) => setAs({ enabled: e.target.checked })} />
            <ClipboardCheck size={16} style={{ flex: "none" }} /><span><strong>Assignment agent</strong>: every 10 minutes, suggests a grade and feedback for each new assignment hand-in and offers to apply them; reminds students the day before work is due</span>
          </label>
          {form.assignment.enabled && (
            <>
              <ModePicker name="assignment" value={form.assignment.mode} onChange={(mode) => setAs({ mode })} publishWord="applying grades" />
              <label className="row-tight" style={{ gap: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={form.assignment.returnGrades} onChange={(e) => setAs({ returnGrades: e.target.checked })} />
                <span>Applying a grade also returns it to the student (otherwise staff return grades)</span>
              </label>
              <label className="row-tight" style={{ gap: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={form.assignment.reminders} onChange={(e) => setAs({ reminders: e.target.checked })} />
                <span>Remind students who haven't handed in work due within a day</span>
              </label>
              <p className="hint" style={{ margin: 0 }}>Each batch also has to allow it: Batch → What is included → Assignment agent. Suggestions also show on each hand-in for a teacher to accept or change.</p>
            </>
          )}

          <hr className="divider" />
          <label className="row-tight" style={{ gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={form.afterClass.enabled} onChange={(e) => setA({ enabled: e.target.checked })} />
            <AfterClassAgentIcon size={16} style={{ flex: "none" }} /><span><strong>After-class agent</strong>: when an in-app class ends, a quiz from the class notes and a catch-up message for students who missed it</span>
          </label>
          {form.afterClass.enabled && (
            <>
              <ModePicker name="afterClass" value={form.afterClass.mode} onChange={(mode) => setA({ mode })} publishWord="publishing the quiz and messaging students" />
              <div className="row-tight" style={{ gap: 16, flexWrap: "wrap" }}>
                <label className="row-tight" style={{ gap: 6 }}><input type="checkbox" checked={form.afterClass.quiz} onChange={(e) => setA({ quiz: e.target.checked })} /> Quiz from the notes</label>
                {form.afterClass.quiz && (
                  <label className="row-tight" style={{ gap: 6 }}>
                    <input className="input" type="number" min={3} max={8} style={{ width: 70 }} value={form.afterClass.quizSize} onChange={(e) => setA({ quizSize: Number(e.target.value) })} /> questions
                  </label>
                )}
                <label className="row-tight" style={{ gap: 6 }}><input type="checkbox" checked={form.afterClass.absentees} onChange={(e) => setA({ absentees: e.target.checked })} /> Message students who missed it</label>
              </div>
              <p className="hint" style={{ margin: 0 }}>The quiz needs the class's notes (captions on during class) and a chapter (class settings → Recordings).</p>
            </>
          )}

          <hr className="divider" />
          <label className="row-tight" style={{ gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={form.atRisk.enabled} onChange={(e) => setR({ enabled: e.target.checked })} />
            <AtRiskAgentIcon size={16} style={{ flex: "none" }} /><span><strong>At-risk students</strong>: every Sunday, finds students who are slipping and offers each a personal check-in with their weakest topic to practise</span>
          </label>
          {form.atRisk.enabled && (
            <>
              <ModePicker name="atRisk" value={form.atRisk.mode} onChange={(mode) => setR({ mode })} publishWord="sending check-ins" />
              <div className="row-tight" style={{ gap: 16, flexWrap: "wrap" }}>
                <label className="row-tight" style={{ gap: 6 }}>Scores fell by <input className="input" type="number" min={5} max={60} style={{ width: 70 }} value={form.atRisk.scoreDrop} onChange={(e) => setR({ scoreDrop: Number(e.target.value) })} /> points</label>
                <label className="row-tight" style={{ gap: 6 }}>or average below <input className="input" type="number" min={10} max={80} style={{ width: 70 }} value={form.atRisk.lowScore} onChange={(e) => setR({ lowScore: Number(e.target.value) })} />%</label>
                <label className="row-tight" style={{ gap: 6 }}>or quiet for <input className="input" type="number" min={3} max={60} style={{ width: 70 }} value={form.atRisk.quietDays} onChange={(e) => setR({ quietDays: Number(e.target.value) })} /> days</label>
              </div>
              <p className="hint" style={{ margin: 0 }}>Also flags students who missed the last three in-app classes. Scores compare the last three graded exams with the three before.</p>
            </>
          )}

          <hr className="divider" />
          <label className="row-tight" style={{ gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={form.marketing.enabled} onChange={(e) => setM({ enabled: e.target.checked })} />
            <MarketingAgentIcon size={16} style={{ flex: "none" }} /><span><strong>Marketing agent</strong>: every Saturday, proposes campaigns to students who could buy now (trial ending, access ran out, never bought, gone quiet) and automations worth switching on</span>
          </label>
          {form.marketing.enabled && (
            <>
              <ModePicker name="marketing" value={form.marketing.mode} onChange={(mode) => setM({ mode })} publishWord="sending campaigns" />
              <div className="row-tight" style={{ gap: 16, flexWrap: "wrap" }}>
                <span className="small">Send by</span>
                {[["app", "App"], ["sms", "SMS"], ["email", "Email"]].map(([k, label]) => (
                  <label key={k} className="row-tight" style={{ gap: 6 }}>
                    <input type="checkbox" checked={form.marketing.channels[k]} onChange={(e) => setM({ channels: { ...form.marketing.channels, [k]: e.target.checked } })} /> {label}
                  </label>
                ))}
                <label className="row-tight" style={{ gap: 6 }}>Only groups of <input className="input" type="number" min={1} max={1000} style={{ width: 80 }} value={form.marketing.minAudience} onChange={(e) => setM({ minAudience: Number(e.target.value) })} /> or more</label>
              </div>
              <p className="hint" style={{ margin: 0 }}>Uses the same audiences as Campaigns. Students who turned off offers are never included. The text is written by AI when Write with AI is on; you can edit it before approving.</p>
            </>
          )}

          <hr className="divider" />
          <label className="row-tight" style={{ gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={form.support.enabled} onChange={(e) => setS({ enabled: e.target.checked })} />
            <SupportAgentIcon size={16} style={{ flex: "none" }} /><span><strong>Support agent</strong>: drafts answers to escalated doubts and replies to new support tickets; you edit and send</span>
          </label>
          {form.support.enabled && (
            <>
              <ModePicker name="support" value={form.support.mode} onChange={(mode) => setS({ mode })} publishWord="sending answers" />
              <div className="row-tight" style={{ gap: 16, flexWrap: "wrap" }}>
                <label className="row-tight" style={{ gap: 6 }}><input type="checkbox" checked={form.support.doubts} onChange={(e) => setS({ doubts: e.target.checked })} /> Doubts (on {terms.batches} that allow it)</label>
                <label className="row-tight" style={{ gap: 6 }}><input type="checkbox" checked={form.support.tickets} onChange={(e) => setS({ tickets: e.target.checked })} /> Support tickets</label>
              </div>
              {form.support.tickets && (
                <Field label="What it may tell students" hint="Your own rules: payments, refunds, access, opening hours. It already knows how the app works, so how-to questions need nothing here. Anything needing a decision is left for a person, with a suggested line to add here when one would have answered it.">
                  <textarea className="textarea" rows={6} value={form.support.knowledge} onChange={(e) => setS({ knowledge: e.target.value.slice(0, 8000) })}
                    placeholder={"Payments: bKash and card. Access starts as soon as payment completes.\nRefunds: the owner decides within 7 days of purchase.\nPassword: Profile → Security → Change password."} />
                </Field>
              )}
              {form.support.tickets && !form.support.knowledge.trim() && (
                <div className="small" style={{ color: "var(--warning)" }}>Empty: the agent will find open tickets but can't draft replies until you write what it may tell students.</div>
              )}
            </>
          )}

          <hr className="divider" />
          <label className="row-tight" style={{ gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={form.tutor.enabled} onChange={(e) => setForm({ ...form, tutor: { ...form.tutor, enabled: e.target.checked } })} />
            <TutorAgentIcon size={16} style={{ flex: "none" }} /><span><strong>Student tutor</strong>: each student gets a short plan every day from their own results (weakest topic, next lecture, an open exam), with a streak and an exam-sprint mode. No AI cost.</span>
          </label>
          {form.tutor.enabled && (
            <label className="row-tight" style={{ gap: 6, marginLeft: 26 }}>
              <input type="checkbox" checked={form.tutor.eveningNudge} onChange={(e) => setForm({ ...form, tutor: { ...form.tutor, eveningNudge: e.target.checked } })} /> Evening reminder (7pm) when today's plan isn't done
            </label>
          )}

          <hr className="divider" />
          <Field label="Copilot requests per person per day" hint="0 = no limit. Each request is one AI call to plan it.">
            <input className="input" type="number" min={0} style={{ width: 120 }} value={form.dailyRunsPerUser} onChange={(e) => setForm({ ...form, dailyRunsPerUser: Number(e.target.value) })} />
          </Field>
        </div>
      )}
      <ErrorNote error={error} />
      <div className="row-tight" style={{ gap: 10 }}>
        <button className="btn btn-primary" disabled={saving || !dirty} onClick={async () => {
          const r = await update({ agents: form });
          if (!r.error) setSaved(JSON.stringify(form));
        }}>{saving ? "Saving…" : "Save agents"}</button>
        {dirty && !saving && <span className="small" style={{ color: "var(--warning)", fontWeight: 600 }}>Not saved yet: press “Save agents”.</span>}
        {!dirty && isSuccess && !saving && <span className="hint">Saved.</span>}
      </div>
    </div>
  );
}
