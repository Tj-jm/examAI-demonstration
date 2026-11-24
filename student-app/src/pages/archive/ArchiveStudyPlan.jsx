import { useEffect, useState } from "react";
import { Box, Typography, Paper, Button, IconButton, Skeleton, Alert, CircularProgress, Chip, Stack, Tooltip } from "@mui/material";
import { useTheme, alpha } from "@mui/material/styles";
import { keyframes } from "@emotion/react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, CalendarCheck, Sparkles, RotateCw, Dumbbell, TrendingUp, Target, CheckCircle2, Circle,
  ClipboardList, Hash,
} from "lucide-react";
import {
  useGetBatchQuery, useGetArchiveStudyPlanQuery, useGetArchiveStudyPlanCapacityQuery,
  useGenerateArchiveStudyPlanMutation, useToggleArchiveStudyPlanDayMutation,
} from "../../api/contentApi";
import { BatchContextCard } from "../../components/BatchSwitcher";
import EmptyState from "../../components/EmptyState";
import AiUsageMeter from "../../components/AiUsageMeter";
import PracticeModal from "../practice/PracticeModal";
import { skillTypeLabel, skillTypePaletteKey } from "../../constants/skillTypes";
import { useSales, useTerms } from "../../BrandingContext";

const DURATIONS = [3, 5, 7, 15, 30];

const DAY_KIND_COLORS = (theme) => ({
  practice: { label: "Practice", color: theme.palette.primary.main },
  exam: { label: "Self-build exam", color: theme.palette.ai.main },
  revision: { label: "Revision", color: theme.palette.success.main },
});

// A small donut broken into practice/exam/revision days (composition), with
// how many days are actually done so far at its center (completion) — two
// numbers the header text above already states in words, given a shape
// instead. Hand-drawn with plain <circle> strokes rather than a charting
// library: nothing else in the app pulls one in, and a plan never has more
// than 3 segments, well within what a couple of stroke-dasharray circles
// can do cleanly.
function PlanDonut({ days, theme, size = 60, thickness = 8 }) {
  const kindMeta = DAY_KIND_COLORS(theme);
  const total = days.length;
  const done = days.filter((d) => d.completed).length;
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;

  let offset = 0;
  const arcs = Object.keys(kindMeta)
    .map((kind) => ({ kind, count: days.filter((d) => d.kind === kind).length, ...kindMeta[kind] }))
    .filter((s) => s.count > 0);

  return (
    <Box sx={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        {arcs.map((s) => {
          const length = (s.count / total) * circumference;
          const dashoffset = -offset;
          offset += length;
          return (
            <circle
              key={s.kind}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={s.color}
              strokeWidth={thickness}
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={dashoffset}
            />
          );
        })}
      </svg>
      <Box sx={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <Typography sx={{ fontSize: 14, fontWeight: 700, lineHeight: 1.1 }} className="tnum">{done}/{total}</Typography>
        <Typography sx={{ fontSize: 8.5, color: "text.secondary", lineHeight: 1 }}>done</Typography>
      </Box>
    </Box>
  );
}

function PlanDonutLegend({ days, theme }) {
  const kindMeta = DAY_KIND_COLORS(theme);
  const rows = Object.keys(kindMeta)
    .map((kind) => ({ kind, count: days.filter((d) => d.kind === kind).length, ...kindMeta[kind] }))
    .filter((r) => r.count > 0);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, minWidth: 0 }}>
      {rows.map((r) => (
        <Box key={r.kind} sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
          <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: r.color, flexShrink: 0 }} />
          <Typography variant="caption" color="text.secondary" noWrap>
            {r.count} {r.label.toLowerCase()} day{r.count === 1 ? "" : "s"}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

// The archive's own version of StudyPlan.jsx — same weakest-topic-first
// scheduling display (archiveStudyPlanController.js ports the whole
// scheduler, minus lecture days, which archive has no equivalent of at
// all). Two real differences from the batch version:
//   - No FeatureGate wrapper — archiveRoutes.js already refuses a batch
//     with no archiveAuthorities before this page's own requests can ever
//     land, same as every other archive page.
//   - A day's "Practice" opens the same PracticeModal as the batch plan, in
//     its archive mode (archive questions for that topic/chapter), narrowed
//     to exactly that day's skill. AiUsageMeter IS here, in its
//     `archive` mode — plan generation is a billable AI call
//     (feature: "study-plan") against the same shared batch: null pool
//     every other archive AI call uses.
export default function ArchiveStudyPlan() {
  const sales = useSales();
  const terms = useTerms();
  const { batchId } = useParams();
  const navigate = useNavigate();
  const theme = useTheme();
  const { data: batch } = useGetBatchQuery(batchId);
  // Generating needs archiveAiAssist + archiveStudyPlan (archiveRoutes.js).
  // An existing plan stays viewable either way. Treated as on until the
  // batch has loaded, so a working page never flashes "turned off".
  const canGenerate = !batch || Boolean(batch.features?.archiveAiAssist && batch.features?.archiveStudyPlan);
  const { data, isLoading } = useGetArchiveStudyPlanQuery(batchId);
  const { data: capacityData } = useGetArchiveStudyPlanCapacityQuery(batchId);
  const maxDays = capacityData?.maxDays;
  const idealDays = capacityData?.idealDays;
  const [generate, { isLoading: generating, error: generateErrorRaw, reset }] = useGenerateArchiveStudyPlanMutation();
  const [toggleDay] = useToggleArchiveStudyPlanDayMutation();

  const [dismissed, setDismissed] = useState(false);
  const [practiceFor, setPracticeFor] = useState(null);
  const [durationDays, setDurationDays] = useState(7);

  const plan = data?.plan;

  useEffect(() => {
    // The length picked last time; durationDays is what got built, which
    // can be shorter than any length the picker offers.
    const picked = plan?.requestedDays || plan?.durationDays;
    if (picked) setDurationDays(DURATIONS.includes(picked) ? picked : DURATIONS.find((d) => d >= picked) || DURATIONS[DURATIONS.length - 1]);
  }, [plan?.durationDays, plan?.requestedDays, plan?.generatedAt]);

  useEffect(() => {
    if (!maxDays) return;
    if (durationDays > maxDays) {
      setDurationDays([...DURATIONS].reverse().find((d) => d <= maxDays) || DURATIONS[0]);
    }
  }, [maxDays]);

  const generateError = generateErrorRaw && !dismissed
    ? {
        message: generateErrorRaw.data?.message || "Could not generate a plan right now.",
        capReached: generateErrorRaw.status === 429,
      }
    : null;

  const run = () => {
    setDismissed(false);
    generate({ batchId, durationDays });
  };

  // Same "chapter:<id>" composite the archive session route uses.
  const openPractice = (t) =>
    setPracticeFor({ topicId: t.chapterPool ? `chapter:${t.topic}` : t.topic, topicTitle: t.title, skillType: t.skillType });

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 640, mx: "auto" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
        <IconButton size="small" onClick={() => navigate(`/batches/${batchId}/archive`)}><ArrowLeft size={18} /></IconButton>
      </Box>

      <BatchContextCard batch={batch} pageName="Study Plan" section={{ label: "Archive", to: `/batches/${batchId}/archive` }} />

      {canGenerate && <AiUsageMeter batchId={batchId} archive />}

      <GoalBanner theme={theme} />

      {isLoading ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <Skeleton variant="rounded" height={80} />
          <Skeleton variant="rounded" height={280} />
        </Box>
      ) : (
        <>
          {generateError && (
            <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setDismissed(true)}>
              {generateError.message}
              {sales && generateError.capReached && (
                <Button
                  size="small"
                  variant="text"
                  onClick={() => navigate(`/batches/${batchId}/ai-credits`)}
                  sx={{ display: "block", mt: 0.5, pl: 0 }}
                >
                  Buy more AI credits
                </Button>
              )}
            </Alert>
          )}

          {!plan && generating ? (
            <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, py: 6 }}>
              <CircularProgress size={28} />
              <Typography variant="body2" color="text.secondary">Building your plan…</Typography>
            </Box>
          ) : !plan && !canGenerate ? (
            <EmptyState
              icon={CalendarCheck}
              title="Study plans aren't available here"
              description={`AI study plans are turned off for this ${terms.batch}'s archive.`}
            />
          ) : !plan ? (
            <>
              <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0.5, mb: 1 }}>
                <DurationPicker value={durationDays} onChange={setDurationDays} maxDays={maxDays} />
                {Boolean(idealDays) && (
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
                    Full coverage (practice + exams, nothing packed together) takes about {idealDays} days — a
                    shorter plan covers the same ground, just denser.
                  </Typography>
                )}
              </Box>
              <EmptyState
                icon={CalendarCheck}
                title="No archive study plan yet"
                description="Generate a plan from your archive practice accuracy — weakest topics first, packed to fit however many days you pick."
                action={{ label: `Generate my ${durationDays}-day plan`, onClick: run }}
              />
            </>
          ) : (
            <>
              <Paper
                variant="outlined"
                sx={{
                  borderRadius: 3, p: 2, mb: 2.5,
                  display: "flex", flexDirection: "column", gap: 1.25,
                  borderColor: alpha(theme.palette.ai.main, 0.35),
                  bgcolor: theme.palette.ai.bg,
                }}
              >
                <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.25 }}>
                  <Sparkles size={18} color={theme.palette.ai.main} style={{ flexShrink: 0, marginTop: 2 }} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 500, fontSize: 14, mb: 0.5 }}>{plan.summary}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {plan.durationDays}-day plan · {plan.days.filter((d) => d.completed).length}/{plan.days.length} days done
                      · Generated {new Date(plan.generatedAt).toLocaleDateString()}
                    </Typography>
                  </Box>
                </Box>

                <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, py: 0.5 }}>
                  <PlanDonut days={plan.days} theme={theme} />
                  <PlanDonutLegend days={plan.days} theme={theme} />
                </Box>

                {canGenerate && <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, flexWrap: "wrap" }}>
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
                    <DurationPicker value={durationDays} onChange={setDurationDays} maxDays={maxDays} />
                    {Boolean(idealDays) && (
                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10.5 }}>
                        Full coverage takes ~{idealDays}d — shorter just packs it denser
                      </Typography>
                    )}
                  </Box>
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={generating}
                    onClick={run}
                    startIcon={generating ? <CircularProgress size={13} /> : <RotateCw size={13} />}
                    sx={{ flexShrink: 0 }}
                  >
                    {generating ? "Working" : "Regenerate"}
                  </Button>
                </Box>}
              </Paper>

              <Box sx={{ display: "flex", flexDirection: "column" }}>
                {plan.days.map((day, i) => (
                  <DayCard
                    key={day.day}
                    day={day}
                    batchId={batchId}
                    navigate={navigate}
                    onPractice={openPractice}
                    onToggle={(completed) => toggleDay({ batchId, day: day.day, completed })}
                    onExam={(exam) =>
                      navigate(`/batches/${batchId}/archive/exam-setup`, {
                        state: {
                          autoStart: {
                            topicIds: exam.chapterPool ? [] : [exam.topic],
                            chapterIds: exam.chapterPool ? [exam.topic] : [],
                            types: exam.types,
                            questionCount: exam.questionCount,
                            durationMinutes: exam.durationMinutes,
                          },
                        },
                      })
                    }
                    theme={theme}
                    isLast={i === plan.days.length - 1}
                  />
                ))}
              </Box>
            </>
          )}
        </>
      )}

      <PracticeModal
        archive
        open={Boolean(practiceFor)}
        onClose={() => setPracticeFor(null)}
        batchId={batchId}
        topicId={practiceFor?.topicId}
        topicTitle={practiceFor?.topicTitle}
        skillType={practiceFor?.skillType}
      />
    </Box>
  );
}

const floatPulse = keyframes`
  0%, 100% { transform: scale(1); opacity: 0.6; }
  50% { transform: scale(1.18); opacity: 1; }
`;

const flowDash = keyframes`
  to { stroke-dashoffset: -16; }
`;

function GoalBanner({ theme }) {
  const steps = [
    { icon: TrendingUp, label: "Your archive accuracy", color: theme.palette.primary.main },
    { icon: Target, label: "Weak spots found", color: theme.palette.ai.main },
    { icon: CalendarCheck, label: "Daily plan built", color: theme.palette.success.main },
  ];

  return (
    <Paper
      variant="outlined"
      sx={{
        borderRadius: 3, p: 2.5, mb: 2.5,
        background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.07)}, ${alpha(theme.palette.ai.main, 0.07)})`,
        borderColor: alpha(theme.palette.primary.main, 0.2),
      }}
    >
      <Typography sx={{ fontWeight: 600, fontSize: 14, mb: 0.5 }}>What this section does</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12.5, lineHeight: 1.6, mb: 2.5, maxWidth: 480 }}>
        Covers your whole reachable archive, weakest topics first — packed into however many days you pick. Enough
        days, and it weaves in self-build exams alongside practice; fewer days just means the same content lands
        denser, never less of it.
      </Typography>

      <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "center" }}>
        {steps.map((s, i) => (
          <Box key={s.label} sx={{ display: "flex", alignItems: "flex-start" }}>
            <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0.75, width: 72 }}>
              <Box
                sx={{
                  width: 40, height: 40, borderRadius: "50%", flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  bgcolor: alpha(s.color, 0.15), color: s.color,
                  animation: `${floatPulse} 2.4s ease-in-out ${i * 0.35}s infinite`,
                }}
              >
                <s.icon size={18} />
              </Box>
              <Typography
                variant="caption"
                sx={{ fontSize: 10.5, fontWeight: 500, color: "text.secondary", textAlign: "center", lineHeight: 1.3 }}
              >
                {s.label}
              </Typography>
            </Box>

            {i < steps.length - 1 && (
              <svg width="28" height="16" style={{ marginTop: 18, flexShrink: 0 }}>
                <line
                  x1="0" y1="2" x2="28" y2="2"
                  stroke={theme.palette.divider}
                  strokeWidth="2"
                  strokeDasharray="4 4"
                  style={{ animation: `${flowDash} 0.8s linear infinite` }}
                />
              </svg>
            )}
          </Box>
        ))}
      </Box>
    </Paper>
  );
}

function DurationPicker({ value, onChange, maxDays }) {
  return (
    <Box sx={{ display: "flex", gap: 0.75 }}>
      {DURATIONS.map((d) => {
        const disabled = maxDays !== undefined && maxDays > 0 && d > maxDays;
        const button = (
          <Button
            key={d}
            size="small"
            variant={value === d ? "contained" : "outlined"}
            disabled={disabled}
            onClick={() => onChange(d)}
            sx={{ minWidth: 0, px: 1.25, fontSize: 12.5 }}
          >
            {d}d
          </Button>
        );
        return disabled ? (
          <Tooltip key={d} title={`Needs more archive practice history for a ${d}-day plan — up to ${maxDays}d supported right now.`}>
            <span>{button}</span>
          </Tooltip>
        ) : button;
      })}
    </Box>
  );
}

function DayCard({ day, batchId, navigate, onPractice, onExam, onToggle, theme, isLast }) {
  const done = Boolean(day.completed);
  const badgeColor = done ? theme.palette.success.main : theme.palette.primary.main;

  return (
    <Box sx={{ display: "flex", gap: 1.5, pb: isLast ? 0 : 2 }}>
      <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
        <Box
          sx={{
            width: 30, height: 30, borderRadius: "50%", flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: `linear-gradient(135deg, ${badgeColor}, ${alpha(badgeColor, 0.7)})`,
            boxShadow: `0 2px 6px ${alpha(badgeColor, 0.45)}`,
            color: "primary.contrastText",
            fontWeight: 600, fontSize: 13,
          }}
          className="tnum"
        >
          {done ? <CheckCircle2 size={16} /> : day.day}
        </Box>
        {!isLast && (
          <Box sx={{ flex: 1, width: 2, my: 0.5, minHeight: 8, bgcolor: done ? alpha(theme.palette.success.main, 0.5) : "divider", borderRadius: 1 }} />
        )}
      </Box>

      <Paper
        variant="outlined"
        sx={{
          borderRadius: 3, p: 2, flex: 1, minWidth: 0,
          boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
          opacity: done ? 0.7 : 1,
          transition: "opacity 0.15s ease",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 1 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography
              variant="overline"
              sx={{ display: "block", color: "primary.main", fontWeight: 600, fontSize: 11, lineHeight: 1.4, letterSpacing: 0.5 }}
            >
              Day {day.day}
            </Typography>
            <Typography
              sx={{
                fontWeight: 500, fontSize: 14, mb: 1.25,
                textDecoration: done ? "line-through" : "none",
              }}
            >
              {day.focus}
            </Typography>
          </Box>
          <Tooltip title={done ? "Mark as not done" : "Mark day as done"}>
            <IconButton size="small" onClick={() => onToggle(!done)} sx={{ mt: -0.5, flexShrink: 0 }}>
              {done
                ? <CheckCircle2 size={20} color={theme.palette.success.main} />
                : <Circle size={20} color={theme.palette.text.disabled} />}
            </IconButton>
          </Tooltip>
        </Box>

        {day.kind === "exam" && day.exam ? (
          <ExamDayCard exam={day.exam} theme={theme} onExam={onExam} />
        ) : (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {day.topics.map((t, i) => {
            const skillColor = t.skillType
              ? theme.palette[skillTypePaletteKey(t.skillType)]?.main || theme.palette.primary.main
              : theme.palette.divider;

            return (
              <Box
                key={i}
                sx={{
                  p: 1.5, borderRadius: 2.5,
                  bgcolor: theme.palette.surfaceAlt || "action.hover",
                  border: "1px solid", borderColor: "divider",
                  borderLeft: "3px solid", borderLeftColor: skillColor,
                }}
              >
                <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 0.75, mb: 0.5 }}>
                  <Typography sx={{ fontWeight: 600, fontSize: 13.5 }}>{t.title}</Typography>
                  {t.skillType && (
                    <Chip
                      label={skillTypeLabel(t.skillType)}
                      size="small"
                      sx={{
                        height: 18, fontSize: 10.5, fontWeight: 600,
                        bgcolor: alpha(skillColor, 0.15), color: skillColor,
                        "& .MuiChip-label": { px: 0.75 },
                      }}
                    />
                  )}
                </Box>

                <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12.5, lineHeight: 1.6, mb: 1.25 }}>
                  {t.note}
                </Typography>

                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  {t.topic && (
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => onPractice(t)}
                      startIcon={<Dumbbell size={13} />}
                      sx={{ fontSize: 11.5, px: 1.25, py: 0.4, borderRadius: 5, flexShrink: 0 }}
                    >
                      Practice
                    </Button>
                  )}
                </Stack>
              </Box>
            );
          })}
        </Box>
        )}
      </Paper>
    </Box>
  );
}

function ExamDayCard({ exam, theme, onExam }) {
  return (
    <Box
      sx={{
        p: 1.75, borderRadius: 2.5,
        bgcolor: alpha(theme.palette.ai.main, 0.08),
        border: "1px solid", borderColor: alpha(theme.palette.ai.main, 0.3),
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 0.5 }}>
        <ClipboardList size={15} color={theme.palette.ai.main} />
        <Typography sx={{ fontWeight: 600, fontSize: 13.5 }}>{exam.title}</Typography>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12.5, lineHeight: 1.6, mb: 1.25 }}>
        A timed self-built paper covering everything in {exam.title} so far.
      </Typography>
      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
        <Button
          size="small"
          variant="contained"
          onClick={() => onExam(exam)}
          startIcon={<ClipboardList size={13} />}
          sx={{ fontSize: 11.5, px: 1.5, py: 0.4, borderRadius: 5, flexShrink: 0 }}
        >
          Start exam
        </Button>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: "flex", alignItems: "center", gap: 0.4, fontSize: 11 }}
        >
          <Hash size={12} /> {exam.questionCount} MCQs · {exam.durationMinutes} min
        </Typography>
      </Stack>
    </Box>
  );
}
