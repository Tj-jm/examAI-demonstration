import { Check } from "lucide-react";

// Settings → SEO → Course pages: the three designs of the public course
// page (student app components/coursePage/CourseDesigns.jsx), each drawn as
// a small sketch so the choice is visual.

const DESIGNS = [
  ["spotlight", "Spotlight", "A bold coloured hero with the cover and price, then big sections. Like a product launch."],
  ["magazine", "Magazine", "A full-width cover with the title over it, an article, and a sticky enrol card. Calm and editorial."],
  ["split", "Split", "A coloured panel with the essentials stays on the left; details in tabs on the right. Like an app."],
];

const P = "var(--primary)";
const S = "var(--surface-alt, rgba(128,128,128,0.18))";
const L = "var(--border, rgba(128,128,128,0.35))";

function Sketch({ kind }) {
  if (kind === "spotlight") {
    return (
      <svg viewBox="0 0 160 100" width="100%" style={{ display: "block" }} aria-hidden>
        <rect width="160" height="48" fill={P} />
        <rect x="10" y="12" width="52" height="7" rx="2" fill="#fff" opacity="0.95" />
        <rect x="10" y="23" width="38" height="4" rx="2" fill="#fff" opacity="0.6" />
        <rect x="10" y="33" width="24" height="8" rx="4" fill="#fff" />
        <rect x="88" y="9" width="62" height="34" rx="4" fill="#fff" opacity="0.35" transform="rotate(2 119 26)" />
        <rect x="80" y="38" width="30" height="10" rx="3" fill="#fff" stroke={L} />
        <rect x="10" y="58" width="40" height="5" rx="2" fill={L} />
        {[0, 1, 2, 3].map((i) => <rect key={i} x={10 + (i % 2) * 72} y={68 + Math.floor(i / 2) * 12} width="64" height="8" rx="2" fill={S} />)}
      </svg>
    );
  }
  if (kind === "magazine") {
    return (
      <svg viewBox="0 0 160 100" width="100%" style={{ display: "block" }} aria-hidden>
        <rect width="160" height="44" fill={S} />
        <rect width="160" height="44" fill="url(#mg)" />
        <defs><linearGradient id="mg" x1="0" y1="0" x2="0" y2="1"><stop offset="0.3" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity="0.55" /></linearGradient></defs>
        <rect x="10" y="28" width="70" height="8" rx="2" fill="#fff" />
        <rect x="10" y="52" width="3" height="14" fill={P} />
        <rect x="17" y="53" width="80" height="4" rx="2" fill={L} />
        <rect x="17" y="61" width="66" height="4" rx="2" fill={L} />
        {[0, 1, 2].map((i) => <rect key={i} x="10" y={73 + i * 8} width={90 - i * 12} height="4" rx="2" fill={S} />)}
        <rect x="110" y="50" width="42" height="44" rx="4" fill="none" stroke={L} />
        <rect x="116" y="57" width="26" height="6" rx="2" fill={L} />
        <rect x="116" y="80" width="30" height="8" rx="3" fill={P} />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 160 100" width="100%" style={{ display: "block" }} aria-hidden>
      <rect width="62" height="100" fill={P} />
      <rect width="62" height="34" fill="#fff" opacity="0.3" />
      <rect x="8" y="42" width="44" height="7" rx="2" fill="#fff" />
      {[0, 1, 2].map((i) => <rect key={i} x={8 + i * 16} y="55" width="13" height="14" rx="2" fill="#fff" opacity="0.3" />)}
      <rect x="8" y="82" width="46" height="9" rx="4" fill="#fff" />
      {[0, 1, 2].map((i) => <rect key={i} x={72 + i * 22} y="10" width="18" height="5" rx="2" fill={i === 0 ? P : L} />)}
      <rect x="72" y="18" width="80" height="1" fill={L} />
      {[0, 1, 2, 3].map((i) => <rect key={i} x="72" y={28 + i * 12} width={78 - (i % 2) * 18} height="6" rx="2" fill={S} />)}
    </svg>
  );
}

export default function CourseDesignPicker({ value, onChange }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
      {DESIGNS.map(([key, label, text]) => {
        const on = (value || "spotlight") === key;
        return (
          <button key={key} type="button" onClick={() => onChange(key)} className="card-quiet stack"
            style={{ gap: 8, padding: 10, textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit", border: `2px solid ${on ? "var(--primary)" : "transparent"}`, borderRadius: 10 }}>
            <div style={{ borderRadius: 6, overflow: "hidden", border: "1px solid var(--border)" }}><Sketch kind={key} /></div>
            <div className="row-tight" style={{ gap: 6 }}>
              <strong>{label}</strong>
              {on && <Check size={14} style={{ color: "var(--primary)" }} />}
            </div>
            <span className="small muted">{text}</span>
          </button>
        );
      })}
    </div>
  );
}
