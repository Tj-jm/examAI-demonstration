import { useEffect, useRef, useState } from "react";
import { Box, Typography } from "@mui/material";
import { useTheme, alpha } from "@mui/material/styles";
import { keyframes } from "@emotion/react";
import { animate, animateBig, popIn, fadeIn } from "../../motion";

const draw = keyframes`from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; }`;
const rise = keyframes`from { transform: scaleY(0); } to { transform: scaleY(1); }`;
const appear = keyframes`from { opacity: 0; } to { opacity: 1; }`;

// The charts on "My progress", drawn as plain SVG in the theme's own
// colours: "you" is always the primary colour, "batch" always a quiet grey,
// so the two read the same on every chart, in every theme, light or dark.

export const useChartColors = () => {
  const theme = useTheme();
  const p = theme.palette;
  return {
    you: p.primary.main,
    batch: alpha(p.text.primary, p.mode === "dark" ? 0.5 : 0.42),
    grid: alpha(p.text.primary, 0.1),
    surface: p.background.paper,
    text: p.text.primary,
    muted: p.text.secondary,
    font: theme.typography.fontFamily,
  };
};

// Width of a box, kept up to date, so a chart draws at real pixels and
// its text never stretches.
export function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

export function Tip({ x, y, children, width }) {
  if (x === null || x === undefined) return null;
  const left = Math.max(0, Math.min(x - 80, (width || 0) - 160));
  return (
    <Box sx={{
      position: "absolute", left, top: Math.max(0, y - 8), transform: "translateY(-100%)", width: 160, pointerEvents: "none", zIndex: 2,
      bgcolor: "background.paper", border: 1, borderColor: "divider", borderRadius: 1.5, boxShadow: 3, px: 1.25, py: 0.75,
      ...animate(fadeIn, 120),
    }}>
      {children}
    </Box>
  );
}

const TipRow = ({ color, label, value }) => (
  <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, fontSize: 12 }}>
    {color && <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: color, flexShrink: 0 }} />}
    <Typography component="span" sx={{ fontSize: 12, color: "text.secondary", flex: 1 }}>{label}</Typography>
    <Typography component="span" sx={{ fontSize: 12, fontWeight: 600 }}>{value}</Typography>
  </Box>
);

export function Legend({ items }) {
  return (
    <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
      {items.map((it) => (
        <Box key={it.label} sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
          <Box sx={{ width: 14, height: 3, borderRadius: 2, bgcolor: it.color }} />
          <Typography variant="caption" color="text.secondary">{it.label}</Typography>
        </Box>
      ))}
    </Box>
  );
}

// ---------------------------------------------------------------- skills

const SHORT = {
  recall: "Recall", comprehension: "Understanding", application: "Application",
  analysis: "Analysis", problemSolving: "Solving", misconception: "Traps",
};

export function SkillRadar({ skills }) {
  const c = useChartColors();
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const size = Math.min(width, 380);
  const cx = size / 2;
  // Room either side for the axis names.
  const r = Math.max(40, Math.min(size * 0.3, cx - 84));
  const h = r * 2.3 + 56;
  const cy = h / 2 + 2;
  const n = skills.length;
  const at = (i, v) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [cx + Math.cos(a) * r * (v / 100), cy + Math.sin(a) * r * (v / 100)];
  };
  const poly = (key) => skills.map((s, i) => at(i, s[key] ?? 0).join(",")).join(" ");
  const hasBatch = skills.some((s) => s.batch !== null);
  const active = hover !== null ? skills[hover] : null;
  const [hx, hy] = hover !== null ? at(hover, active.you ?? 0) : [null, null];

  return (
    <Box ref={ref} sx={{ position: "relative", width: "100%", display: "flex", justifyContent: "center", "& .grow": animate(popIn, 600) }}>
      {width > 0 && (
        <svg width={size} height={h} role="img" aria-label="Skill map: your accuracy in each skill, against the batch" onMouseLeave={() => setHover(null)}>
          {[25, 50, 75, 100].map((ring) => (
            <polygon key={ring} points={skills.map((_, i) => at(i, ring).join(",")).join(" ")} fill="none" stroke={c.grid} strokeWidth={1} />
          ))}
          {skills.map((s, i) => {
            const [x, y] = at(i, 100);
            const [lx, ly] = at(i, 115);
            const anchor = Math.abs(lx - cx) < 4 ? "middle" : lx > cx ? "start" : "end";
            return (
              <g key={s.skill}>
                <line x1={cx} y1={cy} x2={x} y2={y} stroke={c.grid} strokeWidth={1} />
                <text x={lx} y={ly} textAnchor={anchor} dominantBaseline="middle" fontSize={11.5} fill={hover === i ? c.text : c.muted} fontFamily={c.font} fontWeight={hover === i ? 600 : 400}>
                  {SHORT[s.skill] || s.label}
                </text>
                <text x={lx} y={ly + 14} textAnchor={anchor} dominantBaseline="middle" fontSize={11} fill={c.text} fontFamily={c.font} fontWeight={600}>
                  {s.you !== null ? `${s.you}%` : "–"}
                </text>
              </g>
            );
          })}
          {hasBatch && <polygon points={poly("batch")} fill="none" stroke={c.batch} strokeWidth={2} strokeLinejoin="round" />}
          <g className="grow" style={{ transformOrigin: `${cx}px ${cy}px` }}>
              <polygon points={poly("you")} fill={alpha(c.you, 0.16)} stroke={c.you} strokeWidth={2} strokeLinejoin="round" />
              {skills.map((s, i) => {
                const [x, y] = at(i, s.you ?? 0);
                return s.you !== null && <circle key={s.skill} cx={x} cy={y} r={hover === i ? 5.5 : 4} fill={c.you} stroke={c.surface} strokeWidth={2} />;
              })}
          </g>
          {skills.map((s, i) => {
            const [x, y] = at(i, 100);
            const [px, py] = at(i, s.you ?? 50);
            return (
              <g key={`hit-${s.skill}`} onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} style={{ cursor: "pointer" }}>
                <line x1={cx} y1={cy} x2={x} y2={y} stroke="transparent" strokeWidth={22} />
                <circle cx={px} cy={py} r={14} fill="transparent" />
              </g>
            );
          })}
        </svg>
      )}
      {active && (
        <Tip x={hx + (width - size) / 2} y={hy} width={width}>
          <Typography sx={{ fontSize: 12.5, fontWeight: 600, mb: 0.25 }}>{active.label}</Typography>
          <TipRow color={c.you} label="You" value={active.you !== null ? `${active.you}%` : "Not enough yet"} />
          {active.batch !== null && <TipRow color={c.batch} label="Batch" value={`${active.batch}%`} />}
          <Typography sx={{ fontSize: 11, color: "text.secondary", mt: 0.25 }}>{active.attempts} answers</Typography>
        </Tip>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------- exams

const shortDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "");

export function ExamJourney({ exams }) {
  const c = useChartColors();
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const h = 210;
  const pad = { l: 34, r: 44, t: 14, b: 26 };
  const w = Math.max(width, 240);
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const x = (i) => pad.l + (exams.length === 1 ? iw / 2 : (i * iw) / (exams.length - 1));
  const y = (v) => pad.t + ih - (v / 100) * ih;
  const line = (key) => exams.map((e, i) => (e[key] === null ? null : `${x(i)},${y(e[key])}`)).filter(Boolean).join(" ");
  const area = exams.length > 1 ? `${x(0)},${y(0)} ${line("you")} ${x(exams.length - 1)},${y(0)}` : null;
  const hasBatch = exams.some((e) => e.batch !== null);
  const last = exams[exams.length - 1];

  const onMove = (evt) => {
    const box = evt.currentTarget.getBoundingClientRect();
    const mx = evt.clientX - box.left;
    let best = 0;
    exams.forEach((_, i) => { if (Math.abs(x(i) - mx) < Math.abs(x(best) - mx)) best = i; });
    setHover(best);
  };
  const active = hover !== null ? exams[hover] : null;

  return (
    <Box ref={ref} sx={{ position: "relative", width: "100%", "& .wash": animate(fadeIn, 700), "& .draw": { strokeDasharray: 1, ...animateBig(draw, 900) } }}>
      {width > 0 && (
        <svg width={w} height={h} role="img" aria-label="Your exam scores over time, against the batch average" onMouseMove={onMove} onMouseLeave={() => setHover(null)} onClick={onMove} style={{ display: "block" }}>
          {[0, 50, 100].map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} stroke={c.grid} strokeWidth={1} />
              <text x={pad.l - 8} y={y(v)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill={c.muted} fontFamily={c.font}>{v}%</text>
            </g>
          ))}
          <text x={x(0)} y={h - 6} textAnchor={exams.length === 1 ? "middle" : "start"} fontSize={11} fill={c.muted} fontFamily={c.font}>{shortDate(exams[0].date)}</text>
          {exams.length > 1 && <text x={x(exams.length - 1)} y={h - 6} textAnchor="end" fontSize={11} fill={c.muted} fontFamily={c.font}>{shortDate(last.date)}</text>}
          {active && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} stroke={c.grid} strokeWidth={1} />}
          {area && <polygon className="wash" points={area} fill={alpha(c.you, 0.1)} />}
          {hasBatch && exams.length > 1 && <polyline points={line("batch")} fill="none" stroke={c.batch} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
          {exams.length > 1 && (
            <polyline className="draw" points={line("you")} fill="none" stroke={c.you} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" pathLength={1} />
          )}
          {exams.map((e, i) => (
            <g key={e.examId}>
              {e.batch !== null && <circle cx={x(i)} cy={y(e.batch)} r={hover === i ? 4.5 : 3} fill={c.batch} stroke={c.surface} strokeWidth={2} />}
              <circle cx={x(i)} cy={y(e.you)} r={hover === i ? 6 : 4} fill={c.you} stroke={c.surface} strokeWidth={2} />
            </g>
          ))}
          <text x={x(exams.length - 1) + 9} y={y(last.you)} dominantBaseline="middle" fontSize={12} fontWeight={700} fill={c.text} fontFamily={c.font}>{last.you}%</text>
        </svg>
      )}
      {active && (
        <Tip x={x(hover)} y={y(Math.max(active.you, active.batch ?? 0))} width={w}>
          <Typography sx={{ fontSize: 12.5, fontWeight: 600 }} noWrap>{active.title}</Typography>
          <Typography sx={{ fontSize: 11, color: "text.secondary", mb: 0.25 }}>{shortDate(active.date)}</Typography>
          <TipRow color={c.you} label="You" value={`${active.you}%`} />
          {active.batch !== null && <TipRow color={c.batch} label={`Batch (${active.takers})`} value={`${active.batch}%`} />}
        </Tip>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------- standing

export function ScoreSpread({ bins, myBin }) {
  const c = useChartColors();
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const h = 128;
  const pad = { t: 18, b: 22 };
  const w = Math.max(width, 200);
  const band = w / bins.length;
  const bar = Math.min(24, band - 4);
  const max = Math.max(...bins, 1);
  const ih = h - pad.t - pad.b;

  return (
    <Box ref={ref} sx={{ position: "relative", width: "100%", "& .bar": animateBig(rise, 600, "ease-out", "both") }}>
      {width > 0 && (
        <svg width={w} height={h} role="img" aria-label="How exam averages spread across the batch, with your band marked" onMouseLeave={() => setHover(null)} style={{ display: "block" }}>
          <line x1={0} x2={w} y1={pad.t + ih} y2={pad.t + ih} stroke={c.grid} strokeWidth={1} />
          {bins.map((n, i) => {
            const bh = n ? Math.max(4, (n / max) * ih) : 0;
            const bx = i * band + (band - bar) / 2;
            const by = pad.t + ih - bh;
            const mine = i === myBin;
            return (
              <g key={i} onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} style={{ cursor: "default" }}>
                <rect x={i * band} y={0} width={band} height={h} fill="transparent" />
                {n > 0 && (
                  <path
                    className="bar"
                    style={{ transformOrigin: `${bx}px ${pad.t + ih}px`, animationDelay: `${i * 40}ms` }}
                    d={`M${bx},${by + bh} V${by + 4} Q${bx},${by} ${bx + 4},${by} H${bx + bar - 4} Q${bx + bar},${by} ${bx + bar},${by + 4} V${by + bh} Z`}
                    fill={mine ? c.you : alpha(c.text, hover === i ? 0.3 : 0.16)}
                  />
                )}
                {mine && <text x={bx + bar / 2} y={by - 6} textAnchor="middle" fontSize={11} fontWeight={700} fill={c.text} fontFamily={c.font}>You</text>}
              </g>
            );
          })}
          {[0, 5, 10].map((k) => (
            <text key={k} x={Math.min(w - 2, Math.max(2, k * band))} y={h - 6} textAnchor={k === 0 ? "start" : k === 10 ? "end" : "middle"} fontSize={11} fill={c.muted} fontFamily={c.font}>{k * 10}%</text>
          ))}
        </svg>
      )}
      {hover !== null && (
        <Tip x={hover * band + band / 2} y={pad.t + ih - (bins[hover] / max) * ih} width={w}>
          <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>{hover * 10}–{hover === 9 ? 100 : hover * 10 + 9}% average</Typography>
          <TipRow label="Students" value={bins[hover]} />
          {hover === myBin && <Typography sx={{ fontSize: 11, color: "text.secondary" }}>You're here</Typography>}
        </Tip>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------- activity

const LEVELS = [0, 1, 3, 6, 11];
const levelOf = (n) => LEVELS.reduce((k, min, i) => (n >= min ? i : k), 0);

export function ActivityHeatmap({ days }) {
  const c = useChartColors();
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const shade = (k) => (k === 0 ? alpha(c.text, 0.07) : alpha(c.you, [0, 0.28, 0.5, 0.75, 1][k]));
  // Rows are Monday..Sunday; the first column starts on the first day's weekday.
  const weekday = (d) => (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7;
  const offset = days.length ? weekday(days[0].day) : 0;
  const cols = Math.ceil((days.length + offset) / 7);
  const gap = 3;
  const left = 22;
  const cell = Math.max(9, Math.min(16, Math.floor((Math.max(width, 200) - left) / cols) - gap));
  const step = cell + gap;
  const top = 16;
  const w = left + cols * step;
  const h = top + 7 * step;
  const months = [];
  days.forEach((d, i) => {
    const col = Math.floor((i + offset) / 7);
    const m = d.day.slice(0, 7);
    if (!months.length || months[months.length - 1].m !== m) months.push({ m, col });
  });
  const active = hover !== null ? days[hover] : null;
  const hoverPos = active ? { x: left + Math.floor((hover + offset) / 7) * step + cell / 2, y: top + weekday(active.day) * step } : null;

  return (
    <Box ref={ref} sx={{ position: "relative", width: "100%", "& .cell": animateBig(appear, 300, "ease-out", "both") }}>
      {width > 0 && (
        <svg width={w} height={h} role="img" aria-label="Days you studied over the last 16 weeks" onMouseLeave={() => setHover(null)} style={{ display: "block" }}>
          {months.filter((mo, i) => i === 0 ? cols - mo.col > 2 || months.length === 1 : true).map((mo) => (
            <text key={mo.m} x={left + mo.col * step} y={10} fontSize={10.5} fill={c.muted} fontFamily={c.font}>
              {new Date(`${mo.m}-15T12:00:00Z`).toLocaleDateString(undefined, { month: "short" })}
            </text>
          ))}
          {["M", "", "W", "", "F", "", ""].map((t, i) => t && (
            <text key={i} x={0} y={top + i * step + cell / 2} dominantBaseline="middle" fontSize={10} fill={c.muted} fontFamily={c.font}>{t}</text>
          ))}
          {days.map((d, i) => {
            const col = Math.floor((i + offset) / 7);
            return (
              <rect key={d.day} className="cell" style={{ animationDelay: `${col * 25}ms` }} x={left + col * step} y={top + weekday(d.day) * step} width={cell} height={cell} rx={Math.min(3, cell / 4)}
                fill={shade(levelOf(d.count))} stroke={hover === i ? c.text : "none"} strokeWidth={1.5}
                onMouseEnter={() => setHover(i)} onClick={() => setHover(i)}
              />
            );
          })}
        </svg>
      )}
      {active && (
        <Tip x={hoverPos.x} y={hoverPos.y} width={w}>
          <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>
            {new Date(`${active.day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
          </Typography>
          <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
            {active.count ? `${active.count} thing${active.count === 1 ? "" : "s"} done` : "Nothing done"}
          </Typography>
        </Tip>
      )}
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mt: 1, justifyContent: "flex-end" }}>
        <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>Less</Typography>
        {[0, 1, 2, 3, 4].map((k) => <Box key={k} sx={{ width: 11, height: 11, borderRadius: 0.5, bgcolor: shade(k) }} />)}
        <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>More</Typography>
      </Box>
    </Box>
  );
}
