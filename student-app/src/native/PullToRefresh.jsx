import { useEffect, useRef, useState } from "react";
import { Box, CircularProgress } from "@mui/material";
import { RotateCw } from "lucide-react";
import { isNative } from "./session";
import { refreshAll } from "./refresh";
import { tapFeedback } from "./haptics";

const PULL = 70; // px of finger travel that counts as a refresh
const MAX = 110;

// Pull down from the top of a page to reload what's on it, in the mobile
// app. Listens on the window, so pages need no changes; a pull that starts
// inside something scrolled down, a canvas or an open dialog is left alone.
const scrolledInside = (el) => {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    if (n.tagName === "CANVAS" || n.dataset?.noPull !== undefined) return true;
    if (n.scrollTop > 0) return true;
  }
  return false;
};

export default function PullToRefresh() {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const start = useRef(null);
  const pullRef = useRef(0);
  const busyRef = useRef(false);

  useEffect(() => {
    if (!isNative) return undefined;
    const set = (v) => { pullRef.current = v; setPull(v); };
    const onStart = (e) => {
      start.current = null;
      if (busyRef.current || e.touches.length !== 1 || window.scrollY > 0) return;
      if (document.querySelector(".MuiModal-root:not(.MuiModal-hidden)") || scrolledInside(e.target)) return;
      start.current = { y: e.touches[0].clientY, x: e.touches[0].clientX };
    };
    const onMove = (e) => {
      if (!start.current) return;
      const dy = e.touches[0].clientY - start.current.y;
      const dx = Math.abs(e.touches[0].clientX - start.current.x);
      if (dy <= 0 || dx > dy || window.scrollY > 0) { set(0); return; }
      const next = Math.min(MAX, dy * 0.5);
      if (pullRef.current < PULL && next >= PULL) tapFeedback();
      set(next);
    };
    const onEnd = async () => {
      if (!start.current) return;
      start.current = null;
      if (pullRef.current < PULL) { set(0); return; }
      busyRef.current = true;
      setBusy(true);
      set(PULL);
      await refreshAll().catch(() => {});
      busyRef.current = false;
      setBusy(false);
      set(0);
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  if (!isNative || (pull === 0 && !busy)) return null;
  const ready = pull >= PULL;
  return (
    <Box
      aria-hidden
      sx={{
        position: "fixed", left: "50%", zIndex: 1250, pointerEvents: "none",
        top: "calc(env(safe-area-inset-top, 0px) + 56px)",
        transform: `translate(-50%, ${pull - 20}px)`,
        transition: start.current ? "none" : "transform 200ms ease",
        width: 40, height: 40, borderRadius: "50%", bgcolor: "background.paper", boxShadow: 3,
        display: "flex", alignItems: "center", justifyContent: "center", color: "primary.main",
      }}
    >
      {busy ? <CircularProgress size={20} /> : <RotateCw size={20} style={{ transform: `rotate(${pull * 3}deg)`, opacity: ready ? 1 : 0.5 }} />}
    </Box>
  );
}
