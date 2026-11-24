import { useState } from "react";
import { Box, Typography, Paper, Chip, Skeleton, IconButton } from "@mui/material";
import { useNavigate } from "react-router-dom";
import { PenLine, ArrowLeft, Trophy, ClipboardList } from "lucide-react";
import { useGetExamsQuery } from "../../api/contentApi";
import { useActiveBatch } from "../../hooks/useActiveBatch";
import { BatchContext, NoBatchesGate } from "../../components/BatchSwitcher";
import EmptyState from "../../components/EmptyState";
import Pager from "../../components/Pager";
import FilterChips from "../../components/FilterChips";
import { useTerms, useHomeMx } from "../../BrandingContext";

const FILTERS = [["all", "All"], ["open", "Open"], ["upcoming", "Upcoming"], ["taken", "Taken"], ["closed", "Closed"]];
const EMPTY = {
  open: "No exam is open for you right now.",
  upcoming: "No exams scheduled to open later.",
  taken: "You haven't taken any exams here yet.",
  closed: "No closed exams.",
};

// One state per exam, not label-off-isOpen / color-off-status computed
// independently the way this used to work — that let a mock exam whose
// window closed while a submission was still in_progress render as an
// orange "in progress"-colored chip that said "Closed", a genuine
// contradiction. Resuming wins over a closed window here so the chip still
// reads "you have unfinished work" — whether the click-through actually
// succeeds is the backend's own isOpen() gate, a separate concern.
const examState = (exam) => {
  if (exam.status === "in_progress") return "resume";
  if (!exam.isOpen) return exam.opensAt ? "upcoming" : "closed";
  if (exam.status === "exhausted") return "exhausted";
  return "start";
};

// Distinct color per meaning, not "grey unless in_progress" — Start and No
// attempts left used to both be color="default", differing only by
// filled/outlined, which is too subtle to scan a list by.
const STATE_STYLE = {
  start: { label: "Start", color: "primary", variant: "filled" },
  resume: { label: "Resume", color: "warning", variant: "filled" },
  exhausted: { label: "No attempts left", color: "default", variant: "outlined" },
  closed: { label: "Closed", color: "default", variant: "outlined" },
  upcoming: { label: "Opens soon", color: "info", variant: "outlined" },
};

// "12 Oct, 9:00 am" — when a scheduled exam opens, in the student's time.
export const opensLabel = (at) =>
  new Date(at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

// Reachable two ways — see useActiveBatch for why that no longer means two
// screens.
export default function ExamList() {
  const terms = useTerms();
  const mx = useHomeMx();
  const navigate = useNavigate();
  const { batchId, activeBatch, enrolled, loadingBatches, showSwitcher, fromRoute, setActiveBatch } = useActiveBatch();
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState("all");
  const { data, isLoading, isFetching } = useGetExamsQuery({ batchId, page, filter }, { skip: !batchId });
  const anyAtAll = (data?.counts?.all ?? (data?.exams || []).length) > 0;

  if (loadingBatches) {
    return (
      <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 800, mx }}>
        <Skeleton variant="rounded" height={40} sx={{ mb: 3, maxWidth: 300 }} />
        <Skeleton variant="rounded" height={72} />
      </Box>
    );
  }

  if (enrolled.length === 0) {
    return <Box sx={{ p: { xs: 2, md: 4 } }}><NoBatchesGate /></Box>;
  }

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 800, mx }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: showSwitcher ? 2 : 3 }}>
        {fromRoute && (
          <IconButton size="small" onClick={() => navigate(`/batches/${batchId}`)}><ArrowLeft size={18} /></IconButton>
        )}
        {!fromRoute && <Typography variant="h6" sx={{ fontWeight: 500, fontSize: 17 }}>Exams</Typography>}
      </Box>

      <BatchContext batch={activeBatch} enrolled={enrolled} batchId={batchId} fromRoute={fromRoute} pageName="Exams" onChange={setActiveBatch} />

      {isLoading ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} variant="rounded" height={72} />)}
        </Box>
      ) : !anyAtAll ? (
        <EmptyState
          icon={ClipboardList}
          title="No exams scheduled"
          description={`Your ${terms.teacher} has not published an exam for this ${terms.batch} yet. Practice keeps your score moving meanwhile.`}
          action={{ label: "Go to practice", onClick: () => navigate(`/batches/${batchId}/practice`) }}
        />
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, opacity: isFetching ? 0.6 : 1 }}>
          <FilterChips options={FILTERS} value={filter} counts={data?.counts} onChange={(f) => { setFilter(f); setPage(1); }} />
          {data.exams.length === 0 && (
            <Box sx={{ py: 4, textAlign: "center", color: "text.secondary", fontSize: 14 }}>{EMPTY[filter] || "Nothing here."}</Box>
          )}
          {data.exams.map((exam) => {
            const state = examState(exam);
            const style = STATE_STYLE[state];
            // Exhausted was previously full-brightness, identical to a
            // startable exam except for a small chip — dimmed here too so
            // "dead end" reads at the card level, not just the chip.
            const dimmed = state === "closed" || state === "exhausted";

            return (
              <Paper
                key={exam._id}
                variant="outlined"
                sx={{ p: 2, borderRadius: 2, cursor: "pointer", display: "flex", alignItems: "center", gap: 2, opacity: dimmed ? 0.6 : 1 }}
                onClick={() => navigate(`/batches/${batchId}/exams/${exam._id}`)}
              >
                <Box sx={{ width: 38, height: 38, borderRadius: 2, bgcolor: "action.hover", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {exam.status === "in_progress" ? <PenLine size={17} /> : exam.lastGraded ? <Trophy size={17} /> : <PenLine size={17} />}
                </Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography sx={{ fontWeight: 500, fontSize: 14 }} noWrap>{exam.title}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {exam.questionCount} questions · {exam.durationMinutes} min
                    {exam.lastGraded ? ` · last scored ${exam.lastGraded.marks}/${exam.lastGraded.totalMarks}` : ""}
                  </Typography>
                </Box>
                <Chip size="small" label={state === "upcoming" ? `Opens ${opensLabel(exam.opensAt)}` : style.label} color={style.color} variant={style.variant} />
              </Paper>
            );
          })}
          <Pager page={data?.page || 1} pages={data?.pages || 1} total={data?.total || 0} onChange={setPage} />
        </Box>
      )}
    </Box>
  );
}
