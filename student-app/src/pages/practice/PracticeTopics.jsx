import { useEffect } from "react";
import { Box, Typography, Paper, Chip, Skeleton, IconButton } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, BookOpen, Target, Clock, Star, CircleCheckBig, ToggleLeft, PenLine, Newspaper, Layers, Presentation } from "lucide-react";
import { useGetPracticeTopicsQuery, useGetWeakTopicsQuery, useGetFavoriteIdsQuery, useGetLearnTopicsQuery, useGetSlideDecksQuery } from "../../api/contentApi";
import { useActiveBatch } from "../../hooks/useActiveBatch";
import { BatchContext, NoBatchesGate } from "../../components/BatchSwitcher";
import EmptyState from "../../components/EmptyState";
import { SKILL_TYPES, skillTypeLabel } from "../../constants/skillTypes";
import { GroupChips, inGroup } from "../../components/OutlineGroups";
import ChapterCards from "../../components/ChapterCards";
import { useTerms, useHomeMx } from "../../BrandingContext";
import useUrlState from "../../hooks/useUrlState";

const COUNT_OPTIONS = [5, 10, 20, 50];

const TYPES = [
  ["mcq", "Multiple choice", CircleCheckBig],
  ["mtf", "True / false", ToggleLeft],
  ["written", "Written", PenLine],
  ["passage", "Passage", Newspaper],
];

// Reachable two ways — see useActiveBatch for why that no longer means two
// screens.
export default function PracticeTopics() {
  const terms = useTerms();
  const mx = useHomeMx();
  const navigate = useNavigate();
  const theme = useTheme();
  const { batchId, activeBatch, enrolled, loadingBatches, showSwitcher, fromRoute, setActiveBatch } = useActiveBatch();
  const [count, setCount] = useUrlState("n", 10);
  const [types, setTypes] = useUrlState("t", ["mcq", "mtf", "written", "passage"]);
  const [subjectFilter, setSubjectFilter] = useUrlState("subject", "");
  const [skillFilter, setSkillFilter] = useUrlState("skill", "");
  const [groupFilter, setGroupFilter] = useUrlState("group", "");
  const aiAvailable = Boolean(activeBatch?.features?.aiAssist);
  // written is never actually offered when this batch has no AI to grade
  // it — filtered out here rather than trusted from `types` state alone,
  // since activeBatch loads asynchronously and may still be null the
  // instant a click fires.
  const effectiveTypes = types.filter((t) => t !== "written" || aiAvailable);

  const { data, isLoading } = useGetPracticeTopicsQuery(
    { batchId, types: effectiveTypes.join(","), skillType: skillFilter || undefined },
    { skip: !batchId }
  );
  const { data: weak, isLoading: weakLoading } = useGetWeakTopicsQuery(batchId, { skip: !batchId });
  const { data: favoriteData } = useGetFavoriteIdsQuery(batchId, { skip: !batchId });
  const { data: learn } = useGetLearnTopicsQuery(batchId, { skip: !batchId });
  // A chapter with published lecture slides links to them.
  const { data: decks } = useGetSlideDecksQuery(batchId, { skip: !batchId || !activeBatch?.features?.lectureSlides });
  const slidesFor = (chapterId) => {
    const mine = (decks || []).filter((d) => String(d.chapter?._id) === String(chapterId));
    if (!mine.length) return null;
    return (
      <Chip
        size="small" variant="outlined" icon={<Presentation size={14} />} label={mine.length === 1 ? "Slides" : `Slides (${mine.length})`}
        onClick={(e) => { e.stopPropagation(); navigate(mine.length === 1 ? `/batches/${batchId}/slides/${mine[0]._id}` : `/batches/${batchId}/slides`); }}
      />
    );
  };

  const toggleType = (value) => {
    if (value === "written" && !aiAvailable) return; // disabled, not toggleable
    setTypes((prev) => {
      if (prev.includes(value)) {
        if (prev.length === 1) return prev; // always leave at least one selected
        return prev.filter((t) => t !== value);
      }
      return [...prev, value];
    });
  };

  // A batch covering several subjects gets a subject filter over its topic
  // and chapter lists; a one-subject batch doesn't need one.
  const subjects = [];
  for (const item of [...(data?.topics || []), ...(data?.chapterPools || [])]) {
    if (item.subject?._id && !subjects.some((s) => s._id === item.subject._id)) subjects.push(item.subject);
  }
  subjects.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title));
  const activeSubject = subjects.some((s) => s._id === subjectFilter) ? subjectFilter : "";
  const inSubject = (item) => !activeSubject || item.subject?._id === activeSubject;
  // With a skill picked, topics that have none of it drop out.
  const hasSkill = (item) => !skillFilter || item.questionCount > 0;
  // Already in the batch's outline order; a picked group narrows them.
  const groups = data?.groups || [];
  const topics = (data?.topics || []).filter((t) => inSubject(t) && hasSkill(t) && inGroup(t, groupFilter));
  const chapterPools = (data?.chapterPools || []).filter((c) => inSubject(c) && hasSkill(c) && inGroup(c, groupFilter));

  // Skills this batch has questions for, in the taxonomy's order, untagged
  // ones last. A picked skill that no longer has any falls back to all.
  const skillCounts = new Map((data?.skills || []).map((x) => [x.skillType, x.count]));
  const skills = [...SKILL_TYPES.map((x) => x.value), "none"].filter((v) => skillCounts.get(v) > 0);
  // A skill that's gone (another question type deselected) clears itself.
  useEffect(() => {
    if (data && skillFilter && !skills.includes(skillFilter)) setSkillFilter("");
  }, [data, skillFilter, skills.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const activeSkill = skillFilter;

  // The skill applies to topic and chapter sessions; weak spots and
  // favorites have their own selection.
  const goToSession = (topicOrMode) =>
    navigate(`/batches/${batchId}/practice/${topicOrMode}?count=${count}&types=${effectiveTypes.join(",")}${activeSkill && !["personalized", "favorites"].includes(topicOrMode) ? `&skill=${activeSkill}` : ""}`);

  if (loadingBatches) {
    return (
      <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 800, mx }}>
        <Skeleton variant="rounded" height={40} sx={{ mb: 3, maxWidth: 300 }} />
        <Skeleton variant="rounded" height={60} />
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
        {!fromRoute && <Typography variant="h6" sx={{ fontWeight: 500, fontSize: 17 }}>Practice</Typography>}
      </Box>

      <BatchContext batch={activeBatch} enrolled={enrolled} batchId={batchId} fromRoute={fromRoute} pageName="Practice" onChange={setActiveBatch} />

      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
        Questions per session
      </Typography>
      <Box sx={{ display: "flex", gap: 1, mb: 3 }}>
        {COUNT_OPTIONS.map((n) => (
          <Chip
            key={n}
            label={n}
            size="small"
            onClick={() => setCount(n)}
            color={count === n ? "primary" : "default"}
            variant={count === n ? "filled" : "outlined"}
          />
        ))}
        <Chip
          label="All"
          size="small"
          onClick={() => setCount(100)}
          color={count === 100 ? "primary" : "default"}
          variant={count === 100 ? "filled" : "outlined"}
        />
      </Box>

      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
        Question types
      </Typography>
      <Box sx={{ mb: 3 }}>
        <Box sx={{ display: "flex", gap: 1, mb: aiAvailable ? 0 : 0.75, flexWrap: "wrap" }}>
          {/* Passage questions only live in chapter pools. */}
          {TYPES.filter(([value]) => value !== "passage" || activeBatch?.features?.practiceByChapter).map(([value, label, Icon]) => {
            const disabled = value === "written" && !aiAvailable;
            const selected = effectiveTypes.includes(value);
            return (
              <Chip
                key={value}
                icon={<Icon size={14} />}
                label={label}
                size="small"
                onClick={() => toggleType(value)}
                disabled={disabled}
                color={selected ? "primary" : "default"}
                variant={selected ? "filled" : "outlined"}
              />
            );
          })}
        </Box>
        {/* Explained, not just disabled — a grayed-out option with no
            reason given reads as broken, not intentional. Same underlying
            rule buildPracticeExam enforces silently on the custom-exam
            builder; stated here instead of discovered after the fact. */}
        {!aiAvailable && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>
            Written questions need AI grading, which is off for this batch — only multiple choice and true/false are available here.
          </Typography>
        )}
      </Box>

      {!weakLoading && weak?.readyForPersonalized && (
        <Paper
          variant="outlined"
          onClick={() => goToSession("personalized")}
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

      {/* Learn mode: study cards for written questions (pages/learn). */}
      {learn?.total > 0 && (
        <Paper
          variant="outlined"
          onClick={() => navigate(`/batches/${batchId}/practice/learn`)}
          sx={{ p: 2.5, borderRadius: 3, mb: 3, cursor: "pointer", display: "flex", alignItems: "center", gap: 2, "&:hover": { bgcolor: "action.hover" } }}
        >
          <Box sx={{ width: 40, height: 40, borderRadius: 2, bgcolor: "action.selected", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Layers size={19} />
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontWeight: 500 }}>Learn written answers</Typography>
            <Typography variant="caption" color="text.secondary">
              {learn.total} study card{learn.total === 1 ? "" : "s"}{learn.due ? ` · ${learn.due} due` : ""}
            </Typography>
          </Box>
        </Paper>
      )}

      <GroupChips groups={groups} items={[...(data?.topics || []), ...(data?.chapterPools || [])]} value={groupFilter} onChange={setGroupFilter} sx={{ mb: 3 }} />

      {subjects.length > 1 && (
        <>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
            Subject
          </Typography>
          <Box sx={{ display: "flex", gap: 1, mb: 3, flexWrap: "wrap" }}>
            <Chip
              label="All subjects"
              size="small"
              onClick={() => setSubjectFilter("")}
              color={!activeSubject ? "primary" : "default"}
              variant={!activeSubject ? "filled" : "outlined"}
            />
            {subjects.map((s) => (
              <Chip
                key={s._id}
                label={s.title}
                size="small"
                onClick={() => setSubjectFilter(s._id)}
                color={activeSubject === s._id ? "primary" : "default"}
                variant={activeSubject === s._id ? "filled" : "outlined"}
              />
            ))}
          </Box>
        </>
      )}

      {skills.length > 1 && (
        <>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
            Skill
          </Typography>
          <Box sx={{ display: "flex", gap: 1, mb: 3, flexWrap: "wrap" }}>
            <Chip
              label="All skills"
              size="small"
              onClick={() => setSkillFilter("")}
              color={!activeSkill ? "primary" : "default"}
              variant={!activeSkill ? "filled" : "outlined"}
            />
            {skills.map((v) => (
              <Chip
                key={v}
                label={`${skillTypeLabel(v)} · ${skillCounts.get(v)}`}
                size="small"
                onClick={() => setSkillFilter(v)}
                color={activeSkill === v ? "primary" : "default"}
                variant={activeSkill === v ? "filled" : "outlined"}
              />
            ))}
          </Box>
        </>
      )}


      {(favoriteData?.ids?.length || 0) > 0 && (
        <Paper
          variant="outlined"
          onClick={() => goToSession("favorites")}
          sx={{ p: 2, borderRadius: 2, cursor: "pointer", display: "flex", alignItems: "center", gap: 2, mb: 2 }}
        >
          <Box sx={{ width: 36, height: 36, borderRadius: 2, bgcolor: "action.hover", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Star size={16} color={theme.palette.warning.main} fill={theme.palette.warning.main} />
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontWeight: 500, fontSize: 14 }}>My favorites</Typography>
            <Typography variant="caption" color="text.secondary">
              {favoriteData.ids.length} question{favoriteData.ids.length === 1 ? "" : "s"} saved
            </Typography>
          </Box>
        </Paper>
      )}

      <Paper
        variant="outlined"
        onClick={() => navigate(`/batches/${batchId}/exams/custom-exam-setup`)}
        sx={{ p: 2, borderRadius: 2, cursor: "pointer", display: "flex", alignItems: "center", gap: 2, mb: 3 }}
      >
        <Box sx={{ width: 36, height: 36, borderRadius: 2, bgcolor: "action.hover", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Clock size={16} />
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography sx={{ fontWeight: 500, fontSize: 14 }}>Build a timed practice exam</Typography>
          <Typography variant="caption" color="text.secondary">Pick your own topics, question types, duration and length</Typography>
        </Box>
      </Paper>

      {isLoading ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} variant="rounded" height={60} />)}
        </Box>
      ) : (data?.topics || []).length === 0 && (data?.chapterPools || []).length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="No practice topics yet"
          description="Topics open up once questions are added to this batch. Check back after your next lecture."
          secondaryAction={fromRoute ? { label: `Back to ${terms.batch}`, onClick: () => navigate(`/batches/${batchId}`) } : undefined}
        />
      ) : (
        // One card per chapter, in the batch's outline order, like the
        // lecture list.
        <>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>By chapter and topic</Typography>
        <ChapterCards
          topics={topics}
          chapterPools={chapterPools}
          chapterOrder={data?.chapterOrder}
          groups={groups}
          onPick={goToSession}
          extra={slidesFor}
        />
        </>
      )}
    </Box>
  );
}
