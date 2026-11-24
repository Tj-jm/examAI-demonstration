import { useEffect, useState } from "react";
import {
  Box, Typography, TextField, Button, IconButton, Paper, Alert, CircularProgress,
} from "@mui/material";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Sparkles, User, Paperclip, X } from "lucide-react";
import { useCreateDoubtMutation, useUploadDoubtImageMutation, useGetDoubtQuotaQuery, useGetBatchQuery } from "../../api/contentApi";
import AiUsageMeter from "../../components/AiUsageMeter";
import FeatureGate from "../../components/FeatureGate";
import DoubtQuotaMeter from "./DoubtQuotaMeter";
import { useTerms, useHomeMx } from "../../BrandingContext";

export default function DoubtAsk() {
  const mx = useHomeMx();
  const terms = useTerms();
  const { batchId } = useParams();
  const navigate = useNavigate();
  const [createDoubt, { isLoading, error }] = useCreateDoubtMutation();
  const [uploadImage, { isLoading: uploading }] = useUploadDoubtImageMutation();
  const { data: quota } = useGetDoubtQuotaQuery(batchId);
  const { data: batch } = useGetBatchQuery(batchId);
  // limit is null (unset) for unlimited, a positive number for a real weekly
  // cap, or exactly 0 for "this batch has no human doubt capacity at all" —
  // 0 is not "no cap", it's the opposite. See doubtLimits.weeklyHumanDoubts's
  // own comment on the Batch model. Assume available while quota is still
  // loading so the card doesn't flash disabled-then-enabled.
  const humanAvailable = quota ? quota.limit !== 0 : true;
  const atWeeklyLimit = humanAvailable && Boolean(quota?.limit) && quota.used >= quota.limit;
  const humanDisabled = !humanAvailable || atWeeklyLimit;
  // doubtSolving (the route-level gate that got the student onto this page
  // at all) and aiAssist are separate feature flags — a batch can run
  // human-only doubt support with AI off. Assume available while the
  // batch is still loading so the card doesn't flash disabled-then-enabled;
  // the effects below correct the default selection once it's known.
  const aiAvailable = batch ? Boolean(batch.features?.aiAssist) : true;

  // Pre-filled when a student arrives from course chat's "Ask a teacher".
  const [searchParams] = useSearchParams();
  const [question, setQuestion] = useState(() => (searchParams.get("question") || "").slice(0, 2000));
  const [mode, setMode] = useState(() => (searchParams.get("mode") === "human" ? "human" : "ai"));
  const [imageUrl, setImageUrl] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [uploadError, setUploadError] = useState(null);

  useEffect(() => {
    if (batch && !aiAvailable && mode === "ai") setMode("human");
  }, [batch, aiAvailable]);

  useEffect(() => {
    if (quota && humanDisabled && mode === "human") setMode("ai");
  }, [quota, humanDisabled]);

  const attachImage = async (file) => {
    if (!file) return;
    setUploadError(null);
    setImagePreview(URL.createObjectURL(file));
    try {
      const result = await uploadImage({ batchId, file }).unwrap();
      setImageUrl(result.url);
    } catch (err) {
      setUploadError(err.data?.message || "Could not upload that image.");
      setImagePreview(null);
    }
  };

  const removeImage = () => {
    setImageUrl(null);
    setImagePreview(null);
    setUploadError(null);
  };

  const submit = async () => {
    const result = await createDoubt({ batchId, question, mode, questionImage: imageUrl || undefined }).unwrap();
    navigate(`/batches/${batchId}/doubts/${result.doubt._id}`, { replace: true });
  };

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 600, mx }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 3 }}>
        <IconButton size="small" onClick={() => navigate(`/batches/${batchId}/doubts`)}><ArrowLeft size={18} /></IconButton>
        <Typography variant="h6" sx={{ fontWeight: 500, fontSize: 17 }}>Ask a doubt</Typography>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error.data?.message || "Could not submit this doubt."}</Alert>}

      {/* Reached via this batch's own "Ask" button too (only shown when
          doubtSolving is on, see DoubtList.jsx), but also via a bookmark or
          the browser back button — this used to render the whole form
          regardless, letting a student type out a question before finding
          out on submit that the feature's off for this batch. */}
      <FeatureGate batch={batch} feature="doubtSolving" label="Doubts">
      <AiUsageMeter batchId={batchId} compact />
      <DoubtQuotaMeter batchId={batchId} compact />

      <TextField
        multiline
        minRows={4}
        fullWidth
        autoFocus
        placeholder="Describe what you're stuck on — the more specific, the better the answer"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        sx={{ mb: 2 }}
      />

      {uploadError && <Alert severity="warning" sx={{ mb: 2 }}>{uploadError}</Alert>}

      {imagePreview ? (
        <Box sx={{ position: "relative", display: "inline-block", mb: 3 }}>
          <Box
            component="img"
            src={imagePreview}
            sx={{ height: 90, borderRadius: 2, display: "block", opacity: uploading ? 0.5 : 1 }}
          />
          {uploading && (
            <CircularProgress size={20} sx={{ position: "absolute", top: "50%", left: "50%", mt: "-10px", ml: "-10px" }} />
          )}
          <IconButton
            size="small"
            onClick={removeImage}
            sx={{ position: "absolute", top: -8, right: -8, bgcolor: "background.paper", border: 1, borderColor: "divider", "&:hover": { bgcolor: "background.paper" } }}
          >
            <X size={13} />
          </IconButton>
        </Box>
      ) : (
        <Button
          component="label"
          size="small"
          variant="text"
          startIcon={<Paperclip size={15} />}
          sx={{ mb: 3, pl: 0 }}
        >
          Attach a photo (optional)
          <input
            type="file"
            hidden
            accept="image/png,image/jpeg,image/webp,image/heic"
            onChange={(e) => attachImage(e.target.files?.[0])}
          />
        </Button>
      )}

      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
        Who should answer this?
      </Typography>
      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, mb: 3 }}>
        <Paper
          variant="outlined"
          onClick={() => aiAvailable && setMode("ai")}
          sx={{
            p: 2.5, borderRadius: 3, textAlign: "center",
            cursor: aiAvailable ? "pointer" : "not-allowed",
            opacity: aiAvailable ? 1 : 0.5,
            borderColor: mode === "ai" ? "primary.main" : "divider",
            borderWidth: mode === "ai" ? 2 : 1,
            bgcolor: mode === "ai" ? "action.hover" : "transparent",
          }}
        >
          <Sparkles size={22} style={{ marginBottom: 8 }} />
          <Typography sx={{ fontWeight: 500, fontSize: 14 }}>AI</Typography>
          <Typography variant="caption" color="text.secondary">
            {aiAvailable ? "Instant — you can escalate to a human after" : `Not available for this ${terms.batch}`}
          </Typography>
        </Paper>
        <Paper
          variant="outlined"
          onClick={() => !humanDisabled && setMode("human")}
          sx={{
            p: 2.5, borderRadius: 3, textAlign: "center",
            cursor: humanDisabled ? "not-allowed" : "pointer",
            opacity: humanDisabled ? 0.5 : 1,
            borderColor: mode === "human" ? "primary.main" : "divider",
            borderWidth: mode === "human" ? 2 : 1,
            bgcolor: mode === "human" ? "action.hover" : "transparent",
          }}
        >
          <User size={22} style={{ marginBottom: 8 }} />
          <Typography sx={{ fontWeight: 500, fontSize: 14 }}>A person</Typography>
          <Typography variant="caption" color="text.secondary">
            {!humanAvailable ? `Not available for this ${terms.batch}` : atWeeklyLimit ? "This week's allowance is used up" : "Takes longer, goes straight to a doubt solver"}
          </Typography>
        </Paper>
      </Box>

      <Button
        variant="contained"
        fullWidth
        disabled={!question.trim() || isLoading || uploading || (mode === "human" && humanDisabled) || (mode === "ai" && !aiAvailable)}
        onClick={submit}
      >
        {uploading ? "Uploading image…" : isLoading ? "Submitting" : "Submit"}
      </Button>
      </FeatureGate>
    </Box>
  );
}
