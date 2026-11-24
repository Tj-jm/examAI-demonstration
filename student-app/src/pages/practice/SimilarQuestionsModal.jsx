import { useState } from "react";
import {
  Dialog, Box, Typography, IconButton, Radio, Button, LinearProgress,
  Alert, CircularProgress,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useNavigate } from "react-router-dom";
import { X, Check, ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import Latex from "../../components/Latex";
import { useSales } from "../../BrandingContext";

// Fully self-contained and ephemeral — the 5 questions come from the AI
// generation call as plain objects (never saved as real Question
// documents), and checking an answer here is pure client-side comparison
// against the correctOption that arrived with each question. No server
// round-trip per answer, no PracticeAttempt record — this is a quick
// reinforcement loop, not a tracked practice session.
export default function SimilarQuestionsModal({ open, onClose, loading, error, questions, batchId }) {
  const sales = useSales();
  const theme = useTheme();
  const navigate = useNavigate();
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState(null);
  const [checked, setChecked] = useState(false);

  const question = questions?.[index];

  const next = () => {
    setIndex((i) => i + 1);
    setSelected(null);
    setChecked(false);
  };

  const handleClose = () => {
    setIndex(0);
    setSelected(null);
    setChecked(false);
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="xs">
      <Box sx={{ p: 2.5 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
          <Sparkles size={16} color={theme.palette.ai.main} />
          <Typography sx={{ fontWeight: 500, fontSize: 15, flex: 1 }}>Similar questions</Typography>
          <IconButton size="small" onClick={handleClose}><X size={18} /></IconButton>
        </Box>

        {loading && (
          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, py: 5 }}>
            <CircularProgress size={28} />
            <Typography variant="body2" color="text.secondary">Building 5 questions for you…</Typography>
          </Box>
        )}

        {error && (
          <Alert severity="warning">
            {error.message}
            {sales && error.capReached && batchId && (
              <Button
                size="small"
                variant="text"
                onClick={() => { onClose(); navigate(`/batches/${batchId}/ai-credits`); }}
                sx={{ display: "block", mt: 0.5, pl: 0 }}
              >
                Buy more AI credits
              </Button>
            )}
          </Alert>
        )}

        {!loading && !error && question && (
          <>
            <LinearProgress
              variant="determinate"
              value={(index / questions.length) * 100}
              sx={{ mb: 2, height: 3, borderRadius: 2 }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
              {index + 1} of {questions.length}
            </Typography>

            <Latex as="div" style={{ marginBottom: 14, fontSize: 15 }}>{question.question}</Latex>

            <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mb: 2 }}>
              {question.options.map((opt) => {
                const isCorrect = checked && opt.key === question.correctOption;
                const isMineWrong = checked && !isCorrect && opt.key === selected;
                const stateColor = isCorrect ? theme.palette.success.main : isMineWrong ? theme.palette.error.main : undefined;
                const stateBg = isCorrect ? theme.palette.correctBg : isMineWrong ? theme.palette.incorrectBg : "transparent";

                return (
                  <Box
                    key={opt.key}
                    onClick={() => !checked && setSelected(opt.key)}
                    sx={{
                      display: "flex", alignItems: "center", gap: 1,
                      borderRadius: 2, px: 1.25, py: 0.75, border: "1px solid",
                      borderColor: stateColor || "divider", bgcolor: stateBg,
                      cursor: checked ? "default" : "pointer",
                    }}
                  >
                    <Radio
                      size="small"
                      checked={opt.key === selected}
                      sx={{ p: 0.5, pointerEvents: "none", ...(stateColor ? { color: stateColor, "&.Mui-checked": { color: stateColor } } : {}) }}
                    />
                    <Box sx={{ flex: 1, fontSize: 14 }}><Latex>{opt.text}</Latex></Box>
                    {isCorrect && <Check size={16} color={theme.palette.success.main} />}
                  </Box>
                );
              })}
            </Box>

            {checked && (
              <Box sx={{ mb: 2, p: 1.5, borderRadius: 2, bgcolor: "action.hover" }}>
                <Latex as="div" style={{ fontSize: 13 }}>{question.solutionText}</Latex>
              </Box>
            )}

            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <IconButton size="small" disabled={index === 0} onClick={() => { setIndex((i) => i - 1); setSelected(null); setChecked(false); }}>
                <ChevronLeft size={18} />
              </IconButton>

              {!checked ? (
                <Button variant="contained" disabled={!selected} onClick={() => setChecked(true)}>
                  Check
                </Button>
              ) : index < questions.length - 1 ? (
                <Button variant="contained" onClick={next}>Next</Button>
              ) : (
                <Button variant="contained" onClick={handleClose}>Done</Button>
              )}

              <IconButton size="small" disabled={index >= questions.length - 1} onClick={next}>
                <ChevronRight size={18} />
              </IconButton>
            </Box>
          </>
        )}
      </Box>
    </Dialog>
  );
}
