import { useEffect, useState } from "react";
import { Box, Typography, Paper, Button, IconButton, LinearProgress, Skeleton, Chip } from "@mui/material";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Eye, RotateCcw, CircleHelp, Check, PartyPopper } from "lucide-react";
import { useGetLearnCardsQuery, useRateLearnCardMutation } from "../../api/contentApi";
import Latex from "../../components/Latex";
import ZoomableImage from "../../components/ZoomableImage";
import EmptyState from "../../components/EmptyState";
import AttachmentList from "../../components/AttachmentList";
import SolutionVideo from "../../components/SolutionVideo";
import { useHomeMx } from "../../BrandingContext";

// One study session: the question, "Show answer", then the solution (or
// the model answer when there is none)
// with its key points, rated Again / Partly / Got it (learnController.js
// schedules the card from that). "Again" cards come back at the end of
// this session too.
export default function LearnCards() {
  const navigate = useNavigate();
  const mx = useHomeMx();
  const { batchId, scope } = useParams();
  const { data, isLoading } = useGetLearnCardsQuery({ batchId, scope });
  const [rate, { isLoading: rating }] = useRateLearnCardMutation();
  const [queue, setQueue] = useState(null);
  const [shown, setShown] = useState(false);
  const [done, setDone] = useState({ good: 0, partly: 0, again: 0 });

  useEffect(() => { if (data && !queue) setQueue(data.cards); }, [data, queue]);

  const card = queue?.[0];
  // The solution first; the model answer only when there is no solution.
  const hasSolution = Boolean(card && (card.solutionText || card.solutionImage?.url || card.solutionVideo?.url || card.solutionAttachments?.length));
  const total = data?.cards.length || 0;
  const reviewed = done.good + done.partly + done.again;

  const answer = async (r) => {
    await rate({ batchId, questionId: card._id, rating: r }).unwrap().catch(() => {});
    setDone((d) => ({ ...d, [r]: d[r] + 1 }));
    setShown(false);
    setQueue((q) => (r === "again" ? [...q.slice(1), q[0]] : q.slice(1)));
  };

  const back = () => navigate(`/batches/${batchId}/practice/learn`);

  if (isLoading || !queue) {
    return <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 760, mx }}><Skeleton variant="rounded" height={260} /></Box>;
  }

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 760, mx }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
        <IconButton size="small" onClick={back}><ArrowLeft size={18} /></IconButton>
        <Typography sx={{ fontWeight: 600, flex: 1 }}>Learn</Typography>
        {card && <Typography variant="caption" color="text.secondary">{queue.length} left</Typography>}
      </Box>
      {total > 0 && <LinearProgress variant="determinate" value={Math.min(100, ((total - queue.length) / total) * 100)} sx={{ mb: 2.5, borderRadius: 1 }} />}

      {!total ? (
        <EmptyState icon={Check} title="Nothing to study here" description="No cards in this topic right now." />
      ) : !card ? (
        <Paper variant="outlined" sx={{ p: 4, borderRadius: 3, textAlign: "center" }}>
          <PartyPopper size={34} />
          <Typography variant="h6" sx={{ mt: 1, fontWeight: 600 }}>Session done</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            {reviewed} reviewed · {done.good} got it · {done.partly} partly · {done.again} again
          </Typography>
          <Button variant="contained" sx={{ mt: 2.5 }} onClick={back}>Back to topics</Button>
        </Paper>
      ) : (
        <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, borderRadius: 3 }}>
          <Box sx={{ display: "flex", gap: 1, mb: 1.5, flexWrap: "wrap" }}>
            {card.where && <Chip size="small" label={card.where} variant="outlined" />}
            <Chip size="small" label={`${card.marks} mark${card.marks === 1 ? "" : "s"}`} variant="outlined" />
            {card.box === null && <Chip size="small" label="New" color="primary" />}
          </Box>
          <Latex as="div">{card.question}</Latex>
          {card.questionImage?.url && <ZoomableImage src={card.questionImage.url} sx={{ maxWidth: "100%", borderRadius: 1, mt: 1 }} />}

          {!shown ? (
            <Box sx={{ mt: 3 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
                Think through your answer, or jot it down, before you look.
              </Typography>
              <Button variant="contained" startIcon={<Eye size={16} />} onClick={() => setShown(true)}>Show answer</Button>
            </Box>
          ) : (
            <Box sx={{ mt: 3 }}>
              {hasSolution ? (
                <Box sx={{ p: 2, borderRadius: 2, bgcolor: "action.hover" }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.75, fontWeight: 600 }}>Answer</Typography>
                  {card.solutionText && <Latex as="div" style={{ whiteSpace: "pre-wrap" }}>{card.solutionText}</Latex>}
                  {card.solutionImage?.url && <ZoomableImage src={card.solutionImage.url} sx={{ maxWidth: "100%", borderRadius: 1, mt: 1 }} />}
                  <SolutionVideo video={card.solutionVideo} questionId={card._id} />
                  <AttachmentList attachments={card.solutionAttachments} sx={{ mt: 1 }} />
                </Box>
              ) : card.modelAnswer ? (
                <Box sx={{ p: 2, borderRadius: 2, bgcolor: "action.hover" }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.75, fontWeight: 600 }}>Model answer</Typography>
                  <Latex as="div" style={{ whiteSpace: "pre-wrap" }}>{card.modelAnswer}</Latex>
                </Box>
              ) : null}
              {card.keyPoints.length > 0 && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.75, fontWeight: 600 }}>Marks are given for</Typography>
                  {card.keyPoints.map((k, i) => (
                    <Box key={i} sx={{ display: "flex", gap: 1, mb: 0.5 }}>
                      <Check size={15} style={{ flexShrink: 0, marginTop: 3 }} />
                      <Typography variant="body2" sx={{ flex: 1 }}><Latex>{k.criterion}</Latex></Typography>
                      <Typography variant="caption" color="text.secondary">{k.marks}</Typography>
                    </Box>
                  ))}
                </Box>
              )}
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 2.5, mb: 1 }}>How did you do?</Typography>
              <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1 }}>
                <Button variant="outlined" color="error" disabled={rating} startIcon={<RotateCcw size={15} />} onClick={() => answer("again")}>Again</Button>
                <Button variant="outlined" color="warning" disabled={rating} startIcon={<CircleHelp size={15} />} onClick={() => answer("partly")}>Partly</Button>
                <Button variant="contained" color="success" disabled={rating} startIcon={<Check size={15} />} onClick={() => answer("good")}>Got it</Button>
              </Box>
            </Box>
          )}
        </Paper>
      )}
    </Box>
  );
}
