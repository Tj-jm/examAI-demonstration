import { useState } from "react";
import {
  Box, Typography, Paper, Chip, Skeleton, IconButton, Button,
} from "@mui/material";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, HelpCircle, Sparkles, User, Plus } from "lucide-react";
import { useGetMyDoubtsQuery, useGetBatchQuery } from "../../api/contentApi";
import EmptyState from "../../components/EmptyState";
import FeatureGate from "../../components/FeatureGate";
import AiUsageMeter from "../../components/AiUsageMeter";
import { BatchContextCard } from "../../components/BatchSwitcher";
import Pager from "../../components/Pager";
import DoubtQuotaMeter from "./DoubtQuotaMeter";
import { useHomeMx } from "../../BrandingContext";

const STATUS_META = {
  pending: { label: "Working on it", color: "warning" },
  answered: { label: "Answered", color: "info" },
  escalated: { label: "With a human", color: "warning" },
  resolved: { label: "Resolved", color: "success" },
};

export default function DoubtList() {
  const mx = useHomeMx();
  const { batchId } = useParams();
  const navigate = useNavigate();
  const { data: batch } = useGetBatchQuery(batchId);
  const [page, setPage] = useState(1);
  const { data, isLoading } = useGetMyDoubtsQuery({ batchId, page });

  const doubts = data?.doubts || [];

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 700, mx }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
        <IconButton size="small" onClick={() => navigate(`/batches/${batchId}`)}><ArrowLeft size={18} /></IconButton>
        <Box sx={{ flex: 1 }} />
        {batch?.features?.doubtSolving && (
          <Button
            size="small"
            variant="contained"
            startIcon={<Plus size={15} />}
            onClick={() => navigate(`/batches/${batchId}/doubts/new`)}
          >
            Ask
          </Button>
        )}
      </Box>

      <BatchContextCard batch={batch} pageName="Doubts" />

      <FeatureGate batch={batch} feature="doubtSolving" label="Doubts">
      <AiUsageMeter batchId={batchId} />
      <DoubtQuotaMeter batchId={batchId} />

      {isLoading ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} variant="rounded" height={64} />)}
        </Box>
      ) : doubts.length === 0 ? (
        <EmptyState
          icon={HelpCircle}
          title="No doubts asked yet"
          description="Stuck on a question? Send it here with a photo if it helps, and get a worked answer back."
          action={{ label: "Ask a doubt", icon: Plus, onClick: () => navigate(`/batches/${batchId}/doubts/new`) }}
        />
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          {doubts.map((d) => {
            const meta = STATUS_META[d.status] || { label: d.status, color: "default" };
            return (
              <Paper
                key={d._id}
                variant="outlined"
                onClick={() => navigate(`/batches/${batchId}/doubts/${d._id}`)}
                sx={{ p: 2, borderRadius: 2, cursor: "pointer", display: "flex", alignItems: "center", gap: 2 }}
              >
                <Box sx={{
                  width: 36, height: 36, borderRadius: 2, flexShrink: 0,
                  bgcolor: "action.hover", display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {d.mode === "ai" ? <Sparkles size={16} /> : <User size={16} />}
                </Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography sx={{ fontSize: 14 }} noWrap>{d.question}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {new Date(d.createdAt).toLocaleDateString()}
                  </Typography>
                </Box>
                <Chip size="small" label={meta.label} color={meta.color} variant={meta.color === "default" ? "outlined" : "filled"} />
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
