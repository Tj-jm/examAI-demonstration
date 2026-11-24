import { useState } from "react";
import { Box, Typography, IconButton, Paper, Button, Skeleton, TextField, InputAdornment, Alert, Dialog, DialogTitle, DialogContent, DialogActions } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Mic, PenLine, Search, ChevronRight, Trash2 } from "lucide-react";
import {
  useGetBatchQuery, useGetLecturesQuery, useGetPoraSettingsQuery, useGetPoraSessionsQuery, useStartPoraMutation, useDeletePoraMutation, useUnlockPoraMutation,
  useGetTutorSettingsQuery, useGetTutorSessionsQuery, useStartTutorMutation, useDeleteTutorMutation, useUnlockTutorMutation,
} from "../../api/contentApi";
import EmptyState from "../../components/EmptyState";
import { useBranding, useTerms } from "../../BrandingContext";
import PoraAllowance from "./PoraAllowance";
import AiUsageMeter from "../../components/AiUsageMeter";

// Oral Quiz and AI Tutoring share this page: pick a lecture, and an AI
// teacher (out loud) or tutor (in writing) checks whether you've read it.
const KINDS = {
  pora: {
    path: "pora", featureKey: "poraDhora", name: "Oral Quiz", Icon: Mic,
    on: (b) => b?.features?.poraDhora && b?.aiPoraDhora,
    useSettings: useGetPoraSettingsQuery, useSessions: useGetPoraSessionsQuery, useStart: useStartPoraMutation, useDelete: useDeletePoraMutation, useUnlock: useUnlockPoraMutation,
    intro: (s) => `${s?.teacherName || "The teacher"} asks ${s?.questionsPerSession || 5} questions about it, out loud. Answer out loud.`,
  },
  tutor: {
    path: "tutoring", featureKey: "aiTutor", name: "AI Tutoring", Icon: PenLine,
    on: (b) => b?.features?.aiTutor && b?.aiTutor,
    useSettings: useGetTutorSettingsQuery, useSessions: useGetTutorSessionsQuery, useStart: useStartTutorMutation, useDelete: useDeleteTutorMutation, useUnlock: useUnlockTutorMutation,
    intro: (s) => (s?.layout === "paper"
      ? "You get one creative question on it: a stimulus and four parts, marked like a board exam."
      : `${s?.tutorName || "Your tutor"} asks ${s?.questionsPerSession || 5} questions about it and marks each answer. Write, draw or photograph your answers.`),
  },
};

export default function PoraHome({ kind = "pora" }) {
  const K = KINDS[kind];
  const { batchId } = useParams();
  const navigate = useNavigate();
  const theme = useTheme();
  const terms = useTerms();
  const { featureNames } = useBranding();
  const title = featureNames?.[K.featureKey] || K.name;
  const { data: batch, isLoading } = useGetBatchQuery(batchId);
  const on = Boolean(batch?.features?.aiAssist && K.on(batch));
  const { data: settings } = K.useSettings(batchId, { skip: !on, refetchOnMountOrArgChange: true });
  const { data: lectureData } = useGetLecturesQuery(batchId, { skip: !on });
  const { data: sessionData } = K.useSessions({ batchId }, { skip: !on });
  const [start, { isLoading: starting, error: startError, originalArgs }] = K.useStart();
  const [q, setQ] = useState("");
  const [allRecent, setAllRecent] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [remove, { isLoading: deleting }] = K.useDelete();

  if (isLoading) return <Box sx={{ p: 3 }}><Skeleton variant="rounded" height={300} /></Box>;
  if (!on) {
    return (
      <Box sx={{ p: 3 }}>
        <EmptyState
          icon={K.Icon}
          title={`${title} isn't available`}
          description={`It isn't turned on for this ${terms.batch}.`}
          secondaryAction={{ label: `Back to ${terms.batch}`, onClick: () => navigate(`/batches/${batchId}`) }}
        />
      </Box>
    );
  }

  const lectures = (lectureData?.lectures || []).filter((l) => !q || String(l.title).toLowerCase().includes(q.toLowerCase()));
  const sessions = sessionData?.sessions || [];
  const begin = async (lectureId) => {
    const r = await start({ batchId, lectureId });
    if (r.data?.session) navigate(`/batches/${batchId}/${K.path}/${r.data.session._id}`);
  };

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 760, mx: "auto" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
        <IconButton size="small" onClick={() => navigate(`/batches/${batchId}`)} aria-label="Back"><ArrowLeft size={18} /></IconButton>
        <Typography variant="h6" sx={{ fontWeight: 600, flex: 1 }}>{title}</Typography>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, ml: 5 }}>
        Pick a lecture. {K.intro(settings)}
      </Typography>

      <PoraAllowance batchId={batchId} settings={settings} useUnlock={K.useUnlock} />
      {settings && !settings.freePerDay && <AiUsageMeter batchId={batchId} />}

      {startError && (
        <Alert severity={startError.status === 429 ? "warning" : "error"} sx={{ mb: 2 }}>
          {startError.data?.message || "Couldn't start. Try again."}
        </Alert>
      )}

      {sessions.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="overline" color="text.secondary">Recent</Typography>
          <Paper variant="outlined" sx={{ borderRadius: 3, overflow: "hidden" }}>
            {(allRecent ? sessions : sessions.slice(0, 5)).map((s, i) => (
              <Box
                key={s._id}
                onClick={() => navigate(`/batches/${batchId}/${K.path}/${s._id}`)}
                sx={{ display: "flex", alignItems: "center", gap: 1.5, px: 2, py: 1.25, cursor: "pointer", borderTop: i ? `1px solid ${theme.palette.divider}` : 0, "&:hover": { bgcolor: "action.hover" } }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography noWrap sx={{ fontSize: 14, fontWeight: 500 }}>{s.lectureTitle}</Typography>
                  <Typography variant="caption" color="text.secondary">{new Date(s.updatedAt).toLocaleDateString()}</Typography>
                </Box>
                <Typography sx={{ fontVariantNumeric: "tabular-nums", fontSize: 14, color: s.status === "done" ? "text.primary" : "primary.main" }}>
                  {s.status === "done" ? `${s.score ?? 0}/100` : "Continue"}
                </Typography>
                <IconButton
                  size="small"
                  aria-label="Delete"
                  onClick={(e) => { e.stopPropagation(); setRemoving(s); }}
                >
                  <Trash2 size={15} />
                </IconButton>
                <ChevronRight size={16} />
              </Box>
            ))}
          </Paper>
          {sessions.length > 5 && (
            <Button size="small" onClick={() => setAllRecent(!allRecent)} sx={{ mt: 0.5 }}>
              {allRecent ? "Show fewer" : `Show all (${sessions.length})`}
            </Button>
          )}
        </Box>
      )}

      <Dialog open={Boolean(removing)} onClose={() => setRemoving(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete this session?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {removing?.lectureTitle}: its questions, answers and report will be gone. This can't be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRemoving(null)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            disabled={deleting}
            onClick={async () => { await remove({ batchId, id: removing._id }); setRemoving(null); }}
          >
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>

      <Typography variant="overline" color="text.secondary">Lectures</Typography>
      <TextField
        size="small"
        fullWidth
        placeholder="Find a lecture"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        sx={{ mb: 1 }}
        InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} /></InputAdornment> }}
      />
      <Paper variant="outlined" sx={{ borderRadius: 3, overflow: "hidden" }}>
        {lectures.map((l, i) => (
          <Box key={l._id} sx={{ display: "flex", alignItems: "center", gap: 1.5, px: 2, py: 1.25, borderTop: i ? `1px solid ${theme.palette.divider}` : 0 }}>
            <Typography sx={{ flex: 1, fontSize: 14, minWidth: 0 }} noWrap>{l.title}</Typography>
            <Button
              size="small"
              variant="outlined"
              startIcon={<K.Icon size={14} />}
              disabled={starting}
              onClick={() => begin(l._id)}
            >
              {starting && originalArgs?.lectureId === l._id ? "Starting…" : "Start"}
            </Button>
          </Box>
        ))}
        {lectures.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>No lectures {q ? "match" : "yet"}.</Typography>
        )}
      </Paper>
    </Box>
  );
}
