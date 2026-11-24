import {
  Box, Typography, Paper, LinearProgress, Button, IconButton, Skeleton, useMediaQuery,
} from "@mui/material";
import { useState } from "react";
import { useTheme, alpha } from "@mui/material/styles";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, PlayCircle, PenLine, Users, Dumbbell, Code2, Trophy, Clock, ChevronRight, HelpCircle, Zap, Megaphone, Crown,
  Infinity as InfinityIcon, Video, CalendarCheck, Library, MessagesSquare, Gauge, ClipboardList, GraduationCap, Layers, ShoppingBag, Mic, Play, Radio } from "lucide-react";
import { useGetBatchQuery, useGetDocChatSettingsQuery } from "../api/contentApi";
import { Presentation } from "lucide-react";
import { useSales, useTerms, useBranding } from "../BrandingContext";
import { RESTRAINED_DESIGNS, getBoldFill } from "../theme/buildTheme";
import BatchIcon from "../components/BatchIcon";
import EmptyState from "../components/EmptyState";
import { TeacherStrip } from "../components/Teachers";
import FeatureIcon from "../components/FeatureIcon";
import { TutorAgentIcon } from "../components/AgentIcons";
import { MascotOnce } from "../components/Mascot";

const ACCESS_COPY = {
  free: () => "Free access",
  trial: (days) => `Trial — ${days} day${days === 1 ? "" : "s"} left`,
  purchase: (days, date) => `Active — until ${date}`,
};

// The hub for one batch — where the dashboard's batch card actually leads.
// Everything on it is scoped to this one batch specifically, which is the
// whole reason it exists rather than just sending a student straight into
// the (multi-batch, unscoped) lecture/exam lists.
//
// The hero, trial/access banner and stat tiles stay the same regardless of
// style choice — that's load-bearing information, not decoration. Only the
// "jump to" actions section below it actually changes shape between the
// three admin-selectable styles (list / iconGrid / cardGrid).
export default function BatchHome() {
  const sales = useSales();
  const terms = useTerms();
  const { batchId } = useParams();
  const navigate = useNavigate();
  const { design, batchHomeStyle, featureNames, compactMobile, compactShort, mobileTeachers } = useBranding();
  // Settings → Student app → Compact top area, on a phone or on a short
  // wider screen (a laptop, a tablet held sideways): the banner, access line
  // and stat tiles shrink so the actions start on the first screen.
  const phone = useMediaQuery("(max-width:599px)");
  const short = useMediaQuery("(max-height:820px)");
  const compact = phone ? compactMobile : short && compactShort;
  const theme = useTheme();
  const editorial = RESTRAINED_DESIGNS.has(design);
  const fill = !editorial ? getBoldFill(design, theme) : null;
  const { data: batch, isLoading, isError } = useGetBatchQuery(batchId);
  // The batch switch alone isn't enough: the platform switch and "where
  // students can ask" (Settings → AI → Course chat) decide too.
  const chatBatchOn = Boolean(batch?.features?.aiAssist && batch?.features?.docChat);
  const { data: chatSettings } = useGetDocChatSettingsQuery(batchId, { skip: !chatBatchOn, refetchOnMountOrArgChange: true });
  const courseChatOn = chatBatchOn && chatSettings?.enabled && chatSettings?.scope !== "lecture";

  // Not enrolled, access ended, or a stale link: the request fails and there
  // is no batch to show, so say so instead of loading forever.
  if (!isLoading && (isError || !batch)) {
    return (
      <EmptyState
        icon={Layers}
        tone="blocked"
        title={`You can't open this ${terms.batch}`}
        description={sales ? `You may not be in this ${terms.batch}, or your access has ended.` : `You may not be in this ${terms.batch}. Ask your ${terms.org} if you are expecting it.`}
        action={sales ? { label: `Browse ${terms.batches}`, icon: ShoppingBag, onClick: () => navigate("/purchases") } : { label: "Go home", onClick: () => navigate("/") }}
        secondaryAction={sales ? { label: "Go home", onClick: () => navigate("/") } : undefined}
      />
    );
  }

  if (isLoading || !batch) {
    return <Box sx={{ p: 3 }}><Skeleton variant="rounded" height={280} /></Box>;
  }

  const { progress } = batch;
  const lecturePct = progress.lectureCount > 0 ? Math.round((progress.watchedCount / progress.lectureCount) * 100) : 0;
  const daysLeft = batch.expiresAt && !batch.neverExpires
    ? Math.max(0, Math.ceil((new Date(batch.expiresAt) - Date.now()) / 86400000))
    : null;
  const isTrialLow = batch.accessVia === "trial" && daysLeft !== null && daysLeft <= 3;
  // A paid access's own runway is longer than a trial's — a trial running
  // out is already the free preview ending, so 3 days is plenty of warning.
  // Paid access lapsing is the moment renewal actually needs to happen, so
  // "you can top up" starts 15 days out, well before it's urgent, and only
  // escalates to the same warning treatment as isTrialLow once inside the
  // final week.
  const canTopUp = batch.accessVia === "purchase" && daysLeft !== null && daysLeft <= 15;
  const isPurchaseLow = canTopUp && daysLeft <= 7;
  const isLow = isTrialLow || isPurchaseLow;

  const statusText = batch.accessType === "free"
    ? ACCESS_COPY.free()
    : batch.accessVia === "trial"
      ? ACCESS_COPY.trial(daysLeft)
      : batch.neverExpires
        ? "Active — lifetime access"
        : ACCESS_COPY.purchase(daysLeft, batch.expiresAt ? new Date(batch.expiresAt).toLocaleDateString() : "");

  // Colors are drawn only from tokens already verified to work across every
  // theme x light/dark x design combination (see the practice-session and
  // doubt-thread features) — never invented per-action hues, which could
  // clash unpredictably against whichever accent theme is active.
  // A section with nothing in it gets no icon (counts from the server; an
  // older server without them shows everything as before).
  const counts = batch.counts;
  const has = (k) => !counts || (counts[k] || 0) > 0;
  const actions = [
    batch.features?.lectures && has("lectures") && {
      to: `/batches/${batchId}/lectures`, label: "Lectures", Icon: PlayCircle, featureKey: "lectures",
      desc: `${progress.watchedCount}/${progress.lectureCount} watched`,
      color: theme.palette.primary.main, pct: progress.lectureCount > 0 ? lecturePct : undefined,
    },
    batch.features?.practice && has("practice") && {
      to: `/batches/${batchId}/practice`, label: "Practice", Icon: Dumbbell, featureKey: "practice",
      desc: "Topic by topic, instant feedback",
      color: theme.palette.warning.main,
    },
    batch.features?.lectureSlides && (counts?.slides || 0) > 0 && {
      to: `/batches/${batchId}/slides`, label: "Slides", Icon: Presentation, featureKey: "lectureSlides",
      desc: `${counts.slides} lecture deck${counts.slides === 1 ? "" : "s"}`,
      color: theme.palette.secondary?.main || theme.palette.primary.main,
    },
    batch.features?.codingPractice && {
      to: `/batches/${batchId}/coding`, label: "Coding practice", Icon: Code2, featureKey: "codingPractice",
      desc: "Write code, run it, pass every test",
      color: theme.palette.success?.main || theme.palette.primary.main,
    },
    batch.hasArchive && {
      to: `/batches/${batchId}/archive`, label: "Archive", Icon: Library, featureKey: "archive",
      desc: "Practice real board/exam questions",
      color: theme.palette.info?.main || theme.palette.primary.main,
    },
    batch.features?.exams && has("exams") && {
      to: `/batches/${batchId}/exams`, label: "Exams", Icon: PenLine, featureKey: "exams",
      desc: `${progress.examCount} available`,
      color: theme.palette.error.main,
    },
    has("exams") && {
      to: `/results?batchId=${batchId}`, label: "Results", Icon: Trophy, featureKey: "results",
      desc: progress.averageScore !== null ? `${progress.averageScore}% average here` : "No attempts yet",
      color: theme.palette.success.main,
    },
    ((batch.features?.practice && has("practice")) || (batch.features?.exams && has("exams"))) && {
      to: `/batches/${batchId}/progress`, label: "My progress", Icon: Gauge, featureKey: "progress",
      desc: "Your level, quests and how you're doing",
      color: theme.palette.primary.main,
    },
    has("notices") && {
      to: `/batches/${batchId}/notices`, label: "Notice Central", Icon: Megaphone, featureKey: "notices",
      desc: `Announcements for this ${terms.batch}`,
      color: theme.palette.primary.main,
    },
    batch.features?.exams && has("exams") && {
      to: `/batches/${batchId}/leaderboard`, label: "Leaderboard", Icon: Crown, featureKey: "leaderboard",
      desc: `See how you rank in this ${terms.batch}`,
      color: theme.palette.warning.main,
    },
    batch.features?.doubtSolving && {
      to: `/batches/${batchId}/doubts`, label: "Doubts", Icon: HelpCircle, featureKey: "doubts",
      desc: "Ask AI or a real person",
      color: theme.palette.ai.main,
    },
    batch.gradesPublished && {
      to: `/batches/${batchId}/grades`, label: "Grades", Icon: GraduationCap, group: "test",
      desc: "Your report card",
      color: theme.palette.success?.main || theme.palette.primary.main,
    },
    batch.features?.assignments !== false && has("assignments") && {
      to: `/batches/${batchId}/assignments`, label: "Assignments", Icon: ClipboardList, featureKey: "assignments",
      desc: "Work to hand in, and your grades",
      color: theme.palette.primary.main,
    },
    batch.features?.liveClasses && has("liveClasses") && {
      to: `/batches/${batchId}/live-classes`, label: "Live Classes", Icon: Video, featureKey: "liveClasses",
      desc: "Scheduled and ongoing sessions",
      color: theme.palette.error.main,
    },
    batch.features?.agentTutor && {
      to: `/batches/${batchId}/tutor`, label: "My tutor", Icon: TutorAgentIcon, featureKey: "tutor",
      desc: "Today's plan, made from your own results",
      color: theme.palette.ai.main,
    },
    batch.features?.studyPlan && {
      to: `/batches/${batchId}/study-plan`, label: "Study Plan", Icon: CalendarCheck, featureKey: "studyPlan",
      desc: "A study plan from your own weak topics",
      color: theme.palette.ai.main,
    },
    courseChatOn && {
      to: `/batches/${batchId}/chat`, label: "Ask your course", Icon: MessagesSquare, featureKey: "docChat",
      desc: "Answers from your lecture notes and files",
      color: theme.palette.ai.main,
    },
    batch.features?.aiAssist && batch.features?.poraDhora && batch.aiPoraDhora && {
      to: `/batches/${batchId}/pora`, label: "Oral Quiz", Icon: Mic, featureKey: "poraDhora",
      desc: "A teacher asks you about a lecture",
      color: theme.palette.ai.main,
    },
    batch.features?.aiAssist && batch.features?.aiTutor && batch.aiTutor && {
      to: `/batches/${batchId}/tutoring`, label: "AI Tutoring", Icon: PenLine, featureKey: "aiTutor",
      desc: "A tutor checks your understanding and marks your answers",
      color: theme.palette.ai.main,
    },
    batch.features?.aiAssist && batch.features?.interview && batch.aiInterview && {
      to: `/batches/${batchId}/interview`, label: "Interview practice", Icon: Users, featureKey: "interview",
      desc: "A viva or interview panel asks, you answer out loud",
      color: theme.palette.ai.main,
    },
    sales && batch.features?.aiAssist && {
      to: `/batches/${batchId}/ai-credits`, label: "AI credits", Icon: Zap, featureKey: "aiCredits",
      desc: "Buy more once today's free use runs out",
      color: theme.palette.ai.main,
    },
  ].filter(Boolean).map((action) => ({
    ...action,
    label: featureNames?.[action.featureKey] || action.label,
  }));

  // Bento and Tabs: their own page (below), led by what to do next.
  if (MODERN_STYLES.includes(batchHomeStyle)) {
    const nudgeNow = isTrialLow
      ? `Trial ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}. Upgrade to keep going!`
      : isPurchaseLow ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} left. Time to renew?` : null;
    return (
      <>
        {nudgeNow && <MascotOnce mood="act" move="point" say={nudgeNow} once={`access:${batchId}:${daysLeft}`} delay={1500} />}
        <ModernBatchHome
          style={batchHomeStyle} batch={batch} batchId={batchId} actions={actions} navigate={navigate} theme={theme}
          fill={fill} editorial={editorial} compact={compact} phone={phone} mobileTeachers={mobileTeachers}
          statusText={statusText} daysLeft={daysLeft} isLow={isLow} canTopUp={canTopUp} lecturePct={lecturePct} has={has}
        />
      </>
    );
  }

  // The mascot's nudge when access is running out, once per browser session.
  const nudge = isTrialLow
    ? `Trial ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}. Upgrade to keep going!`
    : isPurchaseLow
      ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} left. Time to renew?`
      : null;

  return (
    <Box sx={{ pb: 4 }}>
      {nudge && <MascotOnce mood="act" move="point" say={nudge} once={`access:${batchId}:${daysLeft}`} delay={1500} />}
      <Box
        sx={editorial ? {
          p: compact ? 1.5 : { xs: 2, md: 3 }, pb: compact ? 1.5 : { xs: 2.5, md: 3.5 },
          bgcolor: "background.paper", color: "text.primary",
          borderBottom: 1, borderColor: "divider",
        } : {
          p: compact ? 1.5 : { xs: 2, md: 3 }, pb: compact ? 1.5 : { xs: 2.5, md: 3.5 },
          background: fill.background, color: fill.color,
          ...(fill.border ? { borderBottom: fill.border, boxShadow: fill.boxShadow } : {}),
        }}
      >
        {/* Constrained to the same 900px + centered as the content below —
            without this, WebLayout (the sidebar desktop mode, which gives
            content unlimited width unlike the 480px-capped app layout)
            stretches this banner full-width while the body content stays
            narrower, so the two sections' edges never line up. */}
        <Box sx={{ maxWidth: 900, mx: "auto", width: "100%" }}>
          {/* Compact puts the back button on the title row. */}
          {!compact && (
            <IconButton onClick={() => navigate("/")} sx={{ color: "inherit", ml: -1, mb: 1 }}>
              <ArrowLeft size={18} />
            </IconButton>
          )}

          <Box sx={{ display: "flex", alignItems: "center", gap: compact ? 1.25 : 2, px: compact ? 0 : { xs: 1, md: 2 } }}>
            {compact && (
              <IconButton onClick={() => navigate("/")} sx={{ color: "inherit", ml: -0.5 }}>
                <ArrowLeft size={18} />
              </IconButton>
            )}
            <Box sx={{
              width: compact ? 44 : 60, height: compact ? 44 : 60, flexShrink: 0, overflow: "hidden",
              borderRadius: editorial ? 1 : 3,
              bgcolor: editorial ? "action.hover" : "rgba(255,255,255,0.18)",
              color: editorial ? "primary.main" : "inherit",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <BatchIcon icon={batch.icon} size={compact ? 44 : 60} />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="caption" sx={{ opacity: editorial ? 1 : 0.8, color: editorial ? "text.secondary" : "inherit" }}>
                {batch.program?.title}
              </Typography>
              <Typography variant="h5" noWrap sx={compact ? { fontSize: 19 } : undefined}>{batch.name}</Typography>
            </Box>
          </Box>
        </Box>
      </Box>

      <Box sx={{ p: compact ? 1.5 : { xs: 2, md: 4 }, maxWidth: 900, mx: "auto" }}>
        <Paper
          variant="outlined"
          sx={{
            p: compact ? 1.25 : 2, borderRadius: 3, mb: compact ? 1.5 : 3, display: "flex", alignItems: "center", gap: 2,
            borderColor: isLow ? "warning.main" : "divider",
            bgcolor: isLow ? theme.palette.warningBg : "background.paper",
          }}
        >
          <Clock size={18} style={{ flexShrink: 0, ...(isLow ? { color: theme.palette.warning.main } : {}) }} />
          <Typography sx={{ fontWeight: 500, fontSize: 14, flex: 1, color: isLow ? "warning.main" : undefined }}>{statusText}</Typography>
          {(batch.accessVia === "trial" || canTopUp) && (
            <Button
              size="small"
              variant={isLow ? "contained" : "outlined"}
              color={isLow ? "warning" : "primary"}
              onClick={() => navigate(`/purchases/${batchId}`)}
              sx={{ mr: batch.accessType !== "free" ? 1.5 : 0, flexShrink: 0 }}
            >
              {batch.accessVia === "trial" ? "Upgrade" : "Top up"}
            </Button>
          )}
          {batch.accessType !== "free" && (
            <DaysLeftRing
              daysLeft={daysLeft}
              neverExpires={Boolean(batch.neverExpires)}
              totalDays={batch.accessVia === "trial" ? batch.trialDays : undefined}
              theme={theme}
              size={compact ? 36 : 46}
            />
          )}
        </Paper>

        {(!phone || mobileTeachers) && <TeacherStrip teachers={batch.teachers} label={terms.Teachers} sx={{ mb: compact ? 1.5 : 3 }} />}

        {(() => {
          // Only what this batch has: no lectures, no lectures tile.
          const tiles = [
            has("lectures") && <StatTile key="l" compact={compact} value={`${progress.watchedCount}/${progress.lectureCount}`} label="Lectures" pct={progress.lectureCount > 0 ? lecturePct : undefined} />,
            has("exams") && <StatTile key="e" compact={compact} value={progress.examsTaken} label="Exams taken" />,
            has("exams") && <StatTile key="a" compact={compact} value={progress.averageScore !== null ? `${progress.averageScore}%` : "—"} label="Average score" />,
          ].filter(Boolean);
          return tiles.length > 0 && (
            <Box sx={{ display: "grid", gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))`, gap: { xs: 1, sm: 2 }, mb: compact ? 2 : 4 }}>{tiles}</Box>
          );
        })()}

        {batchHomeStyle === "iconGrid" ? (
          <ActionsIconGrid actions={actions} navigate={navigate} />
        ) : batchHomeStyle === "cardGrid" ? (
          <ActionsCardGrid actions={actions} navigate={navigate} />
        ) : (
          <ActionsList actions={actions} navigate={navigate} />
        )}
      </Box>
    </Box>
  );
}

function StatTile({ value, label, pct, compact }) {
  return (
    <Paper variant="outlined" sx={{ p: compact ? 0.75 : { xs: 1.25, sm: 2 }, borderRadius: 3, textAlign: "center" }}>
      <Typography variant="h5" sx={{ fontWeight: 500, fontSize: compact ? 16 : { xs: 18, sm: 24 } }} noWrap>{value}</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ fontSize: { xs: 10.5, sm: 12 }, lineHeight: 1.3, display: "block" }}>{label}</Typography>
      {pct !== undefined && (
        <LinearProgress variant="determinate" value={pct} sx={{ mt: compact ? 0.5 : 1, height: 3, borderRadius: 2 }} />
      )}
    </Paper>
  );
}

// A lifetime batch (isInfinite plan, or free access) gets a solid ring
// with an infinity glyph instead of a countdown — there's no "running out"
// to visualize, and an empty or full ring would both misleadingly imply
// there was.
//
// For everything else, the ring's fill is deliberately not "percent of
// the original plan length" — that number isn't sent to the frontend at
// all for a purchase (only expiresAt is), and computing it would need a
// second API round trip just for a decorative meter. A trial does carry
// its own length (trialDays), so that one is genuine; a purchase's ring
// instead depletes against a fixed 30-day reference, which is what makes
// it actually useful as a visual: full and calm with weeks left, visibly
// draining as expiry actually approaches — exactly the situation a glance
// at this card should surface.
function DaysLeftRing({ daysLeft, neverExpires, totalDays, theme, size = 46 }) {
  if (neverExpires) {
    return (
      <Box sx={{
        width: size, height: size, borderRadius: "50%", flexShrink: 0,
        border: `3px solid ${theme.palette.success.main}`,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <InfinityIcon size={18} color={theme.palette.success.main} />
      </Box>
    );
  }

  if (daysLeft === null) return null;

  const reference = totalDays || 30;
  const pct = Math.max(0, Math.min(100, (daysLeft / reference) * 100));
  const low = pct <= 20;
  const radius = (size - 6) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <Box sx={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={alpha(theme.palette.text.primary, 0.1)} strokeWidth={4} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke={low ? theme.palette.error.main : theme.palette.primary.main}
          strokeWidth={4} strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - pct / 100)}
          style={{ transition: "stroke-dashoffset 0.4s ease" }}
        />
      </svg>
      <Box sx={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Typography sx={{ fontSize: 13, fontWeight: 700, lineHeight: 1 }}>{daysLeft}</Typography>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------- list
// The original layout — horizontal rows, icon square, title + one line of
// description, chevron. Default style; nothing changes for anyone who
// hasn't touched the new admin setting.
function ActionsList({ actions, navigate }) {
  return (
    <>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>Jump to</Typography>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 2 }}>
        {actions.map(({ to, label, desc, Icon, featureKey }) => (
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
            <ChevronRight size={18} style={{ flexShrink: 0, opacity: 0.5 }} />
          </Paper>
        ))}
      </Box>
    </>
  );
}

// ---------------------------------------------------------------- iconGrid
// Colorful circular icons, label underneath, no description text — the
// densest of the three, closest to the reference the admin was shown.
function ActionsIconGrid({ actions, navigate }) {
  return (
    <>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>Jump to</Typography>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 2.5 }}>
        {actions.map(({ to, label, Icon, featureKey, color }) => (
          <Box
            key={to}
            onClick={() => navigate(to)}
            sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1, cursor: "pointer" }}
          >
            <Box sx={{
              width: 56, height: 56, borderRadius: "50%", flexShrink: 0,
              border: "1.5px solid", borderColor: color, color,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <FeatureIcon featureKey={featureKey} Default={Icon} size={22} customSize={56} color={color} />
            </Box>
            <Typography variant="caption" sx={{ textAlign: "center", lineHeight: 1.3 }}>{label}</Typography>
          </Box>
        ))}
      </Box>
    </>
  );
}

// ---------------------------------------------------------------- cardGrid
// Square tiles, two columns, each carrying its own description and (where
// relevant) a progress bar — closer to a small dashboard than a menu.
function ActionsCardGrid({ actions, navigate }) {
  return (
    <>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>Jump to</Typography>
      {/* minmax(0, 1fr) rather than plain 1fr on both tracks — a bare 1fr
          track has an implicit min-width of "auto", not zero, so a grid
          item containing white-space:nowrap text (the description below)
          can't shrink past that text's full unwrapped width. Whichever
          card has the longer description forces its whole column wider
          than its fair share, squeezing the other column narrower — two
          columns that look unequal despite the grid template saying
          "1fr 1fr". minmax(0, 1fr) overrides that implicit auto minimum,
          so both columns split evenly regardless of content, and the
          longer description properly ellipsizes via noWrap instead. */}
      <Box sx={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 1.5, alignItems: "stretch" }}>
        {actions.map(({ to, label, desc, Icon, featureKey, color, pct }) => (
          <Paper
            key={to}
            variant="outlined"
            onClick={() => navigate(to)}
            sx={{
              p: 1.75, borderRadius: 3, cursor: "pointer",
              // height:"100%" fills the stretched grid cell — without it a
              // card's own background only wraps its own content, so a
              // card with the extra progress-bar line (only Lectures has
              // one right now) ends up visibly taller than its row partner
              // even though the grid cell itself was already equal height.
              // flex + mt:"auto" on the progress bar then pins it to the
              // same bottom edge on every card, whether or not that card
              // actually has one.
              height: "100%", display: "flex", flexDirection: "column",
            }}
          >
            {/* A 40px badge: a default or preset glyph sits on a soft tint of
                its colour; a custom upload (already a round badge) fills it. */}
            <Box sx={{
              width: 40, height: 40, borderRadius: "50%", flexShrink: 0, overflow: "hidden",
              bgcolor: color ? alpha(color, 0.14) : "action.hover",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <FeatureIcon featureKey={featureKey} Default={Icon} size={22} customSize={40} color={color} />
            </Box>
            <Typography sx={{ fontWeight: 500, fontSize: 13, mt: 1.25 }}>{label}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: pct !== undefined ? 0.75 : 0 }} noWrap>
              {desc}
            </Typography>
            {pct !== undefined && (
              <LinearProgress variant="determinate" value={pct} sx={{ height: 3, borderRadius: 2, mt: "auto" }} />
            )}
          </Paper>
        ))}
      </Box>
    </>
  );
}

// ================================================================ Bento, Tabs
// Two styles that lead with what to do next (utils/nextUp.js on the
// server: the lecture to pick up, the next exam, a live class) and sort the
// sections into Learn / Test / AI help / More instead of one long run.
const MODERN_STYLES = ["bento", "tabs"];
const GROUP_OF = {
  lectures: "learn", lectureSlides: "learn", practice: "learn", codingPractice: "learn", archive: "learn", liveClasses: "learn",
  exams: "test", results: "test", progress: "test", leaderboard: "test", assignments: "test", grades: "test",
  tutor: "ai", studyPlan: "ai", docChat: "ai", poraDhora: "ai", aiTutor: "ai", interview: "ai", aiCredits: "ai", doubts: "ai",
  notices: "more",
};
const GROUPS = [["learn", "Learn"], ["test", "Test"], ["ai", "AI help"], ["more", "More"]];
// Columns follow the page's own width (the app layout caps it at 480px on
// any screen; the sidebar layout doesn't), not the screen's.
const cq = (min, styles) => ({ [`@container (min-width: ${min}px)`]: styles });
const groupOf = (a) => a.group || GROUP_OF[a.featureKey] || "more";

// "in 2h", "in 3 days", "12 min ago"
const relTime = (d) => {
  const ms = new Date(d).getTime() - Date.now();
  const min = Math.round(Math.abs(ms) / 60000);
  if (ms < 0) return min < 60 ? `${min} min ago` : `${Math.round(min / 60)}h ago`;
  if (min < 60) return `in ${Math.max(1, min)} min`;
  if (min < 36 * 60) return `in ${Math.round(min / 60)}h`;
  return new Date(d).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
};

// A feature's icon on a 40px badge: a soft tint of its colour behind a
// default or preset glyph; a custom upload (already round) fills it.
function IconBadge({ featureKey, Icon, color, size = 40 }) {
  return (
    <Box sx={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0, overflow: "hidden",
      bgcolor: color ? alpha(color, 0.14) : "action.hover", color,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <FeatureIcon featureKey={featureKey} Default={Icon} size={Math.round(size * 0.52)} customSize={size} color={color} />
    </Box>
  );
}

// The cards that lead the page: pick up a lecture, the next exam, a live class.
function nextItems({ next, batchId, theme }) {
  if (!next) return [];
  const out = [];
  if (next.live) out.push({
    key: "live", to: `/batches/${batchId}/live-classes/${next.live._id}`, Icon: next.live.live ? Radio : Video,
    color: theme.palette.error.main, over: next.live.live ? "Live now" : "Live class",
    title: next.live.title, side: next.live.live ? "Join" : relTime(next.live.scheduledAt), hot: next.live.live,
  });
  if (next.lecture) out.push({
    key: "lecture", to: `/batches/${batchId}/lectures/${next.lecture._id}`, Icon: Play,
    color: theme.palette.primary.main, over: next.lecture.started ? "Continue" : "Up next",
    title: next.lecture.title, side: `${next.lecture.number} of ${next.lecture.total}`,
  });
  if (next.exam) out.push({
    key: "exam", to: `/batches/${batchId}/exams/${next.exam._id}`, Icon: PenLine,
    color: theme.palette.error.main, over: next.exam.open ? "Exam open" : "Next exam",
    title: next.exam.title,
    side: next.exam.open ? (next.exam.closesAt ? `closes ${relTime(next.exam.closesAt)}` : "Take it") : relTime(next.exam.opensAt),
    hot: next.exam.open,
  });
  return out;
}

function NextCard({ item, navigate, big }) {
  return (
    <Paper
      variant="outlined"
      onClick={() => navigate(item.to)}
      sx={{
        p: big ? 2.25 : 1.75, borderRadius: 3, cursor: "pointer", display: "flex", alignItems: "center", gap: 1.75,
        borderLeft: `4px solid ${item.color}`, height: "100%",
      }}
    >
      <Box sx={{ width: big ? 52 : 44, height: big ? 52 : 44, borderRadius: 2.5, flexShrink: 0, bgcolor: alpha(item.color, 0.14), color: item.color, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <item.Icon size={big ? 24 : 20} />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="caption" sx={{ color: item.hot ? item.color : "text.secondary", fontWeight: item.hot ? 700 : 400 }}>{item.over}</Typography>
        <Typography noWrap sx={{ fontWeight: 600, fontSize: big ? 16 : 14 }}>{item.title}</Typography>
      </Box>
      <Typography variant="caption" sx={{ fontWeight: 700, color: item.color, flexShrink: 0 }}>{item.side}</Typography>
    </Paper>
  );
}

// Live detail on the section cards where the page knows it.
const liveDesc = (a, next) => {
  if (a.featureKey === "exams" && next?.exam) return next.exam.open ? `Open now: ${next.exam.title}` : `Next ${relTime(next.exam.opensAt)}`;
  if (a.featureKey === "liveClasses" && next?.live) return next.live.live ? "Live now" : `Next ${relTime(next.live.scheduledAt)}`;
  return a.desc;
};

function ModernBatchHome({ style, batch, batchId, actions, navigate, theme, fill, editorial, compact, phone, mobileTeachers, statusText, daysLeft, isLow, canTopUp, lecturePct, has }) {
  const terms = useTerms();
  const { progress, next } = batch;
  const items = nextItems({ next, batchId, theme });
  // The tutor leads the AI group; doubts and credits go last.
  const AI_ORDER = ["tutor", "studyPlan", "docChat", "aiTutor", "poraDhora", "interview", "doubts", "aiCredits"];
  const grouped = GROUPS.map(([key, label]) => [key, label, actions.filter((a) => groupOf(a) === key)])
    .map(([k, l, list]) => [k, l, k === "ai" ? [...list].sort((x, y) => AI_ORDER.indexOf(x.featureKey) - AI_ORDER.indexOf(y.featureKey)) : list])
    .filter(([, , list]) => list.length);
  const shortAccess = batch.accessType === "free" ? "Free" : batch.neverExpires ? "Lifetime access" : batch.accessVia === "trial" ? `Trial · ${daysLeft} day${daysLeft === 1 ? "" : "s"}` : daysLeft !== null ? `${daysLeft} days left` : statusText;
  // Days left: always in the header, coloured the moment it needs attention.
  const accessChip = batch.accessType !== "free" && (
    <AccessChip text={shortAccess} level={isLow ? "error" : batch.accessVia === "trial" || canTopUp ? "warning" : null}
      onClick={batch.accessVia === "trial" || canTopUp ? () => navigate(`/purchases/${batchId}`) : undefined} />
  );
  const facts = [
    batch.accessType === "free" && shortAccess,
    has("lectures") && progress.lectureCount > 0 && `${progress.watchedCount}/${progress.lectureCount} lectures`,
    has("exams") && progress.averageScore !== null && `${progress.averageScore}% average`,
  ].filter(Boolean);

  // The renewal line, only when it needs doing.
  const accessNote = (batch.accessVia === "trial" || canTopUp) && (
    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 3, mb: 2, display: "flex", alignItems: "center", gap: 1.5, borderColor: isLow ? "warning.main" : "divider", bgcolor: isLow ? theme.palette.warningBg : "background.paper" }}>
      <Clock size={18} style={{ flexShrink: 0, ...(isLow ? { color: theme.palette.warning.main } : {}) }} />
      <Typography sx={{ fontWeight: 500, fontSize: 14, flex: 1, color: isLow ? "warning.main" : undefined }}>{statusText}</Typography>
      <Button size="small" variant={isLow ? "contained" : "outlined"} color={isLow ? "warning" : "primary"} onClick={() => navigate(`/purchases/${batchId}`)}>
        {batch.accessVia === "trial" ? "Upgrade" : "Top up"}
      </Button>
    </Paper>
  );
  const teachers = (!phone || mobileTeachers) && <TeacherStrip teachers={batch.teachers} label={terms.Teachers} sx={{ mb: 2 }} />;
  const headerSx = editorial
    ? { bgcolor: "background.paper", color: "text.primary", borderBottom: 1, borderColor: "divider" }
    : { background: fill.background, color: fill.color, ...(fill.border ? { borderBottom: fill.border, boxShadow: fill.boxShadow } : {}) };
  const wrap = { maxWidth: 1080, mx: "auto", width: "100%" };

  const back = (
    <IconButton onClick={() => navigate("/")} sx={{ color: "inherit", ml: -1 }}><ArrowLeft size={18} /></IconButton>
  );
  const title = (
    <Box sx={{ minWidth: 0, flex: 1 }}>
      <Typography variant="caption" sx={{ opacity: 0.8 }}>{batch.program?.title}</Typography>
      <Typography variant="h5" noWrap sx={{ fontWeight: 700, fontSize: compact ? 19 : { xs: 21, md: 26 } }}>{batch.name}</Typography>
    </Box>
  );

  // ---------------------------------------------------------------- Bento
  if (style === "bento") {
    const ai = grouped.find(([k]) => k === "ai")?.[2] || [];
    const exams = actions.find((a) => a.featureKey === "exams");
    const rest = actions.filter((a) => groupOf(a) !== "ai" && a !== exams);
    const r = 27, c = 2 * Math.PI * r;
    return (
      <Box sx={{ pb: 4, containerType: "inline-size" }}>
        <Box sx={{ ...headerSx, px: { xs: 2, md: 4 }, py: compact ? 1.5 : { xs: 2, md: 3 }, borderRadius: editorial ? 0 : { xs: "0 0 24px 24px", md: 0 } }}>
          <Box sx={wrap}>
            {back}
            <Box sx={{ display: "flex", alignItems: "center", gap: 2, mt: 0.5 }}>
              {/* The batch's own logo, ringed by lecture progress. */}
              <Box sx={{ position: "relative", width: compact ? 60 : 80, height: compact ? 60 : 80, flexShrink: 0 }}>
                {has("lectures") && progress.lectureCount > 0 && (
                  <Box component="svg" viewBox="0 0 64 64" sx={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
                    <circle cx="32" cy="32" r={r} fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="4" />
                    <circle cx="32" cy="32" r={r} fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - lecturePct / 100)} transform="rotate(-90 32 32)" />
                  </Box>
                )}
                <Box sx={{ position: "absolute", inset: compact ? 8 : 10, borderRadius: "50%", overflow: "hidden", display: "flex", bgcolor: editorial ? "action.hover" : "rgba(255,255,255,0.18)" }}>
                  <BatchIcon icon={batch.icon} size={compact ? 44 : 60} />
                </Box>
              </Box>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="caption" sx={{ opacity: 0.8 }}>{batch.program?.title}</Typography>
                <Typography variant="h5" noWrap sx={{ fontWeight: 800, fontSize: compact ? 19 : { xs: 21, md: 28 } }}>{batch.name}</Typography>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", mt: 0.5 }}>
                  {accessChip}
                  <Typography variant="caption" sx={{ opacity: 0.85 }}>{[has("lectures") && progress.lectureCount > 0 && `${lecturePct}%`, ...facts].filter(Boolean).join(" · ")}</Typography>
                </Box>
              </Box>
            </Box>
          </Box>
        </Box>
        <Box sx={{ ...wrap, p: compact ? 1.5 : { xs: 2, md: 4 } }}>
          {accessNote}
          {teachers}
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", ...cq(760, { gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }), gap: 1.5, gridAutoFlow: "dense" }}>
            {items.map((it) => <Box key={it.key} sx={{ gridColumn: "span 2" }}><NextCard item={it} navigate={navigate} big /></Box>)}
            {exams && (
              <Paper variant="outlined" onClick={() => navigate(exams.to)} sx={{ p: 2, borderRadius: 3, cursor: "pointer" }}>
                <IconBadge {...exams} />
                <Typography sx={{ fontWeight: 600, mt: 1.25 }}>{exams.label}</Typography>
                <Typography variant="caption" color="text.secondary">{exams.desc}</Typography>
              </Paper>
            )}
            {ai.length > 0 && (
              <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, gridRow: ai.length > 1 ? "span 2" : undefined, background: `linear-gradient(160deg, ${alpha(theme.palette.ai.main, 0.12)}, ${alpha(theme.palette.primary.main, 0.06)})` }}>
                <Box onClick={() => navigate(ai[0].to)} sx={{ cursor: "pointer" }}>
                  <IconBadge {...ai[0]} />
                  <Typography sx={{ fontWeight: 600, mt: 1.25 }}>{ai[0].label}</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>{ai[0].desc}</Typography>
                </Box>
                {ai.length > 1 && (
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mt: 1.5 }}>
                    {ai.slice(1).map((a) => <Chipish key={a.to} a={a} navigate={navigate} />)}
                  </Box>
                )}
              </Paper>
            )}
            {rest.map((a) => (
              <Paper key={a.to} variant="outlined" onClick={() => navigate(a.to)} sx={{ p: 2, borderRadius: 3, cursor: "pointer" }}>
                <IconBadge {...a} />
                <Typography sx={{ fontWeight: 600, mt: 1.25, fontSize: 14 }}>{a.label}</Typography>
                <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>{liveDesc(a, next)}</Typography>
                {a.pct !== undefined && <LinearProgress variant="determinate" value={a.pct} sx={{ mt: 1, height: 4, borderRadius: 2 }} />}
              </Paper>
            ))}
          </Box>
        </Box>
      </Box>
    );
  }

  // ---------------------------------------------------------------- Tabs
  return <TabsHome {...{ batch, batchId, grouped, items, navigate, theme, headerSx, wrap, back, compact, accessNote, accessChip, teachers, shortAccess, progress, has, next }} />;
}

// Days left in the header: plain while there's time, amber once renewal is
// open (trial, or 15 days out), red inside the last week (3 days on a trial).
// A solid paper chip so the colour reads on any header fill.
function AccessChip({ text, level, onClick }) {
  return (
    <Box onClick={onClick} sx={{
      display: "inline-flex", alignItems: "center", gap: 0.75, px: 1.25, py: 0.5, borderRadius: 99, fontSize: 12.5, fontWeight: level ? 700 : 500,
      cursor: onClick ? "pointer" : "default", whiteSpace: "nowrap",
      ...(level
        ? { bgcolor: "background.paper", color: `${level}.main`, border: 1, borderColor: `${level}.main` }
        : { border: 1, borderColor: "currentColor", opacity: 0.85 }),
    }}>
      <Clock size={14} />{text}
    </Box>
  );
}

function RowCard({ a, navigate, next, chevron }) {
  return (
    <Paper variant="outlined" onClick={() => navigate(a.to)} sx={{ p: 1.5, borderRadius: 3, cursor: "pointer", display: "flex", alignItems: "center", gap: 1.5 }}>
      <IconBadge {...a} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontWeight: 600, fontSize: 14 }}>{a.label}</Typography>
        {a.pct !== undefined ? (
          <LinearProgress variant="determinate" value={a.pct} sx={{ mt: 0.75, height: 4, borderRadius: 2 }} />
        ) : (
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>{liveDesc(a, next)}</Typography>
        )}
      </Box>
      {chevron && <ChevronRight size={18} style={{ flexShrink: 0, opacity: 0.5 }} />}
    </Paper>
  );
}

function Chipish({ a, navigate, big }) {
  return (
    <Box onClick={() => navigate(a.to)} sx={{
      display: "inline-flex", alignItems: "center", gap: 0.75, px: big ? 1.5 : 1.25, py: big ? 0.9 : 0.6, borderRadius: 99, cursor: "pointer",
      bgcolor: "background.paper", border: 1, borderColor: "divider", fontSize: big ? 13.5 : 12.5, fontWeight: 600,
      "&:hover": { borderColor: a.color },
    }}>
      <FeatureIcon featureKey={a.featureKey} Default={a.Icon} size={big ? 16 : 14} customSize={big ? 20 : 18} color={a.color} />
      {a.label}
    </Box>
  );
}

function TabsHome({ batch, batchId, grouped, items, navigate, headerSx, wrap, back, compact, accessNote, accessChip, teachers, shortAccess, progress, has, next }) {
  const [tab, setTab] = useState(grouped[0]?.[0] || "learn");
  const current = grouped.find(([k]) => k === tab) || grouped[0];
  // The lead card for a tab: lecture or live class on Learn, the exam on Test.
  const lead = items.filter((it) => (tab === "learn" ? it.key !== "exam" : tab === "test" ? it.key === "exam" : false));
  const stats = [
    has("lectures") && [`${progress.watchedCount}/${progress.lectureCount}`, "Lectures"],
    has("exams") && [progress.examsTaken, "Exams taken"],
    has("exams") && [progress.averageScore !== null ? `${progress.averageScore}%` : "—", "Average"],
  ].filter(Boolean);
  return (
    <Box sx={{ pb: 4, containerType: "inline-size" }}>
      <Box sx={{ ...headerSx, px: { xs: 2, md: 4 }, pt: compact ? 1.5 : { xs: 2, md: 3 }, pb: 2 }}>
        <Box sx={wrap}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            {back}
            {accessChip || (
              <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.75, px: 1.25, py: 0.5, borderRadius: 99, fontSize: 12.5, border: 1, borderColor: "currentColor", opacity: 0.85 }}>
                <Clock size={14} />{shortAccess}
              </Box>
            )}
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 2, mt: 1, flexWrap: "wrap" }}>
            <Box sx={{ width: compact ? 44 : 60, height: compact ? 44 : 60, borderRadius: 3, overflow: "hidden", flexShrink: 0 }}><BatchIcon icon={batch.icon} size={compact ? 44 : 60} /></Box>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="caption" sx={{ opacity: 0.8 }}>{batch.program?.title}</Typography>
              <Typography variant="h5" noWrap sx={{ fontWeight: 800, fontSize: compact ? 19 : { xs: 21, md: 26 } }}>{batch.name}</Typography>
            </Box>
            {stats.length > 0 && (
              <Box sx={{ display: "grid", gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))`, gap: 1, width: "100%", ...cq(760, { width: "auto" }) }}>
                {stats.map(([v, l]) => (
                  <Box key={l} sx={{ px: 1.75, py: 1, borderRadius: 2.5, bgcolor: "rgba(127,127,127,0.12)", minWidth: 92 }}>
                    <Typography sx={{ fontWeight: 700 }}>{v}</Typography>
                    <Typography variant="caption" sx={{ opacity: 0.75 }}>{l}</Typography>
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        </Box>
      </Box>
      <Box sx={{ ...wrap, p: compact ? 1.5 : { xs: 2, md: 3 } }}>
        {accessNote}
        {teachers}
        <Box sx={{ display: "flex", gap: 0.5, p: 0.5, borderRadius: 3, bgcolor: "action.hover", mb: 2, maxWidth: 520 }}>
          {grouped.map(([k, label]) => (
            <Box key={k} onClick={() => setTab(k)} sx={{
              flex: 1, textAlign: "center", py: 1, borderRadius: 2.5, cursor: "pointer", fontSize: 14, fontWeight: tab === k ? 700 : 600,
              color: tab === k ? "text.primary" : "text.secondary", bgcolor: tab === k ? "background.paper" : "transparent",
              boxShadow: tab === k ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
            }}>{label.replace(" help", "")}</Box>
          ))}
        </Box>
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr", ...cq(760, { gridTemplateColumns: lead.length ? "minmax(0, 1.2fr) minmax(0, 1fr)" : "1fr" }), gap: 1.5, alignItems: "start" }}>
          {lead.length > 0 && (
            <Box sx={{ display: "grid", gap: 1.5 }}>{lead.map((it) => <NextCard key={it.key} item={it} navigate={navigate} big />)}</Box>
          )}
          <Box sx={{ display: "grid", gap: 1.25, gridTemplateColumns: lead.length ? "1fr" : "repeat(auto-fill, minmax(260px, 1fr))" }}>
            {current?.[2].map((a) => <RowCard key={a.to} a={a} navigate={navigate} next={next} chevron />)}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
