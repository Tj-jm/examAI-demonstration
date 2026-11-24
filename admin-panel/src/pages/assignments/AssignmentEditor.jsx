import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Plus, Trash2, Upload, Paperclip } from "lucide-react";
import {
  useGetAssignmentQuery, useSaveAssignmentMutation, useDeleteAssignmentMutation, useUploadAssignmentAttachmentMutation, useGetBatchesQuery,
} from "../../api/contentApi";
import { Loading, ErrorNote, Field, useConfirm } from "../../components/bits";
import { useTerms } from "../../terms";
import MarkdownEditor from "../../components/MarkdownEditor";
import SearchSelect from "../../components/SearchSelect";

// Set or change an assignment.
const toLocal = (d) => (d ? new Date(new Date(d).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");
const inAWeek = () => { const d = new Date(Date.now() + 7 * 86400000); d.setHours(23, 59, 0, 0); return d; };

export default function AssignmentEditor() {
  const terms = useTerms();
  const { id } = useParams();
  const isNew = !id || id === "new";
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { data: existing, isLoading } = useGetAssignmentQuery(id, { skip: isNew });
  const { data: batches } = useGetBatchesQuery({});
  const [save, { isLoading: saving, error }] = useSaveAssignmentMutation();
  const [remove, { error: removeError }] = useDeleteAssignmentMutation();
  const [upload, { isLoading: uploading, error: uploadError }] = useUploadAssignmentAttachmentMutation();
  const [f, setF] = useState(null);

  useEffect(() => {
    if (f) return;
    if (isNew) {
      setF({
        batch: params.get("batch") || "", title: "", instructions: "", category: "Assignments", attachments: [],
        opensAt: "", dueAt: toLocal(inAWeek()), allowLate: false, lateDays: 3, latePenalty: 10,
        submissionType: "both", maxFiles: 5, maxMarks: 10, rubric: [], markingNotes: "", isPublished: false,
      });
    } else if (existing) {
      setF({ ...existing, batch: existing.batch?._id || existing.batch, opensAt: toLocal(existing.opensAt), dueAt: toLocal(existing.dueAt) });
    }
  }, [existing, isNew, f, params]);

  if ((!isNew && isLoading) || !f) return <div className="page"><Loading /></div>;
  const set = (patch) => setF({ ...f, ...patch });
  const rubricTotal = f.rubric.reduce((s, r) => s + (Number(r.marks) || 0), 0);

  const submit = async (publish) => {
    const body = {
      ...f,
      id: isNew ? undefined : id,
      opensAt: f.opensAt ? new Date(f.opensAt).toISOString() : null,
      dueAt: new Date(f.dueAt).toISOString(),
      maxMarks: f.rubric.length ? rubricTotal : Number(f.maxMarks),
      rubric: f.rubric.filter((r) => r.criterion.trim()).map((r) => ({ ...r, marks: Number(r.marks) || 0 })),
      ...(publish !== undefined ? { isPublished: publish } : {}),
    };
    const saved = await save(body).unwrap();
    navigate(`/grading/assignments/${saved._id}/hand-ins`);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <Link to="/grading/assignments" className="small muted row-tight"><ArrowLeft size={13} /> Assignments</Link>
          <h1 style={{ marginTop: 6 }}>{isNew ? "New assignment" : f.title}</h1>
        </div>
      </div>

      <div className="card stack">
        <Field label={terms.Batch}>
          <SearchSelect className="select" value={f.batch} disabled={!isNew} onChange={(e) => set({ batch: e.target.value })}>
            <option value="">Choose a {terms.batch}</option>
            {(batches || []).map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
          </SearchSelect>
        </Field>
        <Field label="Title"><input className="input" value={f.title} onChange={(e) => set({ title: e.target.value })} maxLength={200} /></Field>
        <MarkdownEditor label="Instructions" hint="What to do and hand in." mono={false}
          value={f.instructions} onChange={(v) => set({ instructions: v })} />

        <div className="field">
          <span className="label">Files for students (a worksheet, a brief)</span>
          {f.attachments.map((a, i) => (
            <div key={a.url} className="row-tight small">
              <Paperclip size={13} /> <a href={a.url} target="_blank" rel="noreferrer">{a.name || `File ${i + 1}`}</a>
              <button className="btn btn-sm btn-quiet" onClick={() => set({ attachments: f.attachments.filter((x) => x.url !== a.url) })}><Trash2 size={13} /></button>
            </div>
          ))}
          <label className="btn btn-sm btn-quiet" style={{ cursor: "pointer", alignSelf: "flex-start" }}>
            <Upload size={13} /> {uploading ? "Uploading" : "Add a file"}
            <input type="file" style={{ display: "none" }} onChange={async (e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) { const up = await upload(file).unwrap(); set({ attachments: [...f.attachments, up] }); } }} />
          </label>
        </div>

        <div className="row" style={{ flexWrap: "wrap" }}>
          <Field label="Due"><input className="input" type="datetime-local" value={f.dueAt} onChange={(e) => set({ dueAt: e.target.value })} /></Field>
          <Field label="Show to students from" hint="Empty: as soon as it's published."><input className="input" type="datetime-local" value={f.opensAt} onChange={(e) => set({ opensAt: e.target.value })} /></Field>
          <Field label="Gradebook column"><input className="input" value={f.category} onChange={(e) => set({ category: e.target.value })} maxLength={60} /></Field>
        </div>

        <label className="row-tight" style={{ gap: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={f.allowLate} onChange={(e) => set({ allowLate: e.target.checked })} />
          <span>Accept late work</span>
        </label>
        {f.allowLate && (
          <div className="row">
            <Field label="For this many days after the due date"><input className="input" type="number" min={0} max={60} value={f.lateDays} onChange={(e) => set({ lateDays: Number(e.target.value) })} style={{ width: 100 }} /></Field>
            <Field label="Percent off per day late"><input className="input" type="number" min={0} max={100} value={f.latePenalty} onChange={(e) => set({ latePenalty: Number(e.target.value) })} style={{ width: 100 }} /></Field>
          </div>
        )}

        <div className="row" style={{ flexWrap: "wrap" }}>
          <Field label="Students hand in">
            <select className="select" value={f.submissionType} onChange={(e) => set({ submissionType: e.target.value })}>
              <option value="both">Written answer and/or files</option>
              <option value="text">A written answer</option>
              <option value="files">Files or photos</option>
            </select>
          </Field>
          {f.submissionType !== "text" && <Field label="Up to this many files"><input className="input" type="number" min={1} max={10} value={f.maxFiles} onChange={(e) => set({ maxFiles: Number(e.target.value) })} style={{ width: 90 }} /></Field>}
          {!f.rubric.length && <Field label="Marks"><input className="input" type="number" min={0} max={1000} value={f.maxMarks} onChange={(e) => set({ maxMarks: e.target.value })} style={{ width: 100 }} /></Field>}
        </div>

        <div className="field">
          <span className="label">Rubric (optional){f.rubric.length ? ` · ${rubricTotal} marks in all` : ""}</span>
          {f.rubric.map((r, i) => (
            <div key={i} className="row-tight" style={{ alignItems: "flex-start" }}>
              <input className="input" placeholder="Criterion, e.g. Method" value={r.criterion} onChange={(e) => set({ rubric: f.rubric.map((x, j) => (j === i ? { ...x, criterion: e.target.value } : x)) })} />
              <input className="input" type="number" min={0} placeholder="Marks" value={r.marks} onChange={(e) => set({ rubric: f.rubric.map((x, j) => (j === i ? { ...x, marks: e.target.value } : x)) })} style={{ width: 90 }} />
              <input className="input" placeholder="Guidance for graders (optional)" value={r.guidance || ""} onChange={(e) => set({ rubric: f.rubric.map((x, j) => (j === i ? { ...x, guidance: e.target.value } : x)) })} />
              <button className="btn btn-sm btn-quiet" onClick={() => set({ rubric: f.rubric.filter((_, j) => j !== i) })}><Trash2 size={13} /></button>
            </div>
          ))}
          <button className="btn btn-sm btn-quiet" style={{ alignSelf: "flex-start" }} onClick={() => set({ rubric: [...f.rubric, { criterion: "", marks: 2, guidance: "" }] })}><Plus size={13} /> Add a row</button>
        </div>

        <Field label="Marking notes (staff only)" hint="A model answer or what to look for. Graders and AI checking read it; students never do.">
          <textarea className="input" rows={4} value={f.markingNotes} onChange={(e) => set({ markingNotes: e.target.value })} />
        </Field>

        <ErrorNote error={error || removeError || uploadError} />
        <div className="row-tight" style={{ flexWrap: "wrap" }}>
          {!f.isPublished && <button className="btn" disabled={saving || !f.batch || !f.title.trim() || !f.dueAt} onClick={() => submit(true)}>Publish</button>}
          <button className={f.isPublished ? "btn" : "btn btn-quiet"} disabled={saving || !f.batch || !f.title.trim() || !f.dueAt} onClick={() => submit()}>{f.isPublished ? "Save" : "Save as draft"}</button>
          {f.isPublished && <button className="btn btn-quiet" disabled={saving} onClick={() => submit(false)}>Unpublish</button>}
          {!isNew && (
            <button
              className="btn btn-quiet"
              style={{ marginLeft: "auto", color: "var(--incorrect)" }}
              onClick={async () => {
                if (!(await confirm({ title: "Delete this assignment?", body: "Students' hand-ins and grades for it are deleted too.", confirmLabel: "Delete" }))) return;
                await remove({ id, force: true }).unwrap();
                navigate("/grading/assignments");
              }}
            >
              Delete
            </button>
          )}
        </div>
        {f.isPublished === false && <p className="small muted" style={{ margin: 0 }}>Students are told when it's published.</p>}
      </div>
    </div>
  );
}
