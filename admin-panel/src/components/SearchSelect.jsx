import { Children, Fragment, isValidElement, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check, Search } from "lucide-react";

// A dropdown with a search box, for lists that grow (batches, staff,
// courses). A drop-in for <select>: the same <option> and <optgroup>
// children, the same value, and onChange gets { target: { value, name } }
// as before. Closed, it looks like the plain select. Open, a search box
// sits on top once the list is longer than `searchFrom`; typing filters,
// the arrow keys move, Enter picks, Escape closes. On a phone the list
// opens as a sheet from the bottom.
//
// A hidden native select mirrors the value, so `required` and forms
// still work.

const textOf = (node) => {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf(node.props.children);
  return "";
};

// The <option>s in order, with the <optgroup> each one sits under.
const optionsOf = (children, group = null, out = []) => {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === Fragment) optionsOf(child.props.children, group, out);
    else if (child.type === "optgroup") optionsOf(child.props.children, child.props.label || "", out);
    else if (child.type === "option") {
      const label = textOf(child.props.children);
      out.push({ value: String(child.props.value ?? label), label, disabled: Boolean(child.props.disabled), group });
    }
  });
  return out;
};

const norm = (s) => s.toLocaleLowerCase().normalize("NFKC");

export default function SearchSelect({
  value, defaultValue, onChange, children, className = "select", style, disabled, required, name, id, title,
  searchFrom = 8, placeholder = "Search…", "aria-label": ariaLabel,
}) {
  const options = useMemo(() => optionsOf(children), [children]);
  const [inner, setInner] = useState(defaultValue ?? options[0]?.value ?? "");
  const current = String(value ?? inner ?? "");
  const chosen = options.find((o) => o.value === current);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState(null);
  const triggerRef = useRef(null);
  const popRef = useRef(null);
  const listRef = useRef(null);
  const searchRef = useRef(null);
  const searchable = options.length > searchFrom;

  const shown = useMemo(() => {
    const words = norm(query).split(/\s+/).filter(Boolean);
    if (!words.length) return options;
    return options.filter((o) => { const l = norm(`${o.label} ${o.group || ""}`); return words.every((w) => l.includes(w)); });
  }, [options, query]);

  const pick = (o) => {
    if (!o || o.disabled) return;
    setOpen(false);
    triggerRef.current?.focus();
    if (o.value === current) return;
    if (value === undefined) setInner(o.value);
    const target = { value: o.value, name };
    onChange?.({ target, currentTarget: target, preventDefault() {}, stopPropagation() {} });
  };

  // Where the list goes: under the box, or above it when there's more room
  // there; a sheet on a narrow screen.
  const measure = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (vw < 600) { setPlace({ sheet: true }); return; }
    const below = vh - r.bottom - 8;
    const above = r.top - 8;
    const up = below < 260 && above > below;
    const width = Math.min(Math.max(r.width, 240), vw - 16);
    setPlace({ left: Math.min(Math.max(8, r.left), vw - width - 8), width, ...(up ? { bottom: vh - r.top + 4, max: Math.min(360, above) } : { top: r.bottom + 4, max: Math.min(360, below) }) });
  };

  const openList = () => {
    if (disabled) return;
    setQuery("");
    setActive(Math.max(0, options.findIndex((o) => o.value === current)));
    measure();
    setOpen(true);
  };

  useLayoutEffect(() => {
    if (!open) return undefined;
    (searchable ? searchRef.current : listRef.current)?.focus({ preventScroll: true });
    const onDown = (e) => {
      if (popRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    // A scroll elsewhere on the page moves the box: follow it.
    const onScroll = (e) => { if (!popRef.current?.contains(e.target)) measure(); };
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", measure);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => { setActive(0); }, [query]);
  // Keep the highlighted row in view.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const step = (d) => {
    if (!shown.length) return;
    let i = active;
    for (let n = 0; n < shown.length; n += 1) {
      i = (i + d + shown.length) % shown.length;
      if (!shown[i].disabled) break;
    }
    setActive(i);
  };
  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); step(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); step(-1); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(shown.length - 1); }
    else if (e.key === "Enter") { e.preventDefault(); pick(shown[active]); }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); triggerRef.current?.focus(); }
    else if (e.key === "Tab") setOpen(false);
  };
  const onTriggerKey = (e) => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); openList(); }
  };

  const sheet = place?.sheet;
  const pop = open && place && createPortal(
    <>
      {sheet && <div onPointerDown={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 1200, background: "rgba(0,0,0,0.35)" }} />}
      <div
        ref={popRef}
        role="dialog"
        onKeyDown={onKey}
        style={{
          position: "fixed", zIndex: 1201, display: "flex", flexDirection: "column", background: "var(--surface, #fff)", color: "var(--text, #111)",
          border: "1px solid var(--border, rgba(128,128,128,0.35))", boxShadow: "0 12px 32px rgba(0,0,0,0.22)", overflow: "hidden", fontSize: 14,
          ...(sheet
            ? { left: 0, right: 0, bottom: 0, maxHeight: "75vh", borderRadius: "14px 14px 0 0" }
            : { left: place.left, width: place.width, top: place.top, bottom: place.bottom, maxHeight: place.max, borderRadius: 10 }),
        }}
      >
        {searchable && (
          <div style={{ position: "relative", padding: 8, borderBottom: "1px solid var(--border, rgba(128,128,128,0.25))" }}>
            <Search size={15} style={{ position: "absolute", left: 18, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
            <input ref={searchRef} className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={placeholder} aria-label="Search the list" style={{ paddingLeft: 32, paddingTop: 8, paddingBottom: 8 }} />
          </div>
        )}
        <div ref={listRef} role="listbox" tabIndex={-1} style={{ overflowY: "auto", padding: 4, outline: "none" }}>
          {!shown.length && <div style={{ padding: "10px 12px", color: "var(--text-muted)" }}>Nothing matches “{query}”.</div>}
          {shown.map((o, i) => {
            const head = o.group != null && (i === 0 || shown[i - 1].group !== o.group);
            return (
              <Fragment key={`${o.group}|${o.value}|${i}`}>
                {head && <div style={{ padding: "8px 10px 4px", fontSize: 11.5, fontWeight: 600, color: "var(--text-muted)" }}>{o.group}</div>}
                <div
                  data-i={i}
                  role="option"
                  aria-selected={o.value === current}
                  aria-disabled={o.disabled || undefined}
                  onPointerMove={() => !o.disabled && setActive(i)}
                  onClick={() => pick(o)}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, padding: sheet ? "11px 12px" : "7px 10px", borderRadius: 6,
                    cursor: o.disabled ? "default" : "pointer", opacity: o.disabled ? 0.45 : 1,
                    background: i === active ? "var(--surface-alt, rgba(128,128,128,0.14))" : "transparent",
                    fontWeight: o.value === current ? 600 : 400,
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.label || " "}</span>
                  {o.value === current && <Check size={14} style={{ flexShrink: 0 }} />}
                </div>
              </Fragment>
            );
          })}
        </div>
      </div>
    </>,
    document.body,
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        className={className}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onTriggerKey}
        style={{ display: "inline-flex", alignItems: "center", gap: 6, textAlign: "left", cursor: disabled ? "default" : "pointer", minWidth: 0, ...style }}
      >
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{chosen?.label || " "}</span>
        <ChevronDown size={15} style={{ flexShrink: 0, opacity: 0.6 }} />
      </button>
      {/* For forms: `required` and the field's value. */}
      {(required || name) && (
        <select tabIndex={-1} aria-hidden name={name} required={required} value={current} onChange={() => {}}
          style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
          onInvalid={() => triggerRef.current?.focus()}>
          {options.map((o, i) => <option key={i} value={o.value}>{o.label}</option>)}
        </select>
      )}
      {pop}
    </>
  );
}
