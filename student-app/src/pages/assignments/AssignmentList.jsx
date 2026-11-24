import { Box, Typography, Paper, Chip, Skeleton, IconButton } from "@mui/material";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ClipboardList } from "lucide-react";
import { useGetAssignmentsQuery, useGetBatchQuery } from "../../api/contentApi";
import EmptyState from "../../components/EmptyState";
import FeatureGate from "../../components/FeatureGate";
import { BatchContextCard } from "../../components/BatchSwitcher";
import { useTerms, useHomeMx } from "../../BrandingContext";

export const dueText = (dueAt, now = Date.now()) => {
  const ms = new Date(dueAt).getTime() - now;
  const abs = Math.abs(ms);
  const span = abs < 3600000 ? `${Math.max(1, Math.round(abs / 60000))} min` : abs < 86400000 * 2 ? `${Math.round(abs / 3600000)} h` : `${Math.round(abs / 86400000)} days`;
  return ms >= 0 ? `Due in ${span}` : `Was due ${span} ago`;
};

// What a student's own status reads as, and its colour.
export const statusOf = (a) => {
  const m = a.mine;
  if (m?.status === "graded") return { label: `${m.finalMarks} / ${a.maxMarks}`, color: "success" };
  if (m?.status === "submitted") return { label: m.latePenalty ? "Handed in late" : "Handed in", color: "primary" };
  if (!a.open) return { label: "Missed", color: "error" };
  if (new Date(a.dueAt).getTime() < Date.now()) return { label: "Late: still open", color: "warning" };
  return { label: m?.status === "draft" ? "Draft saved" : "To do", color: "default" };
};

export default function AssignmentList() {
  const mx = useHomeMx();
  const terms = useTerms();
  const { batchId } = useParams();
  const navigate = useNavigate();
  const { data: batch } = useGetBatchQuery(batchId);
  const { data, isLoading } = useGetAssignmentsQuery(batchId);
  const items = data?.assignments || [];

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 700, mx }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
        <IconButton size="small" onClick={() => navigate(`/batches/${batchId}`)} aria-label={`Back to ${terms.batch}`}><ArrowLeft size={18} /></IconButton>
      </Box>
      <BatchContextCard batch={batch} pageName="Assignments" />

      <FeatureGate batch={batch} feature="assignments" label="Assignments">
        {isLoading ? (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} variant="rounded" height={72} />)}
          </Box>
        ) : items.length === 0 ? (
          <EmptyState icon={ClipboardList} title="No assignments yet" description={`Work your ${terms.teacher} sets for this ${terms.batch} shows up here, with its due date.`} />
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
            {items.map((a) => {
              const st = statusOf(a);
              return (
                <Paper
                  key={a._id}
                  variant="outlined"
                  onClick={() => navigate(`/batches/${batchId}/assignments/${a._id}`)}
                  sx={{ p: 2, borderRadius: 2, cursor: "pointer", display: "flex", alignItems: "center", gap: 2 }}
                >
                  <Box sx={{ width: 40, height: 40, borderRadius: 2, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", bgcolor: "action.hover", color: "primary.main" }}>
                    <ClipboardList size={20} />
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 600 }} noWrap>{a.title}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {a.mine?.status === "graded" || a.mine?.status === "submitted" ? `Handed in ${new Date(a.mine.submittedAt).toLocaleDateString()}` : dueText(a.dueAt)} · {a.maxMarks} marks
                    </Typography>
                  </Box>
                  <Chip size="small" label={st.label} color={st.color} variant={st.color === "default" ? "outlined" : "filled"} />
                </Paper>
              );
            })}
          </Box>
        )}
      </FeatureGate>
    </Box>
  );
}
