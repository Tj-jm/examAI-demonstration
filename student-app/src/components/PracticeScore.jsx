import { Box } from "@mui/material";
import { useCountUp, growX } from "../motion";
import Confetti from "./Confetti";

// The end of a practice set: the score counts up, its bar fills, and a
// strong round (80%+) gets confetti.
export function PracticeScoreTitle({ correct, total }) {
  const shown = useCountUp(correct);
  return (
    <>
      {total > 0 && correct / total >= 0.8 && <Confetti />}
      <span className="tnum">{Math.round(shown)}</span> of {total} correct
    </>
  );
}

export function PracticeScoreBar({ correct, total }) {
  const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
  return (
    <Box component="span" sx={{ display: "block", width: 220, maxWidth: "100%", height: 8, mx: "auto", mb: 1.5, borderRadius: 4, bgcolor: "action.hover", overflow: "hidden" }}>
      <Box
        component="span"
        sx={{
          display: "block", width: `${pct}%`, height: "100%", borderRadius: 4,
          bgcolor: pct >= 60 ? "success.main" : pct >= 40 ? "warning.main" : "error.main",
          transformOrigin: "left",
          animation: `${growX} 900ms cubic-bezier(.2,.7,.3,1) 150ms both`,
        }}
      />
    </Box>
  );
}
