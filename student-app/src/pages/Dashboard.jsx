import { useEffect, useState } from "react";
import {
  Box, Typography, Paper, LinearProgress, Chip, Skeleton, Alert, Button, useMediaQuery,
} from "@mui/material";
import { useTheme, alpha } from "@mui/material/styles";
import { useNavigate } from "react-router-dom";
import { PlayCircle, PenLine, ChevronRight, Layers, CheckCircle, Play, Video, Radio, Flame, Sparkles, Clock } from "lucide-react";
import EmptyState from "../components/EmptyState";
import GrowingProgress from "../components/GrowingProgress";
import { growX } from "../motion";
import { useGetDashboardQuery } from "../api/contentApi";
import { useGetMeQuery } from "../api/authApi";
import { useSales, useTerms, useBranding, useHomeMx } from "../BrandingContext";
import { RESTRAINED_DESIGNS, getBoldFill } from "../theme/buildTheme";
import BatchIcon from "../components/BatchIcon";
import GeneralNoticeCarousel from "../components/GeneralNoticeCarousel";
import { NoticeRail } from "../components/NoticeStyles";
import { useGetGeneralNoticesQuery } from "../api/contentApi";
import CourseCatalogue from "../components/CourseCatalogue";

const EDITORIAL_SERIF = '"Iowan Old Style", "Palatino Linotype", Georgia, serif';

const ACCESS_BADGE = (entry, theme) => {
  if (entry.accessVia === "trial" && entry.expiresAt) {
    const days = Math.max(0, Math.ceil((new Date(entry.expiresAt) - Date.now()) / 86400000));
    return { label: `${days}d left`, color: theme.palette.warning.main, bg: theme.palette.warningBg };
  }
  if (entry.accessType === "free") return { label: "Free", color: theme.palette.primary.main, bg: "action.hover" };
  if (entry.accessVia === "purchase") return { label: "Active", color: theme.palette.success.main, bg: theme.palette.correctBg };
  if (entry.accessVia === "free") return { label: "Free", color: theme.palette.primary.main, bg: "action.hover" };
  return null;
};

const computeBatchSummaries = (batches, upcoming, stats, navigate) => {
  if (!batches || batches.length === 0) return null;

  const totalLectures = stats?.totalLectures ?? 0;
  const totalWatched = stats?.totalWatched ?? 0;
  const examsAvailable = stats?.examsAvailable ?? 0;
  const examsTaken = stats?.examsTaken ?? 0;
  const examsGraded = stats?.examsGraded ?? 0;
  const doubtsTotal = stats?.doubtsTotal ?? 0;
  const doubtsAnswered = stats?.doubtsAnswered ?? 0;
  const examsPending = Math.max(0, examsTaken - examsGraded);

  const lecturePct = totalLectures > 0 ? Math.round((totalWatched / totalLectures) * 100) : 0;
  const examPct = examsAvailable > 0 ? Math.round((examsTaken / examsAvailable) * 100) : 0;
  const gradedPct = examsTaken > 0 ? Math.round((examsGraded / examsTaken) * 100) : 0;
  const doubtPct = doubtsTotal > 0 ? Math.round((doubtsAnswered / doubtsTotal) * 100) : 0;

  return [
    examsAvailable > 0 && {
      icon: PenLine,
      value: `${examsTaken}/${examsAvailable}`,
      label: "Exams taken",
      color: "primary",
      barPct: examPct,
      onClick: navigate && (() => navigate("/exams")),
    },
    totalLectures > 0 && {
      icon: PlayCircle,
      value: `${totalWatched}/${totalLectures}`,
      label: "Lectures viewed",
      color: "warning",
      barPct: lecturePct,
      onClick: navigate && (() => navigate("/lectures")),
    },
    examsTaken > 0 && {
      icon: CheckCircle,
      value: `${examsGraded}/${examsTaken}`,
      label: "Exams graded",
      color: "success",
      barPct: gradedPct,
      sub: examsPending > 0 ? `${examsPending} pending` : null,
      onClick: navigate && (() => navigate("/results")),
    },
    doubtsTotal > 0 && {
      icon: Layers,
      value: `${doubtsAnswered}/${doubtsTotal}`,
      label: "Doubts answered",
      color: "secondary",
      barPct: doubtPct,
    },
  ].filter(Boolean);
};

// "in 1d" is misleading right up until the moment it lapses — Math.ceil
// means anything up to 24h away already reads as "1d", so a batch expiring
// in 3 hours and one expiring in 23 hours look identical, and neither tells
// the student the actual cutoff.
//
// The first version of this fix compared calendar dates ("is `end` on
// today's date") instead of actual elapsed time — which missed exactly the
// case it existed for: past midnight, an expiry 40 minutes away already
// falls on *tomorrow's* calendar date, so the sameDay check failed and it
// fell back to the rounded "in 1d" it was supposed to replace. Threshold is
// now real hours-away, not calendar-day equality, and names which day the
// time belongs to since that's no longer guaranteed to be "today".
const expiryPhrase = (expiresAt, verb) => {
  const end = new Date(expiresAt);
  const now = new Date();
  const diffMs = end - now;

  if (diffMs > 0 && diffMs < 86400000) {
    const sameDay = end.getFullYear() === now.getFullYear()
      && end.getMonth() === now.getMonth()
      && end.getDate() === now.getDate();
    const time = end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return `${verb} ${sameDay ? "today" : "tomorrow"} at ${time}`;
  }
  const days = Math.max(0, Math.ceil(diffMs / 86400000));
  return `${verb} in ${days}d`;
};

// One line, highest-priority-wins — replaces the old static "N batches
// enrolled" with whatever's actually worth a student's attention right now.
// Pure rule matching against data the dashboard call already returns (no
// extra request, no AI): an LLM call on every dashboard load would be pure
// added latency/cost for a problem that's just conditional logic over
// state we already have.
const computeNudge = (data, navigate, terms) => {
  const batchCount = (data?.batches || []).length;
  const fallback = { text: `${batchCount} ${batchCount === 1 ? terms.batch : terms.batches} enrolled`, onClick: null };
  if (!data) return fallback;

  // 1. An exam is open and unattempted — the single most actionable thing
  // a student can do right now.
  const upcoming = data.upcoming || [];
  if (upcoming.length > 0) {
    return upcoming.length === 1
      ? { text: `"${upcoming[0].title}" is ready — take it now`, onClick: () => navigate(`/batches/${upcoming[0].batch}/exams/${upcoming[0]._id}`) }
      : { text: `${upcoming.length} exams are ready to take`, onClick: () => navigate("/exams") };
  }

  // 2. Access is about to lapse — trial or purchase, either way it's the
  // most urgent thing on the card once no exam is waiting.
  const expiringSoon = (data.batches || [])
    .filter((b) => (b.accessVia === "purchase" || b.accessVia === "trial") && !b.neverExpires && b.expiresAt)
    .map((b) => ({ ...b, daysLeft: Math.max(0, Math.ceil((new Date(b.expiresAt) - Date.now()) / 86400000)) }))
    .filter((b) => b.daysLeft <= 3)
    .sort((a, b) => a.daysLeft - b.daysLeft)[0];
  if (expiringSoon) {
    const text = expiringSoon.accessVia === "trial"
      ? `Trial for "${expiringSoon.name}" ${expiryPhrase(expiringSoon.expiresAt, "ends")}`
      : `"${expiringSoon.name}" ${expiryPhrase(expiringSoon.expiresAt, "expires")}`;
    // This branch only ever fires at daysLeft <= 3, so it's always within
    // the same "about to lapse" window BatchHome already treats as a
    // warning — same red/amber treatment, not just the primary-link color
    // every other nudge gets.
    return { text, onClick: () => navigate(`/purchases/${expiringSoon._id}`), warning: true };
  }

  // 3. Nothing urgent — at least point back at unfinished work.
  if (data.continueWatching) {
    return {
      text: `Pick up "${data.continueWatching.lecture.title}"`,
      onClick: () => navigate(`/batches/${data.continueWatching.batch._id}/lectures/${data.continueWatching.lecture._id}`),
    };
  }

  // 4. Genuinely nothing to nudge on — the old plain count.
  return fallback;
};

// Four admin-selectable styles for this one screen (studentUi.dashboardStyle),
// same principle as BatchHome's three: "list" is the original, untouched
// layout so nobody's app changes shape without the admin choosing that.
// Settings → Student app → Notice style "Rail": on a wide screen the
// notices sit in a column beside the home page; anywhere else, Cards.
export default function Dashboard() {
  const { noticeStyle, homeNotices } = useBranding();
  const wide = useMediaQuery("(min-width:900px)");
  const { data } = useGetGeneralNoticesQuery(undefined, { skip: !(noticeStyle === "rail" && homeNotices !== false) });
  const notices = data?.notices || [];
  if (!(noticeStyle === "rail" && homeNotices !== false && wide && notices.length)) return <DashboardBody />;
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 280px", gap: 3, alignItems: "start", pr: { md: 4 } }}>
      <Box sx={{ minWidth: 0 }}><DashboardBody hideNotices /></Box>
      <Box sx={{ pt: 4, position: "sticky", top: 16 }}><NoticeRail notices={notices} /></Box>
    </Box>
  );
}

function DashboardBody({ hideNotices = false }) {
  const sales = useSales();
  const terms = useTerms();
  const { data, isLoading } = useGetDashboardQuery();
  const { data: me } = useGetMeQuery();
  const navigate = useNavigate();
  const { design, dashboardStyle, homeNotices } = useBranding();
  // Settings → Student app: the page's column centred or against the left.
  const mx = useHomeMx();
  const theme = useTheme();
  // This is the "design" axis (panel/editorial/mono/...) — unrelated to the
  // dashboardStyle === "editorial" branch further down, which is a layout
  // choice ("Home screen layout" in admin settings) that happens to share
  // the same word.
  const editorial = RESTRAINED_DESIGNS.has(design);
  // Only computed for the bold-fill branch below — a restrained design
  // never reads this, and getBoldFill is only meaningful for the other
  // camp (see its own comment in buildTheme.js).
  const fill = !editorial ? getBoldFill(design, theme) : null;

  const noticeCarousel = homeNotices === false || hideNotices ? null : <GeneralNoticeCarousel />;
  const catalogue = <CourseCatalogue />;

  const continueBanner = !isLoading && data?.continueWatching && (
    <Paper
      variant="outlined"
      onClick={() => navigate(`/batches/${data.continueWatching.batch._id}/lectures/${data.continueWatching.lecture._id}`)}
      sx={editorial ? {
        p: 2, mb: 4, cursor: "pointer",
        display: "flex", alignItems: "center", gap: 2,
        borderTop: 2, borderTopColor: "primary.main", borderRadius: 0,
      } : {
        p: 2, mb: 4, borderRadius: fill.borderRadius ?? 3, cursor: "pointer",
        display: "flex", alignItems: "center", gap: 2,
        background: fill.background, color: fill.color,
        ...(fill.border ? { border: fill.border, boxShadow: fill.boxShadow } : {}),
      }}
    >
      <Box sx={{
        width: 44, height: 44, borderRadius: editorial ? 1 : "50%", flexShrink: 0,
        bgcolor: editorial ? "action.hover" : "rgba(255,255,255,0.18)",
        color: editorial ? "primary.main" : "inherit",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <PlayCircle size={20} />
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="caption" sx={{ opacity: editorial ? 1 : 0.8, color: editorial ? "text.secondary" : "inherit" }}>
          Continue watching
        </Typography>
        <Typography noWrap sx={{ fontWeight: 500 }}>{data.continueWatching.lecture.title}</Typography>
      </Box>
      <ChevronRight size={18} />
    </Paper>
  );

  const upcomingSection = (data?.upcoming || []).length > 0 && (
    <Box sx={{ mt: 5 }}>
      <Box sx={{ mb: 2.5 }}>
        <Typography variant="h6" sx={{ fontWeight: 500, mb: 0.5, fontSize: 17 }}>Ready for you</Typography>
        <Typography variant="body2" color="text.secondary">
          {data.upcoming.length} {data.upcoming.length === 1 ? "exam is" : "exams are"} open now.
        </Typography>
      </Box>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(280px, 100%), 1fr))", gap: 2 }}>
        {data.upcoming.map((exam) => (
          <Paper
            key={exam._id}
            variant="outlined"
            sx={{
              p: 2.25, borderRadius: 2, display: "flex", alignItems: "center", gap: 2, cursor: "pointer",
              transition: "border-color 0.15s", "&:hover": { borderColor: "primary.main" },
            }}
            onClick={() => navigate(`/batches/${exam.batch}/exams/${exam._id}`)}
          >
            <Box sx={{ width: 40, height: 40, borderRadius: 2, bgcolor: "action.hover", color: "primary.main", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <PenLine size={18} />
            </Box>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography sx={{ fontWeight: 500, fontSize: 14, mb: 0.5 }} noWrap>{exam.title}</Typography>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                <Chip size="small" label={exam.mode} sx={{ height: 20, fontSize: 11, textTransform: "capitalize" }} />
                <Typography variant="caption" color="text.secondary">
                  {exam.durationMinutes} min · attempt {exam.attemptsUsed + 1} of {exam.attemptsAllowed}
                </Typography>
              </Box>
            </Box>
            <ChevronRight size={18} style={{ opacity: 0.4, flexShrink: 0 }} />
          </Paper>
        ))}
      </Box>
    </Box>
  );

  const emptyState = !isLoading && (data?.batches || []).length === 0 && (
    <EmptyState
      bordered
      icon={Layers}
      title="Nothing enrolled yet"
      description={sales ? `Pick a ${terms.batch} to unlock its lectures, exams and practice sets.` : `Your ${terms.org} adds you to your ${terms.batches}. Ask them if you are expecting one.`}
      action={sales ? { label: `Browse ${terms.batches}`, onClick: () => navigate("/purchases") } : undefined}
      sx={{ mb: 4 }}
    />
  );

  // Account deletion requested: a way back, on the first screen they see.
  const deletionBanner = me?.deletionScheduledFor && (
    <Alert
      severity="warning"
      sx={{ mb: 2.5 }}
      action={<Button color="inherit" size="small" onClick={() => navigate("/account")}>Review</Button>}
    >
      Your account is set to be deleted on {new Date(me.deletionScheduledFor).toLocaleDateString(undefined, { day: "numeric", month: "long" })}.
    </Alert>
  );

  const summaries = computeBatchSummaries(data?.batches, data?.upcoming, data?.stats, navigate);
  const nudge = computeNudge(data, navigate, terms);

  if (dashboardStyle === "bento" || dashboardStyle === "today") {
    const Style = dashboardStyle === "bento" ? BentoHome : TodayHome;
    return (
      <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 1180, mx }}>
        {deletionBanner}
        <Style data={data} isLoading={isLoading} me={me} navigate={navigate} theme={theme} terms={terms} noticeCarousel={noticeCarousel} />
        {emptyState}
        {catalogue}
      </Box>
    );
  }

  if (dashboardStyle === "richCards") {
    return (
      <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 1100, mx }}>
        {deletionBanner}{continueBanner}
        {noticeCarousel}

        <Box sx={{ mb: 3 }}>
          <Typography variant="h5" sx={{ fontWeight: 600, mb: 0.5 }}>Your {terms.batches}</Typography>
          <Typography
            variant="body2"
            onClick={nudge.onClick || undefined}
            sx={{
              color: nudge.warning ? "warning.main" : nudge.onClick ? "primary.main" : "text.secondary",
              fontWeight: nudge.warning || nudge.onClick ? 600 : 400,
              cursor: nudge.onClick ? "pointer" : "default",
            }}
          >
            {nudge.text}
          </Typography>
        </Box>

        <SummaryColumnChart summaries={summaries} theme={theme} />

        {isLoading ? (
          <SkeletonGrid />
        ) : (data?.batches || []).length > 0 ? (
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 2.5 }}>
            {(data?.batches || []).map((entry) => (
              <RichBatchCard key={entry._id} entry={entry} navigate={navigate} theme={theme} />
            ))}
          </Box>
        ) : null}
        {emptyState}
        {upcomingSection}
        {catalogue}
      </Box>
    );
  }

  if (dashboardStyle === "heroList") {
    return (
      <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 700, mx }}>
        {isLoading ? (
          <Skeleton variant="rounded" height={90} sx={{ mb: 3 }} />
        ) : data?.continueWatching ? (
          <>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>Continue where you left off</Typography>
            {deletionBanner}{continueBanner}
          </>
        ) : null}
        {noticeCarousel}

        <Box sx={{ mb: 3 }}>
          <Typography variant="h5" sx={{ fontWeight: 600, mb: 0.5 }}>Your {terms.batches}</Typography>
          <Typography
            variant="caption"
            onClick={nudge.onClick || undefined}
            sx={{
              display: "block", mb: 1,
              color: nudge.warning ? "warning.main" : nudge.onClick ? "primary.main" : "text.secondary",
              fontWeight: nudge.warning || nudge.onClick ? 600 : 400,
              cursor: nudge.onClick ? "pointer" : "default",
            }}
          >
            {nudge.text}
          </Typography>
        </Box>

        <SummaryColumnChart summaries={summaries} theme={theme} />

        {isLoading ? (
          <Skeleton variant="rounded" height={160} sx={{ mb: 3 }} />
        ) : (data?.batches || []).length > 0 ? (
          <Paper variant="outlined" sx={{ mb: 4, borderRadius: 3, overflow: "hidden" }}>
            {(data?.batches || []).map((entry) => {
              const badge = ACCESS_BADGE(entry, theme);
              const pct = entry.progress?.lectureCount ? Math.round((entry.progress.watchedCount / entry.progress.lectureCount) * 100) : null;
              return (
                <Box
                  key={entry._id}
                  onClick={() => navigate(`/batches/${entry._id}`)}
                  sx={{
                    display: "flex", alignItems: "center", gap: 2, px: 2, py: 1.75,
                    borderBottom: 1, borderColor: "divider", cursor: "pointer",
                    "&:last-child": { borderBottom: 0 },
                    "&:hover": { bgcolor: "action.hover" },
                  }}
                >
                  <Box sx={{ width: 48, height: 48, borderRadius: 2.5, bgcolor: "action.hover", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {/* Own small wrapper, not the big 48px box above — see
                        BatchHome.jsx's identical comment. */}
                    <Box sx={{ width: 24, height: 24, borderRadius: "22%", overflow: "hidden", display: "flex" }}>
                      <BatchIcon icon={entry.icon} size={24} />
                    </Box>
                  </Box>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
                      <Typography sx={{ fontWeight: 600, fontSize: 14 }} noWrap>{entry.name}</Typography>
                      {badge && (
                        <Chip size="small" label={badge.label} sx={{ bgcolor: badge.bg, color: badge.color, height: 18, fontSize: 10.5, fontWeight: 600 }} />
                      )}
                    </Box>
                    {pct !== null ? (
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <GrowingProgress value={pct} sx={{ flex: 1, height: 4, borderRadius: 2 }} />
                        <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>{pct}%</Typography>
                      </Box>
                    ) : (
                      <Typography variant="caption" color="text.secondary" noWrap>{entry.program?.title}</Typography>
                    )}
                  </Box>
                  <ChevronRight size={18} style={{ opacity: 0.4, flexShrink: 0 }} />
                </Box>
              );
            })}
          </Paper>
        ) : null}
        {emptyState}
        {upcomingSection}
        {catalogue}
      </Box>
    );
  }

  if (dashboardStyle === "editorial") {
    return (
      <Box sx={{ p: { xs: 2.5, md: 5 }, maxWidth: 700, mx }}>
        {noticeCarousel}

        <Box sx={{ mb: 3 }}>
          <Typography sx={{ fontFamily: EDITORIAL_SERIF, fontSize: 22, mb: 0.5 }}>Your {terms.batches}</Typography>
          <Typography
            variant="body2"
            onClick={nudge.onClick || undefined}
            sx={{
              mb: 3,
              color: nudge.warning ? "warning.main" : nudge.onClick ? "primary.main" : "text.secondary",
              fontWeight: nudge.warning || nudge.onClick ? 600 : 400,
              cursor: nudge.onClick ? "pointer" : "default",
            }}
          >
            {nudge.text}
          </Typography>
        </Box>

        <SummaryColumnChart summaries={summaries} theme={theme} />

        {isLoading ? (
          <Skeleton variant="rounded" height={160} sx={{ mb: 3 }} />
        ) : (data?.batches || []).length > 0 ? (
          <Box sx={{ mb: 4 }}>
            {(data?.batches || []).map((entry, i) => {
              const badge = ACCESS_BADGE(entry, theme);
              const pct = entry.progress?.lectureCount
                ? Math.round((entry.progress.watchedCount / entry.progress.lectureCount) * 100)
                : 0;
              return (
                <Box
                  key={entry._id}
                  onClick={() => navigate(`/batches/${entry._id}`)}
                  sx={{
                    display: "flex", alignItems: "flex-start", gap: 2, py: 3,
                    borderTop: 1, borderColor: "divider", cursor: "pointer",
                    "&:last-child": { borderBottom: 1 },
                  }}
                >
                  <Typography sx={{ fontFamily: EDITORIAL_SERIF, fontStyle: "italic", fontSize: 15, color: "text.disabled", pt: 0.5, flexShrink: 0, minWidth: 22 }}>
                    {String(i + 1).padStart(2, "0")}
                  </Typography>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 1.5, mb: 0.5 }}>
                      <Typography sx={{ fontFamily: EDITORIAL_SERIF, fontSize: 19 }}>{entry.name}</Typography>
                      {badge && (
                        <Typography variant="caption" sx={{ color: badge.color, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.6, flexShrink: 0 }}>
                          {badge.label}
                        </Typography>
                      )}
                    </Box>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: entry.progress?.lectureCount > 0 ? 1.25 : 0 }}>
                      {entry.program?.title}
                      {entry.progress?.lectureCount > 0 && ` · ${entry.progress.watchedCount} of ${entry.progress.lectureCount} lectures watched`}
                    </Typography>
                    {entry.progress?.lectureCount > 0 && (
                      <Box sx={{ height: 2, bgcolor: "divider", borderRadius: 1 }}>
                        <Box sx={{ height: 2, width: `${pct}%`, bgcolor: "primary.main", borderRadius: 1, transformOrigin: "left", animation: `${growX} 900ms cubic-bezier(.2,.7,.3,1)` }} />
                      </Box>
                    )}
                  </Box>
                </Box>
              );
            })}
          </Box>
        ) : null}
        {emptyState}
        {upcomingSection}
        {catalogue}
      </Box>
    );
  }

  // ---------------------------------------------------------------- list
  // The default for anyone who hasn't touched the admin setting.
  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 1100, mx }}>
      {deletionBanner}{continueBanner}
      {noticeCarousel}

      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 600, mb: 0.5 }}>Your {terms.batches}</Typography>
        <Typography
          variant="body2"
          onClick={nudge.onClick || undefined}
          sx={{
            color: nudge.warning ? "warning.main" : nudge.onClick ? "primary.main" : "text.secondary",
            fontWeight: nudge.warning || nudge.onClick ? 600 : 400,
            cursor: nudge.onClick ? "pointer" : "default",
          }}
        >
          {nudge.text}
        </Typography>
      </Box>

      <SummaryColumnChart summaries={summaries} theme={theme} />

      {isLoading ? (
        <SkeletonGrid />
      ) : (data?.batches || []).length > 0 ? (
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(280px, 100%), 1fr))", gap: 2.5 }}>
          {(data?.batches || []).map((entry) => (
            <BatchCard key={entry._id} entry={entry} navigate={navigate} theme={theme} />
          ))}
        </Box>
      ) : null}
      {emptyState}
      {upcomingSection}
      {catalogue}
    </Box>
  );
}

// The grid card used for the default "list" layout. RichBatchCard below is "richCards"'s own tile —
// heroList/editorial show batches as plain rows instead, which is a
// different enough shape to leave alone.
function BatchCard({ entry, navigate, theme }) {
  const badge = ACCESS_BADGE(entry, theme);
  const lecturePct = entry.progress?.lectureCount
    ? (entry.progress.watchedCount / entry.progress.lectureCount) * 100
    : 0;
  const examPct = entry.progress?.examCount
    ? (entry.progress.examsTaken / entry.progress.examCount) * 100
    : 0;
  // The ring only makes sense for a purchase with a real start date — a
  // trial already gets its own "Nd left" chip from ACCESS_BADGE, and a
  // lifetime plan has no total length for "80% gone" to be measured against.
  const showRing = entry.accessVia === "purchase" && !entry.neverExpires && entry.startDate && entry.expiresAt;

  return (
    <Paper
      variant="outlined"
      onClick={() => navigate(`/batches/${entry._id}`)}
      sx={{ p: 2.5, borderRadius: 2, cursor: "pointer", "&:hover": { boxShadow: 1, borderColor: "primary.main" } }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 2 }}>
        <Box sx={{ width: 40, height: 40, borderRadius: 2, overflow: "hidden", bgcolor: "action.hover", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <BatchIcon icon={entry.icon} size={40} />
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography sx={{ fontWeight: 500, fontSize: 14 }} noWrap>{entry.name}</Typography>
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>{entry.program?.title}</Typography>
        </Box>
        {badge && (
          <Chip size="small" label={badge.label} sx={{ bgcolor: badge.bg, color: badge.color, flexShrink: 0 }} />
        )}
        {showRing && (
          <DaysRemainingRing startDate={entry.startDate} expiresAt={entry.expiresAt} theme={theme} />
        )}
      </Box>

      {entry.progress?.lectureCount > 0 && (
        <Box sx={{ mb: entry.progress?.examCount > 0 ? 1.75 : 0 }}>
          <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
            <Typography variant="caption" color="text.secondary">{entry.progress.watchedCount}/{entry.progress.lectureCount} lectures</Typography>
            <Typography variant="caption" color="text.secondary">{Math.round(lecturePct)}%</Typography>
          </Box>
          <GrowingProgress value={lecturePct} sx={{ height: 4, borderRadius: 2 }} />
        </Box>
      )}

      {entry.progress?.examCount > 0 && (
        <Box>
          <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
            <Typography variant="caption" color="text.secondary">{entry.progress.examsTaken}/{entry.progress.examCount} exams complete</Typography>
            <Typography variant="caption" color="text.secondary">{Math.round(examPct)}%</Typography>
          </Box>
          <GrowingProgress value={examPct} color="info" sx={{ height: 4, borderRadius: 2 }} />
        </Box>
      )}
    </Paper>
  );
}

// The "richCards" layout's own tile — a tinted icon header band (so the
// grid reads as tiles, not text rows) plus the same progress/badge data
// BatchCard shows, laid out around it instead of stacked above it.
function RichBatchCard({ entry, navigate, theme }) {
  const badge = ACCESS_BADGE(entry, theme);
  const lecturePct = entry.progress?.lectureCount
    ? (entry.progress.watchedCount / entry.progress.lectureCount) * 100
    : 0;
  const examPct = entry.progress?.examCount
    ? (entry.progress.examsTaken / entry.progress.examCount) * 100
    : 0;
  const showRing = entry.accessVia === "purchase" && !entry.neverExpires && entry.startDate && entry.expiresAt;

  return (
    <Paper
      variant="outlined"
      onClick={() => navigate(`/batches/${entry._id}`)}
      sx={{
        borderRadius: 4, overflow: "hidden", cursor: "pointer",
        transition: "box-shadow 0.15s, transform 0.15s",
        "&:hover": { boxShadow: 3, transform: "translateY(-2px)", borderColor: "primary.main" },
      }}
    >
      <Box sx={{
        position: "relative", px: 2, py: 2.5,
        bgcolor: (t) => alpha(t.palette.primary.main, t.palette.mode === "dark" ? 0.18 : 0.08),
        display: "flex", alignItems: "center", gap: 1.5,
      }}>
        <Box sx={{
          width: 44, height: 44, borderRadius: 2.5, flexShrink: 0, overflow: "hidden",
          bgcolor: "background.paper", display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: 1,
        }}>
          <BatchIcon icon={entry.icon} size={44} />
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography sx={{ fontWeight: 600, fontSize: 15 }} noWrap>{entry.name}</Typography>
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>{entry.program?.title}</Typography>
        </Box>
        {showRing && <DaysRemainingRing startDate={entry.startDate} expiresAt={entry.expiresAt} theme={theme} />}
        {badge && (
          <Chip
            size="small" label={badge.label}
            sx={{ position: "absolute", top: 10, right: 10, bgcolor: badge.bg, color: badge.color, fontWeight: 600 }}
          />
        )}
      </Box>

      {(entry.progress?.lectureCount > 0 || entry.progress?.examCount > 0) && (
        <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 1.25 }}>
          {entry.progress?.lectureCount > 0 && (
            <Box>
              <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                <Typography variant="caption" color="text.secondary">{entry.progress.watchedCount}/{entry.progress.lectureCount} lectures</Typography>
                <Typography variant="caption" sx={{ fontWeight: 600 }}>{Math.round(lecturePct)}%</Typography>
              </Box>
              <GrowingProgress value={lecturePct} sx={{ height: 5, borderRadius: 3 }} />
            </Box>
          )}
          {entry.progress?.examCount > 0 && (
            <Box>
              <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                <Typography variant="caption" color="text.secondary">{entry.progress.examsTaken}/{entry.progress.examCount} exams complete</Typography>
                <Typography variant="caption" sx={{ fontWeight: 600 }}>{Math.round(examPct)}%</Typography>
              </Box>
              <GrowingProgress value={examPct} color="info" sx={{ height: 5, borderRadius: 3 }} />
            </Box>
          )}
        </Box>
      )}
    </Paper>
  );
}

// Ring around the days left in the CURRENT purchase window (real
// startDate → expiresAt from the backend, not a guessed reference length).
// Fills as days pass and turns red once 80% of that window is gone, so a
// glance at the card is enough to see a renewal is coming up — matching
// BatchHome's DaysLeftRing in shape, but driven by the real total length
// instead of a fixed 30-day approximation.
function DaysRemainingRing({ startDate, expiresAt, theme, size = 32 }) {
  const start = new Date(startDate).getTime();
  const end = new Date(expiresAt).getTime();
  const totalMs = end - start;
  if (!(totalMs > 0)) return null;

  const now = Date.now();
  const elapsedPct = Math.max(0, Math.min(100, ((now - start) / totalMs) * 100));
  const remainingPct = 100 - elapsedPct;
  const daysLeft = Math.max(0, Math.ceil((end - now) / 86400000));
  const danger = elapsedPct >= 80;
  const radius = (size - 5) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <Box
      sx={{ position: "relative", width: size, height: size, flexShrink: 0 }}
      title={`${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}
    >
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={alpha(theme.palette.text.primary, 0.1)} strokeWidth={3} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke={danger ? theme.palette.error.main : theme.palette.primary.main}
          strokeWidth={3} strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - remainingPct / 100)}
          style={{ transition: "stroke-dashoffset 0.4s ease" }}
        />
      </svg>
      <Box sx={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Typography sx={{ fontSize: 9, fontWeight: 700, lineHeight: 1, color: danger ? "error.main" : "text.primary" }}>
          {daysLeft}
        </Typography>
      </Box>
    </Box>
  );
}

function SkeletonGrid() {
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 2, mb: 4 }}>
      {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} variant="rounded" height={120} />)}
    </Box>
  );
}

function SummaryColumnChart({ summaries, theme }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (summaries && !mounted) {
      const timer = setTimeout(() => setMounted(true), 10);
      return () => clearTimeout(timer);
    }
  }, [summaries]);

  if (!summaries || summaries.length === 0) return null;
  const getColor = (t, key) => (t.palette[key] && t.palette[key].main) || t.palette.primary.main;
  const trackPx = 72;

  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: "flex", alignItems: "flex-end", justifyContent: "space-around", gap: 1.5 }}>
        {summaries.map((s, i) => {
          const pct = Math.max(0, Math.min(100, s.barPct ?? 0));
          return (
            <Box
              key={i}
              onClick={s.onClick}
              sx={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", cursor: s.onClick ? "pointer" : "default" }}
            >
              <Typography sx={{ fontSize: 11, fontWeight: 700, color: (t) => getColor(t, s.color), height: 16, lineHeight: "16px" }}>
                {Math.round(pct)}%
              </Typography>
              <Box sx={{
                position: "relative", width: "100%", maxWidth: 34, height: trackPx,
                borderRadius: 1, backgroundColor: "action.hover", overflow: "hidden",
              }}>
                <Box
                  sx={{ position: "absolute", left: 0, right: 0, bottom: 0, borderRadius: "6px 6px 2px 2px", backgroundColor: (t) => getColor(t, s.color) }}
                  style={{
                    height: mounted ? `${Math.max(pct, 4)}%` : "0%",
                    transition: "height 0.6s ease-out",
                    transitionDelay: `${i * 60}ms`,
                  }}
                />
              </Box>
            </Box>
          );
        })}
      </Box>

      <Box sx={{ display: "flex", justifyContent: "space-around", gap: 1.5, borderTop: 1, borderColor: "divider", mt: 1.5, pt: 1 }}>
        {summaries.map((s, i) => (
          <Box key={i} onClick={s.onClick} sx={{ flex: 1, textAlign: "center", cursor: s.onClick ? "pointer" : "default" }}>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 0.4 }}>
              <s.icon size={10} color={getColor(theme, s.color)} />
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: 9, textTransform: "uppercase", letterSpacing: 0.3, lineHeight: 1.2 }} noWrap>
                {s.label}
              </Typography>
            </Box>
            <Typography sx={{ fontSize: 11, fontWeight: 600, mt: 0.25 }} noWrap>{s.value}</Typography>
            {s.sub && (
              <Typography
                variant="caption"
                sx={{
                  fontSize: 8.5, fontWeight: 600, color: "text.secondary",
                  bgcolor: "action.hover", borderRadius: 5, px: 0.6, py: 0.1,
                  display: "inline-block", mt: 0.3,
                }}
              >
                {s.sub}
              </Typography>
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

// ================================================================ Bento, Today
// Two home styles led by what to do now, from the dashboard's `next`
// (utils/nextUp.js): next exam and live class, today's classes and exams,
// the tutor's tasks and streak, plus the lecture to pick up.

// "in 2h", "in 3 days", "12 min ago"
const relTime = (d) => {
  const ms = new Date(d).getTime() - Date.now();
  const min = Math.round(Math.abs(ms) / 60000);
  if (ms < 0) return min < 60 ? `${min} min ago` : `${Math.round(min / 60)}h ago`;
  if (min < 60) return `in ${Math.max(1, min)} min`;
  if (min < 36 * 60) return `in ${Math.round(min / 60)}h`;
  return new Date(d).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
};
const clock = (d) => new Date(d).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
// Columns follow the page's own width, not the screen's (see BatchHome.jsx).
const cq = (min, styles) => ({ [`@container (min-width: ${min}px)`]: styles });
const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

function Tint({ Icon, color, size = 40 }) {
  return (
    <Box sx={{ width: size, height: size, borderRadius: 2.5, flexShrink: 0, bgcolor: alpha(color, 0.14), color, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Icon size={Math.round(size * 0.48)} />
    </Box>
  );
}

function MiniBatch({ entry, navigate, theme, row }) {
  const badge = ACCESS_BADGE(entry, theme);
  const pct = entry.progress?.lectureCount ? Math.round((entry.progress.watchedCount / entry.progress.lectureCount) * 100) : null;
  const sub = badge?.label === "Active" && entry.neverExpires ? "Lifetime" : badge?.label || entry.program?.title || "";
  return (
    <Paper
      variant="outlined"
      onClick={() => navigate(`/batches/${entry._id}`)}
      sx={{ p: row ? 1.25 : 2, borderRadius: 3, cursor: "pointer", display: row ? "flex" : "block", alignItems: "center", gap: 1.5, "&:hover": { borderColor: "primary.main" } }}
    >
      <Box sx={{ width: 40, height: 40, borderRadius: 2.5, overflow: "hidden", flexShrink: 0, bgcolor: "action.hover" }}><BatchIcon icon={entry.icon} size={40} /></Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography noWrap sx={{ fontWeight: 600, fontSize: 14, mt: row ? 0 : 1.25 }}>{entry.name}</Typography>
        <Typography variant="caption" noWrap sx={{ display: "block", color: badge?.color && badge.label !== "Active" ? badge.color : "text.secondary", fontWeight: badge?.label?.endsWith("left") ? 700 : 400 }}>{sub}</Typography>
        {pct !== null && <LinearProgress variant="determinate" value={pct} sx={{ mt: 1, height: 5, borderRadius: 3 }} />}
      </Box>
    </Paper>
  );
}

function BentoHome({ data, isLoading, me, navigate, theme, terms, noticeCarousel }) {
  if (isLoading) return <SkeletonGrid />;
  if (!data?.batches?.length) return null;
  const next = data.next || {};
  const cw = data.continueWatching;
  const tiles = [];
  if (next.exam) tiles.push(
    <Paper key="exam" variant="outlined" onClick={() => navigate(`/batches/${next.exam.batch}/exams/${next.exam._id}`)} sx={{ p: 2, borderRadius: 3, cursor: "pointer" }}>
      <Tint Icon={PenLine} color={theme.palette.error.main} />
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>{next.exam.open ? "Exam open" : "Next exam"}</Typography>
      <Typography noWrap sx={{ fontWeight: 700 }}>{next.exam.title}</Typography>
      <Typography variant="caption" sx={{ fontWeight: 700, color: "error.main" }}>
        {next.exam.open ? (next.exam.closesAt ? `closes ${relTime(next.exam.closesAt)}` : "Take it now") : relTime(next.exam.opensAt)}
      </Typography>
    </Paper>
  );
  if (next.live) tiles.push(
    <Paper key="live" variant="outlined" onClick={() => navigate(`/batches/${next.live.batch}/live-classes/${next.live._id}`)} sx={{ p: 2, borderRadius: 3, cursor: "pointer", ...(next.live.live ? { borderColor: "error.main", borderWidth: 1.5 } : {}) }}>
      <Tint Icon={next.live.live ? Radio : Video} color={theme.palette.error.main} />
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>Live class</Typography>
      <Typography noWrap sx={{ fontWeight: 700 }}>{next.live.title}</Typography>
      <Typography variant="caption" sx={{ fontWeight: 700, color: "error.main" }}>{next.live.live ? "Live now · Join" : relTime(next.live.scheduledAt)}</Typography>
    </Paper>
  );
  if (next.streak > 0) tiles.push(
    <Paper key="streak" variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
      <Tint Icon={Flame} color={theme.palette.warning.main} />
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>Streak</Typography>
      <Typography sx={{ fontWeight: 800, fontSize: 26, lineHeight: 1.2 }}>{next.streak} <Typography component="span" variant="caption" color="text.secondary">day{next.streak === 1 ? "" : "s"}</Typography></Typography>
    </Paper>
  );
  if (next.tasks?.length) tiles.push(
    <Paper key="tasks" variant="outlined" onClick={() => navigate(next.tasks[0].link || "/")} sx={{ p: 2, borderRadius: 3, cursor: "pointer" }}>
      <Tint Icon={Sparkles} color={theme.palette.ai.main} />
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>Today's plan</Typography>
      <Typography sx={{ fontWeight: 700 }}>{next.tasks.length} task{next.tasks.length === 1 ? "" : "s"}</Typography>
      <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>{next.tasks[0].title}</Typography>
    </Paper>
  );
  // The Rich cards bar chart (exams, lectures, results, doubts, with links)
  // fills what the real tiles leave of the row: all of it with none.
  const summaries = computeBatchSummaries(data.batches, data.upcoming, data.stats, navigate);
  if (summaries?.length && tiles.length < 4) tiles.push(
    <Paper key="chart" variant="outlined" sx={{ p: 2, pb: 0, borderRadius: 3, gridColumn: "1 / -1", ...cq(760, { gridColumn: `span ${4 - tiles.length}` }), display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      <SummaryColumnChart summaries={summaries} theme={theme} />
    </Paper>
  );
  // One slim full-width row above the tiles: play button, lecture, batch.
  const lead = cw ? (
    <Paper
      onClick={() => navigate(`/batches/${cw.batch._id}/lectures/${cw.lecture._id}`)}
      sx={{
        p: 1.75, borderRadius: 3, cursor: "pointer", gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 1.75,
        background: `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.primary.dark})`, color: theme.palette.primary.contrastText,
      }}
    >
      <Box sx={{ width: 44, height: 44, borderRadius: "50%", flexShrink: 0, bgcolor: "#fff", color: "primary.main", display: "flex", alignItems: "center", justifyContent: "center" }}><Play size={20} /></Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="caption" noWrap sx={{ opacity: 0.85, display: "block" }}>Continue · {cw.batch.name}</Typography>
        <Typography noWrap sx={{ fontWeight: 700, fontSize: 16 }}>{cw.lecture.title}</Typography>
        {cw.lecture.chapter?.title && <Typography variant="caption" noWrap sx={{ opacity: 0.85, display: "block" }}>{cw.lecture.chapter.title}</Typography>}
      </Box>
      <ChevronRight size={18} style={{ opacity: 0.8, flexShrink: 0 }} />
    </Paper>
  ) : null;
  return (
    <Box sx={{ containerType: "inline-size" }}>
      <Box sx={{ mb: 2.5 }}>
        <Typography variant="body2" color="text.secondary">{greeting()}</Typography>
        <Typography variant="h5" sx={{ fontWeight: 800 }}>{me?.name?.split(" ")[0] || "Welcome"}</Typography>
      </Box>
      {(lead || tiles.length > 0) && (
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", ...cq(760, { gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }), gap: 1.5, mb: 3, gridAutoFlow: "dense" }}>
          {lead}
          {tiles}
        </Box>
      )}
      {noticeCarousel}
      <Typography sx={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "text.secondary", mb: 1.25, mt: 1 }}>My {terms.batches}</Typography>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 1.5 }}>
        {data.batches.map((b) => <MiniBatch key={b._id} entry={b} navigate={navigate} theme={theme} />)}
      </Box>
    </Box>
  );
}

function TodayHome({ data, isLoading, navigate, theme, terms, noticeCarousel }) {
  const [only, setOnly] = useState(null);
  if (isLoading) return <SkeletonGrid />;
  if (!data?.batches?.length) return null;
  const next = data.next || {};
  const nameOf = new Map(data.batches.map((b) => [String(b._id), b.name]));
  const cw = data.continueWatching;
  const items = [
    ...(next.liveToday || []).map((l) => ({
      key: `l${l._id}`, batch: l.batch, at: l.at, hot: l.live, Icon: l.live ? Radio : Video, color: theme.palette.error.main,
      title: `Live class · ${l.title}`, sub: `${l.durationMinutes || 60} min`, to: `/batches/${l.batch}/live-classes/${l._id}`, action: l.live ? "Join" : null,
    })),
    ...(next.examsToday || []).map((e) => ({
      key: `e${e._id}`, batch: e.batch, at: e.at, Icon: PenLine, color: theme.palette.primary.main,
      title: `Exam · ${e.title}`, sub: `${e.closes ? "Closes" : "Opens"} ${clock(e.at)}${e.durationMinutes ? ` · ${e.durationMinutes} min` : ""}`, to: `/batches/${e.batch}/exams/${e._id}`, side: relTime(e.at),
    })),
    ...(cw ? [{ key: "cw", batch: cw.batch._id, Icon: Play, color: theme.palette.primary.main, title: `Continue · ${cw.lecture.title}`, sub: cw.lecture.chapter?.title || "", to: `/batches/${cw.batch._id}/lectures/${cw.lecture._id}` }] : []),
    ...(next.tasks || []).map((t, i) => ({ key: `t${i}`, batch: t.batch, Icon: Sparkles, color: theme.palette.ai.main, title: t.title, sub: t.detail || "Tutor task", to: t.link || "/" })),
  ].filter((it) => !only || String(it.batch) === only)
    .sort((a, b) => (a.hot ? -1 : b.hot ? 1 : 0) || (a.at ? +new Date(a.at) : Infinity) - (b.at ? +new Date(b.at) : Infinity));

  const timeline = (
    <Box>
      <Typography variant="body2" color="text.secondary">{new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</Typography>
      <Typography variant="h5" sx={{ fontWeight: 800, mb: 2 }}>Your day</Typography>
      {data.batches.length > 1 && (
        <Box sx={{ display: "flex", gap: 1, overflowX: "auto", pb: 1, mb: 1.5 }}>
          {[[null, "All"], ...data.batches.map((b) => [String(b._id), b.name])].map(([id, label]) => (
            <Box key={id || "all"} onClick={() => setOnly(id)} sx={{
              px: 1.5, py: 0.75, borderRadius: 99, fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", cursor: "pointer",
              bgcolor: only === id ? "text.primary" : "background.paper", color: only === id ? "background.paper" : "text.primary", border: 1, borderColor: only === id ? "text.primary" : "divider",
            }}>{label}</Box>
          ))}
        </Box>
      )}
      {items.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 3, borderRadius: 3, textAlign: "center" }}>
          <Clock size={22} style={{ opacity: 0.5 }} />
          <Typography sx={{ fontWeight: 600, mt: 1 }}>Nothing scheduled today</Typography>
          <Typography variant="body2" color="text.secondary">No classes or exams on today. Open a {terms.batch} to keep going.</Typography>
        </Paper>
      ) : (
        <Box sx={{ position: "relative", pl: 3, ...cq(560, { pl: 13 }) }}>
          <Box sx={{ position: "absolute", left: 8, ...cq(560, { left: 92 }), top: 10, bottom: 10, width: 2, bgcolor: "divider" }} />
          {items.map((it) => (
            <Box key={it.key} sx={{ position: "relative", mb: 1.5 }}>
              <Typography variant="body2" sx={{ display: "none", ...cq(560, { display: "block" }), position: "absolute", left: -112, top: 22, width: 70, textAlign: "right", color: it.hot ? "error.main" : "text.secondary", fontWeight: it.hot ? 700 : 400 }}>{it.hot ? "Now" : it.at ? clock(it.at) : "Anytime"}</Typography>
              <Box sx={{ position: "absolute", left: -22, ...cq(560, { left: -34, top: 24 }), top: 28, width: 12, height: 12, borderRadius: "50%", bgcolor: it.hot ? it.color : "background.paper", border: `2px solid ${it.color}`, boxShadow: it.hot ? `0 0 0 4px ${alpha(it.color, 0.2)}` : "none" }} />
              <Typography variant="caption" sx={{ display: "block", ...cq(560, { display: "none" }), color: it.hot ? "error.main" : "text.secondary", fontWeight: it.hot ? 700 : 400 }}>{it.hot ? "Live now" : it.at ? clock(it.at) : "Anytime"}</Typography>
              <Paper variant="outlined" onClick={() => navigate(it.to)} sx={{ p: 1.75, borderRadius: 3, cursor: "pointer", display: "flex", alignItems: "center", gap: 1.5, ...(it.hot ? { borderColor: it.color, borderWidth: 1.5 } : {}) }}>
                <Tint Icon={it.Icon} color={it.color} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography noWrap sx={{ fontWeight: 600, fontSize: 14 }}>{it.title}</Typography>
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>{[nameOf.get(String(it.batch)), it.sub].filter(Boolean).join(" · ")}</Typography>
                </Box>
                {it.action ? <Button size="small" variant="contained" color="error">{it.action}</Button>
                  : it.side ? <Typography variant="caption" sx={{ fontWeight: 700, color: it.color }}>{it.side}</Typography>
                  : <ChevronRight size={18} style={{ opacity: 0.4 }} />}
              </Paper>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );

  const side = (
    <Box>
      <Typography sx={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "text.secondary", mb: 1.25 }}>My {terms.batches}</Typography>
      <Box sx={{ display: "grid", gap: 1.25 }}>
        {data.batches.map((b) => <MiniBatch key={b._id} entry={b} navigate={navigate} theme={theme} row />)}
      </Box>
      {next.streak > 0 && (
        <Paper variant="outlined" sx={{ p: 1.75, borderRadius: 3, mt: 1.5, display: "flex", alignItems: "center", gap: 1.5 }}>
          <Tint Icon={Flame} color={theme.palette.warning.main} />
          <Box><Typography sx={{ fontWeight: 700 }}>{next.streak} day streak</Typography><Typography variant="caption" color="text.secondary">Keep it going today</Typography></Box>
        </Paper>
      )}
    </Box>
  );

  return (
    <Box sx={{ containerType: "inline-size" }}>
      {noticeCarousel}
      <Box sx={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", ...cq(860, { gridTemplateColumns: "minmax(0, 1fr) 300px", gap: 4 }), gap: 3, alignItems: "start" }}>
        {timeline}
        {side}
      </Box>
    </Box>
  );
}
