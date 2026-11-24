import { useState } from "react";
import SolutionVideo from "../../components/SolutionVideo";
import { Box, Typography, Paper, Chip, Skeleton, IconButton, Button, TextField, Alert, Snackbar } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Share2, Check, X, Minus, Hourglass, PenLine, Clock, Ban, MessageSquareWarning, MessageCircle, Sparkles, ThumbsUp, TrendingUp, Lightbulb } from "lucide-react";
import { useGetSubmissionQuery, useRequestExamReviewMutation } from "../../api/contentApi";
import EmptyState from "../../components/EmptyState";
import Latex from "../../components/Latex";
import ZoomableImage from "../../components/ZoomableImage";
import AttachmentList from "../../components/AttachmentList";
import { useTerms, useBranding, useHomeMx } from "../../BrandingContext";
import { RESTRAINED_DESIGNS, getBoldFill } from "../../theme/buildTheme";
import Confetti from "../../components/Confetti";
import { MascotOnce } from "../../components/Mascot";
import { useCountUp, growX } from "../../motion";
import { shareOrCopy, siteLink } from "../../utils/share";

// The score counts up to its value; a hook, so kept in its own component
// (the page returns early while loading).
function CountUp({ value, decimals = 0 }) {
  const shown = useCountUp(value);
  return <>{Number(shown).toFixed(Number.isInteger(value) ? 0 : decimals || 1)}</>;
}

// Every non-graded state gets its own icon, tone and next step. Lumping
// them under one "Not scored yet" heading hid the difference between "wait
// a minute" and "this will never have a score" — which is exactly the thing
// a student is opening the page to find out.
const STATUS_META = {
  in_progress: {
    icon: PenLine,
    tone: "waiting",
    title: "This attempt is still open",
    description: "You have not submitted yet. Pick up where you left off before the timer runs out.",
    resume: true,
  },
  submitted: {
    icon: Hourglass,
    tone: "waiting",
    title: "Scoring in progress",
    description: "Your answers are in. The score usually lands within a few minutes.",
  },
  grading: {
    icon: Clock,
    tone: "waiting",
    title: "With a grader",
    description: "A written answer on this paper is being marked by hand. You will see the full result once it is done.",
  },
  rejected: {
    icon: Ban,
    tone: "blocked",
    title: "Submitted too late",
    description: "This arrived after the time allowed, so it was not scored. Any remaining attempt is still yours to use.",
  },
  abandoned: {
    icon: Ban,
    tone: "blocked",
    title: "Attempt ran out of time",
    description: "This one was never submitted, so there is nothing to score.",
  },
  disqualified: {
    icon: Ban,
    tone: "blocked",
    title: "Attempt disqualified",
    description: "This attempt was disqualified and is not eligible for a score.",
  },
};

export default function ExamResult() {
  const terms = useTerms();
  const mx = useHomeMx();
  const { id } = useParams();
  const navigate = useNavigate();
  const [reportPoll, setReportPoll] = useState(true);
  const { data, isLoading } = useGetSubmissionQuery(id, {
    // A report written in the background (Pro) is checked for every few
    // seconds while the page is open.
    pollingInterval: reportPoll ? REPORT_POLL_MS : 0,
  });
  if (reportPoll && data && !data.performanceReportPending) setReportPoll(false);
  const { design, siteName } = useBranding();
  // "Copied" when there's no share sheet to open (most desktops).
  const [shareNote, setShareNote] = useState("");
  const editorial = RESTRAINED_DESIGNS.has(design);
  const theme = useTheme();
  const fill = !editorial ? getBoldFill(design, theme) : null;

  if (isLoading || !data) {
    return <Box sx={{ p: 3 }}><Skeleton variant="rounded" height={200} /></Box>;
  }

  // An exam sat on paper at the centre: the mark staff entered, and its
  // per-question marks and remark when given.
  if (data.offline) {
    const back = () => navigate("/results");
    const passed = data.passMarks != null && data.marks != null ? data.marks >= data.passMarks : null;
    return (
      <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 700, mx }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
          <IconButton size="small" onClick={back}><ArrowLeft size={18} /></IconButton>
          <Typography variant="body2" color="text.secondary" noWrap sx={{ flex: 1 }}>{data.examTitle}</Typography>
          <Chip size="small" label="Offline" variant="outlined" />
        </Box>
        <Paper variant="outlined" sx={{ p: 3, borderRadius: 3, textAlign: "center" }}>
          <Typography variant="body2" color="text.secondary">
            Sat on paper{data.date ? ` · ${new Date(data.date).toLocaleDateString()}` : ""}
          </Typography>
          {data.absent ? (
            <Typography variant="h5" sx={{ mt: 1, fontWeight: 600 }}>Absent</Typography>
          ) : (
            <>
              <Typography variant="h3" sx={{ mt: 1, fontWeight: 700 }}>{data.marks}<Typography component="span" variant="h5" color="text.secondary">/{data.totalMarks}</Typography></Typography>
              <Typography color="text.secondary">{Math.round((data.marks / (data.totalMarks || 1)) * 100)}%</Typography>
              {passed !== null && <Chip sx={{ mt: 1.5 }} color={passed ? "success" : "error"} label={passed ? "Passed" : `Below the pass mark (${data.passMarks})`} />}
            </>
          )}
        </Paper>
        {!data.absent && data.parts?.length > 0 && (
          <Paper variant="outlined" sx={{ mt: 2, borderRadius: 3, overflow: "hidden" }}>
            {data.parts.map((p, i) => (
              <Box key={i} sx={{ display: "flex", justifyContent: "space-between", px: 2, py: 1.25, borderTop: i ? 1 : 0, borderColor: "divider" }}>
                <Typography variant="body2">{p.label}</Typography>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>{p.marks}{p.max != null ? `/${p.max}` : ""}</Typography>
              </Box>
            ))}
          </Paper>
        )}
        {data.remark && (
          <Paper variant="outlined" sx={{ mt: 2, p: 2, borderRadius: 3 }}>
            <Typography variant="caption" color="text.secondary">Teacher's remark</Typography>
            <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: "pre-wrap" }}>{data.remark}</Typography>
          </Paper>
        )}
      </Box>
    );
  }

  // A referral being re-checked parks the submission back at "grading" —
  // regradeInProgress is how the server tells this apart from a submission
  // that was never graded at all, so the full answer review still renders
  // below instead of falling back to the bare "with a grader" stub.
  if (data.status !== "graded" && !data.regradeInProgress) {
    const meta = STATUS_META[data.status] || {
      icon: Hourglass,
      tone: "waiting",
      title: "Not scored yet",
      description: "This attempt has no result to show right now.",
    };
    // The reason is set by the grader, not baked into the static copy above
    // — appended when there is one rather than given its own STATUS_META
    // variant.
    const description = data.status === "disqualified" && data.reason
      ? `${meta.description} Reason given: "${data.reason}"`
      : data.awayEnded ? data.message : meta.description;

    return (
      <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 700, mx }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
          <IconButton size="small" onClick={() => navigate(`/batches/${data.batch}/exams`)}>
            <ArrowLeft size={18} />
          </IconButton>
          <Typography variant="body2" color="text.secondary" noWrap>
            {data.examTitle || "Attempt"}
            {data.attempt ? ` · attempt ${data.attempt}` : ""}
          </Typography>
        </Box>
        <EmptyState
          icon={meta.icon}
          tone={meta.tone}
          title={data.awayEnded ? "Ended: away from the exam too long" : meta.title}
          description={description}
          action={
            meta.resume && data.exam
              ? { label: "Resume attempt", onClick: () => navigate(`/batches/${data.batch}/exams/${data.exam}`) }
              : undefined
          }
          secondaryAction={{ label: "Back to exams", onClick: () => navigate(`/batches/${data.batch}/exams`) }}
        />
      </Box>
    );
  }

  // While a regrade is in progress the total is not a real number — see
  // getSubmission, which sends marks: null for exactly this reason. The
  // score card and tally below are both skipped in favour of a plain notice.
  const pct = !data.regradeInProgress && data.totalMarks > 0
    ? Math.round((data.marks / data.totalMarks) * 100) : 0;

  // The score alone says how well it went; the breakdown says where it went.
  // "62%" and "18 right, 9 wrong, 3 skipped" answer different questions, and
  // the second is the one a student acts on. Graded here rather than on the
  // server so it stays in step with AnswerReview's own verdict below — two
  // places computing correctness differently is how a result page ends up
  // contradicting itself.
  const tally = data.regradeInProgress ? null : data.answers.reduce(
    (acc, a) => {
      const verdict = gradeAnswer(a);
      if (verdict === null) acc.skipped += 1;
      else if (verdict === true) acc.correct += 1;
      else if (verdict === "partial") acc.partial += 1;
      else if (verdict === "attempted") acc.attempted += 1;
      else acc.wrong += 1;
      return acc;
    },
    { correct: 0, wrong: 0, partial: 0, skipped: 0, attempted: 0 }
  );

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 700, mx }}>
      {!data.regradeInProgress && data.totalMarks > 0 && pct >= 80 && <MascotOnce mood="great" say={`${pct}%! Amazing!`} />}
      {!data.regradeInProgress && data.totalMarks > 0 && pct < 50 && <MascotOnce mood="comfort" say="Next one's yours!" />}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 3 }}>
        <IconButton size="small" onClick={() => navigate(`/batches/${data.batch}/exams`)}><ArrowLeft size={18} /></IconButton>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>{data.examTitle}</Typography>
        {!data.regradeInProgress && data.totalMarks > 0 && (
          <IconButton
            size="small"
            aria-label="Share result"
            onClick={async () => {
              const where = siteName ? ` on ${siteName}` : "";
              const out = await shareOrCopy({
                title: data.examTitle,
                // Link inside the text: some share sheets keep only a separate url.
                text: `I scored ${Number(data.marks) || 0}/${data.totalMarks} (${pct}%) in ${data.examTitle}${where}. ${siteLink()}`,
              });
              if (out === "copied") setShareNote("Copied. Paste it anywhere to share.");
              else if (out === "failed") setShareNote("Couldn't share from this browser.");
            }}
          >
            <Share2 size={18} />
          </IconButton>
        )}
      </Box>
      <Snackbar open={Boolean(shareNote)} autoHideDuration={3000} onClose={() => setShareNote("")} message={shareNote} />
      {data.awayNote && <Alert severity="warning" sx={{ mb: 3 }}>{data.awayNote}</Alert>}
      {/* A strong result gets a moment of celebration, once. */}
      {!data.regradeInProgress && pct >= 80 && <Confetti onceKey={id} />}

      {data.regradeInProgress ? (
        <Alert severity="info" sx={{ mb: 3 }}>
          Your marks are being updated — one or more answers below are being re-checked. Everything
          else here is unchanged. This score card will come back once the re-check is done.
        </Alert>
      ) : (
        <Paper
          variant="outlined"
          sx={editorial ? {
            p: 3, mb: 3, borderRadius: 0, borderTop: 3, borderTopColor: "primary.main",
          } : {
            p: 3, borderRadius: fill.borderRadius ?? 3, mb: 3,
            background: fill.background, color: fill.color,
            ...(fill.border ? { border: fill.border, boxShadow: fill.boxShadow } : {}),
          }}
        >
          <Typography variant="caption" sx={{ opacity: editorial ? 1 : 0.85, color: editorial ? "text.secondary" : "inherit" }}>
            Your score
          </Typography>
          <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, mt: 0.5 }}>
            <Typography variant="h3" sx={{ fontWeight: editorial ? 400 : 500, color: editorial ? "primary.main" : "inherit" }}>
              <CountUp value={Number(data.marks) || 0} />
            </Typography>
            <Typography variant="h6" sx={{ opacity: editorial ? 1 : 0.85, color: editorial ? "text.secondary" : "inherit" }}>
              / {data.totalMarks}
            </Typography>
            <Chip
              size="small"
              label={<><CountUp value={pct} />%</>}
              sx={editorial
                ? { ml: "auto" }
                : { ml: "auto", bgcolor: "rgba(255,255,255,0.18)", color: "inherit" }}
            />
          </Box>

          {/* A bar rather than a number alone: a percentage is a fact, a filled
              bar is a position, and a student reads how close they came to full
              marks far faster from the second. */}
          <Box
            sx={{
              height: 6, borderRadius: 3, mt: 2, overflow: "hidden",
              bgcolor: editorial ? "action.hover" : "rgba(255,255,255,0.22)",
            }}
          >
            <Box
              sx={{
                width: `${pct}%`, height: "100%",
                bgcolor: editorial ? "primary.main" : "rgba(255,255,255,0.9)",
                transformOrigin: "left",
                animation: `${growX} 900ms cubic-bezier(.2,.7,.3,1)`,
              }}
            />
          </Box>

          <Box sx={{ display: "flex", gap: 2.5, mt: 2, flexWrap: "wrap" }}>
            <Tally label="correct" value={tally.correct} editorial={editorial} tone="success" />
            <Tally label="wrong" value={tally.wrong} editorial={editorial} tone="error" />
            {tally.partial > 0 && (
              <Tally label="part marks" value={tally.partial} editorial={editorial} tone="warning" />
            )}
            {tally.attempted > 0 && (
              <Tally label="answered" value={tally.attempted} editorial={editorial} tone="muted" />
            )}
            {tally.skipped > 0 && (
              <Tally label="skipped" value={tally.skipped} editorial={editorial} tone="muted" />
            )}
          </Box>
        </Paper>
      )}

      {!data.regradeInProgress && data.performanceReport && (
        <PerformanceReportCard report={data.performanceReport} />
      )}
      {!data.regradeInProgress && !data.performanceReport && data.performanceReportPending && (
        <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 3, mb: 3, display: "flex", alignItems: "center", gap: 1.5 }}>
          <Sparkles size={18} />
          <Typography variant="body2" color="text.secondary">Writing your AI report on this exam. It appears here in a moment.</Typography>
        </Paper>
      )}

      <ExamReferral data={data} />

      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>Review</Typography>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
        {data.answers.map((a, i) => (
          <AnswerReview key={i} index={i} answer={a} />
        ))}
      </Box>
    </Box>
  );
}

// A marked written or passage answer, by its marks: full marks true, none
// false, anything between "partial"; not marked yet "attempted".
function byMarks(answer, outOf) {
  const got = answer.marksAwarded;
  if (got === null || got === undefined) return "attempted";
  if (got <= 0) return false;
  return outOf > 0 && got >= outOf ? true : "partial";
}

// One verdict function, used by both the summary tally and each review card.
// null means "no verdict available" — an unattempted question, or a written
// answer that was left blank. Written and passage answers go by the marks
// given (byMarks); before marking they're "attempted", counted on their own.
function gradeAnswer(answer) {
  const question = answer?.question;
  if (!question) return null;

  if (question.type === "mcq") {
    if (answer.selectedOption === undefined || answer.selectedOption === null) return null;
    return answer.selectedOption === question.correctOption;
  }

  if (question.type === "mtf") {
    if (!(answer.statementAnswers || []).length) return null;
    return answer.statementAnswers.length === question.statements.length
      && answer.statementAnswers.every((s) => question.statements[s.index]?.isTrue === s.value);
  }

  // Written answers are marked by a person or AI: judged by their marks.
  // null only for genuinely empty written answers.
  const hasWrittenContent =
    answer.answerText ||
    (answer.answerImages && answer.answerImages.length > 0) ||
    answer.annotatedImage;
  if (question.type === "written") return hasWrittenContent ? byMarks(answer, question.marks) : null;
  if (question.type === "coding") return answer.answerText?.trim() ? byMarks(answer, question.marks) : null;

  // A passage bundles several sub-questions: all right is correct, none
  // right is wrong, anything between is "partial". AnswerReview still shows
  // each sub-question's own answer.
  if (question.type === "passage") {
    const subs = (question.subQuestions || []).map((sq, si) => ({ ...sq, si })).filter((sq) => sq.type !== "written");
    const responses = answer.subAnswers || [];
    if (!responses.length || !subs.length) return null;
    const right = subs.filter((sq) => responses.find((r) => r.index === sq.si)?.selectedOption === sq.correctOption).length;
    if (right === subs.length) return true;
    return right > 0 ? "partial" : false;
  }

  return null;
}

function Tally({ label, value, editorial, tone }) {
  const color = editorial
    ? { success: "success.main", error: "error.main", warning: "warning.main", muted: "text.secondary" }[tone]
    : "inherit";

  return (
    <Box sx={{ display: "flex", alignItems: "baseline", gap: 0.75 }}>
      <Typography sx={{ fontSize: 17, fontWeight: 500, color }}>{value}</Typography>
      <Typography
        variant="caption"
        sx={{ color: editorial ? "text.secondary" : "inherit", opacity: editorial ? 1 : 0.85 }}
      >
        {label}
      </Typography>
    </Box>
  );
}

// Auto-generated once this submission was graded (see backend's
// utils/examReport.js) — a short AI note grounded in this exam's own
// per-topic accuracy, not a generic "good job". Absent entirely on an
// older submission, one from a batch without AI assist on, or one with
// nothing topic-classified to report on — the caller above already treats
// that as "nothing to render", not a loading or error state.
const REPORT_POLL_MS = 4000;

function PerformanceReportCard({ report }) {
  return (
    <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 3, mb: 3 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
        <Sparkles size={16} color="var(--ai, #7c4dff)" />
        <Typography variant="subtitle2">AI insights</Typography>
      </Box>

      <Typography variant="body2" sx={{ mb: report.strengths?.length || report.weaknesses?.length ? 1.5 : 0 }}>
        {report.summary}
      </Typography>

      {(report.strengths?.length > 0 || report.weaknesses?.length > 0) && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mb: report.recommendation ? 1.5 : 0 }}>
          {report.strengths?.map((s, i) => (
            <Box key={`s${i}`} sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
              <ThumbsUp size={14} color="var(--mui-palette-success-main, #2e7d32)" style={{ marginTop: 2, flexShrink: 0 }} />
              <Typography variant="body2">{s}</Typography>
            </Box>
          ))}
          {report.weaknesses?.map((w, i) => (
            <Box key={`w${i}`} sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
              <TrendingUp size={14} color="var(--mui-palette-warning-main, #ed6c02)" style={{ marginTop: 2, flexShrink: 0 }} />
              <Typography variant="body2">{w}</Typography>
            </Box>
          ))}
        </Box>
      )}

      {report.recommendation && (
        <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1, pt: 1.5, borderTop: "1px solid", borderColor: "divider" }}>
          <Lightbulb size={14} color="var(--mui-palette-info-main, #0288d1)" style={{ marginTop: 2, flexShrink: 0 }} />
          <Typography variant="body2">{report.recommendation}</Typography>
        </Box>
      )}
    </Paper>
  );
}

function AnswerReview({ index, answer }) {
  const terms = useTerms();
  const { question } = answer;
  if (!question) return null;

  // A mark/correctness verdict for an answer currently under review would
  // be stale or outright wrong — its mark is null right now precisely
  // because it's being re-checked (see getSubmission's underReview flag).
  const verdict = answer.underReview ? null : gradeAnswer(answer);
  // "attempted" (not marked yet) shows no mark.
  const correct = verdict === "attempted" ? null : verdict;
  const tone = correct === true ? "success.main" : correct === "partial" ? "warning.main" : "error.main";

  return (
    <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 3, borderColor: answer.underReview ? "warning.main" : "divider" }}>
      <Box sx={{ display: "flex", gap: 1.5, mb: 1.5 }}>
        {correct !== null && (
          <Box sx={{
            width: 22, height: 22, borderRadius: "50%", flexShrink: 0, mt: 0.2,
            bgcolor: tone, color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {correct === true ? <Check size={13} /> : correct === "partial" ? <Minus size={13} /> : <X size={13} />}
          </Box>
        )}
        <Box sx={{ flex: 1 }}>
          {question.questionImage?.url && !question.partQuestion && (
            <ZoomableImage src={question.questionImage.url} sx={{ maxWidth: "100%", borderRadius: 1, mb: 1 }} />
          )}
          {/* A passage's written question follows its passage: just the part. */}
          <Latex as="div">{question.partQuestion ? `(${question.partLabel}) ${question.partQuestion}` : question.question}</Latex>
        </Box>
        {answer.underReview ? (
          <Chip size="small" color="warning" label="Being re-checked" sx={{ flexShrink: 0 }} />
        ) : (
          <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
            {answer.marksAwarded ?? "–"}/{question.marks}
          </Typography>
        )}
      </Box>

      {question.type === "mcq" && (
        <Box sx={{ pl: 4.5, display: "flex", flexDirection: "column", gap: 0.75 }}>
          {question.options.map((opt) => (
            <Box
              key={opt.key}
              sx={{
                color: opt.key === question.correctOption ? "success.main"
                  : opt.key === answer.selectedOption ? "error.main" : "text.primary",
              }}
            >
              {opt.image?.url && (
                <ZoomableImage
                  src={opt.image.url}
                  sx={{ display: "block", maxWidth: "100%", maxHeight: 160, borderRadius: 1, mb: 0.5 }}
                />
              )}
              <Typography
                variant="body2"
                sx={{ fontWeight: opt.key === question.correctOption ? 500 : 400 }}
              >
                {opt.key}. {opt.text && <Latex>{opt.text}</Latex>}
                {opt.key === answer.selectedOption && opt.key !== question.correctOption && " (your answer)"}
              </Typography>
            </Box>
          ))}
        </Box>
      )}

      {question.type === "passage" && (
        <Box sx={{ pl: 4.5, display: "flex", flexDirection: "column", gap: 2 }}>
          {question.subQuestions.map((sq, si) => {
            // A written question under it is marked as its own answer.
            if (sq.type === "written") return null;
            const response = (answer.subAnswers || []).find((sa) => sa.index === si);
            return (
              <Box key={si}>
                <Box sx={{ display: "flex", gap: 1, mb: 0.5 }}>
                  {sq.questionImage?.url && (
                    <ZoomableImage src={sq.questionImage.url} sx={{ maxWidth: "100%", borderRadius: 1, mb: 1 }} />
                  )}
                  <Latex as="div" style={{ fontSize: 14 }}>{sq.question}</Latex>
                </Box>
                <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
                  {sq.options.map((opt) => (
                    <Box
                      key={opt.key}
                      sx={{
                        color: opt.key === sq.correctOption ? "success.main"
                          : opt.key === response?.selectedOption ? "error.main" : "text.primary",
                      }}
                    >
                      {opt.image?.url && (
                        <ZoomableImage
                          src={opt.image.url}
                          sx={{ display: "block", maxWidth: "100%", maxHeight: 160, borderRadius: 1, mb: 0.5 }}
                        />
                      )}
                      <Typography
                        variant="body2"
                        sx={{ fontWeight: opt.key === sq.correctOption ? 500 : 400 }}
                      >
                        {opt.key}. {opt.text && <Latex>{opt.text}</Latex>}
                        {opt.key === response?.selectedOption && opt.key !== sq.correctOption && " (your answer)"}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              </Box>
            );
          })}
        </Box>
      )}

      {question.type === "coding" && answer.answerText && (
        <Box sx={{ pl: 4.5, display: "flex", flexDirection: "column", gap: 0.75 }}>
          {answer.codeResult && (
            <Typography variant="body2" fontWeight={600}>
              {answer.codeResult.passed} of {answer.codeResult.total} tests passed{answer.selectedOption ? ` · ${answer.selectedOption}` : ""}
            </Typography>
          )}
          <Box component="pre" sx={{ m: 0, p: 1.25, borderRadius: 2, bgcolor: "action.hover", fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: 12.5, overflowX: "auto" }}>
            {answer.answerText}
          </Box>
        </Box>
      )}

      {question.type === "written" && (answer.answerText || answer.answerImages?.length > 0 || answer.annotatedImage) && (
        <Box sx={{ pl: 4.5 }}>
          {answer.annotatedImage ? (
            <ZoomableImage
              badge
              src={answer.annotatedImage}
              alt="Your marked answer script"
              sx={{ maxWidth: "100%", borderRadius: 2, border: "1px solid", borderColor: "divider" }}
            />
          ) : (
            <>
              {answer.answerText && (
                <Typography component="div" variant="body2" color="text.secondary" sx={{ whiteSpace: "pre-wrap" }}>
                  <Latex as="div">{answer.answerText}</Latex>
                </Typography>
              )}
              {answer.answerImages?.length > 0 && (
                <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mt: answer.answerText ? 1 : 0 }}>
                  {answer.answerImages.map((url, i) => (
                    <ZoomableImage key={i} badge src={url} sx={{ height: 100, borderRadius: 1.5, border: "1px solid", borderColor: "divider" }} />
                  ))}
                </Box>
              )}
            </>
          )}
        </Box>
      )}

      {answer.teacherComment && (
        <Box
          sx={{
            pl: 4.5, mt: 1.5, pt: 1.5, borderTop: "1px solid", borderColor: "divider",
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 0.5 }}>
            <MessageCircle size={14} color="var(--mui-palette-info-main, #0288d1)" />
            <Typography variant="caption" sx={{ fontWeight: 600, color: "info.main" }}>
              Note from your {terms.teacher}
            </Typography>
          </Box>
          <Typography variant="body2">{answer.teacherComment}</Typography>
        </Box>
      )}

      {(question.solutionText || question.solutionImage?.url || question.solutionVideo?.url || question.solutionAttachments?.length > 0) && (
        <Box sx={{ pl: 4.5, mt: 1.5, pt: 1.5, borderTop: "1px solid", borderColor: "divider" }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>Solution</Typography>
          {question.solutionText && (
            <Latex as="div" style={{ fontSize: 13.5 }}>{question.solutionText}</Latex>
          )}
          {question.solutionImage?.url && (
            <ZoomableImage src={question.solutionImage.url} sx={{ maxWidth: "100%", borderRadius: 1, mt: 1 }} />
          )}
          <SolutionVideo video={question.solutionVideo} questionId={question._id} />
          <AttachmentList attachments={question.solutionAttachments} sx={{ mt: 1 }} />
        </Box>
      )}
    </Paper>
  );
}

// Exam referral — a student can request one review per graded exam, naming
// specific questions they think were marked incorrectly. Follows the same
// "one review, ever" pattern as doubt reviews (see Doubt's review sub-doc and
// the ReviewSection in DoubtThread.jsx). The referral object returned by the
// server tells us whether a request has been made and, if so, its state.
function ExamReferral({ data }) {
  const submissionId = data._id;
  const referral = data.referral;
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [reason, setReason] = useState("");
  const [requestReview, { isLoading, error }] = useRequestExamReviewMutation();

  const toggleQuestion = (index) => {
    const next = new Set(selected);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    setSelected(next);
  };

  const handleSubmit = async () => {
    const questionIds = Array.from(selected).map((i) => data.answers[i].question?._id).filter(Boolean);
    if (questionIds.length === 0) return;

    try {
      await requestReview({
        submissionId,
        reason: reason.trim(),
        questionIds,
      }).unwrap();
      setReason("");
      setSelected(new Set());
      setOpen(false);
    } catch (err) {
      // error is shown below via the `error` object
    }
  };

  const canRefer = data.status === "graded" && !referral;

  if (!canRefer) {
    if (referral) {
      return (
        <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 3, mb: 3 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
            <Hourglass size={16} color="var(--warning)" />
            <Typography variant="subtitle2">Review request submitted</Typography>
          </Box>
          {referral.decision === "approved" ? (
            data.regradeInProgress ? (
              <Alert severity="info" sx={{ mt: 1 }}>
                Approved — your flagged answer(s) are currently being re-checked. Updated marks will
                appear here once it's done.
              </Alert>
            ) : (
              <Alert severity="success" sx={{ mt: 1 }}>
                Approved. The teacher has re-checked your answers and updated the marks{data.referral?.regradeNote && (
                  <>
                    {" "}— their note: <i>"<Latex>{data.referral.regradeNote}</Latex>"</i>
                  </>
                )}
                . You can request a maximum of one review for this exam.
              </Alert>
            )
          ) : referral.decision === "rejected" ? (
            <Alert severity="info" sx={{ mt: 1 }}>
              Your referral request was reviewed and not approved. The marks stand as originally awarded. You can request a maximum of one review for this exam.
            </Alert>
          ) : (
            <Typography variant="body2" color="text.secondary">
              Your referral request is pending an admin decision. You'll be notified once it's resolved. You can request a maximum of one review for this exam.
            </Typography>
          )}
        </Paper>
      );
    }
    return null;
  }

  return (
    <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 3, mb: 3 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
        <MessageSquareWarning size={16} color="var(--warning)" />
        <Typography variant="subtitle2">Request a re-grade</Typography>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Think a question was marked wrong? Select the questions below and tell us what to look at. You can request a maximum of one review for this exam.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 1.5 }}>{error.data?.message || "Could not submit this."}</Alert>
      )}

      {!open ? (
        <Button
          variant="outlined"
          size="small"
          startIcon={<MessageSquareWarning size={15} />}
          onClick={() => setOpen(true)}
        >
          Request review
        </Button>
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          <Typography variant="caption" color="text.secondary">
            Click the questions you want re-checked:
          </Typography>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
            {data.answers.map((a, i) => (
              <Button
                key={i}
                variant={selected.has(i) ? "contained" : "outlined"}
                size="small"
                sx={{ justifyContent: "flex-start", textAlign: "left" }}
                onClick={() => toggleQuestion(i)}
              >
                <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 500, flexShrink: 0 }}>
                    Q{i + 1}
                  </Typography>
                  {/* Whole question with its maths rendered, clamped to two
                      lines — slicing the raw text cut through $...$. */}
                  <Typography
                    component="div"
                    variant="body2"
                    color="text.secondary"
                    sx={{ minWidth: 0, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}
                  >
                    {a.question?.question ? <Latex>{a.question.question}</Latex> : "…"}
                  </Typography>
                </Box>
              </Button>
            ))}
          </Box>

          <TextField
            multiline
            minRows={3}
            label="What should the teacher look at?"
            placeholder="e.g. I think option B should also be acceptable for Q2..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            size="small"
            fullWidth
          />

          <Box sx={{ display: "flex", gap: 1 }}>
            <Button
              variant="contained"
              size="small"
              disabled={selected.size === 0 || !reason.trim() || isLoading}
              onClick={handleSubmit}
            >
              {isLoading ? "Sending…" : "Send request"}
            </Button>
            <Button variant="text" size="small" onClick={() => { setOpen(false); setSelected(new Set()); setReason(""); }}>
              Cancel
            </Button>
          </Box>
        </Box>
      )}
    </Paper>
  );
}
