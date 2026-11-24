import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Paperclip, Sparkles } from "lucide-react";
import { useGetAssignmentHandInQuery, useGradeAssignmentHandInMutation } from "../../api/contentApi";
import { Loading, ErrorNote, Field } from "../../components/bits";
import AssignmentAiCheck from "../../components/AssignmentAiCheck";
import Latex from "../../components/Latex";

// Grade one hand-in: rubric rows or one mark, feedback, and whether the
// student sees it yet. An AI suggestion (AI checking or the assignment
// agent) can be pulled in and changed before saving.
const IMG = /\.(png|jpe?g|webp|gif)(\?|$)/i;

export default function AssignmentGrade() {
  const { subId } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, error } = useGetAssignmentHandInQuery(subId);
  const [grade, { isLoading: saving, error: saveError }] = useGradeAssignmentHandInMutation();
  const [scores, setScores] = useState([]);
  const [marks, setMarks] = useState("");
  const [feedback, setFeedback] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!data || ready) return;
    const { submission: s, assignment: a } = data;
    setScores(a.rubric.map((_, i) => ({ marks: s.rubricScores?.[i]?.marks ?? "", comment: s.rubricScores?.[i]?.comment || "" })));
    setMarks(s.marks ?? "");
    setFeedback(s.feedback || "");
    setReady(true);
  }, [data, ready]);

  if (isLoading || !ready) return <div className="page">{error ? <ErrorNote error={error} /> : <Loading />}</div>;
  const { submission: s, assignment: a } = data;
  const useRubric = a.rubric.length > 0;
  const total = useRubric ? scores.reduce((t, r) => t + (Number(r.marks) || 0), 0) : Number(marks) || 0;
  const final = Math.round(total * (1 - (s.latePenalty || 0) / 100) * 100) / 100;

  const takeAi = (ai) => {
    if (!ai) return;
    if (useRubric && ai.rubricScores?.length === a.rubric.length) setScores(ai.rubricScores.map((r) => ({ marks: r.marks, comment: r.comment || "" })));
    else setMarks(ai.marks);
    setFeedback(ai.feedback || "");
  };

  const save = async (returned) => {
    await grade({
      subId,
      ...(useRubric ? { rubricScores: scores.map((r) => ({ marks: Number(r.marks) || 0, comment: r.comment })) } : { marks: Number(marks) }),
      feedback,
      returned,
    }).unwrap();
    navigate(`/grading/assignments/${a._id}/hand-ins`);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <Link to={`/grading/assignments/${a._id}/hand-ins`} className="small muted row-tight"><ArrowLeft size={13} /> {a.title}</Link>
          <h1 style={{ marginTop: 6 }}>{s.student?.name || "Hand-in"}</h1>
          <p className="muted small" style={{ margin: "2px 0 0" }}>
            Handed in {new Date(s.submittedAt).toLocaleString()}{s.latePenalty ? ` · late: ${s.latePenalty}% off` : ""}
          </p>
        </div>
      </div>

      <div className="stack" style={{ gap: 16 }}>
        <div className="card stack">
          <h2>Their work</h2>
          {s.text ? <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.55 }}>{s.text}</div> : <p className="muted small" style={{ margin: 0 }}>No written answer.</p>}
          {s.files.map((f, i) => (
            IMG.test(f.url) || /^image\//.test(f.type)
              ? <a key={f.url} href={f.url} target="_blank" rel="noreferrer"><img src={f.url} alt={f.name || `Photo ${i + 1}`} style={{ maxWidth: "100%", borderRadius: 8, border: "1px solid var(--border)" }} /></a>
              : <a key={f.url} className="row-tight small" href={f.url} target="_blank" rel="noreferrer"><Paperclip size={13} /> {f.name || `File ${i + 1}`}</a>
          ))}
        </div>

        <div className="card stack">
          <div className="spread"><h2>Grade</h2><span className="tnum"><strong>{final}</strong> / {a.maxMarks}{s.latePenalty ? <span className="muted small"> ({total} before late penalty)</span> : null}</span></div>

          {s.ai?.at && (
            <div className="stack" style={{ gap: 4, padding: 12, borderRadius: 8, background: "var(--surface-2, rgba(127,127,127,0.08))" }}>
              <div className="row-tight"><Sparkles size={14} /> <strong>AI suggestion{s.ai.by === "agent" ? " (assignment agent)" : ""}: {s.ai.marks} / {a.maxMarks}</strong></div>
              {s.ai.reasoning && <div className="small muted" style={{ whiteSpace: "pre-wrap" }}>{s.ai.reasoning}</div>}
              <button className="btn btn-sm btn-quiet" style={{ alignSelf: "flex-start" }} onClick={() => takeAi(s.ai)}>Use this suggestion</button>
            </div>
          )}
          <AssignmentAiCheck subId={subId} onSuggestion={takeAi} />

          {useRubric ? a.rubric.map((row, i) => (
            <div key={i} className="row-tight" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
              <div style={{ minWidth: 200, flex: 1 }}>
                <div><Latex>{row.criterion}</Latex> <span className="muted small">/ {row.marks}</span></div>
                {row.guidance && <div className="muted small">{row.guidance}</div>}
              </div>
              <input className="input" type="number" min={0} max={row.marks} step="0.5" value={scores[i]?.marks} onChange={(e) => setScores(scores.map((x, j) => (j === i ? { ...x, marks: e.target.value } : x)))} style={{ width: 90 }} />
              <input className="input" placeholder="Comment (optional)" value={scores[i]?.comment} onChange={(e) => setScores(scores.map((x, j) => (j === i ? { ...x, comment: e.target.value } : x)))} style={{ flex: 2, minWidth: 180 }} />
            </div>
          )) : (
            <Field label={`Marks (out of ${a.maxMarks})`}>
              <input className="input" type="number" min={0} max={a.maxMarks} step="0.5" value={marks} onChange={(e) => setMarks(e.target.value)} style={{ width: 120 }} />
            </Field>
          )}
          <Field label="Feedback to the student">
            <textarea className="input" rows={5} value={feedback} onChange={(e) => setFeedback(e.target.value)} />
          </Field>
          {a.markingNotes && <details><summary className="small muted">Marking notes</summary><div className="small" style={{ whiteSpace: "pre-wrap" }}>{a.markingNotes}</div></details>}
          <ErrorNote error={saveError} />
          <div className="row-tight" style={{ flexWrap: "wrap" }}>
            <button className="btn" disabled={saving} onClick={() => save(true)}>Save and return to student</button>
            <button className="btn btn-quiet" disabled={saving} onClick={() => save(false)}>Save, return later</button>
          </div>
        </div>
      </div>
    </div>
  );
}
