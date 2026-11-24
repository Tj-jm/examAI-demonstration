import { Box, Typography, LinearProgress } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { User } from "lucide-react";
import { useGetDoubtQuotaQuery } from "../../api/contentApi";

// Renders nothing when the batch has no weekly limit set — a meter showing
// "unlimited" isn't a meter, and most batches will never set this at all,
// so the common case is silence, not an empty bar.
export default function DoubtQuotaMeter({ batchId, compact = false }) {
  const theme = useTheme();
  const { data } = useGetDoubtQuotaQuery(batchId);

  if (!data || !data.limit) return null;

  const { used, limit, resetsAt } = data;
  const atLimit = used >= limit;
  const pct = Math.min(100, (used / limit) * 100);
  const resetLabel = resetsAt
    ? new Date(resetsAt).toLocaleDateString(undefined, { weekday: "long" })
    : null;

  return (
    <Box sx={{ mb: compact ? 1.5 : 2.5 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 0.5 }}>
        <User size={13} style={{ opacity: 0.6 }} />
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
          {used} of {limit} doubts to a human this week
        </Typography>
        {resetLabel && (
          <Typography variant="caption" color="text.secondary" sx={{ opacity: 0.75 }}>
            Recharges {resetLabel}
          </Typography>
        )}
      </Box>
      <LinearProgress
        variant="determinate"
        value={pct}
        sx={{
          height: 6, borderRadius: 3,
          bgcolor: "action.hover",
          "& .MuiLinearProgress-bar": { borderRadius: 3, bgcolor: atLimit ? "error.main" : theme.palette.primary.main },
        }}
      />
    </Box>
  );
}
