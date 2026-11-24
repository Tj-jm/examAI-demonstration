import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Typography, Paper, Chip, LinearProgress, Collapse } from "@mui/material";
import { PlayCircle, FileText, Paperclip, Check, ChevronDown, ChevronUp } from "lucide-react";

// Same chapter/topic grouping as LectureListHierarchical.jsx (see that
// file's comments for why grouping happens client-side, and why groups are
// sorted by the chapter's/topic's own `order` rather than assumed to be
// contiguous in the fetched list) — this is the "cards" row-style variant:
// each lecture in its own bordered card, an outlined pill for the
// attachment count, rather than the flat divided-list look.
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

function LectureRow({ lecture, batchId, navigate }) {
  return (
    <Paper
      variant="outlined"
      sx={{ p: 1.5, borderRadius: 2, cursor: "pointer", display: "flex", alignItems: "center", gap: 1.5, mb: 1 }}
      onClick={() => navigate(`/batches/${batchId}/lectures/${lecture._id}`)}
    >
      <Box sx={{
        width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
        bgcolor: lecture.watched ? "success.main" : "action.hover",
        color: lecture.watched ? "#fff" : "text.secondary",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {lecture.watched ? <Check size={15} /> : <PlayCircle size={15} />}
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontWeight: 500, fontSize: 14 }} noWrap>{lecture.title}</Typography>
        {lecture.hasNotes && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "flex", alignItems: "center", gap: 0.5, mt: 0.25 }}
          >
            <FileText size={11} /> Notes
          </Typography>
        )}
      </Box>
      {lecture.attachmentCount > 0 && (
        <Chip size="small" icon={<Paperclip size={12} />} label={lecture.attachmentCount} variant="outlined" sx={{ flexShrink: 0 }} />
      )}
    </Paper>
  );
}

function ChapterSection({ chapter, batchId, navigate, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);
  const { watched, total } = chapterTotals(chapter);
  const pct = total > 0 ? (watched / total) * 100 : 0;

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, mb: 1.5, overflow: "hidden" }}>
      <Box
        sx={{ p: 2, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}
        onClick={() => setOpen((v) => !v)}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 500, fontSize: 15 }} noWrap>{chapter.title}</Typography>
          <LinearProgress variant="determinate" value={pct} sx={{ mt: 1, height: 4, borderRadius: 2, maxWidth: 260 }} />
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0 }}>
          <Typography variant="caption" color="text.secondary">{watched}/{total}</Typography>
          {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </Box>
      </Box>

      <Collapse in={open}>
        <Box sx={{ px: 2, pb: 2 }}>
          {chapter.loose.length > 0 && (
            <Box sx={{ mb: 1.5 }}>
              {/* Only labelled when the chapter also has topic groups —
                  otherwise every lecture in the chapter is "loose" and a
                  "General" header above all of them would be redundant. */}
              {chapter.topics.length > 0 && (
                <Typography
                  variant="caption"
                  sx={{ display: "block", mb: 1, fontWeight: 600, letterSpacing: 0.5, color: "text.secondary", textTransform: "uppercase" }}
                >
                  General
                </Typography>
              )}
              {chapter.loose.map((lecture) => (
                <LectureRow key={lecture._id} lecture={lecture} batchId={batchId} navigate={navigate} />
              ))}
            </Box>
          )}
          {chapter.topics.map((topic) => (
            <Box key={topic.id} sx={{ mb: 1.5 }}>
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
                <Typography
                  variant="caption"
                  sx={{ fontWeight: 600, letterSpacing: 0.5, color: "text.secondary", textTransform: "uppercase" }}
                >
                  {topic.title}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {countWatched(topic.lectures)}/{topic.lectures.length}
                </Typography>
              </Box>
              {topic.lectures.map((lecture) => (
                <LectureRow key={lecture._id} lecture={lecture} batchId={batchId} navigate={navigate} />
              ))}
            </Box>
          ))}
        </Box>
      </Collapse>
    </Paper>
  );
}

export default function LectureListHierarchicalCards({ lectures, batchId }) {
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
      <Box sx={{ mb: 2.5 }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 0.75 }}>
          <Typography variant="caption" color="text.secondary">Overall progress</Typography>
          <Typography variant="caption" color="text.secondary">{totalWatched}/{total} watched</Typography>
        </Box>
        <LinearProgress variant="determinate" value={overallPct} sx={{ height: 6, borderRadius: 3 }} />
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
