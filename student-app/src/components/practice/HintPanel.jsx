import { Box, Button, CircularProgress, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { Lightbulb } from "lucide-react";
import Latex from "../Latex";
import AiErrorAlert from "./AiErrorAlert";

// Hint-first tutor: up to `max` escalating AI hints on a question the
// student hasn't answered yet. Kept page-agnostic — the page owns the
// mutation and state and passes them in — so batch practice can reuse it
// with its own endpoint later.
export default function HintPanel({ hints, loading, error, onRequestHint, canRequest = true, disabled = false, max = 3, batchId, navigate, sx }) {
  const theme = useTheme();
  const remaining = max - hints.length;

  if (hints.length === 0 && !canRequest && !loading && !error) return null;

  return (
    <Box sx={sx}>
      {hints.length > 0 && (
        <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: "ai.bg", mb: 1 }}>
          {hints.map((hint, i) => (
            <Box key={i} sx={{ display: "flex", gap: 1, "& + &": { mt: 1 } }}>
              <Lightbulb size={14} color={theme.palette.ai.main} style={{ flexShrink: 0, marginTop: 3 }} />
              <Box>
                <Typography variant="caption" sx={{ color: "ai.main", fontWeight: 500 }}>Hint {i + 1}</Typography>
                <Latex as="div" style={{ fontSize: 13.5 }}>{hint}</Latex>
              </Box>
            </Box>
          ))}
        </Box>
      )}

      {/* The spinner shows whether or not another hint can be asked for. */}
      {loading ? (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, color: "text.secondary" }}>
          <CircularProgress size={14} />
          <Typography variant="caption">Thinking of a hint…</Typography>
        </Box>
      ) : canRequest && remaining > 0 && (
          <Button
            size="small"
            variant="outlined"
            startIcon={<Lightbulb size={14} />}
            onClick={onRequestHint}
            disabled={disabled}
            sx={{
              borderRadius: 5, textTransform: "none", fontSize: 12.5,
              py: 0.4, px: 1.4, lineHeight: 1.3,
              borderColor: "ai.main", color: "ai.main",
              "&:hover": { borderColor: "ai.main", bgcolor: "ai.bg" },
            }}
          >
            {hints.length === 0 ? "Get a hint" : "Next hint"} ({hints.length + 1}/{max})
          </Button>
      )}

      <AiErrorAlert error={error} batchId={batchId} navigate={navigate} sx={{ mt: 1 }} />
    </Box>
  );
}
