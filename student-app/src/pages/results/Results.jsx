import { useState } from "react";
import {
  Box, Typography, Paper, Chip, Skeleton, ToggleButtonGroup, ToggleButton, IconButton,
} from "@mui/material";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Trophy, Layers, ArrowLeft } from "lucide-react";
import { useGetBatchesQuery, useGetSubmissionsQuery } from "../../api/contentApi";
import { BatchContextCard } from "../../components/BatchSwitcher";
import EmptyState from "../../components/EmptyState";
import Pager from "../../components/Pager";
import { useSales, useTerms, useHomeMx } from "../../BrandingContext";

const STATUS_META = {
  graded: { label: "Graded", color: "success" },
  grading: { label: "Grading", color: "warning" },
  submitted: { label: "Scoring", color: "warning" },
  rejected: { label: "Rejected", color: "error" },
  abandoned: { label: "Abandoned", color: "default" },
  in_progress: { label: "In progress", color: "info" },
  disqualified: { label: "Disqualified", color: "error" },
};

// The one place every attempt across every batch and every exam actually
// lives — everywhere else (the exam list, the dashboard) only ever shows a
// slice of this. Filtering by batch rather than showing everything flat
// matters once a student has been through more than one course.
//
// fromRoute is captured once, from how the page was reached — a ?batchId=
// present the moment this page first mounted means a specific batch's own
// home page linked here (see BatchHome.jsx), the same distinction
// useActiveBatch makes for Lectures/Exams/Practice via a route param
// instead of a query one. Everything after that first render is local
// state, same as those three pages' own switcher — clicking a toggle is an
// in-page preference, not a fresh arrival, and must never re-trigger the
// "arrived scoped" treatment. That was the actual bug in the previous
// version: reading scope from the URL on every render meant clicking a
// filter option rewrote the URL, which then looked identical to arriving
// fresh from a batch's own page, and swapped the whole filter out from
// under whoever just clicked it.
export default function Results() {
  const sales = useSales();
  const terms = useTerms();
  const mx = useHomeMx();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { data: batchData, isLoading: loadingBatches } = useGetBatchesQuery();

  const [fromRoute] = useState(() => Boolean(searchParams.get("batchId")));
  const routeBatchId = fromRoute ? searchParams.get("batchId") : null;
  const [selected, setSelected] = useState(routeBatchId || "all");

  const batchId = fromRoute ? routeBatchId : selected;
  const [page, setPage] = useState(1);

  const { data, isLoading } = useGetSubmissionsQuery(
    batchId === "all" ? { page } : { batchId, page }
  );

  const enrolled = batchData?.enrolled || [];
  const submissions = data?.submissions || [];
  const scopedBatch = fromRoute ? enrolled.find((b) => b._id === routeBatchId) : null;

  const showAllBatches = () => {
    // A real navigation when scope came from a route — this page's whole
    // identity was "here for one batch", so leaving that means actually
    // leaving, not quietly forgetting how it was reached. A plain state
    // change otherwise, exactly like clicking "All batches" would.
    if (fromRoute) navigate("/results", { replace: true });
    else setSelected("all");
    setPage(1);
  };

  const open = (submission) => {
    if (submission.status === "in_progress") {
      navigate(`/batches/${submission.batch?._id || submission.batch}/exams/${submission.exam._id}`);
      return;
    }
    navigate(`/submissions/${submission._id}`);
  };

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 800, mx }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 3 }}>
        {fromRoute && (
          <IconButton size="small" onClick={() => navigate(`/batches/${routeBatchId}`)}><ArrowLeft size={18} /></IconButton>
        )}
        {!fromRoute && <Typography variant="h5">Results</Typography>}
      </Box>

      {fromRoute ? (
        <BatchContextCard batch={scopedBatch} pageName="Results" />
      ) : (
        !loadingBatches && enrolled.length > 1 && (
          <ToggleButtonGroup
            value={selected}
            exclusive
            onChange={(e, v) => { if (v) { setSelected(v); setPage(1); } }}
            size="small"
            sx={{ mb: 3, flexWrap: "wrap", gap: 1, "& .MuiToggleButtonGroup-grouped": { border: 1, borderColor: "divider !important", borderRadius: "16px !important" } }}
          >
            <ToggleButton value="all">All {terms.batches}</ToggleButton>
            {enrolled.map((b) => (
              <ToggleButton key={b._id} value={b._id}>{b.name}</ToggleButton>
            ))}
          </ToggleButtonGroup>
        )
      )}

      {isLoading ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} variant="rounded" height={68} />)}
        </Box>
      ) : submissions.length === 0 ? (
        // Two different empties wearing one screen: nothing anywhere vs.
        // nothing under the current filter. The second gets a way back out
        // of the filter rather than a dead end that looks like data loss.
        batchId === "all" ? (
          <EmptyState
            icon={Trophy}
            title="No attempts yet"
            description={
              enrolled.length === 0
                ? `Join a ${terms.batch} and every exam you sit will be scored here.`
                : "Every exam you sit gets scored here, with a question-by-question breakdown."
            }
            action={
              enrolled.length === 0
                ? (sales ? { label: `Browse ${terms.batches}`, onClick: () => navigate("/purchases") } : undefined)
                : { label: "Find an exam", onClick: () => navigate(`/batches/${enrolled[0]._id}/exams`) }
            }
          />
        ) : (
          <EmptyState
            icon={Layers}
            title={`Nothing in this ${terms.batch}`}
            description="You have attempts elsewhere — they are under the other filters."
            secondaryAction={{ label: `Show all ${terms.batches}`, onClick: showAllBatches }}
          />
        )
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          {submissions.map((s) => {
            const meta = s.offline?.absent ? { label: "Absent", color: "default" } : STATUS_META[s.status] || { label: s.status, color: "default" };
            const pct = s.status === "graded" && s.totalMarks > 0
              ? Math.round((s.marks / s.totalMarks) * 100)
              : null;

            return (
              // Title + score + status badge share a row (so they align to
              // each other, not to the whole card), and the batch/attempt/
              // date line sits on its own row below — previously that line
              // was a second line inside a column centered against a
              // single-line score+badge, which put the badge vertically
              // between the two text lines instead of beside the title,
              // reading as overlap whenever the batch line ran long.
              <Paper
                key={s._id}
                variant="outlined"
                onClick={() => open(s)}
                sx={{ p: 2, borderRadius: 2, cursor: "pointer" }}
              >
                <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                  <Typography sx={{ fontWeight: 500, fontSize: 14, flex: 1, minWidth: 0 }} noWrap>
                    {s.exam?.title}
                  </Typography>
                  {s.offline && <Chip size="small" label="Offline" variant="outlined" sx={{ flexShrink: 0 }} />}
                  {pct !== null && (
                    <Typography variant="body2" sx={{ fontWeight: 500, flexShrink: 0 }} color="text.secondary">
                      {s.marks}/{s.totalMarks}
                    </Typography>
                  )}
                  <Chip
                    size="small" label={meta.label} color={meta.color}
                    variant={meta.color === "default" ? "outlined" : "filled"}
                    sx={{ flexShrink: 0 }}
                  />
                </Box>
                <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block", mt: 0.5 }}>
                  {s.batch?.name ? `${s.batch.name} · ` : ""}attempt {s.attempt}
                  {" · "}
                  {new Date(s.submittedAt || s.startedAt).toLocaleDateString()}
                </Typography>
              </Paper>
            );
          })}
          <Pager page={data?.page || 1} pages={data?.pages || 1} total={data?.total || 0} onChange={setPage} />
        </Box>
      )}
    </Box>
  );
}
