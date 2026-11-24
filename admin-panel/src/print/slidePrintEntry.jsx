import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import "katex/dist/katex.min.css";
import SlideView from "../components/SlideView";

// The page the server prints a slide deck from (backend utils/slidePrint.js,
// headless Chromium): window.__renderSlides(deck) draws every slide, one
// 1280 x 720 page each. Speaker notes are not drawn.
const root = createRoot(document.getElementById("slides"));

window.__renderSlides = async (deck) => {
  flushSync(() => root.render(
    <>
      {deck.slides.map((s, i) => (
        <div key={i} className="page"><SlideView deck={deck} slide={s} index={i} total={deck.slides.length} width={1280} /></div>
      ))}
    </>,
  ));
  await document.fonts.ready;
  await Promise.all([...document.images].map((img) => (img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r; }))));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return true;
};
