import { useRef, useState } from "react";
import { Box, Button, CircularProgress, Paper, TextField, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { Sparkles } from "lucide-react";
import Latex from "../Latex";
import LatexInserter from "../LatexInserter";
import AiErrorAlert from "./AiErrorAlert";

// A passage's written question in practice or the archive: write (and
// attach photos), then "Check with AI" for this one question. Each check is
// one AI call, charged like any written question. `grade({ answerText,
// answerImages })` returns { marks, totalMarks, feedback }. A failed check
// shows its error right under this question's box.
export default function WrittenPartCheck({ grade, renderImages, batchId, navigate }) {
  const theme = useTheme();
  const ref = useRef(null);
  const [text, setText] = useState("");
  const [images, setImages] = useState([]);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const check = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await grade({ answerText: text, answerImages: images.length ? images : undefined }));
    } catch (e) {
      setError({ message: e?.data?.message || "Could not check this answer right now. Try again.", capReached: e?.status === 429 });
    } finally {
      setBusy(false);
    }
  };

  const good = result && result.marks >= result.totalMarks * 0.6;
  return (
    <Box sx={{ pl: 3 }}>
      {!result && (
        <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 0.5 }}>
          <LatexInserter inputRef={ref} value={text} onChange={setText} />
        </Box>
      )}
      <TextField inputRef={ref} multiline minRows={3} fullWidth disabled={Boolean(result)} placeholder="Write your answer here"
        value={text} onChange={(e) => setText(e.target.value)} />
      {renderImages?.(images, setImages, Boolean(result))}
      {!result ? (
        <Button size="small" variant="outlined" sx={{ mt: 1 }} startIcon={busy ? <CircularProgress size={14} /> : <Sparkles size={14} />}
          disabled={busy || (!text.trim() && !images.length)} onClick={check}>
          {busy ? "Checking with AI…" : "Check with AI"}
        </Button>
      ) : (
        <Paper variant="outlined" sx={{ mt: 1, p: 1.5, borderRadius: 2, borderColor: good ? "success.main" : "error.main", bgcolor: good ? theme.palette.correctBg : theme.palette.incorrectBg }}>
          <Typography sx={{ fontWeight: 500, mb: 0.5 }}>{result.marks}/{result.totalMarks} marks</Typography>
          <Latex as="div" style={{ fontSize: 13.5 }}>{result.feedback}</Latex>
        </Paper>
      )}
      {result?.modelAnswer && (
        <Paper variant="outlined" sx={{ mt: 1, p: 1.5, borderRadius: 2 }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, display: "block", mb: 0.5 }}>Correct answer</Typography>
          <Latex as="div" style={{ fontSize: 13.5 }}>{result.modelAnswer}</Latex>
        </Paper>
      )}
      <AiErrorAlert error={error} batchId={batchId} navigate={navigate} sx={{ mt: 1 }} />
    </Box>
  );
}
