import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useUpdateGradebookSettingsMutation } from "../../api/contentApi";
import { ErrorNote, Field } from "../../components/bits";
import SignatureFields from "../../components/SignatureFields";

const SCALE_NAMES = { letter: "A–F (4.0)", gpa5: "GPA 5 (A+ to F)", classes: "University classes (First, 2:1…)" };

// Categories and weights, the grading scale, which items count, and what
// students see.
export default function GradebookSettings({ batchId, data, onClose }) {
  const s = data.settings;
  const [categories, setCategories] = useState(s.categories.map((c) => ({ ...c })));
  const [scale, setScale] = useState(s.scale.map((r) => ({ ...r, points: r.points ?? "" })));
  const [overrides, setOverrides] = useState(() => Object.fromEntries(s.overrides.map((o) => [String(o.ref), { category: o.category || "", excluded: o.excluded }])));
  const [flags, setFlags] = useState({ missingAsZero: s.missingAsZero, published: s.published, showRank: s.showRank, term: s.term });
  const [signatures, setSignatures] = useState((s.signatures || []).map((x) => ({ ...x })));
  const [save, { isLoading, error }] = useUpdateGradebookSettingsMutation();

  const total = categories.reduce((sum, c) => sum + (Number(c.weight) || 0), 0);
  const allCats = [...new Set([...categories.map((c) => c.name).filter(Boolean), ...data.items.map((i) => i.category)])];

  const setOverride = (id, patch) => setOverrides({ ...overrides, [id]: { category: "", excluded: false, ...overrides[id], ...patch } });

  const submit = async () => {
    try {
      await save({
        batchId,
        categories,
        scale: scale.map((r) => ({ ...r, points: r.points === "" ? null : Number(r.points) })),
        overrides: Object.entries(overrides).map(([ref, o]) => ({ ref, ...o })),
        ...flags,
        signatures,
      }).unwrap();
      onClose();
    } catch { /* shown below */ }
  };

  return (
    <div className="card stack">
      <div className="spread"><h2>Gradebook settings</h2><button className="btn btn-sm btn-quiet" onClick={onClose}>Close</button></div>

      <div className="grid-2" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 24 }}>
        <div className="stack">
          <h3 style={{ margin: 0 }}>Categories</h3>
          <p className="muted small" style={{ margin: 0 }}>Each category's percentage counts this much of the overall grade. Exams go in "Exams"; an assignment goes in its own category.</p>
          {categories.map((c, i) => (
            <div key={i} className="row-tight">
              <input className="input" value={c.name} placeholder="Name" onChange={(e) => setCategories(categories.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <input className="input tnum" type="number" min={0} max={100} value={c.weight} style={{ width: 80 }} onChange={(e) => setCategories(categories.map((x, j) => (j === i ? { ...x, weight: e.target.value } : x)))} />
              <span className="muted">%</span>
              <button className="btn btn-sm btn-quiet" aria-label="Remove" onClick={() => setCategories(categories.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
            </div>
          ))}
          <div className="spread">
            <button className="btn btn-sm btn-quiet" onClick={() => setCategories([...categories, { name: "", weight: 0 }])}><Plus size={14} /> Add a category</button>
            <span className={`small ${total === 100 ? "muted" : ""}`}>Total {total}%{total !== 100 ? " — weights are scaled to 100%" : ""}</span>
          </div>
        </div>

        <div className="stack">
          <div className="spread">
            <h3 style={{ margin: 0 }}>Scale</h3>
            <select className="select" style={{ maxWidth: 220 }} value="" onChange={(e) => e.target.value && setScale(data.presets.scales[e.target.value].map((r) => ({ ...r, points: r.points ?? "" })))}>
              <option value="">Use a preset…</option>
              {Object.keys(data.presets.scales).map((k) => <option key={k} value={k}>{SCALE_NAMES[k] || k}</option>)}
            </select>
          </div>
          <p className="muted small" style={{ margin: 0 }}>The overall percentage at or above "From" gets that grade. Points are optional (GPA).</p>
          {scale.map((r, i) => (
            <div key={i} className="row-tight">
              <input className="input" value={r.letter} placeholder="Grade" style={{ width: 90 }} onChange={(e) => setScale(scale.map((x, j) => (j === i ? { ...x, letter: e.target.value } : x)))} />
              <span className="muted small">from</span>
              <input className="input tnum" type="number" min={0} max={100} value={r.min} style={{ width: 80 }} onChange={(e) => setScale(scale.map((x, j) => (j === i ? { ...x, min: e.target.value } : x)))} />
              <span className="muted small">% · points</span>
              <input className="input tnum" type="number" min={0} max={10} step="0.25" value={r.points} style={{ width: 80 }} onChange={(e) => setScale(scale.map((x, j) => (j === i ? { ...x, points: e.target.value } : x)))} />
              <button className="btn btn-sm btn-quiet" aria-label="Remove" onClick={() => setScale(scale.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
            </div>
          ))}
          <button className="btn btn-sm btn-quiet" style={{ alignSelf: "flex-start" }} onClick={() => setScale([...scale, { letter: "", min: 0, points: "" }])}><Plus size={14} /> Add a grade</button>
        </div>
      </div>

      {data.items.length > 0 && (
        <div className="stack">
          <h3 style={{ margin: 0 }}>Items</h3>
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead><tr><th>Item</th><th>Category</th><th>Counts</th></tr></thead>
              <tbody>
                {data.items.map((i) => {
                  const o = overrides[i.id] || {};
                  return (
                    <tr key={i.id}>
                      <td>{i.title} <span className="muted small">· {i.kind === "exam" ? "exam" : "assignment"} · /{i.max}</span></td>
                      <td>
                        <select className="select" value={o.category || ""} onChange={(e) => setOverride(i.id, { category: e.target.value })}>
                          <option value="">Default ({i.kind === "exam" ? "Exams" : "its own"})</option>
                          {allCats.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </td>
                      <td><input type="checkbox" checked={!o.excluded} onChange={(e) => setOverride(i.id, { excluded: !e.target.checked })} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="stack">
        <label className="row-tight"><input type="checkbox" checked={flags.missingAsZero} onChange={(e) => setFlags({ ...flags, missingAsZero: e.target.checked })} /> Work not handed in counts as 0 once it closes</label>
        <label className="row-tight"><input type="checkbox" checked={flags.showRank} onChange={(e) => setFlags({ ...flags, showRank: e.target.checked })} /> Show position in class on report cards</label>
        <label className="row-tight"><input type="checkbox" checked={flags.published} onChange={(e) => setFlags({ ...flags, published: e.target.checked })} /> Students can see their grades and report card</label>
        <div className="row-tight" style={{ flexWrap: "wrap", gap: 12 }}>
          <Field label="Term on report cards"><input className="input" value={flags.term} placeholder="e.g. Half-yearly 2026" onChange={(e) => setFlags({ ...flags, term: e.target.value })} /></Field>
        </div>
        <SignatureFields label="Report card signatures" value={signatures} onChange={setSignatures} />
      </div>

      <ErrorNote error={error} />
      <div className="row-tight"><button className="btn" disabled={isLoading} onClick={submit}>{isLoading ? "Saving" : "Save settings"}</button></div>
    </div>
  );
}
