import { useCallback, useEffect, useRef, useState } from "react";
import { Box, ButtonBase, IconButton, Paper, Typography, Fab } from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { useLocation } from "react-router-dom";
import { Calculator, X, GripHorizontal } from "lucide-react";
import { evaluate, format } from "./evaluate";
import { useCalculatorWanted } from "./useCalculator";
import { tapFeedback } from "../../native/haptics";

// The on-screen scientific calculator: a small button in the bottom-left
// corner opens a panel that can be dragged anywhere. It floats over
// dialogs too (the drawing pad included). Pages switch it on with
// useCalculator(); the exam page only when the exam allows it.

const store = {
  get(key, fallback) { try { const v = localStorage.getItem(`examai.calc.${key}`); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(`examai.calc.${key}`, JSON.stringify(value)); } catch { /* private mode */ } },
};

// Multi-letter pieces that ⌫ removes whole.
const PIECES = ["asin(", "acos(", "atan(", "sin(", "cos(", "tan(", "log(", "ln(", "cbrt(", "√(", "10^(", "e^(", "ANS"];

const KEYS = [
  [{ k: "2nd" }, { k: "deg" }, { k: "(", ins: "(" }, { k: ")", ins: ")" }, { k: "⌫", act: "del" }],
  [{ k: "sin", ins: "sin(", alt: ["sin⁻¹", "asin("] }, { k: "cos", ins: "cos(", alt: ["cos⁻¹", "acos("] }, { k: "tan", ins: "tan(", alt: ["tan⁻¹", "atan("] }, { k: "π", ins: "π" }, { k: "AC", act: "clear" }],
  [{ k: "log", ins: "log(", alt: ["10ˣ", "10^("] }, { k: "ln", ins: "ln(", alt: ["eˣ", "e^("] }, { k: "√", ins: "√(", alt: ["∛", "cbrt("] }, { k: "x²", ins: "^2", alt: ["x³", "^3"] }, { k: "xʸ", ins: "^" }],
  [{ k: "7", ins: "7" }, { k: "8", ins: "8" }, { k: "9", ins: "9" }, { k: "÷", ins: "÷", op: true }, { k: "n!", ins: "!" }],
  [{ k: "4", ins: "4" }, { k: "5", ins: "5" }, { k: "6", ins: "6" }, { k: "×", ins: "×", op: true }, { k: "ANS", ins: "ANS" }],
  [{ k: "1", ins: "1" }, { k: "2", ins: "2" }, { k: "3", ins: "3" }, { k: "−", ins: "-", op: true }, { k: "e", ins: "e" }],
  [{ k: "0", ins: "0" }, { k: ".", ins: "." }, { k: "EXP", ins: "E" }, { k: "+", ins: "+", op: true }, { k: "=", act: "eq" }],
];

const PANEL_W = 288;

export default function CalculatorHost() {
  const wanted = useCalculatorWanted();
  const theme = useTheme();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [expr, setExpr] = useState("");
  const [shown, setShown] = useState(null); // the last = result, until the next key
  const [ans, setAns] = useState(() => store.get("ans", 0));
  const [deg, setDeg] = useState(() => store.get("deg", true));
  const [second, setSecond] = useState(false);
  const [history, setHistory] = useState(() => store.get("history", []));
  const [error, setError] = useState("");
  const [pos, setPos] = useState(() => store.get("pos", null));
  const [navH, setNavH] = useState(0);
  const drag = useRef(null);
  const panel = useRef(null);

  // Clear of the bottom tab bar where there is one.
  useEffect(() => {
    const el = document.querySelector("[data-bottom-nav]");
    setNavH(el ? el.offsetHeight : 0);
  }, [location.pathname, wanted]);

  useEffect(() => { if (!wanted) setOpen(false); }, [wanted]);

  const press = useCallback((key) => {
    tapFeedback();
    setError("");
    if (key.k === "2nd") { setSecond((v) => !v); return; }
    if (key.k === "deg") { setDeg((v) => { store.set("deg", !v); return !v; }); return; }
    if (key.act === "clear") { setExpr(""); setShown(null); return; }
    if (key.act === "del") {
      setShown(null);
      setExpr((e) => { const piece = PIECES.find((p) => e.endsWith(p)); return piece ? e.slice(0, -piece.length) : e.slice(0, -1); });
      return;
    }
    if (key.act === "eq") {
      if (!expr) return;
      try {
        const v = evaluate(expr, { deg, ans });
        if (v === null) return;
        setAns(v); store.set("ans", v);
        setShown(v);
        setHistory((h) => { const next = [{ expr, v }, ...h].slice(0, 5); store.set("history", next); return next; });
        setExpr(format(v));
      } catch (e) {
        setError(e.message || "Check the expression");
      }
      return;
    }
    const ins = second && key.alt ? key.alt[1] : key.ins;
    if (second && key.alt) setSecond(false);
    setExpr((e) => {
      // A power, ! or % on a lone negative number (typed, or the answer
      // carried on after =) applies to the whole number: -4 then x² is
      // (-4)² = 16, as on a phone calculator. Written -4^2 stays -16.
      const post = ins.startsWith("^") || ins === "!" || ins === "%";
      const wrap = (x) => (post && /^-[\d.]+(E[+-]?\d+)?$/.test(x) ? `(${x})` : x);
      // After =, an operator carries on from the answer; anything else starts afresh.
      if (shown !== null) return (key.op || post ? wrap(e) : "") + ins;
      return (key.k === "x²" || key.k === "xʸ" || (second && key.alt) ? wrap(e) : e) + ins;
    });
    setShown(null);
  }, [expr, deg, ans, second, shown]);

  // A physical keyboard, while the panel is open and no text field is focused.
  useEffect(() => {
    if (!open) return undefined;
    const map = { "*": "×", "/": "÷", x: "×" };
    const onKey = (ev) => {
      const t = ev.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (ev.key === "Enter" || ev.key === "=") { ev.preventDefault(); press({ act: "eq" }); }
      else if (ev.key === "Backspace") { ev.preventDefault(); press({ act: "del" }); }
      else if (ev.key === "Escape") setOpen(false);
      else if (/^[0-9.+\-^()!%]$/.test(ev.key) || map[ev.key]) {
        ev.preventDefault();
        const ins = map[ev.key] || ev.key;
        press({ k: ins, ins, op: "+-×÷".includes(ins) });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, press]);

  const clamp = (x, y) => {
    const w = panel.current?.offsetWidth || PANEL_W;
    const h = panel.current?.offsetHeight || 420;
    return { x: Math.min(Math.max(8, x), window.innerWidth - w - 8), y: Math.min(Math.max(8, y), window.innerHeight - h - 8) };
  };
  const onDragStart = (ev) => {
    const rect = panel.current.getBoundingClientRect();
    drag.current = { dx: ev.clientX - rect.left, dy: ev.clientY - rect.top };
    ev.currentTarget.setPointerCapture(ev.pointerId);
  };
  const onDragMove = (ev) => {
    if (!drag.current) return;
    setPos(clamp(ev.clientX - drag.current.dx, ev.clientY - drag.current.dy));
  };
  const onDragEnd = () => {
    if (!drag.current) return;
    drag.current = null;
    setPos((p) => { store.set("pos", p); return p; });
  };
  // A remembered spot that no longer fits (rotated phone) is pulled back in.
  useEffect(() => { if (open && pos) setPos((p) => clamp(p.x, p.y)); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!wanted) return null;

  let preview = "";
  if (shown === null && expr) {
    try { const v = evaluate(expr, { deg, ans }); preview = v === null ? "" : format(v); } catch { preview = ""; }
  }
  const bottom = `calc(${navH + 16}px + env(safe-area-inset-bottom, 0px))`;
  const keyColor = (key) => {
    if (key.act === "eq") return { bgcolor: "primary.main", color: "primary.contrastText", "&:hover": { bgcolor: "primary.dark" } };
    if (key.op || key.act) return { bgcolor: alpha(theme.palette.primary.main, 0.12), color: "primary.main" };
    if (/^\d$|^\.$/.test(key.k)) return { bgcolor: "action.hover", color: "text.primary" };
    return { bgcolor: "transparent", color: "text.primary", border: 1, borderColor: "divider" };
  };

  return (
    <>
      {!open && (
        <Fab
          size="small"
          color="default"
          aria-label="Open calculator"
          onClick={() => setOpen(true)}
          sx={{ position: "fixed", left: 16, bottom, zIndex: 1500, bgcolor: "background.paper", color: "primary.main", boxShadow: 4 }}
        >
          <Calculator size={20} />
        </Fab>
      )}
      {open && (
        <Paper
          ref={panel}
          elevation={10}
          role="dialog"
          aria-label="Calculator"
          onPointerDown={(e) => { if (e.target.closest("button")) e.preventDefault(); }}
          sx={{
            position: "fixed", zIndex: 1500, width: `min(${PANEL_W}px, calc(100vw - 16px))`, borderRadius: 3, overflow: "hidden",
            userSelect: "none", WebkitUserSelect: "none", touchAction: "manipulation",
            ...(pos ? { left: pos.x, top: pos.y } : { left: 8, bottom }),
          }}
        >
          <Box
            onPointerDown={onDragStart}
            onPointerMove={onDragMove}
            onPointerUp={onDragEnd}
            onPointerCancel={onDragEnd}
            sx={{ display: "flex", alignItems: "center", px: 1, py: 0.25, cursor: "grab", touchAction: "none", bgcolor: "action.hover" }}
          >
            <GripHorizontal size={16} style={{ opacity: 0.5 }} />
            <Typography variant="caption" sx={{ ml: 0.75, flex: 1, fontWeight: 600 }}>Calculator</Typography>
            <IconButton size="small" aria-label="Close calculator" onPointerDown={(e) => e.stopPropagation()} onClick={() => setOpen(false)}><X size={16} /></IconButton>
          </Box>

          <Box sx={{ px: 1.5, pt: 1, pb: 0.5, textAlign: "right" }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", minHeight: 18, whiteSpace: "nowrap", overflowX: "auto" }}>
              {deg ? "DEG" : "RAD"}{second ? " · 2nd" : ""}{history[0] && shown !== null ? ` · ${history[0].expr} =` : ""}
            </Typography>
            <Typography sx={{ fontSize: 24, fontWeight: 500, minHeight: 34, whiteSpace: "nowrap", overflowX: "auto", fontVariantNumeric: "tabular-nums" }}>
              {expr || "0"}
            </Typography>
            <Typography variant="body2" sx={{ minHeight: 20, color: error ? "error.main" : "text.secondary" }}>
              {error || (preview && preview !== expr ? `= ${preview}` : "")}
            </Typography>
          </Box>

          {history.length > 0 && (
            <Box sx={{ display: "flex", gap: 0.5, px: 1, pb: 0.5, overflowX: "auto" }}>
              {history.slice(0, 4).map((h, i) => (
                <ButtonBase
                  key={`${h.expr}-${i}`}
                  onClick={() => { tapFeedback(); setError(""); setExpr((e) => (shown !== null ? "" : e) + format(h.v)); setShown(null); }}
                  sx={{ px: 1, py: 0.25, borderRadius: 2, fontSize: 12, bgcolor: "action.hover", whiteSpace: "nowrap" }}
                  title={`${h.expr} = ${format(h.v)}`}
                >
                  {format(h.v)}
                </ButtonBase>
              ))}
            </Box>
          )}

          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 0.5, p: 1, pt: 0.5 }}>
            {KEYS.flat().map((key) => {
              const label = key.k === "deg" ? (deg ? "DEG" : "RAD") : second && key.alt ? key.alt[0] : key.k;
              const active = key.k === "2nd" && second;
              // The other function sits printed small above the key, as on a
              // handheld, so sin⁻¹ and friends are visible before 2nd is pressed.
              const other = key.alt ? (second ? key.k : key.alt[0]) : null;
              return (
                <ButtonBase
                  key={key.k}
                  onClick={() => press(key)}
                  aria-label={label}
                  sx={{
                    height: 40, borderRadius: 2, fontSize: /^\d$/.test(key.k) ? 17 : 14, fontWeight: 500,
                    flexDirection: "column", lineHeight: 1.1,
                    ...keyColor(key),
                    ...(active ? { bgcolor: "primary.main", color: "primary.contrastText" } : {}),
                  }}
                >
                  {other && <Box component="span" aria-hidden sx={{ fontSize: 10, color: second ? "text.secondary" : "primary.main" }}>{other}</Box>}
                  {label}
                </ButtonBase>
              );
            })}
          </Box>
        </Paper>
      )}
    </>
  );
}
