import { useState } from "react";
import SolutionVideo from "../../components/SolutionVideo";
import {
  Dialog, Box, Typography, IconButton, Radio, Button, LinearProgress,
  Alert, CircularProgress, Chip, ToggleButtonGroup, ToggleButton,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { X, Check, ChevronLeft, ChevronRight, Trophy, Sparkles } from "lucide-react";
import Latex from "../../components/Latex";
import ZoomableImage from "../../components/ZoomableImage";
import AttachmentList from "../../components/AttachmentList";

// "Ace this lecture" — same self-contained, client-graded reveal loop as
// SimilarQuestionsModal, but over a lecture's persisted practice set
// (real Question documents, mixed mcq/mtf, some bank-assigned and some
// AI-generated) rather than one ephemeral AI-generated batch. Checking an
// answer is still pure client-side comparison against the answer key that
// came with each question — no per-answer round-trip, no attempt record.
export default function LecturePracticeModal({ open, onClose, loading, error, questions }) {
  const theme = useTheme();
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState(null); // mcq: option key
  const [statementAnswers, setStatementAnswers] = useState({}); // mtf: { [statementIndex]: bool }
  const [checked, setChecked] = useState(false);
  const [results, setResults] = useState({}); // questionId -> boolean, for the end-of-quiz tally

  const question = questions?.[index];
  const isMtf = question?.type === "mtf";

  const resetAnswer = () => {
    setSelected(null);
    setStatementAnswers({});
    setChecked(false);
  };

  const goTo = (nextIndex) => {
    setIndex(nextIndex);
    resetAnswer();
  };

  const handleClose = () => {
    setIndex(0);
    setResults({});
    resetAnswer();
    onClose();
  };

  const canCheck = isMtf
    ? question && Object.keys(statementAnswers).length === question.statements.length
    : Boolean(selected);

  const check = () => {
    if (!question) return;
    const correct = isMtf
      ? question.statements.every((s, i) => statementAnswers[i] === s.isTrue)
      : selected === question.correctOption;
    setResults((r) => ({ ...r, [question._id]: correct }));
    setChecked(true);
  };

  const answeredCount = Object.keys(results).length;
  const correctCount = Object.values(results).filter(Boolean).length;
  const isLastQuestion = index === (questions?.length || 0) - 1;

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="xs">
      <Box sx={{ p: 2.5 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
          <Trophy size={16} color={theme.palette.primary.main} />
          <Typography sx={{ fontWeight: 500, fontSize: 15, flex: 1 }}>Ace this lecture</Typography>
          <IconButton size="small" onClick={handleClose}><X size={18} /></IconButton>
        </Box>

        {loading && (
          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, py: 5 }}>
            <CircularProgress size={28} />
            <Typography variant="body2" color="text.secondary">Loading questions…</Typography>
          </Box>
        )}

        {error && (
          <Alert severity="warning">{error.data?.message || "Could not load practice questions right now."}</Alert>
        )}

        {!loading && !error && questions?.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: "center" }}>
            No practice questions here yet.
          </Typography>
        )}

        {!loading && !error && question && (
          <>
            <LinearProgress
              variant="determinate"
              value={(index / questions.length) * 100}
              sx={{ mb: 2, height: 3, borderRadius: 2 }}
            />
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1.5 }}>
              <Typography variant="caption" color="text.secondary">{index + 1} of {questions.length}</Typography>
              {question.source === "ai" && (
                <Chip
                  size="small"
                  icon={<Sparkles size={11} />}
                  label="AI"
                  sx={{ bgcolor: "ai.bg", color: "ai.main", height: 20, "& .MuiChip-icon": { color: "ai.main" } }}
                />
              )}
            </Box>

            {question.questionImage?.url && (
              <ZoomableImage src={question.questionImage.url} sx={{ maxWidth: "100%", borderRadius: 1, mb: 1 }} />
            )}
            <Latex as="div" style={{ marginBottom: 14, fontSize: 15 }}>{question.question}</Latex>

            {!isMtf && (
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
                        display: "flex", alignItems: opt.image?.url ? "flex-start" : "center", gap: 1,
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
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        {opt.image?.url && (
                          <ZoomableImage
                            src={opt.image.url}
                            sx={{ display: "block", maxWidth: "100%", maxHeight: 160, borderRadius: 1, mb: opt.text ? 0.5 : 0 }}
                          />
                        )}
                        {opt.text && <Box sx={{ fontSize: 14 }}><Latex>{opt.text}</Latex></Box>}
                      </Box>
                      {isCorrect && <Check size={16} color={theme.palette.success.main} />}
                    </Box>
                  );
                })}
              </Box>
            )}

            {isMtf && (
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mb: 2 }}>
                {question.statements.map((s, i) => {
                  const mine = statementAnswers[i];
                  const isRight = checked && mine === s.isTrue;
                  const isWrong = checked && mine !== undefined && mine !== s.isTrue;
                  const stateColor = isRight ? theme.palette.success.main : isWrong ? theme.palette.error.main : undefined;
                  const stateBg = isRight ? theme.palette.correctBg : isWrong ? theme.palette.incorrectBg : "transparent";

                  return (
                    <Box
                      key={i}
                      sx={{
                        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1.5,
                        borderRadius: 2, px: 1.25, py: 0.75, border: "1px solid",
                        borderColor: stateColor || "divider", bgcolor: stateBg,
                      }}
                    >
                      <Box sx={{ flex: 1, fontSize: 13.5 }}><Latex>{s.text}</Latex></Box>
                      <ToggleButtonGroup
                        size="small"
                        exclusive
                        value={mine ?? null}
                        disabled={checked}
                        onChange={(e, value) => {
                          if (value === null) return;
                          setStatementAnswers((prev) => ({ ...prev, [i]: value }));
                        }}
                      >
                        <ToggleButton value={true} sx={{ px: 1.25, py: 0.25, fontSize: 12 }}>True</ToggleButton>
                        <ToggleButton value={false} sx={{ px: 1.25, py: 0.25, fontSize: 12 }}>False</ToggleButton>
                      </ToggleButtonGroup>
                      {isRight && <Check size={15} color={theme.palette.success.main} style={{ marginLeft: 6 }} />}
                    </Box>
                  );
                })}
              </Box>
            )}

            {checked && (
              <Box sx={{ mb: 2, p: 1.5, borderRadius: 2, bgcolor: "action.hover" }}>
                <Latex as="div" style={{ fontSize: 13 }}>{question.solutionText}</Latex>
                {question.solutionImage?.url && (
                  <ZoomableImage src={question.solutionImage.url} sx={{ maxWidth: "100%", borderRadius: 1, mt: 1 }} />
                )}
                <SolutionVideo video={question.solutionVideo} questionId={question._id} />
                <AttachmentList attachments={question.solutionAttachments} sx={{ mt: 1 }} />
              </Box>
            )}

            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <IconButton size="small" disabled={index === 0} onClick={() => goTo(index - 1)}>
                <ChevronLeft size={18} />
              </IconButton>

              {!checked ? (
                <Button variant="contained" disabled={!canCheck} onClick={check}>
                  Check
                </Button>
              ) : !isLastQuestion ? (
                <Button variant="contained" onClick={() => goTo(index + 1)}>Next</Button>
              ) : (
                <Button variant="contained" onClick={handleClose}>
                  Done — {correctCount}/{answeredCount} correct
                </Button>
              )}

              <IconButton size="small" disabled={isLastQuestion} onClick={() => goTo(index + 1)}>
                <ChevronRight size={18} />
              </IconButton>
            </Box>
          </>
        )}
      </Box>
    </Dialog>
  );
}
