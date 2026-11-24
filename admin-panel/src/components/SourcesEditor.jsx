import { useState } from "react";
import { Plus, X } from "lucide-react";
import SearchSelect from "./SearchSelect";

// Every board/exam/book a question appeared in, each with all the years it
// appeared there — e.g. Dhaka Board 2015, 2017, 2019 and Rajshahi Board
// 2018, 2020. Shared by the question editor and document extraction, so
// both file questions the same way. Value shape (what the server stores):
//   [{ authority: id, years: [Number], paperLabel: string }]

const parseYears = (text) =>
  String(text)
    .split(/[,\s;]+/)
    .map((y) => Number(y.trim()))
    .filter((y) => Number.isInteger(y) && y >= 1900 && y <= 2200);

const addYears = (years, more) => [...new Set([...(years || []), ...more])].sort((a, b) => b - a);

// Server data → editor rows. Populated authorities come back as objects.
export const sourcesToRows = (sources) =>
  (sources || []).map((s) => ({
    authority: s.authority?._id || s.authority || "",
    years: s.years || [],
    paperLabel: s.paperLabel || "",
  }));

// Editor rows → request body. Rows with no board are dropped.
export const rowsToSources = (rows) =>
  (rows || [])
    .filter((r) => r.authority)
    .map((r) => ({ authority: r.authority, years: r.years || [], paperLabel: (r.paperLabel || "").trim() }));

export const hasBoard = (rows) => (rows || []).some((r) => r.authority);

export function YearsInput({ years, onChange, placeholder }) {
  const [draft, setDraft] = useState("");

  const commit = () => {
    const parsed = parseYears(draft);
    if (parsed.length) onChange(addYears(years, parsed));
    setDraft("");
  };

  return (
    <div className="row-tight input" style={{ flexWrap: "wrap", gap: 4, minHeight: 36, alignItems: "center", minWidth: 180 }}>
      {(years || []).map((y) => (
        <span key={y} className="pill row-tight tnum" style={{ gap: 2 }}>
          {y}
          <button
            type="button"
            className="icon-btn"
            style={{ width: 16, height: 16 }}
            aria-label={`Remove ${y}`}
            onClick={() => onChange(years.filter((x) => x !== y))}
          >
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        className="tnum"
        style={{ border: 0, outline: 0, background: "transparent", flex: 1, minWidth: 70, font: "inherit", color: "inherit" }}
        placeholder={(years || []).length ? "Add year" : placeholder || "e.g. 2019, 2021"}
        value={draft}
        onChange={(e) => {
          const v = e.target.value;
          // Typing a separator commits what's before it.
          if (/[,;\s]$/.test(v)) {
            const parsed = parseYears(v);
            if (parsed.length) onChange(addYears(years, parsed));
            setDraft("");
          } else {
            setDraft(v);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Backspace" && !draft && (years || []).length) {
            onChange(years.slice(0, -1));
          }
        }}
        onPaste={(e) => {
          const parsed = parseYears(e.clipboardData.getData("text"));
          if (parsed.length) {
            e.preventDefault();
            onChange(addYears(years, parsed));
          }
        }}
        onBlur={commit}
      />
    </div>
  );
}

export default function SourcesEditor({ value, onChange, authorities }) {
  const rows = value || [];
  const update = (i, patch) => onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const remove = (i) => onChange(rows.filter((_, idx) => idx !== i));
  const used = new Set(rows.map((r) => r.authority).filter(Boolean));

  return (
    <div className="stack" style={{ gap: 8 }}>
      <span className="label">Boards / exams / books</span>
      {rows.length === 0 && <span className="muted small">Not filed under any board yet.</span>}
      {rows.map((row, i) => (
        <div key={i} className="row-tight" style={{ flexWrap: "wrap", alignItems: "flex-start" }}>
          <SearchSelect
            className="select"
            value={row.authority}
            onChange={(e) => update(i, { authority: e.target.value })}
            aria-label="Board / exam / book"
          >
            <option value="">Pick a board…</option>
            {(authorities || []).map((a) => (
              <option key={a._id} value={a._id} disabled={used.has(a._id) && a._id !== row.authority}>
                {a.name}
              </option>
            ))}
          </SearchSelect>
          <YearsInput years={row.years} onChange={(years) => update(i, { years })} />
          <input
            className="input"
            style={{ width: 180 }}
            placeholder="Paper label (optional)"
            value={row.paperLabel}
            onChange={(e) => update(i, { paperLabel: e.target.value })}
          />
          <button type="button" className="icon-btn icon-btn-danger" title="Remove this board" onClick={() => remove(i)}>
            <X size={15} />
          </button>
        </div>
      ))}
      <div>
        <button
          type="button"
          className="btn btn-sm btn-quiet"
          disabled={(authorities || []).length > 0 && used.size >= (authorities || []).length}
          onClick={() => onChange([...rows, { authority: "", years: [], paperLabel: "" }])}
        >
          <Plus size={14} /> Add board
        </button>
      </div>
      <span className="hint">Every board it appeared in, with all the years it appeared there. Type a year and press Enter, or paste several.</span>
    </div>
  );
}
