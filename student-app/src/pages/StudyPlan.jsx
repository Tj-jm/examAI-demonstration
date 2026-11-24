import { useEffect, useState } from "react";
import { Box, Typography, Paper, Button, IconButton, Skeleton, Alert, CircularProgress, Chip, Stack, Tooltip } from "@mui/material";
import { useTheme, alpha } from "@mui/material/styles";
import { keyframes } from "@emotion/react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, CalendarCheck, Sparkles, RotateCw, Dumbbell, PlayCircle, TrendingUp, Target, CheckCircle2, Circle,
  ClipboardList, Hash,
} from "lucide-react";
import {
  useGetBatchQuery, useGetStudyPlanQuery, useGetStudyPlanCapacityQuery, useGenerateStudyPlanMutation, useToggleStudyPlanDayMutation,
} from "../api/contentApi";
import { BatchContextCard } from "../components/BatchSwitcher";
import EmptyState from "../components/EmptyState";
import FeatureGate from "../components/FeatureGate";
import AiUsageMeter from "../components/AiUsageMeter";
import PracticeModal from "./practice/PracticeModal";
import { skillTypeLabel, skillTypePaletteKey } from "../constants/skillTypes";
import { useSales, useTerms } from "../BrandingContext";
import { mascotReact } from "../components/Mascot";

const DURATIONS = [3, 5, 7, 15, 30];

// Student-triggered only, on purpose — no automatic regeneration after a
// graded exam. A "Regenerate" button doubles as the one place this feature
// ever costs anything, which is what makes an admin-configurable free/paid
// toggle for it meaningful (see Settings > AI > "Free study plans").
export default function StudyPlan() {
  const sales = useSales();
  const terms = useTerms();
  const { batchId } = useParams();
  const navigate = useNavigate();
  const theme = useTheme();
  const { data: batch } = useGetBatchQuery(batchId);
  const { data, isLoading } = useGetStudyPlanQuery(batchId);
  // undefined while loading — DurationPicker treats that as "don't gray
  // anything out yet" rather than briefly flashing every option disabled.
  const { data: capacityData } = useGetStudyPlanCapacityQuery(batchId);
  const maxDays = capacityData?.maxDays;
  // How long a plan needs to be to cover the whole batch with nothing
  // compressed — every topic gets its own lecture, practice, and exam day.
  // Purely informational now: every duration the picker offers builds a
  // full-batch plan (buildSchedule packs tighter instead of covering
  // less), so this is a hint about density, never a cap on what's usable.
  const idealDays = capacityData?.idealDays;
  const [generate, { isLoading: generating, error: generateErrorRaw, reset }] = useGenerateStudyPlanMutation();
  const [toggleDay] = useToggleStudyPlanDayMutation();

  const [dismissed, setDismissed] = useState(false);
  const [durationDays, setDurationDays] = useState(7);
  const [practiceFor, setPracticeFor] = useState(null);

  const plan = data?.plan;

  // Once a plan exists, the picker should reflect what it was actually built
  // with rather than whatever the default happens to be — but only when the
  // plan itself changes (a fresh fetch, or after a regenerate), never on
  // every render, so picking a new length before hitting Regenerate isn't
  // immediately stomped back to the old plan's length.
  useEffect(() => {
    // The length picked last time; durationDays is what got built, which
    // can be shorter than any length the picker offers.
    const picked = plan?.requestedDays || plan?.durationDays;
    if (picked) setDurationDays(DURATIONS.includes(picked) ? picked : DURATIONS.find((d) => d >= picked) || DURATIONS[DURATIONS.length - 1]);
  }, [plan?.durationDays, plan?.requestedDays, plan?.generatedAt]);

  // A picked length the content can no longer back up (or never could, on
  // first load) is stepped down to the longest one that's still actually
  // enabled — otherwise the picker could show a grayed-out pill sitting
  // selected, which reads as broken rather than as "not enough content yet".
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

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 640, mx: "auto" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
        <IconButton size="small" onClick={() => navigate(`/batches/${batchId}`)}><ArrowLeft size={18} /></IconButton>
      </Box>

      <BatchContextCard batch={batch} pageName="Study Plan" />

      <FeatureGate batch={batch} feature="studyPlan" label="Study Plan">
      <AiUsageMeter batchId={batchId} />

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
          ) : !plan ? (
            <>
              <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0.5, mb: 1 }}>
                <DurationPicker value={durationDays} onChange={setDurationDays} maxDays={maxDays} />
                {Boolean(idealDays) && (
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
                    Full coverage (lectures + exams, nothing packed together) takes about {idealDays} days — a
                    shorter plan covers the same ground, just denser.
                  </Typography>
                )}
              </Box>
              <EmptyState
                icon={CalendarCheck}
                title="No study plan yet"
                description={capacityData?.reason || `Generate a plan covering your whole ${terms.batch}, built around your own practice accuracy — weakest topics first, packed to fit however many days you pick.`}
                action={capacityData?.reason ? undefined : { label: `Generate my ${durationDays}-day plan`, onClick: run }}
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

                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, flexWrap: "wrap" }}>
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
                </Box>
              </Paper>

              <Box sx={{ display: "flex", flexDirection: "column" }}>
                {plan.days.map((day, i) => (
                  <DayCard
                    key={day.day}
                    day={day}
                    batchId={batchId}
                    navigate={navigate}
                    onPractice={(t) =>
                      setPracticeFor({
                        // Same "chapter:<id>" composite PracticeSession.jsx's
                        // own route already parses — a chapter-pool day's
                        // "topic" id is really a Chapter id (see
                        // studyPlanModel.js), so it has to be told apart from
                        // a real topic id before PracticeModal fetches
                        // questions for it.
                        topicId: t.chapterPool ? `chapter:${t.topic}` : t.topic,
                        topicTitle: t.title,
                        skillType: t.skillType,
                        // buildSchedule always assigns the exact right
                        // skillType already — a real skill, "none" for a
                        // round-out day, or left absent on purpose (the
                        // revision day, and a topic with no skill breakdown
                        // yet, which should draw from its whole pool, not
                        // have one auto-picked for it). Never auto-pick here
                        // on top of that.
                        autoSkill: false,
                      })
                    }
                    onToggle={(completed) => { toggleDay({ batchId, day: day.day, completed }); if (completed) mascotReact("cheer", "Day done!"); }}
                    onExam={(exam) =>
                      // Reuses the existing self-build-exam flow
                      // (CustomExamSetup.jsx) rather than a second
                      // taking/grading/review implementation — autoStart
                      // tells it to skip the setup screen and launch
                      // straight into this exact paper.
                      navigate(`/batches/${batchId}/exams/custom-exam-setup`, {
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
        open={Boolean(practiceFor)}
        onClose={() => setPracticeFor(null)}
        batchId={batchId}
        topicId={practiceFor?.topicId}
        topicTitle={practiceFor?.topicTitle}
        skillType={practiceFor?.skillType}
        autoSkill={practiceFor?.autoSkill}
      />
      </FeatureGate>
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

// The section's own "why" — shown above the plan whether one exists yet or
// not, since a student deciding whether to bother generating one needs this
// as much as a student already looking at a full week. Three animated
// nodes rather than a static sentence: the same idea ("your data → what's
// found → what you get") reads faster as a little pipeline than as prose,
// and it's the one place on this page allowed to be purely decorative.
function GoalBanner({ theme }) {
  const steps = [
    { icon: TrendingUp, label: "Your accuracy", color: theme.palette.primary.main },
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
        Covers your whole batch, weakest topics first — packed into however many days you pick. Enough days, and it
        weaves in lectures and self-build exams alongside practice; fewer days just means the same content lands
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

// 3/5/7/15/30 day pills. Shown both before a plan exists (picks what
// "Generate" builds) and once one does (picks what "Regenerate" rebuilds
// with) — same control, same state, so switching it before regenerating is
// the only way its value changes underneath an existing plan.
//
// maxDays grays out a length this student's current weak-topic content
// can't actually back up (see studyPlanController.js's capacityDays) —
// caught here, before generating, rather than letting the student pick 30
// and quietly get a 9-day plan back. undefined (still loading, or nothing
// weak found yet) leaves every option enabled rather than flashing them
// all disabled first.
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
          <Tooltip key={d} title={`Needs more practice history for a ${d}-day plan — up to ${maxDays}d supported right now.`}>
            <span>{button}</span>
          </Tooltip>
        ) : button;
      })}
    </Box>
  );
}

// A day's card no longer floats its number off to the side disconnected
// from the ones around it — the circle and the line running down from it
// make the 7 days read as one path from day 1 to day 7, not 7 unrelated
// cards that happen to be stacked. The line is drawn per-row (flex:1
// filling the row's own height, including its bottom padding) rather than
// as one absolutely-positioned line spanning the whole list, so it keeps
// working no matter how tall any individual day's card ends up.
function DayCard({ day, batchId, navigate, onPractice, onExam, onToggle, theme, isLast }) {
  const done = Boolean(day.completed);
  // Its questions or lecture were removed, or the batch's feature is off
  // (backend utils/tutor.js syncPlan): no buttons that would lead nowhere.
  const gone = Boolean(day.unavailable) && !done;
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
          opacity: done || gone ? 0.7 : 1,
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

        {gone ? (
          <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12.5, lineHeight: 1.6 }}>
            Skipped: this day's {day.kind === "lecture" ? "lecture isn't" : "questions aren't"} in this batch any more. Move on to the next day, or make a new plan.
          </Typography>
        ) : day.kind === "exam" && day.exam ? (
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
                  {t.lecture?.lecture && (
                    <Tooltip title={t.lecture.title}>
                      <Button
                        size="small"
                        onClick={() => navigate(`/batches/${batchId}/lectures/${t.lecture.lecture}`)}
                        startIcon={<PlayCircle size={13} />}
                        sx={{
                          fontSize: 11.5, px: 1.25, py: 0.4, borderRadius: 5, flexShrink: 0,
                          bgcolor: alpha(theme.palette.ai.main, 0.12), color: theme.palette.ai.main,
                          "&:hover": { bgcolor: alpha(theme.palette.ai.main, 0.2) },
                        }}
                      >
                        Watch lecture
                      </Button>
                    </Tooltip>
                  )}
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

// A self-build exam scoped to one topic — launches straight into it, no
// setup screen (see StudyPlan.jsx's onExam, which navigates to
// CustomExamSetup.jsx with autoStart params matching `exam` exactly).
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
