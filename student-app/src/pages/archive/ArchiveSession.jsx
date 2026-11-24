import { useRef, useState, useEffect } from "react";
import SolutionVideo from "../../components/SolutionVideo";
import { Box, Typography, Paper, Button, IconButton, LinearProgress, Skeleton, CircularProgress, RadioGroup, Radio, FormControlLabel, Divider, TextField } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Check, X, Sparkles, Layers, CircleCheck, BookOpen, Star } from "lucide-react";
import {
  useGetArchiveQuestionsQuery, useGetArchiveFavoriteQuestionsQuery, useGetArchivePersonalizedQuestionsQuery,
  useGetArchivePredictedSetQuestionsQuery, useGetBatchQuery,
  useSubmitArchiveAttemptMutation,
  useExplainArchiveAttemptMutation, useGetArchiveHintMutation, useGetArchiveSimilarQuestionsMutation,
  useGradeArchiveWrittenMutation, useUploadArchiveAnswerImageMutation,
  useGetArchiveFavoriteIdsQuery, useToggleArchiveFavoriteMutation,
} from "../../api/contentApi";
import EmptyState from "../../components/EmptyState";
import { PracticeScoreTitle, PracticeScoreBar } from "../../components/PracticeScore";
import AiUsageMeter from "../../components/AiUsageMeter";
import McqOptions from "../../components/practice/McqOptions";
import { animate, revealDown, slideInRight } from "../../motion";
import MtfStatements from "../../components/practice/MtfStatements";
import AiErrorAlert from "../../components/practice/AiErrorAlert";
import HintPanel from "../../components/practice/HintPanel";
import PassageQuestions from "../../components/practice/PassageQuestions";
import WrittenPartCheck from "../../components/practice/WrittenPartCheck";
import usePassageHints from "../../components/practice/usePassageHints";
import PracticeAnswerImageUploader from "../../components/practice/PracticeAnswerImageUploader";
import LatexInserter from "../../components/LatexInserter";
import Latex from "../../components/Latex";
import ZoomableImage from "../../components/ZoomableImage";
import AttachmentList from "../../components/AttachmentList";
import SimilarQuestionsModal from "../practice/SimilarQuestionsModal";
import PhotoTranscript from "../../components/practice/PhotoTranscript";
import { useCalculator } from "../../components/calculator/useCalculator";
import goBack from "../../utils/goBack";
import { withPart } from "../../utils/passagePart";

// The archive's own version of PracticeSession.jsx — same one-question,
// immediate-feedback loop, with no "Ask a doubt" action at all. Written
// questions are AI-graded like batch practice when the batch has
// archiveAiAssist on (with photos when writtenAnswerImages is on); either
// way the printed solution can still just be revealed. AiUsageMeter is here too, in its `archive` mode —
// explain/similar calls from this page are billed against the archive's
// own shared batch: null pool (see archiveController.js), not this door's
// own batch, so the plain (non-archive) meter used elsewhere would show the
// wrong number entirely, not just an inconvenient one.
// A graded written answer has no verdict of its own here, so its card is
// only worth showing when there is a solution to put in it.
const hasSolution = (f) =>
  Boolean(f.solutionText?.trim() || f.solutionImage?.url || f.solutionVideo?.url || f.solutionAttachments?.length);

export default function ArchiveSession() {
  const { batchId, topicOrChapter } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedCount = Math.min(Math.max(Number(searchParams.get("count")) || 10, 1), 100);
  const requestedTypes = searchParams.get("types") || undefined;
  const authority = searchParams.get("authority") || undefined;
  const year = searchParams.get("year") || undefined;
  const theme = useTheme();

  // "personalized" and "favorites" are reserved values in this route slot,
  // not real topic/chapter ids — same convention PracticeSession.jsx uses.
  const isPersonalized = topicOrChapter === "personalized";
  const isFavorites = topicOrChapter === "favorites";
  // "predicted:<id>" — a predicted paper an admin shared as a practice set.
  const isPredicted = Boolean(topicOrChapter?.startsWith("predicted:"));
  const predictedSetId = isPredicted ? topicOrChapter.slice("predicted:".length) : undefined;
  const isChapterPool = !isPersonalized && !isFavorites && !isPredicted && topicOrChapter?.startsWith("chapter:");
  const chapterId = isChapterPool ? topicOrChapter.slice("chapter:".length) : undefined;
  // A personalized or favorites session is reached from the hub/browse
  // page's own banner or tile directly — back goes to browse either way.
  // Only favorites is reached from the hub itself.
  const backTo = isFavorites || isPredicted ? `/batches/${batchId}/archive` : `/batches/${batchId}/archive/browse`;

  const topicQuery = useGetArchiveQuestionsQuery(
    {
      batchId,
      topic: isChapterPool ? undefined : topicOrChapter,
      chapter: isChapterPool ? chapterId : undefined,
      authority,
      year,
      limit: requestedCount,
      types: requestedTypes,
    },
    { skip: isPersonalized || isFavorites || isPredicted, refetchOnFocus: false, refetchOnReconnect: false }
  );
  const personalizedQuery = useGetArchivePersonalizedQuestionsQuery(
    { batchId, limit: requestedCount, types: requestedTypes },
    { skip: !isPersonalized, refetchOnFocus: false, refetchOnReconnect: false }
  );
  const favoritesQuery = useGetArchiveFavoriteQuestionsQuery(
    { batchId, limit: requestedCount },
    { skip: !isFavorites, refetchOnFocus: false, refetchOnReconnect: false }
  );
  const predictedQuery = useGetArchivePredictedSetQuestionsQuery(
    { batchId, setId: predictedSetId },
    { skip: !isPredicted, refetchOnFocus: false, refetchOnReconnect: false }
  );
  const { data, isLoading, refetch } = isPersonalized
    ? personalizedQuery
    : isFavorites
    ? favoritesQuery
    : isPredicted
    ? predictedQuery
    : topicQuery;

  const [submitAttempt, { isLoading: checking }] = useSubmitArchiveAttemptMutation();
  const [explainAttempt, { isLoading: explaining }] = useExplainArchiveAttemptMutation();
  const [getSimilar, { isLoading: loadingSimilar }] = useGetArchiveSimilarQuestionsMutation();
  const [requestHint, { isLoading: loadingHint }] = useGetArchiveHintMutation();
  // Explain / similar / hints are all behind the batch's archiveAiAssist
  // switch server-side (archiveRoutes.js) — hidden here when it's off
  // rather than shown and then refused.
  const { data: batch } = useGetBatchQuery(batchId);
  useCalculator(Boolean(batch) && batch.features?.calculator !== false);
  const aiOn = Boolean(batch?.features?.archiveAiAssist);
  const imagesAllowed = Boolean(batch?.features?.writtenAnswerImages);
  const [gradeWritten, { isLoading: gradingWritten }] = useGradeArchiveWrittenMutation();
  const [uploadAnswerImage] = useUploadArchiveAnswerImageMutation();
  const { data: favoriteData } = useGetArchiveFavoriteIdsQuery(batchId);
  const [toggleFavorite] = useToggleArchiveFavoriteMutation();
  const favoriteIds = new Set(favoriteData?.ids || []);

  const [index, setIndex] = useState(0);
  // Each question (and the end screen) starts at the top of the page.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [index]);
  const [selectedOption, setSelectedOption] = useState(null);
  const [statementAnswers, setStatementAnswers] = useState([]);
  const [passageAnswers, setPassageAnswers] = useState([]);
  const [feedback, setFeedback] = useState(null);
  const [explanation, setExplanation] = useState(null);
  const [explainError, setExplainError] = useState(null);
  const [score, setScore] = useState({ correct: 0, total: 0 });
  const [attempted, setAttempted] = useState(0);
  const [similarOpen, setSimilarOpen] = useState(false);
  const [similarQuestions, setSimilarQuestions] = useState(null);
  const [similarError, setSimilarError] = useState(null);
  const [hints, setHints] = useState([]);
  const [hintError, setHintError] = useState(null);
  const passageHints = usePassageHints();
  const [writtenAnswer, setWrittenAnswer] = useState("");
  const writtenRef = useRef(null);
  const [writtenImages, setWrittenImages] = useState([]);
  const [writtenResult, setWrittenResult] = useState(null);
  const [writtenError, setWrittenError] = useState(null);
  const [checkError, setCheckError] = useState(null);

  if (isLoading) return <Box sx={{ p: 3 }}><Skeleton variant="rounded" height={200} /></Box>;

  const questions = data?.questions || [];
  const question = questions[index];

  if (!question) {
    // Past the last question of a non-empty set is finished, even when
    // every question was skipped.
    const finished = questions.length > 0;
    return (
      <EmptyState
        icon={finished ? CircleCheck : BookOpen}
        tone={finished ? "idle" : "blocked"}
        title={finished ? (score.total > 0 ? <PracticeScoreTitle correct={score.correct} total={score.total} /> : "Set complete") : "No questions here"}
        description={finished ? (score.total > 0 ? <><PracticeScoreBar correct={score.correct} total={score.total} />Set complete.</> : attempted > 0 ? "You've been through all of them." : "You skipped every question in this set, so nothing was scored.") : data?.message || "Nothing has been added here yet. Try another topic."}
        action={
          finished
            ? {
                label: "Practice again",
                onClick: () => {
                  setIndex(0);
                  setSelectedOption(null);
                  setStatementAnswers([]);
                  setPassageAnswers([]);
                  setFeedback(null);
                  setExplanation(null);
                  setExplainError(null);
                  setHints([]);
                  setHintError(null);
                  passageHints.reset();
                  setWrittenAnswer("");
                  setWrittenImages([]);
                  setWrittenResult(null);
                  setWrittenError(null);
                  setScore({ correct: 0, total: 0 });
                  setAttempted(0);
                  refetch();
                },
              }
            : undefined
        }
        secondaryAction={{ label: "Choose another topic", onClick: () => navigate(backTo) }}
      />
    );
  }

  const reset = () => {
    setCheckError(null);
    setSelectedOption(null);
    setStatementAnswers([]);
    setPassageAnswers([]);
    setFeedback(null);
    setExplanation(null);
    setExplainError(null);
    setSimilarQuestions(null);
    setSimilarError(null);
    setHints([]);
    setHintError(null);
    passageHints.reset();
    setWrittenAnswer("");
    setWrittenImages([]);
    setWrittenResult(null);
    setWrittenError(null);
  };

  const getHint = async () => {
    setHintError(null);
    try {
      const result = await requestHint({
        batchId,
        questionId: question._id,
        level: hints.length + 1,
        previousHints: hints,
      }).unwrap();
      setHints((h) => [...h, result.hint]);
    } catch (error) {
      setHintError({ message: error.data?.message || "Could not get a hint right now.", capReached: error.status === 429 });
    }
  };

  const check = async () => {
    setCheckError(null);
    let result;
    try {
      result = await submitAttempt({
        batchId,
        questionId: question._id,
        selectedOption: question.type === "mcq" ? selectedOption : undefined,
        statementAnswers: question.type === "mtf" ? statementAnswers : undefined,
        subAnswers: question.type === "passage" ? passageAnswers : undefined,
      }).unwrap();
    } catch (error) {
      setCheckError(error?.data?.message || "Could not check your answer. Check your connection and try again.");
      return;
    }

    setFeedback(result);
    setAttempted((a) => a + 1);
    // Written reveals aren't graded (isCorrect: null) — don't count them
    // toward the "X of Y correct" summary at all.
    if (result.isCorrect !== null) {
      setScore((s) => ({ correct: s.correct + (result.isCorrect ? 1 : 0), total: s.total + 1 }));
    }
  };

  // AI grading for a written answer. The response carries the printed
  // solution too, shown in the same panel "Show solution" uses.
  const checkWritten = async () => {
    setWrittenError(null);
    try {
      const result = await gradeWritten({
        batchId,
        questionId: question._id,
        answerText: writtenAnswer,
        answerImages: imagesAllowed && writtenImages.length > 0 ? writtenImages : undefined,
      }).unwrap();
      const { marks, totalMarks, feedback: aiFeedback, transcript, ...solution } = result;
      setWrittenResult({ marks, totalMarks, feedback: aiFeedback, transcript });
      setFeedback({ isCorrect: null, ...solution });
      setAttempted((a) => a + 1);
      setScore((s) => ({ correct: s.correct + (marks >= totalMarks * 0.6 ? 1 : 0), total: s.total + 1 }));
    } catch (error) {
      setWrittenError({ message: error.data?.message || "Could not grade this right now.", capReached: error.status === 429 });
    }
  };

  const explain = async () => {
    setExplainError(null);
    try {
      const result = await explainAttempt({
        batchId,
        questionId: question._id,
        selectedOption: question.type === "mcq" ? selectedOption : undefined,
        statementAnswers: question.type === "mtf" ? statementAnswers : undefined,
      }).unwrap();
      setExplanation(result.explanation);
    } catch (error) {
      setExplainError({ message: error.data?.message || "Could not get an explanation right now.", capReached: error.status === 429 });
    }
  };

  const openSimilar = async () => {
    setSimilarOpen(true);
    setSimilarError(null);
    setSimilarQuestions(null);
    try {
      const result = await getSimilar({ batchId, questionId: question._id }).unwrap();
      setSimilarQuestions(result.questions);
    } catch (error) {
      setSimilarError({ message: error.data?.message || "Could not build similar questions right now.", capReached: error.status === 429 });
    }
  };

  const next = () => {
    reset();
    setIndex((i) => i + 1);
  };

  const answered = question.type === "mcq"
    ? selectedOption !== null
    : question.type === "mtf"
    ? statementAnswers.length === (question.statements?.length || 0)
    : question.type === "passage"
    ? passageAnswers.length === (question.subQuestions || []).filter((sq) => sq.type !== "written").length
    // written: "Show solution" needs nothing first; "Check with AI" has its own check.
    : true;

  // Only written questions under it: each is checked on its own, so the
  // page just moves on.
  const writtenOnlyPassage = question.type === "passage" && !(question.subQuestions || []).some((sq) => sq.type !== "written");

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 600, mx: "auto" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
        <IconButton size="small" onClick={() => goBack(navigate, backTo)}><ArrowLeft size={18} /></IconButton>
        <Typography variant="caption" color="text.secondary">Question {index + 1} of {questions.length}</Typography>
      </Box>
      <LinearProgress variant="determinate" value={(index / questions.length) * 100} sx={{ mb: 3, height: 4, borderRadius: 2 }} />
      {aiOn && <AiUsageMeter batchId={batchId} archive compact />}

      <Paper key={index} variant="outlined" sx={{ p: 3, borderRadius: 3, mb: 2, ...(index > 0 ? animate(slideInRight, 320, "cubic-bezier(.2,.7,.3,1)") : {}) }}>
        <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1, mb: question.questionImage?.url ? 1 : 0 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {question.questionImage?.url && (
              <ZoomableImage src={question.questionImage.url} sx={{ maxWidth: "100%", borderRadius: 1, mb: 1 }} />
            )}
            <Latex as="div">{question.question}</Latex>
          </Box>
          <IconButton
            size="small"
            onClick={() => toggleFavorite({ batchId, questionId: question._id })}
            sx={{ mt: -0.5, mr: -0.5, flexShrink: 0 }}
            aria-label={favoriteIds.has(question._id) ? "Remove from favorites" : "Add to favorites"}
          >
            <Star
              size={19}
              color={favoriteIds.has(question._id) ? theme.palette.warning.main : theme.palette.text.secondary}
              fill={favoriteIds.has(question._id) ? theme.palette.warning.main : "none"}
            />
          </IconButton>
        </Box>

        {question.type === "mcq" && (
          <McqOptions options={question.options} selectedOption={selectedOption} feedback={feedback} onSelect={setSelectedOption} animate />
        )}

        {question.type === "mtf" && (
          <MtfStatements statements={question.statements} statementAnswers={statementAnswers} feedback={feedback} onChange={setStatementAnswers} />
        )}

        {question.type === "written" && !aiOn && !feedback && (
          <Typography variant="caption" color="text.secondary">
            Work it out, then reveal the printed solution below.
          </Typography>
        )}

        {/* Same answer box as batch practice, when AI grading is on. */}
        {question.type === "written" && aiOn && (
          <>
            {!feedback && (
              <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 0.5 }}>
                <LatexInserter inputRef={writtenRef} value={writtenAnswer} onChange={setWrittenAnswer} />
              </Box>
            )}
            <TextField
              inputRef={writtenRef}
              multiline
              minRows={4}
              fullWidth
              disabled={Boolean(feedback)}
              placeholder="Write your answer here"
              value={writtenAnswer}
              onChange={(e) => setWrittenAnswer(e.target.value)}
            />
            {writtenAnswer.includes("$") && (
              <Box sx={{ mt: 0.75, p: 1, border: "1px dashed", borderColor: "divider", borderRadius: 1, bgcolor: "action.hover" }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
                  Preview
                </Typography>
                <Latex as="div">{writtenAnswer}</Latex>
              </Box>
            )}
            {imagesAllowed && (
              <PracticeAnswerImageUploader
                images={writtenImages}
                onChange={setWrittenImages}
                disabled={Boolean(feedback)}
                batchId={batchId}
                uploadAnswerImage={uploadAnswerImage}
                question={question}
                draftKey={`archive:${batchId}:${question._id}`}
              />
            )}
          </>
        )}

        {/* A passage gets hints per sub-question, not one for the whole text. */}
        {question.type === "passage" && (
          <PassageQuestions
            subQuestions={question.subQuestions}
            answers={passageAnswers}
            onChange={setPassageAnswers}
            renderWritten={(si) => (
              <WrittenPartCheck
                key={`${question._id}:${si}`}
                grade={async (body) => gradeWritten({ batchId, questionId: question._id, subIndex: si, ...body }).unwrap()}
                batchId={batchId}
                navigate={navigate}
                renderImages={imagesAllowed ? (images, setImages, disabled) => (
                  <PracticeAnswerImageUploader images={images} onChange={setImages} disabled={disabled} batchId={batchId}
                    uploadAnswerImage={uploadAnswerImage} question={withPart(question, si)} draftKey={`archive:${batchId}:${question._id}:${si}`} />
                ) : undefined}
              />
            )}
            feedback={feedback}
            renderSubExtra={aiOn ? (si) => (
              <HintPanel
                hints={passageHints.bySub[si]?.hints || []}
                loading={passageHints.loadingFor === si}
                error={passageHints.bySub[si]?.error}
                onRequestHint={() => passageHints.ask(si, async (level, previousHints) =>
                  (await requestHint({ batchId, questionId: question._id, subIndex: si, level, previousHints }).unwrap()).hint
                )}
                canRequest={!feedback}
                disabled={passageHints.loadingFor !== null}
                batchId={batchId}
                navigate={navigate}
              />
            ) : undefined}
          />
        )}
      </Paper>

      {question.type === "written" && writtenResult && (
        <Paper
          variant="outlined"
          sx={{
            p: 2.5, borderRadius: 3, mb: 2,
            borderColor: writtenResult.marks >= writtenResult.totalMarks * 0.6 ? "success.main" : "error.main",
            bgcolor: writtenResult.marks >= writtenResult.totalMarks * 0.6 ? theme.palette.correctBg : theme.palette.incorrectBg,
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
            <Sparkles size={16} color={theme.palette.ai.main} />
            <Typography sx={{ fontWeight: 500 }}>{writtenResult.marks}/{writtenResult.totalMarks} marks</Typography>
          </Box>
          <Latex as="div" style={{ fontSize: 13.5 }}>{writtenResult.feedback}</Latex>
          <PhotoTranscript text={writtenResult.transcript} />
        </Paper>
      )}
      {checkError && (
        <AiErrorAlert error={{ message: checkError }} batchId={batchId} navigate={navigate} sx={{ mb: 2 }} />
      )}
      {(question.type === "written" || question.type === "passage") && writtenError && (
        <AiErrorAlert error={writtenError} batchId={batchId} navigate={navigate} sx={{ mb: 2 }} />
      )}

      {feedback && (feedback.isCorrect !== null || hasSolution(feedback)) && (
        <Paper
          variant="outlined"
          sx={{
            ...animate(revealDown, 420, "cubic-bezier(.2,.7,.3,1)", "250ms both"),
            p: 2.5, borderRadius: 3, mb: 2,
            borderColor: feedback.isCorrect === null ? "divider" : feedback.isCorrect ? "success.main" : "error.main",
            bgcolor: feedback.isCorrect === null ? "background.paper" : feedback.isCorrect ? theme.palette.correctBg : theme.palette.incorrectBg,
          }}
        >
          {feedback.isCorrect !== null && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: feedback.solutionText ? 1 : 0 }}>
              {feedback.isCorrect ? <Check size={18} color={theme.palette.success.main} /> : <X size={18} color={theme.palette.error.main} />}
              <Typography sx={{ fontWeight: 500 }}>
                {feedback.correctCount !== undefined
                  ? `${feedback.correctCount} of ${feedback.totalCount} correct`
                  : feedback.isCorrect ? "Correct" : "Not quite"}
              </Typography>
            </Box>
          )}
          {feedback.solutionText && <Latex as="div" style={{ fontSize: 13.5 }}>{feedback.solutionText}</Latex>}
          {feedback.solutionImage?.url && (
            <ZoomableImage src={feedback.solutionImage.url} sx={{ maxWidth: "100%", borderRadius: 1, mt: 1 }} />
          )}
          <SolutionVideo video={feedback.solutionVideo} questionId={question?._id} />
          <AttachmentList attachments={feedback.solutionAttachments} sx={{ mt: 1 }} />

          {aiOn && !feedback.isCorrect && (
            <Box sx={{ mt: 1.5 }}>
              <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                {aiOn && batch?.aiExplanations && question.type !== "written" && question.type !== "passage" && !explanation && !explaining && (
                  <ActionChip icon={Sparkles} label="Explain why" onClick={explain} />
                )}
                {aiOn && feedback.similar !== false && <ActionChip icon={Layers} label="Practice 5 similar" onClick={openSimilar} />}
              </Box>
              {explaining && (
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, color: "text.secondary", mt: 1 }}>
                  <CircularProgress size={14} />
                  <Typography variant="caption">Thinking it through…</Typography>
                </Box>
              )}
              {explainError && question.type !== "written" && question.type !== "passage" && <AiErrorAlert error={explainError} batchId={batchId} navigate={navigate} sx={{ mt: 1 }} />}
              {explanation && (
                <Box sx={{ mt: 1, p: 1.5, borderRadius: 2, bgcolor: "ai.bg" }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 0.5 }}>
                    <Sparkles size={13} color={theme.palette.ai.main} />
                    <Typography variant="caption" sx={{ color: "ai.main", fontWeight: 500 }}>AI explanation</Typography>
                  </Box>
                  <Latex as="div" style={{ fontSize: 13.5 }}>{explanation}</Latex>
                </Box>
              )}
            </Box>
          )}
        </Paper>
      )}

      {aiOn && question.type !== "passage" && (
        <HintPanel
          hints={hints}
          loading={loadingHint}
          error={hintError}
          onRequestHint={getHint}
          canRequest={!feedback}
          batchId={batchId}
          navigate={navigate}
          sx={{ mb: 2 }}
        />
      )}

      {feedback || writtenOnlyPassage ? (
        <Button variant="contained" fullWidth onClick={next}>
          {index === questions.length - 1 ? "Finish" : "Next question"}
        </Button>
      ) : question.type === "written" && aiOn ? (
        <>
          <Button
            variant="contained"
            fullWidth
            startIcon={<Sparkles size={16} />}
            disabled={(!writtenAnswer.trim() && writtenImages.length === 0) || gradingWritten || checking}
            onClick={checkWritten}
          >
            {gradingWritten ? "Grading…" : "Check with AI"}
          </Button>
          {/* Never a dead end when grading is capped or fails — the printed
              solution is still one tap away, ungraded like before. */}
          <Button variant="text" fullWidth disabled={gradingWritten || checking} onClick={check} sx={{ mt: 1, color: "text.secondary" }}>
            {checking ? "Checking" : "Just show the solution"}
          </Button>
        </>
      ) : (
        <>
          <Button variant="contained" fullWidth disabled={!answered || checking} onClick={check}>
            {checking ? "Checking" : question.type === "written" ? "Show solution" : "Check answer"}
          </Button>
          {/* A passage can be left unanswered, same as a written question:
              nothing is scored, it's left out of the percentage. */}
          {question.type === "passage" && (
            <Button variant="text" fullWidth disabled={checking} onClick={next} sx={{ mt: 1, color: "text.secondary" }}>
              Skip this question
            </Button>
          )}
        </>
      )}

      <SimilarQuestionsModal open={similarOpen} onClose={() => setSimilarOpen(false)} loading={loadingSimilar} error={similarError} questions={similarQuestions} batchId={batchId} />
    </Box>
  );
}

function ActionChip({ icon: Icon, label, onClick }) {
  return (
    <Button
      size="small"
      variant="outlined"
      startIcon={<Icon size={14} />}
      onClick={onClick}
      sx={{
        borderRadius: 5, textTransform: "none", fontSize: 12.5,
        py: 0.4, px: 1.4, lineHeight: 1.3,
        borderColor: "ai.main", color: "ai.main",
        "&:hover": { borderColor: "ai.main", bgcolor: "ai.bg" },
      }}
    >
      {label}
    </Button>
  );
}
