import { useState } from "react";
import { Box, IconButton, Skeleton } from "@mui/material";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Megaphone } from "lucide-react";
import { useGetBatchNoticesQuery, useGetBatchQuery } from "../api/contentApi";
import { BatchContextCard } from "../components/BatchSwitcher";
import NoticeCard from "../components/NoticeCard";
import StudentPager from "../components/StudentPager";
import EmptyState from "../components/EmptyState";
import { useTerms } from "../BrandingContext";

// Reached from a specific batch's own home (BatchHome) — unlike Lectures,
// Exams and Practice, there is no top-level "Notices" nav tab, so this is
// always opened already knowing which batch, and never needs the
// useActiveBatch switcher those three pages use. It still shows the same
// context card they show once inside a batch, for the same reason: the
// batch a page's content belongs to should never be left to a back-arrow
// alone to imply.
export default function NoticeCentral() {
  const terms = useTerms();
  const { batchId } = useParams();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);

  const { data: batch } = useGetBatchQuery(batchId);
  const { data, isLoading, isFetching } = useGetBatchNoticesQuery({ batchId, page });
  const notices = data?.notices || [];

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 640, mx: "auto" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
        <IconButton size="small" onClick={() => navigate(`/batches/${batchId}`)}><ArrowLeft size={18} /></IconButton>
      </Box>

      <BatchContextCard batch={batch} pageName="Notice Central" />

      {isLoading ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <Skeleton variant="rounded" height={220} />
          <Skeleton variant="rounded" height={220} />
        </Box>
      ) : notices.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="No notices here yet"
          description={`Announcements for this ${terms.batch} will show up here as soon as one is posted.`}
          secondaryAction={{ label: `Back to ${terms.batch}`, onClick: () => navigate(`/batches/${batchId}`) }}
        />
      ) : (
        <>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, opacity: isFetching ? 0.6 : 1, transition: "opacity 120ms" }}>
            {notices.map((notice) => <NoticeCard key={notice._id} notice={notice} />)}
          </Box>

          <StudentPager page={data.page} pages={data.pages} total={data.total} onChange={setPage} />
        </>
      )}
    </Box>
  );
}
