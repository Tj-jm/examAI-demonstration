import { useState } from "react";
import {
  Box, Typography, Paper, Button, IconButton, Chip, Skeleton, CircularProgress, Alert, TextField,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Sparkles, User, Clock, Check, RotateCcw, MessageSquareWarning, Lock } from "lucide-react";
import {
  useGetDoubtQuery, useRegenerateDoubtMutation, useEscalateDoubtMutation, useRequestDoubtReviewMutation,
  useGetDoubtQuotaQuery,
} from "../../api/contentApi";
import SafeMarkdown from "../../components/SafeMarkdown";
import AiUsageMeter from "../../components/AiUsageMeter";
import EmptyState from "../../components/EmptyState";
import DoubtQuotaMeter from "./DoubtQuotaMeter";
import { useSales, useTerms, useHomeMx } from "../../BrandingContext";

// Answers are Markdown (AI ones nearly always use bold and lists) with maths,
// so they go through the lecture renderer; margins trimmed to sit in a card.
const MD_SX = { "& > :first-child": { mt: 0 }, "& > :last-child": { mb: 0 }, "& p, & ul, & ol": { my: 0.75 } };

// createDoubt is synchronous on the backend — by the time any response
// reaches the browser, an "ai" mode attempt has already either succeeded
// (status: answered) or failed (status stays pending). There's no "still
// working" state to distinguish from here, so pending is always shown as
// "couldn't get an answer, try again or ask a human" rather than a spinner
// waiting for something that already finished one way or the other.
export default function DoubtThread() {
  const mx = useHomeMx();
  const sales = useSales();
  const terms = useTerms();
  const { batchId, id } = useParams();
  const navigate = useNavigate();
  const theme = useTheme();
  const { data, isLoading, error } = useGetDoubtQuery({ batchId, id });
  const [regenerate, { isLoading: regenerating }] = useRegenerateDoubtMutation();
  const [escalate, { isLoading: escalating }] = useEscalateDoubtMutation();
  const { data: quota } = useGetDoubtQuotaQuery(batchId);
  // limit === 0 is "no human capacity at all", not "no cap" — see
  // doubtLimits.weeklyHumanDoubts's own comment on the Batch model. Kept
  // separate from atWeeklyLimit (used up this week, but human support
  // does exist) so the button can say which one is actually true.
  const humanAvailable = quota ? quota.limit !== 0 : true;
  const atWeeklyLimit = humanAvailable && Boolean(quota?.limit) && quota.used >= quota.limit;
  const escalateDisabled = !humanAvailable || atWeeklyLimit;
  const [regenerateError, setRegenerateError] = useState(null);

  if (isLoading) return <Box sx={{ p: 3 }}><Skeleton variant="rounded" height={200} /></Box>;

  // `data` stays undefined on a failed request too, not just while loading —
  // this used to fall through to the same Skeleton forever in that case
  // (isLoading turns false, but the check above only ever looked at
  // `!data`), so a doubt that 404s, or a batch that had doubtSolving
  // switched off after this link was bookmarked/notified, showed a
  // permanent loading spinner with no way out. Doubt-Solving's own
  // requireFeature guard (see batchAccess.js) already writes a real message
  // for the second case ("That is not included in this batch.") — shown
  // here instead of invented.
  if (!data) {
    return (
      <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 600, mx }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
          <IconButton size="small" onClick={() => navigate(`/batches/${batchId}/doubts`)}><ArrowLeft size={18} /></IconButton>
        </Box>
        <EmptyState
          icon={Lock}
          tone="blocked"
          title="Can't open this doubt"
          description={error?.data?.message || "This doubt isn't available right now."}
        />
      </Box>
    );
  }

  const doubt = data.doubt;
  const stillWithAi = doubt.mode === "ai" && ["pending", "answered"].includes(doubt.status);

  const tryRegenerate = async () => {
    setRegenerateError(null);
    try {
      await regenerate({ batchId, id }).unwrap();
    } catch (error) {
      setRegenerateError({ message: error.data?.message || "Could not try again right now.", capReached: error.status === 429 });
    }
  };

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 600, mx }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 3 }}>
        <IconButton size="small" onClick={() => navigate(`/batches/${batchId}/doubts`)}><ArrowLeft size={18} /></IconButton>
        <Typography variant="h6" sx={{ fontWeight: 500, fontSize: 17 }}>Doubt</Typography>
      </Box>

      <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 3, mb: 2 }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>You asked</Typography>
        <Typography sx={{ whiteSpace: "pre-wrap" }}>{doubt.question}</Typography>
        {doubt.questionImage && (
          <Box component="img" src={doubt.questionImage} sx={{ maxWidth: "100%", borderRadius: 2, mt: 1.5, display: "block" }} />
        )}
      </Paper>

      {doubt.status === "pending" && (
        <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 3, mb: 2, bgcolor: theme.palette.warningBg, borderColor: "warning.main" }}>
          <Typography sx={{ fontWeight: 500, mb: 0.5 }}>Couldn't get an AI answer</Typography>
          <Typography variant="body2" color="text.secondary">Try again, or send this straight to a person instead.</Typography>
        </Paper>
      )}

      {doubt.aiAnswer && (
        <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 3, mb: 2, bgcolor: "ai.bg", borderColor: "ai.main" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
            <Sparkles size={16} color={theme.palette.ai.main} />
            <Typography sx={{ fontWeight: 500, color: "ai.main" }}>AI</Typography>
            {doubt.status === "escalated" && (
              <Chip size="small" label="Not satisfied — sent to a human" sx={{ ml: "auto" }} />
            )}
          </Box>
          <Box sx={MD_SX}><SafeMarkdown>{doubt.aiAnswer}</SafeMarkdown></Box>
        </Paper>
      )}

      {doubt.status === "escalated" && (
        <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 3, mb: 2, display: "flex", alignItems: "center", gap: 1.5 }}>
          {doubt.review?.decision === "approved" ? <RotateCcw size={18} /> : <Clock size={18} />}
          <Box>
            <Typography sx={{ fontWeight: 500, fontSize: 14 }}>
              {doubt.review?.decision === "approved" ? "Your review was approved" : "Waiting for a doubt solver"}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {doubt.review?.decision === "approved"
                ? "The same solver is updating the answer — you'll see it here once it's ready."
                : "You'll see their answer here once it's ready."}
            </Typography>
          </Box>
        </Paper>
      )}

      {doubt.status === "resolved" && (
        <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 3, mb: 2, bgcolor: theme.palette.correctBg, borderColor: "success.main" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
            <User size={16} color={theme.palette.success.main} />
            <Typography sx={{ fontWeight: 500 }}>Answered</Typography>
            {doubt.review?.decision === "approved" && (
              <Chip size="small" icon={<RotateCcw size={12} />} label="Updated after your review" sx={{ ml: "auto" }} />
            )}
            {!doubt.review?.decision && <Check size={15} color={theme.palette.success.main} style={{ marginLeft: "auto" }} />}
          </Box>
          <Box sx={MD_SX}><SafeMarkdown>{doubt.humanAnswer}</SafeMarkdown></Box>
          {doubt.humanAnswerImage && (
            <Box component="img" src={doubt.humanAnswerImage} sx={{ maxWidth: "100%", borderRadius: 2, mt: 1.5, display: "block" }} />
          )}
        </Paper>
      )}

      {doubt.status === "resolved" && <ReviewSection batchId={batchId} id={id} doubt={doubt} />}

      {regenerateError && (
        <Alert severity="warning" sx={{ mb: 1.5 }}>
          {regenerateError.message}
          {sales && regenerateError.capReached && (
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
      )}

      {stillWithAi && (
        <Box sx={{ mb: 1.5 }}>
          <AiUsageMeter batchId={batchId} compact />
          <DoubtQuotaMeter batchId={batchId} compact />
          <Box sx={{ display: "flex", gap: 1.5 }}>
            <Button
              variant="outlined"
              fullWidth
              startIcon={regenerating ? <CircularProgress size={14} /> : <Sparkles size={16} />}
              disabled={regenerating || escalating}
              onClick={tryRegenerate}
            >
              {doubt.status === "pending" ? "Try again" : "Regenerate"}
            </Button>
            <Button
              variant="contained"
              fullWidth
              disabled={regenerating || escalating || escalateDisabled}
              onClick={() => escalate({ batchId, id })}
            >
              {escalating ? "Sending…" : !humanAvailable ? `Not available for this ${terms.batch}` : atWeeklyLimit ? "Weekly limit reached" : "Ask a human"}
            </Button>
          </Box>
        </Box>
      )}
    </Box>
  );
}

// One review per doubt, ever — win or lose. Shown only once the doubt is
// resolved, and never again once review.requested is true, regardless of
// what was decided: rejecting a request does not refund a second try, and
// showing the button again after that would imply otherwise.
function ReviewSection({ batchId, id, doubt }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [requestReview, { isLoading, error }] = useRequestDoubtReviewMutation();

  const review = doubt.review || {};

  if (review.requested) {
    return (
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, mb: 2, display: "flex", alignItems: "center", gap: 1.5 }}>
        <MessageSquareWarning size={17} style={{ opacity: 0.6, flexShrink: 0 }} />
        <Box>
          <Typography sx={{ fontWeight: 500, fontSize: 13.5 }}>
            {!review.decision && "Review requested — waiting on a decision"}
            {review.decision === "rejected" && "Your review request wasn't approved"}
            {review.decision === "approved" && "Your review was approved"}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {!review.decision && "An owner or admin will look at this shortly."}
            {review.decision === "rejected" && "This answer stays as it is — a doubt only gets one review."}
            {review.decision === "approved" && "See above — the solver is updating the answer."}
          </Typography>
        </Box>
      </Paper>
    );
  }

  if (!open) {
    return (
      <Button
        variant="text"
        size="small"
        startIcon={<MessageSquareWarning size={15} />}
        onClick={() => setOpen(true)}
        sx={{ mb: 2 }}
      >
        Not satisfied? Request a review
      </Button>
    );
  }

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, mb: 2 }}>
      <Typography sx={{ fontWeight: 500, fontSize: 14, mb: 0.5 }}>Request a review</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
        A doubt gets exactly one review, so say clearly what's wrong with the answer — an owner
        or admin decides whether to send it back to the solver.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 1.5 }}>{error.data?.message || "Could not send this."}</Alert>}

      <TextField
        multiline
        minRows={3}
        fullWidth
        placeholder="What's wrong with this answer?"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        sx={{ mb: 1.5 }}
      />

      <Box sx={{ display: "flex", gap: 1 }}>
        <Button
          variant="contained"
          size="small"
          disabled={!reason.trim() || isLoading}
          onClick={async () => {
            await requestReview({ batchId, id, reason }).unwrap();
          }}
        >
          {isLoading ? "Sending…" : "Send request"}
        </Button>
        <Button variant="text" size="small" onClick={() => setOpen(false)}>Cancel</Button>
      </Box>
    </Paper>
  );
}
