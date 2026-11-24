import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { BookOpenCheck, Download, Printer, Settings2 } from "lucide-react";
import { useGetBatchesQuery, useGetGradebookQuery } from "../../api/contentApi";
import { Loading, ErrorNote, Empty } from "../../components/bits";
import { downloadCsv } from "../../utils/csv";
import { useTerms } from "../../terms";
import GradebookSettings from "./GradebookSettings";
import SearchSelect from "../../components/SearchSelect";

const pct = (n) => (n === null || n === undefined ? "—" : `${n}%`);

const cellText = (cell) => {
  if (!cell) return "—";
  if (cell.status === "pending") return "…";
  return `${cell.marks}/${cell.max}`;
};

// The gradebook: one row per student on the batch's register, one column per
// published exam and assignment, then each category and the overall grade.
export default function Gradebook() {
  const terms = useTerms();
  const [params, setParams] = useSearchParams();
  const batchId = params.get("batch") || "";
  const [showSettings, setShowSettings] = useState(false);
  const { data: batchData } = useGetBatchesQuery({});
  const batches = batchData?.batches || batchData || [];
  const { data, isLoading, error } = useGetGradebookQuery(batchId, { skip: !batchId });

  const categories = data ? [...data.settings.categories.map((c) => c.name), ...data.unweighted] : [];
  const items = (data?.items || []).filter((i) => !i.excluded);

  const exportCsv = () => {
    const head = ["Student", "Student ID", ...items.map((i) => `${i.title} (/${i.max})`), ...categories.map((c) => `${c} %`), "Overall %", "Grade", "Rank"];
    const body = data.rows.map((r) => [
      r.student.name, r.student.studentId || "",
      ...items.map((i) => (r.cells[i.id]?.status === "graded" ? r.cells[i.id].marks : "")),
      ...categories.map((c) => r.categories[c]?.pct ?? ""),
      r.overall ?? "", r.letter || "", r.rank || "",
    ]);
    downloadCsv(`gradebook-${data.batch.name.replace(/\W+/g, "-").toLowerCase()}.csv`, [head, ...body]);
  };

  return (
    <div className="page">
      <div className="page-head spread">
        <div>
          <h1>Gradebook</h1>
          <p className="muted small" style={{ margin: "2px 0 0" }}>Exams and assignments added up into one grade per student, with report cards.</p>
        </div>
        {data && (
          <div className="row-tight">
            <button className="btn btn-quiet" onClick={() => setShowSettings((v) => !v)}><Settings2 size={15} /> Settings</button>
            <button className="btn btn-quiet" onClick={exportCsv}><Download size={15} /> CSV</button>
            <Link className="btn btn-quiet" to={`/grading/offline-marks?batch=${batchId}`}>Offline marks</Link>
            <Link className="btn" to={`/grading/gradebook/${batchId}/report-cards`}><Printer size={15} /> Report cards</Link>
          </div>
        )}
      </div>

      <div className="stack">
        <SearchSelect className="select" style={{ maxWidth: 320 }} value={batchId} onChange={(e) => setParams(e.target.value ? { batch: e.target.value } : {})}>
          <option value="">Choose a {terms.batch}</option>
          {(Array.isArray(batches) ? batches : []).map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
        </SearchSelect>
        <ErrorNote error={error} />

        {!batchId ? (
          <Empty icon={BookOpenCheck} title={`Choose a ${terms.batch}`} hint="Its published exams and assignments make up the gradebook." />
        ) : isLoading ? <Loading /> : data && (
          <>
            {showSettings && <GradebookSettings batchId={batchId} data={data} onClose={() => setShowSettings(false)} />}

            <div className="row-tight small muted" style={{ flexWrap: "wrap", gap: 12 }}>
              <span>{data.rows.length} students · {items.length} items</span>
              <span>Class average: <strong className="tnum">{pct(data.average)}</strong></span>
              <span>Weights: {data.settings.categories.map((c) => `${c.name} ${c.weight}%`).join(" · ")}</span>
              <span className={`pill ${data.settings.published ? "pill-ok" : ""}`}>{data.settings.published ? "Students can see their grades" : "Not shown to students"}</span>
            </div>
            {data.unweighted.length > 0 && (
              <div className="card-quiet small">
                {data.unweighted.join(", ")} {data.unweighted.length === 1 ? "has" : "have"} no weight, so {data.unweighted.length === 1 ? "it doesn't" : "they don't"} count towards the overall grade. Add {data.unweighted.length === 1 ? "it" : "them"} under Settings → Categories.
              </div>
            )}

            {data.rows.length === 0 ? (
              <Empty icon={BookOpenCheck} title="Nobody on the register yet" hint={`Students with access to this ${terms.batch} show up here.`} />
            ) : (
              <div className="card" style={{ padding: 0, overflowX: "auto" }}>
                <table className="table" style={{ whiteSpace: "nowrap" }}>
                  <thead>
                    <tr>
                      <th style={{ position: "sticky", left: 0, background: "var(--surface, var(--bg))" }}>Student</th>
                      {items.map((i) => (
                        <th key={i.id} title={`${i.kind === "exam" ? "Exam" : "Assignment"} · ${i.category}${i.average !== null ? ` · class average ${i.average}%` : ""}`}>
                          <div style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis" }}>{i.title}</div>
                          <div className="muted small" style={{ fontWeight: 400 }}>{i.category} · /{i.max}</div>
                        </th>
                      ))}
                      {categories.map((c) => <th key={c}>{c}</th>)}
                      <th>Overall</th>
                      <th>Grade</th>
                      <th>Rank</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <tr key={r.student._id}>
                        <td style={{ position: "sticky", left: 0, background: "var(--surface, var(--bg))" }}>
                          <strong>{r.student.name}</strong>
                          {r.student.studentId && <span className="muted small"> · {r.student.studentId}</span>}
                        </td>
                        {items.map((i) => (
                          <td key={i.id} className="tnum" title={r.cells[i.id]?.status === "pending" ? "Handed in, not marked yet" : r.cells[i.id]?.note || ""}>
                            {cellText(r.cells[i.id])}
                          </td>
                        ))}
                        {categories.map((c) => <td key={c} className="tnum">{pct(r.categories[c]?.pct)}</td>)}
                        <td className="tnum"><strong>{pct(r.overall)}</strong></td>
                        <td><strong>{r.letter || "—"}</strong>{r.points !== null && r.points !== undefined ? <span className="muted small"> ({r.points})</span> : null}</td>
                        <td className="tnum">{r.rank || "—"}</td>
                        <td><Link className="btn btn-sm btn-quiet" to={`/grading/gradebook/${batchId}/report-cards?student=${r.student._id}`}>Report card</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted small">— nothing handed in · … handed in, not marked yet. Several attempts at an exam: the best one counts. Assignment grades count here once marked; students see them once returned.</p>
          </>
        )}
      </div>
    </div>
  );
}
