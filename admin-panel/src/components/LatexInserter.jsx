import { useState, useRef, useEffect } from "react";
import { Sigma, X, Check } from "lucide-react";
import Latex from "./Latex";

// Grouped rather than one long flat list — useful once this covers enough
// ground for math, physics and chemistry content, not just arithmetic.
// Each entry is a (before, after) pair: insertSnippet wraps whatever is
// selected in the formula input between the two, or — with nothing
// selected — inserts an empty template with the cursor landing between
// them, ready to type the next thing straight into the blank (a
// fraction's numerator, an exponent's power, a function's argument).
const SNIPPET_GROUPS = [
  {
    label: "Structure",
    items: [
      { label: "x²", before: "^{", after: "}", title: "Exponent / superscript" },
      { label: "xₙ", before: "_{", after: "}", title: "Subscript" },
      { label: "a⁄b", before: "\\frac{", after: "}{}", title: "Fraction" },
      { label: "√", before: "\\sqrt{", after: "}", title: "Square root" },
      { label: "ⁿ√", before: "\\sqrt[n]{", after: "}", title: "Nth root" },
      { label: "|x|", before: "|", after: "|", title: "Absolute value" },
      { label: "x̄", before: "\\overline{", after: "}", title: "Overline / average" },
      { label: "x⃗", before: "\\vec{", after: "}", title: "Vector" },
    ],
  },
  {
    label: "Calculus",
    items: [
      { label: "∑", before: "\\sum_{", after: "}^{}", title: "Summation" },
      { label: "∏", before: "\\prod_{", after: "}^{}", title: "Product" },
      { label: "∫", before: "\\int_{", after: "}^{}", title: "Integral" },
      { label: "∬", before: "\\iint_{", after: "}^{}", title: "Double integral" },
      { label: "lim", before: "\\lim_{", after: "}", title: "Limit" },
      { label: "d⁄dx", before: "\\frac{d}{dx}", after: "", title: "Derivative" },
      { label: "∂", before: "\\partial", after: "", title: "Partial derivative" },
      { label: "∇", before: "\\nabla", after: "", title: "Nabla / gradient" },
    ],
  },
  {
    label: "Functions",
    items: [
      { label: "sin", before: "\\sin(", after: ")", title: "Sine" },
      { label: "cos", before: "\\cos(", after: ")", title: "Cosine" },
      { label: "tan", before: "\\tan(", after: ")", title: "Tangent" },
      { label: "log", before: "\\log(", after: ")", title: "Log" },
      { label: "ln", before: "\\ln(", after: ")", title: "Natural log" },
    ],
  },
  {
    label: "Greek",
    items: [
      { label: "α", before: "\\alpha", after: "", title: "Alpha" },
      { label: "β", before: "\\beta", after: "", title: "Beta" },
      { label: "γ", before: "\\gamma", after: "", title: "Gamma" },
      { label: "Δ", before: "\\Delta", after: "", title: "Delta (capital)" },
      { label: "θ", before: "\\theta", after: "", title: "Theta" },
      { label: "λ", before: "\\lambda", after: "", title: "Lambda" },
      { label: "μ", before: "\\mu", after: "", title: "Mu" },
      { label: "π", before: "\\pi", after: "", title: "Pi" },
      { label: "ρ", before: "\\rho", after: "", title: "Rho" },
      { label: "σ", before: "\\sigma", after: "", title: "Sigma" },
      { label: "φ", before: "\\phi", after: "", title: "Phi" },
      { label: "ω", before: "\\omega", after: "", title: "Omega" },
      { label: "Ω", before: "\\Omega", after: "", title: "Omega (capital) / ohm" },
    ],
  },
  {
    label: "Relations",
    items: [
      { label: "≤", before: "\\leq", after: "", title: "Less than or equal" },
      { label: "≥", before: "\\geq", after: "", title: "Greater than or equal" },
      { label: "≠", before: "\\neq", after: "", title: "Not equal" },
      { label: "≈", before: "\\approx", after: "", title: "Approximately" },
      { label: "≡", before: "\\equiv", after: "", title: "Equivalent / identical" },
      { label: "×", before: "\\times", after: "", title: "Times" },
      { label: "÷", before: "\\div", after: "", title: "Divide" },
      { label: "±", before: "\\pm", after: "", title: "Plus or minus" },
      { label: "∓", before: "\\mp", after: "", title: "Minus or plus" },
      { label: "°", before: "^\\circ", after: "", title: "Degree" },
    ],
  },
  {
    label: "Sets & logic",
    items: [
      { label: "∈", before: "\\in", after: "", title: "Element of" },
      { label: "∉", before: "\\notin", after: "", title: "Not an element of" },
      { label: "⊂", before: "\\subset", after: "", title: "Subset" },
      { label: "∪", before: "\\cup", after: "", title: "Union" },
      { label: "∩", before: "\\cap", after: "", title: "Intersection" },
      { label: "∅", before: "\\emptyset", after: "", title: "Empty set" },
      { label: "∀", before: "\\forall", after: "", title: "For all" },
      { label: "∃", before: "\\exists", after: "", title: "There exists" },
    ],
  },
  {
    label: "Arrows & geometry",
    items: [
      { label: "→", before: "\\to", after: "", title: "Arrow / tends to" },
      { label: "⇌", before: "\\rightleftharpoons", after: "", title: "Reversible reaction" },
      { label: "∞", before: "\\infty", after: "", title: "Infinity" },
      { label: "∠", before: "\\angle", after: "", title: "Angle" },
      { label: "△", before: "\\triangle", after: "", title: "Triangle" },
      { label: "∥", before: "\\parallel", after: "", title: "Parallel" },
      { label: "⊥", before: "\\perp", after: "", title: "Perpendicular" },
      { label: "∴", before: "\\therefore", after: "", title: "Therefore" },
      { label: "∵", before: "\\because", after: "", title: "Because" },
    ],
  },
];

// Drop this next to any textarea that accepts LaTeX (a doubt answer, a
// batch or program description) — the app's own <Latex> component already
// renders $...$ and $$...$$ wherever that text is later shown, so building
// the equation here and letting this insert the delimited result is all
// that's needed; nothing downstream changes.
//
// The formula is built in a small, separate input rather than edited
// directly in the (often much larger) surrounding textarea. That sidesteps
// having to track and restore cursor position in the real textarea after
// every single symbol click — only the final "Insert" ever touches it,
// once, at the position the cursor was actually at when this was opened.
export default function LatexInserter({ textareaRef, value, onChange, label = "Insert equation" }) {
  const [open, setOpen] = useState(false);
  const [formula, setFormula] = useState("");
  const [block, setBlock] = useState(false);
  const formulaRef = useRef(null);
  const panelRef = useRef(null);
  const savedCursor = useRef({ start: 0, end: 0 });

  useEffect(() => {
    if (!open) return;
    const onClickAway = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickAway);
    return () => document.removeEventListener("mousedown", onClickAway);
  }, [open]);

  const openPanel = () => {
    const el = textareaRef.current;
    savedCursor.current = el
      ? { start: el.selectionStart, end: el.selectionEnd }
      : { start: value.length, end: value.length };
    setFormula("");
    setBlock(false);
    setOpen(true);
    // The formula input doesn't exist until this render commits.
    requestAnimationFrame(() => formulaRef.current?.focus());
  };

  const insertSnippet = (before, after) => {
    const el = formulaRef.current;
    const start = el?.selectionStart ?? formula.length;
    const end = el?.selectionEnd ?? formula.length;
    const selected = formula.slice(start, end);
    const next = formula.slice(0, start) + before + selected + after + formula.slice(end);
    setFormula(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = start + before.length + selected.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const confirmInsert = () => {
    const trimmed = formula.trim();
    if (!trimmed) { setOpen(false); return; }

    const wrapped = block ? `$$${trimmed}$$` : `$${trimmed}$`;
    const { start, end } = savedCursor.current;
    const next = value.slice(0, start) + wrapped + value.slice(end);
    onChange(next);
    setOpen(false);

    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const pos = start + wrapped.length;
      el.setSelectionRange(pos, pos);
    });
  };

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button type="button" className="btn btn-sm btn-quiet" onClick={openPanel}>
        <Sigma size={13} /> {label}
      </button>

      {open && (
        <div
          ref={panelRef}
          className="card stack"
          style={{
            position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 30,
            width: 360, boxShadow: "0 10px 28px rgba(0,0,0,0.35)",
          }}
        >
          <div className="spread">
            <span className="label">Build an equation</span>
            <button type="button" className="icon-btn" onClick={() => setOpen(false)}><X size={14} /></button>
          </div>

          <div className="stack" style={{ gap: 8, maxHeight: 220, overflowY: "auto", paddingRight: 2 }}>
            {SNIPPET_GROUPS.map((group) => (
              <div key={group.label}>
                <span className="hint" style={{ display: "block", marginBottom: 3 }}>{group.label}</span>
                <div className="row-tight" style={{ flexWrap: "wrap", gap: 4 }}>
                  {group.items.map((s) => (
                    <button
                      key={s.label}
                      type="button"
                      title={s.title}
                      className="btn btn-sm btn-quiet"
                      style={{ minWidth: 30, padding: "4px 8px" }}
                      onClick={() => insertSnippet(s.before, s.after)}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <textarea
            ref={formulaRef}
            className="textarea"
            rows={2}
            placeholder="\frac{a}{b} + \sqrt{x}"
            value={formula}
            onChange={(e) => setFormula(e.target.value)}
            style={{ fontFamily: "monospace", fontSize: 13 }}
          />

          <label className="row-tight small" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={block} onChange={(e) => setBlock(e.target.checked)} />
            On its own line (not inline with the text)
          </label>

          <div className="card-quiet" style={{ minHeight: 36, padding: 10, display: "flex", alignItems: "center" }}>
            {formula.trim() ? (
              <Latex>{block ? `$$${formula}$$` : `$${formula}$`}</Latex>
            ) : (
              <span className="hint">Preview appears here</span>
            )}
          </div>

          <button type="button" className="btn btn-sm btn-block" disabled={!formula.trim()} onClick={confirmInsert}>
            <Check size={13} /> Insert
          </button>
        </div>
      )}
    </div>
  );
}
