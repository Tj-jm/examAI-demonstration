import { useState } from "react";
import { Box, Button, Dialog, IconButton } from "@mui/material";
import { Clapperboard, X } from "lucide-react";
import { useGetQuestionVideoLessonQuery } from "../api/contentApi";
import BoardPlayer from "./BoardPlayer";
import ProtectedVideo from "./ProtectedVideo";
import useWatermark from "../hooks/useWatermark";
import AskVideo from "./AskVideo";

// A question's solution video wherever a solution is shown: a video file
// plays in the browser's own player, a hosted one embeds, and when there's
// only a published AI video lesson (board and voice), a button opens it.
// batchId (practice): "Ask for a short video" under the AI video lesson.
export default function SolutionVideo({ video, questionId, batchId }) {
  const [open, setOpen] = useState(false);
  const [part, setPart] = useState(null);
  const { data } = useGetQuestionVideoLessonQuery(questionId, { skip: Boolean(video?.url) || !questionId });
  const lesson = data?.lesson;
  const watermark = useWatermark();

  if (video?.url) {
    return (
      <Box sx={{ position: "relative", pt: "56.25%", bgcolor: "#000", borderRadius: 1, overflow: "hidden", mt: 1 }}>
        <ProtectedVideo src={video.url} file={video.file} title="Solution video" />
      </Box>
    );
  }
  if (!lesson) return null;
  return (
    <>
      <Button size="small" variant="outlined" startIcon={<Clapperboard size={15} />} onClick={(e) => { e.stopPropagation(); setOpen(true); }} sx={{ mt: 1, textTransform: "none" }}>
        Watch solution video
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="md" fullWidth PaperProps={{ sx: { p: { xs: 1.5, sm: 2 }, position: "relative" } }}>
        <IconButton size="small" onClick={() => setOpen(false)} aria-label="Close" sx={{ position: "absolute", top: 4, right: 4, zIndex: 1 }}><X size={16} /></IconButton>
        <Box sx={{ mt: 3 }}>{open && <BoardPlayer lesson={lesson} autoPlay watermark={watermark} onPosition={(p) => { if (p.playing || p.item) setPart((x) => (x === p.segment ? x : p.segment)); }} />}</Box>
        {open && batchId && <AskVideo batchId={batchId} question={questionId} segment={part} sx={{ mt: 1.5 }} />}
      </Dialog>
    </>
  );
}
