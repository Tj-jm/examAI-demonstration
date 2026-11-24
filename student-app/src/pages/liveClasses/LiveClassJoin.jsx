import { useEffect, useState } from "react";
import { Box, Typography, Paper, Chip, Skeleton, IconButton, Button } from "@mui/material";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Video, Radio, ExternalLink, PlayCircle, FileText } from "lucide-react";
import { useGetLiveClassQuery } from "../../api/contentApi";
import EmptyState from "../../components/EmptyState";
import SafeMarkdown from "../../components/SafeMarkdown";

const STATUS_META = {
  scheduled: { label: "Scheduled", color: "default" },
  live: { label: "Live now", color: "error" },
  ended: { label: "Ended", color: "default" },
  cancelled: { label: "Cancelled", color: "default" },
};

// The join button only ever opens joinUrl — hostUrl never reaches this app
// at all (see controllers/app/liveClassController.js's shape()), so there
// is nothing here that could hand a student host control by accident.
export default function LiveClassJoin() {
  const { batchId, id } = useParams();
  const navigate = useNavigate();
  // An in-app class that hasn't started yet is checked every 15 seconds,
  // so "Join" appears without a reload when the host starts it; a live one
  // every 20, so it shows as ended soon after it ends.
  const [poll, setPoll] = useState(0);
  const { data: liveClass, isLoading, error } = useGetLiveClassQuery({ batchId, id }, { pollingInterval: poll });
  useEffect(() => {
    setPoll(liveClass?.provider === "livekit" && liveClass.status === "scheduled" ? 15000 : liveClass?.status === "live" ? 20000 : 0);
  }, [liveClass?.provider, liveClass?.status]);

  if (isLoading) {
    return (
      <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 700, mx: "var(--home-mx)" }}>
        <Skeleton variant="rounded" height={160} />
      </Box>
    );
  }

  if (!liveClass) {
    // Same query, two different reasons to end up here: the class id is
    // genuinely gone, or this batch had liveClasses switched off after the
    // link was bookmarked/notified — requireFeature's own guard message
    // (batchAccess.js) is shown for the second case instead of the generic
    // "not found", which used to say the same thing either way.
    return (
      <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 700, mx: "var(--home-mx)" }}>
        <EmptyState icon={Video} title="Can't open this live class" description={error?.data?.message} />
      </Box>
    );
  }

  const meta = STATUS_META[liveClass.status] || { label: liveClass.status, color: "default" };
  const inApp = liveClass.provider === "livekit";
  const canJoin = liveClass.status === "live" && (inApp || liveClass.joinUrl);
  const blocked = liveClass.joinBlockedReason;

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 700, mx: "var(--home-mx)" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
        <IconButton size="small" onClick={() => navigate(`/batches/${batchId}/live-classes`)}>
          <ArrowLeft size={18} />
        </IconButton>
        <Typography variant="h6" sx={{ fontWeight: 500, fontSize: 17, flex: 1 }}>Live Class</Typography>
      </Box>

      <Paper variant="outlined" sx={{ p: 3, borderRadius: 2, display: "flex", flexDirection: "column", gap: 2 }}>
        <Box sx={{ display: "flex", alignItems: "flex-start", gap: 2 }}>
          <Box sx={{
            width: 44, height: 44, borderRadius: 2, flexShrink: 0,
            bgcolor: "action.hover", display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {liveClass.status === "live" ? <Radio size={20} /> : <Video size={20} />}
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontSize: 17, fontWeight: 500 }}>{liveClass.title}</Typography>
            <Chip size="small" label={meta.label} color={meta.color} sx={{ mt: 0.5 }} />
          </Box>
        </Box>

        {liveClass.description && (
          <Box sx={{ color: "text.secondary", fontSize: 14 }}><SafeMarkdown>{liveClass.description}</SafeMarkdown></Box>
        )}

        <Typography variant="body2" color="text.secondary">
          {new Date(liveClass.scheduledAt).toLocaleString()} · {liveClass.durationMinutes} min
        </Typography>

        {liveClass.secured && (
          <Chip
            size="small"
            variant="outlined"
            label="Secured — your own personal link"
            sx={{ alignSelf: "flex-start" }}
          />
        )}

        {blocked === "no_email_on_file" ? (
          <Typography variant="body2" color="text.secondary">
            This class requires a personal join link, and there's no email on your account to
            send one to. Add an email in your profile, then reopen this page.
          </Typography>
        ) : blocked === "registration_failed" ? (
          <Typography variant="body2" color="text.secondary">
            Couldn't set up your join link just now — this usually clears up on its own.
            Reopening this page will try again.
          </Typography>
        ) : canJoin && inApp ? (
          <Button
            variant="contained"
            size="large"
            startIcon={<Video size={16} />}
            onClick={() => navigate(`/batches/${batchId}/live-classes/${id}/room`)}
          >
            {liveClass.mode === "webinar" ? "Join webinar" : "Join class"}
          </Button>
        ) : canJoin ? (
          <Button
            variant="contained"
            size="large"
            startIcon={<ExternalLink size={16} />}
            href={liveClass.joinUrl}
            target="_blank"
            rel="noreferrer"
          >
            Join now
          </Button>
        ) : liveClass.status === "scheduled" ? (
          <Typography variant="body2" color="text.secondary">
            {inApp ? "You can join here as soon as the host starts the class." : "The join link opens once the host starts the class."}
          </Typography>
        ) : liveClass.status === "ended" ? (
          <>
            <Typography variant="body2" color="text.secondary">This class has ended.</Typography>
            {liveClass.recordingLecture ? (
              <Button
                variant="outlined"
                startIcon={<PlayCircle size={16} />}
                onClick={() => navigate(`/batches/${batchId}/lectures/${liveClass.recordingLecture}`)}
              >
                Watch recording
              </Button>
            ) : liveClass.recordingUrl && (
              <Button
                variant="outlined"
                startIcon={<ExternalLink size={16} />}
                href={liveClass.recordingUrl}
                target="_blank"
                rel="noreferrer"
              >
                Watch recording
              </Button>
            )}
          </>
        ) : (
          <Typography variant="body2" color="text.secondary">This class was cancelled.</Typography>
        )}
        {liveClass.padNotesUrl && (
          <Button variant="outlined" startIcon={<FileText size={16} />} href={liveClass.padNotesUrl} target="_blank" rel="noreferrer" sx={{ mt: 1.5 }}>
            Class notes (PDF)
          </Button>
        )}
      </Paper>
    </Box>
  );
}
