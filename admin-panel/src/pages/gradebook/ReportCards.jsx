import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Printer } from "lucide-react";
import { useGetGradebookQuery, useSaveGradeRemarkMutation } from "../../api/contentApi";
import { Loading, ErrorNote } from "../../components/bits";
import { useTerms } from "../../terms";
import { SignatureBlock } from "../../components/SignatureFields";

const pct = (n) => (n === null || n === undefined ? "—" : `${n}%`);

// Printing: only the cards, one per page.
const PRINT_CSS = `
@media print {
  /* index.css hides everything outside .print-area (payslips); the cards
     are shown here instead, and the app's scroll boxes are opened so every
     card reaches the printer, not just the first screenful. */
  .report-card, .report-card * { visibility: visible !important; }
  html, body, #root, .shell, .main { height: auto !important; overflow: visible !important; }
  .shell { display: block !important; }
  .nav, .no-print { display: none !important; }
  .main, .page { padding: 0 !important; margin: 0 !important; max-width: none !important; }
  .report-card { break-after: page; box-shadow: none !important; border: none !important; margin: 0 !important; }
  .report-card:last-child { break-after: auto; }
  body { background: #fff !important; }
}
.report-card { background: #fff; color: #111; border: 1px solid var(--border); border-radius: 10px; padding: 32px; max-width: 800px; margin: 0 auto 24px; font-size: 14px; }
.report-card table { width: 100%; border-collapse: collapse; margin: 8px 0 16px; }
.report-card th, .report-card td { border-bottom: 1px solid #ddd; padding: 6px 8px; text-align: left; }
.report-card th { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #555; }
.report-card .num { text-align: right; font-variant-numeric: tabular-nums; }
`;

function Remark({ batchId, studentId, initial }) {
  const [text, setText] = useState(initial || "");
  const [save, { isLoading, isSuccess }] = useSaveGradeRemarkMutation();
  useEffect(() => setText(initial || ""), [initial]);
  return (
    <>
      <div className="no-print" style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <textarea className="textarea" rows={2} style={{ flex: 1 }} value={text} placeholder="Teacher's remarks" onChange={(e) => setText(e.target.value)} />
        <button className="btn btn-sm" disabled={isLoading || text === (initial || "")} onClick={() => save({ batchId, studentId, text })}>{isLoading ? "Saving" : isSuccess && text === initial ? "Saved" : "Save"}</button>
      </div>
      <div className="print-only" style={{ whiteSpace: "pre-wrap", minHeight: 40 }}>{text}</div>
    </>
  );
}

export function ReportCard({ data, row, remark, batchId, terms }) {
  const s = data.settings;
  const items = data.items.filter((i) => !i.excluded);
  const categories = [...s.categories.map((c) => c.name), ...data.unweighted];
  return (
    <section className="report-card">
      <header style={{ display: "flex", alignItems: "center", gap: 16, borderBottom: "2px solid #111", paddingBottom: 12, marginBottom: 16 }}>
        {data.brand.logo && <img src={data.brand.logo} alt="" style={{ height: 48 }} />}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{data.brand.name}</div>
          <div style={{ color: "#555" }}>Report card{s.term ? ` · ${s.term}` : ""}</div>
        </div>
      </header>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 24px", marginBottom: 16 }}>
        <div><span style={{ color: "#555" }}>Student:</span> <strong>{row.student.name}</strong></div>
        <div><span style={{ color: "#555" }}>Student ID:</span> {row.student.studentId || "—"}</div>
        <div><span style={{ color: "#555" }}>{terms.Batch}:</span> {data.batch.name}</div>
        {data.batch.program && <div><span style={{ color: "#555" }}>{terms.Program}:</span> {data.batch.program}</div>}
      </div>

      <table>
        <thead><tr><th>Category</th><th className="num">Weight</th><th className="num">Marks</th><th className="num">Score</th></tr></thead>
        <tbody>
          {categories.map((c) => {
            const cat = row.categories[c] || {};
            return <tr key={c}><td>{c}</td><td className="num">{cat.weight || 0}%</td><td className="num">{cat.max ? `${cat.marks} / ${cat.max}` : "—"}</td><td className="num">{pct(cat.pct)}</td></tr>;
          })}
        </tbody>
      </table>

      <div style={{ display: "flex", gap: 32, alignItems: "baseline", margin: "4px 0 16px", flexWrap: "wrap" }}>
        <div><span style={{ color: "#555" }}>Overall</span> <strong style={{ fontSize: 22 }}>{pct(row.overall)}</strong></div>
        <div><span style={{ color: "#555" }}>Grade</span> <strong style={{ fontSize: 22 }}>{row.letter || "—"}</strong>{row.points !== null && row.points !== undefined ? <span style={{ color: "#555" }}> · {row.points} points</span> : null}</div>
        {s.showRank && row.rank && <div><span style={{ color: "#555" }}>Position</span> <strong style={{ fontSize: 22 }}>{row.rank}</strong><span style={{ color: "#555" }}> of {data.ranked}</span></div>}
      </div>

      {items.length > 0 && (
        <table>
          <thead><tr><th>Work</th><th>Category</th><th className="num">Marks</th></tr></thead>
          <tbody>
            {items.map((i) => {
              const cell = row.cells[i.id];
              return <tr key={i.id}><td>{i.title}</td><td>{i.category}</td><td className="num">{cell?.status === "graded" ? `${cell.marks} / ${cell.max}` : cell?.status === "pending" ? "Being marked" : "Not handed in"}</td></tr>;
            })}
          </tbody>
        </table>
      )}

      <div style={{ marginTop: 8 }}>
        <div style={{ color: "#555", marginBottom: 4 }}>Remarks</div>
        {batchId ? <Remark batchId={batchId} studentId={row.student._id} initial={remark} /> : <div style={{ whiteSpace: "pre-wrap", minHeight: 40 }}>{remark}</div>}
      </div>
      <footer style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 24, flexWrap: "wrap", marginTop: 32, color: "#111" }}>
        <span style={{ color: "#555" }}>{new Date().toLocaleDateString()}</span>
        <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
          {(s.signatures?.length ? s.signatures : [{ name: "", role: "Signature", image: null }]).map((sig, i) => <SignatureBlock key={i} s={sig} width={180} />)}
        </div>
      </footer>
    </section>
  );
}

// Report cards for a batch, or one student (?student=). Print saves them as
// PDF from the browser's print dialog.
export default function ReportCards() {
  const terms = useTerms();
  const { batchId } = useParams();
  const [params] = useSearchParams();
  const only = params.get("student");
  const { data, isLoading, error } = useGetGradebookQuery(batchId);
  const rows = (data?.rows || []).filter((r) => !only || String(r.student._id) === only);

  return (
    <div className="page">
      <style>{PRINT_CSS}{"@media screen { .print-only { display: none; } } @media print { .print-only { display: block; } }"}</style>
      <div className="page-head spread no-print">
        <div>
          <Link to={`/grading/gradebook?batch=${batchId}`} className="row-tight muted small"><ArrowLeft size={14} /> Gradebook</Link>
          <h1>Report cards{data ? ` · ${data.batch.name}` : ""}</h1>
          <p className="muted small" style={{ margin: "2px 0 0" }}>Write remarks, then print — choose "Save as PDF" in the print dialog for files.</p>
        </div>
        <button className="btn" onClick={() => window.print()} disabled={!rows.length}><Printer size={15} /> Print {rows.length > 1 ? `all ${rows.length}` : ""}</button>
      </div>
      <ErrorNote error={error} />
      {isLoading ? <Loading /> : rows.map((row) => (
        <ReportCard key={row.student._id} data={data} row={row} remark={data.remarks[String(row.student._id)]} batchId={batchId} terms={terms} />
      ))}
    </div>
  );
}
