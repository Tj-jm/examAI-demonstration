import { Box, Typography, Paper, Skeleton, IconButton, Button } from "@mui/material";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Layers } from "lucide-react";
import { useGetLearnTopicsQuery } from "../../api/contentApi";
import ChapterCards from "../../components/ChapterCards";
import EmptyState from "../../components/EmptyState";
import { useHomeMx } from "../../BrandingContext";

// Learn mode's topic list: written questions, as study
// cards, by chapter in the batch's outline order. A topic's count is its
// cards; the caption says how many are due.
// "in 10 min", "in 5 h", "tomorrow", "in 3 days".
const nextDue = (at) => {
  const ms = new Date(at) - Date.now();
  if (ms < 3600000) return `in ${Math.max(1, Math.round(ms / 60000))} min`;
  if (ms < 86400000) return `in ${Math.round(ms / 3600000)} h`;
  const days = Math.round(ms / 86400000);
  return days === 1 ? "tomorrow" : `in ${days} days`;
};

export default function LearnTopics() {
  const navigate = useNavigate();
  const mx = useHomeMx();
  const { batchId } = useParams();
  const { data, isLoading } = useGetLearnTopicsQuery(batchId);
  const open = (scope) => navigate(`/batches/${batchId}/practice/learn/${scope}`);

  // ChapterCards shows questionCount; the due count rides in the title.
  const label = (x) => ({ ...x, title: x.due ? `${x.title} · ${x.due} due` : x.title });

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 800, mx }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
        <IconButton size="small" onClick={() => navigate(`/batches/${batchId}/practice`)}><ArrowLeft size={18} /></IconButton>
        <Typography variant="h6" sx={{ fontWeight: 600 }}>Learn written answers</Typography>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
        Read the question, think through your answer, then check it against the answer and say how you did.
        Cards you miss come back sooner.
      </Typography>

      {isLoading ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} variant="rounded" height={60} />)}
        </Box>
      ) : !data?.total ? (
        <EmptyState icon={Layers} title="No study cards yet" description="Written questions show up here." />
      ) : (
        <>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, mb: 3, display: "flex", alignItems: "center", gap: 2 }}>
            <Box sx={{ flex: 1 }}>
              <Typography sx={{ fontWeight: 600 }}>{data.due ? `${data.due} due now` : "All caught up"}</Typography>
              <Typography variant="caption" color="text.secondary">
                {data.total} cards · {data.learned} learned
                {!data.due && data.nextDueAt ? ` · next due ${nextDue(data.nextDueAt)}` : ""}
              </Typography>
            </Box>
            {data.due
              ? <Button variant="contained" onClick={() => open("due")}>Study due cards</Button>
              : <Button variant="outlined" onClick={() => open("all")}>Review anyway</Button>}
          </Paper>
          <ChapterCards
            topics={data.topics.map(label)}
            chapterPools={data.chapterPools.map(label)}
            chapterOrder={data.chapterOrder}
            groups={data.groups}
            onPick={open}
          />
        </>
      )}
    </Box>
  );
}
