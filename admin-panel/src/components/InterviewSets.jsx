import { useState } from "react";
import { Plus, Trash2, Sparkles, ChevronDown, ChevronRight } from "lucide-react";
import {
  useGetInterviewSetsQuery, useCreateInterviewSetMutation, useUpdateInterviewSetMutation, useDeleteInterviewSetMutation,
  useDraftInterviewSetMutation, useGetBatchesQuery, useGetLecturesQuery,
} from "../api/contentApi";
import { ErrorNote, Field, useConfirm } from "./bits";
import SearchSelect from "./SearchSelect";

// Settings → AI → Interview practice → Interviews: the interviews students
// can pick (backend interviewSetModel.js). Each has a panel of one to three
// interviewers, what it is for, what the report scores, and optionally a
// lecture (a viva asked from it only) and the batches that see it.

const KINDS = [["viva", "Viva"], ["admission", "Admission"], ["job", "Job"], ["scholarship", "Scholarship"], ["other", "Other"]];
const BLANK = { title: "", kind: "viva", brief: "", interviewers: [{ name: "", role: "", style: "" }], criteria: [], mustAsk: [], lecture: null, language: "English", questions: 6, batches: [], isPublished: false };

function Editor({ initial, onDone }) {
  const [form, setForm] = useState(() => ({
    ...BLANK,
    ...initial,
    lecture: initial?.lecture?._id || initial?.lecture || null,
    batches: (initial?.batches || []).map((b) => b._id || b),
    interviewers: initial?.interviewers?.length ? initial.interviewers : BLANK.interviewers,
  }));
  const [describe, setDescribe] = useState("");
  const { data: batches } = useGetBatchesQuery({ includeInactive: "true" });
  const { data: lectureData } = useGetLecturesQuery({ limit: 300 });
  const [create, { isLoading: creating, error: createError }] = useCreateInterviewSetMutation();
  const [update, { isLoading: updating, error: updateError }] = useUpdateInterviewSetMutation();
  const [draft, { isLoading: drafting, error: draftError }] = useDraftInterviewSetMutation();
  const set = (patch) => setForm({ ...form, ...patch });
  const setPerson = (i, patch) => set({ interviewers: form.interviewers.map((p, k) => (k === i ? { ...p, ...patch } : p)) });
  const lectures = lectureData?.lectures || [];

  const save = async () => {
    const body = { ...form, interviewers: form.interviewers.filter((p) => p.name.trim()) };
    const r = initial?._id ? await update({ id: initial._id, ...body }) : await create(body);
    if (!r.error) onDone();
  };
  const fill = async () => {
    const r = await draft({ description: describe, lecture: form.lecture || undefined });
    if (r.data) set({ ...r.data, interviewers: r.data.interviewers?.length ? r.data.interviewers : form.interviewers });
  };

  return (
    <div className="card-quiet stack" style={{ gap: 10 }}>
      <Field label="Draft it with AI (optional)" hint="Describe the interview, or pick a lecture below for a viva, and AI fills in the form. Check it, then Save.">
        <div className="row-tight">
          <input className="input grow" placeholder="e.g. Dhaka University Unit A admission viva, for HSC science students" value={describe} onChange={(e) => setDescribe(e.target.value)} />
          <button type="button" className="btn btn-quiet row-tight" disabled={drafting || (!describe.trim() && !form.lecture)} onClick={fill}>
            <Sparkles size={14} /> {drafting ? "Drafting…" : "Draft"}
          </button>
        </div>
        <ErrorNote error={draftError} />
      </Field>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <Field label="Title">
          <input className="input" maxLength={120} value={form.title} onChange={(e) => set({ title: e.target.value })} />
        </Field>
        <Field label="Kind">
          <select className="select" value={form.kind} onChange={(e) => set({ kind: e.target.value })}>
            {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Questions">
          <input className="input" type="number" min="2" max="15" style={{ maxWidth: 90 }} value={form.questions} onChange={(e) => set({ questions: Number(e.target.value) })} />
        </Field>
        <Field label="Language">
          <select className="select" value={form.language} onChange={(e) => set({ language: e.target.value })}>
            <option value="English">English</option>
            <option value="Bangla">Bangla</option>
          </select>
        </Field>
      </div>
      <Field label="What it is for" hint="What the panel should know: the post, the university or the subject, the level, what they look for.">
        <textarea className="input" rows={3} maxLength={2000} value={form.brief} onChange={(e) => set({ brief: e.target.value })} />
      </Field>
      <Field label="Panel" hint="One to three interviewers, each with a different style. The video call layout uses the first one only.">
        <div className="stack" style={{ gap: 6 }}>
          {form.interviewers.map((p, i) => (
            <div key={i} className="row-tight" style={{ flexWrap: "wrap" }}>
              <input className="input" placeholder="Name" maxLength={40} style={{ maxWidth: 160 }} value={p.name} onChange={(e) => setPerson(i, { name: e.target.value })} />
              <input className="input" placeholder="Role, e.g. Head of department" maxLength={60} style={{ maxWidth: 220 }} value={p.role} onChange={(e) => setPerson(i, { role: e.target.value })} />
              <input className="input grow" placeholder="Style, e.g. warm but probing" maxLength={200} value={p.style} onChange={(e) => setPerson(i, { style: e.target.value })} />
              {form.interviewers.length > 1 && (
                <button type="button" className="btn btn-quiet" aria-label="Remove" onClick={() => set({ interviewers: form.interviewers.filter((_, k) => k !== i) })}><Trash2 size={14} /></button>
              )}
            </div>
          ))}
          {form.interviewers.length < 3 && (
            <button type="button" className="btn btn-quiet row-tight" style={{ alignSelf: "flex-start" }} onClick={() => set({ interviewers: [...form.interviewers, { name: "", role: "", style: "" }] })}>
              <Plus size={14} /> Add an interviewer
            </button>
          )}
        </div>
      </Field>
      <Field label="What the report scores" hint="One per line, each out of 10. Empty: the usual ones for this kind.">
        <textarea className="input" rows={3} value={form.criteria.join("\n")} onChange={(e) => set({ criteria: e.target.value.split("\n").slice(0, 6) })} />
      </Field>
      <Field label="Questions they must ask (optional)" hint="One per line. The panel asks these at some point, besides its own.">
        <textarea className="input" rows={3} value={form.mustAsk.join("\n")} onChange={(e) => set({ mustAsk: e.target.value.split("\n").slice(0, 8) })} />
      </Field>
      <Field label="Lecture (for a viva, optional)" hint="The panel then asks from this lecture's notes and files only.">
        <SearchSelect className="select" value={form.lecture || ""} onChange={(e) => set({ lecture: e.target.value || null })}>
          <option value="">None</option>
          {lectures.map((l) => <option key={l._id} value={l._id}>{l.title}</option>)}
        </SearchSelect>
      </Field>
      <Field label="Batches" hint="None ticked: every batch with Interview practice on.">
        <div className="row-tight" style={{ flexWrap: "wrap", gap: 6 }}>
          {(batches || []).map((b) => {
            const on = form.batches.includes(b._id);
            return (
              <button key={b._id} type="button" className={`pill pill-btn${on ? " pill-on" : ""}`} onClick={() => set({ batches: on ? form.batches.filter((x) => x !== b._id) : [...form.batches, b._id] })}>
                {b.name}
              </button>
            );
          })}
        </div>
      </Field>
      <label className="row-tight" style={{ cursor: "pointer" }}>
        <input type="checkbox" checked={form.isPublished} onChange={(e) => set({ isPublished: e.target.checked })} />
        <span>Published: students can pick it</span>
      </label>
      <ErrorNote error={createError || updateError} />
      <div className="row-tight">
        <button type="button" className="btn" disabled={creating || updating || !form.title.trim()} onClick={save}>{creating || updating ? "Saving…" : "Save interview"}</button>
        <button type="button" className="btn btn-quiet" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}

export default function InterviewSets() {
  const { data, isLoading } = useGetInterviewSetsQuery();
  const [remove] = useDeleteInterviewSetMutation();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(null); // null | "new" | id
  const sets = data?.sets || [];
  return (
    <div className="field">
      <span className="label">Interviews</span>
      <span className="hint">The interviews students can pick, besides a viva on any lecture and one they describe themselves (switches above).</span>
      <div className="stack" style={{ gap: 8, marginTop: 8 }}>
        {isLoading && <span className="small muted">Loading…</span>}
        {sets.map((x) => (
          <div key={x._id} className="stack" style={{ gap: 8, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
            <div className="spread">
              <button type="button" className="row-tight grow" style={{ background: "none", border: 0, padding: 0, color: "inherit", cursor: "pointer", textAlign: "left" }} onClick={() => setEditing(editing === x._id ? null : x._id)}>
                {editing === x._id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span>{x.title}</span>
                <span className="small muted">· {KINDS.find(([k]) => k === x.kind)?.[1]} · {x.questions} questions{x.lecture?.title ? ` · ${x.lecture.title}` : ""}{x.batches?.length ? ` · ${x.batches.map((b) => b.name).join(", ")}` : " · all batches"}</span>
              </button>
              <span className={`pill ${x.isPublished ? "pill-ok" : ""}`}>{x.isPublished ? "Published" : "Draft"}</span>
              <button
                type="button"
                className="btn btn-quiet"
                aria-label="Delete"
                onClick={async () => { if (await confirm({ title: `Delete "${x.title}"?`, body: "Students' past sessions on it stay.", confirmLabel: "Delete" })) remove(x._id); }}
              >
                <Trash2 size={14} />
              </button>
            </div>
            {editing === x._id && <Editor initial={x} onDone={() => setEditing(null)} />}
          </div>
        ))}
        {!isLoading && !sets.length && editing !== "new" && <span className="small muted">None yet.</span>}
        {editing === "new" ? (
          <Editor initial={null} onDone={() => setEditing(null)} />
        ) : (
          <button type="button" className="btn btn-quiet row-tight" style={{ alignSelf: "flex-start" }} onClick={() => setEditing("new")}>
            <Plus size={14} /> Add an interview
          </button>
        )}
      </div>
    </div>
  );
}
