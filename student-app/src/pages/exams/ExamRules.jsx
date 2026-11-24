import { Box, Typography, Paper, Button, IconButton, Skeleton, Alert } from "@mui/material";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Clock, ListChecks, Repeat, Trophy } from "lucide-react";
import { useGetExamRulesQuery } from "../../api/contentApi";
import { opensLabel } from "./ExamList";
import SafeMarkdown from "../../components/SafeMarkdown";

// The rules screen exists so starting an exam is a deliberate second step,
// not a misclick on a list row — once a first attempt begins the timer does
// not stop for a change of mind.
export default function ExamRules() {
  const { batchId, id } = useParams();
  const navigate = useNavigate();
  const { data: exam, isLoading, error } = useGetExamRulesQuery({ batchId, id });

  // Not published yet (a notice linked here early), removed, or not for
  // this batch: say so, instead of loading forever.
  if (!isLoading && !exam) {
    return (
      <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 560, mx: "auto" }}>
        <Alert severity="info" sx={{ mb: 2 }}>
          {error?.status === 404
            ? "This exam isn't available yet. Check back when it's announced as open."
            : error?.data?.message || "This exam couldn't be loaded."}
        </Alert>
        <Button variant="outlined" onClick={() => navigate(`/batches/${batchId}/exams`)}>Back to exams</Button>
      </Box>
    );
  }

  if (isLoading || !exam) {
    return <Box sx={{ p: 3 }}><Skeleton variant="rounded" height={300} /></Box>;
  }

  const attemptsLeft = exam.attemptsAllowed - exam.attemptsUsed;

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 560, mx: "auto" }}>
      <IconButton size="small" onClick={() => navigate(`/batches/${batchId}/exams`)} sx={{ mb: 2 }}>
        <ArrowLeft size={18} />
      </IconButton>

      <Typography variant="h5" sx={{ fontWeight: 500, mb: 1 }}>{exam.title}</Typography>
      {exam.description && (
        <Box sx={{ mb: 3, color: "text.secondary", fontSize: 14 }}><SafeMarkdown>{exam.description}</SafeMarkdown></Box>
      )}

      <Paper variant="outlined" sx={{ borderRadius: 3, p: 3, mb: 3 }}>
        <Row icon={Clock} label="Duration" value={`${exam.durationMinutes} minutes`} />
        <Row icon={ListChecks} label="Questions" value={`${exam.questionCount} · ${exam.totalMarks} marks`} />
        <Row icon={Repeat} label="Attempts" value={`${attemptsLeft} of ${exam.attemptsAllowed} remaining`} last />
      </Paper>

      {exam.hasWrittenQuestions && exam.scriptGraceMinutes > 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Once the {exam.durationMinutes}-minute timer ends, you'll have an
          extra {exam.scriptGraceMinutes} minute{exam.scriptGraceMinutes === 1 ? "" : "s"} to
          attach photographed answer scripts — everything else locks at that point.
        </Alert>
      )}

      {(exam.awayMode === "submit" || exam.awayMode === "abandon") && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Stay on the exam. If you switch apps or tabs, or leave the exam page, for more
          than {exam.awayMinutes} minute{exam.awayMinutes === 1 ? "" : "s"} in one go,{" "}
          {exam.awayMode === "abandon"
            ? "the attempt ends and scores zero."
            : "the attempt is submitted with the answers saved by then."}
          {" "}A phone call or a lost connection counts as time away.
        </Alert>
      )}

      {!exam.isOpen && (exam.opensAt
        ? <Alert severity="info" sx={{ mb: 2 }}>This exam opens on {opensLabel(exam.opensAt)}. Come back then to start.</Alert>
        : <Alert severity="warning" sx={{ mb: 2 }}>This exam is not open right now.</Alert>)}
      {!exam.inProgress && attemptsLeft <= 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>No attempts remaining on this exam.</Alert>
      )}

      {exam.inProgress ? (
        <Alert severity="warning" icon={<Trophy size={18} />} sx={{ mb: 3 }}>
          You already have this exam open — the timer has been running since
          you started it. Resume to pick up exactly where you left off.
        </Alert>
      ) : (
        <Alert severity="info" icon={<Trophy size={18} />} sx={{ mb: 3 }}>
          Once started, the timer runs continuously — closing the page does not
          pause it. Answers save as you go, so you can safely reopen this exam
          if you get disconnected.
        </Alert>
      )}

      <Button
        variant="contained"
        size="large"
        fullWidth
        disabled={!exam.isOpen || (!exam.inProgress && attemptsLeft <= 0)}
        onClick={() => navigate(`/batches/${batchId}/exams/${id}/take`)}
      >
        {exam.inProgress ? "Resume exam" : exam.attemptsUsed > 0 ? `Start attempt ${exam.attemptsUsed + 1}` : "Start exam"}
      </Button>
    </Box>
  );
}

function Row({ icon: Icon, label, value, last }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, py: 1.2, borderBottom: last ? "none" : "1px solid", borderColor: "divider" }}>
      <Icon size={16} color="var(--mui-palette-text-secondary, gray)" />
      <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>{label}</Typography>
      <Typography variant="body2" sx={{ fontWeight: 500 }}>{value}</Typography>
    </Box>
  );
}
