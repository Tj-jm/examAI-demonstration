import { useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { Plus, ClipboardCheck } from "lucide-react";
import { useGetAssignmentsQuery, useGetBatchesQuery } from "../../api/contentApi";
import { Loading, ErrorNote, Empty, Pager } from "../../components/bits";
import { useTerms } from "../../terms";
import { useSeen } from "../../hooks/useSeen";
import SearchSelect from "../../components/SearchSelect";

// Assignments: coursework with a due date, set per batch.
export default function Assignments() {
  const terms = useTerms();
  const { me } = useOutletContext() || {};
  useSeen("assignments");
  const [batch, setBatch] = useState("");
  const [page, setPage] = useState(1);
  const { data: batchData } = useGetBatchesQuery({});
  const { data, isLoading, error } = useGetAssignmentsQuery({ batch: batch || undefined, page });
  const batches = batchData?.batches || batchData || [];
  const items = data?.assignments || [];
  const canSet = me?.role !== "grader";

  return (
    <div className="page">
      <div className="page-head spread">
        <div>
          <h1>Assignments</h1>
          <p className="muted small" style={{ margin: "2px 0 0" }}>Work to hand in by a due date, graded by hand or with a rubric.</p>
        </div>
        {canSet && <Link className="btn" to={`/grading/assignments/new${batch ? `?batch=${batch}` : ""}`}><Plus size={15} /> New assignment</Link>}
      </div>
      <div className="stack">
        <SearchSelect className="select" style={{ maxWidth: 320 }} value={batch} onChange={(e) => { setBatch(e.target.value); setPage(1); }}>
          <option value="">All {terms.batches}</option>
          {(Array.isArray(batches) ? batches : []).map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
        </SearchSelect>
        <ErrorNote error={error} />
        {isLoading ? <Loading /> : items.length === 0 ? (
          <Empty icon={ClipboardCheck} title="No assignments yet" hint={canSet ? `Set one for a ${terms.batch}: students see it with its due date and hand in their work.` : "Assignments set for your batches show up here to grade."} />
        ) : (
          <div className="card" style={{ padding: 0, overflowX: "auto" }}>
            <table className="table">
              <thead><tr><th>Assignment</th><th>{terms.Batch}</th><th>Due</th><th>To grade</th><th>Graded</th><th></th></tr></thead>
              <tbody>
                {items.map((a) => (
                  <tr key={a._id}>
                    <td>
                      <strong>{a.title}</strong>
                      {!a.isPublished && <span className="pill" style={{ marginLeft: 6 }}>Draft</span>}
                    </td>
                    <td className="muted">{a.batch?.name}</td>
                    <td className="tnum">{new Date(a.dueAt).toLocaleString()}</td>
                    <td className="tnum">{a.counts.submitted > 0 ? <span className="tab-count" style={{ marginLeft: 0 }} title="Handed in, waiting for a grade">{a.counts.submitted}</span> : 0}</td>
                    <td className="tnum">{a.counts.graded}{a.counts.graded > a.counts.returned ? ` (${a.counts.graded - a.counts.returned} not returned)` : ""}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <Link className="btn btn-sm" to={`/grading/assignments/${a._id}/hand-ins`}>Hand-ins</Link>{" "}
                      {canSet && <Link className="btn btn-sm btn-quiet" to={`/grading/assignments/${a._id}`}>Edit</Link>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ padding: "0 16px 12px" }}><Pager page={data?.page || 1} pages={data?.pages || 1} total={data?.total || 0} onChange={setPage} /></div>
          </div>
        )}
      </div>
    </div>
  );
}
