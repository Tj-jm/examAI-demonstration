import { Alert, Button } from "@mui/material";
import { useSales } from "../../BrandingContext";

// The same "you've hit today's free allowance" error shows up wherever an
// AI feature can be capped — explain, similar questions, written grading —
// on both PracticeSession.jsx (the full practice page) and PracticeModal.jsx
// (the study plan's quick-practice popup), so this is shared rather than
// repeated with a slightly different Alert in each place. Originally lived
// only in PracticeSession.jsx; pulled out here once the study plan's modal
// needed the exact same treatment for its own "Check with AI" button rather
// than a plainer, capReached-blind error banner.
export default function AiErrorAlert({ error, batchId, navigate, sx }) {
  const sales = useSales();
  if (!error) return null;
  return (
    <Alert severity="warning" sx={sx}>
      {error.message}
      {sales && error.capReached && batchId && (
        <Button
          size="small"
          variant="text"
          onClick={() => navigate(`/batches/${batchId}/ai-credits`)}
          sx={{ display: "block", mt: 0.5, pl: 0 }}
        >
          Buy more AI credits
        </Button>
      )}
    </Alert>
  );
}
