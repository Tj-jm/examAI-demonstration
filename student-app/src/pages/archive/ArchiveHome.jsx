import { Box, Typography, Paper, IconButton, Skeleton } from "@mui/material";
import { useTheme, alpha } from "@mui/material/styles";
import { keyframes } from "@emotion/react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ChevronRight, BookOpen, CalendarCheck, ClipboardList, Star, Target, TrendingUp } from "lucide-react";
import {
  useGetBatchQuery, useGetArchiveFavoriteIdsQuery, useGetArchiveWeakTopicsQuery,
  useGetArchiveStudyPlanQuery, useGetArchiveExamRecordQuery, useGetArchivePredictedSetsQuery,
} from "../../api/contentApi";
import { BatchContextCard } from "../../components/BatchSwitcher";
import FeatureIcon from "../../components/FeatureIcon";
import { useHomeMx } from "../../BrandingContext";

// A small "score, then sample size" block — the percentage is the headline,
// the attempt count underneath is context for how much it should be
// trusted (3 exams reads very differently from 30). Colored by how the
// score is doing, same traffic-light bands the rest of the app already
// uses for accuracy (see skillTypePaletteKey-style thresholds elsewhere).
function ExamScorecard({ percent, attemptCount }) {
  const theme = useTheme();
  const color = percent >= 70 ? theme.palette.success.main : percent >= 40 ? theme.palette.warning.main : theme.palette.error.main;
  return (
    <Box
      sx={{
        flexShrink: 0, minWidth: 56, px: 1.25, py: 0.75, borderRadius: 2, textAlign: "center",
        bgcolor: alpha(color, 0.12), border: "1px solid", borderColor: alpha(color, 0.3),
      }}
    >
      <Typography sx={{ fontSize: 16, fontWeight: 700, lineHeight: 1.15, color }}>{percent}%</Typography>
      <Typography sx={{ fontSize: 9.5, color: "text.secondary", lineHeight: 1.2, whiteSpace: "nowrap" }}>
        {attemptCount} exam{attemptCount === 1 ? "" : "s"}
      </Typography>
    </Box>
  );
}

const confettiBurst = keyframes`
  0% { transform: translate(-50%, -50%) scale(1) rotate(0deg); opacity: 1; }
  100% { transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(0.3) rotate(var(--rot)); opacity: 0; }
`;

const CONFETTI_COLORS = ["#f43f5e", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899"];

// A one-shot burst, not a loop — plays out over ~1s and stays gone
// (animation-fill-mode: forwards), same "reward the exact moment it
// happens" spirit as a confetti cannon, not a decoration that runs forever.
// Replays on every mount rather than tracking "already celebrated this"
// anywhere — a plan showing fully done twice in a row is rare enough that a
// second burst is a nice surprise, not noise, and isn't worth a persisted
// flag for.
function ConfettiBurst({ count = 14 }) {
  const particles = Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * 2 * Math.PI + Math.random() * 0.4;
    const distance = 22 + Math.random() * 20;
    return {
      key: i,
      dx: Math.cos(angle) * distance,
      dy: Math.sin(angle) * distance,
      rot: Math.round(Math.random() * 360),
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      delay: Math.random() * 0.12,
      round: i % 2 === 0,
    };
  });

  return (
    <Box sx={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {particles.map((p) => (
        <Box
          key={p.key}
          sx={{
            position: "absolute", top: "50%", left: "50%", width: 5, height: 5,
            bgcolor: p.color, borderRadius: p.round ? "50%" : "1px",
            "--dx": `${p.dx}px`, "--dy": `${p.dy}px`, "--rot": `${p.rot}deg`,
            animation: `${confettiBurst} 0.9s ease-out ${p.delay}s forwards`,
          }}
        />
      ))}
    </Box>
  );
}

// Days left vs. days already done, as a two-segment donut with the raw
// "days left" count at its center — same hand-drawn <circle> technique as
// ArchiveStudyPlan.jsx's own PlanDonut (that one breaks days down by kind;
// this one only needs done vs. not-done, so it stays a separate, simpler
// component rather than reusing that one with unused segments). The
// remaining-days arc shifts red-to-green as daysLeft shrinks — not a fixed
// color — so the ring itself visibly improves as the plan gets worked
// through, not just the number at its center. At 0 left, a one-shot
// confetti burst fires instead of a static green ring.
function DaysLeftDonut({ daysLeft, total, theme, size = 44, thickness = 6 }) {
  const done = total - daysLeft;
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;

  const percentLeft = daysLeft / total;
  const hue = Math.round((1 - percentLeft) * 120); // 0 = red (all left), 120 = green (none left)
  const progressColor = `hsl(${hue}, 70%, 42%)`;

  let offset = 0;
  // Fully done gets a solid green ring (the finished state, not "0% of the
  // colored arc left to show") rather than the two-arc split below —
  // otherwise the moment being celebrated would render as a plain gray
  // circle, which reads as empty/broken, not complete.
  const arcs = daysLeft === 0
    ? [{ count: total, color: theme.palette.success.main }]
    : [
        { count: done, color: theme.palette.action.hover },
        { count: daysLeft, color: progressColor },
      ].filter((s) => s.count > 0);

  return (
    <Box sx={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        {arcs.map((s, i) => {
          const length = (s.count / total) * circumference;
          const dashoffset = -offset;
          offset += length;
          return (
            <circle
              key={i}
              cx={size / 2} cy={size / 2} r={radius} fill="none"
              stroke={s.color} strokeWidth={thickness}
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={dashoffset}
              style={{ transition: "stroke 0.4s ease" }}
            />
          );
        })}
      </svg>
      <Box sx={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <Typography sx={{ fontSize: 13, fontWeight: 700, lineHeight: 1.1 }} className="tnum">{daysLeft}</Typography>
        <Typography sx={{ fontSize: 7.5, color: "text.secondary", lineHeight: 1 }}>left</Typography>
      </Box>
      {daysLeft === 0 && <ConfettiBurst />}
    </Box>
  );
}

// The archive's own entry hub — one level inside a batch's "Archive" tile,
// mirroring BatchHome's own "Jump to" grid at a smaller scale. This exists
// so the browse/filter page (ArchiveBrowse.jsx) doesn't have to carry
// weak-topics, favorites AND study-plan/exam entry points all stacked onto
// one already-busy screen — each gets its own tile here instead.
//
// Deliberately one plain list layout, not BatchHome's three selectable
// styles (list/iconGrid/cardGrid) — building three designs for a brand new
// hub is disproportionate to what was asked; this can grow that way later
// if it turns out to matter.
export default function ArchiveHome() {
  const { batchId } = useParams();
  const mx = useHomeMx();
  const navigate = useNavigate();
  const theme = useTheme();
  const { data: batch, isLoading } = useGetBatchQuery(batchId);
  const { data: favoriteData } = useGetArchiveFavoriteIdsQuery(batchId);
  const { data: weakData } = useGetArchiveWeakTopicsQuery(batchId);
  const { data: planData } = useGetArchiveStudyPlanQuery(batchId);
  const { data: examRecord } = useGetArchiveExamRecordQuery(batchId);
  const { data: predictedData } = useGetArchivePredictedSetsQuery(batchId);
  const predictedSets = predictedData?.sets || [];

  if (isLoading || !batch) {
    return <Box sx={{ p: 3 }}><Skeleton variant="rounded" height={200} /></Box>;
  }

  const weakest = weakData?.topics?.[0];
  const plan = planData?.plan;
  const daysLeft = plan ? plan.days.filter((d) => !d.completed).length : null;
  const favoriteCount = favoriteData?.ids?.length || 0;

  // The archive study plan needs both switches server-side
  // (archiveRoutes.js: archiveAiAssist + archiveStudyPlan).
  const studyPlanOn = Boolean(batch.features?.archiveAiAssist && batch.features?.archiveStudyPlan);

  const tiles = [
    {
      to: `/batches/${batchId}/archive/browse`, label: "Browse & Practice", Icon: BookOpen, featureKey: "archiveBrowse",
      desc: weakest
        ? `Weakest so far: ${weakest.title} (${weakest.accuracy}%)`
        : "Filter by board, subject, year and type",
      trailing: weakest ? <Target size={18} color={theme.palette.ai.main} style={{ flexShrink: 0 }} /> : null,
    },
    studyPlanOn && {
      to: `/batches/${batchId}/archive/study-plan`, label: "Study Plan", Icon: CalendarCheck, featureKey: "archiveStudyPlan",
      desc: plan
        ? daysLeft > 0
          ? `${daysLeft} of ${plan.days.length} day${plan.days.length === 1 ? "" : "s"} left`
          : `All ${plan.days.length} days done — regenerate for more`
        : "A weakest-topics-first plan from your archive accuracy",
      trailing: plan ? <DaysLeftDonut daysLeft={daysLeft} total={plan.days.length} theme={theme} /> : null,
    },
    {
      to: `/batches/${batchId}/archive/exam-setup`, label: "Build a practice exam", Icon: ClipboardList, featureKey: "archiveExam",
      desc: examRecord?.attemptCount > 0
        ? "Your archive exam average"
        : "A timed paper built from your own choice of topics",
      trailing: examRecord?.attemptCount > 0 ? <ExamScorecard percent={examRecord.averagePercent} attemptCount={examRecord.attemptCount} /> : null,
    },
    {
      to: `/batches/${batchId}/archive/session/favorites`, label: "My Favorites", Icon: Star, featureKey: "archiveFavorites",
      desc: favoriteCount
        ? `${favoriteCount} question${favoriteCount === 1 ? "" : "s"} saved`
        : "Questions you've starred while practicing",
    },
  ].filter(Boolean);

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 800, mx }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
        <IconButton size="small" onClick={() => navigate(`/batches/${batchId}`)}><ArrowLeft size={18} /></IconButton>
      </Box>

      <BatchContextCard batch={batch} pageName="Archive" />

      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>Jump to</Typography>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
        {tiles.map(({ to, label, desc, Icon, featureKey, trailing }) => (
          <Paper
            key={to}
            variant="outlined"
            onClick={() => navigate(to)}
            sx={{ p: 2.5, borderRadius: 3, cursor: "pointer", display: "flex", alignItems: "center", gap: 2 }}
          >
            <Box sx={{
              width: 44, height: 44, flexShrink: 0, borderRadius: 2,
              bgcolor: "action.hover", display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <FeatureIcon featureKey={featureKey} Default={Icon} size={20} customSize={44} />
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontWeight: 500 }}>{label}</Typography>
              <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>{desc}</Typography>
            </Box>
            {trailing || <ChevronRight size={18} style={{ flexShrink: 0, opacity: 0.5 }} />}
          </Paper>
        ))}
      </Box>

      {/* Predicted papers an admin shared as practice sets — AI's pick of
          the likeliest next paper for one of this batch's boards. */}
      {predictedSets.length > 0 && (
        <>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 3, mb: 1.5 }}>Predicted papers</Typography>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
            {predictedSets.map((set) => (
              <Paper
                key={set._id}
                variant="outlined"
                onClick={() => navigate(`/batches/${batchId}/archive/session/predicted:${set._id}`)}
                sx={{ p: 2.5, borderRadius: 3, cursor: "pointer", display: "flex", alignItems: "center", gap: 2 }}
              >
                <Box sx={{
                  width: 44, height: 44, flexShrink: 0, borderRadius: 2,
                  bgcolor: "ai.bg", display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <TrendingUp size={20} color={theme.palette.ai.main} />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 500 }}>{set.title}</Typography>
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
                    {set.questionCount} question{set.questionCount === 1 ? "" : "s"} · the topics most likely to come up
                  </Typography>
                </Box>
                <ChevronRight size={18} style={{ flexShrink: 0, opacity: 0.5 }} />
              </Paper>
            ))}
          </Box>
        </>
      )}
    </Box>
  );
}
