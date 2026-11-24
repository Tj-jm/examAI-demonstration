import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { StickyNote, X, RotateCcw } from "lucide-react";
import sales from "./sales.json";
import { ConfirmProvider, useConfirm } from "../components/bits";

// The sales demo's layer over every page: a "Demo" mark, and the rep's
// notes for the page open (demo/sales.json: talking points and the page's
// plan tier). Alt+N or the Notes button shows and hides them, so they can
// be put away while sharing the screen. Owners and admins can reset the
// demo data from here.

// "/batches/:id" matches "/batches/66f…"; the longest matching key wins.
const noteFor = (path) => {
  const clean = path.replace(/\/+$/, "") || "/";
  let best = null;
  for (const [key, page] of Object.entries(sales.pages || {})) {
    const rx = new RegExp(`^${key.replace(/\/+$/, "").replace(/:[^/]+/g, "[^/]+") || "/"}$`);
    if (rx.test(clean) && (!best || key.length > best.key.length)) best = { key, ...page };
  }
  return best;
};

const KEY = "demo-notes-open";
const read = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };
const write = (v) => { try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* private window */ } };

export function TierBadge({ tier }) {
  if (!tier) return null;
  return <span className="pill pill-warn" style={{ fontWeight: 700, letterSpacing: "0.04em" }}>{tier}</span>;
}

export default function DemoLayer() {
  return <ConfirmProvider><Layer /></ConfirmProvider>;
}

function Layer() {
  const confirm = useConfirm();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(read);
  const [resetState, setResetState] = useState("");
  const page = useMemo(() => noteFor(pathname), [pathname]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.altKey && (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        setOpen((o) => { write(!o); return !o; });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggle = () => setOpen((o) => { write(!o); return !o; });

  const reset = async () => {
    if (!(await confirm({ title: "Reset the demo?", body: "All demo data goes back to the start and everyone signs in again.", confirmLabel: "Reset" }))) return;
    setResetState("Resetting…");
    try {
      const r = await fetch("/api/demo/reset", { method: "POST", credentials: "include" });
      const body = await r.json().catch(() => ({}));
      setResetState(r.ok ? "Resetting. Sign in again in a minute." : body.message || "Couldn't reset.");
    } catch {
      setResetState("Couldn't reset.");
    }
  };

  const paragraphs = String(page?.note || "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  return (
    <>
      <div style={{ position: "fixed", left: 12, bottom: 12, zIndex: 1000, display: "flex", gap: 6, alignItems: "center" }}>
        <span className="pill" style={{ fontWeight: 700, letterSpacing: "0.08em", background: "var(--surface)", border: "1px solid var(--border)" }}>DEMO</span>
        <button type="button" className="btn btn-sm btn-quiet" onClick={toggle} title="Sales notes (Alt+N)" style={{ border: "1px solid var(--border)" }}>
          <StickyNote size={14} /> Notes
        </button>
      </div>
      {open && (
        <aside style={{ position: "fixed", right: 12, bottom: 12, width: "min(340px, calc(100vw - 24px))", maxHeight: "60vh", overflow: "auto", zIndex: 1000, background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "0 12px 32px rgba(0,0,0,0.18)", padding: 14 }}>
          <div className="spread" style={{ marginBottom: 8, gap: 8 }}>
            <div className="row-tight" style={{ gap: 6 }}>
              <StickyNote size={15} />
              <b>Sales notes</b>
              <TierBadge tier={page?.tier} />
            </div>
            <button type="button" className="icon-btn" title="Hide (Alt+N)" onClick={toggle}><X size={15} /></button>
          </div>
          {paragraphs.length
            ? paragraphs.map((p, i) => <p key={i} className="small" style={{ margin: "0 0 8px", whiteSpace: "pre-wrap" }}>{p}</p>)
            : <p className="hint" style={{ margin: 0 }}>No notes for this page yet{page ? ` (${page.key})` : ""}.</p>}
          <div style={{ borderTop: "1px solid var(--border)", marginTop: 10, paddingTop: 10 }} className="row-tight">
            <button type="button" className="btn btn-sm btn-quiet" onClick={reset}><RotateCcw size={13} /> Reset demo</button>
            {resetState && <span className="hint">{resetState}</span>}
          </div>
        </aside>
      )}
    </>
  );
}
