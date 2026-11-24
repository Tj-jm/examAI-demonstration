import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Typography, IconButton, Button, Skeleton, Snackbar, Alert } from "@mui/material";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ChevronLeft, ChevronRight, Maximize, Minimize, Download, CheckCircle2, XCircle } from "lucide-react";
import { useGetSlideDeckQuery } from "../../api/contentApi";
import { API_ROOT } from "../../api/apiBase";
import { nativeHeaders } from "../../native/session";
import SlideView from "../../components/SlideView";
import Latex from "../../components/Latex";
import EmptyState from "../../components/EmptyState";
import goBack from "../../utils/goBack";

// One deck: a slide at a time, arrow keys or swipe to move, full screen,
// a quiz slide answered by tapping an option, and the PDF when allowed.
const useWidth = () => {
  const [w, setW] = useState(0);
  const ro = useRef(null);
  const ref = useCallback((el) => {
    ro.current?.disconnect();
    if (!el) return;
    ro.current = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.current.observe(el);
  }, []);
  return [ref, w];
};

export default function SlideDeckView() {
  const { batchId, deckId } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, error } = useGetSlideDeckQuery({ batchId, id: deckId });
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState(null);
  const [full, setFull] = useState(false);
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [boxRef, boxW] = useWidth();
  const touch = useRef(null);
  const shell = useRef(null);
  const deck = useMemo(() => data && ({
    ...data,
    pictures: Object.fromEntries(Object.entries(data.pictures || {}).map(([k, v]) => [k, /^\/(api|media)\//.test(v) ? `${API_ROOT}${v}` : v])),
  }), [data]);
  const total = deck?.slides?.length || 0;
  const go = useCallback((d) => { setI((x) => Math.max(0, Math.min(total - 1, x + d))); setPicked(null); }, [total]);

  useEffect(() => {
    const on = (e) => {
      if (["ArrowRight", "PageDown", " "].includes(e.key)) { e.preventDefault(); go(1); }
      else if (["ArrowLeft", "PageUp"].includes(e.key)) { e.preventDefault(); go(-1); }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [go]);
  useEffect(() => {
    const on = () => setFull(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  const toggleFull = () => (document.fullscreenElement ? document.exitFullscreen() : shell.current?.requestFullscreen?.())?.catch?.(() => {});
  const download = async () => {
    setBusy(true);
    try {
      const r = await fetch(`${API_ROOT}/api/app/batches/${batchId}/slides/${deckId}/pdf`, { credentials: "include", headers: nativeHeaders() });
      if (!r.ok) { const j = await r.json().catch(() => ({})); setToast(j.message || "The download didn't work."); return; }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(await r.blob());
      a.download = `${deck.title.replace(/[^\w\sঀ-৿-]+/g, "").trim() || "slides"}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
    } catch {
      setToast("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) return <Box sx={{ p: 2 }}><Skeleton variant="rounded" height={360} /></Box>;
  if (error || !deck) return <EmptyState title="These slides aren't available" description={error?.data?.message} />;
  if (!total) return <EmptyState title="No slides in this deck yet" />;
  const slide = deck.slides[i];
  const quiz = slide.layout === "quiz" && slide.quiz?.options?.length ? slide.quiz : null;
  // Full screen: as big as fits; otherwise the column's width.
  const width = full ? Math.min(window.innerWidth, (window.innerHeight - 70) * (16 / 9)) : boxW;

  return (
    <Box sx={{ p: full ? 0 : { xs: 1.5, md: 3 }, maxWidth: full ? "none" : 1100, mx: "auto" }}>
      {!full && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
          <IconButton size="small" onClick={() => goBack(navigate, `/batches/${batchId}/slides`)}><ArrowLeft size={18} /></IconButton>
          <Typography variant="h6" fontWeight={700} sx={{ flex: 1, minWidth: 0 }} noWrap>{deck.title}</Typography>
          {deck.allowDownload && <Button size="small" variant="outlined" startIcon={<Download size={15} />} disabled={busy} onClick={download}>PDF</Button>}
        </Box>
      )}
      <Box ref={shell} sx={{ bgcolor: full ? "#000" : "transparent", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: full ? "100vh" : "auto" }}>
        <Box
          ref={boxRef}
          sx={{ width: "100%", display: "flex", justifyContent: "center", borderRadius: full ? 0 : 2, overflow: "hidden", boxShadow: full ? 0 : 2, touchAction: "pan-y" }}
          onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
          onTouchEnd={(e) => { const dx = e.changedTouches[0].clientX - (touch.current ?? 0); if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1); touch.current = null; }}
        >
          {width > 0 && <SlideView deck={deck} slide={slide} index={i} total={total} width={width} answer={picked !== null} />}
        </Box>
        {quiz && (
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1, width: "100%", maxWidth: width || "100%", mt: 1.5, px: full ? 2 : 0 }}>
            {quiz.options.map((o, j) => {
              const right = picked !== null && j === quiz.answer;
              const wrong = picked === j && j !== quiz.answer;
              return (
                <Button key={j} variant={right || wrong ? "contained" : "outlined"} color={right ? "success" : wrong ? "error" : "primary"} disabled={picked !== null && !right && !wrong}
                  onClick={() => picked === null && setPicked(j)} sx={{ justifyContent: "flex-start", textTransform: "none", gap: 1 }}
                  startIcon={right ? <CheckCircle2 size={16} /> : wrong ? <XCircle size={16} /> : null}>
                  <b>{"ABCDEF"[j]}</b>&nbsp;<Latex>{o}</Latex>
                </Button>
              );
            })}
          </Box>
        )}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1.5, color: full ? "#fff" : "inherit" }}>
          <IconButton onClick={() => go(-1)} disabled={i === 0} sx={{ color: "inherit" }}><ChevronLeft /></IconButton>
          <Typography variant="body2" sx={{ minWidth: 64, textAlign: "center" }}>{i + 1} / {total}</Typography>
          <IconButton onClick={() => go(1)} disabled={i === total - 1} sx={{ color: "inherit" }}><ChevronRight /></IconButton>
          <IconButton onClick={toggleFull} sx={{ color: "inherit" }} title="Full screen">{full ? <Minimize size={18} /> : <Maximize size={18} />}</IconButton>
        </Box>
      </Box>
      <Snackbar open={Boolean(toast)} autoHideDuration={4000} onClose={() => setToast("")}><Alert severity="error" onClose={() => setToast("")}>{toast}</Alert></Snackbar>
    </Box>
  );
}
