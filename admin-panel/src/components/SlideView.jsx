import { useCallback, useRef, useState } from "react";
import { Quote, ImageIcon, CheckCircle2 } from "lucide-react";
import "@fontsource/inter-tight/400.css";
import "@fontsource/inter-tight/600.css";
import "@fontsource/inter-tight/800.css";
import "@fontsource/caveat/700.css";
import "@fontsource/poppins/400.css";
import "@fontsource/poppins/600.css";
import "@fontsource/merriweather/400.css";
import "@fontsource/merriweather/700.css";
import "@fontsource/lora/400.css";
import "@fontsource/lora/700.css";
import "@fontsource/playfair-display/700.css";
import "@fontsource/roboto-condensed/400.css";
import "@fontsource/roboto-condensed/700.css";
import "@fontsource/patrick-hand/400.css";
import "@fontsource/archivo-black/400.css";
import Latex from "./Latex";
import { lookOf, SLIDE_FONTS, MONO } from "../utils/slideLooks";

// One slide, drawn at 1280 x 720 and scaled to `width`. The same drawing
// serves the editor, present mode and the server's PDF (print/slidePrintEntry.jsx).
// editing: shows the picture placeholder; answer: a quiz slide marks the key.

export const SLIDE_W = 1280;
export const SLIDE_H = 720;

const KEYWORDS = /\b(def|return|if|elif|else|for|while|in|import|from|class|function|const|let|var|new|public|private|static|void|int|float|double|char|bool|boolean|string|String|true|false|True|False|None|null|nullptr|include|using|namespace|try|catch|except|finally|with|as|lambda|print|printf|cout|cin|struct|fn|mut|impl|pub|package|func|go|echo)\b/;
const TOKEN = /(\/\/[^\n]*|#[^\n]*|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\b\d+(?:\.\d+)?\b|\b[A-Za-z_]\w*\b)/g;
// A small highlighter: comments, strings, numbers, keywords.
const highlight = (code, look) => {
  const out = [];
  let last = 0;
  String(code).replace(TOKEN, (m, _g, at) => {
    if (at > last) out.push(code.slice(last, at));
    const color = /^(\/\/|#)/.test(m) ? look.muted : /^["']/.test(m) ? (look.preset === "dark" ? "#f1fa8c" : look.preset === "chalk" ? "#9be7a9" : "#0a7d32")
      : /^\d/.test(m) ? (look.preset === "dark" ? "#bd93f9" : look.accent) : KEYWORDS.test(m) && m.length > 1 ? (look.preset === "dark" ? "#ff79c6" : look.accent) : null;
    out.push(color ? <span key={at} style={{ color, fontStyle: /^(\/\/|#)/.test(m) ? "italic" : undefined }}>{m}</span> : m);
    last = at + m.length;
    return m;
  });
  out.push(code.slice(last));
  return out;
};

// Fewer, shorter bullets: bigger type.
const bulletSize = (items, max = 42, min = 24) => {
  const chars = items.reduce((s, b) => s + String(b).length, 0);
  const n = items.length;
  return Math.round(Math.max(min, Math.min(max, max - Math.max(0, n - 4) * 2.5 - Math.max(0, chars - 220) / 22)));
};

const T = ({ children }) => <Latex>{String(children || "")}</Latex>;

const Bullets = ({ items, look, size }) => (
  <ul className={`sv-ul sv-ul-${look.decor}`} style={{ fontSize: size }}>
    {items.map((b, i) => (
      <li key={i}>
        {look.decor === "cards" && <CheckCircle2 size={size * 0.9} color={look.accent} style={{ flex: "none", marginTop: size * 0.12 }} />}
        <span><T>{b}</T></span>
      </li>
    ))}
  </ul>
);

const Heading = ({ look, children }) => (
  <h2 className="sv-h2" style={{ fontSize: 58 * (look.headScale || 1) }}>
    {look.decor === "hash" && <span style={{ color: look.accent }}># </span>}
    <T>{children}</T>
  </h2>
);

function Body({ slide, look, editing, answer, pictures }) {
  const L = slide.layout;
  if (L === "title" || L === "section") {
    const band = look.titleBg;
    return (
      <div className={`sv-cover sv-cover-${L}`} style={band ? { background: band, color: look.titleText } : undefined}>
        <div style={{ width: 90, height: 8, borderRadius: 4, background: band ? look.titleText : look.accent, marginBottom: 28, opacity: look.decor === "rules" ? 0 : 1 }} />
        <h1 className="sv-h1" style={{ fontSize: (L === "title" ? 76 : 64) * (look.headScale || 1) }}><T>{slide.title}</T></h1>
        {look.decor === "rules" && <div style={{ height: 2, background: look.accent, width: 240, margin: "20px 0" }} />}
        {slide.subtitle && <div className="sv-sub" style={band ? { color: look.titleText, opacity: 0.85 } : undefined}><T>{slide.subtitle}</T></div>}
      </div>
    );
  }
  if (L === "quote") {
    return (
      <div className="sv-quote">
        <Quote size={64} color={look.accent} style={{ opacity: 0.85 }} />
        <div className="sv-quote-text" style={{ fontSize: String(slide.quote).length > 160 ? 40 : 54 }}><T>{slide.quote}</T></div>
        {slide.by && <div className="sv-by" style={{ color: look.accent }}>{slide.by}</div>}
      </div>
    );
  }
  if (L === "twoCol") {
    const size = bulletSize([...slide.left, ...slide.right], 34, 22);
    return (
      <>
        <Heading look={look}>{slide.title}</Heading>
        <div className="sv-cols">
          {[[slide.leftTitle, slide.left], [slide.rightTitle, slide.right]].map(([h, items], i) => (
            <div key={i} className="sv-col">
              {h && <div className="sv-col-h" style={{ color: look.accent }}><T>{h}</T></div>}
              <Bullets items={items} look={look} size={size} />
            </div>
          ))}
        </div>
      </>
    );
  }
  if (L === "code") {
    const lines = String(slide.code || "").split("\n");
    const size = Math.max(16, Math.min(32, Math.floor(440 / Math.max(lines.length, 1) / 1.5), Math.floor(1700 / Math.max(...lines.map((l) => l.length), 20))));
    return (
      <>
        <Heading look={look}>{slide.title}</Heading>
        <pre className="sv-code" style={{ fontSize: size }}>{highlight(slide.code || "", look)}</pre>
      </>
    );
  }
  if (L === "quiz") {
    const q = slide.quiz || {};
    const opts = q.options || [];
    return (
      <>
        <Heading look={look}>{slide.title || "Quick check"}</Heading>
        <div className="sv-q"><T>{q.question}</T></div>
        <div className="sv-opts" style={{ gridTemplateColumns: opts.some((o) => o.length > 40) ? "1fr" : "1fr 1fr" }}>
          {opts.map((o, i) => {
            const right = answer && i === q.answer;
            return (
              <div key={i} className="sv-opt" style={right ? { borderColor: look.accent, background: look.accent, color: look.bg } : undefined}>
                <b style={{ color: right ? look.bg : look.accent }}>{"ABCDEF"[i]}</b> <T>{o}</T>
              </div>
            );
          })}
        </div>
      </>
    );
  }
  if (L === "imageText") {
    const pic = pictures?.[slide.image];
    return (
      <>
        <Heading look={look}>{slide.title}</Heading>
        <div className="sv-cols" style={{ gridTemplateColumns: pic || editing ? "1.1fr 1fr" : "1fr" }}>
          <Bullets items={slide.bullets} look={look} size={bulletSize(slide.bullets, 36, 22)} />
          {pic ? <img className="sv-img" src={pic} alt="" /> : editing ? (
            <div className="sv-img sv-img-empty"><ImageIcon size={48} /><div>{slide.imagePrompt || "Add a picture"}</div></div>
          ) : null}
        </div>
      </>
    );
  }
  return (
    <>
      <Heading look={look}>{slide.title}</Heading>
      <Bullets items={slide.bullets || []} look={look} size={bulletSize(slide.bullets || [])} />
    </>
  );
}

const css = (look) => {
  const head = SLIDE_FONTS[look.head]?.css || SLIDE_FONTS.inter.css;
  const body = SLIDE_FONTS[look.body]?.css || SLIDE_FONTS.inter.css;
  return `
.sv { position: absolute; inset: 0; box-sizing: border-box; padding: 64px 80px 70px; color: ${look.text}; font-family: ${body}; overflow: hidden; display: flex; flex-direction: column; }
.sv * { box-sizing: border-box; }
.sv-h1, .sv-h2 { font-family: ${head}; font-weight: ${look.head === "archivo" ? 400 : 800}; line-height: 1.1; margin: 0; letter-spacing: ${look.head === "caveat" ? 0 : "-0.01em"}; }
.sv-h2 { margin-bottom: 30px; ${look.decor === "rules" ? `padding-bottom: 14px; border-bottom: 2px solid ${look.accent};` : ""} }
.sv-sub { font-size: 34px; color: ${look.muted}; margin-top: 18px; }
.sv-cover { position: absolute; inset: 0; padding: 0 110px; display: flex; flex-direction: column; justify-content: center; }
.sv-cover-section { align-items: ${look.decor === "rules" ? "center" : "flex-start"}; text-align: ${look.decor === "rules" ? "center" : "left"}; }
.sv-ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 0.55em; line-height: 1.3; }
.sv-ul li { display: flex; gap: 0.6em; align-items: flex-start; }
.sv-ul li::before { content: ""; flex: none; width: 0.36em; height: 0.36em; margin-top: 0.5em; border-radius: ${look.decor === "rules" ? 0 : "50%"}; background: ${look.accent}; }
.sv-ul-cards { gap: 0.4em; }
.sv-ul-cards li { background: ${look.panel}; border-radius: 18px; padding: 0.45em 0.7em; box-shadow: 0 2px 10px rgba(80,60,120,0.08); }
.sv-ul-cards li::before { display: none; }
.sv-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 56px; flex: 1; min-height: 0; }
.sv-col-h { font-family: ${head}; font-size: 36px; font-weight: 700; margin-bottom: 16px; }
.sv-code { margin: 0; flex: 1; min-height: 0; background: ${look.panel}; color: ${look.codeText}; font-family: ${MONO}; line-height: 1.5; padding: 26px 30px; border-radius: 14px; white-space: pre; overflow: hidden; ${look.decor === "chalk" ? "border: 2px dashed rgba(241,239,230,0.35);" : ""} }
.sv-quote { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 24px; padding: 0 40px; }
.sv-quote-text { font-family: ${head}; line-height: 1.3; font-style: ${look.head === "caveat" || look.head === "archivo" ? "normal" : "italic"}; }
.sv-by { font-size: 30px; font-weight: 600; }
.sv-q { font-size: 38px; line-height: 1.35; margin-bottom: 26px; }
.sv-opts { display: grid; gap: 16px; }
.sv-opt { border: 2px solid ${look.muted}55; border-radius: 14px; padding: 18px 24px; font-size: 32px; background: ${look.panel}; }
.sv-img { width: 100%; height: 100%; max-height: 520px; object-fit: contain; border-radius: 14px; }
.sv-img-empty { border: 3px dashed ${look.muted}88; color: ${look.muted}; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; font-size: 20px; text-align: center; padding: 20px; }
.sv-foot { position: absolute; left: 80px; right: 80px; bottom: 26px; display: flex; justify-content: space-between; font-size: 18px; color: ${look.muted}; font-family: ${body}; }
.sv-logo { position: absolute; top: 28px; right: 36px; height: 52px; max-width: 200px; object-fit: contain; }
`;
};

const hash = (t) => { let h = 5381; for (let i = 0; i < t.length; i += 1) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0; return h.toString(36); };

const background = (look, slide) => {
  if (look.titleBg && (slide.layout === "title" || slide.layout === "section")) return look.titleBg;
  if (look.bgImage) return `linear-gradient(${look.bg}cc, ${look.bg}cc), url(${look.bgImage}) center / cover`;
  if (look.decor === "chalk") return `radial-gradient(circle at 30% 20%, #2d4636, #1c2b22)`;
  return look.bg;
};

export default function SlideView({ deck, slide, index = 0, total = 1, width = 640, editing = false, answer = false, style }) {
  const base = lookOf(deck.look);
  const look = { ...base, logo: deck.pictures?.[base.logo] || (deck.look?.siteLogo !== false ? deck.pictures?.site : "") || "", bgImage: deck.pictures?.[base.bgImage] || "" };
  const scale = width / SLIDE_W;
  const cover = slide.layout === "title" || slide.layout === "section";
  const footer = deck.footer || {};
  const scope = `sv-${hash(JSON.stringify(look))}`;
  return (
    <div style={{ width, height: SLIDE_H * scale, position: "relative", overflow: "hidden", ...style }}>
      <div className={scope} style={{ width: SLIDE_W, height: SLIDE_H, transform: `scale(${scale})`, transformOrigin: "0 0", position: "absolute", left: 0, top: 0, background: background(look, slide) }}>
        <style>{css(look).replace(/\.sv/g, `.${scope} .sv`)}</style>
        {look.decor === "topbar" && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 12, background: look.accent }} />}
        {look.decor === "block" && !cover && <div style={{ position: "absolute", top: 64, left: 0, width: 22, height: 64, background: look.accent }} />}
        {look.decor === "cards" && <div style={{ position: "absolute", right: -120, top: -120, width: 360, height: 360, borderRadius: "50%", background: `${look.accent}22` }} />}
        <div className="sv">
          <Body slide={slide} look={look} editing={editing} answer={answer} pictures={deck.pictures} />
        </div>
        {look.logo && <img className="sv-logo" src={look.logo} alt="" />}
        {footer.show !== false && !cover && (
          <div className="sv-foot">
            <span>{footer.text}</span>
            <span>{footer.numbers !== false ? `${index + 1}${total ? ` / ${total}` : ""}` : ""}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// A slide as wide as the box it sits in (thumbnails in a grid).
export function FitSlide(props) {
  const [w, setW] = useState(0);
  const ro = useRef(null);
  const ref = useCallback((el) => {
    ro.current?.disconnect();
    if (!el) return;
    ro.current = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.current.observe(el);
  }, []);
  return (
    <div ref={ref} style={{ width: "100%", aspectRatio: `${SLIDE_W} / ${SLIDE_H}` }}>
      {w > 0 && <SlideView {...props} width={w} />}
    </div>
  );
}
