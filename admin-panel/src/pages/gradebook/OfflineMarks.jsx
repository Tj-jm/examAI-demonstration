import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ClipboardList, Plus, Trash2, Save, Wand2 } from "lucide-react";
import { useGetBatchesQuery } from "../../api/contentApi";
import { useTerms } from "../../terms";
import { useConfirm } from "../../components/bits";
import SearchSelect from "../../components/SearchSelect";

// Offline exams: marks of an exam sat on paper, entered on a sheet of the
// batch's own students (names come from the register, so they can't
// mismatch). Confirm creates each student's result at once
// (backend controllers/admin/offlineExamController.js).

const API = "/api/grading/offline-exams";
const call = async (url, opts = {}) => {
  const res = await fetch(url, { credentials: "include", headers: { "Content-Type": "application/json" }, ...opts });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || `Failed (${res.status}).`);
  return body;
};
const today = () => new Date().toISOString().slice(0, 10);
const blankHead = () => ({ title: "", date: today(), fullMarks: "", passMarks: "", parts: [] });
const n = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
const draftKey = (batchId, examId) => `examai.offlineDraft.${batchId}.${examId || "new"}`;

export default function OfflineMarks() {
  const terms = useTerms();
  const [params, setParams] = useSearchParams();
  const batchId = params.get("batch") || "";
  const examId = params.get("exam") || "";
  const { data: batchData } = useGetBatchesQuery({});
  const batches = batchData?.batches || batchData || [];

  const [list, setList] = useState(null);
  const [head, setHead] = useState(blankHead());
  const [rows, setRows] = useState({}); // studentId -> { marks, parts: [], absent, remark }
  const [editing, setEditing] = useState(false);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [tellStudents, setTellStudents] = useState(true);
  const [log, setLog] = useState([]);
  const grid = useRef(null);
  const confirmAsk = useConfirm();

  const load = () => {
    if (!batchId) return;
    setError("");
    call(`${API}/${batchId}`).then(setList).catch((e) => setError(e.message));
  };
  useEffect(() => { setList(null); setEditing(false); load(); }, [batchId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Open a sheet: a saved exam (its rows), or a new one; a draft kept in
  // this browser wins over either.
  useEffect(() => {
    if (!batchId || !params.has("sheet")) { setEditing(false); return; }
    setNote("");
    const fromDraft = () => {
      try { return JSON.parse(localStorage.getItem(draftKey(batchId, examId)) || "null"); } catch { return null; }
    };
    const apply = (h, r) => {
      const d = fromDraft();
      setHead(d?.head || h);
      setRows(d?.rows || r);
      if (d) setNote("Restored your unsaved changes from this browser.");
      setEditing(true);
    };
    if (!examId) { setLog([]); apply(blankHead(), {}); return; }
    call(`${API}/${batchId}/${examId}`).then(({ exam, rows: saved }) => {
      setLog(exam.log || []);
      apply(
        { title: exam.title, date: String(exam.date).slice(0, 10), fullMarks: String(exam.fullMarks), passMarks: exam.passMarks ?? "", parts: exam.parts.map((p) => ({ label: p.label, max: p.max ?? "" })) },
        Object.fromEntries(saved.map((r) => [String(r.student), { marks: r.marks ?? "", parts: (r.parts || []).map((x) => x ?? ""), absent: r.absent, remark: r.remark || "" }])),
      );
    }).catch((e) => setError(e.message));
  }, [batchId, examId, params.has("sheet")]); // eslint-disable-line react-hooks/exhaustive-deps

  // Draft kept as you type.
  useEffect(() => {
    if (!editing) return;
    try { localStorage.setItem(draftKey(batchId, examId), JSON.stringify({ head, rows })); } catch { /* storage off */ }
  }, [head, rows, editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const students = list?.students || [];
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? students.filter((s) => `${s.name} ${s.studentId} ${s.phone} ${s.email}`.toLowerCase().includes(q)) : students;
  }, [students, filter]);

  const full = n(head.fullMarks);
  const rowOf = (id) => rows[id] || { marks: "", parts: [], absent: false, remark: "" };
  const setRow = (id, patch) => setRows((r) => ({ ...r, [id]: { ...rowOf(id), ...patch } }));
  const badTotal = (r) => !r.absent && r.marks !== "" && (n(r.marks) < 0 || (full !== null && n(r.marks) > full) || Number.isNaN(n(r.marks)));
  const badPart = (r, j) => {
    const v = r.parts?.[j];
    if (r.absent || v === "" || v === undefined) return false;
    const max = n(head.parts[j]?.max);
    return Number.isNaN(n(v)) || n(v) < 0 || (max !== null && n(v) > max);
  };
  const counts = students.reduce((c, s) => {
    const r = rowOf(String(s._id));
    if (r.absent) c.absent += 1;
    else if (r.marks === "") c.blank += 1;
    else c.entered += 1;
    if (badTotal(r) || head.parts.some((_, j) => badPart(r, j))) c.bad += 1;
    return c;
  }, { entered: 0, absent: 0, blank: 0, bad: 0 });

  // Enter / arrow keys move down and up a column; a pasted column fills down.
  const cols = ["total", ...head.parts.map((_, j) => `p${j}`), "remark"];
  const focusCell = (r, c) => grid.current?.querySelector(`[data-r="${r}"][data-c="${c}"]`)?.focus();
  const onKey = (e, r, c) => {
    if (e.key === "Enter" || e.key === "ArrowDown") { e.preventDefault(); focusCell(r + 1, c); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focusCell(r - 1, c); }
  };
  const onPaste = (e, r, c) => {
    const text = e.clipboardData.getData("text");
    if (!text.includes("\n")) return;
    e.preventDefault();
    const lines = text.replace(/\r/g, "").split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
    setRows((all) => {
      const next = { ...all };
      lines.forEach((line, k) => {
        const s = shown[r + k];
        if (!s) return;
        const id = String(s._id);
        const cur = { marks: "", parts: [], absent: false, remark: "", ...next[id] };
        const v = line.split("\t")[0].trim();
        if (c === "total") cur.marks = v;
        else if (c === "remark") cur.remark = v;
        else { const parts = [...(cur.parts || [])]; parts[Number(c.slice(1))] = v; cur.parts = parts; }
        next[id] = cur;
      });
      return next;
    });
  };
  const fillTotals = () => setRows((all) => {
    const next = { ...all };
    for (const s of students) {
      const id = String(s._id);
      const r = { marks: "", parts: [], absent: false, remark: "", ...next[id] };
      const given = (r.parts || []).filter((x) => x !== "" && x !== undefined);
      if (!r.absent && given.length) next[id] = { ...r, marks: String(given.reduce((a, b) => a + Number(b || 0), 0)) };
    }
    return next;
  });

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const body = {
        ...head,
        parts: head.parts.map((p) => ({ label: p.label, max: n(p.max) })),
        rows: students.map((s) => ({ student: s._id, ...rowOf(String(s._id)) })).filter((r) => r.absent || r.marks !== ""),
        notify: tellStudents,
      };
      const out = examId
        ? await call(`${API}/${batchId}/${examId}`, { method: "PUT", body: JSON.stringify(body) })
        : await call(`${API}/${batchId}`, { method: "POST", body: JSON.stringify(body) });
      try { localStorage.removeItem(draftKey(batchId, examId)); } catch { /* storage off */ }
      setConfirm(false);
      setNote(examId ? `Saved: ${out.changed} row${out.changed === 1 ? "" : "s"} changed.` : `Created "${out.exam.title}": ${out.saved} results published.`);
      load();
      setParams({ batch: batchId, exam: out.exam._id, sheet: "1" });
    } catch (e) {
      setError(e.message);
      setConfirm(false);
    }
    setBusy(false);
  };
  const discard = () => {
    try { localStorage.removeItem(draftKey(batchId, examId)); } catch { /* storage off */ }
    setParams({ batch: batchId });
  };
  const remove = async () => {
    const ok = await confirmAsk({ title: "Delete this offline exam?", body: "Every student's result for it is deleted too. This can't be undone.", confirmLabel: "Delete" });
    if (!ok) return;
    try { await call(`${API}/${batchId}/${examId}`, { method: "DELETE" }); discard(); load(); } catch (e) { setError(e.message); }
  };

  const headOk = head.title.trim() && head.date && full > 0;
  const cell = { padding: "3px 6px", borderBottom: "1px solid var(--border, #e5e7eb)", whiteSpace: "nowrap" };
  const inp = (bad) => ({ width: 70, padding: "4px 6px", border: `1px solid ${bad ? "#dc2626" : "var(--border, #d1d5db)"}`, background: bad ? "rgba(220,38,38,0.08)" : undefined, borderRadius: 6 });

  return (
    <div className="page">
      <div className="page-head spread">
        <div>
          <h1>Offline exam marks</h1>
          <p className="muted small" style={{ margin: "2px 0 0" }}>Marks of an exam sat on paper, entered against the {terms.batch}'s students. Each result is published at once and counts in the gradebook.</p>
        </div>
      </div>
      <div className="stack">
        <SearchSelect className="select" style={{ maxWidth: 320 }} value={batchId} onChange={(e) => setParams(e.target.value ? { batch: e.target.value } : {})}>
          <option value="">Choose a {terms.batch}</option>
          {(Array.isArray(batches) ? batches : []).map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
        </SearchSelect>
        {error && <div className="alert alert-error">{error}</div>}
        {note && <div className="alert">{note}</div>}

        {batchId && list && !editing && (
          <div className="card stack">
            <div className="spread">
              <h3 style={{ margin: 0 }}>Offline exams</h3>
              <button className="btn" onClick={() => setParams({ batch: batchId, sheet: "1" })}><Plus size={15} /> New offline exam</button>
            </div>
            {list.exams.length === 0 ? <p className="muted small">None yet. {students.length} students on the register.</p> : (
              <table className="table">
                <thead><tr><th>Exam</th><th>Date</th><th>Full marks</th><th>Results</th></tr></thead>
                <tbody>
                  {list.exams.map((x) => (
                    <tr key={x._id} style={{ cursor: "pointer" }} onClick={() => setParams({ batch: batchId, exam: x._id, sheet: "1" })}>
                      <td>{x.title}</td><td>{new Date(x.date).toLocaleDateString()}</td><td>{x.fullMarks}</td><td>{x.entered}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {editing && (
          <>
            <div className="card stack">
              <div className="row-tight" style={{ gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                <label className="stack" style={{ gap: 2, flex: "2 1 220px" }}><span className="small muted">Exam name</span>
                  <input className="input" value={head.title} onChange={(e) => setHead({ ...head, title: e.target.value })} placeholder="e.g. Chapter 3 paper test" /></label>
                <label className="stack" style={{ gap: 2 }}><span className="small muted">Date</span>
                  <input className="input" type="date" value={head.date} onChange={(e) => setHead({ ...head, date: e.target.value })} /></label>
                <label className="stack" style={{ gap: 2, width: 110 }}><span className="small muted">Full marks</span>
                  <input className="input" type="number" min="1" value={head.fullMarks} onChange={(e) => setHead({ ...head, fullMarks: e.target.value })} /></label>
                <label className="stack" style={{ gap: 2, width: 110 }}><span className="small muted">Pass mark (optional)</span>
                  <input className="input" type="number" min="0" value={head.passMarks} onChange={(e) => setHead({ ...head, passMarks: e.target.value })} /></label>
              </div>
              <div className="row-tight" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <span className="small muted">Per-question marks (optional):</span>
                {head.parts.map((p, j) => (
                  <span key={j} className="row-tight" style={{ gap: 4 }}>
                    <input className="input" style={{ width: 70 }} value={p.label} onChange={(e) => setHead({ ...head, parts: head.parts.map((x, k) => (k === j ? { ...x, label: e.target.value } : x)) })} />
                    <input className="input" style={{ width: 60 }} type="number" placeholder="max" value={p.max} onChange={(e) => setHead({ ...head, parts: head.parts.map((x, k) => (k === j ? { ...x, max: e.target.value } : x)) })} />
                    <button className="icon-btn" title="Remove this column" onClick={() => { setHead({ ...head, parts: head.parts.filter((_, k) => k !== j) }); setRows((all) => Object.fromEntries(Object.entries(all).map(([id, r]) => [id, { ...r, parts: (r.parts || []).filter((_, k) => k !== j) }]))); }}><Trash2 size={13} /></button>
                  </span>
                ))}
                <button className="btn btn-sm btn-quiet" onClick={() => setHead({ ...head, parts: [...head.parts, { label: `Q${head.parts.length + 1}`, max: "" }] })}><Plus size={13} /> Question column</button>
                {head.parts.length > 0 && <button className="btn btn-sm btn-quiet" title="Total = the sum of each row's question marks" onClick={fillTotals}><Wand2 size={13} /> Fill totals from questions</button>}
              </div>
            </div>

            <div className="card stack">
              <div className="spread" style={{ flexWrap: "wrap", gap: 8 }}>
                <input className="input" style={{ maxWidth: 260 }} placeholder="Find a student" value={filter} onChange={(e) => setFilter(e.target.value)} />
                <span className="small muted">{counts.entered} entered · {counts.absent} absent · {counts.blank} blank{counts.bad ? <b style={{ color: "#dc2626" }}> · {counts.bad} out of range</b> : ""}</span>
              </div>
              <p className="small muted" style={{ margin: 0 }}>Enter or the down arrow moves down a column. Paste a column copied from Excel into a cell to fill down from there. A blank row gets no result.</p>
              <div ref={grid} style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
                  <thead>
                    <tr style={{ textAlign: "left" }}>
                      <th style={cell}>#</th><th style={cell}>Student</th><th style={cell}>ID</th><th style={cell}>Phone</th>
                      {head.parts.map((p, j) => <th key={j} style={cell}>{p.label}{p.max !== "" ? ` /${p.max}` : ""}</th>)}
                      <th style={cell}>Total{full ? ` /${full}` : ""} *</th><th style={cell}>Absent</th><th style={cell}>Remark</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((s, r) => {
                      const id = String(s._id);
                      const row = rowOf(id);
                      return (
                        <tr key={id} style={{ opacity: row.absent ? 0.6 : 1 }}>
                          <td style={cell} className="muted">{r + 1}</td>
                          <td style={cell}>{s.name}<div className="small muted">{s.email}</div></td>
                          <td style={cell}>{s.studentId || "—"}</td>
                          <td style={cell}>{s.phone ? `…${s.phone}` : "—"}</td>
                          {head.parts.map((_, j) => (
                            <td key={j} style={cell}>
                              <input data-r={r} data-c={`p${j}`} style={inp(badPart(row, j))} inputMode="decimal" disabled={row.absent} value={row.parts?.[j] ?? ""}
                                onKeyDown={(e) => onKey(e, r, `p${j}`)} onPaste={(e) => onPaste(e, r, `p${j}`)}
                                onChange={(e) => { const parts = [...(row.parts || [])]; parts[j] = e.target.value; setRow(id, { parts }); }} />
                            </td>
                          ))}
                          <td style={cell}>
                            <input data-r={r} data-c="total" style={inp(badTotal(row))} inputMode="decimal" disabled={row.absent} value={row.marks}
                              onKeyDown={(e) => onKey(e, r, "total")} onPaste={(e) => onPaste(e, r, "total")} onChange={(e) => setRow(id, { marks: e.target.value })} />
                          </td>
                          <td style={cell}><input type="checkbox" checked={row.absent} onChange={(e) => setRow(id, { absent: e.target.checked })} /></td>
                          <td style={cell}>
                            <input data-r={r} data-c="remark" style={{ ...inp(false), width: 180 }} value={row.remark}
                              onKeyDown={(e) => onKey(e, r, "remark")} onPaste={(e) => onPaste(e, r, "remark")} onChange={(e) => setRow(id, { remark: e.target.value })} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="spread" style={{ flexWrap: "wrap", gap: 8 }}>
                <div className="row-tight" style={{ gap: 8 }}>
                  <button className="btn btn-quiet" onClick={discard}>Back</button>
                  {examId && <button className="btn btn-quiet" onClick={remove}><Trash2 size={14} /> Delete exam</button>}
                </div>
                <button className="btn" disabled={!headOk || counts.bad > 0 || counts.entered + counts.absent === 0} onClick={() => setConfirm(true)}><Save size={15} /> {examId ? "Save changes" : "Confirm submission"}</button>
              </div>
              {!headOk && <p className="small muted" style={{ margin: 0 }}>Give the exam a name, date and full marks to submit.</p>}
              {log.length > 0 && (
                <details className="small muted"><summary>Change history</summary>
                  {log.slice().reverse().map((l, i) => <div key={i}>{new Date(l.at).toLocaleString()}: {l.note}</div>)}
                </details>
              )}
            </div>
          </>
        )}
      </div>

      {confirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }} onClick={() => !busy && setConfirm(false)}>
          <div className="card stack" style={{ maxWidth: 440, width: "100%" }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: 0 }}><ClipboardList size={16} /> {examId ? "Save changes?" : "Publish these results?"}</h3>
            <p className="small" style={{ margin: 0 }}>
              <b>{head.title}</b>, {head.date}, full marks {head.fullMarks}.<br />
              {counts.entered} marks, {counts.absent} absent. {counts.blank} blank row{counts.blank === 1 ? "" : "s"} get no result.
            </p>
            <label className="small row-tight" style={{ gap: 6 }}><input type="checkbox" checked={tellStudents} onChange={(e) => setTellStudents(e.target.checked)} /> Notify students of a new result</label>
            <div className="row-tight" style={{ gap: 8, justifyContent: "flex-end" }}>
              <button className="btn btn-quiet" disabled={busy} onClick={() => setConfirm(false)}>Cancel</button>
              <button className="btn" disabled={busy} onClick={save}>{busy ? "Saving…" : examId ? "Save" : "Publish results"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
