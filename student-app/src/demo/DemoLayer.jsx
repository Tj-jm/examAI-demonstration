import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { Box, Button, Chip, IconButton, Paper, Typography } from "@mui/material";
import { StickyNote, X } from "lucide-react";
import sales from "./sales.json";

// The sales demo's layer over every page of the student app: a "Demo" mark,
// and the rep's notes for the page open (demo/sales.json: talking points
// and the page's plan tier). Alt+N or the Notes button shows and hides
// them, so they can be put away while sharing the screen.

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
  return <Chip size="small" color="warning" label={tier} sx={{ fontWeight: 700, letterSpacing: "0.04em" }} />;
}

export default function DemoLayer() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(read);
  const page = useMemo(() => noteFor(pathname), [pathname]);
  const toggle = () => setOpen((o) => { write(!o); return !o; });

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

  const paragraphs = String(page?.note || "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  return (
    <>
      <Box sx={{ position: "fixed", left: 12, top: "calc(12px + env(safe-area-inset-top))", zIndex: 2000, display: "flex", gap: 0.75, alignItems: "center" }}>
        <Chip size="small" label="DEMO" sx={{ fontWeight: 800, letterSpacing: "0.08em", bgcolor: "background.paper", border: 1, borderColor: "divider" }} />
        <Button size="small" variant="outlined" onClick={toggle} title="Sales notes (Alt+N)" startIcon={<StickyNote size={14} />} sx={{ bgcolor: "background.paper", minWidth: 0, py: 0.25 }}>
          Notes
        </Button>
      </Box>
      {open && (
        <Paper elevation={8} sx={{ position: "fixed", right: 12, top: "calc(52px + env(safe-area-inset-top))", width: "min(340px, calc(100vw - 24px))", maxHeight: "60vh", overflow: "auto", zIndex: 2000, p: 1.75, borderRadius: 3 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
            <StickyNote size={15} />
            <Typography sx={{ fontWeight: 700, flex: 1 }}>Sales notes</Typography>
            <TierBadge tier={page?.tier} />
            <IconButton size="small" onClick={toggle} title="Hide (Alt+N)"><X size={15} /></IconButton>
          </Box>
          {paragraphs.length
            ? paragraphs.map((p, i) => <Typography key={i} variant="body2" sx={{ mb: 1, whiteSpace: "pre-wrap" }}>{p}</Typography>)
            : <Typography variant="body2" color="text.secondary">No notes for this page yet{page ? ` (${page.key})` : ""}.</Typography>}
        </Paper>
      )}
    </>
  );
}
