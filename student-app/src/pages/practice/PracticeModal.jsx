import { useEffect, useState, useRef } from "react";
import SolutionVideo from "../../components/SolutionVideo";
import {
  Dialog, Box, Typography, IconButton, Radio, Button, LinearProgress,
  Alert, CircularProgress, TextField, Paper,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useNavigate } from "react-router-dom";
import { X, Check, Dumbbell, ArrowRight, Sparkles } from "lucide-react";
import Latex from "../../components/Latex";
import LatexInserter from "../../components/LatexInserter";
import ZoomableImage from "../../components/ZoomableImage";
import AttachmentList from "../../components/AttachmentList";
import AiErrorAlert from "../../components/practice/AiErrorAlert";
import PracticeAnswerImageUploader from "../../components/practice/PracticeAnswerImageUploader";
import PassageQuestions from "../../components/practice/PassageQuestions";
import WrittenPartCheck from "../../components/practice/WrittenPartCheck";
import { withPart } from "../../utils/passagePart";
import {
  useGetPracticeQuestionsQuery, useSubmitPracticeAttemptMutation, useGradeWrittenPracticeAttemptMutation,
  useUploadPracticeAnswerImageMutation, useGetBatchQuery,
  useGetArchiveQuestionsQuery, useSubmitArchiveAttemptMutation, useGradeArchiveWrittenMutation,
  useUploadArchiveAnswerImageMutation,
} from "../../api/contentApi";
import { skillTypeLabel } from "../../constants/skillTypes";
import PhotoTranscript from "../../components/practice/PhotoTranscript";
import { answerFeedback } from "../../native/haptics";
import { useCalculator } from "../../components/calculator/useCalculator";

// Same Dialog shell as SimilarQuestionsModal (header row + progress bar +
// footer action), but the questions here are real bank questions served
// through the normal practice pipeline — a real GET, a real POST per
// answer, a real PracticeAttempt recorded — not an ephemeral AI-generated
// set. This is what the study plan's "Practice" button opens instead of
// navigating to the full practice page: same topic, narrowed (when
// possible) to the exact skill that day's note was actually about.
//
// All three question types the server can serve here — mcq, mtf, written.
// The server already enforces the written policy itself (resolveTypes in
// practiceController.js drops "written" unless the batch's aiAssist feature
// is on), so this just asks for everything and renders whatever comes
// back; no separate client-side gate needed, same as PracticeSession.jsx.
// Written questions get the exact same policy PracticeSession.jsx gives
// them: an image attachment when the batch allows it, a "Skip this
// question" escape hatch so a capped or failing AI grader is never a dead
// end, and the same capReached-aware error (AiErrorAlert) — this modal used
// to skip all three and just hand off to the full page, which meant a
// student opening a written question from their study plan had no way
// past it without leaving the modal first.
//
// `archive` switches it to the archive's endpoints, for the archive study
// plan: archive questions for the topic, attempts billed to the archive
// pool, and written answers AI-graded only when the batch has
// archiveAiAssist on — otherwise the printed solution is revealed instead,
// same as the archive session page.
// How many questions a set asks for. The student picks before it loads;
// 100 is the server's own cap, shown as "All".
const COUNT_OPTIONS = [10, 15, 25, 50, 100];
const COUNT_KEY = "examai_plan_practice_count";
const readSavedCount = () => {
  try {
    const saved = Number(localStorage.getItem(COUNT_KEY));
    return COUNT_OPTIONS.includes(saved) ? saved : 15;
  } catch {
    return 15;
  }
};

export default function PracticeModal({ open, onClose, batchId, topicId, topicTitle, skillType, autoSkill, archive = false }) {
  const theme = useTheme();
  const navigate = useNavigate();
  // Same "chapter:<id>" convention PracticeSession.jsx's own route uses —
  // the study plan hands this modal that exact composite id for a
  // chapter-pool day (see StudyPlan.jsx), since it has no separate prop for
  // "this id is a chapter, not a topic".
  const isChapterPool = topicId?.startsWith("chapter:");
  const chapterId = isChapterPool ? topicId.slice("chapter:".length) : undefined;
  const { data: batch } = useGetBatchQuery(batchId, { skip: !open });
  useCalculator(open && Boolean(batch) && batch.features?.calculator !== false);
  const imagesAllowed = Boolean(batch?.features?.writtenAnswerImages);
  // Batch practice only ever serves written questions it can grade (the
  // server drops them when aiAssist is off); the archive serves them either way.
  const writtenGradable = archive ? Boolean(batch?.features?.archiveAiAssist) : true;
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState(null);
  const [statementAnswers, setStatementAnswers] = useState([]);
  const [passageAnswers, setPassageAnswers] = useState([]);
  const [writtenAnswer, setWrittenAnswer] = useState("");
  const writtenRef = useRef(null);
  const [writtenImages, setWrittenImages] = useState([]);
  const [writtenResult, setWrittenResult] = useState(null);
  const [writtenError, setWrittenError] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [score, setScore] = useState({ correct: 0, total: 0 });
  // null until the student chooses; nothing loads before that.
  const [count, setCount] = useState(null);
  const [pendingCount, setPendingCount] = useState(readSavedCount);

  // The set size is the student's choice (the picker below). Whatever size,
  // the server serves questions not yet answered correctly first, so a
  // small set still rotates day to day.
  const practiceQuery = useGetPracticeQuestionsQuery(
    {
      batchId,
      topic: isChapterPool ? undefined : topicId,
      chapter: isChapterPool ? chapterId : undefined,
      limit: count,
      types: "mcq,mtf,written,passage",
      skillType,
      // Caller-controlled (the study plan passes this explicitly per entry
      // — see StudyPlan.jsx). Defaults to "no skill sent -> ask the backend
      // to auto-pick the weakest one" only when the caller didn't say
      // either way, so an older caller that never knew about autoSkill
      // keeps its previous behavior unchanged.
      autoSkill: autoSkill !== undefined ? autoSkill : !skillType,
    },
    { skip: archive || !open || !topicId || !count, refetchOnFocus: false, refetchOnReconnect: false }
  );
  const archiveQuery = useGetArchiveQuestionsQuery(
    {
      batchId,
      topic: isChapterPool ? undefined : topicId,
      chapter: isChapterPool ? chapterId : undefined,
      limit: count,
      types: "mcq,mtf,written,passage",
      skillType,
    },
    { skip: !archive || !open || !topicId || !count, refetchOnFocus: false, refetchOnReconnect: false }
  );
  const { data, isLoading, isFetching } = archive ? archiveQuery : practiceQuery;
  const practiceSubmit = useSubmitPracticeAttemptMutation();
  const archiveSubmit = useSubmitArchiveAttemptMutation();
  const practiceGrade = useGradeWrittenPracticeAttemptMutation();
  const archiveGrade = useGradeArchiveWrittenMutation();
  const [uploadPracticeImage] = useUploadPracticeAnswerImageMutation();
  const [uploadArchiveImage] = useUploadArchiveAnswerImageMutation();
  const [submitAttempt, submitState] = archive ? archiveSubmit : practiceSubmit;
  const [gradeWritten, gradeState] = archive ? archiveGrade : practiceGrade;
  const uploadAnswerImage = archive ? uploadArchiveImage : uploadPracticeImage;

  const questions = data?.questions || [];
  const question = questions[index];
  const finished = questions.length > 0 && index >= questions.length;
  const loading = isLoading || isFetching;
  // A written answer isn't right/wrong, it's marks out of totalMarks — same
  // 60% pass line PracticeSession.jsx uses, so "correct" means the same
  // thing here as it does on the full practice page.
  const writtenPassed = writtenResult && writtenResult.marks >= writtenResult.totalMarks * 0.6;
  const answeredFeedback = feedback || writtenResult;

  const reset = () => {
    setCount(null);
    setIndex(0);
    setSelected(null);
    setStatementAnswers([]);
    setPassageAnswers([]);
    setWrittenAnswer("");
    setWrittenImages([]);
    setWrittenResult(null);
    setWrittenError(null);
    setFeedback(null);
    setScore({ correct: 0, total: 0 });
  };

  // A fresh open (or a different topic/skill than last time — the study
  // plan's own days can each target something different) starts clean
  // rather than picking up wherever the last session left off.
  useEffect(() => {
    if (open) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, topicId, skillType]);

  const start = () => {
    try {
      localStorage.setItem(COUNT_KEY, String(pendingCount));
    } catch {
      // remembering the choice is a convenience only
    }
    setCount(pendingCount);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const answered = !question
    ? false
    : question.type === "mcq"
      ? Boolean(selected)
      : question.type === "written"
        ? writtenAnswer.trim().length > 0 || writtenImages.length > 0
        : question.type === "passage"
          ? passageAnswers.length === (question.subQuestions || []).filter((sq) => sq.type !== "written").length
          : statementAnswers.length === (question.statements?.length || 0);
  // Only written questions under it: each is checked on its own, so there's
  // nothing to "Check" for the passage as a whole.
  const writtenOnlyPassage = question?.type === "passage" && !(question.subQuestions || []).some((sq) => sq.type !== "written");

  const check = async () => {
    if (question.type === "written") {
      setWrittenError(null);
      try {
        const result = await gradeWritten({
          batchId,
          questionId: question._id,
          answerText: writtenAnswer,
          answerImages: imagesAllowed && writtenImages.length > 0 ? writtenImages : undefined,
        }).unwrap();
        // The grade also returns the printed solution (archive and batch).
        const { marks, totalMarks, feedback: aiFeedback, transcript, ...solution } = result;
        setWrittenResult({ marks, totalMarks, feedback: aiFeedback, transcript });
        setFeedback({ isCorrect: null, ...solution });
        setScore((s) => ({
          correct: s.correct + (result.marks >= result.totalMarks * 0.6 ? 1 : 0),
          total: s.total + 1,
        }));
      } catch (error) {
        setWrittenError({ message: error.data?.message || "Could not grade this right now.", capReached: error.status === 429 });
      }
      return;
    }
    try {
      const result = await submitAttempt({
        batchId,
        questionId: question._id,
        selectedOption: question.type === "mcq" ? selected : undefined,
        statementAnswers: question.type === "mtf" ? statementAnswers : undefined,
        subAnswers: question.type === "passage" ? passageAnswers : undefined,
      }).unwrap();
      setFeedback(result);
      answerFeedback(result.isCorrect);
      // An archive written reveal isn't graded (isCorrect: null) — not counted.
      if (result.isCorrect !== null) {
        setScore((s) => ({ correct: s.correct + (result.isCorrect ? 1 : 0), total: s.total + 1 }));
      }
    } catch {
      // rendered via submitState.error below
    }
  };

  // Archive only: show a written question's printed solution, ungraded.
  const revealSolution = async () => {
    try {
      setFeedback(await submitAttempt({ batchId, questionId: question._id }).unwrap());
    } catch {
      // rendered via submitState.error below
    }
  };

  const next = () => {
    setIndex((i) => i + 1);
    setSelected(null);
    setStatementAnswers([]);
    setPassageAnswers([]);
    setWrittenAnswer("");
    setWrittenImages([]);
    setWrittenResult(null);
    setWrittenError(null);
    setFeedback(null);
  };

  const setStatement = (i, value) =>
    setStatementAnswers((prev) => [...prev.filter((a) => a.index !== i), { index: i, value }]);

  const openFullPractice = () => {
    handleClose();
    navigate(archive ? `/batches/${batchId}/archive/session/${topicId}` : `/batches/${batchId}/practice/${topicId}`);
  };

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="xs">
      <Box sx={{ p: 2.5 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
          <Dumbbell size={16} color={theme.palette.ai.main} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontWeight: 500, fontSize: 15 }} noWrap>{topicTitle}</Typography>
            {count && !loading && data && (
              <Typography variant="caption" color="text.secondary">
                {data.skillTypeApplied ? `Practicing ${skillTypeLabel(data.skillType || skillType)}` : "All question types"}
              </Typography>
            )}
          </Box>
          <IconButton size="small" onClick={handleClose}><X size={18} /></IconButton>
        </Box>

        {!count ? (
          <Box sx={{ py: 2 }}>
            <Typography sx={{ fontWeight: 500, mb: 1.5 }}>How many questions?</Typography>
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mb: 1 }}>
              {COUNT_OPTIONS.map((n) => (
                <Button
                  key={n}
                  size="small"
                  variant={pendingCount === n ? "contained" : "outlined"}
                  onClick={() => setPendingCount(n)}
                  sx={{ minWidth: 56, borderRadius: 5 }}
                >
                  {n === 100 ? "All" : n}
                </Button>
              ))}
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2.5 }}>
              {pendingCount === 100 ? "Every question on this topic, up to 100." : "Fewer if the topic doesn't have that many."} Ones you haven't got right yet come first.
            </Typography>
            <Button variant="contained" fullWidth onClick={start}>Start</Button>
          </Box>
        ) : (
        <>
        {loading && (
          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, py: 5 }}>
            <CircularProgress size={28} />
            <Typography variant="body2" color="text.secondary">Finding questions…</Typography>
          </Box>
        )}

        {/* mcq/mtf submission failing is rare (no AI, no caps involved) and
            gets a plain banner same as before. Written grading failing is
            the common, expected-to-happen case (today's AI allowance,
            a capped batch) — that gets the same capReached-aware
            AiErrorAlert PracticeSession.jsx uses, rendered further down
            next to its own "Skip this question" escape hatch instead of up
            here, since it's specific to the question being answered right
            now, not a page-level banner. */}
        {submitState.error && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {submitState.error.data?.message || "Could not check that answer."}
          </Alert>
        )}

        {!loading && questions.length === 0 && (
          <Box sx={{ py: 4, textAlign: "center" }}>
            <Typography variant="body2" color="text.secondary">
              No practice questions for this topic yet.
            </Typography>
            <Button variant="outlined" size="small" sx={{ mt: 2 }} onClick={handleClose}>
              Close
            </Button>
          </Box>
        )}

        {!loading && finished && (
          <Box sx={{ py: 4, textAlign: "center" }}>
            <Typography sx={{ fontWeight: 500, mb: 2 }}>
              {score.correct} of {score.total} correct
            </Typography>
            <Box sx={{ display: "flex", gap: 1, justifyContent: "center" }}>
              <Button variant="outlined" onClick={handleClose}>Done</Button>
              <Button variant="contained" endIcon={<ArrowRight size={15} />} onClick={openFullPractice}>
                Keep going
              </Button>
            </Box>
          </Box>
        )}

        {!loading && question && !finished && (
          <>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
              <LinearProgress
                variant="determinate"
                value={(index / questions.length) * 100}
                sx={{ flex: 1, height: 3, borderRadius: 2 }}
              />
              <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                {index + 1} of {questions.length}
              </Typography>
            </Box>

            {question.questionImage?.url && (
              <ZoomableImage src={question.questionImage.url} sx={{ maxWidth: "100%", borderRadius: 1, mb: 1 }} />
            )}
            <Latex as="div" style={{ marginBottom: 14, fontSize: 15 }}>{question.question}</Latex>

            {question.type === "mcq" && (
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mb: 2 }}>
                {question.options.map((opt) => {
                  const isCorrectOpt = feedback && opt.key === feedback.correctOption;
                  const isMineWrong = feedback && !isCorrectOpt && opt.key === selected;
                  const stateColor = isCorrectOpt
                    ? theme.palette.success.main
                    : isMineWrong ? theme.palette.error.main : undefined;
                  const stateBg = isCorrectOpt
                    ? theme.palette.correctBg
                    : isMineWrong ? theme.palette.incorrectBg : "transparent";

                  return (
                    <Box
                      key={opt.key}
                      onClick={() => !feedback && setSelected(opt.key)}
                      sx={{
                        display: "flex", alignItems: opt.image?.url ? "flex-start" : "center", gap: 1,
                        borderRadius: 2, px: 1.25, py: 0.75, border: "1px solid",
                        borderColor: stateColor || "divider", bgcolor: stateBg,
                        cursor: feedback ? "default" : "pointer",
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
                      {isCorrectOpt && <Check size={16} color={theme.palette.success.main} />}
                    </Box>
                  );
                })}
              </Box>
            )}

            {question.type === "written" && writtenGradable && (
              <>
                {!writtenResult && !feedback && (
                  <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 0.5 }}>
                    <LatexInserter inputRef={writtenRef} value={writtenAnswer} onChange={setWrittenAnswer} />
                  </Box>
                )}
                <TextField
                  inputRef={writtenRef}
                  multiline
                  minRows={4}
                  fullWidth
                  disabled={Boolean(writtenResult || feedback)}
                  placeholder="Write your answer here"
                  value={writtenAnswer}
                  onChange={(e) => setWrittenAnswer(e.target.value)}
                  sx={{ mb: imagesAllowed ? 0 : 2 }}
                />
                {writtenAnswer.includes("$") && (
                  <Box
                    sx={{
                      mt: 0.75,
                      mb: imagesAllowed ? 0 : 2,
                      p: 1,
                      border: "1px dashed",
                      borderColor: "divider",
                      borderRadius: 1,
                      bgcolor: "action.hover",
                    }}
                  >
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
                      Preview
                    </Typography>
                    <Latex as="div">{writtenAnswer}</Latex>
                  </Box>
                )}
              </>
            )}
            {question.type === "written" && writtenGradable && imagesAllowed && (
              <Box sx={{ mb: 2 }}>
                <PracticeAnswerImageUploader
                  images={writtenImages}
                  onChange={setWrittenImages}
                  disabled={Boolean(writtenResult || feedback)}
                  batchId={batchId}
                  uploadAnswerImage={uploadAnswerImage}
                  question={question}
                  draftKey={`practice:${batchId}:${question._id}`}
                />
              </Box>
            )}

            {question.type === "written" && writtenError && (
              <AiErrorAlert error={writtenError} batchId={batchId} navigate={navigate} sx={{ mb: 2 }} />
            )}

            {question.type === "written" && writtenResult && (
              <Box
                sx={{
                  mb: 2, p: 1.5, borderRadius: 2,
                  bgcolor: writtenPassed ? theme.palette.correctBg : theme.palette.incorrectBg,
                }}
              >
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
                  <Sparkles size={14} color={theme.palette.ai.main} />
                  <Typography sx={{ fontWeight: 500, fontSize: 13 }}>
                    {writtenResult.marks}/{writtenResult.totalMarks} marks
                  </Typography>
                </Box>
                <Latex as="div" style={{ fontSize: 13 }}>{writtenResult.feedback}</Latex>
          <PhotoTranscript text={writtenResult.transcript} />
              </Box>
            )}

            {question.type === "mtf" && (
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mb: 2 }}>
                {question.statements.map((st, i) => {
                  const mine = statementAnswers.find((a) => a.index === i)?.value;
                  const correctValue = feedback?.statements?.[i]?.isTrue;
                  const isRight = feedback && correctValue === mine;

                  return (
                    <Box
                      key={i}
                      sx={{
                        display: "flex", alignItems: "center", gap: 1,
                        borderRadius: 2, px: 1.25, py: 0.75, border: "1px solid",
                        borderColor: feedback ? (isRight ? theme.palette.success.main : theme.palette.error.main) : "divider",
                        bgcolor: feedback ? (isRight ? theme.palette.correctBg : theme.palette.incorrectBg) : "transparent",
                      }}
                    >
                      <Box sx={{ flex: 1, fontSize: 14 }}><Latex>{st.text}</Latex></Box>
                      <Button
                        size="small"
                        variant={mine === true ? "contained" : "outlined"}
                        disabled={Boolean(feedback)}
                        onClick={() => setStatement(i, true)}
                        sx={{ minWidth: 40, px: 1 }}
                      >
                        T
                      </Button>
                      <Button
                        size="small"
                        variant={mine === false ? "contained" : "outlined"}
                        disabled={Boolean(feedback)}
                        onClick={() => setStatement(i, false)}
                        sx={{ minWidth: 40, px: 1 }}
                      >
                        F
                      </Button>
                    </Box>
                  );
                })}
              </Box>
            )}

            {question.type === "passage" && (
              <Box sx={{ mb: 2 }}>
                <PassageQuestions
                  subQuestions={question.subQuestions}
                  answers={passageAnswers}
                  onChange={setPassageAnswers}
                  feedback={feedback}
                  renderWritten={writtenGradable ? (si) => (
                    <WrittenPartCheck
                      key={`${question._id}:${si}`}
                      grade={async (body) => gradeWritten({ batchId, questionId: question._id, subIndex: si, ...body }).unwrap()}
                      batchId={batchId}
                      navigate={navigate}
                      renderImages={imagesAllowed ? (images, setImages, disabled) => (
                        <PracticeAnswerImageUploader images={images} onChange={setImages} disabled={disabled} batchId={batchId}
                          uploadAnswerImage={uploadAnswerImage} question={withPart(question, si)} draftKey={`practice:${batchId}:${question._id}:${si}`} />
                      ) : undefined}
                    />
                  ) : undefined}
                />
              </Box>
            )}
            {question.type === "passage" && writtenError && (
              <AiErrorAlert error={writtenError} batchId={batchId} navigate={navigate} sx={{ mb: 2 }} />
            )}

            {feedback && (
              <Box
                sx={{
                  mb: 2, p: 1.5, borderRadius: 2,
                  bgcolor: feedback.isCorrect === null ? "action.hover" : feedback.isCorrect ? theme.palette.correctBg : theme.palette.incorrectBg,
                }}
              >
                <Typography sx={{ fontWeight: 500, fontSize: 13, mb: feedback.solutionText ? 0.5 : 0 }}>
                  {feedback.isCorrect === null ? "Solution" : feedback.isCorrect ? "Correct" : "Not quite"}
                </Typography>
                {feedback.solutionText && <Latex as="div" style={{ fontSize: 13 }}>{feedback.solutionText}</Latex>}
                {feedback.solutionImage?.url && (
                  <ZoomableImage src={feedback.solutionImage.url} sx={{ maxWidth: "100%", borderRadius: 1, mt: 1 }} />
                )}
                <SolutionVideo video={feedback.solutionVideo} questionId={question?._id} />
                <AttachmentList attachments={feedback.solutionAttachments} sx={{ mt: 1 }} />
              </Box>
            )}

            {question.type === "written" ? (
              writtenResult || feedback ? (
                <Button variant="contained" fullWidth onClick={next}>
                  {index < questions.length - 1 ? "Next" : "Finish"}
                </Button>
              ) : (
                <>
                  {writtenGradable && (
                    <Button
                      variant="contained"
                      fullWidth
                      startIcon={<Sparkles size={16} />}
                      disabled={!answered || gradeState.isLoading}
                      onClick={check}
                    >
                      {gradeState.isLoading ? "Grading…" : "Check with AI"}
                    </Button>
                  )}
                  {archive && (
                    <Button
                      variant={writtenGradable ? "text" : "contained"}
                      fullWidth
                      disabled={gradeState.isLoading || submitState.isLoading}
                      onClick={revealSolution}
                      sx={writtenGradable ? { mt: 1, color: "text.secondary" } : undefined}
                    >
                      {writtenGradable ? "Just show the solution" : "Show solution"}
                    </Button>
                  )}
                  {/* Same escape hatch as PracticeSession.jsx: AI being off,
                      capped for today, or just a provider hiccup used to
                      leave a written question with no way past it in this
                      modal at all. Skipping never scores the question —
                      it's simply left out of the percentage, same as any
                      other ungradable answer. */}
                  <Button variant="text" fullWidth onClick={next} sx={{ mt: 1, color: "text.secondary" }}>
                    Skip this question
                  </Button>
                </>
              )
            ) : (
              <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1 }}>
                {!answeredFeedback && !writtenOnlyPassage ? (
                  <>
                    {/* A passage can be skipped, same as a written question. */}
                    {question.type === "passage" && (
                      <Button variant="text" disabled={submitState.isLoading} onClick={next} sx={{ color: "text.secondary" }}>
                        Skip this question
                      </Button>
                    )}
                    <Button
                      variant="contained"
                      disabled={!answered || submitState.isLoading}
                      onClick={check}
                    >
                      {submitState.isLoading ? <CircularProgress size={16} /> : "Check"}
                    </Button>
                  </>
                ) : (
                  <Button variant="contained" onClick={next}>
                    {index < questions.length - 1 ? "Next" : "Finish"}
                  </Button>
                )}
              </Box>
            )}
          </>
        )}
        </>
        )}
      </Box>
    </Dialog>
  );
}
