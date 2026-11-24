import { useMemo } from "react";
import { Box, Typography, Paper, Skeleton, IconButton, ButtonBase } from "@mui/material";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Presentation } from "lucide-react";
import { useGetSlideDecksQuery } from "../../api/contentApi";
import EmptyState from "../../components/EmptyState";
import SlideView from "../../components/SlideView";
import { useHomeMx } from "../../BrandingContext";
import goBack from "../../utils/goBack";

// Lecture slides: the batch's published decks, grouped by chapter.
export default function SlideDecks() {
  const { batchId } = useParams();
  const navigate = useNavigate();
  const mx = useHomeMx();
  const { data, isLoading } = useGetSlideDecksQuery(batchId);
  const groups = useMemo(() => {
    const m = new Map();
    for (const d of data || []) {
      const k = d.chapter?.title || "Other slides";
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(d);
    }
    return [...m.entries()].sort(([a], [b]) => (a === "Other slides") - (b === "Other slides"));
  }, [data]);

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 960, mx }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
        <IconButton size="small" onClick={() => goBack(navigate, `/batches/${batchId}`)}><ArrowLeft size={18} /></IconButton>
        <Presentation size={20} />
        <Typography variant="h6" fontWeight={700}>Lecture slides</Typography>
      </Box>
      {isLoading ? (
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 2 }}>
          {[0, 1, 2].map((i) => <Skeleton key={i} variant="rounded" height={190} />)}
        </Box>
      ) : !data?.length ? (
        <EmptyState icon={Presentation} title="No slides yet" description="Your teachers' lecture slides will show here." />
      ) : groups.map(([chapter, decks]) => (
        <Box key={chapter} sx={{ mb: 3 }}>
          <Typography variant="subtitle2" color="text.secondary" fontWeight={700} sx={{ mb: 1 }}>{chapter}</Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 2 }}>
            {decks.map((d) => (
              <Paper key={d._id} variant="outlined" sx={{ borderRadius: 3, overflow: "hidden" }}>
                <ButtonBase onClick={() => navigate(`/batches/${batchId}/slides/${d._id}`)} sx={{ display: "block", width: "100%", textAlign: "left" }}>
                  <Box sx={{ aspectRatio: "16 / 9", overflow: "hidden", borderBottom: 1, borderColor: "divider" }}>
                    {d.first && <SlideView deck={d} slide={{ bullets: [], left: [], right: [], ...d.first }} width={320} total={0} />}
                  </Box>
                  <Box sx={{ p: 1.5 }}>
                    <Typography variant="body2" fontWeight={700}>{d.title}</Typography>
                    <Typography variant="caption" color="text.secondary">{d.count} slide{d.count === 1 ? "" : "s"} · {new Date(d.updatedAt).toLocaleDateString()}</Typography>
                  </Box>
                </ButtonBase>
              </Paper>
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  );
}
