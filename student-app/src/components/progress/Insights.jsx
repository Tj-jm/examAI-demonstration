import { Box, Typography, Paper, Tooltip, Chip } from "@mui/material";
import { useTheme, alpha } from "@mui/material/styles";
import {
  Footprints, Target, Mountain, Zap, Crosshair, Flame, CalendarCheck, GraduationCap, Shapes, Flag,
  TrendingUp, Trophy, BookOpen, Lock, AlertTriangle, Info, Gauge, LineChart,
} from "lucide-react";
import { animate, slideUp, popIn, useCountUp } from "../../motion";
import Section from "./Section";
import { SkillRadar, ExamJourney, ScoreSpread, ActivityHeatmap, Legend, useChartColors } from "./charts";
import { useTerms } from "../../BrandingContext";

// The deeper half of "My progress": plain-words notes, skill map, where the
// student stands, exam journey, study days and badges, as tabs of the
// page. Drawn from the sections utils/progressInsights.js adds to the
// page's data; no tabs when they aren't there.

const BADGE_ICONS = {
  first_steps: Footprints, century: Target, marathon: Mountain, hot_streak: Zap, sharp: Crosshair,
  on_fire: Flame, regular: CalendarCheck, topic_master: GraduationCap, all_rounder: Shapes,
  debut: Flag, comeback: TrendingUp, podium: Trophy, bookworm: BookOpen,
};
const NOTE_ICONS = { good: TrendingUp, warn: AlertTriangle, info: Info };

// The extra tabs on "My progress", in order. Each is { key, label, icon,
// badge?, content }. Empty when the page data has no insight sections.
export function insightTabs(data) {
  if (!data?.skills || !data?.activity) return [];
  const earned = data.badges.filter((b) => b.earned).length;
  return [
    {
      key: "overview",
      label: "Overview",
      icon: Gauge,
      content: (
        <>
          {data.notes.length > 0 && <Notes notes={data.notes} />}
          <Box sx={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 2.5, ...(data.standing && { "@container (min-width: 760px)": { gridTemplateColumns: "minmax(0, 1.15fr) minmax(0, 1fr)" } }) }}>
            <Section title="Skill map" subtitle="How often you get each kind of question right." delay={1}>
              {data.skills.filter((s) => s.you !== null).length >= 3 ? (
                <>
                  <SkillRadar skills={data.skills} />
                  <Box sx={{ mt: 1 }}><RadarLegend skills={data.skills} /></Box>
                </>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  Answer questions of at least 3 kinds to draw your skill map. So far: {data.skills.filter((s) => s.you !== null).map((s) => s.label).join(", ") || "none yet"}.
                </Typography>
              )}
            </Section>
            {data.standing && <Standing standing={data.standing} />}
          </Box>
        </>
      ),
    },
    data.exams.length > 0 && {
      key: "exams",
      label: "Exams",
      icon: LineChart,
      content: (
        <Section title="Exam journey" subtitle={`Your best score in each of your last ${data.exams.length} exam${data.exams.length === 1 ? "" : "s"}.`}
          action={<ChartLegend batch={data.exams.some((e) => e.batch !== null)} />}>
          <ExamJourney exams={data.exams} />
        </Section>
      ),
    },
    {
      key: "activity",
      label: "Study days",
      icon: CalendarCheck,
      content: (
        <Section title="Study days" subtitle="Practice, exams and lectures, day by day."
          action={<StreakChips activity={data.activity} streak={data.stats.streak} />}>
          <ActivityHeatmap days={data.activity.days} />
        </Section>
      ),
    },
    {
      key: "badges",
      label: "Badges",
      icon: Trophy,
      badge: `${earned}/${data.badges.length}`,
      content: <Badges badges={data.badges} />,
    },
  ].filter(Boolean);
}

function Notes({ notes }) {
  const theme = useTheme();
  const tone = { good: theme.palette.success.main, warn: theme.palette.warning.main, info: theme.palette.text.secondary };
  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, ...animate(slideUp, 420, "ease-out", "60ms both") }}>
      {notes.map((n) => {
        const Icon = NOTE_ICONS[n.tone] || Info;
        return (
          <Paper key={n.text} variant="outlined" sx={{ px: 1.5, py: 1, borderRadius: 2, display: "flex", alignItems: "center", gap: 1, flex: "1 1 240px" }}>
            <Icon size={16} color={tone[n.tone]} style={{ flexShrink: 0 }} />
            <Typography sx={{ fontSize: 13.5 }}>{n.text}</Typography>
          </Paper>
        );
      })}
    </Box>
  );
}

function ChartLegend({ batch = true }) {
  const terms = useTerms();
  const c = useChartColors();
  return <Legend items={[{ label: "You", color: c.you }, ...(batch ? [{ label: `${terms.Batch} average`, color: c.batch }] : [])]} />;
}

function RadarLegend({ skills }) {
  const terms = useTerms();
  const c = useChartColors();
  const rows = skills.filter((s) => s.you !== null || s.batch !== null);
  return (
    <>
      <Box sx={{ display: "flex", justifyContent: "center", mb: 1.5 }}><ChartLegend batch={skills.some((s) => s.batch !== null)} /></Box>
      <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", fontSize: 13, "& td": { py: 0.6, borderTop: 1, borderColor: "divider" } }}>
        <tbody>
          {rows.map((s) => {
            const diff = s.you !== null && s.batch !== null ? s.you - s.batch : null;
            return (
              <tr key={s.skill}>
                <td>{s.label}</td>
                <td style={{ textAlign: "right", fontWeight: 600, color: c.text }}>{s.you !== null ? `${s.you}%` : "–"}</td>
                <td style={{ textAlign: "right", width: 64, color: c.muted }}>
                  {diff === null ? "" : diff === 0 ? `= ${terms.batch}` : `${diff > 0 ? "+" : "−"}${Math.abs(diff)}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </Box>
    </>
  );
}

function Standing({ standing }) {
  const rank = Math.round(useCountUp(standing.rank, 700));
  const top = standing.of > 1 ? Math.max(1, Math.round(((standing.rank - 1) / standing.of) * 100)) : null;
  return (
    <Section title="Where you stand" subtitle="By average exam score, best attempt per exam." delay={1}>
      <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, flexWrap: "wrap" }}>
        <Typography sx={{ fontSize: 40, fontWeight: 800, lineHeight: 1 }}>#{rank || standing.rank}</Typography>
        <Typography color="text.secondary">of {standing.of}</Typography>
      </Box>
      <Typography sx={{ mt: 0.75, fontSize: 14 }}>
        {standing.beats === null ? "You're the only one ranked so far." : standing.rank === 1 ? "Top of the batch." : top <= 10 ? `In the top ${top}%. Better than ${standing.beats}% of the batch.` : `Better than ${standing.beats}% of the batch.`}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
        Your average {standing.avg}% · batch {standing.batchAvg}%
        {standing.avg - standing.batchAvg !== 0 && (
          <Box component="span" sx={{ color: standing.avg > standing.batchAvg ? "success.main" : "warning.main", fontWeight: 600 }}>
            {` (${standing.avg > standing.batchAvg ? "+" : "−"}${Math.abs(standing.avg - standing.batchAvg)})`}
          </Box>
        )}
      </Typography>
      <ScoreSpread bins={standing.bins} myBin={standing.myBin} />
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
        Each bar is how many students average in that range. Names stay private.
      </Typography>
    </Section>
  );
}

function StreakChips({ activity, streak }) {
  const theme = useTheme();
  return (
    <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
      <Chip size="small" icon={<Flame size={14} color={theme.palette.warning.main} />} label={`${streak} day streak`} variant="outlined" />
      <Chip size="small" label={`Best ${activity.bestStreak}`} variant="outlined" />
      <Chip size="small" label={`${activity.activeDays} days in all`} variant="outlined" />
    </Box>
  );
}

function Badges({ badges }) {
  const theme = useTheme();
  const primary = theme.palette.primary.main;
  const sorted = [...badges].sort((a, b) => Number(b.earned) - Number(a.earned) || b.value / b.goal - a.value / a.goal);
  const earned = badges.filter((b) => b.earned).length;
  return (
    <Section title="Badges" subtitle={`${earned} of ${badges.length} earned.`} delay={4}>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(104px, 1fr))", gap: 1.5 }}>
        {sorted.map((b, i) => {
          const Icon = BADGE_ICONS[b.key] || Trophy;
          const size = 58;
          const r = 26;
          const len = 2 * Math.PI * r;
          const frac = b.goal ? b.value / b.goal : 0;
          return (
            <Tooltip key={b.key} arrow title={b.earned ? `${b.desc}. Earned.` : `${b.desc}. ${b.value} of ${b.goal}.`}>
              <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 0.5, ...animate(popIn, 360, "ease-out", `${Math.min(i, 14) * 40}ms both`) }}>
                <Box sx={{ position: "relative", width: size, height: size }}>
                  <svg width={size} height={size} aria-hidden>
                    <circle cx={size / 2} cy={size / 2} r={r} fill={b.earned ? alpha(primary, 0.14) : alpha(theme.palette.text.primary, 0.05)}
                      stroke={b.earned ? primary : alpha(theme.palette.text.primary, 0.12)} strokeWidth={b.earned ? 2 : 3} />
                    {!b.earned && frac > 0 && (
                      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={alpha(primary, 0.7)} strokeWidth={3} strokeLinecap="round"
                        strokeDasharray={len} strokeDashoffset={len * (1 - frac)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
                    )}
                  </svg>
                  <Box sx={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: b.earned ? "primary.main" : "text.disabled" }}>
                    <Icon size={22} />
                  </Box>
                  {!b.earned && (
                    <Box sx={{ position: "absolute", right: 0, bottom: 0, width: 20, height: 20, borderRadius: "50%", bgcolor: "background.paper", border: 1, borderColor: "divider", display: "flex", alignItems: "center", justifyContent: "center", color: "text.secondary" }}>
                      <Lock size={11} />
                    </Box>
                  )}
                </Box>
                <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: b.earned ? "text.primary" : "text.secondary" }}>{b.title}</Typography>
                <Typography sx={{ fontSize: 11, color: "text.secondary", lineHeight: 1.3 }}>
                  {b.earned ? "Earned" : `${b.value}/${b.goal}`}
                </Typography>
              </Box>
            </Tooltip>
          );
        })}
      </Box>
    </Section>
  );
}
