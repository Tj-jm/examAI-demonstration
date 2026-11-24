import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Typography, Paper, LinearProgress, Collapse } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { PlayCircle, FileText, Paperclip, Check, ChevronDown, ChevronUp } from "lucide-react";

// Groups the same flat `lectures` array LectureList.jsx's simple layout
// already fetches — chapter and topic order come from the API (see
// lectureController.js's getLectures), everything else (watched/total
// counts at every level) is derived here from each lecture's own `watched`
// boolean. No second endpoint: there's nothing here the flat list doesn't
// already carry, just a different arrangement of it.
//
// The flat array is in the batch's outline order, and each chapter's and
// topic's `order` is its rank in that outline (backend
// utils/courseOutline.js), so grouping by id and sorting by `order` keeps
// exactly the order the admin set.
const groupLectures = (lectures) => {
  const chapters = new Map();

  for (const lecture of lectures) {
    const chapterId = lecture.chapter?._id || "none";
    if (!chapters.has(chapterId)) {
      chapters.set(chapterId, {
        id: chapterId,
        title: lecture.chapter?.title || "Other",
        order: lecture.chapter?.order ?? 0,
        topics: new Map(),
        // Lectures filed directly under the chapter, with no topic of
        // their own — rendered under a "General" label, not a topic one.
        loose: [],
      });
    }
    const chapter = chapters.get(chapterId);

    if (lecture.topic) {
      const topicId = lecture.topic._id;
      if (!chapter.topics.has(topicId)) {
        chapter.topics.set(topicId, {
          id: topicId,
          title: lecture.topic.title,
          order: lecture.topic.order ?? 0,
          lectures: [],
        });
      }
      chapter.topics.get(topicId).lectures.push(lecture);
    } else {
      chapter.loose.push(lecture);
    }
  }

  return [...chapters.values()]
    .sort((a, b) => a.order - b.order)
    .map((chapter) => ({
      ...chapter,
      topics: [...chapter.topics.values()].sort((a, b) => a.order - b.order),
    }));
};

const countWatched = (lectures) => lectures.filter((l) => l.watched).length;

const chapterTotals = (chapter) => {
  const total = chapter.loose.length + chapter.topics.reduce((n, t) => n + t.lectures.length, 0);
  const watched = countWatched(chapter.loose) + chapter.topics.reduce((n, t) => n + countWatched(t.lectures), 0);
  return { watched, total };
};

// Same watched/play icon, title, Notes indicator and attachment count the
// simple layout's row already shows (LectureList.jsx) — just laid out as a
// plain divided list row (per the mockup) instead of its own bordered card,
// and reused here rather than duplicating the icon logic twice.
function LectureRow({ lecture, batchId, navigate, isLast }) {
  return (
    <Box
      onClick={() => navigate(`/batches/${batchId}/lectures/${lecture._id}`)}
      sx={{
        py: 1.5,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        borderBottom: isLast ? "none" : "1px solid",
        borderColor: "divider",
      }}
    >
      <Box sx={{
        width: 34, height: 34, borderRadius: "50%", flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        bgcolor: (theme) => alpha(lecture.watched ? theme.palette.success.main : theme.palette.primary.main, 0.15),
        color: lecture.watched ? "success.main" : "primary.main",
      }}>
        {lecture.watched ? <Check size={16} /> : <PlayCircle size={16} />}
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontWeight: 500, fontSize: 14 }} noWrap>{lecture.title}</Typography>
        {lecture.hasNotes && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "flex", alignItems: "center", gap: 0.5, mt: 0.25, fontSize: 12 }}
          >
            <FileText size={11} /> Notes
          </Typography>
        )}
      </Box>
      {lecture.attachmentCount > 0 && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexShrink: 0, color: "text.secondary" }}>
          <Paperclip size={13} />
          <Typography variant="caption">{lecture.attachmentCount}</Typography>
        </Box>
      )}
    </Box>
  );
}

function ChapterSection({ chapter, batchId, navigate, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);
  const { watched, total } = chapterTotals(chapter);
  const pct = total > 0 ? (watched / total) * 100 : 0;

  // One continuous, ordered list of rows to render — loose ("General")
  // lectures first, then each topic group — so "is this the last row"
  // (for the divider) is a simple flat-array check rather than juggling
  // "last of this group vs. last overall" across two separate maps.
  const groups = [
    ...(chapter.loose.length > 0 ? [{ id: "general", title: chapter.topics.length > 0 ? "General" : null, lectures: chapter.loose }] : []),
    ...chapter.topics.map((t) => ({ id: t.id, title: t.title, lectures: t.lectures, count: true })),
  ];

  return (
    <Paper variant="outlined" sx={{ borderRadius: 3, mb: 2, overflow: "hidden" }}>
      <Box
        sx={{ p: 2, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}
        onClick={() => setOpen((v) => !v)}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 600, fontSize: 17 }} noWrap>{chapter.title}</Typography>
          <LinearProgress variant="determinate" value={pct} sx={{ mt: 1, height: 5, borderRadius: 3, maxWidth: 280 }} />
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0 }}>
          <Typography variant="caption" color="text.secondary">{watched}/{total}</Typography>
          {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </Box>
      </Box>

      <Collapse in={open}>
        <Box sx={{ px: 2, pb: 1 }}>
          {groups.map((group) => (
            <Box key={group.id} sx={{ mb: 1 }}>
              {group.title && (
                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", pt: 1, pb: 0.5 }}>
                  <Typography
                    variant="caption"
                    sx={{ display: "flex", alignItems: "center", gap: 0.75, fontWeight: 600, letterSpacing: 0.5, color: "text.secondary", textTransform: "uppercase" }}
                  >
                    <Box component="span" sx={{ width: 4, height: 4, borderRadius: "50%", bgcolor: "text.secondary", flexShrink: 0 }} />
                    {group.title}
                  </Typography>
                  {group.count && (
                    <Typography variant="caption" color="text.secondary">
                      {countWatched(group.lectures)}/{group.lectures.length}
                    </Typography>
                  )}
                </Box>
              )}
              {group.lectures.map((lecture, i) => (
                <LectureRow
                  key={lecture._id}
                  lecture={lecture}
                  batchId={batchId}
                  navigate={navigate}
                  isLast={i === group.lectures.length - 1}
                />
              ))}
            </Box>
          ))}
        </Box>
      </Collapse>
    </Paper>
  );
}

export default function LectureListHierarchical({ lectures, batchId }) {
  const navigate = useNavigate();
  const chapters = useMemo(() => groupLectures(lectures), [lectures]);

  const totalWatched = countWatched(lectures);
  const total = lectures.length;
  const overallPct = total > 0 ? (totalWatched / total) * 100 : 0;

  // Opens on the first chapter that isn't fully done yet, so a returning
  // student lands with the relevant section already expanded rather than
  // having to hunt for where they left off. Falls back to the first
  // chapter if everything (or nothing) is complete.
  const defaultOpenId = useMemo(() => {
    const firstIncomplete = chapters.find((c) => {
      const t = chapterTotals(c);
      return t.total > 0 && t.watched < t.total;
    });
    return (firstIncomplete || chapters[0])?.id;
  }, [chapters]);

  return (
    <Box>
      <Box sx={{ mb: 3, display: "flex", alignItems: "center", gap: 2 }}>
        <LinearProgress variant="determinate" value={overallPct} sx={{ flex: 1, height: 6, borderRadius: 3 }} />
        <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
          {totalWatched}/{total} watched
        </Typography>
      </Box>

      {chapters.map((chapter) => (
        <ChapterSection
          key={chapter.id}
          chapter={chapter}
          batchId={batchId}
          navigate={navigate}
          defaultOpen={chapter.id === defaultOpenId}
        />
      ))}
    </Box>
  );
}
