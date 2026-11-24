import { useState } from "react";
import { Box, Typography, Paper, Chip, Skeleton, IconButton } from "@mui/material";
import { useNavigate } from "react-router-dom";
import { PlayCircle, FileText, Paperclip, Check, ArrowLeft, Video } from "lucide-react";
import { useGetLecturesQuery } from "../../api/contentApi";
import { useActiveBatch } from "../../hooks/useActiveBatch";
import { useTerms, useBranding, useHomeMx } from "../../BrandingContext";
import { BatchContext, NoBatchesGate } from "../../components/BatchSwitcher";
import EmptyState from "../../components/EmptyState";
import LectureListHierarchical from "./LectureListHierarchical";
import LectureListHierarchicalCards from "./LectureListHierarchicalCards";
import { GroupChips, GroupHeader, sectionsByGroup, inGroup } from "../../components/OutlineGroups";

// Reachable two ways — see useActiveBatch for why that no longer means two
// screens. From the main nav this is the whole page, batch and all; from a
// specific batch's own home it opens straight into that batch's lectures,
// same as it always did.
export default function LectureList() {
  const terms = useTerms();
  const navigate = useNavigate();
  const { batchId, activeBatch, enrolled, loadingBatches, showSwitcher, fromRoute, setActiveBatch } = useActiveBatch();
  const { data, isLoading } = useGetLecturesQuery(batchId, { skip: !batchId });
  const { lectureListStyle } = useBranding();
  const mx = useHomeMx();
  const [group, setGroup] = useState("");

  if (loadingBatches) {
    return (
      <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 800, mx }}>
        <Skeleton variant="rounded" height={40} sx={{ mb: 3, maxWidth: 300 }} />
        <Skeleton variant="rounded" height={64} />
      </Box>
    );
  }

  if (enrolled.length === 0) {
    return <Box sx={{ p: { xs: 2, md: 4 } }}><NoBatchesGate /></Box>;
  }

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 800, mx }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: showSwitcher ? 2 : 3 }}>
        {fromRoute && (
          <IconButton size="small" onClick={() => navigate(`/batches/${batchId}`)}><ArrowLeft size={18} /></IconButton>
        )}
        {!fromRoute && <Typography variant="h6" sx={{ fontWeight: 500, fontSize: 17 }}>Lectures</Typography>}
      </Box>

      <BatchContext batch={activeBatch} enrolled={enrolled} batchId={batchId} fromRoute={fromRoute} pageName="Lectures" onChange={setActiveBatch} />

      {isLoading ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} variant="rounded" height={64} />)}
        </Box>
      ) : (data?.lectures || []).length === 0 ? (
        <EmptyState
          icon={Video}
          title="No lectures published"
          description={`Nothing has been added to this ${terms.batch} yet. New lectures appear here as soon as they go up.`}
          secondaryAction={fromRoute ? { label: `Back to ${terms.batch}`, onClick: () => navigate(`/batches/${batchId}`) } : undefined}
        />
      ) : (
        <>
          <GroupChips groups={data.groups} items={data.lectures} value={group} onChange={setGroup} sx={{ mb: 3 }} />
          {/* Lectures arrive in the batch's outline order; with named groups
              each group gets its own section, in that order. */}
          {sectionsByGroup(data.lectures.filter((l) => inGroup(l, group)), data.groups).map((section, i) => (
            <Box key={section.key}>
              <GroupHeader title={section.title} count={section.items.length} first={i === 0} />
              {lectureListStyle === "hierarchical" ? (
                <LectureListHierarchical lectures={section.items} batchId={batchId} />
              ) : lectureListStyle === "hierarchicalCards" ? (
                <LectureListHierarchicalCards lectures={section.items} batchId={batchId} />
              ) : (
                <SimpleList lectures={section.items} batchId={batchId} navigate={navigate} />
              )}
            </Box>
          ))}
        </>
      )}
    </Box>
  );
}

function SimpleList({ lectures, batchId, navigate }) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      {lectures.map((l) => (
        <Paper
          key={l._id}
          variant="outlined"
          sx={{ p: 2, borderRadius: 2, cursor: "pointer", display: "flex", alignItems: "center", gap: 2 }}
          onClick={() => navigate(`/batches/${batchId}/lectures/${l._id}`)}
        >
          <Box sx={{
            width: 38, height: 38, borderRadius: 2, flexShrink: 0,
            bgcolor: l.watched ? "success.main" : "action.hover",
            color: l.watched ? "#fff" : "text.secondary",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {l.watched ? <Check size={17} /> : <PlayCircle size={17} />}
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontWeight: 500, fontSize: 14 }} noWrap>{l.title}</Typography>
            <Typography variant="caption" color="text.secondary" noWrap>
              {[l.chapter?.title, l.topic?.title].filter(Boolean).join(" · ")}
            </Typography>
          </Box>
          <Box sx={{ display: "flex", gap: 0.5, flexShrink: 0 }}>
            {l.hasNotes && <Chip size="small" icon={<FileText size={12} />} label="Notes" variant="outlined" />}
            {l.attachmentCount > 0 && <Chip size="small" icon={<Paperclip size={12} />} label={l.attachmentCount} variant="outlined" />}
          </Box>
        </Paper>
      ))}
    </Box>
  );
}
