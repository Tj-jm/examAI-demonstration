import { useEffect, useState } from "react";
import { Box, Typography, Paper, Chip, Skeleton, IconButton } from "@mui/material";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Video, Radio } from "lucide-react";
import { useGetLiveClassesQuery, useGetBatchQuery } from "../../api/contentApi";
import EmptyState from "../../components/EmptyState";
import FeatureGate from "../../components/FeatureGate";
import { BatchContextCard } from "../../components/BatchSwitcher";
import Pager from "../../components/Pager";
import FilterChips from "../../components/FilterChips";
import { useTerms } from "../../BrandingContext";

const FILTERS = [["all", "All"], ["live", "Live now"], ["upcoming", "Upcoming"], ["past", "Past"]];
const EMPTY = {
  live: "Nothing is live right now.",
  upcoming: "No classes scheduled yet.",
  past: "No past classes yet.",
};

const STATUS_META = {
  scheduled: { label: "Scheduled", color: "default" },
  live: { label: "Live now", color: "error" },
  ended: { label: "Ended", color: "default" },
  cancelled: { label: "Cancelled", color: "default" },
};

// Same shape as DoubtList: batch context card up top, a simple stacked list
// below — nothing here needs a grid, so no minmax(0,1fr) concern (see
// project notes gotcha #3, which only bites noWrap text inside CSS grid
// tracks; this uses plain flex).
export default function LiveClassList() {
  const terms = useTerms();
  const { batchId } = useParams();
  const navigate = useNavigate();
  const { data: batch } = useGetBatchQuery(batchId);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState("all");
  // Checked every 20 seconds while a class is live or about to start, so
  // "Live now" comes and goes without a reload.
  const [pollMs, setPollMs] = useState(0);
  const { data, isLoading, isFetching } = useGetLiveClassesQuery({ batchId, page, filter }, { pollingInterval: pollMs });
  useEffect(() => {
    const soon = Date.now() + 30 * 60000;
    const active = (data?.counts?.live || 0) > 0 || (data?.liveClasses || []).some((lc) => lc.phase === "upcoming" && new Date(lc.scheduledAt).getTime() <= soon);
    setPollMs(active ? 20000 : 0);
  }, [data]);

  // Already ordered by the server: live now, then upcoming (soonest
  // first), then past (newest first), so a new class is near the top.
  const sorted = data?.liveClasses || [];
  const anyAtAll = (data?.counts?.all ?? sorted.length) > 0;

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 700, mx: "var(--home-mx)" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
        <IconButton size="small" onClick={() => navigate(`/batches/${batchId}`)}><ArrowLeft size={18} /></IconButton>
      </Box>

      <BatchContextCard batch={batch} pageName="Live Classes" />

      <FeatureGate batch={batch} feature="liveClasses" label="Live Classes">
      {isLoading ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} variant="rounded" height={72} />)}
        </Box>
      ) : !anyAtAll ? (
        <EmptyState
          icon={Video}
          title="No live classes yet"
          description={`Your ${terms.teacher} hasn't scheduled a live session on this ${terms.batch} yet.`}
        />
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, opacity: isFetching ? 0.6 : 1 }}>
          <FilterChips options={FILTERS} value={filter} counts={data?.counts} onChange={(f) => { setFilter(f); setPage(1); }} />
          {sorted.length === 0 && (
            <Box sx={{ py: 4, textAlign: "center", color: "text.secondary", fontSize: 14 }}>{EMPTY[filter] || "Nothing here."}</Box>
          )}
          {sorted.map((lc) => {
            // A scheduled class whose time passed without starting.
            const meta = lc.status === "scheduled" && lc.phase === "past"
              ? { label: "Not held", color: "default" }
              : STATUS_META[lc.status] || { label: lc.status, color: "default" };
            return (
              <Paper
                key={lc._id}
                variant="outlined"
                onClick={() => navigate(`/batches/${batchId}/live-classes/${lc._id}`)}
                sx={{ p: 2, borderRadius: 2, cursor: "pointer", display: "flex", alignItems: "center", gap: 2 }}
              >
                <Box sx={{
                  width: 36, height: 36, borderRadius: 2, flexShrink: 0,
                  bgcolor: "action.hover", display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {lc.status === "live" ? <Radio size={16} /> : <Video size={16} />}
                </Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography sx={{ fontSize: 14 }} noWrap>{lc.title}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {new Date(lc.scheduledAt).toLocaleString()} · {lc.durationMinutes} min
                  </Typography>
                </Box>
                <Chip size="small" label={meta.label} color={meta.color} />
              </Paper>
            );
          })}
          <Pager page={data?.page || 1} pages={data?.pages || 1} total={data?.total || 0} onChange={setPage} />
        </Box>
      )}
      </FeatureGate>
    </Box>
  );
}
