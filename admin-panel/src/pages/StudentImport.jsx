import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Upload, Download, CheckCircle2, AlertTriangle } from "lucide-react";
import { useImportStudentsMutation } from "../api/contentApi";
import { ErrorNote } from "../components/bits";
import { parseCsv, downloadCsv } from "../utils/csv";
import { useTerms } from "../terms";

// Students → Import: a spreadsheet (saved as CSV) of students in, accounts
// and access out. Checked first, nothing changes until Import.
const COLUMNS = [
  ["studentId", /^(student\s*id|id|roll(\s*(no|number))?|reg(istration)?(\s*(no|number))?)$/i],
  ["name", /^(name|full\s*name|student(\s*name)?)$/i],
  ["email", /^e-?mail(\s*address)?$/i],
  ["phoneNumber", /^(phone|mobile|phone\s*number|mobile\s*number)$/i],
  ["password", /^password$/i],
  ["batch", /^(batch|batches|class|classes|section|course|courses|cohort|group)$/i],
  ["guardianName", /^(guardian|parent|father|mother)(\s*name)?$/i],
  ["guardianRelation", /^(guardian|parent)?\s*relation(ship)?$/i],
  ["guardianPhone", /^(guardian|parent|father|mother)('?s)?\s*(phone|mobile|number)(\s*number)?$/i],
  ["guardianEmail", /^(guardian|parent|father|mother)('?s)?\s*e-?mail(\s*address)?$/i],
];

export default function StudentImport() {
  const terms = useTerms();
  const [fileName, setFileName] = useState("");
  const [table, setTable] = useState(null); // { header, rows }
  const [mapping, setMapping] = useState({});
  const [check, setCheck] = useState(null);
  const [done, setDone] = useState(null);
  const [run, { isLoading, error }] = useImportStudentsMutation();

  const LABELS = { studentId: "Student ID", name: "Name", email: "Email", phoneNumber: "Phone", password: "Password", batch: terms.Batches, guardianName: "Guardian name", guardianRelation: "Guardian relation", guardianPhone: "Guardian phone", guardianEmail: "Guardian email" };

  const onFile = async (file) => {
    if (!file) return;
    const parsed = parseCsv(await file.text());
    const [header = [], ...rows] = parsed;
    const map = {};
    header.forEach((h, i) => {
      const hit = COLUMNS.find(([, re]) => re.test(String(h).trim()));
      if (hit && map[hit[0]] === undefined) map[hit[0]] = i;
    });
    setFileName(file.name);
    setTable({ header, rows });
    setMapping(map);
    setCheck(null);
    setDone(null);
  };

  const records = useMemo(() => (table ? table.rows.map((r) => Object.fromEntries(
    Object.entries(mapping).filter(([, i]) => i !== "" && i !== undefined).map(([k, i]) => [k, r[i] ?? ""])
  )) : []), [table, mapping]);

  const go = async (dryRun) => {
    const result = await run({ rows: records, dryRun }).unwrap();
    if (dryRun) setCheck(result); else { setDone(result); setCheck(null); }
  };

  const template = () => downloadCsv("students-template.csv", [
    ["Student ID", "Name", "Email", "Phone", "Password", terms.Batch, "Guardian name", "Guardian relation", "Guardian phone", "Guardian email"],
    ["S-001", "Rafi Ahmed", "", "", "", `Example ${terms.batch}`, "Karim Ahmed", "Father", "01711000000", ""],
    ["S-002", "Nadia Islam", "nadia@example.com", "+8801712345678", "", `Example ${terms.batch}; Another ${terms.batch}`, "", "", "", "parent@example.com"],
  ]);

  const summary = (r) => (
    <div className="row-tight" style={{ flexWrap: "wrap", gap: 8 }}>
      <span className="pill">{r.created} new</span>
      <span className="pill">{r.updated} updated</span>
      <span className="pill">{r.enrolled} {terms.batch} grants</span>
      {r.unchanged > 0 && <span className="pill">{r.unchanged} unchanged</span>}
      {r.errors.length > 0 && <span className="pill" style={{ color: "var(--incorrect)" }}>{r.errors.length} with problems</span>}
    </div>
  );
  const problems = (r) => r.errors.length > 0 && (
    <div className="stack" style={{ gap: 4 }}>
      {r.errors.slice(0, 50).map((e) => (
        <div key={e.line} className="small row-tight"><AlertTriangle size={13} style={{ color: "var(--incorrect)" }} /> Row {e.line}: {e.message}</div>
      ))}
      {r.errors.length > 50 && <div className="small muted">…and {r.errors.length - 50} more.</div>}
    </div>
  );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <Link to="/students" className="small muted row-tight"><ArrowLeft size={13} /> Students</Link>
          <h1 style={{ marginTop: 6 }}>Import students</h1>
        </div>
      </div>

      <div className="stack" style={{ gap: 16 }}>
        <div className="card stack">
          <p className="hint" style={{ margin: 0 }}>
            A spreadsheet saved as CSV, one student per row. Columns: Student ID,
            Name, Email, Phone, Password, {terms.Batch}. Each student needs at
            least a student ID, email or phone. Several {terms.batches} go in one
            cell separated by ";". Students already here (same ID, email or phone)
            are updated and given any new {terms.batches}, not duplicated. New
            students without a password get one made for them; download the list
            afterwards to hand them out.
          </p>
          <div className="row-tight" style={{ flexWrap: "wrap" }}>
            <label className="btn" style={{ cursor: "pointer" }}>
              <Upload size={15} /> {fileName ? "Choose another file" : "Choose CSV file"}
              <input type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
            <button className="btn btn-quiet" onClick={template}><Download size={15} /> Template</button>
            {fileName && <span className="small muted">{fileName} · {table?.rows.length || 0} rows</span>}
          </div>
        </div>

        {table && (
          <div className="card stack">
            <h2>Columns</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
              {Object.entries(LABELS).map(([key, label]) => (
                <label key={key} className="field">
                  <span className="label">{label}</span>
                  <select
                    className="select"
                    value={mapping[key] ?? ""}
                    onChange={(e) => { setMapping({ ...mapping, [key]: e.target.value === "" ? undefined : Number(e.target.value) }); setCheck(null); }}
                  >
                    <option value="">Not in the file</option>
                    {table.header.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                  </select>
                </label>
              ))}
            </div>

            <div style={{ overflowX: "auto" }}>
              <table className="table small">
                <thead><tr>{Object.keys(LABELS).filter((k) => mapping[k] !== undefined).map((k) => <th key={k}>{LABELS[k]}</th>)}</tr></thead>
                <tbody>
                  {records.slice(0, 8).map((r, i) => (
                    <tr key={i}>{Object.keys(LABELS).filter((k) => mapping[k] !== undefined).map((k) => <td key={k}>{k === "password" && r[k] ? "••••••" : r[k]}</td>)}</tr>
                  ))}
                </tbody>
              </table>
              {records.length > 8 && <p className="small muted" style={{ margin: "6px 0 0" }}>…and {records.length - 8} more rows.</p>}
            </div>

            <ErrorNote error={error} />
            {check && (
              <div className="stack" style={{ gap: 8 }}>
                <div className="row-tight"><CheckCircle2 size={15} /> <strong>Checked. Nothing has changed yet.</strong></div>
                {summary(check)}
                {problems(check)}
                {check.errors.length > 0 && <p className="small muted" style={{ margin: 0 }}>Rows with problems are skipped. Fix them in the file and import again any time.</p>}
              </div>
            )}
            <div className="row-tight">
              <button className="btn btn-quiet" disabled={isLoading || !records.length} onClick={() => go(true)}>{isLoading && !check ? "Checking" : "Check"}</button>
              <button className="btn" disabled={isLoading || !check} onClick={() => go(false)} title={check ? "" : "Check first"}>
                {isLoading && check ? "Importing" : "Import"}
              </button>
            </div>
          </div>
        )}

        {done && (
          <div className="card stack">
            <div className="row-tight"><CheckCircle2 size={17} style={{ color: "var(--correct)" }} /><h2>Imported</h2></div>
            {summary(done)}
            {problems(done)}
            {done.credentials.length > 0 && (
              <div className="stack" style={{ gap: 6 }}>
                <p className="small" style={{ margin: 0 }}>
                  {done.credentials.length} students have a new password. Download the list now: it isn't shown again.
                </p>
                <div>
                  <button
                    className="btn"
                    onClick={() => downloadCsv("student-logins.csv", [
                      ["Name", "Student ID", "Email", "Phone", "Password"],
                      ...done.credentials.map((c) => [c.name, c.studentId, c.email, c.phoneNumber, c.password]),
                    ])}
                  >
                    <Download size={15} /> Download logins
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
