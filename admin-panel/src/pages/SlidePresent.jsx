import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, Maximize, MonitorSpeaker, X, Eye } from "lucide-react";
import { useGetSlideDeckQuery } from "../api/slideApi";
import { Loading, ErrorNote } from "../components/bits";
import SafeMarkdown from "../components/SafeMarkdown";
import SlideView, { SLIDE_W, SLIDE_H } from "../components/SlideView";

// Present a deck full screen (outside the panel's nav). Arrow keys, space,
// Page Up/Down and clicks move; A shows a quiz slide's answer; P switches
// the presenter view (notes, next slide, timer); F full screen; Esc leaves
// full screen.

const useWindowSize = () => {
  const [size, setSize] = useState([window.innerWidth, window.innerHeight]);
  useEffect(() => {
    const on = () => setSize([window.innerWidth, window.innerHeight]);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return size;
};
const fit = (w, h) => Math.min(w, (h * SLIDE_W) / SLIDE_H);
const clock = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

export default function SlidePresent() {
  const { id } = useParams();
  const { data: deck, isLoading, error } = useGetSlideDeckQuery(id);
  const [i, setI] = useState(0);
  const [answer, setAnswer] = useState(false);
  const [presenter, setPresenter] = useState(false);
  const [started] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const [w, h] = useWindowSize();
  const total = deck?.slides?.length || 0;

  const go = useCallback((d) => { setI((x) => Math.max(0, Math.min(total - 1, x + d))); setAnswer(false); }, [total]);
  useEffect(() => {
    const on = (e) => {
      if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(e.key)) { e.preventDefault(); go(1); }
      else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) { e.preventDefault(); go(-1); }
      else if (e.key === "Home") { setI(0); setAnswer(false); }
      else if (e.key === "End") { setI(total - 1); setAnswer(false); }
      else if (e.key.toLowerCase() === "a") setAnswer((a) => !a);
      else if (e.key.toLowerCase() === "p") setPresenter((p) => !p);
      else if (e.key.toLowerCase() === "f") (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [go, total]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { if (deck?.title) document.title = deck.title; }, [deck?.title]);

  if (isLoading) return <Loading />;
  if (error || !deck) return <div className="page"><ErrorNote error={error} /></div>;
  if (!total) return <div className="page"><p>This deck has no slides yet.</p></div>;
  const slide = deck.slides[i];
  const bar = { position: "fixed", bottom: 12, right: 12, display: "flex", gap: 6, opacity: 0.35, zIndex: 2 };
  const btn = { background: "rgba(255,255,255,0.12)", color: "#fff", border: "none", borderRadius: 8, padding: 8, cursor: "pointer", display: "flex" };
  const controls = (
    <div style={bar} onMouseEnter={(e) => { e.currentTarget.style.opacity = 1; }} onMouseLeave={(e) => { e.currentTarget.style.opacity = 0.35; }}>
      <button type="button" style={btn} title="Back (left arrow)" onClick={() => go(-1)}><ChevronLeft size={18} /></button>
      <span style={{ color: "#fff", alignSelf: "center", fontSize: 13, minWidth: 50, textAlign: "center" }}>{i + 1} / {total}</span>
      <button type="button" style={btn} title="Next (right arrow)" onClick={() => go(1)}><ChevronRight size={18} /></button>
      {slide.layout === "quiz" && <button type="button" style={btn} title="Show the answer (A)" onClick={() => setAnswer((a) => !a)}><Eye size={18} /></button>}
      <button type="button" style={btn} title="Presenter view (P)" onClick={() => setPresenter((p) => !p)}><MonitorSpeaker size={18} /></button>
      <button type="button" style={btn} title="Full screen (F)" onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})}><Maximize size={18} /></button>
      <button type="button" style={btn} title="Close" onClick={() => window.close()}><X size={18} /></button>
    </div>
  );

  if (presenter) {
    const main = fit(w * 0.62, h - 120);
    const next = deck.slides[i + 1];
    return (
      <div style={{ position: "fixed", inset: 0, background: "#111", color: "#eee", display: "flex", gap: 20, padding: 20, boxSizing: "border-box" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div onClick={() => go(1)} style={{ cursor: "pointer" }}><SlideView deck={deck} slide={slide} index={i} total={total} width={main} answer={answer} /></div>
          <div style={{ display: "flex", gap: 20, fontSize: 28, fontVariantNumeric: "tabular-nums" }}>
            <span title="Time since you started">{clock(now - started)}</span>
            <span style={{ opacity: 0.6 }}>{new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            <span style={{ marginLeft: "auto", opacity: 0.8 }}>{i + 1} / {total}</span>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 12, textTransform: "uppercase", opacity: 0.6 }}>Next</div>
          {next ? <SlideView deck={deck} slide={next} index={i + 1} total={total} width={Math.min(w * 0.3, 420)} /> : <div style={{ opacity: 0.6 }}>End of the deck</div>}
          <div style={{ fontSize: 12, textTransform: "uppercase", opacity: 0.6, marginTop: 8 }}>Notes</div>
          <div style={{ flex: 1, overflow: "auto", fontSize: 20, lineHeight: 1.5 }}>{slide.notes ? <SafeMarkdown>{slide.notes}</SafeMarkdown> : <span style={{ opacity: 0.5 }}>No notes on this slide.</span>}</div>
        </div>
        {controls}
      </div>
    );
  }

  const size = fit(w, h);
  return (
    <div style={{ position: "fixed", inset: 0, background: "#000", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }} onClick={(e) => { if (e.target === e.currentTarget || e.currentTarget.contains(e.target)) go(1); }}>
      <SlideView deck={deck} slide={slide} index={i} total={total} width={size} answer={answer} />
      <div onClick={(e) => e.stopPropagation()}>{controls}</div>
    </div>
  );
}
