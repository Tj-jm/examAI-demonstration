import { useState } from "react";
import { Box, Typography, Paper, Chip, Collapse } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { BookOpen, Layers, ChevronDown, ChevronUp } from "lucide-react";
import { GroupHeader, sectionsByGroup } from "./OutlineGroups";

// Practice and archive topics laid out like the lecture list: one card per
// chapter, in the batch's outline order (chapterOrder from the API), each
// listing its topics and, when it has one, a "Whole chapter" row for the
// questions filed under the chapter with no topic. Named groups (papers,
// terms) head their chapters.
//
// topics:       [{ _id, title, chapter: { _id, title }, group, questionCount }]
// chapterPools: [{ _id, title, group, questionCount }]
// onPick(id):   a topic id, or "chapter:<id>" for a whole chapter.

const buildChapters = ({ topics, chapterPools, chapterOrder }) => {
  const byId = new Map();
  const ensure = (id, title, group) => {
    if (!byId.has(id)) byId.set(id, { _id: id, title, group: group || null, pool: null, topics: [] });
    const c = byId.get(id);
    if (!c.group && group) c.group = group;
    return c;
  };
  for (const t of topics) {
    const id = String(t.chapter?._id || "none");
    ensure(id, t.chapter?.title || "Other", t.group).topics.push(t);
  }
  for (const p of chapterPools) ensure(String(p._id), p.title, p.group).pool = p;
  const rank = new Map((chapterOrder || []).map((id, i) => [String(id), i]));
  return [...byId.values()].sort((a, b) => (rank.get(a._id) ?? 1e9) - (rank.get(b._id) ?? 1e9));
};

function Row({ icon: Icon, title, caption, count, onClick, isLast }) {
  return (
    <Box
      onClick={onClick}
      sx={{
        py: 1.25, px: 2, cursor: "pointer", display: "flex", alignItems: "center", gap: 1.5,
        borderBottom: isLast ? "none" : "1px solid", borderColor: "divider",
        transition: "background-color 120ms", "&:hover": { bgcolor: "action.hover" },
      }}
    >
      <Box sx={{
        width: 32, height: 32, borderRadius: 2, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
        bgcolor: (theme) => alpha(theme.palette.primary.main, 0.1), color: "primary.main",
      }}>
        <Icon size={15} />
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontWeight: 500, fontSize: 14 }} noWrap>{title}</Typography>
        {caption && <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>{caption}</Typography>}
      </Box>
      <Chip size="small" label={`${count} question${count === 1 ? "" : "s"}`} variant="outlined" />
    </Box>
  );
}

function ChapterCard({ chapter, onPick, defaultOpen, extra }) {
  const [open, setOpen] = useState(defaultOpen);
  const total = chapter.topics.reduce((n, t) => n + (t.questionCount || 0), 0) + (chapter.pool?.questionCount || 0);
  const rows = [
    ...(chapter.pool ? [{ key: `pool-${chapter._id}`, icon: Layers, title: "Whole chapter", caption: "Questions on the chapter as a whole", count: chapter.pool.questionCount, pick: `chapter:${chapter.pool._id}` }] : []),
    ...chapter.topics.map((t) => ({ key: t._id, icon: BookOpen, title: t.title, count: t.questionCount, pick: t._id })),
  ];
  return (
    <Paper variant="outlined" sx={{ borderRadius: 3, mb: 1.5, overflow: "hidden" }}>
      <Box
        onClick={() => setOpen((v) => !v)}
        sx={{ p: 2, cursor: "pointer", display: "flex", alignItems: "center", gap: 2 }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 600, fontSize: 16 }} noWrap>{chapter.title}</Typography>
          <Typography variant="caption" color="text.secondary">
            {total} question{total === 1 ? "" : "s"}
            {chapter.topics.length > 0 && ` · ${chapter.topics.length} topic${chapter.topics.length === 1 ? "" : "s"}`}
          </Typography>
        </Box>
        {extra?.(chapter._id)}
        <Box sx={{ color: "text.secondary", display: "flex" }}>{open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</Box>
      </Box>
      <Collapse in={open} timeout={200} unmountOnExit>
        <Box sx={{ borderTop: "1px solid", borderColor: "divider" }}>
          {rows.map((r, i) => (
            <Row key={r.key} icon={r.icon} title={r.title} caption={r.caption} count={r.count} isLast={i === rows.length - 1} onClick={() => onPick(r.pick)} />
          ))}
        </Box>
      </Collapse>
    </Paper>
  );
}

// extra: (chapterId) => something to show in the chapter's header (a Slides link).
export default function ChapterCards({ topics = [], chapterPools = [], chapterOrder, groups = [], onPick, extra }) {
  const chapters = buildChapters({ topics, chapterPools, chapterOrder });
  let first = true;
  return (
    <Box>
      {sectionsByGroup(chapters, groups).map((section, si) => (
        <Box key={section.key}>
          <GroupHeader title={section.title} count={section.items.length} first={si === 0} />
          {section.items.map((c) => {
            const open = first;
            first = false;
            return <ChapterCard key={c._id} chapter={c} onPick={onPick} defaultOpen={open} extra={extra} />;
          })}
        </Box>
      ))}
    </Box>
  );
}
