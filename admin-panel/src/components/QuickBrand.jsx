import { useEffect, useMemo, useState } from "react";
import { Wand2 } from "lucide-react";
import { paletteFrom, logoColors, contrast } from "../utils/brandPalette";

const onColor = (bg) => (contrast(bg, "#FFFFFF") >= contrast(bg, "#14161A") ? "#FFFFFF" : "#14161A");

// The quick way to brand the student app: one colour (or one from the logo)
// and a look. It fills the same settings the detailed controls below set by
// hand (a custom theme, its gradient, the design), so nothing new is stored
// and every detailed control still works afterwards. Nothing is saved until
// the page's Save.
const LOOKS = [
  { design: "panel", label: "Modern", hint: "Rounded cards, bold and clear", radius: 12 },
  { design: "editorial", label: "Academic", hint: "Serif headings, calm, like an exam paper", radius: 3, serif: true },
  { design: "soft", label: "Friendly", hint: "Soft and very rounded, for younger students", radius: 20 },
  { design: "depth", label: "Lifted", hint: "Cards float with a soft shadow", radius: 14, shadow: true },
  { design: "aurora", label: "Vivid", hint: "Gradient banner, glossy and bright", radius: 16, gradient: true },
  { design: "khata", label: "Notebook", hint: "Ruled paper, taped cards, handwriting", radius: 3, khata: true },
  { design: "sketch", label: "Sketch", hint: "Everything drawn in a rough pen line", radius: 12, sketch: true },
  { design: "swiss", label: "Poster", hint: "Heavy rules, tight bold type, uppercase labels", radius: 0, swiss: true },
];

function Phone({ p: base, look, gradient, name }) {
  const p = base;
  const r = look.radius;
  const ink = contrast(p.bg, "#FFFFFF") > contrast(p.bg, "#000000") ? p.text : "#14161A"; // dark page: light ink
  const hard = () => ({});
  const rough = look.sketch ? { border: `2px solid ${ink}`, borderRadius: "255px 15px 225px 15px / 15px 225px 15px 255px", boxShadow: "none" } : {};
  const paperCard = look.khata ? { border: "none", boxShadow: "0 4px 10px rgba(40,40,60,0.18)" } : {};
  const other = look.swiss ? { background: "transparent", border: "none", borderTop: `3px solid ${ink}`, padding: "6px 0" } : {};
  const card = { background: p.surface, border: look.shadow ? "none" : `1px solid ${p.border}`, borderRadius: r, padding: 8, boxShadow: look.shadow ? "0 4px 14px rgba(0,0,0,0.12)" : "none", ...hard(3), ...rough, ...paperCard, ...other };
  return (
    <div style={{ width: 150, height: 250, borderRadius: 18, border: "5px solid #1b1d22", background: look.khata ? `repeating-linear-gradient(180deg, transparent 0 13px, rgba(111,155,214,0.3) 13px 14px), ${p.bg}` : p.bg, overflow: "hidden", display: "flex", flexDirection: "column", fontFamily: look.serif ? "Georgia, serif" : look.khata || look.sketch ? '"Comic Sans MS", "Segoe Print", cursive' : look.swiss ? '"Inter Tight", Inter, sans-serif' : "Inter, system-ui, sans-serif", flex: "none" }}>
      <div style={{ padding: "8px 10px", fontSize: 11, fontWeight: 700, color: p.text, borderBottom: `1px solid ${p.border}` }}>{name || "Your academy"}</div>
      <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 7, flex: 1 }}>
        <div style={{ borderRadius: r, padding: 9, color: onColor(look.gradient ? gradient.from : p.accent), fontSize: 10, fontWeight: 700, background: look.gradient ? `linear-gradient(${gradient.angle}deg, ${gradient.from}, ${gradient.to})` : p.accent, ...hard(3) }}>
          Today's exam
          <div style={{ fontWeight: 400, opacity: 0.9, fontSize: 9 }}>Physics · 30 min</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: 10, fontWeight: 700, color: p.text }}>Chapter 3 practice</div>
          <div style={{ fontSize: 9, color: p.textMuted }}>12 of 40 done</div>
          <div style={{ height: 4, borderRadius: 4, background: p.surfaceAlt, marginTop: 5 }}><div style={{ width: "30%", height: "100%", borderRadius: 4, background: p.accent }} /></div>
        </div>
        <div style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 9, color: p.textMuted }}>Rank</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: p.accent }}>#4</span>
        </div>
        <div style={{ marginTop: "auto", textAlign: "center", borderRadius: Math.min(r, 10), padding: "6px 0", fontSize: 10, fontWeight: 700, background: p.accent, color: onColor(p.accent), ...hard(2) }}>Start exam</div>
      </div>
    </div>
  );
}

export default function QuickBrand({ studentUi, logo, siteName, onApply }) {
  const startColor = studentUi?.theme === "custom" ? studentUi?.customTheme?.light?.accent : null;
  const [color, setColor] = useState(startColor || "#2F6FDF");
  const [look, setLook] = useState(LOOKS.find((l) => l.design === studentUi?.design) || LOOKS[0]);
  const [fromLogo, setFromLogo] = useState([]);
  const [done, setDone] = useState(false);
  useEffect(() => { let on = true; logoColors(logo).then((c) => on && setFromLogo(c)); return () => { on = false; }; }, [logo]);
  const pal = useMemo(() => paletteFrom(color), [color]);

  const apply = () => {
    if (!pal) return;
    const current = studentUi?.customTheme || {};
    onApply({
      theme: "custom",
      customTheme: { ...current, light: pal.light, dark: pal.dark, gradient: { ...(current.gradient || {}), ...pal.gradient } },
      design: look.design,
    });
    setDone(true);
  };

  return (
    <div className="stack" style={{ gap: 10, padding: 12, border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface-2, var(--surface))" }}>
      <div className="row-tight" style={{ gap: 6 }}><Wand2 size={15} /><strong>Quick brand</strong></div>
      <p className="hint" style={{ margin: 0 }}>Pick your brand colour and a look. The full light and dark colours are made from it, kept readable. It replaces the theme (as Custom, below) and the design (under Screens); you can still fine-tune both there.</p>
      <div className="row" style={{ gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div className="stack" style={{ gap: 10, flex: "1 1 260px" }}>
          <div className="row-tight" style={{ gap: 8, flexWrap: "wrap" }}>
            <span className="label" style={{ margin: 0 }}>Brand colour</span>
            <input type="color" value={color} onChange={(e) => { setColor(e.target.value.toUpperCase()); setDone(false); }} />
            <input className="input" style={{ width: 96 }} value={color} maxLength={7} onChange={(e) => { setColor(e.target.value.toUpperCase()); setDone(false); }} />
          </div>
          {fromLogo.length > 0 && (
            <div className="row-tight" style={{ gap: 6, flexWrap: "wrap" }}>
              <span className="small muted">From your logo:</span>
              {fromLogo.map((c) => (
                <button key={c} type="button" title={c} onClick={() => { setColor(c); setDone(false); }}
                  style={{ width: 22, height: 22, borderRadius: "50%", background: c, cursor: "pointer", border: c === color ? "2px solid var(--text)" : "1px solid var(--border)" }} />
              ))}
            </div>
          )}
          {pal?.moved && <span className="small muted">Your colour is a little light to read on white, so buttons use a deeper shade ({pal.light.accent}).</span>}
          {!pal && <span className="small" style={{ color: "var(--danger, #c62828)" }}>Enter a colour like #2F6FDF.</span>}
          <div className="stack" style={{ gap: 6 }}>
            <span className="label" style={{ margin: 0 }}>Look</span>
            <div className="row-tight" style={{ gap: 6, flexWrap: "wrap" }}>
              {LOOKS.map((l) => (
                <button key={l.design} type="button" title={l.hint} className={`pill pill-btn${look.design === l.design ? " pill-on" : ""}`} onClick={() => { setLook(l); setDone(false); }}>{l.label}</button>
              ))}
            </div>
            <span className="small muted">{look.hint}</span>
          </div>
          <div className="row-tight" style={{ gap: 8 }}>
            <button type="button" className="btn btn-primary btn-sm" disabled={!pal} onClick={apply}>Use this</button>
            {done && <span className="small muted">Applied. Press Save to keep it.</span>}
          </div>
        </div>
        {pal && (
          <div className="row-tight" style={{ gap: 10 }}>
            <Phone p={pal.light} look={look} gradient={pal.gradient} name={siteName} />
            <Phone p={pal.dark} look={look} gradient={pal.gradient} name={siteName} />
          </div>
        )}
      </div>
    </div>
  );
}
