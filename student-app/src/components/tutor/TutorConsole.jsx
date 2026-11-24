import { useEffect, useMemo, useState } from "react";
import { Box, Typography, Button, Switch, Stack } from "@mui/material";
import { useTheme, alpha, lighten, darken, getContrastRatio } from "@mui/material/styles";
import { keyframes } from "@emotion/react";
import { Dumbbell, PlayCircle, ClipboardList, Target, Map as MapIcon, Flame, Check, ChevronRight, Zap, CalendarClock } from "lucide-react";
import SprintFields, { sprintStart, sprintBody, sprintReady } from "./SprintFields";
import { useBranding } from "../../BrandingContext";
import { RESTRAINED_DESIGNS } from "../../theme/buildTheme";

// "AI console" look for My tutor (Settings → Student app → My tutor page):
// a robotic console with an animated robot that types out the day's
// briefing, a reactor ring for progress and the plan as a mission queue.
// Same data and actions as the classic page (pages/Tutor.jsx).
//
// It wears the active theme: colors from the palette (light or dark),
// corners from the design's radius, the design's fonts for content. The
// glow, grid and scanline are for the bold designs; restrained ones
// (editorial, mono, compact, classic) get the same console with hairlines
// instead. Neon and vaporwave stay dark, as their banners do.

const MONO = "'JetBrains Mono', 'Fira Code', 'SFMono-Regular', ui-monospace, Menlo, Consolas, monospace";
const ICON = { practice: Dumbbell, lecture: PlayCircle, exam: ClipboardList, plan: MapIcon };
const KIND = { practice: "PRACTICE", lecture: "LECTURE", exam: "EXAM", plan: "STUDY PLAN" };
const ALWAYS_DARK = new Set(["neon", "vaporwave"]);

const blink = keyframes`0%, 92%, 100% { transform: scaleY(1); } 95% { transform: scaleY(0.1); }`;
const pulse = keyframes`0%, 100% { opacity: 1; } 50% { opacity: 0.35; }`;
const talk = keyframes`0%, 100% { transform: scaleY(0.3); } 50% { transform: scaleY(1); }`;
const scan = keyframes`0% { transform: translateY(-100%); } 100% { transform: translateY(100%); }`;
const float = keyframes`0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); }`;
const spin = keyframes`to { transform: rotate(360deg); }`;
const rise = keyframes`from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; }`;
const caret = keyframes`50% { opacity: 0; }`;

const reduced = { "@media (prefers-reduced-motion: reduce)": { animation: "none !important" } };

// Moves a color away from the background until it reads on it.
const readable = (color, bg, dark, min = 4.5) => {
  let c = color;
  for (let i = 0; i < 8 && getContrastRatio(c, bg) < min; i += 1) c = dark ? lighten(c, 0.15) : darken(c, 0.15);
  return c;
};

// Everything the console draws with, from the theme and design.
function useSkin() {
  const theme = useTheme();
  const { design = "panel" } = useBranding() || {};
  return useMemo(() => {
    const p = theme.palette;
    const forced = ALWAYS_DARK.has(design);
    const dark = forced || p.mode === "dark";
    const bg = forced ? "#0B0E14" : dark ? p.background.default : p.background.paper;
    const panel = forced ? "#121826" : dark ? p.background.paper : (p.surfaceAlt || p.background.default);
    const text = forced ? "#E6EDF7" : p.text.primary;
    const muted = forced ? "#9AA6B8" : p.text.secondary;
    const r = theme.shape.borderRadius;
    const fx = !RESTRAINED_DESIGNS.has(design) || design === "neon";
    return {
      design, dark, bg, panel, text, muted, fx,
      accent: readable(p.primary.main, bg, dark),
      ok: readable(p.success.main, panel, dark),
      warn: readable(p.warning.main, panel, dark),
      border: forced ? "#263043" : p.divider,
      radius: r,
      outer: r ? Math.max(r * 1.5, 8) : 0,
      font: theme.typography.fontFamily,
      heading: theme.typography.h6.fontFamily || theme.typography.fontFamily,
      pixel: design === "pixel",
    };
  }, [theme, design]);
}

// Types the text out once, like a terminal.
function useTypewriter(text, speed = 18) {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0);
    if (!text) return undefined;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { setN(text.length); return undefined; }
    const t = setInterval(() => setN((v) => { if (v >= text.length) { clearInterval(t); return v; } return v + 1; }), speed);
    return () => clearInterval(t);
  }, [text, speed]);
  return { shown: (text || "").slice(0, n), typing: n < (text || "").length };
}

function Robot({ s, talking }) {
  const a = s.accent;
  const round = s.radius === 0 ? 0 : 1;
  return (
    <Box sx={{ width: { xs: 88, sm: 108 }, flex: "none", ...(s.fx && { animation: `${float} 4s ease-in-out infinite`, filter: `drop-shadow(0 0 14px ${alpha(a, 0.45)})` }), ...reduced }}>
      <svg viewBox="0 0 120 120" width="100%" aria-hidden="true">
        <line x1="60" y1="10" x2="60" y2="26" stroke={a} strokeWidth="3" strokeLinecap="round" />
        <circle cx="60" cy="9" r="5" fill={a}>
          <animate attributeName="opacity" values="1;0.3;1" dur="1.6s" repeatCount="indefinite" />
        </circle>
        <rect x="6" y="50" width="10" height="26" rx={4 * round} fill={alpha(a, 0.3)} stroke={a} strokeWidth="2" />
        <rect x="104" y="50" width="10" height="26" rx={4 * round} fill={alpha(a, 0.3)} stroke={a} strokeWidth="2" />
        <rect x="16" y="26" width="88" height="76" rx={20 * round} fill={s.panel} stroke={a} strokeWidth="3" />
        <rect x="27" y="40" width="66" height="34" rx={12 * round} fill={alpha(a, 0.12)} stroke={alpha(a, 0.6)} strokeWidth="1.5" />
        {[46, 74].map((cx) => (
          <g key={cx} style={{ transformOrigin: `${cx}px 57px`, animation: `${blink} 5s infinite` }}>
            {round ? <circle cx={cx} cy="57" r="7.5" fill={a} /> : <rect x={cx - 7} y="50" width="14" height="14" fill={a} />}
            <circle cx={cx + 2.5} cy="54.5" r="2.2" fill={s.bg} opacity="0.9" />
          </g>
        ))}
        {[0, 1, 2, 3, 4].map((i) => (
          <rect
            key={i} x={44 + i * 7} y="80" width="4" height="12" rx={2 * round} fill={a}
            style={{ transformOrigin: `${46 + i * 7}px 86px`, transform: "scaleY(0.3)", animation: talking ? `${talk} ${0.35 + (i % 3) * 0.12}s ease-in-out infinite` : "none" }}
          />
        ))}
      </svg>
    </Box>
  );
}

// Progress as a segmented reactor ring.
function Reactor({ done, total, s }) {
  const segs = Math.max(total, 1);
  const r = 40;
  const c = 2 * Math.PI * r;
  const gap = segs > 1 ? 5 : 0;
  const len = c / segs - gap;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <Box sx={{ position: "relative", width: 112, height: 112, flex: "none" }}>
      {s.fx && <Box sx={{ position: "absolute", inset: 0, borderRadius: "50%", border: `1px dashed ${alpha(s.accent, 0.35)}`, animation: `${spin} 18s linear infinite`, ...reduced }} />}
      <svg viewBox="0 0 100 100" width="112" height="112" style={{ transform: "rotate(-90deg)" }} aria-hidden="true">
        {Array.from({ length: segs }).map((_, i) => (
          <circle
            key={i} cx="50" cy="50" r={r} fill="none" strokeWidth="7"
            stroke={i < done ? s.accent : alpha(s.accent, 0.15)}
            strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-i * (len + gap)}
            style={{ filter: i < done && s.fx ? `drop-shadow(0 0 4px ${s.accent})` : "none", transition: "stroke .4s" }}
          />
        ))}
      </svg>
      <Box sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center" }}>
        <Box>
          <Typography sx={{ fontFamily: MONO, fontWeight: 700, fontSize: 24, lineHeight: 1, color: s.text }}>{pct}<span style={{ fontSize: 12 }}>%</span></Typography>
          <Typography sx={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: 1.5, color: s.accent, mt: 0.5 }}>{done}/{total} DONE</Typography>
        </Box>
      </Box>
    </Box>
  );
}

const Label = ({ children, s, sx }) => (
  <Typography component="div" sx={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: 2, textTransform: "uppercase", color: s.accent, ...sx }}>{children}</Typography>
);

// A panel with HUD corner brackets, cornered like the design's cards.
function Panel({ s, tone, children, sx, glow }) {
  const c = tone || s.accent;
  const corner = (pos) => ({
    content: '""', position: "absolute", width: 18, height: 18, pointerEvents: "none", borderColor: c, borderStyle: "solid", borderWidth: 0, ...pos,
  });
  return (
    <Box sx={{
      position: "relative", borderRadius: `${s.radius}px`, p: { xs: 2, sm: 2.5 }, bgcolor: s.panel, color: s.text,
      border: `${s.pixel ? 2 : 1}px solid ${glow ? alpha(c, 0.7) : s.dark ? alpha(c, 0.25) : s.border}`,
      boxShadow: s.pixel ? `3px 3px 0 ${s.dark ? "#000" : "#14161A"}` : glow && s.fx ? `0 0 22px ${alpha(c, 0.2)}` : "none",
      "&::before": corner({ top: -1, left: -1, borderTopWidth: 2, borderLeftWidth: 2, borderTopLeftRadius: s.radius }),
      "&::after": corner({ bottom: -1, right: -1, borderBottomWidth: 2, borderRightWidth: 2, borderBottomRightRadius: s.radius }),
      ...sx,
    }}
    >
      {children}
    </Box>
  );
}

export default function TutorConsole({ data, onGo, onToggle, onSprint, onPlanSource, saving }) {
  const theme = useTheme();
  const s = useSkin();
  const [sprintOpen, setSprintOpen] = useState(false);
  const [sprint, setSprint] = useState(sprintStart(null));
  const [sprintError, setSprintError] = useState(null);
  const tasks = data.tasks || [];
  const done = tasks.filter((t) => t.done).length;
  const briefing = data.enabled ? (data.note || "Your tasks for today.") : "Tutor is off. Turn on the daily plan below.";
  const { shown, typing } = useTypewriter(briefing);
  const today = new Date().toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }).toUpperCase();
  const firstOpen = tasks.findIndex((x) => !x.done);
  const onAccent = getContrastRatio("#FFFFFF", s.accent) >= 3 ? "#FFFFFF" : (s.dark ? s.bg : "#0B0E14");

  const field = {
    "& .MuiInputBase-root": { color: s.text, bgcolor: s.dark ? alpha("#000", 0.25) : s.bg },
    "& .MuiOutlinedInput-notchedOutline": { borderColor: s.dark ? alpha(s.accent, 0.35) : s.border },
    "& .MuiInputLabel-root": { color: s.muted },
    "& .MuiSelect-icon": { color: s.muted },
  };
  const go = {
    flex: "none", fontFamily: MONO, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", fontSize: 12,
    borderRadius: `${theme.components?.MuiButton?.styleOverrides?.root?.borderRadius ?? s.radius}px`, px: 1.75,
    color: onAccent, bgcolor: s.accent,
    boxShadow: s.pixel ? "2px 2px 0 #14161A" : s.fx ? `0 0 14px ${alpha(s.accent, 0.45)}` : "none",
    "&:hover": { bgcolor: s.dark ? lighten(s.accent, 0.08) : darken(s.accent, 0.08), boxShadow: s.fx && !s.pixel ? `0 0 22px ${alpha(s.accent, 0.7)}` : undefined },
  };

  return (
    <Box sx={{
      position: "relative", mt: 2, borderRadius: `${s.outer}px`, overflow: "hidden", color: s.text, fontFamily: s.font,
      background: s.fx
        ? `radial-gradient(120% 80% at 0% 0%, ${alpha(s.accent, s.dark ? 0.2 : 0.1)}, transparent 55%), radial-gradient(90% 60% at 100% 100%, ${alpha(s.accent, s.dark ? 0.12 : 0.06)}, transparent 60%), ${s.bg}`
        : s.bg,
      border: `${s.pixel ? 3 : 1}px solid ${s.pixel ? "#14161A" : s.dark ? alpha(s.accent, 0.3) : s.border}`,
      boxShadow: s.pixel ? "5px 5px 0 #14161A" : s.fx ? `0 14px 40px ${alpha("#000", s.dark ? 0.35 : 0.08)}` : "none",
    }}
    >
      {s.fx && (
        <>
          <Box aria-hidden sx={{
            position: "absolute", inset: 0, pointerEvents: "none", opacity: s.dark ? 0.55 : 0.6,
            backgroundImage: `linear-gradient(${alpha(s.accent, 0.07)} 1px, transparent 1px), linear-gradient(90deg, ${alpha(s.accent, 0.07)} 1px, transparent 1px)`,
            backgroundSize: "28px 28px", maskImage: "linear-gradient(180deg, #000, transparent 85%)",
          }}
          />
          <Box aria-hidden sx={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
            <Box sx={{ height: "35%", background: `linear-gradient(180deg, transparent, ${alpha(s.accent, 0.06)}, transparent)`, animation: `${scan} 6s linear infinite`, ...reduced }} />
          </Box>
        </>
      )}

      <Box sx={{ position: "relative", p: { xs: 2, sm: 3 } }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2.5, gap: 1, flexWrap: "wrap" }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Box sx={{ width: 8, height: 8, borderRadius: s.radius ? "50%" : 0, bgcolor: data.enabled ? s.ok : s.warn, boxShadow: s.fx ? `0 0 10px ${data.enabled ? s.ok : s.warn}` : "none", animation: `${pulse} 1.8s ease-in-out infinite`, ...reduced }} />
            <Label s={s}>Tutor // {data.enabled ? "on" : "off"}</Label>
          </Stack>
          <Label s={s} sx={{ color: s.muted }}>{today}</Label>
        </Stack>

        {/* Wraps by its own width: the page column is narrower than the viewport. */}
        <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 2.5 }}>
          <Stack direction="row" spacing={2} alignItems="center" sx={{ flex: "1 1 300px", minWidth: 0 }}>
            <Robot s={s} talking={typing} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Label s={s} sx={{ mb: 0.75 }}>&gt; Today</Label>
              <Typography sx={{ fontFamily: MONO, fontSize: { xs: 13.5, sm: 15 }, lineHeight: 1.6, color: s.text, minHeight: 48 }}>
                {shown}
                <Box component="span" sx={{ display: "inline-block", width: 8, height: 16, ml: 0.5, verticalAlign: "-2px", bgcolor: s.accent, animation: `${caret} 1s steps(1) infinite`, ...reduced }} />
              </Typography>
            </Box>
          </Stack>
          <Stack direction="row" spacing={2} alignItems="center" sx={{ flex: "1 1 220px", justifyContent: "space-around" }}>
            {data.enabled && tasks.length > 0 && <Reactor done={done} total={tasks.length} s={s} />}
            <Box sx={{ textAlign: "center", px: 1.5, py: 1.25, borderRadius: `${s.radius}px`, border: `1px solid ${alpha(s.warn, data.streak ? 0.6 : 0.25)}`, bgcolor: alpha(s.warn, data.streak ? 0.1 : 0.03), minWidth: 92 }}>
              <Flame size={20} color={data.streak ? s.warn : alpha(s.warn, 0.45)} style={{ filter: data.streak && s.fx ? `drop-shadow(0 0 6px ${s.warn})` : "none" }} />
              <Typography sx={{ fontFamily: MONO, fontWeight: 700, fontSize: 22, lineHeight: 1.1, color: s.text }}>{String(data.streak || 0).padStart(2, "0")}</Typography>
              <Typography sx={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: 1.5, color: s.warn }}>DAY STREAK</Typography>
              {data.bestStreak > 1 && <Typography sx={{ fontFamily: MONO, fontSize: 9, color: s.muted }}>BEST {data.bestStreak}</Typography>}
            </Box>
          </Stack>
        </Box>

        {data.enabled && (
          <Box sx={{ mt: 3 }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.25 }}>
              <Label s={s}>Tasks</Label>
              <Label s={s} sx={{ color: s.muted }}>{tasks.length - done} left</Label>
            </Stack>
            <Stack spacing={1.25}>
              {tasks.map((t, i) => {
                const Icon = ICON[t.kind] || Target;
                const tone = t.done ? s.ok : s.accent;
                const steps = t.target > 1 ? Math.min(t.target, 20) : 0;
                const filled = steps ? Math.round((t.progress / t.target) * steps) : 0;
                return (
                  <Panel key={t.key} s={s} tone={tone} glow={i === firstOpen}
                    sx={{ display: "flex", gap: 1.75, alignItems: "center", opacity: t.done ? 0.75 : 1, ...(s.fx && { animation: `${rise} .45s ${i * 0.08}s both ease-out` }), ...reduced }}
                  >
                    <Typography sx={{ fontFamily: MONO, fontSize: 13, color: tone, width: 22, flex: "none" }}>{String(i + 1).padStart(2, "0")}</Typography>
                    <Box sx={{ width: 40, height: 40, borderRadius: `${s.radius}px`, flex: "none", display: "grid", placeItems: "center", color: tone, bgcolor: alpha(tone, 0.12), border: `1px solid ${alpha(tone, 0.35)}` }}>
                      {t.done ? <Check size={20} /> : <Icon size={20} />}
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Box component="span" sx={{ display: "inline-block", fontFamily: MONO, fontSize: 9.5, letterSpacing: 1.5, px: 0.75, mb: 0.25, borderRadius: `${Math.min(s.radius, 4)}px`, color: tone, border: `1px solid ${alpha(tone, 0.45)}` }}>
                        {t.manual ? "TICKED BY YOU" : t.done ? "DONE" : KIND[t.kind] || "TASK"}
                      </Box>
                      <Typography sx={{ fontFamily: s.heading, fontWeight: 600, color: s.text, textDecoration: t.done ? "line-through" : "none", textDecorationColor: alpha(s.text, 0.4) }}>{t.title}</Typography>
                      <Typography sx={{ fontSize: 13, color: s.muted }}>{t.detail}</Typography>
                      {steps > 0 && (
                        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.75 }} aria-label={`${t.progress} of ${t.target}`}>
                          {Array.from({ length: steps }).map((_, k) => (
                            <Box key={k} sx={{ flex: 1, maxWidth: 18, height: 6, borderRadius: s.radius ? 0.5 : 0, bgcolor: k < filled ? tone : alpha(tone, 0.15) }} />
                          ))}
                          <Typography sx={{ fontFamily: MONO, fontSize: 10.5, color: s.muted, pl: 0.75 }}>{t.progress}/{t.target}</Typography>
                        </Stack>
                      )}
                    </Box>
                    {!t.done && <Button onClick={() => onGo(t.link)} endIcon={<ChevronRight size={16} />} sx={go}>Go</Button>}
                  </Panel>
                );
              })}
              {!tasks.length && (
                <Panel s={s} tone={s.ok}><Typography sx={{ fontFamily: MONO, color: s.ok }}>&gt; Nothing to do today.</Typography></Panel>
              )}
            </Stack>
          </Box>
        )}

        {data.enabled && data.plan && (
          <Panel s={s} tone={data.plan.behind ? s.warn : s.accent} sx={{ mt: 2.5, display: "flex", alignItems: "center", gap: 1.5 }}>
            <MapIcon size={20} color={data.plan.behind ? s.warn : s.accent} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Label s={s}>Study plan</Label>
              <Typography sx={{ color: s.text }}>
                {data.plan.paused ? "On hold until your exam" : data.plan.ended ? "Plan time is over" : data.plan.behind && data.plan.next ? `Next: Day ${data.plan.next} of ${data.plan.of}` : `Day ${data.plan.day} of ${data.plan.of}`}
                {data.plan.behind ? <Box component="span" sx={{ color: s.warn }}>{` · ${data.plan.behind} day${data.plan.behind === 1 ? "" : "s"} behind`}</Box> : null}
              </Typography>
              {data.planChoices?.length > 1 && (
                <Stack direction="row" spacing={0.75} sx={{ mt: 1, flexWrap: "wrap" }}>
                  {[["batch", "Batch plan"], ["archive", "Archive plan"]].map(([v, l]) => {
                    const on = data.plan.source === v;
                    return (
                      <Button key={v} size="small" disabled={saving} onClick={() => !on && onPlanSource(v)}
                        sx={{ fontFamily: MONO, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", minWidth: 0, px: 1.25, py: 0.25, borderRadius: 1, border: `1px solid ${on ? s.accent : alpha(s.text, 0.25)}`, color: on ? s.accent : s.muted, bgcolor: on ? alpha(s.accent, 0.12) : "transparent" }}>
                        {l}
                      </Button>
                    );
                  })}
                </Stack>
              )}
            </Box>
            <Button size="small" onClick={() => onGo(data.plan.link)} sx={{ fontFamily: MONO, color: s.accent, textTransform: "uppercase", letterSpacing: 1 }}>Open</Button>
          </Panel>
        )}

        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.25, mt: 2.5 }}>
          <Panel s={s} sx={{ flex: "2 1 300px" }}>
            <Stack direction="row" alignItems="center" spacing={1.5}>
              <CalendarClock size={20} color={s.accent} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Label s={s}>Exam sprint</Label>
                {data.sprint && data.sprint.daysLeft >= 0 ? (
                  <Typography sx={{ color: s.text }}>
                    <Box component="span" sx={{ whiteSpace: "nowrap", fontFamily: MONO, fontSize: 26, fontWeight: 700, color: s.accent, textShadow: s.fx ? `0 0 12px ${alpha(s.accent, 0.5)}` : "none", mr: 1 }}>T-{String(data.sprint.daysLeft).padStart(2, "0")}</Box>
                    days to {data.sprint.label || "your exam"}
                  </Typography>
                ) : (
                  <Typography sx={{ fontSize: 13, color: s.muted }}>{data.sprintEnded ? `The date for ${data.sprintEnded} has passed. Set your next exam.` : "Set your exam. In the last 3 weeks, tasks focus on the exam."}</Typography>
                )}
              </Box>
              <Button size="small" onClick={() => { setSprint(sprintStart(data.sprint)); setSprintOpen(!sprintOpen); }} sx={{ fontFamily: MONO, color: s.accent, textTransform: "uppercase", letterSpacing: 1 }}>{data.sprint ? "Edit" : "Set"}</Button>
            </Stack>
            {sprintOpen && (
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mt: 1.5 }}>
                <SprintFields
                  options={data.sprintOptions} value={sprint} onChange={setSprint} sx={field}
                  menuSx={{ bgcolor: s.panel, color: s.text, border: `1px solid ${s.dark ? alpha(s.accent, 0.35) : s.border}` }}
                />
                <Button variant="contained" disabled={saving || !sprintReady(sprint)} onClick={async () => { const r = await onSprint(sprintBody(sprint)); if (r?.error) setSprintError(r.error.data?.message || "Could not save."); else { setSprintError(null); setSprintOpen(false); } }} sx={go}>Save</Button>
                {data.sprint && <Button disabled={saving} onClick={async () => { await onSprint({ sprintExamId: null, sprintDate: null, sprintLabel: "" }); setSprintOpen(false); }} sx={{ fontFamily: MONO, color: s.muted }}>Clear</Button>}
              </Box>
            )}
            {sprintOpen && sprintError && <Typography sx={{ mt: 1, fontSize: 13, color: s.warn }}>{sprintError}</Typography>}
          </Panel>
          <Panel s={s} sx={{ display: "flex", alignItems: "center", gap: 1.5, flex: "1 1 240px" }}>
            <Zap size={20} color={data.enabled ? s.accent : alpha(s.accent, 0.45)} />
            <Box sx={{ flex: 1 }}>
              <Label s={s}>Daily plan</Label>
              <Typography sx={{ fontSize: 13, color: s.muted }}>Tasks every day, reminder in the evening</Typography>
            </Box>
            <Switch checked={data.enabled} disabled={saving} onChange={(e) => onToggle(e.target.checked)} inputProps={{ "aria-label": "Daily plan and evening reminders" }} />
          </Panel>
        </Box>
      </Box>
    </Box>
  );
}
