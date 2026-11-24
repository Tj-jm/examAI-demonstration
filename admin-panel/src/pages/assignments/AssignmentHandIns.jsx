import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Send } from "lucide-react";
import { useGetAssignmentHandInsQuery, useReturnAllAssignmentMutation } from "../../api/contentApi";
import { Loading, ErrorNote, Pager, pageSlice } from "../../components/bits";

// Everyone in the batch and where their work stands.
const STATUS = {
  draft: ["Draft, not handed in", "muted"],
  submitted: ["To grade", ""],
  graded: ["Graded", ""],
};

export default function AssignmentHandIns() {
  const { id } = useParams();
  const { data, isLoading, error } = useGetAssignmentHandInsQuery(id);
  const [returnAll, { isLoading: returning, error: returnError, data: returned }] = useReturnAllAssignmentMutation();
  const [page, setPage] = useState(1);
  if (isLoading) return <div className="page"><Loading /></div>;
  if (!data) return <div className="page"><ErrorNote error={error} /></div>;
  const { assignment: a, rows } = data;
  const shown = pageSlice(rows, page, 30);
  const counts = rows.reduce((c, r) => { const k = r.submission?.status === "draft" || !r.submission ? "missing" : r.submission.status; c[k] = (c[k] || 0) + 1; return c; }, {});
  const unreturned = rows.filter((r) => r.submission?.status === "graded" && !r.submission.returned).length;

  return (
    <div className="page">
      <div className="page-head spread">
        <div>
          <Link to="/grading/assignments" className="small muted row-tight"><ArrowLeft size={13} /> Assignments</Link>
          <h1 style={{ marginTop: 6 }}>{a.title}</h1>
          <p className="muted small" style={{ margin: "2px 0 0" }}>
            Due {new Date(a.dueAt).toLocaleString()} · {a.maxMarks} marks · {counts.submitted || 0} to grade · {counts.graded || 0} graded · {counts.missing || 0} not handed in
          </p>
        </div>
        {unreturned > 0 && (
          <button className="btn" disabled={returning} onClick={() => returnAll(id)}><Send size={15} /> Return {unreturned} grade{unreturned === 1 ? "" : "s"} to students</button>
        )}
      </div>
      <ErrorNote error={returnError} />
      {returned && <p className="small muted">Returned {returned.returned}.</p>}
      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table className="table">
          <thead><tr><th>Student</th><th>Status</th><th>Handed in</th><th>Mark</th><th></th></tr></thead>
          <tbody>
            {shown.items.map((r) => {
              const s = r.submission;
              const [label, cls] = s ? STATUS[s.status] : ["Not handed in", "muted"];
              return (
                <tr key={r.student._id}>
                  <td>{r.student.name}{r.student.studentId ? <span className="muted small"> · {r.student.studentId}</span> : null}</td>
                  <td className={cls}>{label}{s?.hasAi && s.status === "submitted" ? <span className="pill" style={{ marginLeft: 6 }}>AI suggestion</span> : null}</td>
                  <td className="tnum">{s?.submittedAt ? `${new Date(s.submittedAt).toLocaleString()}${s.latePenalty ? ` · late, −${s.latePenalty}%` : ""}` : "—"}</td>
                  <td className="tnum">{s?.status === "graded" ? `${s.finalMarks} / ${a.maxMarks}${s.returned ? "" : " (not returned)"}` : "—"}</td>
                  <td>{s && s.status !== "draft" && <Link className="btn btn-sm" to={`/grading/assignments/hand-ins/${s._id}`}>{s.status === "graded" ? "Review" : "Grade"}</Link>}</td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={5} className="muted">No students in this batch yet.</td></tr>}
          </tbody>
        </table>
        <div style={{ padding: "0 16px 12px" }}><Pager page={shown.page} pages={shown.pages} total={shown.total} onChange={setPage} /></div>
      </div>
    </div>
  );
}
