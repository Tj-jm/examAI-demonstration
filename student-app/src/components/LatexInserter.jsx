import { useState, useRef } from "react";
import { Box, Popover, Paper, Typography, TextField, Button, IconButton, Checkbox, FormControlLabel } from "@mui/material";
import { Sigma, X, Check } from "lucide-react";
import Latex from "./Latex";

// Same snippet set as the admin panel's LatexInserter (admin-panel/src/
// components/LatexInserter.jsx) — kept as a straight port rather than a
// shared package, since the two apps don't share a component build step.
// Each entry is a (before, after) pair: insertSnippet wraps whatever is
// selected in the formula input between the two, or — with nothing
// selected — inserts an empty template with the cursor landing between
// them, ready to type straight into the blank.
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

// Drop this next to any TextField a student types a written answer into
// (an exam's written question, a practice exam, a topic-drill written
// question) — the app's own <Latex> component already renders $...$ and
// $$...$$ wherever that answer is shown back (in review, in a grading
// screen), so building the equation here and inserting the delimited
// result is all that's needed; nothing downstream changes.
//
// `inputRef` must point at the underlying <textarea> DOM node, not the
// MUI TextField's root — pass MUI's own `inputRef` prop through from the
// caller's TextField (`inputRef={writtenRef}`), not `ref`.
//
// The formula is built in its own small input rather than edited directly
// in the (often much larger) answer box — that sidesteps having to track
// and restore cursor position in the real textarea after every symbol
// click; only the final "Insert" touches it, once, at the position the
// cursor was actually at when this opened.
export default function LatexInserter({ inputRef, value, onChange, label = "Insert equation" }) {
  const [anchorEl, setAnchorEl] = useState(null);
  const [formula, setFormula] = useState("");
  const [block, setBlock] = useState(false);
  const formulaRef = useRef(null);
  const savedCursor = useRef({ start: 0, end: 0 });

  const open = Boolean(anchorEl);

  const openPanel = (e) => {
    const el = inputRef?.current;
    savedCursor.current = el
      ? { start: el.selectionStart, end: el.selectionEnd }
      : { start: (value || "").length, end: (value || "").length };
    setFormula("");
    setBlock(false);
    setAnchorEl(e.currentTarget);
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
    if (!trimmed) { setAnchorEl(null); return; }

    const wrapped = block ? `$$${trimmed}$$` : `$${trimmed}$`;
    const { start, end } = savedCursor.current;
    const current = value || "";
    const next = current.slice(0, start) + wrapped + current.slice(end);
    onChange(next);
    setAnchorEl(null);

    requestAnimationFrame(() => {
      const el = inputRef?.current;
      if (!el) return;
      el.focus();
      const pos = start + wrapped.length;
      el.setSelectionRange(pos, pos);
    });
  };

  return (
    <>
      <Button size="small" variant="text" startIcon={<Sigma size={14} />} onClick={openPanel}>
        {label}
      </Button>

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      >
        <Paper sx={{ p: 1.5, width: 340, display: "flex", flexDirection: "column", gap: 1.25 }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <Typography variant="body2" sx={{ fontWeight: 500 }}>Build an equation</Typography>
            <IconButton size="small" onClick={() => setAnchorEl(null)}><X size={14} /></IconButton>
          </Box>

          <Box sx={{ display: "flex", flexDirection: "column", gap: 1, maxHeight: 220, overflowY: "auto", pr: 0.5 }}>
            {SNIPPET_GROUPS.map((group) => (
              <Box key={group.label}>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
                  {group.label}
                </Typography>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                  {group.items.map((s) => (
                    <Button
                      key={s.label}
                      size="small"
                      variant="outlined"
                      title={s.title}
                      sx={{ minWidth: 30, px: 1, py: 0.25, fontSize: 13 }}
                      onClick={() => insertSnippet(s.before, s.after)}
                    >
                      {s.label}
                    </Button>
                  ))}
                </Box>
              </Box>
            ))}
          </Box>

          <TextField
            inputRef={formulaRef}
            multiline
            minRows={2}
            size="small"
            placeholder="\frac{a}{b} + \sqrt{x}"
            value={formula}
            onChange={(e) => setFormula(e.target.value)}
            sx={{ "& textarea": { fontFamily: "monospace", fontSize: 13 } }}
          />

          <FormControlLabel
            sx={{ ml: 0 }}
            control={<Checkbox size="small" checked={block} onChange={(e) => setBlock(e.target.checked)} />}
            label={<Typography variant="caption">On its own line (not inline with the text)</Typography>}
          />

          <Paper variant="outlined" sx={{ minHeight: 36, p: 1, display: "flex", alignItems: "center", bgcolor: "action.hover" }}>
            {formula.trim() ? (
              <Latex>{block ? `$$${formula}$$` : `$${formula}$`}</Latex>
            ) : (
              <Typography variant="caption" color="text.secondary">Preview appears here</Typography>
            )}
          </Paper>

          <Button size="small" variant="contained" fullWidth startIcon={<Check size={14} />} disabled={!formula.trim()} onClick={confirmInsert}>
            Insert
          </Button>
        </Paper>
      </Popover>
    </>
  );
}
