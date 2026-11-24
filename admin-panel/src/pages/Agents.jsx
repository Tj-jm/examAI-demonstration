import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bot, Send, Check, X, Loader2, CircleDot, Ban, ArrowUpRight, Inbox, ShieldCheck, Play, Pencil,
  Trash2, Search, ChevronLeft, ChevronRight, ChevronDown, RotateCcw, History,
  ClipboardList, ListPlus, Globe, Megaphone, Video, RefreshCw, ImagePlus,
  CalendarClock, Copy, FolderInput, Users, Sparkles, ShieldAlert, UserCog, ArrowRight, Wallet, Palette, PlayCircle, Layers, Banknote,
} from "lucide-react";
import {
  useGetAgentStatusQuery, useGetAgentRunsQuery, useCreateAgentRunMutation, useDecideAgentStepsMutation, useCancelAgentRunMutation,
  useSweepAgentMutation, useEditAgentStepMutation, useRetryAgentRunMutation, useDeleteAgentRunMutation, useClearAgentRunsMutation,
  useChangeAgentStepPictureMutation, usePreviewAgentStepMutation,
} from "../api/agentApi";
import { Loading, ErrorNote, useConfirm } from "../components/bits";
import { AGENT_ICONS, AgentsGlyph, CopilotIcon } from "../components/AgentIcons";
import CopilotWorkspace from "./CopilotWorkspace";
import AiWrite from "../components/AiWrite";
import { useSeen } from "../hooks/useSeen";
import NewTag from "../components/NewTag";
import SearchSelect from "../components/SearchSelect";

// Agents: tell the copilot what to do, see its plan, approve what it
// should go ahead with. Steps students would see wait here (the inbox)
// unless Settings → AI → Agents lets them run by themselves.

// Everything the copilot can do (backend agents/tools/copilot.js), each
// with an example to start from. Clicking one fills the box. Requests can
// combine them ("make a quiz, publish it and post a notice").
export const CAPABILITIES = [
  [ClipboardList, "Create an exam", "Make a 30-question mock for the HSC batch from chapters 3 to 5, mixed difficulty, nothing used in the last month. Opens Friday 8pm for 3 hours."],
  [ListPlus, "Add questions", "Add 10 more hard questions on Optics to the Physics A mock test."],
  [Globe, "Publish an exam", "Publish the Physics A mock test now."],
  [Megaphone, "Post a notice", "Post a notice to Batch A: no class on Friday, the revision class moves to Saturday 7pm."],
  [Video, "Schedule a live class", "Schedule a revision class for Batch A next Sunday at 7pm for 90 minutes and post a notice about it."],
  [CalendarClock, "Move classes and exams", "Friday is a holiday: move all of Batch A's classes and exams on Friday to Saturday."],
  [Copy, "Copy last week", "Same as last week for Batch A: copy its exams, classes and notices to this week."],
  [FolderInput, "Assign questions", "Assign all published chapter 5 MCQs and passages to Batch A."],
  [Users, "Hand out scripts", "Give Batch A's waiting scripts to the graders, split evenly."],
  [Sparkles, "Write new questions", "Chapter 4 of Physics needs more passages: write 10 with AI and assign them to Batch A once approved."],
  [ShieldAlert, "Warn flagged students", "Warn every student with 3 or more exam flags this week."],
  [UserCog, "Student access and details", "Give Rahim Uddin 30 more days in Batch A."],
  [Wallet, "Payments and coupons", "Record Rahim's 3-month plan for Batch A paid in cash, and make a 20% coupon EID20 for 100 uses until Sunday."],
  [Megaphone, "Campaigns and automations", "Draft an Eid offer to students whose access ended, with code EID20, and send it Friday 6pm. Switch on the trial-ending automation."],
  [Palette, "Student app look", "Switch the student home to Bento and the batch page to Tabs, centred."],
  [PlayCircle, "Lectures", "Publish the lectures Vectors 1 and Vectors 2."],
  [Layers, "Batches and plans", "Add a 6-month plan at 4500 to Batch A and give it a 3-day free trial."],
  [Banknote, "Payslips", "Make Nabila's payslip for November and issue it."],
];

const MODE_TEXT = {
  ask: "Asks before every action",
  safe: "Makes drafts by itself · asks before anything students see",
  auto: "Does everything by itself",
};

export const RUN_STATUS = {
  planning: ["pill", "Planning…"],
  awaiting: ["pill pill-warn", "Waiting for you"],
  running: ["pill", "Working…"],
  done: ["pill pill-ok", "Done"],
  failed: ["pill pill-bad", "Stopped"],
  cancelled: ["pill", "Cancelled"],
  needs_info: ["pill pill-warn", "Has a question"],
};

const STATUS_TABS = [
  ["", "All"], ["waiting", "Waiting for you"], ["open", "In progress"], ["done", "Done"], ["failed", "Stopped"], ["cancelled", "Cancelled"],
];
const AGENT_FILTER = [
  ["", "All agents"], ["copilot", "Admin copilot"], ["grading", "Grading"], ["afterClass", "After class"], ["atRisk", "At-risk students"], ["support", "Support"], ["marketing", "Marketing"],
];

export const ago = (d) => {
  const s = Math.max(1, Math.round((Date.now() - new Date(d)) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(d).toLocaleDateString();
};

function StepIcon({ status }) {
  if (status === "done") return <Check size={15} style={{ color: "var(--correct)" }} />;
  if (status === "failed") return <X size={15} style={{ color: "var(--incorrect)" }} />;
  if (status === "rejected" || status === "skipped") return <Ban size={14} className="muted" />;
  if (status === "running" || status === "approved") return <Loader2 size={15} className="spin" />;
  return <CircleDot size={14} style={{ color: "var(--warning)" }} />;
}

// A drafted answer staff can change before approving.
// The grading agent's "needs a person" step: who gets the script when
// approved — anyone on the batch, or one of its graders and teachers.
function GraderPicker({ run, step }) {
  const [save, { isLoading, error }] = useEditAgentStepMutation();
  return (
    <div className="row-tight small" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
      <span className="muted">On approve, give it to</span>
      <SearchSelect className="select" style={{ maxWidth: 240 }} disabled={isLoading} value={step.args.graderId || ""}
        onChange={(e) => save({ id: run._id, stepId: step._id, args: { graderId: e.target.value } })}>
        <option value="">Anyone on the batch</option>
        {(step.args.graders || []).map((g) => <option key={g._id} value={g._id}>{g.name}</option>)}
      </SearchSelect>
      <ErrorNote error={error} />
    </div>
  );
}

// A notice's AI cover picture, made when the plan was ready: see it, make
// another (from the same or a new description) or leave it out, before
// approving. Each remake is a new AI picture.
function StepPicture({ run, step }) {
  const [change, { isLoading, error }] = useChangeAgentStepPictureMutation();
  const [prompt, setPrompt] = useState(step.args.picture || "");
  const waiting = step.status === "pending";
  if (!step.image && !waiting) return null;
  return (
    <div className="stack" style={{ gap: 6, marginTop: 8 }}>
      {step.image && (
        <img src={step.image} alt="" style={{ maxWidth: 320, width: "100%", borderRadius: 8, display: "block", opacity: isLoading ? 0.5 : 1 }} />
      )}
      {waiting && (
        <>
          <input className="input" style={{ maxWidth: 420 }} value={prompt} maxLength={300} placeholder="What the picture shows"
            onChange={(e) => setPrompt(e.target.value)} disabled={isLoading} />
          <div className="row-tight" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn-sm" disabled={isLoading || !prompt.trim()}
              onClick={() => change({ id: run._id, stepId: step._id, action: "remake", prompt: prompt.trim() })}>
              {isLoading ? <Loader2 size={12} className="spin" /> : step.image ? <RefreshCw size={12} /> : <ImagePlus size={12} />}
              {isLoading ? " Making…" : step.image ? " Remake picture" : " Add a picture"}
            </button>
            {step.image && (
              <button className="btn btn-sm btn-quiet" disabled={isLoading} onClick={() => change({ id: run._id, stepId: step._id, action: "remove" })}>
                <X size={12} /> No picture
              </button>
            )}
          </div>
        </>
      )}
      <ErrorNote error={error} />
    </div>
  );
}

// A notice step: its button and how long it stays up, set before approving.
function NoticeExtras({ run, step }) {
  const [save, { isLoading, error }] = useEditAgentStepMutation();
  const initial = { linkLabel: step.args.linkLabel || "", link: step.args.link || "", durationHours: step.args.durationHours ?? "" };
  const [form, setForm] = useState(initial);
  const [unit, setUnit] = useState(initial.durationHours && initial.durationHours % 24 === 0 ? "days" : "hours");
  const shown = form.durationHours === "" ? "" : unit === "days" ? form.durationHours / 24 : form.durationHours;
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const submit = () => save({
    id: run._id, stepId: step._id,
    args: { linkLabel: form.linkLabel.trim() || null, link: form.link.trim() || null, durationHours: form.durationHours === "" ? null : Number(form.durationHours) },
  });
  return (
    <div className="stack" style={{ gap: 6, marginTop: 8 }}>
      <div className="row-tight" style={{ gap: 8, flexWrap: "wrap" }}>
        <input className="input" style={{ width: 150 }} placeholder="Button text" maxLength={40}
          value={form.linkLabel} onChange={(e) => setForm({ ...form, linkLabel: e.target.value })} />
        <input className="input" style={{ flex: 1, minWidth: 180 }} placeholder="Button link: https://… or /batches/…" maxLength={500}
          value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} />
      </div>
      <div className="row-tight" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span className="small">Stays up for</span>
        <input className="input tnum" type="number" min="1" style={{ width: 80 }} placeholder="always"
          value={shown}
          onChange={(e) => setForm({ ...form, durationHours: e.target.value === "" ? "" : Math.round(Number(e.target.value) * (unit === "days" ? 24 : 1)) })} />
        <select className="input" style={{ width: 90 }} value={unit} onChange={(e) => setUnit(e.target.value)}>
          <option value="hours">hours</option>
          <option value="days">days</option>
        </select>
        <button className="btn btn-sm" disabled={!dirty || isLoading} onClick={submit}>{isLoading ? "Saving…" : "Save"}</button>
        {dirty && <button className="btn btn-sm btn-quiet" onClick={() => setForm(initial)}>Undo</button>}
      </div>
      <span className="hint">Button: give both text and link, or leave both empty. Time counts from when it goes up.</span>
      <ErrorNote error={error} />
    </div>
  );
}

function DraftEditor({ run, step }) {
  const [save, { isLoading, error }] = useEditAgentStepMutation();
  const textKey = step.editable.find((k) => typeof step.args[k] === "string");
  const boolKeys = step.editable.filter((k) => typeof step.args[k] === "boolean");
  const [text, setText] = useState(step.args[textKey] || "");
  const [editing, setEditing] = useState(false);
  if (!textKey) return null;
  const dirty = text !== step.args[textKey];
  return (
    <div className="stack" style={{ gap: 6, marginTop: 8 }}>
      {editing
        ? <textarea className="textarea" rows={5} value={text} onChange={(e) => setText(e.target.value)} />
        : <div className="card-quiet small" style={{ whiteSpace: "pre-wrap" }}>{step.args[textKey]}</div>}
      <div className="row-tight" style={{ gap: 8, flexWrap: "wrap" }}>
        {!editing && <button className="btn btn-sm btn-quiet" onClick={() => setEditing(true)}><Pencil size={12} /> Edit draft</button>}
        {editing && (
          <button className="btn btn-sm" disabled={!dirty || isLoading} onClick={async () => {
            const r = await save({ id: run._id, stepId: step._id, args: { [textKey]: text } });
            if (!r.error) setEditing(false);
          }}>{isLoading ? "Saving…" : "Save draft"}</button>
        )}
        {editing && <button className="btn btn-sm btn-quiet" onClick={() => { setText(step.args[textKey]); setEditing(false); }}>Cancel</button>}
        {boolKeys.map((k) => (
          <label key={k} className="row-tight small" style={{ gap: 6 }}>
            <input type="checkbox" checked={Boolean(step.args[k])} onChange={(e) => save({ id: run._id, stepId: step._id, args: { [k]: e.target.checked } })} />
            {k === "resolve" ? "Mark resolved when sent" : k}
          </label>
        ))}
      </div>
      <ErrorNote error={error} />
    </div>
  );
}

// A copilot request that asked a question or stopped: edit it right here
// and ask again, instead of starting a new request.
function RetryBox({ run, onDone }) {
  const [retry, { isLoading, error }] = useRetryAgentRunMutation();
  const [text, setText] = useState(run.request);
  const ask = async () => {
    const r = await retry({ id: run._id, request: text.trim() });
    if (!r.error) onDone?.();
  };
  return (
    <div className="stack" style={{ gap: 6 }}>
      <textarea
        className="textarea" rows={3} autoFocus value={text}
        onChange={(e) => setText(e.target.value.slice(0, 2000))}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask(); }}
      />
      <div className="row-tight" style={{ gap: 8 }}>
        <button className="btn btn-sm btn-primary" disabled={isLoading || text.trim().length < 4} onClick={ask}>
          <RotateCcw size={13} /> {isLoading ? "Asking…" : "Ask again"}
        </button>
        <span className="hint">{run.status === "needs_info" ? "Answer the question in your request, then ask again." : "Change the request, then ask again."}</span>
      </div>
      <ErrorNote error={error} />
    </div>
  );
}

// Form view: the whole plan as one filled-in form. Nothing runs until
// "Run"; every field can be changed first.
const FIELD_LABEL = {
  title: "Title", mode: "Mode", durationMinutes: "Duration (minutes)", opensAt: "Opens at", liveHours: "Open for (hours)",
  closesAt: "Closes at", unpublishAt: "Unpublish at", description: "Description", attemptsAllowed: "Attempts allowed",
  shuffleQuestions: "Shuffle questions", count: "How many", types: "Types", difficulty: "Difficulty", notUsedInDays: "Not used in the last (days)",
  openNow: "Open now", hours: "Open for (hours)", bodyMarkdown: "Message", publishFrom: "Show from", durationHours: "Stays up (hours)",
  linkLabel: "Button text", link: "Button link", scheduledAt: "Starts at", at: "At",
};
const labelOf = (k) => FIELD_LABEL[k] || k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
const toLocalInput = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

// Pick several from a list: toggle pills, scrolling when long.
function PickMany({ label, options, value, onChange, empty }) {
  const list = (value || []).map(String);
  return (
    <div className="stack" style={{ gap: 4 }}>{label}
      {options.length === 0
        ? <span className="hint">{empty}</span>
        : (
          <div className="row-tight" style={{ gap: 6, flexWrap: "wrap", maxHeight: 150, overflowY: "auto" }}>
            {options.map((o) => {
              const on = list.includes(String(o._id));
              return (
                <button key={o._id} type="button" className={`pill pill-btn${on ? " pill-on" : ""}`}
                  onClick={() => onChange(on ? list.filter((x) => x !== String(o._id)) : [...list, String(o._id)])}>{o.title}</button>
              );
            })}
          </div>
        )}
    </div>
  );
}

function FormField({ f, value, onChange, choices, stepValues, aside }) {
  const name = <span className="small" style={{ fontWeight: 600 }}>{labelOf(f.key)}{f.optional ? "" : " *"}</span>;
  const label = aside ? <div className="spread" style={{ gap: 6, flexWrap: "wrap" }}>{name}{aside}</div> : name;
  const c = choices || {};
  if (f.kind === "graders") return <PickMany label={label} options={c.graders || []} value={value} onChange={onChange} empty="No graders on the batches you can act on." />;
  if (f.kind === "batches") return <PickMany label={label} options={c.batches || []} value={value} onChange={onChange} empty="No batches you can act on." />;
  if (f.kind === "chapters") {
    const sub = stepValues?.subjectId;
    const opts = (c.chapters || []).filter((ch) => !sub || String(ch.subject) === String(sub));
    return <PickMany label={label} options={opts} value={value} onChange={onChange} empty="Pick a subject first, or leave empty for any chapter." />;
  }
  if (f.kind === "topics") {
    const chs = (stepValues?.chapterIds || []).map(String);
    if (!chs.length) return null;
    const opts = (c.topics || []).filter((t) => chs.includes(String(t.chapter)));
    return <PickMany label={label} options={opts} value={value} onChange={onChange} empty="These chapters have no topics." />;
  }
  if (["batch", "exam", "subject", "chapter", "topic"].includes(f.kind)) {
    const subjectName = new Map((c.subjects || []).map((x) => [String(x._id), x.title]));
    const opts = {
      batch: c.batches, exam: c.exams, subject: c.subjects,
      chapter: (c.chapters || []).map((ch) => ({ _id: ch._id, title: `${subjectName.get(String(ch.subject)) || ""} · ${ch.title}` })),
      topic: (c.topics || []).filter((t) => String(t.chapter) === String(stepValues?.chapterId)),
    }[f.kind] || [];
    if (f.kind === "topic" && !opts.length) return null;
    return (
      <label className="stack" style={{ gap: 4 }}>{label}
        <select className="select" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
          {(f.optional || !value) && <option value="">{f.kind === "subject" ? "Any subject" : "—"}</option>}
          {opts.map((o) => <option key={o._id} value={o._id}>{o.title}</option>)}
        </select>
      </label>
    );
  }
  if (f.kind === "bool") {
    return <label className="row-tight small" style={{ gap: 6 }}><input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />{labelOf(f.key)}</label>;
  }
  if (f.kind === "multi") {
    const list = value || [];
    return (
      <div className="stack" style={{ gap: 4 }}>{label}
        <div className="row-tight" style={{ gap: 6, flexWrap: "wrap" }}>
          {f.options.map((o) => (
            <button key={o} type="button" className={`pill pill-btn${list.includes(o) ? " pill-on" : ""}`}
              onClick={() => onChange(list.includes(o) ? list.filter((x) => x !== o) : [...list, o])}>{o}</button>
          ))}
        </div>
      </div>
    );
  }
  let input;
  if (f.kind === "enum") {
    input = (
      <select className="select" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
        {f.optional && <option value="">—</option>}
        {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  } else if (f.kind === "number") {
    input = <input className="input tnum" type="number" value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} />;
  } else if (f.kind === "date") {
    input = <input className="input" type="datetime-local" value={toLocalInput(value)} onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)} />;
  } else if (f.kind === "long") {
    input = <textarea className="textarea" rows={4} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
  } else {
    input = <input className="input" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
  }
  return aside ? <div className="stack" style={{ gap: 4 }}>{label}{input}</div> : <label className="stack" style={{ gap: 4 }}>{label}{input}</label>;
}

// What a step would act on, checked against the form as it is: the
// questions it draws from, the classes it moves, the students it warns...
function StepPreview({ run, step, args, batchIds }) {
  const [preview, { data, isLoading, error }] = usePreviewAgentStepMutation();
  const [open, setOpen] = useState(false);
  const check = () => preview({ id: run._id, stepId: step._id, args: { ...args, ...(batchIds ? { batchIds } : {}) } });
  useEffect(() => { check(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="card-quiet stack small" style={{ gap: 6 }}>
      <div className="row-tight" style={{ gap: 8, flexWrap: "wrap" }}>
        {isLoading ? <span className="muted"><Loader2 size={12} className="spin" /> Checking…</span>
          : data ? <span style={data.warn ? { color: "var(--incorrect)" } : undefined}>{data.summary}</span> : null}
        <button className="link-btn" onClick={check} disabled={isLoading}><RefreshCw size={11} /> Check again</button>
        {data?.items?.length > 0 && <button className="link-btn" onClick={() => setOpen((v) => !v)}>{open ? "Hide list" : "See list"}</button>}
      </div>
      {open && data && (
        <ol style={{ margin: 0, paddingLeft: 18 }}>
          {data.items.map((it, i) => <li key={i}>{it.tag && <span className="muted">[{it.tag}]</span>} {it.text || "(no text)"}</li>)}
          {data.total > data.items.length && <li className="muted">…and {data.total - data.items.length} more</li>}
        </ol>
      )}
      <ErrorNote error={error} />
    </div>
  );
}

export function FormRun({ run }) {
  const [save] = useEditAgentStepMutation();
  const [decide] = useDecideAgentStepsMutation();
  const pending = run.steps.filter((s) => s.status === "pending");
  // "Write a description" for an exam this plan makes is the exam's own
  // Description field here; the step only runs if that is left empty.
  const descFor = {};
  for (const s of pending) {
    const m = s.tool === "write_exam_description" && /^step:(\d+)$/.exec(String(s.args.exam));
    const target = m && run.steps[Number(m[1]) - 1];
    if (target?.tool === "create_exam" && target.status === "pending") descFor[target._id] = s;
  }
  const folded = new Set(Object.values(descFor).map((s) => s._id));
  const [values, setValues] = useState(() => Object.fromEntries(pending.map((s) => [s._id, { ...s.args }])));
  const [skip, setSkip] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (sid, k, v) => setValues((all) => ({ ...all, [sid]: { ...all[sid], [k]: v } }));
  // The exam as this form describes it, for Write with AI.
  const examDraft = (examStep) => {
    const v = values[examStep._id] || {};
    const ref = `step:${run.steps.findIndex((x) => x._id === examStep._id) + 1}`;
    const qs = pending.filter((x) => x.tool === "add_questions" && !skip[x._id] && values[x._id]?.exam === ref).map((x) => values[x._id]);
    const types = [...new Set(qs.flatMap((q) => q.types?.length ? q.types : []))];
    return {
      title: v.title, mode: v.mode, durationMinutes: v.durationMinutes, attemptsAllowed: v.attemptsAllowed,
      opensAt: v.opensAt, liveHours: v.liveHours, shuffleQuestions: v.shuffleQuestions,
      questionCount: qs.reduce((n, q) => n + (Number(q.count) || 0), 0) || undefined,
      types: types.length ? types : undefined,
      hasWritten: types.length ? types.some((t) => t === "written" || t === "passage") : undefined,
    };
  };
  // An exam this plan makes: its batches as set on the form so far.
  const examStepBatches = (ref) => {
    const m = /^step:(\d+)$/.exec(String(ref || ""));
    const st = m && run.steps[Number(m[1]) - 1];
    return st ? values[st._id]?.batchIds || st.args.batchIds : undefined;
  };

  const runAll = async () => {
    setBusy(true);
    setError(null);
    for (const s of pending) {
      if (skip[s._id]) continue;
      const changed = {};
      for (const f of s.fields || []) {
        const v = values[s._id]?.[f.key];
        if (JSON.stringify(v ?? null) !== JSON.stringify(s.args[f.key] ?? null)) changed[f.key] = v ?? null;
      }
      if (Object.keys(changed).length) {
        const r = await save({ id: run._id, stepId: s._id, args: changed });
        if (r.error) { setError(r.error); setBusy(false); return; }
      }
    }
    // A folded description step: dropped with its exam, or when the
    // description was written on the form.
    const off = (s) => {
      if (skip[s._id]) return true;
      if (!folded.has(s._id)) return false;
      const examStep = run.steps[Number(/^step:(\d+)$/.exec(String(s.args.exam))[1]) - 1];
      return Boolean(skip[examStep._id] || String(values[examStep._id]?.description || "").trim());
    };
    const no = pending.filter(off).map((s) => s._id);
    const yes = pending.filter((s) => !off(s)).map((s) => s._id);
    const r = await decide({ id: run._id, stepIds: yes, rejectIds: no, approve: true });
    if (r.error) setError(r.error);
    setBusy(false);
  };

  return (
    <div className="stack" style={{ gap: 10 }}>
      {pending.filter((s) => !folded.has(s._id)).map((s) => (
        <div key={s._id} className="agent-step agent-step-pending" style={{ gap: 8, flexDirection: "column", alignItems: "stretch", opacity: skip[s._id] ? 0.5 : 1 }}>
          <div className="spread" style={{ gap: 8, flexWrap: "wrap" }}>
            <strong className="row-tight" style={{ gap: 8 }}>{s.title}
              {s.risk === "publish" && <span className="pill" title="Students will see this or be notified">students see this</span>}
            </strong>
            <label className="row-tight small" style={{ gap: 6 }}>
              <input type="checkbox" checked={!skip[s._id]} onChange={(e) => setSkip({ ...skip, [s._id]: !e.target.checked })} /> Do this
            </label>
          </div>
          {s.detail && <div className="small muted">{s.detail}</div>}
          {!skip[s._id] && (
            <div className="agent-form-grid">
              {(s.fields || []).map((f) => (
                <div key={f.key} style={f.kind === "long" || f.kind === "multi" ? { gridColumn: "1 / -1" } : undefined}>
                  <FormField f={f} value={values[s._id]?.[f.key]} onChange={(v) => set(s._id, f.key, v)} choices={run.choices} stepValues={values[s._id]}
                    aside={s.tool === "create_exam" && f.key === "description" ? (
                      <AiWrite
                        task="examDescription"
                        input={{ exam: examDraft(s) }}
                        prompt="optional"
                        promptLabel="Anything to add? Topics covered, materials allowed"
                        placeholder={descFor[s._id]?.args.note || "e.g. Covers chapters 3-5. Bring a calculator."}
                        title="Write the rules students see before they start, from this form"
                        onResult={(d) => set(s._id, "description", d.description)}
                      />
                    ) : null} />
                  {s.tool === "create_exam" && f.key === "description" && descFor[s._id] && !String(values[s._id]?.description || "").trim() && (
                    <span className="hint">Left empty, AI writes it after the questions are added{descFor[s._id].args.note ? `, adding: ${descFor[s._id].args.note}` : ""}.</span>
                  )}
                </div>
              ))}
            </div>
          )}
          {!skip[s._id] && s.hasPreview && (
            <StepPreview run={run} step={s} args={values[s._id] || s.args} batchIds={s.tool === "add_questions" ? examStepBatches(values[s._id]?.exam) : undefined} />
          )}
          {!skip[s._id] && s.hasPicture && <StepPicture run={run} step={s} />}
          {!skip[s._id] && s.tool === "review_script" && <GraderPicker run={run} step={s} />}
        </div>
      ))}
      <ErrorNote error={error} />
      <div className="row-tight" style={{ gap: 8 }}>
        <button className="btn btn-primary" disabled={busy} onClick={runAll}><Play size={14} /> {busy ? "Running…" : "Run"}</button>
        <span className="hint">Changes are checked when you press Run.</span>
      </div>
    </div>
  );
}

// What a step changes, field by field: before → after.
export function ChangeTable({ changes }) {
  return (
    <table className="small" style={{ marginTop: 6, borderCollapse: "collapse" }}>
      <tbody>
        {changes.map((c) => (
          <tr key={c.label}>
            <td className="muted" style={{ padding: "2px 12px 2px 0" }}>{c.label}</td>
            <td style={{ padding: "2px 8px 2px 0", textDecoration: "line-through", opacity: 0.6 }}>{c.from}</td>
            <td style={{ padding: "2px 8px 2px 0" }}><ArrowRight size={12} /></td>
            <td style={{ padding: "2px 0", fontWeight: 600 }}>{c.to}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// A request's steps: what each does, its result, and approve / reject.
export function RunSteps({ run }) {
  const [decide, { isLoading: deciding }] = useDecideAgentStepsMutation();
  return (
    <ol className="agent-steps">
      {run.steps.map((s, i) => (
        <li key={s._id} className={`agent-step agent-step-${s.status}`}>
          <span className="agent-step-n tnum">{i + 1}</span>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="row-tight" style={{ gap: 8, flexWrap: "wrap" }}>
              <StepIcon status={s.status} />
              <strong>{s.title}</strong>
              {s.risk === "publish" && <span className="pill" title="Students will see this or be notified">students see this</span>}
              {s.risk === "staff" && <span className="pill" title="Changes what graders and teachers see">staff work</span>}
            </div>
            {s.changes?.length > 0 ? <ChangeTable changes={s.changes} /> : s.detail && <div className="small muted" style={{ marginTop: 2 }}>{s.detail}</div>}
            {s.link && !s.result?.link && <Link to={s.link} className="small row-tight" style={{ display: "inline-flex", gap: 2, marginTop: 2 }}>Open the script <ArrowUpRight size={12} /></Link>}
            {s.tool === "review_script" && s.status === "pending" && <GraderPicker run={run} step={s} />}
            {s.hasPicture && <StepPicture run={run} step={s} />}
            {s.tool === "post_notice" && s.status === "pending" && <NoticeExtras run={run} step={s} />}
            {s.editable?.length > 0 && s.status === "pending" && !["review_script", "post_notice"].includes(s.tool) && <DraftEditor run={run} step={s} />}
            {s.result?.summary && (
              <div className="small" style={{ marginTop: 4 }}>
                {s.result.summary}{" "}
                {s.result.link && <Link to={s.result.link} className="row-tight" style={{ display: "inline-flex", gap: 2 }}>Open <ArrowUpRight size={12} /></Link>}
              </div>
            )}
            {s.error && <div className="small" style={{ color: "var(--incorrect)", marginTop: 4 }}>{s.error}</div>}
            {s.needsApproval && (
              <div className="row-tight" style={{ gap: 6, marginTop: 8 }}>
                <button className="btn btn-sm btn-primary" disabled={deciding} onClick={() => decide({ id: run._id, stepIds: [s._id], approve: true })}><Check size={13} /> Approve</button>
                <button className="btn btn-sm" disabled={deciding} onClick={() => decide({ id: run._id, stepIds: [s._id], approve: false })}><X size={13} /> Reject</button>
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function RunCard({ run, isNew }) {
  const [decide, { isLoading: deciding, error }] = useDecideAgentStepsMutation();
  const [cancel] = useCancelAgentRunMutation();
  const [remove, { isLoading: removing, error: removeError }] = useDeleteAgentRunMutation();
  const confirm = useConfirm();
  const waiting = run.steps.filter((s) => s.needsApproval);
  const [cls, label] = RUN_STATUS[run.status] || ["pill", run.status];
  const RunIcon = AGENT_ICONS[run.agent] || Bot;
  const open = ["planning", "awaiting", "running"].includes(run.status);
  const finished = ["done", "failed", "cancelled"].includes(run.status);
  // Finished work folds away; anything still needing a look stays open.
  const [showSteps, setShowSteps] = useState(!finished);
  const [editing, setEditing] = useState(run.status === "needs_info");
  const [showHistory, setShowHistory] = useState(false);
  useEffect(() => { if (run.status === "needs_info") setEditing(true); }, [run.status]);

  const del = async () => {
    const ok = await confirm({
      title: "Delete this request?",
      body: run.status === "awaiting" ? "Its steps waiting for approval are cancelled. Nothing it already did is undone." : "It's removed from this page. Nothing it already did is undone.",
      confirmLabel: "Delete",
    });
    if (ok) remove(run._id);
  };

  return (
    <div className="card stack" style={{ gap: 12 }}>
      <div className="spread" style={{ alignItems: "flex-start", gap: 12 }}>
        <div className="grow" style={{ minWidth: 0 }}>
          <NewTag show={isNew} />
          {run.agent === "copilot"
            ? <div style={{ fontWeight: 600, whiteSpace: "pre-wrap" }}>“{run.request}”</div>
            : <div style={{ fontWeight: 600 }}>{run.request}</div>}
          <div className="hint">
            {run.agent === "copilot" ? (run.user?.name ? `${run.user.name} · ` : "") : `${run.agentLabel} · `}{ago(run.createdAt)}
            {run.history?.length > 0 && (
              <> · <button className="link-btn" onClick={() => setShowHistory((v) => !v)}><History size={11} /> {run.history.length} earlier {run.history.length === 1 ? "try" : "tries"}</button></>
            )}
          </div>
        </div>
        <div className="row-tight" style={{ gap: 6, flex: "none" }}>
          <span className={cls}>{run.status === "planning" || run.status === "running" ? <Loader2 size={11} className="spin" style={{ marginRight: 4 }} /> : null}{label}</span>
          {!["planning", "running"].includes(run.status) && (
            <button className="icon-btn icon-btn-danger" title="Delete" aria-label="Delete request" disabled={removing} onClick={del}><Trash2 size={14} /></button>
          )}
        </div>
      </div>

      {showHistory && (
        <div className="card-quiet stack small" style={{ gap: 8 }}>
          {run.history.map((h, i) => (
            <div key={i}>
              <div style={{ whiteSpace: "pre-wrap" }}>“{h.request}”</div>
              <div className="muted" style={{ whiteSpace: "pre-wrap" }}>{h.reply || h.error}</div>
            </div>
          ))}
        </div>
      )}

      {run.reply && (
        <div className="row-tight" style={{ gap: 10, alignItems: "flex-start" }}>
          <span className="agent-avatar"><RunIcon size={18} /></span>
          <div className="grow" style={{ whiteSpace: "pre-wrap" }}>
            {run.reply}
            {run.drawers?.length > 0 && <div className="hint" style={{ marginTop: 4 }}>Using: {run.drawers.join(" · ")}</div>}
          </div>
        </div>
      )}

      {run.steps.length > 0 && finished && (
        <button className="link-btn small" style={{ alignSelf: "flex-start" }} onClick={() => setShowSteps((v) => !v)}>
          <ChevronDown size={13} style={{ transform: showSteps ? "rotate(180deg)" : "none" }} /> {showSteps ? "Hide" : "Show"} {run.steps.length} step{run.steps.length === 1 ? "" : "s"}
        </button>
      )}
      {run.form && run.status === "awaiting" && <FormRun key={run._id} run={run} />}
      {run.steps.length > 0 && showSteps && !(run.form && run.status === "awaiting") && <RunSteps run={run} />}

      {run.error && run.status === "failed" && <div className="small" style={{ color: "var(--incorrect)" }}>{run.error}</div>}
      {run.canRetry && (editing
        ? <RetryBox key={run.updatedAt} run={run} onDone={() => setEditing(false)} />
        : <button className="btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => setEditing(true)}><Pencil size={13} /> Edit and ask again</button>)}
      <ErrorNote error={error || removeError} />
      {open && (
        <div className="row-tight" style={{ gap: 8 }}>
          {waiting.length > 1 && !run.form && (
            <button className="btn btn-sm btn-primary" disabled={deciding} onClick={() => decide({ id: run._id, stepIds: "all", approve: true })}>
              <Check size={13} /> Approve all {waiting.length}
            </button>
          )}
          <span className="grow" />
          <button className="btn btn-sm btn-quiet" onClick={() => cancel(run._id)}>Cancel request</button>
        </div>
      )}
    </div>
  );
}

const BG_ICON = AGENT_ICONS;
const BG_TEXT = {
  grading: "Marks written answers waiting for grading every 10 minutes; offers to apply the scripts it's sure about.",
  afterClass: "After an in-app class: a quiz from the class notes and a catch-up message for absentees.",
  atRisk: "Every Sunday: students whose scores fell, who went quiet or missed classes, each offered a personal check-in.",
  support: "Drafts answers to escalated doubts and replies to new tickets; you read, edit and send.",
  marketing: "Every Saturday: campaigns to students who could buy now, and automations worth switching on. You approve each.",
};

function BackgroundAgents({ agents }) {
  const [sweep, { isLoading, data, error, originalArgs }] = useSweepAgentMutation();
  if (!agents?.length) return null;
  const said = (key) => {
    if (originalArgs !== key || !data) return null;
    const blocked = key === "grading" && data.blocked?.length ? (
      <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
        {data.blocked.map((b) => <li key={b.batchId}><Link to={`/batches/${b.batchId}`}>{b.name}</Link>: {b.waiting} waiting, but {b.missing.join(" + ")} {b.missing.length === 1 ? "is" : "are"} off for this batch.</li>)}
      </ul>
    ) : null;
    if (data.skipped) return <>{`Nothing to do: ${data.skipped}.`}{blocked}</>;
    if (key === "grading") return <>{data.run ? `Marked ${data.marked} answers; ${data.needTeacher ? `${data.needTeacher} need a person. ` : ""}See the plan below.` : `Marked ${data.marked || 0} answers; nothing new to apply or review.`}{blocked}</>;
    if (key === "support") {
      const f = data.found || {};
      const head = `Found ${f.tickets || 0} open ticket${f.tickets === 1 ? "" : "s"} and ${f.doubts || 0} escalated doubt${f.doubts === 1 ? "" : "s"}. ${data.run ? `Drafted ${data.drafted}; see below.` : "Nothing drafted."}`;
      const more = [...(data.notes || []), ...(data.forPeople || []).map((x) => `Left for a person: ${x}`)];
      return more.length ? <>{head}<ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{more.map((m) => <li key={m}>{m}</li>)}</ul></> : head;
    }
    if (key === "marketing") return data.runs?.length ? "Proposals ready; see below." : "Nothing worth sending this week.";
    if (key === "atRisk") return data.runs?.length ? `Found students to check on in ${data.runs.length} batch${data.runs.length === 1 ? "" : "es"}; see below.` : "Nobody new needs a check-in.";
    return data.runs?.length ? `Planned for ${data.runs.length} class${data.runs.length === 1 ? "" : "es"}.` : "No ended classes waiting.";
  };
  return (
    <div className="agent-bg">
      {agents.map((a) => {
        const Icon = BG_ICON[a.key] || Bot;
        return (
          <div key={a.key} className="card stack" style={{ gap: 8 }}>
            <div className="spread">
              <strong className="row-tight" style={{ gap: 8 }}><Icon size={20} style={{ color: "var(--primary)" }} /> {a.label}</strong>
              <span className={`pill${a.enabled ? " pill-ok" : ""}`}>{a.enabled ? "On" : "Off"}</span>
            </div>
            <div className="hint">{BG_TEXT[a.key]}</div>
            <div className="row-tight" style={{ gap: 8 }}>
              {a.enabled
                ? <button className="btn btn-sm" disabled={isLoading} onClick={() => sweep(a.key)}><Play size={13} /> {isLoading && originalArgs === a.key ? "Running…" : "Run now"}</button>
                : <Link className="btn btn-sm btn-quiet" to="/settings?tab=ai&sub=agents">Turn on</Link>}
              <span className="small muted grow">{said(a.key)}</span>
            </div>
            {originalArgs === a.key && <ErrorNote error={error} />}
          </div>
        );
      })}
    </div>
  );
}

export default function Agents() {
  const isNew = useSeen("agents");
  // Always fresh: settings may have just been changed on another page.
  const { data: statusData, isLoading } = useGetAgentStatusQuery(undefined, { refetchOnMountOrArgChange: true });
  const [text, setText] = useState("");
  // Steps: the plan as approvable steps. Form: one form to fill, then Run.
  const [view, setView] = useState(() => { try { return localStorage.getItem("copilotView") || "steps"; } catch { return "steps"; } });
  const [pickedLayout, setPickedLayout] = useState(() => { try { return localStorage.getItem("copilotLayout") || null; } catch { return null; } });
  const pickLayout = (v) => { setPickedLayout(v); try { localStorage.setItem("copilotLayout", v); } catch { /* ignore */ } };
  const pickView = (v) => { setView(v); try { localStorage.setItem("copilotView", v); } catch { /* ignore */ } };
  const [create, { isLoading: sending, error: sendError }] = useCreateAgentRunMutation();
  const [clear, { isLoading: clearing }] = useClearAgentRunsMutation();
  const confirm = useConfirm();
  // List filters: status group, agent, text, page.
  const [status, setStatus] = useState("");
  const [agent, setAgent] = useState("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => { const t = setTimeout(() => setQ(search.trim()), 350); return () => clearTimeout(t); }, [search]);
  useEffect(() => setPage(1), [status, agent, q]);
  const busy = (runs) => (runs || []).some((r) => ["planning", "running"].includes(r.status));
  const [fast, setFast] = useState(false);
  const runsQ = useGetAgentRunsQuery({ status, agent, q, page }, { pollingInterval: fast ? 2000 : 15000 });
  const runs = runsQ.data?.runs;
  // Poll quickly while the copilot is planning or working.
  useEffect(() => setFast(busy(runs)), [runs]);
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  const filtered = Boolean(status || agent || q);

  if (isLoading) return <Loading />;

  // Classic or Workspace: the admin's default (Settings → AI → Agents), and
  // each person's own pick on this page, remembered in the browser.
  const layout = pickedLayout || statusData?.view || "classic";
  const switcher = (
    <div className="row-tight" style={{ gap: 4 }}>
      {[["classic", "Classic"], ["workspace", "Workspace"]].map(([k, t]) => (
        <button key={k} className={`pill pill-btn${layout === k ? " pill-on" : ""}`} onClick={() => pickLayout(k)}>{t}</button>
      ))}
    </div>
  );
  if (layout === "workspace") {
    return <CopilotWorkspace status={statusData} modeText={statusData?.available ? MODE_TEXT[statusData.mode] : null} switcher={switcher} />;
  }

  const send = async () => {
    if (!text.trim()) return;
    const r = await create({ request: text.trim(), timezone: tz, form: view === "form" });
    if (!r.error) { setText(""); setStatus(""); setAgent(""); setSearch(""); setPage(1); setFast(true); }
  };

  const clearFinished = async () => {
    const ok = await confirm({
      title: filtered ? "Delete the finished requests shown?" : "Delete all finished requests?",
      body: "Requests that are done, stopped, cancelled or asked a question are removed from this page. Anything waiting for approval or still working stays. Nothing they already did is undone.",
      confirmLabel: "Delete",
    });
    if (ok) { await clear({ status, agent, q }); setPage(1); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div className="spread">
          <h1 className="row-tight" style={{ gap: 10 }}><AgentsGlyph size={24} /> Agents</h1>
          {switcher}
        </div>
      </div>

      <div className="stack" style={{ maxWidth: 860 }}>
        <div className="card stack" style={{ gap: 10 }}>
          <div className="spread">
            <strong className="row-tight" style={{ gap: 8 }}><CopilotIcon size={20} style={{ color: "var(--primary)" }} /> Admin copilot</strong>
            {statusData?.available && <span className="pill row-tight" style={{ gap: 5 }}><ShieldCheck size={12} /> {MODE_TEXT[statusData.mode]}</span>}
          </div>
          {!statusData?.available ? (
            <div className="card-quiet small">
              {statusData?.reason} <Link to="/settings?tab=ai&sub=agents">Open AI settings</Link>
            </div>
          ) : (
            <>
              <textarea
                className="textarea"
                rows={3}
                placeholder="Tell it what to do, in your own words…"
                value={text}
                onChange={(e) => setText(e.target.value.slice(0, 2000))}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }}
              />
              <div className="stack" style={{ gap: 6 }}>
                <span className="hint">What it can do: tap one for an example to edit. It can't do anything else yet.</span>
                <div className="row-tight" style={{ gap: 6, flexWrap: "wrap" }}>
                  {CAPABILITIES.map(([Icon, label, example]) => (
                    <button key={label} className="pill pill-btn row-tight" style={{ gap: 5 }} title={example} onClick={() => setText(example)}>
                      <Icon size={12} /> {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="spread" style={{ gap: 10 }}>
                <span className="hint grow">
                  {statusData.batches.length
                    ? <>Can act on: {statusData.batches.map((b) => b.name).join(", ")}</>
                    : <>Not switched on for any batch yet: Batch → What is included → Admin copilot.</>}
                </span>
                <div className="row-tight" style={{ gap: 4 }} title="Steps: approve each step. Form: check one filled-in form, then Run.">
                  {[["steps", "Steps"], ["form", "Form"]].map(([k, t]) => (
                    <button key={k} className={`pill pill-btn${view === k ? " pill-on" : ""}`} onClick={() => pickView(k)}>{t}</button>
                  ))}
                </div>
                <button className="btn btn-primary" disabled={sending || !text.trim()} onClick={send}><Send size={14} /> {sending ? "Sending…" : "Send"}</button>
              </div>
              <ErrorNote error={sendError} />
            </>
          )}
        </div>

        <BackgroundAgents agents={statusData?.background} />

        <div className="stack" style={{ gap: 8 }}>
          <div className="row-tight" style={{ gap: 6, flexWrap: "wrap" }}>
            {STATUS_TABS.map(([key, text]) => (
              <button key={key} className={`pill pill-btn${status === key ? " pill-on" : ""}`} onClick={() => setStatus(key)}>
                {key === "waiting" && <Inbox size={12} style={{ marginRight: 4 }} />}
                {text}{key === "waiting" && status !== key && statusData?.waiting ? ` · ${statusData.waiting}` : ""}
              </button>
            ))}
          </div>
          <div className="row-tight" style={{ gap: 8, flexWrap: "wrap" }}>
            <div className="search-wrap grow" style={{ minWidth: 180 }}>
              <Search size={14} className="search-icon" />
              <input className="input" style={{ paddingLeft: 34 }} placeholder="Search requests…" value={search} onChange={(e) => setSearch(e.target.value.slice(0, 100))} />
            </div>
            <select className="select" style={{ width: "auto" }} value={agent} onChange={(e) => setAgent(e.target.value)}>
              {AGENT_FILTER.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
            </select>
            <button className="btn btn-sm btn-quiet" disabled={clearing || !runsQ.data?.total} onClick={clearFinished} title="Delete finished requests">
              <Trash2 size={13} /> {clearing ? "Deleting…" : "Clear finished"}
            </button>
          </div>
        </div>

        {runsQ.isLoading && <Loading />}
        <ErrorNote error={runsQ.error} />
        {runs && runs.length === 0 && (
          <div className="card-quiet hint">
            {filtered ? "Nothing matches these filters." : "No requests yet. Ask the copilot to make an exam, post a notice or schedule a class."}
          </div>
        )}
        {(runs || []).map((r) => <RunCard key={r._id} run={r} isNew={["awaiting", "needs_info"].includes(r.status) && isNew(r.updatedAt)} />)}

        {runsQ.data && runsQ.data.pages > 1 && (
          <div className="spread" style={{ gap: 10 }}>
            <span className="hint tnum">
              {(runsQ.data.page - 1) * runsQ.data.limit + 1}–{Math.min(runsQ.data.page * runsQ.data.limit, runsQ.data.total)} of {runsQ.data.total}
            </span>
            <div className="row-tight" style={{ gap: 6 }}>
              <button className="btn btn-sm" disabled={page <= 1} onClick={() => { setPage(page - 1); window.scrollTo({ top: 0 }); }}><ChevronLeft size={14} /> Newer</button>
              <span className="small tnum">Page {runsQ.data.page} of {runsQ.data.pages}</span>
              <button className="btn btn-sm" disabled={page >= runsQ.data.pages} onClick={() => { setPage(page + 1); window.scrollTo({ top: 0 }); }}>Older <ChevronRight size={14} /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
