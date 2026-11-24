import { useState, useEffect } from "react";
import { Link, useNavigate, useParams, useOutletContext } from "react-router-dom";
import BatchReportSettings from "../components/BatchReportSettings";
import BatchSlides from "../components/BatchSlides";
import {
  useGetBatchQuery,
  useGetBatchesQuery,
  useUpdateBatchMutation,
  useDuplicateBatchMutation,
  useDeleteBatchMutation,
  useUploadBatchIconMutation,
  useAddPlanMutation,
  useDeletePlanMutation,
  useGetAssignedQuery,
  useGetAssignableQuery,
  useGetOutlineQuery,
  useSaveOutlineMutation,
  useAssignToBatchMutation,
  useAssignMatchingMutation,
  useUnassignFromBatchMutation,
  useCopyAssignmentsMutation,
  useGetUsersQuery,
  useGetTreeQuery,
  useGetCreditPlansQuery,
  useAddCreditPlanMutation,
  useUpdateCreditPlanMutation,
  useDeleteCreditPlanMutation,
  useGetQuestionTagsQuery,
  useGetAuthoritiesQuery,
} from "../api/contentApi";
import {
  ArrowLeft, Plus, Trash2, Copy, X, ClipboardList, PlayCircle,
  FileQuestion, Users, Tag, Check, ChevronLeft, ChevronRight, List,
  LayoutGrid, UserPlus, Clock, Search, BookOpen, Sparkles, HelpCircle,
  ChevronUp, ChevronDown, Library,
  Globe,
  ArrowUpRight,
} from "lucide-react";
import PromoteDialog from "../components/PromoteDialog";
import { Loading, ErrorNote, Empty, Field, useConfirm, TeacherLocked } from "../components/bits";
import Latex from "../components/Latex";
import MarkdownEditor from "../components/MarkdownEditor";
import BatchIcon, { DEFAULT_ICON } from "../components/BatchIcon";
import IconPicker from "../components/IconPicker";
import AiWrite, { AiTranslate } from "../components/AiWrite";
import ContentCoveragePanel from "../components/ContentCoveragePanel";
import BatchOutline from "../components/BatchOutline";
import { CopilotIcon, GradingAgentIcon, AfterClassAgentIcon, AtRiskAgentIcon, SupportAgentIcon, TutorAgentIcon } from "../components/AgentIcons";
import TeamList from "../components/TeamList";
import CourseVideoExport from "../components/CourseVideoExport";
import { useTerms } from "../terms";
import SearchSelect from "../components/SearchSelect";

// Agent switches carry their agent's icon.
const FEATURE_AGENT_ICON = {
  agentCopilot: CopilotIcon, agentGrading: GradingAgentIcon, agentAfterClass: AfterClassAgentIcon,
  agentAtRisk: AtRiskAgentIcon, agentSupport: SupportAgentIcon, agentTutor: TutorAgentIcon,
};

const KINDS = [
  ["exams", "Exams", ClipboardList],
  ["lectures", "Lectures", PlayCircle],
  ["questions", "Questions", FileQuestion],
];

const TABS = [
  ["overview", "Overview"],
  ["content", "Content"],
  ["outline", "Outline"],
  ["slides", "Slides"],
  ["pricing", "Access & pricing"],
  ["team", "Team"],
  ["reports", "Progress reports"],
  ["danger", "Danger zone"],
];

const labelOf = (item) => item.title || item.question || "Untitled";

// A question's own stem image if it has one, else its first option's image
// (an image-only MCQ option is common — a diagram with no text at all) —
// either way, something to show in a thumbnail so an image-only question
// isn't just a blank card in this picker.
const thumbOf = (item) =>
  item.questionImage?.url || item.options?.find((o) => o.image?.url)?.image?.url || null;

export default function BatchDetail() {
  const terms = useTerms();
  const { id } = useParams();
  const navigate = useNavigate();

  const { can: canEarly } = useOutletContext();
  const { data, isLoading, error } = useGetBatchQuery(id);
  const { data: allBatches } = useGetBatchesQuery({ includeInactive: "true" });
  // Only fetched for someone who could actually use it — the full staff
  // directory has no business being requested by a teacher who can never
  // act on it anyway (assigning a teacher is itself an owner/admin-only
  // action, enforced independently in updateBatch), and /api/users isn't
  // even a path prefix this role's gate allows through at all.
  const { data: teacherResults } = useGetUsersQuery({ role: "teacher", limit: 100 }, { skip: !canEarly("manageBatches") });
  // Same reasoning as teacherResults above, same guard — grader is its own
  // role (see userModel.js), not a teacher variant, so it needs its own
  // directory fetch rather than filtering teacherResults.
  const { data: graderResults } = useGetUsersQuery({ role: "grader", limit: 100 }, { skip: !canEarly("manageBatches") });
  const { data: tree } = useGetTreeQuery();
  const { data: authorities } = useGetAuthoritiesQuery();
  const { data: allTags } = useGetQuestionTagsQuery();

  const [updateBatch] = useUpdateBatchMutation();
  const [uploadIcon, iconState] = useUploadBatchIconMutation();
  const [addPlan, planState] = useAddPlanMutation();
  const [deletePlan] = useDeletePlanMutation();
  const creditPlansQuery = useGetCreditPlansQuery(id);
  const [addCreditPlan] = useAddCreditPlanMutation();
  const [updateCreditPlan] = useUpdateCreditPlanMutation();
  const [deleteCreditPlan] = useDeleteCreditPlanMutation();
  const [assign] = useAssignToBatchMutation();
  const [unassign] = useUnassignFromBatchMutation();
  const [assignMatching, { isLoading: addingMatching }] = useAssignMatchingMutation();
  const [copy, copyState] = useCopyAssignmentsMutation();

  const [kind, setKind] = useState("exams");
  const [picking, setPicking] = useState(false);
  const [newPlan, setNewPlan] = useState(null);
  const [copySource, setCopySource] = useState("");
  const [iconOpen, setIconOpen] = useState(false);
  const [teamQuery, setTeamQuery] = useState("");
  const [teacherOpen, setTeacherOpen] = useState(false);
  const [graderOpen, setGraderOpen] = useState(false);
  const [view, setView] = useState("list");
  const [trialDraft, setTrialDraft] = useState(null);
  const [slugDraft, setSlugDraft] = useState(null);
  const [warningDraft, setWarningDraft] = useState(null);
  const [aiLimitDraft, setAiLimitDraft] = useState(null);
  const [doubtLimitDraft, setDoubtLimitDraft] = useState(null);
  const [descriptionDraft, setDescriptionDraft] = useState(null);
  const [newCreditPlan, setNewCreditPlan] = useState(null);
  const [slideIndex, setSlideIndex] = useState(0);
  // A running list of what's been assigned since "Assign" was turned on —
  // an assigned item vanishes from the picker the moment it's added (the
  // assignable list excludes already-assigned items, by design), which
  // used to mean zero visible confirmation it actually went through: no
  // running tally, nothing to undo a misclick from without leaving the
  // picker to go find it in the assigned list separately.
  const [justAdded, setJustAdded] = useState([]);
  const [tab, setTab] = useState("overview");
  const [filters, setFilters] = useState({ subject: "", chapter: "", topic: "", tag: "", type: "", search: "" });
  const [searchDraft, setSearchDraft] = useState("");
  // Paging and ticked rows for the list below. Ticks survive paging, so a
  // pick can span pages; a new filter, kind or mode starts over.
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(() => new Map());

  const { can, me } = useOutletContext();
  const confirm = useConfirm();
  const [deleteBatch, { isLoading: deletingBatch }] = useDeleteBatchMutation();
  const [duplicateBatch, { isLoading: duplicating }] = useDuplicateBatchMutation();
  const [promoting, setPromoting] = useState(false);
  const [yearDraft, setYearDraft] = useState(null);

  // Not fetched while picking: only one list shows at a time, and each add
  // would refetch it for nothing.
  const assigned = useGetAssignedQuery({ batchId: id, kind, limit: PAGE_SIZE, page, ...filters }, { skip: picking });
  // A batch with subjects ticked only offers content from those subjects —
  // picking from the wrong subject by accident was too easy. A batch with
  // none ticked (a combined or revision batch) offers everything.
  const batchSubjectIds = (data?.batch?.subjects || []).map((s) => String(s._id || s));
  const assignable = useGetAssignableQuery(
    { batchId: id, kind, limit: PAGE_SIZE, page, ...(batchSubjectIds.length ? {} : { anySubject: "true" }), ...filters },
    { skip: !picking }
  );

  const activeQuery = picking ? assignable : assigned;
  // currentData (not data) matters here specifically: data can keep holding
  // the last successful response across an args change while a new request
  // is in flight or has failed — exactly how switching to a broken "exams"
  // request kept the previous "lectures" list on screen instead of clearing
  // it or showing the error underneath.
  const items = activeQuery.currentData?.items || [];
  const total = activeQuery.currentData?.total || 0;
  const pages = activeQuery.currentData?.pages || 1;

  // A lecture's place in this batch comes from the batch's outline (the
  // Outline tab, backend utils/courseOutline.js), the same order its
  // students see. The arrows here swap a lecture with its neighbour in the
  // same chapter and save the outline.
  const outlineQuery = useGetOutlineQuery(id, { skip: tab !== "content" || kind !== "lectures" });
  const [saveOutline] = useSaveOutlineMutation();
  const sameChapter = (a, b) => Boolean(a && b) && String(a.chapter?._id || a.chapter) === String(b.chapter?._id || b.chapter);

  const moveLecture = async (lectureId, direction) => {
    const outline = outlineQuery.data;
    if (!outline) return;
    const chapter = outline.chapters.find((c) => c.lectures.some((l) => l._id === lectureId));
    if (!chapter) return;
    const ids = chapter.lectures.map((l) => l._id);
    const from = ids.indexOf(lectureId);
    const to = from + direction;
    if (to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    await saveOutline({
      batchId: id,
      groups: outline.groups.map((g) => ({ _id: g._id, name: g.name, chapters: g.chapters })),
      subjects: outline.subjects.map((x) => x._id),
      chapters: outline.chapters.map((c) => c._id),
      topics: outline.chapters.flatMap((c) => c.topics.map((t) => t._id)),
      lectures: outline.chapters.flatMap((c) => (c._id === chapter._id ? ids : c.lectures.map((l) => l._id))),
    });
  };

  // A filter, a kind switch, or flipping picking on/off all invalidate
  // wherever the slide view was — nothing worse than "slide 8 of 3" from a
  // stale index after the list underneath it changed shape.
  useEffect(() => { setSlideIndex(0); setPage(1); setSelected(new Map()); }, [kind, picking, filters]);
  // Adding or removing can leave fewer pages than the one being shown.
  useEffect(() => { if (activeQuery.currentData && page > pages) setPage(pages); }, [activeQuery.currentData, page, pages]);
  // Starting a fresh add session (opening the picker, or switching what
  // kind it's picking) clears the running "added this session" list —
  // filtering while still adding does not, so narrowing the picker to find
  // more items doesn't wipe the tally of what was just added.
  useEffect(() => { setJustAdded([]); }, [kind, picking]);

  if (isLoading) return <Loading />;
  if (error) return <div className="page"><ErrorNote error={error} /></div>;

  const { batch } = data;

  const subjectOptions = tree || [];
  // The content filter row only lists this batch's own subjects.
  const filterSubjects = batchSubjectIds.length
    ? subjectOptions.filter((s) => batchSubjectIds.includes(String(s._id)))
    : subjectOptions;
  const chapterOptions = filters.subject
    ? (subjectOptions.find((s) => s._id === filters.subject)?.chapters || [])
    : [];
  const topicOptions = filters.chapter
    ? (chapterOptions.find((c) => c._id === filters.chapter)?.topics || [])
    : [];
  // Used for the exam picker's topic dropdown specifically — every chapter
  // under the selected subject, so their topics can be flattened into one
  // list without an intermediate chapter pick exams have no field for.
  const chapterOptionsForSubject = filters.subject
    ? (subjectOptions.find((s) => s._id === filters.subject)?.chapters || [])
    : [];

  const setFilter = (patch) => setFilters((f) => ({ ...f, ...patch }));

  // Wraps the plain assign/unassign mutations just to also keep the
  // "added this session" panel in sync — the mutation itself is unchanged,
  // this only tracks what to show/undo in that list.
  const handleAssign = async (item) => {
    try {
      await assign({ batchId: id, kind, ids: [item._id] }).unwrap();
      setJustAdded((prev) => [{ _id: item._id, label: labelOf(item) }, ...prev]);
    } catch {
      // Assign's own error surfaces through the mutation's error state
      // elsewhere on the page — nothing to add to the list if it failed.
    }
  };
  const toggleSelect = (item) => setSelected((prev) => {
    const next = new Map(prev);
    if (next.has(item._id)) next.delete(item._id); else next.set(item._id, labelOf(item));
    return next;
  });
  const pageAllSelected = items.length > 0 && items.every((i) => selected.has(i._id));
  const togglePage = () => setSelected((prev) => {
    const next = new Map(prev);
    for (const i of items) { if (pageAllSelected) next.delete(i._id); else next.set(i._id, labelOf(i)); }
    return next;
  });
  const applySelected = async () => {
    const ids = [...selected.keys()];
    if (!ids.length) return;
    try {
      if (picking) {
        await assign({ batchId: id, kind, ids }).unwrap();
        setJustAdded((prev) => [...[...selected].map(([_id, label]) => ({ _id, label })), ...prev]);
      } else {
        const ok = await confirm({ title: `Remove ${ids.length} from this batch?`, body: `Students in this ${terms.batch} stop seeing them. Nothing is deleted.`, confirmLabel: "Remove", tone: "danger" });
        if (!ok) return;
        await unassign({ batchId: id, kind, ids }).unwrap();
      }
      setSelected(new Map());
    } catch { /* the mutation's error shows elsewhere */ }
  };
  const addAllMatching = async () => {
    const ok = await confirm({
      title: `Add all ${total} matching ${kind}?`,
      body: "Everything the current filters match that this batch doesn't have yet is added. You can undo it from the \"Added this session\" list.",
      confirmLabel: `Add ${total}`,
    });
    if (!ok) return;
    try {
      const res = await assignMatching({ batchId: id, kind, ...(batchSubjectIds.length ? {} : { anySubject: "true" }), ...filters }).unwrap();
      if (res.ids?.length) setJustAdded((prev) => [{ _id: `bulk-${Date.now()}`, ids: res.ids, label: `${res.ids.length} ${kind} (all matching)` }, ...prev]);
      setSelected(new Map());
    } catch { /* the mutation's error shows elsewhere */ }
  };

  const undoAdd = async (entryId) => {
    const entry = justAdded.find((e) => e._id === entryId);
    await unassign({ batchId: id, kind, ids: entry?.ids || [entryId] });
    setJustAdded((prev) => prev.filter((e) => e._id !== entryId));
  };

  // Bound directly to batch.trialDays before this, these inputs would
  // visually revert mid-keystroke: the mutation fires on every character,
  // and until that round trip resolves the input still shows the old
  // cached value, so a controlled input reading straight from the query
  // result fights whatever was just typed. Local draft state fixes it —
  // typing only ever touches local state, and the save happens once, on
  // blur, when there's an actual final value to commit.
  const trialValue = trialDraft !== null ? trialDraft : batch.trialDays;
  const warningValue = warningDraft !== null ? warningDraft : batch.trialWarningDays;

  const commitTrial = () => {
    if (trialDraft !== null && trialDraft !== "" && Number(trialDraft) !== batch.trialDays) {
      updateBatch({ id, trialDays: Number(trialDraft) });
    }
    setTrialDraft(null);
  };
  const commitWarning = () => {
    if (warningDraft !== null && warningDraft !== "" && Number(warningDraft) !== batch.trialWarningDays) {
      updateBatch({ id, trialWarningDays: Number(warningDraft) });
    }
    setWarningDraft(null);
  };

  // "" (cleared, typing a fresh value) and 0 now mean exactly the same
  // thing — no bonus for this batch, just the platform default — since the
  // field is additive, not a replacement value to inherit away from.
  const currentAiLimit = batch.aiLimits?.dailyCallsPerStudent;
  const aiLimitValue = aiLimitDraft !== null ? aiLimitDraft : (currentAiLimit ?? "");
  const commitAiLimit = () => {
    if (aiLimitDraft === null) return;
    const next = aiLimitDraft === "" ? undefined : Number(aiLimitDraft);
    if (next !== currentAiLimit) {
      updateBatch({ id, aiLimits: { dailyCallsPerStudent: next } });
    }
    setAiLimitDraft(null);
  };

  // "" and 0 are NOT the same thing here, unlike the AI limit above — ""
  // (blank/unset) means unlimited human doubts, but 0 is a real, distinct
  // value: this batch has no human doubt capacity at all, so every doubt
  // routes to AI only. Collapsing them (the old `|| 0` / `?? 0`) silently
  // turned "leave it blank for unlimited" into "blank writes 0", which
  // under this convention actually means the opposite — see
  // doubtLimits.weeklyHumanDoubts's own comment on the Batch model.
  const currentDoubtLimit = batch.doubtLimits?.weeklyHumanDoubts ?? null;
  const doubtLimitValue = doubtLimitDraft !== null ? doubtLimitDraft : (currentDoubtLimit ?? "");
  const commitDoubtLimit = () => {
    if (doubtLimitDraft === null) return;
    const next = doubtLimitDraft === "" ? undefined : Number(doubtLimitDraft);
    if ((next ?? null) !== currentDoubtLimit) {
      updateBatch({ id, doubtLimits: { weeklyHumanDoubts: next } });
    }
    setDoubtLimitDraft(null);
  };

  const descriptionValue = descriptionDraft !== null ? descriptionDraft : (batch.description || "");
  const commitDescription = () => {
    if (descriptionDraft === null || descriptionDraft === (batch.description || "")) {
      setDescriptionDraft(null);
      return;
    }
    updateBatch({ id, description: descriptionDraft });
    setDescriptionDraft(null);
  };

  const submitPlan = async (event) => {
    event.preventDefault();
    try {
      await addPlan({
        id,
        label: newPlan.label,
        price: Number(newPlan.price),
        durationDays: newPlan.isInfinite ? undefined : Number(newPlan.durationDays),
        isInfinite: newPlan.isInfinite,
      }).unwrap();
      setNewPlan(null);
    } catch {
      // rendered below
    }
  };

  // Most switches are off until turned on; these are on until turned off
  // (batchModel.js defaults), so a batch saved before they existed reads right.
  const DEFAULT_ON = ["lectures", "practice", "exams", "calculator", "assignments"];
  const featureOn = (key) => (DEFAULT_ON.includes(key) ? batch.features?.[key] !== false : Boolean(batch.features?.[key]));
  const toggleFeature = (key) =>
    updateBatch({ id, features: { ...batch.features, [key]: !featureOn(key) } });

  const toggleActive = () => updateBatch({ id, isActive: !batch.isActive });

  const toggleSubject = (subjectId) => {
    const current = batch.subjects.map((s) => s._id || s);
    const next = current.includes(subjectId)
      ? current.filter((sid) => sid !== subjectId)
      : [...current, subjectId];
    updateBatch({ id, subjects: next });
  };

  // Which boards/exams/books this batch presents its own students — an
  // empty list is "the archive module is off for this batch", same "empty
  // means off" convention as subjects above would use if it gated anything.
  const toggleArchiveAuthority = (authorityId) => {
    const current = (batch.archiveAuthorities || []).map((a) => a._id || a);
    const next = current.includes(authorityId)
      ? current.filter((aid) => aid !== authorityId)
      : [...current, authorityId];
    updateBatch({ id, archiveAuthorities: next });
  };

  const addTeacher = (userId) => {
    updateBatch({ id, teachers: [...batch.teachers.map((t) => t._id), userId] });
    setTeacherOpen(false);
  };
  const removeTeacher = (userId) =>
    updateBatch({ id, teachers: batch.teachers.map((t) => t._id).filter((tid) => tid !== userId) });

  const availableTeachers = (teacherResults?.users || []).filter(
    (u) => !batch.teachers.some((t) => t._id === u._id)
  );

  const addGrader = (userId) => {
    updateBatch({ id, graders: [...(batch.graders || []).map((g) => g._id), userId] });
    setGraderOpen(false);
  };
  const removeGrader = (userId) =>
    updateBatch({ id, graders: (batch.graders || []).map((g) => g._id).filter((gid) => gid !== userId) });

  const availableGraders = (graderResults?.users || []).filter(
    (u) => !(batch.graders || []).some((g) => g._id === u._id)
  );

  return (
    <div className="page">
      <div className="page-head spread">
        <div className="row-tight" style={{ alignItems: "flex-start" }}>
          <button
            className="icon-btn"
            onClick={() => setIconOpen(true)}
            title={`See or change the ${terms.batch} icon or image`}
            style={{ width: 46, height: 46, border: "1px solid var(--border)", borderRadius: 10, flexShrink: 0 }}
          >
            <BatchIcon icon={batch.icon} size={22} imgSize={44} />
          </button>
          <div>
            <div className="row-tight" style={{ marginBottom: 4 }}>
              {batch.accessType === "free"
                ? <span className="pill pill-ok">Free</span>
                : <span className="pill">Paid</span>}
              <button
                type="button"
                className={`pill pill-btn${batch.isActive ? " pill-ok" : " pill-warn"}`}
                onClick={toggleActive}
                title={batch.isActive ? "Click to deactivate" : "Click to activate"}
              >
                {batch.isActive ? "Active" : "Inactive"}
              </button>
              {yearDraft === null ? (
                <button type="button" className="pill pill-btn" title="School year or session" onClick={() => setYearDraft(batch.year || "")}>{batch.year || "Set year"}</button>
              ) : (
                <input
                  className="input" style={{ width: 110, height: 26, padding: "0 8px" }} autoFocus placeholder="2026-27" maxLength={20} value={yearDraft}
                  onChange={(e) => setYearDraft(e.target.value)}
                  onBlur={() => { if (yearDraft.trim() !== (batch.year || "")) updateBatch({ id, year: yearDraft.trim() }); setYearDraft(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setYearDraft(null); }}
                />
              )}
            </div>
            <h1>{batch.name}</h1>
            <p className="muted small tnum" style={{ margin: "2px 0 0" }}>
              {data.assigned.exams} exams · {data.assigned.lectures} lectures ·{" "}
              <Link to={`/students?batch=${batch._id}`} title="See who they are">
                {data.activeStudents} active student{data.activeStudents === 1 ? "" : "s"}
              </Link>
            </p>
          </div>
        </div>
        <div className="row-tight">
          {can("manageBatches") && (
            <button
              className="btn btn-sm btn-quiet"
              disabled={duplicating}
              onClick={async () => {
                const result = await duplicateBatch({ id }).unwrap();
                navigate(`/batches/${result._id}`);
              }}
            >
              <Copy size={14} /> {duplicating ? "Duplicating" : "Duplicate"}
            </button>
          )}
          {can("manageBatches") && (
            <button className="btn btn-sm btn-quiet" onClick={() => setPromoting(true)}><ArrowUpRight size={14} /> Promote</button>
          )}
          <button className="btn btn-sm btn-quiet" onClick={() => navigate("/batches")}>
            <ArrowLeft size={14} /> Batches
          </button>
        </div>
      </div>

      {promoting && <PromoteDialog batch={batch} batches={allBatches} onClose={() => setPromoting(false)} />}
      {iconOpen && (
        <IconPicker
          currentIcon={batch.icon}
          uploading={iconState.isLoading}
          isDefault={batch.icon?.kind === "preset" && (batch.icon?.value || DEFAULT_ICON) === DEFAULT_ICON}
          onPickPreset={(value) => { updateBatch({ id, icon: { kind: "preset", value } }); setIconOpen(false); }}
          onUpload={(file) => uploadIcon({ id, file })}
          onAiPicture={(media) => updateBatch({ id, icon: { kind: "custom", value: media.url } })}
          aiContext={batch.name}
          onReset={() => { updateBatch({ id, icon: { kind: "preset", value: DEFAULT_ICON } }); setIconOpen(false); }}
          onClose={() => setIconOpen(false)}
        />
      )}

      <div className="stack">
        <ErrorNote error={planState.error || copyState.error || iconState.error} />

        <div className="row-tight" style={{ borderBottom: "1px solid var(--border)", paddingBottom: 2 }}>
          {TABS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className="btn btn-sm btn-quiet"
              style={tab === value ? { fontWeight: 700, color: "var(--accent, inherit)", borderBottom: "2px solid currentColor", borderRadius: 0 } : undefined}
              onClick={() => setTab(value)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "outline" && <BatchOutline batchId={id} />}
        {tab === "slides" && <BatchSlides batchId={id} />}
        {tab === "reports" && <BatchReportSettings batchId={id} canSend={can("manageBatches")} />}

        {tab === "overview" && (
        <>
        {/* ---------------- description ---------------- */}
        <div className="card stack">
          <h2>Description</h2>
          <p className="hint" style={{ margin: 0 }}>
            Shown in the course catalogue's "view more" modal, under this
            program's own description. Optional — a batch with nothing here
            just shows no description section there.
          </p>
          <MarkdownEditor
            value={descriptionValue}
            onChange={(v) => setDescriptionDraft(v)}
            onBlur={commitDescription}
            minHeight={110}
            mono={false}
            placeholder="What this batch covers, what's included, who it's for…"
            actions={(
              <>
                <AiWrite
                  task="courseDescription"
                  input={{ kind: "batch", id }}
                  prompt="optional"
                  promptLabel="Anything to add? Who it's for, exam year, what makes it different"
                  placeholder="e.g. For HSC 2027 students. Classes in Bangla."
                  title="Write it from this batch's subjects, chapters, lectures, exams and practice"
                  onResult={(d) => setDescriptionDraft(d.description)}
                />
                <AiTranslate value={descriptionValue} onChange={(v) => setDescriptionDraft(v)} />
              </>
            )}
          />
          {/* An AI draft or translation isn't saved until the admin says so. */}
          {descriptionDraft !== null && descriptionDraft !== (batch.description || "") && (
            <div className="row-tight">
              <button type="button" className="btn btn-sm" onClick={commitDescription}><Check size={14} /> Save description</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDescriptionDraft(null)}><X size={14} /> Discard</button>
            </div>
          )}
        </div>
        </>
        )}

        {tab === "team" && (
        <>
        <input className="input" style={{ maxWidth: 320 }} placeholder="Filter by name or email" value={teamQuery} onChange={(e) => setTeamQuery(e.target.value)} />
        {/* ---------------- teachers ---------------- */}
        <div className="card stack">
          <div className="spread">
            <div className="row-tight"><Users size={17} className="muted" /><h2>Teachers</h2></div>
            {can("manageBatches") && (
              <button className="btn btn-sm btn-quiet" onClick={() => setTeacherOpen(!teacherOpen)}>
                {teacherOpen ? <><X size={13} /> Done</> : <><UserPlus size={13} /> Add</>}
              </button>
            )}
          </div>
          <p className="hint" style={{ margin: 0 }}>
            Can assign lectures, exams and questions to this batch. Owners and
            admins always can, regardless of who's listed here.
          </p>

          <TeamList people={batch.teachers} query={teamQuery} onRemove={can("manageBatches") ? removeTeacher : null} empty="No teachers assigned yet." />

          {can("manageBatches") && teacherOpen && (
            <div className="card-quiet stack">
              <TeamList people={availableTeachers} query={teamQuery} onAdd={addTeacher} empty="No other teacher accounts to add." />
            </div>
          )}
        </div>

        {/* ---------------- graders ---------------- */}
        <div className="card stack">
          <div className="spread">
            <div className="row-tight"><Users size={17} className="muted" /><h2>Graders</h2></div>
            {can("manageBatches") && (
              <button className="btn btn-sm btn-quiet" onClick={() => setGraderOpen(!graderOpen)}>
                {graderOpen ? <><X size={13} /> Done</> : <><UserPlus size={13} /> Add</>}
              </button>
            )}
          </div>
          <p className="hint" style={{ margin: 0 }}>
            Grading only — no batch content, no doubt panel. Grading here is anonymous:
            a grader never sees which student a script belongs to.
          </p>

          <TeamList people={batch.graders} query={teamQuery} onRemove={can("manageBatches") ? removeGrader : null} empty="No graders assigned yet." />

          {can("manageBatches") && graderOpen && (
            <div className="card-quiet stack">
              <TeamList people={availableGraders} query={teamQuery} onAdd={addGrader} empty="No other grader accounts to add." />
            </div>
          )}
        </div>
        </>
        )}

        {tab === "overview" && (
        <>
        {/* ---------------- subjects ---------------- */}
        <div className="card stack">
          <div className="row-tight"><BookOpen size={17} className="muted" /><h2>Subjects</h2></div>
          <p className="hint" style={{ margin: 0 }}>
            What this batch covers. Students only see practice and archive
            questions from ticked subjects; with none ticked they see none.
            Unticking a subject hides its questions without unassigning them.
            Exams and lectures aren't affected.
          </p>
          {[subjectOptions].map((list) => {
            if (!list.length) return null;
            return (
              <div key="subjects" className="stack" style={{ gap: 6 }}>
                <div className="row-tight" style={{ flexWrap: "wrap" }}>
                  {list.map((s) => {
                    const active = batch.subjects.some((bs) => (bs._id || bs) === s._id);
                    return (
                      <button
                        key={s._id}
                        className={`pill pill-btn${active ? " pill-on" : ""}`}
                        onClick={() => toggleSubject(s._id)}
                      >
                        {s.title}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          <div className="row-tight" style={{ flexWrap: "wrap" }}>
            {subjectOptions.length === 0 && (
              <p className="hint" style={{ margin: 0 }}>No subjects exist yet — add some under Structure first.</p>
            )}
          </div>
        </div>

        {/* ---------------- archive module ---------------- */}
        <div className="card stack">
          <div className="row-tight"><Library size={17} className="muted" /><h2>Archive</h2></div>
          <p className="hint" style={{ margin: 0 }}>
            Which boards, entrance exams or textbooks from the public
            archive this batch presents to its own students, as its own
            "practice board questions" module. The content itself is shared
            across the whole install — this only picks which slice of it
            these students can reach. None selected means the module is off
            for this batch.
          </p>
          <div className="row-tight" style={{ flexWrap: "wrap" }}>
            {(authorities || []).map((a) => {
              const active = (batch.archiveAuthorities || []).some((ba) => (ba._id || ba) === a._id);
              return (
                <button
                  key={a._id}
                  className={`pill pill-btn${active ? " pill-on" : ""}`}
                  onClick={() => toggleArchiveAuthority(a._id)}
                >
                  {a.name}
                </button>
              );
            })}
            {(authorities || []).length === 0 && (
              <p className="hint" style={{ margin: 0 }}>
                No boards/exams/books exist yet — add some from the Archive page first.
              </p>
            )}
          </div>
        </div>

        {/* ---------------- trial ---------------- */}
        <div className="card stack">
          <div className="row-tight"><Clock size={17} className="muted" /><h2>Trial</h2></div>
          <p className="hint" style={{ margin: 0 }}>
            How long a student can try this batch before needing to pay.
            Fractions work — 0.5 days is twelve hours.
          </p>
          <div className="row">
            <Field label="Trial length (days)">
              <input
                className="input tnum"
                type="number"
                min="0"
                step="0.5"
                value={trialValue}
                onChange={(e) => setTrialDraft(e.target.value)}
                onBlur={commitTrial}
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
              />
            </Field>
            <Field label="Warn before it ends (days)">
              <input
                className="input tnum"
                type="number"
                min="0"
                step="0.5"
                value={warningValue}
                onChange={(e) => setWarningDraft(e.target.value)}
                onBlur={commitWarning}
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
              />
            </Field>
          </div>
        </div>

        {/* ---------------- public page (Settings → SEO → Course pages) ---------------- */}
        <div className="card stack">
          <div className="row-tight"><Globe size={17} className="muted" /><h2>Public page address</h2></div>
          <p className="hint" style={{ margin: 0 }}>
            Used when course pages are on (Settings → SEO). Letters, numbers and dashes. Empty: made from the name.
          </p>
          <div className="row-tight" style={{ flexWrap: "wrap", gap: 6 }}>
            <span className="muted small">/courses/</span>
            <input
              className="input"
              style={{ maxWidth: 320 }}
              value={slugDraft !== null ? slugDraft : batch.slug || ""}
              onChange={(e) => setSlugDraft(e.target.value)}
              onBlur={() => {
                if (slugDraft !== null && slugDraft.trim() !== (batch.slug || "")) updateBatch({ id, slug: slugDraft.trim() });
                setSlugDraft(null);
              }}
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
            />
            {batch.slug && <a className="btn btn-sm btn-quiet" href={`/courses/${encodeURIComponent(batch.slug)}`} target="_blank" rel="noreferrer">Open</a>}
          </div>
        </div>
        </>
        )}

        {tab === "pricing" && (
        <>
        {/* ---------------- ai limits & credits ---------------- */}
        <div className="card stack">
          <div className="row-tight"><Sparkles size={17} className="muted" /><h2>AI usage on this {terms.batch}</h2></div>

          <Field label={`Bonus free AI calls per student per day, for this ${terms.batch}`}>
            <input
              className="input tnum"
              type="number"
              min="0"
              placeholder="0"
              value={aiLimitValue}
              onChange={(e) => setAiLimitDraft(e.target.value)}
              onBlur={commitAiLimit}
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
            />
          </Field>
          <p className="hint" style={{ margin: 0 }}>
            Added on top of the platform-wide default set in AI Settings —
            this can only give this batch's students extra calls, not fewer
            than everyone else already gets. A student who runs out here
            (bonus and platform default both used up) can still keep going
            by buying AI credits below — those never expire and don't reset
            daily.
          </p>

          <div className="spread" style={{ marginTop: 8 }}>
            <span className="label">AI credit packs</span>
            <button className="btn btn-sm btn-quiet" onClick={() => setNewCreditPlan({ label: "", credits: "", price: "" })}>
              <Plus size={13} /> Add pack
            </button>
          </div>

          {newCreditPlan && (
            <form
              className="card-quiet stack"
              onSubmit={async (e) => {
                e.preventDefault();
                await addCreditPlan({
                  id, label: newCreditPlan.label,
                  credits: Number(newCreditPlan.credits),
                  price: Number(newCreditPlan.price),
                }).unwrap();
                setNewCreditPlan(null);
              }}
            >
              <div className="row">
                <Field label="Name"><input className="input" autoFocus placeholder="50 AI calls" value={newCreditPlan.label} onChange={(e) => setNewCreditPlan({ ...newCreditPlan, label: e.target.value })} /></Field>
                <Field label="Credits"><input className="input tnum" type="number" min="1" value={newCreditPlan.credits} onChange={(e) => setNewCreditPlan({ ...newCreditPlan, credits: e.target.value })} /></Field>
                <Field label="Price"><input className="input tnum" type="number" min="0" value={newCreditPlan.price} onChange={(e) => setNewCreditPlan({ ...newCreditPlan, price: e.target.value })} /></Field>
              </div>
              <div className="row">
                <button className="btn btn-sm" disabled={!newCreditPlan.label || !newCreditPlan.credits || newCreditPlan.price === ""}>Add pack</button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setNewCreditPlan(null)}>Cancel</button>
              </div>
            </form>
          )}

          {creditPlansQuery.isLoading ? (
            <Loading />
          ) : (creditPlansQuery.data || []).length === 0 ? (
            <p className="hint" style={{ margin: 0 }}>No credit packs yet — students can't buy extra AI use until there's one.</p>
          ) : (
            creditPlansQuery.data.map((plan) => (
              <div className="card-quiet spread" key={plan._id} style={{ padding: 11 }}>
                <div className="grow">
                  <strong style={{ fontWeight: 500 }}>{plan.label}</strong>
                  <div className="muted small tnum">{plan.credits} AI calls</div>
                </div>
                <span className="tnum" style={{ fontSize: 15 }}>{plan.price}</span>
                <label className="row-tight small" style={{ marginLeft: 12 }}>
                  <input
                    type="checkbox"
                    checked={plan.isActive}
                    onChange={() => updateCreditPlan({ id, planId: plan._id, isActive: !plan.isActive })}
                  />
                  Visible
                </label>
                <button
                  className="icon-btn icon-btn-danger"
                  title="Remove this pack"
                  onClick={async () => {
                    const yes = await confirm({
                      title: `Remove "${plan.label}"?`,
                      body: "Students who already bought it keep the credits they were granted.",
                      confirmLabel: "Remove",
                    });
                    if (yes) deleteCreditPlan({ id, planId: plan._id });
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          )}
        </div>

        {/* ---------------- doubt limits ---------------- */}
        {batch.features?.doubtSolving && (
          <div className="card stack">
            <div className="row-tight"><HelpCircle size={17} className="muted" /><h2>Doubts on this {terms.batch}</h2></div>

            <Field label="Human doubts per student per week">
              <input
                className="input tnum"
                type="number"
                min="0"
                placeholder="No limit"
                value={doubtLimitValue}
                onChange={(e) => setDoubtLimitDraft(e.target.value)}
                onBlur={commitDoubtLimit}
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
              />
            </Field>
            <p className="hint" style={{ margin: 0 }}>
              Counts doubts asked for a human directly and ones referred to a human from the AI —
              either way it's the same person's time being spent. Leave blank for no limit.
              Set to 0 to turn off human doubts entirely — every doubt goes to AI only.
              Resets every Sunday.
            </p>
          </div>
        )}
        </>
        )}

        {tab === "content" && (
        <>
        {/* ---------------- assignment ---------------- */}
        <div className="card stack">
          <div className="spread">
            <h2>What this {terms.batch} can see</h2>
            <div className="row-tight">
              <button
                className="icon-btn"
                title="List view"
                style={{ background: view === "list" ? "var(--surface-alt)" : "transparent" }}
                onClick={() => setView("list")}
              >
                <List size={15} />
              </button>
              <button
                className="icon-btn"
                title="Slide view"
                style={{ background: view === "slide" ? "var(--surface-alt)" : "transparent" }}
                onClick={() => setView("slide")}
              >
                <LayoutGrid size={15} />
              </button>
              {/* Every lecture's AI video lesson as HD files (Udemy-ready). */}
              {kind === "lectures" && !picking && ["owner", "admin"].includes(me?.role) && <CourseVideoExport batchId={id} name={data?.batch?.name} />}
              <button className="btn btn-sm" onClick={() => setPicking(!picking)}>
                {picking ? <><X size={14} /> Done</> : <><Plus size={14} /> Assign</>}
              </button>
            </div>
          </div>

          <p className="hint" style={{ margin: 0 }}>
            Students see something only if it is assigned here. Nothing is matched
            automatically by subject.
          </p>

          <div className="row-tight">
            {KINDS.map(([value, label, Icon]) => (
              <button
                key={value}
                className={`pill pill-btn row-tight${kind === value ? " pill-on" : ""}`}
                style={{ gap: 5 }}
                onClick={() => { setKind(value); setFilters({ subject: "", chapter: "", topic: "", tag: "", type: "", search: "" }); setSearchDraft(""); }}
              >
                <Icon size={12} />
                {label}
              </button>
            ))}
          </div>

          <div className="row-tight" style={{ flexWrap: "wrap" }}>
            <SearchSelect className="select" value={filters.subject} onChange={(e) => setFilter({ subject: e.target.value, chapter: "", topic: "" })}>
              <option value="">{batchSubjectIds.length ? "All this batch's subjects" : "Any subject"}</option>
              {filterSubjects.map((s) => <option key={s._id} value={s._id}>{s.title}</option>)}
            </SearchSelect>
            {kind !== "exams" && (
              <SearchSelect className="select" value={filters.chapter} disabled={!filters.subject} onChange={(e) => setFilter({ chapter: e.target.value, topic: "" })}>
                <option value="">Any chapter</option>
                {chapterOptions.map((c) => <option key={c._id} value={c._id}>{c.title}</option>)}
              </SearchSelect>
            )}
            <SearchSelect
              className="select"
              value={filters.topic}
              disabled={kind === "exams" ? !filters.subject : !filters.chapter}
              onChange={(e) => setFilter({ topic: e.target.value })}
            >
              <option value="">Any topic</option>
              {/* Scoped to one already-chosen chapter (the select above this
                  one is disabled until a chapter is picked), so adding the
                  chapter's own pool as an option here doesn't reintroduce
                  the "topic and chapter-pool mixed across the whole
                  syllabus in one dropdown" problem — it's one more option
                  within a list already narrowed to a single chapter, same
                  as FilingSelect's own optgroup does per chapter. Exams have
                  no chapter field at all (see applyContentFilters), so this
                  option never applies to them. */}
              {kind !== "exams" && filters.chapter && (
                <option value="none">(whole chapter — chapter pool)</option>
              )}
              {/* Exams have no chapter to filter through first, so their topic
                  list is every topic under the chosen subject, flattened —
                  lectures/questions keep the chapter step since those items
                  only ever belong to one topic and narrowing helps there. */}
              {(kind === "exams" ? chapterOptionsForSubject.flatMap((c) => c.topics) : topicOptions).map((t) => (
                <option key={t._id} value={t._id}>{t.title}</option>
              ))}
            </SearchSelect>
            {/* Chapter pool, scoped to whatever chapter is already picked
                above — or every chapter at once, syllabus-wide, when none
                is. Used to always clear the chapter selection on click,
                which threw away a chapter an admin had just picked right
                before reaching for this — looked exactly like "the chapter
                filter doesn't work". Toggling topic alone, leaving chapter
                as it is, is both what the button's own state (pill-on)
                already reflects and what the topic dropdown's own
                "(whole chapter — chapter pool)" option above does for the
                same chapter — this is just a one-click shortcut to it. */}
            {kind !== "exams" && (
              <button
                type="button"
                className={`pill pill-btn${filters.topic === "none" ? " pill-on" : ""}`}
                onClick={() => setFilter({ topic: filters.topic === "none" ? "" : "none" })}
              >
                Chapter pool only
              </button>
            )}
            {kind === "questions" && allTags?.length > 0 && (
              <SearchSelect className="select" value={filters.tag} onChange={(e) => setFilter({ tag: e.target.value })}>
                <option value="">Any tag</option>
                {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
              </SearchSelect>
            )}
            {kind === "questions" && (
              <select className="select" value={filters.type} onChange={(e) => setFilter({ type: e.target.value })}>
                <option value="">Any type</option>
                <option value="mcq">Multiple choice</option>
                <option value="mtf">True / false</option>
                <option value="written">Written</option>
                <option value="passage">Passage</option>
              </select>
            )}
            <form
              className="search-wrap"
              onSubmit={(e) => { e.preventDefault(); setFilter({ search: searchDraft }); }}
            >
              <Search size={14} className="search-icon" />
              <input className="input" style={{ paddingLeft: 36 }} placeholder="Search" value={searchDraft} onChange={(e) => setSearchDraft(e.target.value)} />
            </form>
          </div>

          {/* Same filter row, same query params, on both sides now —
              narrows what's already assigned just as much as what could be
              added, so finding one lecture in a batch that has two hundred
              of them doesn't mean scrolling through all of them. */}
          {picking && (
            <p className="hint" style={{ margin: 0, color: "var(--accent)" }}>
              Showing what could be added.
            </p>
          )}

          {/* Stays on screen for the whole picking session — an assigned
              item disappears from the list below the instant it's added
              (it's no longer "assignable"), so without this there was no
              visible confirmation it went through and no quick way to undo
              a misclick short of leaving the picker to find it in the
              assigned list. */}
          {picking && justAdded.length > 0 && (
            <div className="card-quiet stack" style={{ gap: 6, borderColor: "var(--accent)" }}>
              <div className="spread">
                <strong className="small">Added this session ({justAdded.length})</strong>
                <button className="icon-btn" title="Clear this list" onClick={() => setJustAdded([])}>
                  <X size={13} />
                </button>
              </div>
              <div className="stack" style={{ gap: 4, maxHeight: 160, overflowY: "auto" }}>
                {justAdded.map((entry) => (
                  <div key={entry._id} className="spread small">
                    <span className="grow truncate">{entry.label}</span>
                    <button className="icon-btn icon-btn-danger" title={`Undo — remove from this ${terms.batch}`} onClick={() => undoAdd(entry._id)}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {total > 0 && !activeQuery.error && (
            <div className="spread" style={{ flexWrap: "wrap", gap: 8 }}>
              <div className="row-tight" style={{ flexWrap: "wrap", gap: 8 }}>
                {view === "list" && (
                  <label className="row-tight small" style={{ gap: 6, cursor: "pointer" }}>
                    <input type="checkbox" checked={pageAllSelected} onChange={togglePage} />
                    Select page
                  </label>
                )}
                {selected.size > 0 && (
                  <>
                    <button className={`btn btn-sm${picking ? "" : " btn-danger"}`} onClick={applySelected}>
                      {picking ? <><Plus size={14} /> Add selected ({selected.size})</> : <><X size={14} /> Remove selected ({selected.size})</>}
                    </button>
                    <button className="btn btn-sm btn-ghost" onClick={() => setSelected(new Map())}>Clear</button>
                  </>
                )}
                {picking && (
                  <button className="btn btn-sm btn-ghost" disabled={addingMatching} onClick={addAllMatching}>
                    <Plus size={14} /> Add all {total} matching
                  </button>
                )}
              </div>
              <Pager page={page} pages={pages} total={total} setPage={(p) => { setPage(p); setSlideIndex(0); }} />
            </div>
          )}

          {activeQuery.isFetching ? (
            <Loading />
          ) : activeQuery.error ? (
            <ErrorNote error={activeQuery.error} />
          ) : items.length === 0 ? (
            <p className="hint" style={{ margin: 0 }}>
              {Object.values(filters).some(Boolean)
                ? "Nothing matches these filters."
                : picking ? `Nothing left to add — every ${kind} is already assigned.` : `No ${kind} assigned yet.`}
            </p>
          ) : view === "list" ? (
            <div className="stack" style={{ gap: 6 }}>
              {items.map((item, idx) => (
                <div className="card-quiet spread" key={item._id} style={{ padding: 10 }}>
                  <input type="checkbox" checked={selected.has(item._id)} onChange={() => toggleSelect(item)} aria-label="Select" style={{ flexShrink: 0 }} />
                  {kind === "lectures" && !picking && can("manageBatches") && (
                    <div className="stack" style={{ gap: 0 }}>
                      <button
                        className="icon-btn"
                        title="Move up"
                        disabled={!outlineQuery.data || !sameChapter(items[idx - 1], item)}
                        onClick={() => moveLecture(item._id, -1)}
                        style={{ height: 18 }}
                      >
                        <ChevronUp size={13} />
                      </button>
                      <button
                        className="icon-btn"
                        title="Move down"
                        disabled={!outlineQuery.data || !sameChapter(items[idx + 1], item)}
                        onClick={() => moveLecture(item._id, 1)}
                        style={{ height: 18 }}
                      >
                        <ChevronDown size={13} />
                      </button>
                    </div>
                  )}
                  {kind === "questions" && thumbOf(item) && (
                    <img
                      src={thumbOf(item)}
                      alt=""
                      style={{ width: 36, height: 36, borderRadius: 6, objectFit: "cover", flexShrink: 0 }}
                    />
                  )}
                  <span className="grow small truncate">
                    {/* Slide view (below) already renders a question's text
                        through Latex — this list view never did, so filtering
                        into "list" (the default) showed raw "$...$" source
                        instead of the rendered expression. Latex itself is a
                        no-op for a lecture/exam title with no math in it, so
                        wrapping every kind here rather than branching on
                        kind === "questions" changes nothing for those. */}
                    <Latex>{labelOf(item)}</Latex>
                    {item.topic?.title && <span className="muted"> · {item.topic.title}</span>}
                  </span>
                  {picking ? (
                    <button className="icon-btn" title={`Add to this ${terms.batch}`} onClick={() => handleAssign(item)}>
                      <Plus size={15} />
                    </button>
                  ) : (
                    <button className="icon-btn icon-btn-danger" title={`Remove from this ${terms.batch}`} onClick={() => unassign({ batchId: id, kind, ids: [item._id] })}>
                      <X size={15} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <SlideView
              items={items}
              kind={kind}
              index={slideIndex}
              setIndex={setSlideIndex}
              offset={(page - 1) * PAGE_SIZE}
              total={total}
              onNextPage={page < pages ? () => { setPage(page + 1); setSlideIndex(0); } : null}
              onPrevPage={page > 1 ? () => { setPage(page - 1); setSlideIndex(PAGE_SIZE - 1); } : null}
              picking={picking}
              onAssign={handleAssign}
              onUnassign={(itemId) => unassign({ batchId: id, kind, ids: [itemId] })}
            />
          )}
        </div>

        <ContentCoveragePanel batchId={id} />

        {/* ---------------- copy ---------------- */}
        <div className="card stack">
          <div className="row-tight"><Copy size={17} className="muted" /><h2>Copy from another {terms.batch}</h2></div>
          <p className="hint" style={{ margin: 0 }}>
            Brings across every exam, lecture and question assigned to it. Nothing here is removed.
          </p>
          <div className="row-tight">
            <SearchSelect
              className="select"
              value={copySource}
              onChange={(e) => setCopySource(e.target.value)}
            >
              <option value="">Choose a {terms.batch}</option>
              {(allBatches || [])
                .filter((b) => b._id !== id)
                .map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
            </SearchSelect>
            <button
              className="btn btn-sm"
              disabled={!copySource || copyState.isLoading}
              onClick={async () => {
                const source = (allBatches || []).find((b) => b._id === copySource);
                const yes = await confirm({
                  title: `Copy everything from "${source?.name}"?`,
                  body: `Every exam, lecture and question assigned to it will also be assigned here. Nothing already on ${batch.name} is removed.`,
                  confirmLabel: "Copy",
                });
                if (yes) copy({ targetId: id, sourceId: copySource });
              }}
            >
              <Copy size={14} />
              {copyState.isLoading ? "Copying" : "Copy"}
            </button>
          </div>
          {copyState.data && (
            <div className="banner banner-ok row-tight">
              <Check size={16} /><span>{copyState.data.message}</span>
            </div>
          )}
        </div>
        </>
        )}

        {tab === "pricing" && (
        <>
        {/* ---------------- plans ---------------- */}
        {batch.accessType === "paid" && (
          <div className="card stack">
            <div className="spread">
              <div className="row-tight"><Tag size={17} className="muted" /><h2>Plans</h2></div>
              {can("managePlans") && (
                <button
                  className="btn btn-sm btn-quiet"
                  onClick={() => setNewPlan({ label: "", price: "", durationDays: 30, isInfinite: false })}
                >
                  <Plus size={13} /> Add plan
                </button>
              )}
            </div>

            {newPlan && (
              <form className="card-quiet stack" onSubmit={submitPlan}>
                <div className="row">
                  <Field label="Name">
                    <input
                      className="input"
                      autoFocus
                      placeholder="1 month"
                      value={newPlan.label}
                      onChange={(e) => setNewPlan({ ...newPlan, label: e.target.value })}
                    />
                  </Field>
                  <Field label="Price">
                    <input
                      className="input tnum"
                      type="number"
                      min="0"
                      value={newPlan.price}
                      onChange={(e) => setNewPlan({ ...newPlan, price: e.target.value })}
                    />
                  </Field>
                  {!newPlan.isInfinite && (
                    <Field label="Days">
                      <input
                        className="input tnum"
                        type="number"
                        min="1"
                        value={newPlan.durationDays}
                        onChange={(e) => setNewPlan({ ...newPlan, durationDays: e.target.value })}
                      />
                    </Field>
                  )}
                </div>

                <label className="row-tight small">
                  <input
                    type="checkbox"
                    checked={newPlan.isInfinite}
                    onChange={(e) => setNewPlan({ ...newPlan, isInfinite: e.target.checked })}
                  />
                  Never expires
                </label>

                <div className="row">
                  <button className="btn btn-sm" disabled={!newPlan.label || newPlan.price === ""}>
                    Add plan
                  </button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setNewPlan(null)}>
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {batch.plans?.length ? (
              batch.plans.map((plan) => (
                <div className="card-quiet spread" key={plan._id} style={{ padding: 11 }}>
                  <div className="grow">
                    <strong style={{ fontWeight: 500 }}>{plan.label}</strong>
                    <div className="muted small tnum">
                      {plan.isInfinite ? "Never expires" : `${plan.durationDays} days`}
                    </div>
                  </div>
                  <span className="tnum" style={{ fontSize: 15 }}>{plan.price}</span>
                  {can("managePlans") && (
                    <button
                      className="icon-btn icon-btn-danger"
                      title="Remove this plan"
                      onClick={async () => {
                        const yes = await confirm({
                          title: `Remove the "${plan.label}" plan?`,
                          body: "Students who already bought it keep their access. Removing is refused if anyone has purchased it.",
                          confirmLabel: "Remove",
                        });
                        if (yes) deletePlan({ id, planId: plan._id });
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))
            ) : (
              <p className="hint" style={{ margin: 0 }}>
                No plans yet. Students cannot subscribe until there is one.
              </p>
            )}
          </div>
        )}

        {/* ---------------- features ---------------- */}
        <div className="card stack">
          <div className="row-tight"><Check size={17} className="muted" /><h2>What is included</h2></div>
          <div className="stack" style={{ gap: 0 }}>
            {[
              ["exams", "Exams"],
              ["practice", "Practice questions"],
              ["practiceByChapter", "Chapter-pool tiles in Practice"],
              ["codingPractice", "Coding practice: every coding question in the batch, with Run and Submit (needs a code runner)"],
              ["lectureSlides", "Lecture slides: the decks published from the Slides tab"],
              ["assignments", "Assignments: coursework with a due date"],
              ["calculator", "Calculator in practice, the archive, practice exams and drawn answers"],
              ["examCalculator", "Calculator in exams (default; each exam can say otherwise)"],
              ["lectures", "Lectures"],
              ["aiAssist", "AI help for students"],
              ["doubtSolving", "Doubt solving"],
              ["liveClasses", "Live classes"],
              ["writtenAnswerImages", "Image attachments on written answers"],
              ["cameraOnlyAnswers", "Exam answer photos from the camera only (no gallery or files)"],
              ["examAiGrading", "AI-assisted grading for written exams"],
              ["studyPlan", "AI study plan"],
              ["examPerformanceReport", "AI performance report after grading"],
              ["practiceExamInsight", "AI insight after a practice exam"],
              ["docChat", "Course chat: students ask the lecture notes and files (needs AI help)"],
              ["practiceQna", "Questions on solutions: students ask about a step of a practice solution (needs AI help)"],
              ["studentVideos", "Short AI videos: students ask for a short video on a point of a lecture (needs AI help)"],
              ["poraDhora", "Oral Quiz: an AI teacher asks about a lecture and marks the answers (needs AI help)"],
              ["aiTutor", "AI Tutoring: an AI tutor checks a lecture in writing and marks the answers (needs AI help)"],
              ["interview", "Interview practice: a viva or interview panel asks out loud and gives feedback (needs AI help)"],
              ["agentCopilot", "Admin copilot may make exams, notices and classes here (Settings → AI → Agents)"],
              ["agentGrading", "Grading agent may mark written answers here (needs AI-assisted grading)"],
              ["agentAfterClass", "After-class agent: quiz from class notes, message to absentees"],
              ["agentAtRisk", "At-risk students: weekly check-ins for students who are slipping"],
              ["agentSupport", "Support agent may draft answers to this batch's escalated doubts"],
              ["agentAssignments", "Assignment agent: suggests assignment grades and reminds students about work due (Settings → AI → Agents)"],
              ["agentTutor", "Student tutor: a daily plan for each student (Settings → AI → Agents)"],
              // Existed on the backend (batchModel.js) and was already
              // enforced by generatePracticeQuestions — checked, and 400'd
              // on, alongside aiAssist — but had no checkbox here at all, so
              // there was no way to ever turn it on. "AI-generated practice
              // questions aren't turned on for that batch" was correct every
              // single time it fired, on every batch, with no way to make it
              // stop.
              ["lecturePracticeGeneration", "AI-generated lecture practice questions"],
              // The archive's own AI switches — separate from aiAssist above
              // on purpose, since the archive is a shared pool across every
              // batch's own door, not this batch's own content (see
              // backend/models/batchModel.js). Only matters once this batch
              // has at least one board/exam/book assigned in the Archive
              // tab — these toggles do nothing on their own before that.
              ["archiveAiAssist", "AI help in the archive (explain, similar questions, written questions in practice exams)"],
              ["archiveStudyPlan", "AI study plan (archive)"],
              ["archiveExamInsight", "AI insight after an archive practice exam"],
            ].map(([key, label]) => (
              <label
                key={key}
                className="spread"
                style={{ padding: "10px 0", borderTop: "1px solid var(--border)", cursor: "pointer" }}
              >
                <span className="grow row-tight" style={{ gap: 8 }}>
                  {FEATURE_AGENT_ICON[key] && (() => { const Icon = FEATURE_AGENT_ICON[key]; return <Icon size={16} style={{ flex: "none", color: "var(--primary)" }} />; })()}
                  <span>{label}</span>
                </span>
                <input
                  type="checkbox"
                  checked={featureOn(key)}
                  onChange={() => toggleFeature(key)}
                />
              </label>
            ))}
          </div>
          <p className="hint" style={{ margin: 0 }}>
            AI-assisted grading, the AI study plan, AI-generated lecture practice questions, the AI
            performance report, and the AI insight after a practice exam only take effect when "AI help
            for students" is also on — separate switches so a batch can have any of them without the
            others. "Chapter-pool tiles in Practice" only matters once a chapter has questions filed
            straight under it rather than a topic — see the question bank's chapter pool. The AI study
            plan (archive) and AI insight after an archive practice exam only take effect when "AI help
            in the archive" is also on, same pattern.
          </p>
        </div>
        </>
        )}

        {tab === "danger" && (
        <>
        {/* ---------------- danger zone ---------------- */}
        {can("manageBatches") && (
          <div className="card stack" style={{ borderColor: "var(--incorrect)" }}>
            <div className="row-tight"><Trash2 size={17} style={{ color: "var(--incorrect)" }} /><h2>Danger zone</h2></div>
            <p className="hint" style={{ margin: 0 }}>
              Permanently deletes this batch. Every doubt asked in it is deleted along with it —
              unlike lectures, exams and questions (which are just unassigned, since those can
              belong to other batches too), a doubt belongs to exactly this one and has nowhere
              else to go. Refused if anyone has ever purchased this batch — deactivate it instead
              of deleting a batch with real purchase history.
            </p>
            <button
              className="btn btn-sm btn-quiet"
              style={{ alignSelf: "flex-start" }}
              onClick={toggleActive}
            >
              {batch.isActive ? `Deactivate this ${terms.batch}` : `Activate this ${terms.batch}`}
            </button>
            <button
              className="btn btn-sm btn-danger"
              style={{ alignSelf: "flex-start" }}
              disabled={deletingBatch}
              onClick={async () => {
                const yes = await confirm({
                  title: `Delete "${batch.name}"?`,
                  body: "This permanently deletes the batch and every doubt asked in it. There's no undo. Refused if this batch has any purchases against it.",
                  confirmLabel: `Delete ${terms.batch}`,
                });
                if (yes) {
                  await deleteBatch(id).unwrap();
                  navigate("/batches");
                }
              }}
            >
              <Trash2 size={14} /> {deletingBatch ? "Deleting" : `Delete this ${terms.batch}`}
            </button>
          </div>
        )}
        </>
        )}
      </div>
    </div>
  );
}


const PAGE_SIZE = 50;

function Pager({ page, pages, total, setPage }) {
  const from = (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  return (
    <div className="row-tight" style={{ gap: 6 }}>
      <span className="small muted tnum">{from}–{to} of {total}</span>
      <button className="icon-btn" title="Previous page" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={15} /></button>
      <button className="icon-btn" title="Next page" disabled={page >= pages} onClick={() => setPage(page + 1)}><ChevronRight size={15} /></button>
    </div>
  );
}

function SlideView({ items, kind, index, setIndex, offset, total, onNextPage, onPrevPage, picking, onAssign, onUnassign }) {
  const terms = useTerms();
  const safeIndex = Math.min(index, items.length - 1);
  const item = items[safeIndex];

  // Keys: A adds (or R removes) and the next item slides in, since the
  // done one leaves the list; arrow keys move, across pages too.
  useEffect(() => {
    const onKey = (e) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
      if (!item) return;
      const key = e.key.toLowerCase();
      if (e.key === "ArrowRight") {
        if (safeIndex < items.length - 1) setIndex(safeIndex + 1); else onNextPage?.();
      } else if (e.key === "ArrowLeft") {
        if (safeIndex > 0) setIndex(safeIndex - 1); else onPrevPage?.();
      } else if (key === "a" && picking) onAssign(item);
      else if (key === "r" && !picking) onUnassign(item._id);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [item, safeIndex, items.length, picking, onAssign, onUnassign, onNextPage, onPrevPage, setIndex]);

  if (!item) return null;

  return (
    <div className="stack">
      <div className="card-quiet stack" style={{ minHeight: 160 }}>
        {kind === "questions" && (
          <>
            {item.questionImage?.url && (
              <img
                src={item.questionImage.url}
                alt=""
                style={{ maxWidth: "100%", maxHeight: 200, borderRadius: 6, objectFit: "contain" }}
              />
            )}
            <Latex as="div" className="prose">{item.question}</Latex>
            {item.type === "mcq" && (
              <div className="stack" style={{ gap: 4, marginTop: 4 }}>
                {(item.options || []).map((o) => (
                  <div key={o.key} className={`small${o.key === item.correctOption ? " text-ok" : ""}`} style={{ color: o.key === item.correctOption ? "var(--correct)" : undefined }}>
                    {o.image?.url && (
                      <img
                        src={o.image.url}
                        alt=""
                        style={{ maxWidth: "100%", maxHeight: 120, borderRadius: 4, objectFit: "contain", display: "block", marginBottom: o.text ? 2 : 0 }}
                      />
                    )}
                    {o.key}. {o.text && <Latex>{o.text}</Latex>}
                  </div>
                ))}
              </div>
            )}
            {item.type === "mtf" && (
              <div className="stack" style={{ gap: 4, marginTop: 4 }}>
                {(item.statements || []).map((s, i) => (
                  <div key={i} className="small">
                    <Latex>{s.text}</Latex> — <span style={{ color: s.isTrue ? "var(--correct)" : "var(--incorrect)" }}>{String(s.isTrue)}</span>
                  </div>
                ))}
              </div>
            )}
            {item.type === "written" && <span className="pill" style={{ alignSelf: "flex-start" }}>Written · {item.marks} marks</span>}
            {item.type === "passage" && (
              <span className="pill" style={{ alignSelf: "flex-start" }}>
                Passage · {item.subQuestions?.length || 0} sub-questions · {item.marks} marks
              </span>
            )}
          </>
        )}

        {kind === "lectures" && (
          <>
            <h3 style={{ margin: 0 }}>{item.title}</h3>
            {item.description && <p className="small muted" style={{ margin: 0 }}>{item.description}</p>}
            <div className="row-tight">
              {item.video && <span className="pill row-tight"><PlayCircle size={11} /> Has video</span>}
              {item.bodyMarkdown && <span className="pill">Has notes</span>}
            </div>
          </>
        )}

        {kind === "exams" && (
          <>
            <h3 style={{ margin: 0 }}>{item.title}</h3>
            {item.description && <p className="small muted" style={{ margin: 0 }}>{item.description}</p>}
            <span className="pill" style={{ alignSelf: "flex-start" }}>{item.durationMinutes} min</span>
          </>
        )}

        {item.topic?.title && <span className="muted small" style={{ marginTop: 4 }}>{item.topic.title}</span>}
      </div>

      <div className="spread">
        <button className="icon-btn" disabled={safeIndex === 0 && !onPrevPage} onClick={() => (safeIndex > 0 ? setIndex(safeIndex - 1) : onPrevPage())}>
          <ChevronLeft size={16} />
        </button>
        <span className="small muted tnum">{offset + safeIndex + 1} / {total}</span>
        <button className="icon-btn" disabled={safeIndex === items.length - 1 && !onNextPage} onClick={() => (safeIndex < items.length - 1 ? setIndex(safeIndex + 1) : onNextPage())}>
          <ChevronRight size={16} />
        </button>
      </div>

      {picking ? (
        <button className="btn btn-sm" onClick={() => onAssign(item)}>
          <Plus size={14} /> Add to this {terms.batch} <kbd className="small muted">A</kbd>
        </button>
      ) : (
        <button className="btn btn-sm btn-danger" onClick={() => onUnassign(item._id)}>
          <X size={14} /> Remove from this {terms.batch} <kbd className="small muted">R</kbd>
        </button>
      )}
      <p className="hint" style={{ margin: 0, textAlign: "center" }}>← → to move · {picking ? "A to add" : "R to remove"}</p>
    </div>
  );
}
