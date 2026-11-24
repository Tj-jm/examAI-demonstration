import { useState } from "react";
import {
  Box, Typography, IconButton, Paper, Button, Skeleton, TextField, InputAdornment, Alert, Chip,
  Dialog, DialogTitle, DialogContent, DialogActions, CircularProgress,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Users, Search, ChevronRight, Trash2, BookOpen, PencilLine } from "lucide-react";
import {
  useGetBatchQuery, useGetLecturesQuery, useGetInterviewSettingsQuery, useGetInterviewSessionsQuery,
  useStartInterviewMutation, useDeleteInterviewMutation, useUnlockInterviewMutation,
} from "../../api/contentApi";
import EmptyState from "../../components/EmptyState";
import AiUsageMeter from "../../components/AiUsageMeter";
import { useBranding, useTerms } from "../../BrandingContext";
import PoraAllowance from "../pora/PoraAllowance";

// Interview practice: pick an interview the institution set up, a viva on
// a lecture, or describe your own; a panel asks out loud and you answer.
export const KIND_LABEL = { viva: "Viva", admission: "Admission", job: "Job", scholarship: "Scholarship", other: "Interview" };

export default function InterviewHome() {
  const { batchId } = useParams();
  const navigate = useNavigate();
  const theme = useTheme();
  const terms = useTerms();
  const { featureNames } = useBranding();
  const title = featureNames?.interview || "Interview practice";
  const { data: batch, isLoading } = useGetBatchQuery(batchId);
  const on = Boolean(batch?.features?.aiAssist && batch?.features?.interview && batch?.aiInterview);
  const { data: settings } = useGetInterviewSettingsQuery(batchId, { skip: !on, refetchOnMountOrArgChange: true });
  const { data: sessionData } = useGetInterviewSessionsQuery({ batchId }, { skip: !on });
  const { data: lectureData } = useGetLecturesQuery(batchId, { skip: !on || !settings?.lectureViva });
  const [start, { isLoading: starting, error: startError, originalArgs }] = useStartInterviewMutation();
  const [remove, { isLoading: deleting }] = useDeleteInterviewMutation();
  const [removing, setRemoving] = useState(null);
  const [q, setQ] = useState("");
  const [ownKind, setOwnKind] = useState("admission");
  const [ownText, setOwnText] = useState("");
  const [allRecent, setAllRecent] = useState(false);

  if (isLoading) return <Box sx={{ p: 3 }}><Skeleton variant="rounded" height={300} /></Box>;
  if (!on) {
    return (
      <Box sx={{ p: 3 }}>
        <EmptyState
          icon={Users}
          title={`${title} isn't available`}
          description={`It isn't turned on for this ${terms.batch}.`}
          secondaryAction={{ label: `Back to ${terms.batch}`, onClick: () => navigate(`/batches/${batchId}`) }}
        />
      </Box>
    );
  }

  const begin = async (body) => {
    const r = await start({ batchId, ...body });
    if (r.data?.session) navigate(`/batches/${batchId}/interview/${r.data.session._id}`);
  };
  const busy = (match) => starting && originalArgs && match(originalArgs);
  const sessions = sessionData?.sessions || [];
  const sets = settings?.sets || [];
  const lectures = (lectureData?.lectures || []).filter((l) => !q || String(l.title).toLowerCase().includes(q.toLowerCase()));
  const section = { variant: "overline", color: "text.secondary", sx: { display: "block", mt: 3, mb: 0.5 } };

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 760, mx: "auto" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
        <IconButton size="small" onClick={() => navigate(`/batches/${batchId}`)} aria-label="Back"><ArrowLeft size={18} /></IconButton>
        <Typography variant="h6" sx={{ fontWeight: 600, flex: 1 }}>{title}</Typography>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, ml: 5 }}>
        A panel asks you questions out loud, one at a time, and follows up on what you say. Answer out loud. At the end you get scores, tips and a better answer to your weakest question.
      </Typography>

      <PoraAllowance batchId={batchId} settings={settings} useUnlock={useUnlockInterviewMutation} />
      {settings && !settings.freePerDay && <AiUsageMeter batchId={batchId} />}

      {startError && (
        <Alert severity={startError.status === 429 ? "warning" : "error"} sx={{ mb: 2 }}>
          {startError.data?.message || "Couldn't start. Try again."}
        </Alert>
      )}

      {sessions.length > 0 && (
        <>
          <Typography {...section}>Recent</Typography>
          <Paper variant="outlined" sx={{ borderRadius: 3, overflow: "hidden" }}>
            {(allRecent ? sessions : sessions.slice(0, 5)).map((s, i) => (
              <Box
                key={s._id}
                onClick={() => navigate(`/batches/${batchId}/interview/${s._id}`)}
                sx={{ display: "flex", alignItems: "center", gap: 1.5, px: 2, py: 1.25, cursor: "pointer", borderTop: i ? `1px solid ${theme.palette.divider}` : 0, "&:hover": { bgcolor: "action.hover" } }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography noWrap sx={{ fontSize: 14, fontWeight: 500 }}>{s.title}</Typography>
                  <Typography variant="caption" color="text.secondary">{KIND_LABEL[s.kind] || "Interview"} · {new Date(s.updatedAt).toLocaleDateString()}</Typography>
                </Box>
                <Typography sx={{ fontVariantNumeric: "tabular-nums", fontSize: 14, color: s.status === "done" ? "text.primary" : "primary.main" }}>
                  {s.status === "done" ? `${s.score ?? 0}/100` : "Continue"}
                </Typography>
                <IconButton size="small" aria-label="Delete" onClick={(e) => { e.stopPropagation(); setRemoving(s); }}><Trash2 size={15} /></IconButton>
                <ChevronRight size={16} />
              </Box>
            ))}
          </Paper>
          {sessions.length > 5 && (
            <Button size="small" onClick={() => setAllRecent(!allRecent)} sx={{ mt: 0.5 }}>{allRecent ? "Show fewer" : `Show all (${sessions.length})`}</Button>
          )}
        </>
      )}

      {sets.length > 0 && (
        <>
          <Typography {...section}>Interviews</Typography>
          <Box sx={{ display: "grid", gap: 1.25, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" } }}>
            {sets.map((x) => (
              <Paper key={x._id} variant="outlined" sx={{ p: 2, borderRadius: 3, display: "flex", flexDirection: "column", gap: 0.75 }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Typography sx={{ fontWeight: 600, flex: 1, fontSize: 15 }}>{x.title}</Typography>
                  <Chip size="small" label={KIND_LABEL[x.kind] || "Interview"} />
                </Box>
                {x.brief && <Typography variant="body2" color="text.secondary" sx={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{x.brief}</Typography>}
                <Typography variant="caption" color="text.secondary">{x.panel.slice(0, settings.layout === "video" ? 1 : 3).join(", ")} · {x.questions} questions</Typography>
                <Button
                  variant="contained"
                  size="small"
                  sx={{ alignSelf: "flex-start", mt: 0.5 }}
                  disabled={starting}
                  startIcon={busy((a) => a.setId === x._id) ? <CircularProgress size={14} color="inherit" /> : null}
                  onClick={() => begin({ setId: x._id })}
                >
                  Start
                </Button>
              </Paper>
            ))}
          </Box>
        </>
      )}

      {settings?.ownInterview && (
        <>
          <Typography {...section}>Your own interview</Typography>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
            <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap", mb: 1.25 }}>
              {["admission", "job", "scholarship", "viva", "other"].map((k) => (
                <Chip key={k} label={KIND_LABEL[k]} color={ownKind === k ? "primary" : "default"} variant={ownKind === k ? "filled" : "outlined"} onClick={() => setOwnKind(k)} />
              ))}
            </Box>
            <TextField
              fullWidth
              multiline
              minRows={2}
              size="small"
              value={ownText}
              onChange={(e) => setOwnText(e.target.value.slice(0, 600))}
              placeholder={ownKind === "job" ? "e.g. Junior accountant at a bank in Dhaka, my first job after BBA" : ownKind === "scholarship" ? "e.g. Commonwealth scholarship for a master's in public health" : ownKind === "viva" ? "e.g. HSC Physics viva, chapter on waves" : "e.g. Dhaka University admission, Unit A, I want to study CSE"}
              InputProps={{ startAdornment: <InputAdornment position="start"><PencilLine size={16} /></InputAdornment> }}
            />
            <Button
              variant="contained"
              size="small"
              sx={{ mt: 1.25 }}
              disabled={starting || ownText.trim().length < 5}
              startIcon={busy((a) => a.own) ? <CircularProgress size={14} color="inherit" /> : null}
              onClick={() => begin({ own: { kind: ownKind, description: ownText.trim() } })}
            >
              Start
            </Button>
          </Paper>
        </>
      )}

      {settings?.lectureViva && (
        <>
          <Typography {...section}>Viva on a lecture</Typography>
          <TextField
            fullWidth
            size="small"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search lectures"
            sx={{ mb: 1 }}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} /></InputAdornment> }}
          />
          <Paper variant="outlined" sx={{ borderRadius: 3, overflow: "hidden" }}>
            {lectures.slice(0, 40).map((l, i) => (
              <Box
                key={l._id}
                onClick={() => !starting && begin({ lectureId: l._id })}
                sx={{ display: "flex", alignItems: "center", gap: 1.5, px: 2, py: 1.25, cursor: "pointer", borderTop: i ? `1px solid ${theme.palette.divider}` : 0, "&:hover": { bgcolor: "action.hover" } }}
              >
                <BookOpen size={16} />
                <Typography noWrap sx={{ flex: 1, fontSize: 14 }}>{l.title}</Typography>
                {busy((a) => a.lectureId === l._id) ? <CircularProgress size={16} /> : <ChevronRight size={16} />}
              </Box>
            ))}
            {!lectures.length && <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>No lectures{q ? " match" : " yet"}.</Typography>}
          </Paper>
        </>
      )}

      {settings && !sets.length && !settings.ownInterview && !settings.lectureViva && (
        <Typography color="text.secondary" sx={{ mt: 3 }}>No interviews to practise yet.</Typography>
      )}

      <Dialog open={Boolean(removing)} onClose={() => setRemoving(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete this session?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">{removing?.title}: its questions, answers and report will be gone. This can't be undone.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRemoving(null)}>Cancel</Button>
          <Button color="error" variant="contained" disabled={deleting} onClick={async () => { await remove({ batchId, id: removing._id }); setRemoving(null); }}>Delete</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
