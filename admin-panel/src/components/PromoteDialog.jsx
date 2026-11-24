import { useState } from "react";
import { ArrowUpRight, X } from "lucide-react";
import { useGetPromoteQuery, usePromoteBatchMutation } from "../api/contentApi";
import { Loading, ErrorNote, useConfirm } from "./bits";

// Moves a batch's students up a year: into the next batch (or out, when
// they graduate), ending their access here. Unticked students stay.
export default function PromoteDialog({ batch, batches, onClose }) {
  const { data, isLoading, error } = useGetPromoteQuery(batch._id);
  const [promote, { isLoading: saving, error: saveError, data: done }] = usePromoteBatchMutation();
  const [to, setTo] = useState("");
  const [kept, setKept] = useState(new Set());
  const [copy, setCopy] = useState(true);
  const confirm = useConfirm();
  const students = data?.students || [];
  const moving = students.length - kept.size;
  const target = (batches || []).find((b) => b._id === to);
  const flip = (sid) => setKept((k) => { const n = new Set(k); if (n.has(sid)) n.delete(sid); else n.add(sid); return n; });

  const run = async () => {
    const ok = await confirm({
      title: to ? `Move ${moving} students to ${target?.name}?` : `Graduate ${moving} students?`,
      body: `Their access to ${batch.name} ends now${to ? `, and they get ${target?.name}` : ""}. Results and history stay. Unticked students stay in ${batch.name}.`,
      confirmLabel: to ? "Promote" : "Graduate",
    });
    if (ok) await promote({ id: batch._id, to: to || null, keep: [...kept], copyContent: Boolean(to && copy) });
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}>
      <div className="dialog stack" style={{ maxWidth: 520 }} role="dialog" aria-label="Promote">
        <div className="spread">
          <h3 style={{ margin: 0 }}>Promote {batch.name}</h3>
          <button className="icon-btn" aria-label="Close" onClick={onClose}><X size={16} /></button>
        </div>
        {done ? (
          <>
            <p style={{ margin: 0 }}>{done.moved} moved{done.to ? ` to ${done.to}` : " out (graduated)"}{done.keptBack ? `, ${done.keptBack} stayed` : ""}.</p>
            <div className="row-tight"><button className="btn btn-primary" onClick={onClose}>Done</button></div>
          </>
        ) : (
          <>
            <label className="stack" style={{ gap: 4 }}>
              <span className="small muted">Move into</span>
              <select className="select" value={to} onChange={(e) => setTo(e.target.value)}>
                <option value="">Nowhere: they graduate</option>
                {(batches || []).filter((b) => b._id !== batch._id).map((b) => <option key={b._id} value={b._id}>{b.name}{b.year ? ` · ${b.year}` : ""}</option>)}
              </select>
            </label>
            {to && (
              <label className="row-tight small" style={{ gap: 6 }}>
                <input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} /> Also copy this batch's content into it
              </label>
            )}
            <span className="small muted">Untick anyone held back. They stay in {batch.name}.</span>
            {isLoading ? <Loading /> : (
              <div className="card-quiet" style={{ maxHeight: 280, overflowY: "auto", padding: 6 }}>
                {students.length === 0 && <div className="hint" style={{ padding: 8 }}>No one has access to this batch now.</div>}
                {students.map((s) => (
                  <label key={s._id} className="row-tight small" style={{ gap: 8, padding: "4px 6px", cursor: "pointer" }}>
                    <input type="checkbox" checked={!kept.has(s._id)} onChange={() => flip(s._id)} />
                    <span className="grow">{s.name}</span>
                    <span className="muted">{s.studentId || s.email || s.phoneNumber || ""}</span>
                  </label>
                ))}
              </div>
            )}
            <ErrorNote error={error || saveError} />
            <div className="spread">
              <span className="small muted">{moving} of {students.length} move</span>
              <button className="btn btn-primary" disabled={saving || !moving} onClick={run}><ArrowUpRight size={14} /> {saving ? "Working…" : to ? "Promote" : "Graduate"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
