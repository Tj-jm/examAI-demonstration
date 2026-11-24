// Graphs and number lines on the video board (BoardPlayer.jsx), drawn as
// SVG that draws itself in. The same file lives in both apps (student-app
// and admin-panel components/BoardGraph.jsx); keep them identical.
//
// graph: { fns: [{ expr, label }], xRange, yRange, points: [{ x, y, label }] }
// numberline: { xRange, points: [{ x, label, open }], spans: [{ a, b }] }
// An expression is read by a small parser here (never eval): numbers, x,
// + - * / ^, brackets, pi, e and sqrt sin cos tan log ln exp abs.

const FUNCS = {
  sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, tan: Math.tan,
  log: Math.log10, ln: Math.log, exp: Math.exp, abs: Math.abs,
};
const NAMES = ["sqrt", "sin", "cos", "tan", "log", "ln", "exp", "abs", "pi", "x", "e"];

const tokens = (src) => {
  const s = String(src).toLowerCase().replace(/\*\*/g, "^").replace(/π/g, "pi").replace(/[−–]/g, "-").replace(/\s+/g, "");
  const out = [];
  let i = 0;
  while (i < s.length) {
    const num = /^\d*\.?\d+/.exec(s.slice(i));
    if (num) { out.push({ t: "n", v: Number(num[0]) }); i += num[0].length; continue; }
    const name = NAMES.find((n) => s.startsWith(n, i));
    if (name) { out.push({ t: "id", v: name }); i += name.length; continue; }
    if ("+-*/^()".includes(s[i])) { out.push({ t: s[i] }); i += 1; continue; }
    throw new Error("bad");
  }
  return out;
};

// expr: term (+|- term)*; term: unary ((*|/|implicit) unary)*;
// unary: -unary | power; power: primary (^ unary)?.
export const parseExpr = (src) => {
  const raw = String(src || "").replace(/^\s*(y|f\s*\(\s*x\s*\))\s*=/i, "");
  let tk;
  try { tk = tokens(raw); } catch { return null; }
  let p = 0;
  const peek = () => tk[p];
  const take = (t) => (tk[p]?.t === t ? tk[p++] : null);
  const primary = () => {
    const k = tk[p++];
    if (!k) throw new Error("end");
    if (k.t === "n") return () => k.v;
    if (k.t === "(") { const e = expr(); if (!take(")")) throw new Error(")"); return e; }
    if (k.t === "id") {
      if (k.v === "x") return (x) => x;
      if (k.v === "pi") return () => Math.PI;
      if (k.v === "e") return () => Math.E;
      const f = FUNCS[k.v];
      const arg = peek()?.t === "(" ? primary() : unary();
      return (x) => f(arg(x));
    }
    throw new Error("token");
  };
  // -x^2 is -(x^2); 2^-1 is a half.
  const unary = () => {
    if (take("-")) { const a = unary(); return (x) => -a(x); }
    if (take("+")) return unary();
    return power();
  };
  const power = () => {
    const a = primary();
    if (take("^")) { const b = unary(); return (x) => a(x) ** b(x); }
    return a;
  };
  const startsPrimary = (k) => k && (k.t === "n" || k.t === "id" || k.t === "(");
  const term = () => {
    let a = unary();
    for (;;) {
      if (take("*")) { const l = a; const r = unary(); a = (x) => l(x) * r(x); }
      else if (take("/")) { const l = a; const r = unary(); a = (x) => l(x) / r(x); }
      else if (startsPrimary(peek())) { const l = a; const r = power(); a = (x) => l(x) * r(x); }
      else return a;
    }
  };
  const expr = () => {
    let a = term();
    for (;;) {
      if (take("+")) { const l = a; const r = term(); a = (x) => l(x) + r(x); }
      else if (take("-")) { const l = a; const r = term(); a = (x) => l(x) - r(x); }
      else return a;
    }
  };
  try {
    const f = expr();
    return p === tk.length ? f : null;
  } catch {
    return null;
  }
};

// A tick step that gives about `want` ticks over the span.
const niceStep = (span, want = 8) => {
  const raw = span / want;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) || mag * 10;
};
const ticks = (a, b, want) => {
  const step = niceStep(b - a, want);
  const out = [];
  for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) out.push(Math.round(v / step) * step);
  return out.map((v) => Number(v.toFixed(6)));
};
const fmt = (v) => String(Number(v.toFixed(4)));

const COLORS = (accent) => [accent, "#d9623b", "#2e9d5b"];
const W = 400;
const H = 250;
const PAD = 26;

// Draws in once (fresh): each curve after the one before, then the points.
const drawIn = (fresh, delay, ms = 1400) => (fresh ? { strokeDasharray: 1, strokeDashoffset: 1, animation: `bp-draw ${ms}ms ease-in-out ${delay}ms forwards` } : null);
const popIn = (fresh, delay) => (fresh ? { opacity: 0, animation: `bp-fade 300ms ease-out ${delay}ms forwards` } : null);

export function GraphItem({ item, anim, glowStyle, self, accent, ink, fresh }) {
  const [x0, x1] = item.xRange?.length === 2 ? item.xRange : [-5, 5];
  const fns = (item.fns || []).map((f) => ({ ...f, f: parseExpr(f.expr) })).filter((f) => f.f);
  // Samples, and the y range: given, or from the curves and points.
  const N = 240;
  const samples = fns.map(({ f }) => Array.from({ length: N + 1 }, (_, i) => {
    const x = x0 + ((x1 - x0) * i) / N;
    let y;
    try { y = f(x); } catch { y = NaN; }
    return [x, Number.isFinite(y) ? y : NaN];
  }));
  let [y0, y1] = item.yRange?.length === 2 ? item.yRange : [Infinity, -Infinity];
  if (!(item.yRange?.length === 2)) {
    const ys = [...samples.flat().map((s) => s[1]), ...(item.points || []).map((p) => p.y)].filter(Number.isFinite).sort((a, b) => a - b);
    if (ys.length) {
      // Steep ends (tan, 1/x) don't flatten the rest.
      y0 = ys[Math.floor(ys.length * 0.03)];
      y1 = ys[Math.ceil(ys.length * 0.97) - 1];
    }
    if (!Number.isFinite(y0) || !Number.isFinite(y1)) { y0 = -5; y1 = 5; }
    if (y1 - y0 < 1e-6) { y0 -= 1; y1 += 1; }
    const m = (y1 - y0) * 0.1;
    y0 -= m; y1 += m;
  }
  const X = (x) => PAD + ((x - x0) / (x1 - x0)) * (W - PAD * 2);
  const Y = (y) => H - PAD - ((y - y0) / (y1 - y0)) * (H - PAD * 2);
  const inY = (y) => y >= y0 - (y1 - y0) && y <= y1 + (y1 - y0);
  const paths = samples.map((pts) => {
    let d = "";
    let pen = false;
    let prev = null;
    for (const [x, y] of pts) {
      // A break: no value, far off the board, or a jump (an asymptote).
      if (!Number.isFinite(y) || !inY(y) || (prev !== null && Math.abs(y - prev) > (y1 - y0) * 0.8)) { pen = false; prev = Number.isFinite(y) ? y : null; continue; }
      d += `${pen ? "L" : "M"}${X(x).toFixed(1)} ${Y(Math.min(y1 + (y1 - y0), Math.max(y0 - (y1 - y0), y))).toFixed(1)}`;
      pen = true;
      prev = y;
    }
    return d;
  });
  const colors = COLORS(accent);
  const ax = Math.min(Math.max(0, y0), y1); // the x axis' height
  const ay = Math.min(Math.max(0, x0), x1); // the y axis' place
  const xt = ticks(x0, x1, 8);
  const yt = ticks(y0, y1, 6);
  const curveMs = 1400;
  const after = fns.length * 500 + curveMs;
  return (
    <figure style={{ ...anim, ...glowStyle, alignSelf: self, margin: "0.3em 0", maxWidth: "100%" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ height: "9em", maxWidth: "100%", display: "block", overflow: "visible" }}>
        <g stroke={ink} strokeOpacity="0.12" strokeWidth="1">
          {xt.map((v) => <line key={`gx${v}`} x1={X(v)} x2={X(v)} y1={PAD} y2={H - PAD} />)}
          {yt.map((v) => <line key={`gy${v}`} y1={Y(v)} y2={Y(v)} x1={PAD} x2={W - PAD} />)}
        </g>
        <g stroke={ink} strokeOpacity="0.7" strokeWidth="1.4">
          <line x1={PAD - 6} x2={W - PAD + 8} y1={Y(ax)} y2={Y(ax)} />
          <line y1={H - PAD + 6} y2={PAD - 8} x1={X(ay)} x2={X(ay)} />
        </g>
        <g fill={ink} fillOpacity="0.75" fontSize="13" fontFamily="Inter, system-ui, sans-serif">
          {xt.filter((v) => Math.abs(v - ay) > 1e-9).map((v) => <text key={`tx${v}`} x={X(v)} y={Y(ax) + 16} textAnchor="middle">{fmt(v)}</text>)}
          {yt.filter((v) => Math.abs(v - ax) > 1e-9).map((v) => <text key={`ty${v}`} x={X(ay) - 5} y={Y(v) + 4.5} textAnchor="end">{fmt(v)}</text>)}
          <text x={W - PAD + 10} y={Y(ax) + 4} fontStyle="italic" fontSize="15">x</text>
          <text x={X(ay) + 5} y={PAD - 10} fontStyle="italic" fontSize="15">y</text>
        </g>
        {paths.map((d, i) => (d ? <path key={i} d={d} pathLength="1" fill="none" stroke={colors[i]} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={drawIn(fresh, 250 + i * 500, curveMs)} /> : null))}
        {fns.map((f, i) => {
          if (!f.label) return null;
          // Its label near where the curve leaves the board on the right.
          const last = [...samples[i]].reverse().find(([, y]) => Number.isFinite(y) && y >= y0 && y <= y1);
          if (!last) return null;
          return <text key={`l${i}`} x={Math.min(W - 4, X(last[0]) - 4)} y={Math.max(12, Y(last[1]) - 8)} textAnchor="end" fill={colors[i]} fontSize="15" fontWeight="600" fontFamily="Inter, system-ui, sans-serif" style={popIn(fresh, 250 + i * 500 + curveMs)}>{f.label}</text>;
        })}
        {(item.points || []).filter((p) => Number.isFinite(p.y)).map((p, i) => (
          <g key={`p${i}`} style={popIn(fresh, after + i * 250)}>
            <circle cx={X(p.x)} cy={Y(p.y)} r="4.5" fill={colors[0]} stroke="#fff" strokeWidth="1.5" />
            {p.label && <text x={X(p.x) + 7} y={Y(p.y) - 7} fill={ink} fontSize="14" fontWeight="600" fontFamily="Inter, system-ui, sans-serif">{p.label}</text>}
          </g>
        ))}
      </svg>
      {item.caption && <figcaption style={{ fontSize: "0.7em", opacity: 0.75, marginTop: "0.25em" }}>{item.caption}</figcaption>}
    </figure>
  );
}

export function NumberLineItem({ item, anim, glowStyle, self, accent, ink, board, fresh }) {
  const [a, b] = item.xRange?.length === 2 ? item.xRange : [-5, 5];
  const w = 400;
  const h = 64;
  const pad = 20;
  const X = (x) => pad + ((Math.min(b, Math.max(a, x)) - a) / (b - a)) * (w - pad * 2);
  const y = 28;
  const ts = ticks(a, b, 10);
  return (
    <figure style={{ ...anim, ...glowStyle, alignSelf: self, margin: "0.3em 0", maxWidth: "100%" }}>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ height: "3.6em", maxWidth: "100%", display: "block", overflow: "visible" }}>
        <g stroke={ink} strokeOpacity="0.75" strokeWidth="1.6" fill="none">
          <line x1={pad - 12} x2={w - pad + 12} y1={y} y2={y} />
          <path d={`M${pad - 6} ${y - 5}L${pad - 12} ${y}L${pad - 6} ${y + 5}M${w - pad + 6} ${y - 5}L${w - pad + 12} ${y}L${w - pad + 6} ${y + 5}`} />
          {ts.map((v) => <line key={v} x1={X(v)} x2={X(v)} y1={y - 5} y2={y + 5} />)}
        </g>
        <g fill={ink} fillOpacity="0.75" fontSize="11" fontFamily="Inter, system-ui, sans-serif" textAnchor="middle">
          {ts.map((v) => <text key={v} x={X(v)} y={y + 19}>{fmt(v)}</text>)}
        </g>
        {(item.spans || []).map((s, i) => (
          <line key={`s${i}`} x1={X(Math.min(s.a, s.b))} x2={X(Math.max(s.a, s.b))} y1={y} y2={y} pathLength="1" stroke={accent} strokeWidth="6" strokeOpacity="0.75" strokeLinecap="round" style={drawIn(fresh, 300 + i * 400, 900)} />
        ))}
        {(item.points || []).map((p, i) => (
          <g key={`p${i}`} style={popIn(fresh, 200 + i * 200)}>
            <circle cx={X(p.x)} cy={y} r="5.5" fill={p.open ? board : accent} stroke={accent} strokeWidth="2.2" />
            {p.label && <text x={X(p.x)} y={y - 11} textAnchor="middle" fill={accent} fontSize="12" fontWeight="700" fontFamily="Inter, system-ui, sans-serif">{p.label}</text>}
          </g>
        ))}
      </svg>
      {item.caption && <figcaption style={{ fontSize: "0.7em", opacity: 0.75, marginTop: "0.25em" }}>{item.caption}</figcaption>}
    </figure>
  );
}
