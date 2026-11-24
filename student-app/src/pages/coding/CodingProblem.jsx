import { useEffect, useRef, useState } from "react";
import { Box, Typography, Paper, IconButton, Button, Skeleton, Alert, Chip, CircularProgress } from "@mui/material";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Send, CheckCircle2, XCircle, History } from "lucide-react";
import { useGetCodingProblemQuery, useSaveCodingDraftMutation, useRunCodingProblemMutation, useSubmitCodingProblemMutation } from "../../api/contentApi";
import CodeAnswer from "../../components/CodeAnswer";
import Latex from "../../components/Latex";
import ZoomableImage from "../../components/ZoomableImage";
import SolutionVideo from "../../components/SolutionVideo";
import AttachmentList from "../../components/AttachmentList";
import goBack from "../../utils/goBack";

const when = (d) => new Date(d).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// One coding problem: the problem beside the editor (stacked on phones).
// Code saves as the student types; Submit runs every test.
export default function CodingProblem() {
  const { batchId, problemId } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, error } = useGetCodingProblemQuery({ batchId, id: problemId });
  const [saveDraft] = useSaveCodingDraftMutation();
  const [submit, { isLoading: submitting, error: submitError }] = useSubmitCodingProblemMutation();
  const [answer, setAnswer] = useState(null);
  const [result, setResult] = useState(null);
  const timer = useRef(null);
  const started = useRef(Date.now());

  // The draft is loaded once per problem. Submitting refetches the problem
  // (for its history), and a new draft object then must not wipe the result
  // just shown or the code being typed.
  const loadedFor = useRef(null);
  useEffect(() => {
    if (!data || loadedFor.current === problemId) return;
    loadedFor.current = problemId;
    setResult(null);
    started.current = Date.now();
    setAnswer(data.draft ? { selectedOption: data.draft.language, answerText: data.draft.code } : null);
  }, [problemId, data]);

  if (isLoading) return <Box sx={{ p: 3 }}><Skeleton variant="rounded" height={420} /></Box>;
  if (error || !data) return <Box sx={{ p: 3 }}><Alert severity="error">{error?.data?.message || "Couldn't open this problem."}</Alert></Box>;
  const q = data.question;

  const change = (patch) => {
    setAnswer((a) => {
      const next = { ...a, ...patch };
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (next.selectedOption) saveDraft({ batchId, id: problemId, language: next.selectedOption, code: next.answerText || "" });
      }, 1000);
      return next;
    });
    if (result) setResult(null);
  };

  const language = q.languages.includes(answer?.selectedOption) ? answer.selectedOption : q.languages[0];
  const code = answer?.answerText ?? (q.starterCode || []).find((s) => s.language === language)?.code ?? "";
  const doSubmit = async () => {
    const r = await submit({ batchId, id: problemId, language, code, timeSpentMs: Date.now() - started.current });
    if (r.data) setResult(r.data);
  };

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1280, mx: "auto" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
        <IconButton size="small" onClick={() => goBack(navigate, `/batches/${batchId}/coding`)}><ArrowLeft size={18} /></IconButton>
        <Typography variant="caption" color="text.secondary">Coding practice</Typography>
        <Box sx={{ flex: 1 }} />
        <Chip size="small" label={`${q.marks} marks`} />
      </Box>

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "minmax(0, 5fr) minmax(0, 7fr)" }, gap: 2, alignItems: "start" }}>
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, position: { md: "sticky" }, top: { md: 16 } }}>
          <Typography component="div" variant="body1" sx={{ whiteSpace: "pre-wrap" }}><Latex as="div">{q.question}</Latex></Typography>
          {q.questionImage?.url && <ZoomableImage src={q.questionImage.url} sx={{ maxWidth: "100%", borderRadius: 2, mt: 1.5 }} />}

          {data.history?.length > 0 && (
            <Box sx={{ mt: 2.5 }}>
              <Typography variant="body2" fontWeight={700} sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 1 }}><History size={15} /> Your submissions</Typography>
              {data.history.map((h, i) => (
                <Box key={i} sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.5, borderTop: i ? 1 : 0, borderColor: "divider" }}>
                  {h.solved ? <CheckCircle2 size={14} color="var(--mui-palette-success-main, #2e7d32)" /> : <XCircle size={14} color="var(--mui-palette-error-main, #d32f2f)" />}
                  <Typography variant="caption" sx={{ flex: 1 }}>{when(h.at)}</Typography>
                  <Typography variant="caption" color="text.secondary">{h.language}{h.total != null ? ` · ${h.passed}/${h.total}` : ""}</Typography>
                </Box>
              ))}
            </Box>
          )}
        </Paper>

        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          <CodeAnswer
            question={q} answer={{ selectedOption: language, answerText: code }} onChange={change}
            useRun={useRunCodingProblemMutation} runArgs={{ batchId }} checked={result} locked={submitting} onRun={() => setResult(null)}
          />
          {submitError && <Alert severity="error">{submitError.data?.message || "Couldn't submit."}</Alert>}
          {result && (
            <Alert severity={result.isCorrect ? "success" : "warning"}>
              {result.isCorrect ? "Solved: every test passed." : `${result.passed} of ${result.total} tests passed. Change your code and submit again.`}
            </Alert>
          )}
          <Button variant="contained" size="large" disabled={submitting || !code.trim()} onClick={doSubmit} startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : <Send size={16} />}>
            {submitting ? "Running every test…" : "Submit"}
          </Button>
          {result && (result.solutionText || result.solutionImage?.url || result.solutionVideo?.url || result.solutionAttachments?.length > 0) && (
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
              <Typography variant="caption" color="text.secondary">Solution</Typography>
              {result.solutionText && <Typography component="div" variant="body2" sx={{ whiteSpace: "pre-wrap" }}><Latex as="div">{result.solutionText}</Latex></Typography>}
              {result.solutionImage?.url && <ZoomableImage src={result.solutionImage.url} sx={{ maxWidth: "100%", borderRadius: 1, mt: 1 }} />}
              <SolutionVideo video={result.solutionVideo} questionId={problemId} batchId={batchId} />
              <AttachmentList attachments={result.solutionAttachments} sx={{ mt: 1 }} />
            </Paper>
          )}
        </Box>
      </Box>
    </Box>
  );
}
