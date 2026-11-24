import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LayoutGrid, List, X, Loader2, Save } from "lucide-react";
import { useConfirm } from "./bits";

// Small pieces the list pages and editors share, so every page reads the
// same way: a strip of status counts, the filters in use as chips, a grid
// or list switch, and a save bar that warns before unsaved work is lost.

// A row of counts that are also filters. items: [{ key, label, count, tone }]
// tone: "warn" | "ok" tints the count. Clicking the open one again clears it.
export function StatusStrip({ items, value, onChange }) {
  return (
    <div className="status-strip" role="tablist">
      {items.map((item) => {
        const on = (value || "") === (item.key || "");
        return (
          <button
            key={item.key || "all"}
            type="button"
            role="tab"
            aria-selected={on}
            className={`status-tile${on ? " status-tile-on" : ""}${item.tone ? ` status-tile-${item.tone}` : ""}`}
            onClick={() => onChange(on && item.key ? "" : item.key || "")}
          >
            <span className="status-count tnum">{item.count ?? "–"}</span>
            <span className="status-label">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// The filters in use, each one removable. chips: [{ key, label, onClear }]
export function FilterChips({ chips, onClearAll }) {
  const shown = chips.filter(Boolean);
  if (!shown.length) return null;
  return (
    <div className="row-tight" style={{ flexWrap: "wrap", gap: 6 }}>
      {shown.map((chip) => (
        <span key={chip.key} className="filter-chip">
          {chip.label}
          <button type="button" aria-label={`Remove ${chip.label}`} onClick={chip.onClear}><X size={12} /></button>
        </span>
      ))}
      {shown.length > 1 && (
        <button type="button" className="btn btn-sm btn-quiet" onClick={onClearAll}>Clear all</button>
      )}
    </div>
  );
}

// Browser storage can be missing or blocked; the page works without it.
const readStored = (key, fallback) => {
  try { return window.localStorage.getItem(key) || fallback; } catch { return fallback; }
};
const writeStored = (key, value) => {
  try { window.localStorage.setItem(key, value); } catch { /* not kept */ }
};

// "grid" or "list", remembered per page in this browser.
export function useViewMode(page, fallback = "grid") {
  const key = `view:${page}`;
  const [mode, setMode] = useState(() => readStored(key, fallback));
  const set = (next) => { setMode(next); writeStored(key, next); };
  return [mode === "list" ? "list" : "grid", set];
}

export function ViewToggle({ value, onChange }) {
  return (
    <div className="seg" role="group" aria-label="View">
      <button type="button" className={`seg-btn${value === "grid" ? " seg-on" : ""}`} title="Cards" onClick={() => onChange("grid")}>
        <LayoutGrid size={14} />
      </button>
      <button type="button" className={`seg-btn${value === "list" ? " seg-on" : ""}`} title="List" onClick={() => onChange("list")}>
        <List size={14} />
      </button>
    </div>
  );
}

// A search box with a clear button. Submits on Enter.
export function SearchBox({ value, onChange, onSubmit, placeholder = "Search" }) {
  return (
    <form
      className="search-wrap grow"
      onSubmit={(e) => { e.preventDefault(); onSubmit(value); }}
    >
      <input
        className="input"
        style={{ paddingLeft: 12, paddingRight: 34 }}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button type="button" className="search-clear" aria-label="Clear search" onClick={() => { onChange(""); onSubmit(""); }}>
          <X size={14} />
        </button>
      )}
    </form>
  );
}

// Whether two drafts hold the same work. Links (keys ending in "Url", and
// "url") are left out: a signed link is refreshed after a page opens, which
// is not an edit. A picked file or video counts by its id.
const workOf = (draft) => JSON.stringify(draft, function (key, value) {
  if (key && (/Url$/.test(key) || key === "url" || key === "expiresAt")) return undefined;
  if (key && value && typeof value === "object" && !Array.isArray(value) && value._id) return String(value._id);
  return value;
});
export const sameWork = (a, b) => workOf(a) === workOf(b);

// Ctrl+S (Cmd+S on a Mac) runs save instead of the browser's "save page".
export function useCtrlS(save, enabled = true) {
  const ref = useRef(save);
  ref.current = save;
  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        ref.current?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}

// While there are unsaved changes: closing or reloading the tab asks first,
// and so does following a link inside the app. leave(path) is for the
// page's own Back and Cancel buttons.
export function useUnsaved(dirty) {
  const confirm = useConfirm();
  const navigate = useNavigate();
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const ask = useCallback(() => confirm({
    title: "Leave without saving?",
    body: "Your changes on this page are not saved yet.",
    confirmLabel: "Leave",
    cancelLabel: "Stay",
  }), [confirm]);

  useEffect(() => {
    if (!dirty) return undefined;
    const onUnload = (e) => { e.preventDefault(); e.returnValue = ""; };
    const onClick = async (e) => {
      if (!dirtyRef.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = e.target.closest?.("a[href]");
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || !url.pathname.startsWith("/admin")) return;
      e.preventDefault();
      e.stopPropagation();
      if (await ask()) {
        dirtyRef.current = false;
        const inside = (url.pathname.replace(/^\/admin/, "") || "/") + url.search + url.hash;
        navigate(inside);
      }
    };
    window.addEventListener("beforeunload", onUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty, ask, navigate]);

  const leave = useCallback(async (path, options) => {
    if (dirtyRef.current && !(await ask())) return;
    dirtyRef.current = false;
    navigate(path, options);
  }, [ask, navigate]);

  // Call before navigating away after a successful save.
  const clear = useCallback(() => { dirtyRef.current = false; }, []);

  return { leave, clear };
}

// A bar stuck to the bottom of the page: what state the work is in, and
// the save button. Put it last inside the page.
export function SaveBar({ dirty, saving, disabled, onCancel, saveLabel = "Save changes", savingLabel = "Saving", note, type = "submit", onSave }) {
  return (
    <div className={`save-bar${dirty ? "" : " save-bar-idle"}`}>
      <span className="row-tight small grow" style={{ gap: 6 }}>
        {dirty
          ? <><span className="dirty-dot" /> Unsaved changes</>
          : <span className="muted">{note || "All changes saved"}</span>}
        <span className="muted hide-sm" style={{ marginLeft: 8 }}>Ctrl+S to save</span>
      </span>
      {onCancel && <button type="button" className="btn btn-quiet" onClick={onCancel}>Cancel</button>}
      <button type={type} className="btn" disabled={disabled || saving} onClick={onSave}>
        {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />} {saving ? savingLabel : saveLabel}
      </button>
    </div>
  );
}

// Tabs inside a page. tabs: [{ value, label, icon: Icon, count }]
export function PageTabs({ tabs, value, onChange }) {
  return (
    <div className="subtabs" role="tablist">
      {tabs.map(({ value: v, label, icon: Icon, count }) => (
        <button key={v} type="button" role="tab" aria-selected={value === v} className={`subtab${value === v ? " subtab-on" : ""}`} onClick={() => onChange(v)}>
          {Icon && <Icon size={14} />} {label}
          {count > 0 && <span className="tab-count tnum">{count}</span>}
        </button>
      ))}
    </div>
  );
}

// "12:05" or "1:02:05".
export const formatDuration = (seconds) => {
  const s = Math.round(Number(seconds) || 0);
  if (!s) return "";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
};
