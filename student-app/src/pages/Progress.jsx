import { Box, Typography, Paper, IconButton, Skeleton, Button, Tooltip, Chip } from "@mui/material";
import { useTheme, alpha } from "@mui/material/styles";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Target, Flame, GraduationCap, Trophy, AlertTriangle, Sparkles, ChevronRight, Swords, Gauge, Map as MapIcon } from "lucide-react";
import { useGetBatchQuery } from "../api/contentApi";
import { useGetProgressQuery } from "../api/progressApi";
import { BatchContextCard } from "../components/BatchSwitcher";
import EmptyState from "../components/EmptyState";
import { useTerms, useBranding } from "../BrandingContext";
import { RESTRAINED_DESIGNS, getBoldFill } from "../theme/buildTheme";
import { keyframes } from "@emotion/react";
import { animate, animateBig, slideUp, popIn, growX, useCountUp } from "../motion";
import Section from "../components/progress/Section";
import { GroupHeader } from "../components/OutlineGroups";
import { insightTabs } from "../components/progress/Insights";

// "My progress": the student's own results in this batch with a game layer
// on top. The progress card sits on top; everything else is in sections
// picked with chips. This
// page holds the card, next quests and the topic map;
// components/progress/Insights.jsx adds tabs for the skill map, rank, exam
// journey, study days and badges. Everything is read from what the student
// already did; nothing here asks the AI.

const sweep = keyframes`0% { transform: translateX(-100%); } 60%, 100% { transform: translateX(100%); }`;
const tabIn = keyframes`from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; }`;

const QUEST_ICONS = { topic: Target, skill: Swords, badge: Trophy, streak: Flame };

const MASTERY = [
  { key: "mastered", label: "Mastered", a: 0.9 },
  { key: "strong", label: "Strong", a: 0.55 },
  { key: "learning", label: "Learning", a: 0.28 },
  { key: "weak", label: "Needs work", a: 0.12 },
  { key: "new", label: "Just started", a: 0 },
];

export default function Progress() {
  const terms = useTerms();
  const { batchId } = useParams();
  const navigate = useNavigate();
  const { data: batch } = useGetBatchQuery(batchId);
  const { data, isLoading, isError } = useGetProgressQuery(batchId);

  const empty = data && !data.stats.questions && !data.stats.examsTaken && !data.stats.lecturesDone;

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 900, mx: "auto" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
        <IconButton size="small" onClick={() => navigate(`/batches/${batchId}`)} aria-label={`Back to ${terms.batch}`}><ArrowLeft size={18} /></IconButton>
      </Box>
      <BatchContextCard batch={batch} pageName="My progress" />

      {isLoading ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <Skeleton variant="rounded" height={200} />
          <Skeleton variant="rounded" height={120} />
          <Skeleton variant="rounded" height={320} />
        </Box>
      ) : isError || !data ? (
        <EmptyState icon={Gauge} tone="blocked" title="Couldn't load your progress" description="Try again in a moment." />
      ) : empty ? (
        <EmptyState
          icon={Sparkles}
          title="Your progress starts here"
          description="Answer a few practice questions or sit an exam. Your level and topic map fill in as you go."
          action={batch?.features?.practice ? { label: "Start practising", onClick: () => navigate(`/batches/${batchId}/practice`) } : undefined}
          secondaryAction={{ label: `Back to ${terms.batch}`, onClick: () => navigate(`/batches/${batchId}`) }}
        />
      ) : (
        // Layout follows the page's own width (container queries), since the
        // app column can be phone-narrow even on a wide screen.
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5, containerType: "inline-size" }}>
          <LevelHero data={data} />
          <ProgressTabs tabs={[
            ...(insightTabs?.(data) || []),
            {
              key: "quests",
              label: "Quests",
              icon: Target,
              badge: data.quests.length || null,
              content: data.quests.length
                ? <Quests quests={data.quests} navigate={navigate} />
                : <Quiet>No quests right now. Keep practising and new ones show up here.</Quiet>,
            },
            {
              key: "topics",
              label: "Topics",
              icon: MapIcon,
              content: data.topics.length
                ? <TopicMap groups={data.topics} navigate={navigate} />
                : <Quiet>Answer a few practice questions to start your topic map.</Quiet>,
            },
          ]} />
        </Box>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------- sections

// The section chips and the open section. Chips wrap instead of scrolling,
// so every section stays in sight on a phone. The open one is kept in the
// address (?tab=), so back/forward and a refresh land on the same one. A
// new section slides in softly.
function ProgressTabs({ tabs }) {
  const theme = useTheme();
  const [params, setParams] = useSearchParams();
  const wanted = params.get("tab");
  const active = tabs.find((t) => t.key === wanted) || tabs[0];
  const choose = (key) => {
    const next = new URLSearchParams(params);
    next.set("tab", key);
    setParams(next, { replace: true });
  };
  const primary = theme.palette.primary.main;
  const onPrimary = theme.palette.primary.contrastText;
  return (
    <Box sx={{ minWidth: 0 }}>
      <Box role="tablist" aria-label="Progress sections" sx={{ display: "flex", flexWrap: "wrap", gap: 1, mb: 2.5 }}>
        {tabs.map((t) => {
          const on = t.key === active.key;
          return (
            <Box
              key={t.key}
              component="button"
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => choose(t.key)}
              sx={{
                font: "inherit", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 0.75,
                px: 1.5, py: 0.75, borderRadius: 999, fontSize: 13.5, fontWeight: 600, lineHeight: 1.2,
                border: 1, borderColor: on ? primary : "divider",
                bgcolor: on ? primary : "background.paper",
                color: on ? onPrimary : "text.secondary",
                boxShadow: on ? `0 2px 10px ${alpha(primary, 0.3)}` : "none",
                transition: "background-color 200ms, color 200ms, border-color 200ms, box-shadow 200ms, transform 120ms",
                "&:hover": on ? {} : { borderColor: alpha(primary, 0.5), color: "text.primary" },
                "&:active": { transform: "scale(0.96)" },
                "&:focus-visible": { outline: `2px solid ${primary}`, outlineOffset: 2 },
                ...(on ? animate(popIn, 260) : {}),
              }}
            >
              <t.icon size={15} />
              {t.label}
              {t.badge != null && (
                <Box component="span" sx={{
                  fontSize: 11, fontWeight: 700, px: 0.75, borderRadius: 999, lineHeight: "18px",
                  bgcolor: on ? alpha(onPrimary, 0.22) : "action.selected", color: on ? onPrimary : "text.secondary",
                }}>
                  {t.badge}
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
      <Box
        key={active.key}
        role="tabpanel"
        sx={{ display: "flex", flexDirection: "column", gap: 2.5, ...animate(tabIn, 320, "cubic-bezier(.2,.8,.2,1)") }}
      >
        {active.content}
      </Box>
    </Box>
  );
}

function Quiet({ children }) {
  return (
    <Paper variant="outlined" sx={{ p: 3, borderRadius: 3, textAlign: "center" }}>
      <Typography variant="body2" color="text.secondary">{children}</Typography>
    </Paper>
  );
}

// ---------------------------------------------------------------- progress card

function LevelHero({ data }) {
  const theme = useTheme();
  const { design } = useBranding() || {};
  const editorial = RESTRAINED_DESIGNS.has(design);
  const fill = !editorial ? getBoldFill(design, theme) : null;
  const { level, stats } = data;
  const xp = Math.round(useCountUp(level.xp));
  const pct = Math.round((level.into / level.need) * 100);
  const ink = editorial ? theme.palette.text.primary : fill.color;
  const accent = editorial ? theme.palette.primary.main : fill.color;

  const tiles = [
    { label: "Questions", value: stats.questions },
    { label: "Right", value: stats.accuracy !== null ? `${stats.accuracy}%` : "–" },
    { label: "Exam average", value: stats.examAvg !== null ? `${stats.examAvg}%` : "–" },
    { label: "Day streak", value: stats.streak, icon: stats.streak > 0 ? Flame : null },
  ];

  return (
    <Paper
      variant={editorial ? "outlined" : "elevation"}
      elevation={0}
      sx={{
        p: { xs: 2, sm: 3 }, borderRadius: 3, overflow: "hidden", position: "relative",
        ...(editorial ? {} : { background: fill.background, color: fill.color, ...(fill.border ? { border: fill.border, boxShadow: fill.boxShadow } : {}) }),
        ...animate(slideUp, 420),
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: { xs: 2, sm: 3 } }}>
        <LevelBadge level={level.level} pct={pct} color={accent} track={alpha(ink, 0.15)} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase", opacity: 0.75 }}>Level {level.level}</Typography>
          <Typography variant="h4" sx={{ fontWeight: 700, fontSize: { xs: 26, sm: 32 }, lineHeight: 1.15 }}>{level.title}</Typography>
          <Box sx={{ mt: 1.25, height: 8, borderRadius: 4, bgcolor: alpha(ink, 0.15), overflow: "hidden" }}>
            <Box sx={{
              width: `${pct}%`, height: "100%", borderRadius: 4, bgcolor: accent, transformOrigin: "left", position: "relative", overflow: "hidden",
              ...animateBig(growX, 900, "cubic-bezier(.2,.8,.2,1)"),
              // A slow light sweep along the bar every few seconds.
              "&::after": {
                content: '""', position: "absolute", inset: 0,
                background: `linear-gradient(90deg, transparent, ${alpha("#fff", 0.45)}, transparent)`,
                transform: "translateX(-100%)",
                ...animateBig(sweep, 3200, "ease-in-out", "1.2s infinite"),
              },
            }} />
          </Box>
          <Box sx={{ display: "flex", justifyContent: "space-between", gap: 1, mt: 0.75, flexWrap: "wrap" }}>
            <Typography sx={{ fontSize: 12.5, opacity: 0.85 }}>{xp.toLocaleString()} XP</Typography>
            <Typography sx={{ fontSize: 12.5, opacity: 0.85 }}>
              {level.need - level.into} XP to level {level.level + 1}
              {level.nextTitle ? ` · ${level.nextTitle} at ${level.nextTitleAt}` : ""}
            </Typography>
          </Box>
        </Box>
      </Box>

      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 1, mt: 2.5, "@container (min-width: 440px)": { gridTemplateColumns: "repeat(4, minmax(0, 1fr))" } }}>
        {tiles.map((t) => (
          <Box key={t.label} sx={{ p: 1.25, borderRadius: 2, bgcolor: alpha(ink, editorial ? 0.04 : 0.1), textAlign: "center" }}>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 0.5 }}>
              {t.icon && <t.icon size={16} color={editorial ? theme.palette.warning.main : "currentColor"} />}
              <Typography sx={{ fontSize: 20, fontWeight: 700, lineHeight: 1.2 }}>{t.value}</Typography>
            </Box>
            <Typography sx={{ fontSize: 11.5, opacity: 0.75 }}>{t.label}</Typography>
          </Box>
        ))}
      </Box>
    </Paper>
  );
}

// A hexagon medal with the level in it, ringed by progress to the next.

function LevelBadge({ level, pct, color, track }) {
  const size = 92;
  const c = size / 2;
  const hex = (r) => Array.from({ length: 6 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 3;
    return `${c + r * Math.cos(a)},${c + r * Math.sin(a)}`;
  }).join(" ");
  const ring = 42;
  const len = 2 * Math.PI * ring;
  return (
    <Box sx={{ position: "relative", width: size, height: size, flexShrink: 0, ...animate(popIn, 500) }}>
      <svg width={size} height={size} aria-hidden>
        <circle cx={c} cy={c} r={ring} fill="none" stroke={track} strokeWidth={5} />
        <circle cx={c} cy={c} r={ring} fill="none" stroke={color} strokeWidth={5} strokeLinecap="round"
          strokeDasharray={len} strokeDashoffset={len * (1 - pct / 100)} transform={`rotate(-90 ${c} ${c})`}
          style={{ transition: "stroke-dashoffset 900ms ease-out" }} />
        <polygon points={hex(31)} fill={alpha(color, 0.18)} stroke={color} strokeWidth={2} strokeLinejoin="round" />
      </svg>
      <Typography sx={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, fontWeight: 800 }}>
        {level}
      </Typography>
    </Box>
  );
}

// ---------------------------------------------------------------- quests & topics

function Quests({ quests, navigate }) {
  const theme = useTheme();
  return (
    <Section title="Next quests" subtitle="The quickest ways to level up from here." delay={1}>
      <Box sx={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 1.5, "@container (min-width: 680px)": { gridTemplateColumns: `repeat(${Math.min(quests.length, 3)}, minmax(0, 1fr))` } }}>
        {quests.map((q, i) => {
          const Icon = QUEST_ICONS[q.kind] || Target;
          return (
            <Paper
              key={q.title}
              variant="outlined"
              onClick={q.link ? () => navigate(q.link) : undefined}
              sx={{
                p: 1.75, borderRadius: 2.5, display: "flex", flexDirection: "column", gap: 1, cursor: q.link ? "pointer" : "default",
                transition: "border-color .15s, transform .15s",
                "&:hover": q.link ? { borderColor: "primary.main", transform: "translateY(-2px)" } : {},
                ...animate(popIn, 380, "ease-out", `${120 + i * 80}ms both`),
              }}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Box sx={{ width: 34, height: 34, borderRadius: 2, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", bgcolor: alpha(theme.palette.primary.main, 0.12), color: "primary.main" }}>
                  <Icon size={18} />
                </Box>
                <Typography sx={{ fontWeight: 600, fontSize: 14, flex: 1, minWidth: 0 }}>{q.title}</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: 13, flex: 1 }}>{q.detail}</Typography>
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                {q.xp ? <Chip size="small" label={`+${q.xp} XP`} sx={{ fontWeight: 600, height: 22 }} /> : <span />}
                {q.link && <Button size="small" endIcon={<ChevronRight size={14} />} sx={{ minWidth: 0 }}>Go</Button>}
              </Box>
            </Paper>
          );
        })}
      </Box>
    </Section>
  );
}

function TopicMap({ groups, navigate }) {
  const theme = useTheme();
  const primary = theme.palette.primary.main;
  const counts = Object.fromEntries(MASTERY.map((m) => [m.key, 0]));
  groups.forEach((g) => g.topics.forEach((t) => { counts[t.level] += 1; }));
  const tileSx = (m) => {
    const bg = m.a ? alpha(primary, m.a) : "transparent";
    const strong = m.a >= 0.55;
    return {
      bgcolor: bg,
      color: strong ? theme.palette.getContrastText(primary) : "text.primary",
      border: 1,
      borderColor: m.a ? "transparent" : "divider",
    };
  };
  return (
    <Section title="Topic map" subtitle="Every topic you've answered questions on. Tap one to practise it." delay={3}>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5, mb: 2 }}>
        {MASTERY.filter((m) => counts[m.key]).map((m) => (
          <Box key={m.key} sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
            <Box sx={{ width: 14, height: 14, borderRadius: 0.75, ...tileSx(m) }} />
            <Typography variant="caption" color="text.secondary">{m.label} · {counts[m.key]}</Typography>
          </Box>
        ))}
      </Box>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {groups.map((g, gi) => (
          <Box key={g._id || g.title}>
            {/* Chapters come in the batch's outline order; a named group
                (a paper, a term) gets a header where it starts. */}
            {groups.some((x) => x.group) && (gi === 0 || (g.group?._id || null) !== (groups[gi - 1]?.group?._id || null)) ? (
              <GroupHeader title={g.group?.name || "Other"} first={gi === 0} />
            ) : null}
            <Typography variant="caption" sx={{ fontWeight: 600, color: "text.secondary", textTransform: "uppercase", letterSpacing: 0.6 }}>{g.title}</Typography>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mt: 0.75 }}>
              {g.topics.map((t, i) => {
                const m = MASTERY.find((x) => x.key === t.level) || MASTERY[4];
                return (
                  <Tooltip key={t._id} arrow title={`${t.accuracy}% right in ${t.attempts} answers${t.batch !== null ? ` · batch ${t.batch}%` : ""}. ${m.label}.`}>
                    <Box
                      component="button"
                      onClick={() => navigate(t.link)}
                      sx={{
                        ...tileSx(m), font: "inherit", cursor: "pointer", borderRadius: 1.5, px: 1.25, py: 0.75,
                        display: "inline-flex", alignItems: "center", gap: 0.75, fontSize: 13, maxWidth: "100%",
                        transition: "transform .12s", "&:hover": { transform: "translateY(-1px)" },
                        "&:focus-visible": { outline: `2px solid ${primary}`, outlineOffset: 2 },
                        ...animate(popIn, 300, "ease-out", `${Math.min(i, 20) * 25}ms both`),
                      }}
                    >
                      {t.level === "weak" && <AlertTriangle size={13} color={theme.palette.warning.main} style={{ flexShrink: 0 }} />}
                      {t.level === "mastered" && <GraduationCap size={13} style={{ flexShrink: 0 }} />}
                      <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</Box>
                      <Box component="span" sx={{ fontWeight: 700, opacity: 0.9 }}>{t.accuracy}%</Box>
                    </Box>
                  </Tooltip>
                );
              })}
            </Box>
          </Box>
        ))}
      </Box>
    </Section>
  );
}
