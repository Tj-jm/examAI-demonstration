import { useState } from "react";
import { Plus, Search, X } from "lucide-react";

// Assigned batches as removable chips, and a search box that lists the
// rest to add. A wall of pills stops working past a dozen batches.
export default function BatchAssign({ assigned, allBatches, onChange, terms }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const byId = new Map((allBatches || []).map((b) => [b._id, b]));
  const rest = (allBatches || [])
    .filter((b) => !assigned.includes(b._id))
    .filter((b) => !query || b.name.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row-tight" style={{ flexWrap: "wrap", gap: 6 }}>
        {assigned.length === 0 && <span className="muted small">Not assigned to any {terms.batch || "batch"} yet.</span>}
        {assigned.map((bid) => (
          <span key={bid} className="filter-chip">
            {byId.get(bid)?.name || "Batch"}
            <button type="button" aria-label="Remove" onClick={() => onChange(assigned.filter((b) => b !== bid))}><X size={12} /></button>
          </span>
        ))}
      </div>
      {(allBatches || []).length > 0 ? (
        <div style={{ position: "relative", maxWidth: 420 }}>
          <div className="search-wrap">
            <Search size={15} className="search-icon" />
            <input
              className="input"
              style={{ paddingLeft: 36 }}
              placeholder={`Add to a ${terms.batch || "batch"}…`}
              value={query}
              onFocus={() => setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            />
          </div>
          {open && (
            <div className="card stack" style={{ position: "absolute", zIndex: 10, top: "calc(100% + 4px)", left: 0, right: 0, padding: 4, gap: 0, maxHeight: 260, overflowY: "auto", border: "1px solid var(--border)", boxShadow: "0 12px 30px -14px rgba(0,0,0,.35)" }}>
              {rest.length === 0 && <span className="muted small" style={{ padding: "8px 10px" }}>{query ? "No match" : "All added"}</span>}
              {rest.slice(0, 50).map((b) => (
                <button
                  key={b._id}
                  type="button"
                  className="list-row"
                  style={{ border: "none", background: "none", textAlign: "left", font: "inherit", padding: "8px 10px", borderRadius: 8, cursor: "pointer" }}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { onChange([...assigned, b._id]); setQuery(""); }}
                >
                  <Plus size={13} className="muted" /> {b.name}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <p className="hint" style={{ margin: 0 }}>No {terms.batches} yet. Create one first.</p>
      )}
    </div>
  );
}

