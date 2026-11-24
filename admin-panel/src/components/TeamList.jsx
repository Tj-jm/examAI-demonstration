import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { Pager } from "./bits";

const PER_PAGE = 10;

const matches = (u, q) => !q || `${u.name || ""} ${u.email || ""} ${u.identifier || ""}`.toLowerCase().includes(q);

// One page of people with a name filter: a batch's teachers or graders, or
// the accounts that can be added (BatchDetail → Team).
export default function TeamList({ people, query, onRemove, onAdd, empty }) {
  const q = query.trim().toLowerCase();
  const list = useMemo(() => (people || []).filter((u) => matches(u, q)), [people, q]);
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [q]);
  const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
  const shown = list.slice((Math.min(page, pages) - 1) * PER_PAGE, Math.min(page, pages) * PER_PAGE);

  if (!list.length) return <p className="hint" style={{ margin: 0 }}>{q ? "Nobody matches." : empty}</p>;
  return (
    <div className="stack" style={{ gap: 6 }}>
      {shown.map((u) => (onAdd ? (
        <button
          key={u._id}
          className="spread"
          style={{ background: "var(--surface)", border: "none", borderRadius: 8, padding: 10, font: "inherit", color: "inherit", textAlign: "left", cursor: "pointer" }}
          onClick={() => onAdd(u._id)}
        >
          <span className="grow small">{u.name} · {u.email}</span>
          <span className="muted">+</span>
        </button>
      ) : (
        <div className="card-quiet spread" key={u._id} style={{ padding: 10 }}>
          <div className="grow">
            <span className="small">{u.name}</span>
            <div className="muted small">{u.email}</div>
          </div>
          {onRemove && (
            <button className="icon-btn icon-btn-danger" title="Remove" onClick={() => onRemove(u._id)}>
              <X size={15} />
            </button>
          )}
        </div>
      )))}
      {pages > 1 && <Pager page={Math.min(page, pages)} pages={pages} total={list.length} onChange={setPage} />}
    </div>
  );
}
