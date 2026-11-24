import { useEffect, useState } from "react";
import { Box, Button, Chip, CircularProgress, Dialog, IconButton, TextField, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useNavigate } from "react-router-dom";
import { Clapperboard, Play, Sparkles, Trash2, X } from "lucide-react";
import { useGetBatchQuery, useGetStudentVideosQuery, useRequestStudentVideoMutation, useDeleteStudentVideoMutation } from "../api/contentApi";
import BoardPlayer from "./BoardPlayer";
import AiErrorAlert from "./practice/AiErrorAlert";
import useWatermark from "../hooks/useWatermark";

// "Make me a short video on this": a student asks about one point of a
// lecture or a solution (and the part of its AI video they were on), and AI
// makes a short board video just for them (backend studentVideoController.js).
// Off unless Settings → AI and the batch (with AI help) allow it.
const QUICK = ["Explain this step more slowly", "Why does this work?", "Give an example"];

export const useAskVideoOn = (batchId) => {
  const { data: batch } = useGetBatchQuery(batchId, { skip: !batchId });
  return Boolean(batch?.aiStudentVideos && batch?.features?.aiAssist && batch?.features?.studentVideos);
};

// highlight: { text, at } — a passage the student highlighted on the
// lecture page; opens the panel with it attached to the next video.
export default function AskVideo({ batchId, lecture, question, segment = null, highlight = null, sx }) {
  const theme = useTheme();
  const navigate = useNavigate();
  const on = useAskVideoOn(batchId);
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState("");
  const [passage, setPassage] = useState(null);
  useEffect(() => {
    if (!highlight?.text) return;
    setPassage(highlight.text);
    setOpen(true);
  }, [highlight]);
  const [error, setError] = useState(null);
  const [watching, setWatching] = useState(null);
  const watermark = useWatermark();
  const source = lecture ? { lecture } : { question };
  const { data } = useGetStudentVideosQuery({ batchId, ...source }, { skip: !on || !open });
  const making = (data?.videos || []).some((v) => v.job?.status === "running");
  // While a voice is being made, look again every few seconds.
  useGetStudentVideosQuery({ batchId, ...source }, { skip: !on || !open || !making, pollingInterval: 4000 });
  const [request, { isLoading: writing }] = useRequestStudentVideoMutation();
  const [remove] = useDeleteStudentVideoMutation();

  if (!on) return null;
  if (!open) {
    return (
      <Box sx={sx}>
        <Button size="small" variant="outlined" startIcon={<Clapperboard size={15} />} onClick={() => setOpen(true)}
          sx={{ textTransform: "none", borderColor: "ai.main", color: "ai.main", "&:hover": { borderColor: "ai.main", bgcolor: "ai.bg" } }}>
          Ask for a short video
        </Button>
      </Box>
    );
  }

  const send = async (text) => {
    const body = String(text ?? ask).trim();
    if (!body) return;
    setError(null);
    try {
      const r = await request({ batchId, ...source, ...(segment !== null ? { segment } : {}), ...(passage && lecture ? { highlight: passage } : {}), ask: body }).unwrap();
      setAsk("");
      setPassage(null);
      setWatching(r.video);
    } catch (e) {
      setError({ message: e.data?.message || "Couldn't make a video right now.", capReached: e.status === 429 });
    }
  };
  const left = data?.leftToday;
  // The video as it was when opened, so a voice arriving doesn't restart it.
  const current = watching;

  return (
    <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: "ai.bg", ...sx }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 1 }}>
        <Sparkles size={13} color={theme.palette.ai.main} />
        <Typography variant="caption" sx={{ color: "ai.main", fontWeight: 500, flex: 1 }}>
          Short video on one point{segment !== null ? ` (from part ${segment + 1} of the video)` : ""}
        </Typography>
        {left !== undefined && <Typography variant="caption" color="text.secondary">{left} left today</Typography>}
        <IconButton size="small" onClick={() => setOpen(false)} aria-label="Close"><X size={14} /></IconButton>
      </Box>

      {left !== 0 && (
        <>
          {passage && (
            <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1, mb: 1 }}>
              <Typography variant="caption" color="text.secondary" sx={{ flex: 1, pl: 1, borderLeft: "3px solid", borderColor: "ai.main", maxHeight: 64, overflowY: "auto" }}>
                {passage}
              </Typography>
              <IconButton size="small" onClick={() => setPassage(null)} aria-label="Remove highlighted text"><X size={14} /></IconButton>
            </Box>
          )}
          <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap", mb: 1 }}>
            {[passage ? "Explain this slowly" : lecture ? "Summarise this lesson" : "Elaborate the proof", ...QUICK].map((q) => <Chip key={q} size="small" variant="outlined" label={q} disabled={writing} onClick={() => setAsk(q)} />)}
          </Box>
          <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
            <TextField size="small" fullWidth multiline maxRows={3} placeholder="What should it explain? e.g. elaborate the proof"
              value={ask} inputProps={{ maxLength: 300 }} onChange={(e) => setAsk(e.target.value)} sx={{ bgcolor: "background.paper" }} />
            <Button variant="contained" disabled={writing || !ask.trim()} onClick={() => send()} sx={{ whiteSpace: "nowrap" }}>
              {writing ? <CircularProgress size={16} color="inherit" /> : "Make it"}
            </Button>
          </Box>
          {writing && <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>Writing your video… this takes a few seconds.</Typography>}
        </>
      )}
      <AiErrorAlert error={error} batchId={batchId} navigate={navigate} sx={{ mt: 1 }} />

      {(data?.videos || []).length > 0 && (
        <Box sx={{ mt: 1.5, display: "flex", flexDirection: "column", gap: 0.75 }}>
          {data.videos.map((v) => (
            <Box key={v._id} sx={{ display: "flex", alignItems: "center", gap: 1, p: 1, borderRadius: 1.5, bgcolor: "background.paper" }}>
              <IconButton size="small" color="primary" onClick={() => setWatching(v)} aria-label="Play"><Play size={16} /></IconButton>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>{v.title}</Typography>
                <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
                  “{v.ask}”{v.job?.status === "running" ? " · adding the voice…" : ""}
                </Typography>
              </Box>
              <IconButton size="small" onClick={() => remove({ batchId, id: v._id })} aria-label="Delete"><Trash2 size={14} /></IconButton>
            </Box>
          ))}
        </Box>
      )}

      <Dialog open={Boolean(current)} onClose={() => setWatching(null)} maxWidth="md" fullWidth PaperProps={{ sx: { p: { xs: 1.5, sm: 2 }, position: "relative" } }}>
        <IconButton size="small" onClick={() => setWatching(null)} aria-label="Close" sx={{ position: "absolute", top: 4, right: 4, zIndex: 1 }}><X size={16} /></IconButton>
        {current && (
          <Box sx={{ mt: 3 }}>
            {current.job?.status === "running" && (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>The voice is still being added: this plays with captions. Open it again in a moment for sound.</Typography>
            )}
            <BoardPlayer key={current._id} lesson={current} autoPlay watermark={watermark} />
          </Box>
        )}
      </Dialog>
    </Box>
  );
}
