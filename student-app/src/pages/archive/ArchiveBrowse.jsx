import { useEffect } from "react";
import { Box, Typography, Paper, Chip, Skeleton, IconButton } from "@mui/material";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, BookOpen, CircleCheckBig, ToggleLeft, PenLine, Newspaper, Target } from "lucide-react";
import { GroupChips, inGroup } from "../../components/OutlineGroups";
import ChapterCards from "../../components/ChapterCards";
import { useGetArchiveTopicsQuery, useGetArchiveFiltersQuery, useGetBatchQuery, useGetArchiveWeakTopicsQuery } from "../../api/contentApi";
import EmptyState from "../../components/EmptyState";
import { BatchContextCard } from "../../components/BatchSwitcher";
import useUrlState from "../../hooks/useUrlState";

const COUNT_OPTIONS = [5, 10, 20, 50];

const TYPES = [
  ["mcq", "Multiple choice", CircleCheckBig],
  ["mtf", "True / false", ToggleLeft],
  ["written", "Written", PenLine],
  ["passage", "Passage", Newspaper],
];

// A single-select chip row for one filter dimension (board, subject, year).
// Hides itself only when there's truly nothing to filter by — zero options
// means the batch's archive has no content along that dimension at all.
function FilterChipRow({ label, options, value, onChange, getKey, getLabel }) {
  if (!options || options.length < 1) return null;
  return (
    <>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>{label}</Typography>
      <Box sx={{ display: "flex", gap: 1, mb: 3, flexWrap: "wrap" }}>
        <Chip label="All" size="small" onClick={() => onChange("")} color={value === "" ? "primary" : "default"} variant={value === "" ? "filled" : "outlined"} />
        {options.map((option) => {
          const key = getKey(option);
          return (
            <Chip
              key={key}
              label={getLabel(option)}
              size="small"
              onClick={() => onChange(key)}
              color={value === key ? "primary" : "default"}
              variant={value === key ? "filled" : "outlined"}
            />
          );
        })}
      </Box>
    </>
  );
}

// The archive's own version of PracticeTopics.jsx — same "pick a count,
// pick types, pick a topic" flow, minus everything that only makes sense
// inside normal batch practice (favorites, the custom-exam builder, AI
// written-grading). A per-batch module, like Doubts/Live classes: reached
// from BatchHome, filtered server-side to just this batch's own assigned
// boards/exams/books (Batch.archiveAuthorities).
export default function ArchiveBrowse() {
  const navigate = useNavigate();
  const { batchId } = useParams();
  const [count, setCount] = useUrlState("n", 10);
  const [types, setTypes] = useUrlState("t", ["mcq", "mtf", "written", "passage"]);
  const [authority, setAuthority] = useUrlState("board", "");
  const [year, setYear] = useUrlState("year", "");
  const [subject, setSubject] = useUrlState("subject", "");
  const [group, setGroup] = useUrlState("group", "");

  const { data: batch } = useGetBatchQuery(batchId);
  // currentData (not data) for the clean-up below: it is empty while a new
  // selection is still loading, so a stale list never clears a fresh pick.
  const { data: filterOptions, currentData: currentFilters } = useGetArchiveFiltersQuery({ batchId, authority, year, subject });

  // A choice that no longer has any questions under the others (a year the
  // newly picked board never had, say) is cleared rather than left
  // selected on an empty list.
  useEffect(() => {
    if (!currentFilters) return;
    if (authority && !currentFilters.authorities?.some((a) => a._id === authority)) setAuthority("");
    if (year && !currentFilters.years?.some((y) => String(y) === String(year))) setYear("");
    if (subject && !currentFilters.subjects?.some((s) => s._id === subject)) setSubject("");
  }, [currentFilters, authority, year, subject]);
  const { data, isLoading } = useGetArchiveTopicsQuery({ batchId, authority, year, subject, types: types.join(",") });
  // In the batch's outline order; a picked group narrows them.
  const groups = data?.groups || [];
  const topics = (data?.topics || []).filter((t) => inGroup(t, group));
  const chapterPools = (data?.chapterPools || []).filter((c) => inGroup(c, group));
  const { data: weak, isLoading: weakLoading } = useGetArchiveWeakTopicsQuery(batchId);

  const toggleType = (value) => {
    setTypes((prev) => {
      if (prev.includes(value)) {
        if (prev.length === 1) return prev;
        return prev.filter((t) => t !== value);
      }
      return [...prev, value];
    });
  };

  const goToSession = (topicOrChapter) =>
    navigate(`/batches/${batchId}/archive/session/${topicOrChapter}?count=${count}&types=${types.join(",")}&authority=${authority}&year=${year}`);

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 800, mx: "var(--home-mx)" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
        <IconButton size="small" onClick={() => navigate(`/batches/${batchId}/archive`)}><ArrowLeft size={18} /></IconButton>
      </Box>

      <BatchContextCard batch={batch} pageName="Browse & Practice" section={{ label: "Archive", to: `/batches/${batchId}/archive` }} />

      <FilterChipRow
        label="Board / exam / book"
        options={filterOptions?.authorities}
        value={authority}
        onChange={setAuthority}
        getKey={(a) => a._id}
        getLabel={(a) => a.shortName || a.name}
      />

      <FilterChipRow
        label="Subject"
        options={filterOptions?.subjects}
        value={subject}
        onChange={setSubject}
        getKey={(s) => s._id}
        getLabel={(s) => s.title}
      />

      <FilterChipRow
        label="Year"
        options={filterOptions?.years}
        value={year}
        onChange={setYear}
        getKey={(y) => String(y)}
        getLabel={(y) => String(y)}
      />

      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
        Questions per session
      </Typography>
      <Box sx={{ display: "flex", gap: 1, mb: 3 }}>
        {COUNT_OPTIONS.map((n) => (
          <Chip key={n} label={n} size="small" onClick={() => setCount(n)} color={count === n ? "primary" : "default"} variant={count === n ? "filled" : "outlined"} />
        ))}
        <Chip label="All" size="small" onClick={() => setCount(100)} color={count === 100 ? "primary" : "default"} variant={count === 100 ? "filled" : "outlined"} />
      </Box>

      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
        Question types
      </Typography>
      <Box sx={{ display: "flex", gap: 1, mb: 3, flexWrap: "wrap" }}>
        {TYPES.map(([value, label, Icon]) => (
          <Chip
            key={value}
            icon={<Icon size={14} />}
            label={label}
            size="small"
            onClick={() => toggleType(value)}
            color={types.includes(value) ? "primary" : "default"}
            variant={types.includes(value) ? "filled" : "outlined"}
          />
        ))}
      </Box>

      {!weakLoading && weak?.readyForPersonalized && (
        <Paper
          variant="outlined"
          onClick={() => navigate(`/batches/${batchId}/archive/session/personalized?count=${count}&types=${types.join(",")}`)}
          sx={{
            p: 2.5, borderRadius: 3, mb: 3, cursor: "pointer",
            display: "flex", alignItems: "center", gap: 2,
            bgcolor: "primary.main", color: "primary.contrastText", borderColor: "primary.main",
          }}
        >
          <Box sx={{ width: 40, height: 40, borderRadius: 2, bgcolor: "rgba(255,255,255,0.18)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Target size={19} />
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontWeight: 500 }}>Practice your weak spots</Typography>
            <Typography variant="caption" sx={{ opacity: 0.85 }}>
              Pulled from {weak.topics.slice(0, 3).map((t) => `${t.title} (${t.accuracy}%)`).join(", ")}
            </Typography>
          </Box>
        </Paper>
      )}

      {isLoading ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} variant="rounded" height={60} />)}
        </Box>
      ) : (data?.topics || []).length === 0 && (data?.chapterPools || []).length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="No archive questions match yet"
          description="Try a different board, year or subject."
        />
      ) : (
        <>
          <GroupChips groups={groups} items={[...(data?.topics || []), ...(data?.chapterPools || [])]} value={group} onChange={setGroup} sx={{ mb: 3 }} />
          {/* One card per chapter, in the batch's outline order, like the
              lecture list. */}
          <ChapterCards
            topics={topics}
            chapterPools={chapterPools}
            chapterOrder={data?.chapterOrder}
            groups={groups}
            onPick={goToSession}
          />
        </>
      )}
    </Box>
  );
}
