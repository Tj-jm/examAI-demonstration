import { memo, useState, useEffect, useRef } from "react";
import SolutionVideo from "../../components/SolutionVideo";
import {
  Box, Typography, Paper, TextField, Button, IconButton, Alert, Skeleton,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Chip, CircularProgress,
  RadioGroup, Radio, FormControlLabel, Divider,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import {
  ArrowLeft, ListChecks, Check, Clock, Hash, ListTodo, CircleCheckBig,
  ToggleLeft, PenLine, Newspaper, TrendingUp, Sparkles, RotateCcw, X as XIcon, ClipboardCheck,
} from "lucide-react";
import {
  useGetArchiveTopicsQuery, useGetArchiveExamRecordQuery, useGetArchiveWeakTopicsQuery, useGetBatchQuery,
  useBuildArchiveExamMutation, useSubmitArchiveExamMutation, useUploadArchiveAnswerImageMutation, useGetArchiveExamInsightMutation,
} from "../../api/contentApi";
import EmptyState from "../../components/EmptyState";
import { BatchContextCard } from "../../components/BatchSwitcher";
import AiUsageMeter from "../../components/AiUsageMeter";
import WrittenCostNote, { WrittenCostUsed } from "../../components/practice/WrittenCostNote";
import PracticeAnswerImageUploader from "../../components/practice/PracticeAnswerImageUploader";
import PassageQuestions from "../../components/practice/PassageQuestions";
import ZoomableImage from "../../components/ZoomableImage";
import AttachmentList from "../../components/AttachmentList";
import McqOptions from "../../components/practice/McqOptions";
import { timerPulse, useCountUp } from "../../motion";
import Confetti from "../../components/Confetti";
import MtfStatements from "../../components/practice/MtfStatements";
import Latex from "../../components/Latex";
import LatexInserter from "../../components/LatexInserter";
import { useCalculator } from "../../components/calculator/useCalculator";
import { useTerms } from "../../BrandingContext";
import { withPart } from "../../utils/passagePart";

const TYPES = [
  ["mcq", "Multiple choice", CircleCheckBig],
  ["mtf", "True / false", ToggleLeft],
  ["written", "Written", PenLine],
  ["passage", "Passage", Newspaper],
];

// The archive's own version of CustomExamSetup.jsx — same setup/taking/
// review three-phase flow, nothing persisted until submit, still nothing
// persisted even then beyond a running average (see
// archivePracticeExamController.js). Two real differences from the batch
// version:
//   - Gated on the archive's own switches, not the batch's aiAssist:
//     written questions need archiveAiAssist (they're AI-graded — the
//     server drops the type otherwise, see buildArchiveExam), and the AI
//     insight card needs archiveAiAssist + archiveExamInsight
//     (archiveRoutes.js). Billing is the archive's shared batch: null pool.
//   - Topics/chapter-pools come from the archive's own bank (isPublic +
//     this batch's archiveAuthorities), not Question.batches.
export default function ArchiveCustomExamSetup() {
  const terms = useTerms();
  const { batchId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const [phase, setPhase] = useState("setup"); // setup | taking | review
  // Setup, the paper and the review are one page: each starts at the top,
  // not wherever the last one was scrolled to.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [phase]);
  const [paper, setPaper] = useState(null);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);

  const [topicIds, setTopicIds] = useState([]);
  const [chapterIds, setChapterIds] = useState([]);
  const [types, setTypes] = useState(["mcq"]);
  const [duration, setDuration] = useState(30);
  const [count, setCount] = useState(10);

  const { data: batch } = useGetBatchQuery(batchId);
  useCalculator(Boolean(batch) && batch.features?.calculator !== false);
  const aiOn = Boolean(batch?.features?.archiveAiAssist);
  const insightOn = aiOn && Boolean(batch?.features?.archiveExamInsight);
  // Written is AI-graded, so it's only offered with archiveAiAssist on.
  const typeOptions = aiOn ? TYPES : TYPES.filter(([value]) => value !== "written");
  // A "written" restored from an earlier setup is dropped, not sent.
  const activeTypes = aiOn ? types : types.filter((t) => t !== "written");
  const { data, isLoading } = useGetArchiveTopicsQuery({ batchId, types: activeTypes.join(",") });
  const { data: record } = useGetArchiveExamRecordQuery(batchId);
  const { data: weak } = useGetArchiveWeakTopicsQuery(batchId, { skip: !batchId });
  const [build, { isLoading: building, error: buildError }] = useBuildArchiveExamMutation();
  const [submit, { isLoading: submitting, error: submitError }] = useSubmitArchiveExamMutation();
  // Photos of working on written answers — only when this batch allows it
  // (writtenAnswerImages), same as single-question practice.
  const [uploadAnswerImage] = useUploadArchiveAnswerImageMutation();
  const imagesAllowed = Boolean(batch?.features?.writtenAnswerImages);

  const toggleTopic = (id) =>
    setTopicIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  const toggleChapter = (id) =>
    setChapterIds((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  const toggleType = (value) => {
    setTypes((prev) => (prev.includes(value) ? prev.filter((t) => t !== value) : [...prev, value]));
  };

  const startWith = async (params) => {
    try {
      const built = await build({ batchId, ...params }).unwrap();
      setPaper(built);
      setAnswers({});
      setPhase("taking");
    } catch {
      // rendered below via buildError
    }
  };

  // An archive study-plan day's "Start exam" button (ArchiveStudyPlan.jsx)
  // launches this page pre-filled and already running — same mechanism as
  // the batch version.
  const autoStarted = useRef(false);
  useEffect(() => {
    const auto = location.state?.autoStart;
    if (!auto || autoStarted.current) return;
    autoStarted.current = true;
    const params = {
      topicIds: auto.topicIds || [],
      chapterIds: auto.chapterIds || [],
      types: auto.types || ["mcq"],
      durationMinutes: auto.durationMinutes || 30,
      questionCount: auto.questionCount || 10,
    };
    setTopicIds(params.topicIds);
    setChapterIds(params.chapterIds);
    setTypes(params.types);
    setDuration(params.durationMinutes);
    setCount(params.questionCount);
    startWith(params);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = () => startWith({
    topicIds,
    chapterIds,
    types: activeTypes,
    durationMinutes: duration,
    questionCount: count,
  });

  const finish = async () => {
    const payload = paper.questions.flatMap((q) => [
      { questionId: q._id, ...answers[q._id] },
      // A passage's written questions: "<passage>:<index>".
      ...(q.subQuestions || []).map((sq, si) => (sq.type === "written" && answers[`${q._id}:${si}`] ? { questionId: `${q._id}:${si}`, ...answers[`${q._id}:${si}`] } : null)).filter(Boolean),
    ]);
    try {
      const res = await submit({ batchId, answers: payload }).unwrap();
      setResult(res);
      setPhase("review");
    } catch {
      // rendered inside TakingPaper via submitError
    }
  };

  const practiceAgain = () => {
    setPhase("setup");
    setPaper(null);
    setResult(null);
    setAnswers({});
  };

  if (location.state?.autoStart && phase === "setup" && !buildError) {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, py: 10 }}>
        <CircularProgress size={28} />
        <Typography variant="body2" color="text.secondary">Building your exam…</Typography>
      </Box>
    );
  }

  if (phase === "taking" && paper) {
    return (
      <TakingPaper
        paper={paper}
        answers={answers}
        setAnswers={setAnswers}
        onFinish={finish}
        imagesAllowed={imagesAllowed}
        batchId={batchId}
        uploadAnswerImage={uploadAnswerImage}
        submitting={submitting}
        submitError={submitError}
        onExit={() => setPhase("setup")}
      />
    );
  }

  if (phase === "review" && result) {
    return (
      <ReviewResult
        insightOn={insightOn}
        batchId={batchId}
        result={result}
        weak={weak}
        onAgain={practiceAgain}
        onExit={() => navigate(`/batches/${batchId}/archive`)}
      />
    );
  }

  const valid = (topicIds.length > 0 || chapterIds.length > 0) && types.length > 0 && duration >= 5 && count >= 3;
  const topics = data?.topics || [];
  const chapterPools = data?.chapterPools || [];
  const availableQuestions =
    topics.filter((t) => topicIds.includes(t._id)).reduce((sum, t) => sum + t.questionCount, 0) +
    chapterPools.filter((c) => chapterIds.includes(c._id)).reduce((sum, c) => sum + c.questionCount, 0);

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 640, mx: "auto" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
        <IconButton size="small" onClick={() => navigate(`/batches/${batchId}/archive`)}><ArrowLeft size={18} /></IconButton>
      </Box>

      <BatchContextCard batch={batch} pageName="Build a practice exam" section={{ label: "Archive", to: `/batches/${batchId}/archive` }} />

      {record && record.attemptCount > 0 && (
        <Paper
          variant="outlined"
          sx={{ p: 1.75, borderRadius: 2.5, mb: 3, display: "flex", alignItems: "center", gap: 1.5 }}
        >
          <TrendingUp size={18} style={{ opacity: 0.7, flexShrink: 0 }} />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              Your average: {record.averagePercent}%
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Across {record.attemptCount} archive practice exam{record.attemptCount === 1 ? "" : "s"}
            </Typography>
          </Box>
        </Paper>
      )}

      {buildError && <Alert severity="error" sx={{ mb: 2 }}>{buildError.data?.message || "Could not build this exam."}</Alert>}

      <SectionLabel icon={ListTodo}>
        Topics {(topicIds.length + chapterIds.length) > 0 && `· ${topicIds.length + chapterIds.length} selected`}
      </SectionLabel>

      {isLoading ? (
        <Skeleton variant="rounded" height={140} sx={{ mb: 3 }} />
      ) : topics.length === 0 && chapterPools.length === 0 ? (
        <EmptyState
          bordered
          icon={ListTodo}
          tone="blocked"
          title="No topics to build from"
          description={`A custom exam is assembled from this ${terms.batch}'s archive — try a different type, or check back once more archive content is added.`}
          secondaryAction={{ label: "Back to archive", onClick: () => navigate(`/batches/${batchId}/archive`) }}
          sx={{ mb: 3 }}
        />
      ) : (
        <Box
          sx={{
            display: "flex", flexDirection: "column", gap: 2, mb: 3,
            maxHeight: 320, overflowY: "auto", overflowX: "hidden", pr: 0.5,
            "&::-webkit-scrollbar": { width: 6 },
            "&::-webkit-scrollbar-track": { background: "transparent" },
            "&::-webkit-scrollbar-thumb": {
              backgroundColor: "action.disabled",
              borderRadius: 3,
            },
            "&::-webkit-scrollbar-thumb:hover": { backgroundColor: "action.active" },
            scrollbarWidth: "thin",
            scrollbarColor: (theme) => `${theme.palette.action.disabled} transparent`,
          }}
        >
          {/* Two clearly separate groups, not one mixed list — a topic's
              own card names its parent chapter, a chapter-pool card says
              "Chapter pool" instead, but with no heading splitting them a
              board whose archive content is entirely chapter-pool (real,
              not rare — passage questions can only ever be chapter-pool)
              read as if every card were mislabeled the same way. */}
          {topics.length > 0 && (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <Typography variant="caption" color="text.secondary">By topic</Typography>
              {topics.map((t) => {
                const selected = topicIds.includes(t._id);
                return (
                  <Paper
                    key={t._id}
                    variant="outlined"
                    onClick={() => toggleTopic(t._id)}
                    sx={{
                      p: 1.75, borderRadius: 2.5, cursor: "pointer",
                      display: "flex", alignItems: "center", gap: 1.5,
                      borderColor: selected ? "primary.main" : "divider",
                      borderWidth: selected ? 2 : 1,
                      bgcolor: selected ? "action.hover" : "transparent",
                      transition: "border-color 120ms, background-color 120ms",
                    }}
                  >
                    <Box sx={{
                      width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                      border: "1.5px solid", borderColor: selected ? "primary.main" : "divider",
                      bgcolor: selected ? "primary.main" : "transparent",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {selected && <Check size={13} color="#fff" />}
                    </Box>
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: 500 }} noWrap>{t.title}</Typography>
                      <Typography variant="caption" color="text.secondary" noWrap>
                        {t.chapter?.title} · {t.questionCount} question{t.questionCount === 1 ? "" : "s"}
                      </Typography>
                    </Box>
                  </Paper>
                );
              })}
            </Box>
          )}

          {chapterPools.length > 0 && (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <Typography variant="caption" color="text.secondary">By chapter (whole chapter)</Typography>
              {chapterPools.map((c) => {
                const selected = chapterIds.includes(c._id);
                return (
                  <Paper
                    key={`chapter-${c._id}`}
                    variant="outlined"
                    onClick={() => toggleChapter(c._id)}
                    sx={{
                      p: 1.75, borderRadius: 2.5, cursor: "pointer",
                      display: "flex", alignItems: "center", gap: 1.5,
                      borderColor: selected ? "primary.main" : "divider",
                      borderWidth: selected ? 2 : 1,
                      bgcolor: selected ? "action.hover" : "transparent",
                      transition: "border-color 120ms, background-color 120ms",
                    }}
                  >
                    <Box sx={{
                      width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                      border: "1.5px solid", borderColor: selected ? "primary.main" : "divider",
                      bgcolor: selected ? "primary.main" : "transparent",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {selected && <Check size={13} color="#fff" />}
                    </Box>
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: 500 }} noWrap>{c.title}</Typography>
                      <Typography variant="caption" color="text.secondary" noWrap>
                        Chapter pool · {c.questionCount} question{c.questionCount === 1 ? "" : "s"}
                      </Typography>
                    </Box>
                  </Paper>
                );
              })}
            </Box>
          )}
        </Box>
      )}

      <SectionLabel icon={ListChecks}>Question types</SectionLabel>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 1.5, mb: 3 }}>
        {typeOptions.map(([value, label, Icon]) => {
          const selected = types.includes(value);
          return (
            <Paper
              key={value}
              variant="outlined"
              onClick={() => toggleType(value)}
              sx={{
                p: 1.75, borderRadius: 2.5, textAlign: "center", cursor: "pointer",
                borderColor: selected ? "primary.main" : "divider",
                borderWidth: selected ? 2 : 1,
                bgcolor: selected ? "action.hover" : "transparent",
              }}
            >
              <Icon size={20} style={{ marginBottom: 6 }} />
              <Typography variant="caption" sx={{ display: "block", fontWeight: 500, lineHeight: 1.3 }}>{label}</Typography>
            </Paper>
          );
        })}
      </Box>

      <SectionLabel icon={Clock}>Length</SectionLabel>
      <Box sx={{ display: "flex", gap: 2, mb: 3 }}>
        <TextField
          label="Duration (minutes)"
          type="number"
          size="small"
          fullWidth
          value={duration}
          onChange={(e) => setDuration(Number(e.target.value))}
          inputProps={{ min: 5, max: 240 }}
          InputProps={{ startAdornment: <Clock size={15} style={{ marginRight: 8, opacity: 0.5 }} /> }}
        />
        <TextField
          label="Number of questions"
          type="number"
          size="small"
          fullWidth
          value={count}
          onChange={(e) => setCount(Number(e.target.value))}
          inputProps={{ min: 3, max: 50 }}
          InputProps={{ startAdornment: <Hash size={15} style={{ marginRight: 8, opacity: 0.5 }} /> }}
        />
      </Box>

      {(topicIds.length > 0 || chapterIds.length > 0) && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
          Up to {availableQuestions} question{availableQuestions === 1 ? "" : "s"} available across your selected topics —
          you'll get {Math.min(count, availableQuestions) || 0} of them.
          {activeTypes.includes("written") && (
            " Written questions may be fewer than that if your daily free AI calls and credits can't cover grading all of them."
          )}
        </Typography>
      )}

      <Button
        variant="contained"
        fullWidth
        size="large"
        startIcon={<ListChecks size={18} />}
        disabled={!valid || building}
        onClick={start}
      >
        {building ? "Building your exam…" : "Start"}
      </Button>
    </Box>
  );
}

function SectionLabel({ icon: Icon, children }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 1.25 }}>
      <Icon size={13} style={{ opacity: 0.6 }} />
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500 }}>{children}</Typography>
    </Box>
  );
}

function WrittenAnswerField({ value, onChange }) {
  const ref = useRef(null);
  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 0.5 }}>
        <LatexInserter inputRef={ref} value={value} onChange={onChange} />
      </Box>
      <TextField
        inputRef={ref}
        multiline
        minRows={4}
        fullWidth
        placeholder="Write your answer here"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Box>
  );
}

// The questions, split out of TakingPaper and memoised. TakingPaper
// re-renders every second for the clock; this only re-renders when an
// answer changes, so the maths is not re-typeset on every tick.
const PaperQuestions = memo(function PaperQuestions({ questions, answers, setAnswers, imagesAllowed, batchId, uploadAnswerImage }) {
  const setAnswer = (questionId, patch) =>
    setAnswers((prev) => ({ ...prev, [questionId]: { ...prev[questionId], ...patch } }));

  return (
    <>
      {questions.map((q, index) => (
      <Paper key={q._id} variant="outlined" sx={{ p: { xs: 2, sm: 2.5 }, borderRadius: 3 }}>
        <Box sx={{ display: "flex", gap: 1.5, mb: 1.5 }}>
          <Typography sx={{ fontWeight: 500, color: "text.secondary" }}>{index + 1}.</Typography>
          <Box sx={{ flex: 1 }}>
            {q.questionImage?.url && (
              <ZoomableImage src={q.questionImage.url} sx={{ maxWidth: "100%", borderRadius: 1, mb: 1 }} />
            )}
            <Latex>{q.question}</Latex>
          </Box>
        </Box>

        {q.type === "mcq" && (
          <McqOptions
            options={q.options}
            selectedOption={answers[q._id]?.selectedOption}
            feedback={null}
            onSelect={(key) => setAnswer(q._id, { selectedOption: key })}
          />
        )}

        {q.type === "mtf" && (
          <MtfStatements
            statements={q.statements}
            statementAnswers={answers[q._id]?.statementAnswers || []}
            feedback={null}
            onChange={(next) => setAnswer(q._id, { statementAnswers: next })}
          />
        )}

        {q.type === "written" && (
          <>
            <WrittenAnswerField
              value={answers[q._id]?.answerText || ""}
              onChange={(text) => setAnswer(q._id, { answerText: text })}
            />
            {imagesAllowed && (
              <Box sx={{ mt: 1.5 }}>
                <PracticeAnswerImageUploader
                  images={answers[q._id]?.answerImages || []}
                  onChange={(next) => setAnswer(q._id, { answerImages: next })}
                  batchId={batchId}
                  uploadAnswerImage={uploadAnswerImage}
                  question={q}
                  draftKey={`archive-exam:${batchId}:${q._id}`}
                />
              </Box>
            )}
          </>
        )}

        {q.type === "passage" && (
          <PassageQuestions
            subQuestions={q.subQuestions}
            answers={answers[q._id]?.subAnswers || []}
            onChange={(next) => setAnswer(q._id, { subAnswers: next })}
            feedback={null}
            renderWritten={(si) => (
              <>
                <WrittenAnswerField
                  value={answers[`${q._id}:${si}`]?.answerText || ""}
                  onChange={(text) => setAnswer(`${q._id}:${si}`, { answerText: text })}
                />
                {imagesAllowed && (
                  <Box sx={{ mt: 1.5 }}>
                    <PracticeAnswerImageUploader
                      images={answers[`${q._id}:${si}`]?.answerImages || []}
                      onChange={(next) => setAnswer(`${q._id}:${si}`, { answerImages: next })}
                      batchId={batchId}
                      uploadAnswerImage={uploadAnswerImage}
                      question={withPart(q, si)}
                      draftKey={`archive-exam:${batchId}:${q._id}:${si}`}
                    />
                  </Box>
                )}
              </>
            )}
          />
        )}
      </Paper>
    ))}
    </>
  );
});

function TakingPaper({ paper, answers, setAnswers, onFinish, imagesAllowed, batchId, uploadAnswerImage, submitting, submitError, onExit }) {
  const theme = useTheme();
  const totalMs = paper.durationMinutes * 60000;
  const warningThresholdMs = totalMs * 0.2;
  const [remainingMs, setRemainingMs] = useState(totalMs);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const autoFinished = useRef(false);

  useEffect(() => {
    const tick = setInterval(() => setRemainingMs((ms) => Math.max(0, ms - 1000)), 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (remainingMs === 0 && !autoFinished.current && !submitting) {
      autoFinished.current = true;
      onFinish();
    }
  }, [remainingMs, submitting, onFinish]);

  const answeredCount = paper.questions.filter((q) => {
    if (q.type === "passage" && (q.subQuestions || []).some((sq, si) => sq.type === "written" && (answers[`${q._id}:${si}`]?.answerText?.trim() || answers[`${q._id}:${si}`]?.answerImages?.length))) return true;
    const a = answers[q._id];
    if (!a) return false;
    if (q.type === "mcq") return Boolean(a.selectedOption);
    if (q.type === "mtf") return (a.statementAnswers || []).length > 0;
    if (q.type === "passage") return (a.subAnswers || []).length > 0;
    return Boolean((a.answerText && a.answerText.trim()) || a.answerImages?.length);
  }).length;

  const minutes = Math.floor(remainingMs / 60000);
  const seconds = Math.floor((remainingMs % 60000) / 1000);
  const formatted = `${minutes}:${String(seconds).padStart(2, "0")}`;

  return (
    <Box sx={{ minHeight: "100dvh", bgcolor: "background.default" }}>
      <Box
        sx={{
          position: "sticky", top: "env(safe-area-inset-top, 0px)", zIndex: 5, bgcolor: "background.paper",
          borderBottom: 1, borderColor: "divider",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          px: 2, py: 1.25,
        }}
      >
        <IconButton size="small" onClick={() => setConfirmExit(true)} aria-label="Exit practice exam">
          <XIcon size={18} />
        </IconButton>
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {answeredCount}/{paper.questions.length} answered
        </Typography>
        <Chip
          icon={<Clock size={14} />}
          label={formatted}
          color={remainingMs < 60000 ? "error" : remainingMs < warningThresholdMs ? "warning" : "default"}
          sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 500, ...timerPulse(remainingMs, warningThresholdMs) }}
        />
      </Box>

      <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: 720, mx: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
        <WrittenCostNote aiCost={paper.aiCost} />
        {submitError && (
          <Alert severity="error">{submitError.data?.message || "Could not grade this attempt. Try finishing again."}</Alert>
        )}

        <PaperQuestions
          questions={paper.questions}
          answers={answers}
          setAnswers={setAnswers}
          imagesAllowed={imagesAllowed}
          batchId={batchId}
          uploadAnswerImage={uploadAnswerImage}
        />

        <Button
          variant="contained"
          size="large"
          disabled={submitting}
          onClick={() => setConfirmSubmit(true)}
        >
          {submitting ? "Grading…" : "Finish and see results"}
        </Button>
      </Box>

      <Dialog open={confirmSubmit} onClose={() => setConfirmSubmit(false)}>
        <DialogTitle>Finish this practice exam?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {answeredCount < paper.questions.length
              ? `${paper.questions.length - answeredCount} question${paper.questions.length - answeredCount === 1 ? " is" : "s are"} still unanswered. You can go back and finish them, or submit as is.`
              : "Every question is answered. This grades the paper and shows your result once, right now."}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmSubmit(false)}>Go back</Button>
          <Button variant="contained" onClick={() => { setConfirmSubmit(false); onFinish(); }}>Finish</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmExit} onClose={() => setConfirmExit(false)}>
        <DialogTitle>Leave without finishing?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Nothing here is saved until you finish. Leaving now loses every answer on this attempt.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmExit(false)}>Stay</Button>
          <Button color="error" onClick={onExit}>Leave</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function ReviewResult({ insightOn, batchId, result, weak, onAgain, onExit }) {
  const theme = useTheme();
  const pct = result.percent ?? 0;

  const [getInsight, { data: insight, isLoading: insightLoading, error: insightError }] = useGetArchiveExamInsightMutation();
  const requestInsight = () => {
    getInsight({
      batchId,
      questions: result.questions.map((q) => ({ _id: q._id, isCorrect: q.isCorrect, gradable: q.gradable })),
      marksAwarded: result.marksAwarded,
      totalMarks: result.totalMarks,
    });
  };

  const weakTopics = weak?.topics || [];

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 720, mx: "auto" }}>
      <WrittenCostUsed result={result} sx={{ mb: 2 }} />
      <Paper
        variant="outlined"
        sx={{
          p: 3, borderRadius: 3, mb: 3, textAlign: "center",
          bgcolor: pct >= 60 ? theme.palette.correctBg : theme.palette.incorrectBg,
          borderColor: pct >= 60 ? "success.main" : "error.main",
        }}
      >
        <Typography variant="h4" sx={{ fontWeight: 600 }}>
          {result.percent === null ? "—" : <><CountUp value={pct} />%</>}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          <CountUp value={result.marksAwarded} />/{result.totalMarks} marks
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
          This result is shown once and will not be saved — only your running average carries forward.
        </Typography>
      </Paper>
      {result.percent !== null && pct >= 80 && <Confetti />}

      {weakTopics.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, mb: 3 }}>
          <Typography variant="body2" sx={{ fontWeight: 500, mb: 1 }}>Your weak spots in the archive</Typography>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
            {weakTopics.slice(0, 6).map((t) => (
              <Chip key={t._id} size="small" label={`${t.title} · ${t.accuracy}%`} />
            ))}
          </Box>
        </Paper>
      )}

      {insightOn && (
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, mb: 3 }}>
        {!insight && <AiUsageMeter batchId={batchId} archive compact />}
        {!insight && (
          <Button
            variant="outlined"
            size="small"
            fullWidth
            startIcon={<Sparkles size={15} />}
            disabled={insightLoading}
            onClick={requestInsight}
          >
            {insightLoading ? "Thinking…" : "Get AI insight on this attempt"}
          </Button>
        )}
        {insightError && (
          <Alert severity="error" sx={{ mt: insight ? 0 : 1.5 }}>
            {insightError.data?.message || "Could not generate an insight right now."}
          </Alert>
        )}
        {insight && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Sparkles size={16} color={theme.palette.ai?.main} />
              <Typography sx={{ fontWeight: 500, fontSize: 14 }}>AI insight</Typography>
            </Box>
            <Typography variant="body2">{insight.summary}</Typography>
            {insight.strengths?.length > 0 && (
              <Box>
                <Typography variant="caption" color="text.secondary">Strengths</Typography>
                <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, mt: 0.5 }}>
                  {insight.strengths.map((s, i) => (
                    <Paper
                      key={i}
                      variant="outlined"
                      sx={{ px: 1.25, py: 0.75, borderRadius: 1.5, borderColor: "success.main", bgcolor: theme.palette.correctBg }}
                    >
                      <Typography variant="body2">{s}</Typography>
                    </Paper>
                  ))}
                </Box>
              </Box>
            )}
            {insight.weaknesses?.length > 0 && (
              <Box>
                <Typography variant="caption" color="text.secondary">Weaknesses</Typography>
                <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, mt: 0.5 }}>
                  {insight.weaknesses.map((w, i) => (
                    <Paper
                      key={i}
                      variant="outlined"
                      sx={{ px: 1.25, py: 0.75, borderRadius: 1.5, borderColor: "error.main", bgcolor: theme.palette.incorrectBg }}
                    >
                      <Typography variant="body2">{w}</Typography>
                    </Paper>
                  ))}
                </Box>
              </Box>
            )}
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, bgcolor: "action.hover" }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>Next step</Typography>
              <Typography variant="body2">{insight.recommendation}</Typography>
            </Paper>
          </Box>
        )}
      </Paper>
      )}

      <Box sx={{ display: "flex", gap: 1.5, mb: 3 }}>
        <Button variant="contained" fullWidth startIcon={<RotateCcw size={16} />} onClick={onAgain}>
          Practice again
        </Button>
        <Button variant="outlined" fullWidth onClick={onExit}>
          Done
        </Button>
      </Box>

      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {result.questions.map((q, index) => (
          <QuestionReview key={q._id || index} index={index} q={q} theme={theme} />
        ))}
      </Box>
    </Box>
  );
}

function QuestionReview({ index, q, theme }) {
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 }, borderRadius: 3 }}>
      <Box sx={{ display: "flex", gap: 1.5, mb: 1.5 }}>
        <Typography sx={{ fontWeight: 500, color: "text.secondary" }}>{index + 1}.</Typography>
        <Box sx={{ flex: 1 }}>
          {q.questionImage?.url && (
            <ZoomableImage src={q.questionImage.url} sx={{ maxWidth: "100%", borderRadius: 1, mb: 1 }} />
          )}
          <Latex>{q.partQuestion ? `(${q.partLabel}) ${q.partQuestion}` : q.question}</Latex>
        </Box>
        {q.gradable === false ? (
          <Chip size="small" label="Not graded" />
        ) : (
          <ClipboardCheck size={18} color={q.isCorrect ? theme.palette.success.main : theme.palette.error.main} style={{ flexShrink: 0, marginTop: 2 }} />
        )}
      </Box>

      {q.type === "mcq" && (
        <McqOptions options={q.options} selectedOption={q.yourAnswer.selectedOption} feedback={q} onSelect={() => {}} />
      )}

      {q.type === "mtf" && (
        <MtfStatements statements={q.statements} statementAnswers={q.yourAnswer.statementAnswers || []} feedback={q} onChange={() => {}} />
      )}

      {q.type === "passage" && (
        <PassageQuestions
          subQuestions={q.subQuestions}
          answers={q.yourAnswer.subAnswers || []}
          onChange={() => {}}
          renderWritten={() => <Typography variant="caption" color="text.secondary" sx={{ pl: 3 }}>Marked below.</Typography>}
          feedback={{
            subResults: q.subQuestions.map((sq, si) => {
              const given = (q.yourAnswer.subAnswers || []).find((a) => a.index === si)?.selectedOption;
              return { index: si, correctOption: sq.correctOption, isCorrect: given === sq.correctOption };
            }),
          }}
        />
      )}

      {q.type === "written" && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, bgcolor: "action.hover" }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>Your answer</Typography>
            <Typography variant="body2">
              {q.yourAnswer.answerText || (q.yourAnswer.answerImages?.length ? "" : "(nothing written)")}
            </Typography>
            {q.yourAnswer.answerImages?.length > 0 && (
              <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mt: 1 }}>
                {q.yourAnswer.answerImages.map((src) => (
                  <ZoomableImage key={src} src={src} sx={{ width: 96, height: 96, objectFit: "cover", borderRadius: 1 }} />
                ))}
              </Box>
            )}
          </Paper>

          {q.note ? (
            <Alert severity="info" sx={{ fontSize: 13 }}>{q.note}</Alert>
          ) : (
            <Paper
              variant="outlined"
              sx={{
                p: 2, borderRadius: 2,
                borderColor: q.isCorrect ? "success.main" : "error.main",
                bgcolor: q.isCorrect ? theme.palette.correctBg : theme.palette.incorrectBg,
              }}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                <Sparkles size={15} color={theme.palette.ai?.main} />
                <Typography sx={{ fontWeight: 500, fontSize: 14 }}>{q.marksAwarded}/{q.marks} marks</Typography>
              </Box>
              {q.aiReasoning && <Latex as="div" style={{ fontSize: 13.5 }}>{q.aiReasoning}</Latex>}
            </Paper>
          )}

          {q.modelAnswer && (
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>Model answer</Typography>
              <Latex as="div" style={{ fontSize: 13.5 }}>{q.modelAnswer}</Latex>
            </Paper>
          )}
        </Box>
      )}

      {(q.solutionText || q.solutionImage?.url || q.solutionVideo?.url || q.solutionAttachments?.length > 0) && (
        <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, mt: 1.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>Explanation</Typography>
          {q.solutionText && (
            <Latex as="div" style={{ fontSize: 13.5 }}>{q.solutionText}</Latex>
          )}
          {q.solutionImage?.url && (
            <ZoomableImage src={q.solutionImage.url} sx={{ maxWidth: "100%", borderRadius: 1, mt: 1 }} />
          )}
          <SolutionVideo video={q.solutionVideo} questionId={q._id} />
          <AttachmentList attachments={q.solutionAttachments} sx={{ mt: 1 }} />
        </Paper>
      )}
    </Paper>
  );
}

// A score counting up from 0 (to its decimals when it has them).
function CountUp({ value }) {
  const shown = useCountUp(Number(value) || 0);
  const decimals = Number.isInteger(Number(value)) ? 0 : 1;
  return shown.toFixed(decimals);
}
