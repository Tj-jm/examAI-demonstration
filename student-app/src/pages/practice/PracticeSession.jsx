import { useState, useRef, useEffect } from "react";
import SolutionVideo from "../../components/SolutionVideo";
import {
  Box, Typography, Paper, Button,
  IconButton, LinearProgress, Skeleton, CircularProgress, TextField,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Check, X, Sparkles, Layers, Star, CircleCheck, BookOpen } from "lucide-react";
import {
  useGetPracticeQuestionsQuery, useGetPersonalizedQuestionsQuery, useSubmitPracticeAttemptMutation,
  useExplainPracticeAttemptMutation, useGradeWrittenPracticeAttemptMutation, useGetSimilarQuestionsMutation, useGetPracticeHintMutation,
  useGetFavoriteIdsQuery, useGetFavoriteQuestionsQuery, useToggleFavoriteMutation,
  useUploadPracticeAnswerImageMutation, useGetBatchQuery,
} from "../../api/contentApi";
import EmptyState from "../../components/EmptyState";
import { PracticeScoreTitle, PracticeScoreBar } from "../../components/PracticeScore";
import AiUsageMeter from "../../components/AiUsageMeter";
import McqOptions from "../../components/practice/McqOptions";
import { animate, revealDown, slideInRight } from "../../motion";
import MtfStatements from "../../components/practice/MtfStatements";
import AiErrorAlert from "../../components/practice/AiErrorAlert";
import PracticeAnswerImageUploader from "../../components/practice/PracticeAnswerImageUploader";
import Latex from "../../components/Latex";
import LatexInserter from "../../components/LatexInserter";
import ZoomableImage from "../../components/ZoomableImage";
import AttachmentList from "../../components/AttachmentList";
import SimilarQuestionsModal from "./SimilarQuestionsModal";
import HintPanel from "../../components/practice/HintPanel";
import SolutionQna, { NumberedSolution } from "../../components/practice/SolutionQna";
import PassageQuestions from "../../components/practice/PassageQuestions";
import WrittenPartCheck from "../../components/practice/WrittenPartCheck";
import usePassageHints from "../../components/practice/usePassageHints";
import PhotoTranscript from "../../components/practice/PhotoTranscript";
import { skillTypeLabel } from "../../constants/skillTypes";
import { answerFeedback } from "../../native/haptics";
import { useCalculator } from "../../components/calculator/useCalculator";
import goBack from "../../utils/goBack";
import { withPart } from "../../utils/passagePart";

// One question, an answer, immediate truth — the opposite shape from an
// exam on purpose. The feedback state below is the whole point of this
// screen, so it reads directly from the theme's own correct/incorrect
// tokens (theme.palette.correctBg etc, set in buildTheme.js) rather than
// MUI's auto-generated success.light/error.light shades, which don't match
// the rest of the app and go muddy in dark mode. It also avoids MUI's
// built-in disabled dimming on the radio row once an answer is checked —
// that greys out the very colours meant to be the point.
// A graded written answer has no verdict of its own here, so its card is
// only worth showing when there is a solution to put in it.
const hasSolution = (f) =>
  Boolean(f.solutionText?.trim() || f.solutionImage?.url || f.solutionVideo?.url || f.solutionAttachments?.length);

export default function PracticeSession() {
  const { batchId, topicId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedCount = Math.min(Math.max(Number(searchParams.get("count")) || 10, 1), 100);
  const requestedTypes = searchParams.get("types") || undefined;
  const requestedSkill = searchParams.get("skill") || undefined;
  const theme = useTheme();

  // "personalized" and "favorites" are reserved values in this route slot,
  // not real topic ids — all three hooks are called unconditionally (Rules
  // of Hooks) and two are always skipped, rather than branching which hook
  // gets called. A "chapter:<id>" value is PracticeTopics.jsx's chapter-pool
  // tile — same route slot, told apart from a plain topic id by the prefix.
  const isPersonalized = topicId === "personalized";
  const isFavorites = topicId === "favorites";
  const isChapterPool = topicId?.startsWith("chapter:");
  const chapterId = isChapterPool ? topicId.slice("chapter:".length) : undefined;
  // refetchOnFocus/refetchOnReconnect belong here, at the hook call site —
  // not on the endpoint definition in contentApi.js, which was where an
  // earlier attempt at this fix mistakenly put them and had no effect at
  // all. Confirmed against RTK Query's own hook source, not assumed this
  // time. Without this, the global refetchOnFocus:true (set once for the
  // whole app in apiSlice.js) reshuffles this random, server-shuffled set
  // the instant the tab regains focus, while the component's own index and
  // score state stay put — landing on the same slot in the list looking at
  // a completely different question.
  const topicQuery = useGetPracticeQuestionsQuery(
    {
      batchId,
      topic: isChapterPool ? undefined : topicId,
      chapter: isChapterPool ? chapterId : undefined,
      limit: requestedCount,
      types: requestedTypes,
      skillType: requestedSkill,
    },
    { skip: isPersonalized || isFavorites, refetchOnFocus: false, refetchOnReconnect: false }
  );
  const personalizedQuery = useGetPersonalizedQuestionsQuery(
    { batchId, limit: requestedCount, types: requestedTypes },
    { skip: !isPersonalized, refetchOnFocus: false, refetchOnReconnect: false }
  );
  const favoritesQuery = useGetFavoriteQuestionsQuery(
    { batchId, limit: requestedCount },
    { skip: !isFavorites, refetchOnFocus: false, refetchOnReconnect: false }
  );
  const { data, isLoading, refetch } = isPersonalized ? personalizedQuery : isFavorites ? favoritesQuery : topicQuery;

  const { data: favoriteData } = useGetFavoriteIdsQuery(batchId);
  const [toggleFavorite] = useToggleFavoriteMutation();
  const favoriteIds = new Set(favoriteData?.ids || []);

  const [submitAttempt, { isLoading: checking }] = useSubmitPracticeAttemptMutation();
  const [explainAttempt, { isLoading: explaining }] = useExplainPracticeAttemptMutation();
  const [gradeWritten, { isLoading: gradingWritten }] = useGradeWrittenPracticeAttemptMutation();
  const [uploadAnswerImage] = useUploadPracticeAnswerImageMutation();
  const [getSimilar, { isLoading: loadingSimilar }] = useGetSimilarQuestionsMutation();
  const { data: batch } = useGetBatchQuery(batchId);
  useCalculator(Boolean(batch) && batch.features?.calculator !== false);
  const imagesAllowed = Boolean(batch?.features?.writtenAnswerImages);
  // Hints are an AI call, so they follow the batch's aiAssist switch (the
  // /practice/hint route checks the same flag).
  const hintsOn = Boolean(batch?.features?.aiAssist);
  // Questions about a solution: Settings → AI and this batch (with AI help).
  const qnaOn = Boolean(batch?.aiPracticeQna && batch?.features?.aiAssist && batch?.features?.practiceQna);
  const [requestHint, { isLoading: loadingHint }] = useGetPracticeHintMutation();

  const [index, setIndex] = useState(0);
  // Each question (and the end screen) starts at the top of the page.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [index]);
  const [selectedOption, setSelectedOption] = useState(null);
  const [statementAnswers, setStatementAnswers] = useState([]);
  const [writtenAnswer, setWrittenAnswer] = useState("");
  const writtenRef = useRef(null);
  const [writtenImages, setWrittenImages] = useState([]);
  const [writtenResult, setWrittenResult] = useState(null);
  const [writtenError, setWrittenError] = useState(null);
  const [checkError, setCheckError] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [explanation, setExplanation] = useState(null);
  const [explainError, setExplainError] = useState(null);
  const [score, setScore] = useState({ correct: 0, total: 0 });
  const [similarOpen, setSimilarOpen] = useState(false);
  const [similarQuestions, setSimilarQuestions] = useState(null);
  const [similarError, setSimilarError] = useState(null);
  const [passageAnswers, setPassageAnswers] = useState([]);
  const [hints, setHints] = useState([]);
  const [hintError, setHintError] = useState(null);
  const passageHints = usePassageHints();

  if (isLoading) return <Box sx={{ p: 3 }}><Skeleton variant="rounded" height={200} /></Box>;

  const questions = data?.questions || [];
  const question = questions[index];

  if (!question) {
    // Finishing a set and never having had one are opposite outcomes that
    // used to share a layout — the finished case now leads with the score
    // and offers another round, the empty case explains why it is empty.
    // Past the last question of a non-empty set is finished, even when
    // every question was skipped (a set of written questions with AI off).
    const finished = questions.length > 0;

    return (
      <EmptyState
        icon={finished ? CircleCheck : BookOpen}
        tone={finished ? "idle" : "blocked"}
        title={finished ? (score.total > 0 ? <PracticeScoreTitle correct={score.correct} total={score.total} /> : "Set complete") : `No ${requestedSkill ? `${skillTypeLabel(requestedSkill)} ` : ""}questions ${isChapterPool ? "in this chapter" : "on this topic"}`}
        description={
          finished
            ? score.total > 0
              ? <><PracticeScoreBar correct={score.correct} total={score.total} />Set complete. Weak topics update from this, so the next round targets what you missed.</>
              : "You skipped every question in this set, so nothing was scored."
            : data?.message || "Nothing has been added to this topic yet. Try another one from the list."
        }
        action={
          // Refetch rather than reload: the endpoint shuffles server-side,
          // so this pulls a genuinely new set. All per-question state has
          // to be cleared with it or the first question of the new set
          // opens already answered.
          finished
            ? {
                label: "Practice again",
                onClick: () => {
                  setIndex(0);
                  setSelectedOption(null);
                  setStatementAnswers([]);
                  setPassageAnswers([]);
                  setHints([]);
                  setHintError(null);
                  passageHints.reset();
                  setWrittenAnswer("");
                  setWrittenImages([]);
                  setWrittenResult(null);
                  setWrittenError(null);
                  setFeedback(null);
                  setExplanation(null);
                  setExplainError(null);
                  setScore({ correct: 0, total: 0 });
                  refetch();
                },
              }
            : undefined
        }
        secondaryAction={{ label: "Choose another topic", onClick: () => navigate(`/batches/${batchId}/practice`) }}
      />
    );
  }

  const reset = () => {
    setCheckError(null);
    setSelectedOption(null);
    setStatementAnswers([]);
    setPassageAnswers([]);
    setHints([]);
    setHintError(null);
    passageHints.reset();
    setWrittenAnswer("");
    setWrittenImages([]);
    setWrittenResult(null);
    setWrittenError(null);
    setFeedback(null);
    setExplanation(null);
    setExplainError(null);
    setSimilarQuestions(null);
    setSimilarError(null);
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
    answerFeedback(result.isCorrect);
    setScore((s) => ({ correct: s.correct + (result.isCorrect ? 1 : 0), total: s.total + 1 }));
  };

  const checkWritten = async () => {
    setWrittenError(null);
    try {
      const result = await gradeWritten({
        batchId, questionId: question._id, answerText: writtenAnswer,
        answerImages: imagesAllowed && writtenImages.length > 0 ? writtenImages : undefined,
      }).unwrap();
      // The grade also returns the printed solution, shown in the solution panel.
      const { marks, totalMarks, feedback: aiFeedback, transcript, ...solution } = result;
      setWrittenResult({ marks, totalMarks, feedback: aiFeedback, transcript });
      setFeedback({ isCorrect: null, ...solution });
      setScore((s) => ({ correct: s.correct + (result.marks >= result.totalMarks * 0.6 ? 1 : 0), total: s.total + 1 }));
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
    : question.type === "passage"
    ? passageAnswers.length === (question.subQuestions || []).filter((sq) => sq.type !== "written").length
    : statementAnswers.length === (question.statements?.length || 0);

  const getHint = async () => {
    setHintError(null);
    try {
      const result = await requestHint({ batchId, questionId: question._id, level: hints.length + 1, previousHints: hints }).unwrap();
      setHints((h) => [...h, result.hint]);
    } catch (error) {
      setHintError({ message: error.data?.message || "Could not get a hint right now.", capReached: error.status === 429 });
    }
  };
  // Hints only before the answer is checked or graded.
  const unanswered = question.type === "written" ? !writtenResult : !feedback;

  // Only written questions under it: each is checked on its own, so the
  // page just moves on.
  const writtenOnlyPassage = question.type === "passage" && !(question.subQuestions || []).some((sq) => sq.type !== "written");

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 600, mx: "auto" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
        <IconButton size="small" onClick={() => goBack(navigate, `/batches/${batchId}/practice`)}><ArrowLeft size={18} /></IconButton>
        <Typography variant="caption" color="text.secondary">Question {index + 1} of {questions.length}{requestedSkill && !isPersonalized && !isFavorites ? ` · ${skillTypeLabel(requestedSkill)}` : ""}</Typography>
      </Box>
      <LinearProgress variant="determinate" value={(index / questions.length) * 100} sx={{ mb: 3, height: 4, borderRadius: 2 }} />
      <AiUsageMeter batchId={batchId} compact />

      <Paper key={index} variant="outlined" sx={{ p: 3, borderRadius: 3, mb: 2, ...(index > 0 ? animate(slideInRight, 320, "cubic-bezier(.2,.7,.3,1)") : {}) }}>
        <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1, mb: 2 }}>
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
          <McqOptions
            options={question.options}
            selectedOption={selectedOption}
            feedback={feedback}
            onSelect={setSelectedOption}
            animate
          />
        )}

        {question.type === "mtf" && (
          <MtfStatements
            statements={question.statements}
            statementAnswers={statementAnswers}
            feedback={feedback}
            onChange={setStatementAnswers}
          />
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
                    uploadAnswerImage={uploadAnswerImage} question={withPart(question, si)} draftKey={`practice:${batchId}:${question._id}:${si}`} />
                ) : undefined}
              />
            )}
            feedback={feedback}
            renderSubExtra={hintsOn ? (si) => (
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

        {question.type === "written" && (
          <>
            {!writtenResult && (
              <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 0.5 }}>
                <LatexInserter inputRef={writtenRef} value={writtenAnswer} onChange={setWrittenAnswer} />
              </Box>
            )}
            <TextField
              inputRef={writtenRef}
              multiline
              minRows={4}
              fullWidth
              disabled={Boolean(writtenResult)}
              placeholder="Write your answer here"
              value={writtenAnswer}
              onChange={(e) => setWrittenAnswer(e.target.value)}
            />
            {writtenAnswer.includes("$") && (
              <Box
                sx={{
                  mt: 0.75,
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
        {question.type === "written" && imagesAllowed && (
          <PracticeAnswerImageUploader
            images={writtenImages}
            onChange={setWrittenImages}
            disabled={Boolean(writtenResult)}
            batchId={batchId}
            uploadAnswerImage={uploadAnswerImage}
            question={question}
            draftKey={`practice:${batchId}:${question._id}`}
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
          {writtenResult.marks < writtenResult.totalMarks * 0.6 && writtenResult.similar !== false && (
            <Box sx={{ mt: 1.5 }}>
              <ActionChip icon={Layers} label="Practice 5 similar" onClick={openSimilar} />
            </Box>
          )}
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
            // isCorrect null: a graded written answer's solution, no verdict here.
            borderColor: feedback.isCorrect === null ? "divider" : feedback.isCorrect ? "success.main" : "error.main",
            bgcolor: feedback.isCorrect === null ? "background.paper" : feedback.isCorrect ? theme.palette.correctBg : theme.palette.incorrectBg,
          }}
        >
          {feedback.isCorrect === null ? (
            feedback.solutionText || feedback.solutionImage?.url || feedback.solutionVideo?.url || feedback.solutionAttachments?.length
              ? <Typography sx={{ fontWeight: 500, mb: 1 }}>Solution</Typography> : null
          ) : (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: feedback.solutionText ? 1 : 0 }}>
              {feedback.isCorrect ? <Check size={18} color={theme.palette.success.main} /> : <X size={18} color={theme.palette.error.main} />}
              <Typography sx={{ fontWeight: 500 }}>
                {feedback.correctCount !== undefined
                  ? `${feedback.correctCount} of ${feedback.totalCount} correct`
                  : feedback.isCorrect ? "Correct" : "Not quite"}
              </Typography>
            </Box>
          )}
          {/* Numbered by line when students can ask about a line of it. */}
          {feedback.solutionText && (qnaOn
            ? <NumberedSolution text={feedback.solutionText} />
            : <Latex as="div" style={{ fontSize: 13.5 }}>{feedback.solutionText}</Latex>)}
          {feedback.solutionImage?.url && (
            <ZoomableImage src={feedback.solutionImage.url} sx={{ maxWidth: "100%", borderRadius: 1, mt: 1 }} />
          )}
          <SolutionVideo video={feedback.solutionVideo} questionId={question?._id} batchId={batchId} />
          <AttachmentList attachments={feedback.solutionAttachments} sx={{ mt: 1 }} />

          {!feedback.isCorrect && question.type !== "written" && (
            <Box sx={{ mt: 1.5 }}>
              <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                {batch?.aiExplanations && question.type !== "passage" && !explanation && !explaining && (
                  <ActionChip icon={Sparkles} label="Explain why" onClick={explain} />
                )}
                {feedback.similar !== false && <ActionChip icon={Layers} label="Practice 5 similar" onClick={openSimilar} />}
              </Box>
              {explaining && (
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, color: "text.secondary", mt: 1 }}>
                  <CircularProgress size={14} />
                  <Typography variant="caption">Thinking it through…</Typography>
                </Box>
              )}
              {explainError && <AiErrorAlert error={explainError} batchId={batchId} navigate={navigate} sx={{ mt: 1 }} />}
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

      {/* Questions about the solution, once answered (any type). */}
      {qnaOn && (question.type === "written" ? writtenResult : feedback) && (
        <SolutionQna key={question._id} batchId={batchId} questionId={question._id} navigate={navigate} sx={{ mb: 2 }} />
      )}

      {hintsOn && question.type !== "passage" && (
        <HintPanel
          hints={hints}
          loading={loadingHint}
          error={hintError}
          onRequestHint={getHint}
          canRequest={unanswered}
          batchId={batchId}
          navigate={navigate}
          sx={{ mb: 2 }}
        />
      )}

      {question.type === "written" ? (
        writtenResult ? (
          <Button variant="contained" fullWidth onClick={next}>
            {index === questions.length - 1 ? "Finish" : "Next question"}
          </Button>
        ) : (
          <>
            <Button
              variant="contained"
              fullWidth
              startIcon={<Sparkles size={16} />}
              disabled={(!writtenAnswer.trim() && writtenImages.length === 0) || gradingWritten}
              onClick={checkWritten}
            >
              {gradingWritten ? "Grading…" : "Check with AI"}
            </Button>
            {/* Grading a written answer is the one action on this whole
                page that depends on AI actually being available — off for
                this batch, capped for today, or just a provider hiccup,
                any of those used to leave a written question with no way
                past it at all, since "Next question" only ever appeared
                after a successful grade. Skipping never scores the
                question either way; it's simply left out of the
                percentage, the same as any other ungradable answer. */}
            <Button variant="text" fullWidth onClick={next} sx={{ mt: 1, color: "text.secondary" }}>
              Skip this question
            </Button>
          </>
        )
      ) : feedback || writtenOnlyPassage ? (
        <Button variant="contained" fullWidth onClick={next}>
          {index === questions.length - 1 ? "Finish" : "Next question"}
        </Button>
      ) : (
        <>
          <Button variant="contained" fullWidth disabled={!answered || checking} onClick={check}>
            {checking ? "Checking" : "Check answer"}
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

      <SimilarQuestionsModal
        open={similarOpen}
        onClose={() => setSimilarOpen(false)}
        loading={loadingSimilar}
        error={similarError}
        questions={similarQuestions}
        batchId={batchId}
      />
    </Box>
  );
}

// A small pill, not a bare text link — sized and shaped to read as a quick
// action rather than a caption. Icon and label are left to the Button's own
// startIcon layout rather than pushed around with a sx override, which is
// exactly what produced the stacked icon-over-text bug this replaced: MUI's
// Button lays startIcon + children out itself, and overriding its display
// mode to force a line break broke that internal alignment.
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

// AiErrorAlert and PracticeAnswerImageUploader used to be defined here —
// moved to ../../components/practice/ so PracticeModal.jsx (the study
// plan's quick-practice popup) can use the exact same "Check with AI"
// error treatment and image attachment, instead of a thinner, duplicated
// version of each.
