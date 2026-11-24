import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Search, LogOut } from "lucide-react";
import { useBrand } from "./Brand";

// The top bar of the "Modern" navigation (Settings → Appearance): the page's
// name, a search that jumps to any page in the nav (Ctrl/⌘ K), and who is
// signed in. items: the nav's own links ({ to, label, Icon }), so it never
// offers a page this account can't open.
const ROLE = { owner: "Owner", admin: "Admin", teacher: "Teacher", grader: "Grader", doubtSolver: "Doubt solver", representative: "Representative" };

// The nav link that matches most of the address.
export const matchPage = (items, path) => items
  .filter((x) => (x.to === "/" ? path === "/" : path === x.to || path.startsWith(`${x.to}/`)))
  .sort((a, b) => b.to.length - a.to.length)[0] || null;

// home: the launcher layout, which has no sidebar; the brand leads back to
// the overview's grid of pages.
export default function TopBar({ items, me, onSignOut, home = false }) {
  const brand = useBrand();
  const location = useLocation();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState(0);
  const [menu, setMenu] = useState(false);
  const inputRef = useRef(null);

  const here = useMemo(() => matchPage(items, location.pathname), [items, location.pathname]);

  const found = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (s ? items.filter((x) => x.label.toLowerCase().includes(s)) : items).slice(0, 8);
  }, [items, q]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => setPick(0), [q]);

  const go = (x) => {
    if (!x) return;
    navigate(x.to);
    setQ("");
    setOpen(false);
    inputRef.current?.blur();
  };
  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setPick((p) => Math.min(found.length - 1, p + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setPick((p) => Math.max(0, p - 1)); }
    else if (e.key === "Enter") go(found[pick]);
    else if (e.key === "Escape") { setOpen(false); e.currentTarget.blur(); }
  };
  const mac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || "");
  const initials = String(me?.name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
  const HereIcon = here?.Icon;

  return (
    <header className="topbar">
      <div className="topbar-title">
        {home && (
          <Link to="/" className="topbar-home" title="All pages">
            {brand.logo ? <img src={brand.logo} alt="" className="topbar-home-logo" /> : <span className="topbar-home-mark" />}
            <span className="topbar-home-name">{brand.name}</span>
          </Link>
        )}
        {home && location.pathname !== "/" && <span className="topbar-sep">/</span>}
        {(!home || location.pathname !== "/") && (
          <>
            {HereIcon && <span className="topbar-title-icon"><HereIcon size={16} strokeWidth={2} /></span>}
            <span className="grow" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{here?.label || ""}</span>
          </>
        )}
      </div>

      <div className="topbar-search">
        <Search size={15} className="topbar-search-icon" />
        <input ref={inputRef} value={q} placeholder="Go to a page…" aria-label="Go to a page"
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown} />
        <kbd className="topbar-kbd">{mac ? "⌘" : "Ctrl"} K</kbd>
        {open && found.length > 0 && (
          <div className="topbar-results" role="listbox">
            {found.map((x, i) => {
              const { Icon } = x;
              return (
                <button key={x.to} type="button" role="option" aria-selected={i === pick}
                  className={`topbar-result${i === pick ? " topbar-result-on" : ""}`}
                  onMouseEnter={() => setPick(i)} onMouseDown={(e) => { e.preventDefault(); go(x); }}>
                  {Icon && <Icon size={15} strokeWidth={1.9} />}
                  <span>{x.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="topbar-me">
        <button type="button" className="topbar-avatar-btn" onClick={() => setMenu((m) => !m)} onBlur={() => setTimeout(() => setMenu(false), 150)} title={me?.name || ""}>
          <span className="topbar-who">
            <span className="topbar-name">{me?.name}</span>
            <span className="topbar-role">{ROLE[me?.role] || me?.role}</span>
          </span>
          <span className="topbar-avatar">{initials}</span>
        </button>
        {menu && (
          <div className="topbar-menu">
            <div className="small muted" style={{ padding: "6px 10px" }}>{me?.email}</div>
            <button type="button" className="topbar-result" onMouseDown={(e) => { e.preventDefault(); onSignOut(); }}>
              <LogOut size={15} strokeWidth={1.9} /> <span>Sign out</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
