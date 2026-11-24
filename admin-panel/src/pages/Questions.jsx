import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  useGetQuestionsQuery, useLazyGetQuestionsQuery, useGetTreeQuery, useGetQuestionTagsQuery,
  useBulkMoveQuestionsMutation, useBulkArchiveQuestionsMutation, useGetAuthoritiesQuery,
} from "../api/contentApi";
import { useAuditQuestionPoolMutation, useGenerateFromBankMutation } from "../api/aiApi";
import { Plus, Upload, Sparkles, FileQuestion, CheckCircle2, AlertCircle, ArrowUpDown, MoveRight, Library, X, Pencil } from "lucide-react";
import { StatusStrip, FilterChips, SearchBox } from "../components/ListTools";
import { YearsInput } from "../components/SourcesEditor";
import { Loading, ErrorNote, Empty, TypePill, Pager, FilingSelect, useConfirm } from "../components/bits";
import Latex from "../components/Latex";
import { BankFiling, ServingLectures } from "../components/BankFiling";
import { SKILL_TYPES } from "../constants/skillTypes";
import SearchSelect from "../components/SearchSelect";

const TYPE_NAMES = { mcq: "Multiple choice", mtf: "True / false", written: "Written", passage: "Passage", coding: "Coding" };
const RESOURCE_NAMES = {
  solution: "Has a written solution", "no-solution-text": "No written solution", "solution-image": "Has a solution picture",
  "solution-pdf": "Has a PDF or attachment", "solution-video": "Has a solution video", "no-solution-video": "No solution video",
  "ai-video": "Has an AI video", "ai-video-published": "AI video published", "no-ai-video": "No AI video",
  "model-answer": "Has a model answer", "no-model-answer": "No model answer",
};

export default function Questions() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get("search") || "");

  // Filters live in the url; the last ones are kept for this tab, so coming
  // back from a question (or the sidebar) shows the same list.
  const restored = useRef(false);
  useEffect(() => {
    let saved = "";
    try { saved = sessionStorage.getItem("questions.filters") || ""; } catch { /* storage off */ }
    if (!restored.current) {
      restored.current = true;
      if (!params.toString() && saved) { setParams(new URLSearchParams(saved), { replace: true }); return; }
    }
    try { sessionStorage.setItem("questions.filters", params.toString()); } catch { /* storage off */ }
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setSearch(params.get("search") || ""); }, [params.get("search")]); // eslint-disable-line react-hooks/exhaustive-deps

  const page = Number(params.get("page")) || 1;

  const filters = {
    search: params.get("search") || undefined,
    type: params.get("type") || undefined,
    subject: params.get("subject") || undefined,
    topic: params.get("topic") || undefined,
    chapter: params.get("chapter") || undefined,
    hasSolution: params.get("hasSolution") || undefined,
    resource: params.get("resource") || undefined,
    tag: params.get("tag") || undefined,
    skillType: params.get("skillType") || undefined,
    sort: params.get("sort") || undefined,
    // AI questions kept only in a lecture quiz are left out of the bank
    // unless this filter asks for just them.
    quizOnly: params.get("quizOnly") || undefined,
    page,
    limit: 30,
  };

  const { data, isLoading, isFetching, error } = useGetQuestionsQuery({ ...filters, counts: "true" });
  const { data: tree } = useGetTreeQuery();
  const { data: allTags } = useGetQuestionTagsQuery();
  const { data: authorities } = useGetAuthoritiesQuery();

  // Moving questions between topics used to only be possible one at a time,
  // through the editor's own topic dropdown — genuinely slow for clearing
  // out a topic with questions spread across a lot of chapters (the only
  // way to make it deletable, since deleteTopic refuses while any question
  // still points at it). Selection is a plain id set; "select every
  // matching question" pages through the current filter itself (fetchAll
  // below) rather than needing a separate endpoint.
  const [selected, setSelected] = useState(new Set());
  // The lecture-quiz-only row whose "Add to chapter/topic" box is open.
  const [filingId, setFilingId] = useState(null);
  const [moveTarget, setMoveTarget] = useState("");
  const [moveResult, setMoveResult] = useState(null);
  const [archiveAuthority, setArchiveAuthority] = useState("");
  // Optional years to file the selection under on that board — empty is fine.
  const [archiveYears, setArchiveYears] = useState([]);
  const [archiveResult, setArchiveResult] = useState(null);
  const [fetchingAll, setFetchingAll] = useState(false);
  const [bulkMove, bulkMoveState] = useBulkMoveQuestionsMutation();
  const [bulkArchive, bulkArchiveState] = useBulkArchiveQuestionsMutation();
  const [fetchQuestions] = useLazyGetQuestionsQuery();
  // "Generate similar with AI" — moved here from Archive.jsx so it works on
  // any selection of questions, not just ones already in the archive. Never
  // a copy of the selected questions: new ones in the same style/difficulty,
  // landing in Review like any other AI-generated question.
  const [showBankForm, setShowBankForm] = useState(false);
  const [bankFiling, setBankFiling] = useState("");
  const [bankCount, setBankCount] = useState(5);
  const [bankDifficulty, setBankDifficulty] = useState("medium");
  const [generateFromBank, generateState] = useGenerateFromBankMutation();
  const [bankResult, setBankResult] = useState(null);
  const confirm = useConfirm();
  // The audit only makes sense scoped to a bounded pool (a topic, or one
  // chapter's topicless pool) — the whole bank at once is neither what one
  // AI call can review nor what "duplicate" means across unrelated topics.
  const auditScope = filters.topic === "none"
    ? { chapter: filters.chapter, topic: "none" }
    : filters.topic
    ? { topic: filters.topic }
    : filters.chapter
    ? { chapter: filters.chapter }
    : null;
  const [runAudit, { isLoading: auditStarting, error: auditError }] = useAuditQuestionPoolMutation();
  // Results live on their own page (audit-pool/:id), backed by a persisted
  // document — not in component state here. Holding the run in this page's
  // state meant a reload, a filter change, or just clicking away lost a
  // result that already cost a real AI call; a dedicated page like Review's
  // is what survives all three.
  const runAuditAndGo = async (body) => {
    try {
      const audit = await runAudit(body).unwrap();
      navigate(`/audit-pool/${audit._id}`);
    } catch {
      // rendered below via auditError
    }
  };
  const startAudit = () => auditScope && runAuditAndGo(auditScope);
  const startSelectedAudit = () => selected.size > 0 && runAuditAndGo({ questionIds: [...selected] });

  const toggleSelected = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const clearSelection = () => {
    setSelected(new Set());
    setMoveTarget("");
    setMoveResult(null);
    setArchiveAuthority("");
    setArchiveYears([]);
    setArchiveResult(null);
    setShowBankForm(false);
    setBankFiling("");
    setBankResult(null);
  };

  // Walks every page of the *current* filter (not just what's rendered) and
  // selects all of it — this is what actually solves "a topic with a lot of
  // chapters": filtering by that topic already scopes to every question
  // under it regardless of which chapter, so this is "every question in
  // that topic" in one click instead of one page (30) at a time.
  const selectAllMatching = async () => {
    if (!data?.total) return;
    setFetchingAll(true);
    setMoveResult(null);
    try {
      const ids = new Set();
      const pages = Math.ceil(data.total / 100);
      for (let p = 1; p <= pages; p += 1) {
        const page = await fetchQuestions({ ...filters, page: p, limit: 100 }).unwrap();
        page.questions.forEach((q) => ids.add(q._id));
      }
      setSelected(ids);
    } catch (err) {
      setMoveResult({ error: err.data?.message || "Could not load every matching question." });
    } finally {
      setFetchingAll(false);
    }
  };

  const runBulkMove = async () => {
    if (!moveTarget || selected.size === 0) return;
    const [kind, id] = moveTarget.split(":");
    const body = { questionIds: [...selected], topic: kind === "topic" ? id : undefined, chapter: kind === "chapter" ? id : undefined };

    const yes = await confirm({
      title: `Move ${selected.size} question${selected.size === 1 ? "" : "s"}?`,
      body: "Each one is re-filed under the chosen topic or chapter — passage questions in the selection can't take a topic and will be reported instead of moved.",
      tone: "neutral",
      confirmLabel: "Move",
    });
    if (!yes) return;

    try {
      const result = await bulkMove(body).unwrap();
      setMoveResult(result);
      setSelected(new Set());
      setMoveTarget("");
    } catch (err) {
      setMoveResult({ error: err.data?.message || "Could not move these questions." });
    }
  };

  // Same "select questions, apply one change to all of them" mechanism as
  // runBulkMove above, applied to isPublic (+ authority) instead of topic/
  // chapter — the same one-step "file these under a board/exam and publish
  // them" action Archive.jsx's own admins keep asking to do from the
  // regular question list rather than one editor at a time.
  const runBulkArchive = async (isPublic) => {
    if (selected.size === 0) return;
    // No generic "add to archive" — a specific board/exam/book is mandatory,
    // enforced here and again server-side.
    if (isPublic && !archiveAuthority) return;
    const body = isPublic
      ? { questionIds: [...selected], isPublic, authority: archiveAuthority, years: archiveYears }
      : { questionIds: [...selected], isPublic };

    const archiveName = isPublic ? authorities?.find((a) => a._id === archiveAuthority)?.name : null;
    const yes = await confirm({
      title: isPublic
        ? `Add ${selected.size} question${selected.size === 1 ? "" : "s"} to ${archiveName || "the chosen board"}${archiveYears.length ? ` (${archiveYears.join(", ")})` : ""}?`
        : `Remove ${selected.size} question${selected.size === 1 ? "" : "s"} from the archive?`,
      body: isPublic
        ? `Each one becomes visible in the public archive, filed under ${archiveName || "the chosen board/exam/book"}${archiveYears.length ? ` for ${archiveYears.join(", ")}` : ""}. Any boards and years it already has are kept.`
        : "Each one stops appearing in the public archive. Its board/exam/book and year stay as they are, in case it's added back later.",
      tone: "neutral",
      confirmLabel: isPublic ? "Add to archive" : "Remove",
    });
    if (!yes) return;

    try {
      const result = await bulkArchive(body).unwrap();
      setArchiveResult(result);
      setSelected(new Set());
      setArchiveAuthority("");
      setArchiveYears([]);
    } catch (err) {
      setArchiveResult({ error: err.data?.message || "Could not update these questions." });
    }
  };

  const runGenerateFromBank = async () => {
    if (!bankFiling || selected.size === 0) return;
    const [kind, id] = bankFiling.split(":");
    setBankResult(null);
    try {
      const result = await generateFromBank({
        exampleQuestionIds: [...selected],
        topicId: kind === "topic" ? id : undefined,
        chapterId: kind === "chapter" ? id : undefined,
        count: Number(bankCount),
        types: ["mcq"],
        difficulty: bankDifficulty,
      }).unwrap();
      setBankResult({ message: result.message });
      setSelected(new Set());
      setShowBankForm(false);
    } catch (err) {
      setBankResult({ error: err.data?.message || "Could not generate questions." });
    }
  };

  // Everything but the page: what "Clear filters" resets.
  const filtering = [...params.keys()].some((k) => k !== "page");
  const clearFilters = () => { setSearch(""); setParams(new URLSearchParams()); };

  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value === undefined || next.get(key) === value) next.delete(key);
    else next.set(key, value);
    // Any real filter change invalidates whatever page you were on — page 4
    // of a fresh search is very unlikely to still have four pages of
    // results, and landing there silently would look like the filter
    // returned nothing.
    if (key !== "page") next.delete("page");
    setParams(next);
  };

  // Picking a subject narrows which topics/chapters show up below, and any
  // topic or chapter already selected from a *different* subject stops
  // applying — keeping it around would silently combine "this subject" with
  // "that other subject's topic" into a filter that can never match
  // anything.
  const setSubjectFilter = (subjectId) => {
    const next = new URLSearchParams(params);
    if (subjectId) next.set("subject", subjectId); else next.delete("subject");
    next.delete("topic");
    next.delete("chapter");
    next.delete("page");
    setParams(next);
  };

  // FilingSelect (bits.jsx) hands back the same "topic:<id>" / "chapter:<id>"
  // encoding the question editor uses. A chapter pick here means
  // "chapter-pool questions under this one chapter" specifically — chapter
  // alone would match every question under it, topic'd or not — so it sets
  // topic=none (see getQuestions' sentinel) alongside chapter, the same way
  // "Chapter pool only" below sets topic=none for every chapter at once.
  // This is deliberately narrower than the plain "Chapter" browse select
  // just below it (setChapterFilter) — that one is "every question in this
  // chapter", this one is "only the ones with no topic".
  const setFiling = (filing) => {
    const next = new URLSearchParams(params);
    const [kind, filingId] = filing.split(":");
    if (kind === "chapter") {
      next.set("chapter", filingId);
      next.set("topic", "none");
    } else if (kind === "topic") {
      next.set("topic", filingId);
      // Keep a browsed chapter when the topic is one of its own, so the
      // chapter dropdown stays on it and the topic list stays narrowed.
      const keep = filters.chapter && filingChapters.some((c) => c._id === filters.chapter && c.topics.some((t) => t._id === filingId));
      if (!keep) next.delete("chapter");
    } else {
      next.delete("topic");
      next.delete("chapter");
    }
    next.delete("page");
    setParams(next);
  };

  // Plain "browse this chapter" — every question filed under it, topic'd or
  // in the pool, same as picking a chapter in BatchDetail.jsx's content
  // picker. chapter is required on every question regardless of topic (see
  // questionModel.js), so `chapter` alone already matches everything
  // getQuestions needs to — this was previously impossible from the UI:
  // the only chapter-shaped control was FilingSelect above, which always
  // narrows to the topicless pool by forcing topic=none alongside it.
  const setChapterFilter = (chapterId) => {
    const next = new URLSearchParams(params);
    if (chapterId) next.set("chapter", chapterId); else next.delete("chapter");
    next.delete("topic");
    next.delete("page");
    setParams(next);
  };

  const setPage = (n) => {
    const next = new URLSearchParams(params);
    if (n <= 1) next.delete("page");
    else next.set("page", String(n));
    setParams(next);
  };

  const subjects = (tree || []).map((subject) => ({ _id: subject._id, title: subject.title }));

  // Once a subject is picked, its own name is redundant in every option —
  // "Chapter · Topic" says enough. Left on "Any subject", the list would
  // otherwise be every topic across the whole syllabus in one flat dropdown,
  // which is exactly what got hard to scan with more than a couple subjects
  // — the reason FilingSelect below is scoped to one subject at a time
  // rather than rendering the whole tree in one control.
  const topicSource = filters.subject
    ? (tree || []).filter((subject) => subject._id === filters.subject)
    : (tree || []);

  // Flat, purely for looking a topic's label up by id (the "pending in
  // review" banner below) — not what's rendered as a dropdown.
  const topics = topicSource.flatMap((subject) =>
    subject.chapters.flatMap((chapter) =>
      chapter.topics.map((topic) => ({
        _id: topic._id,
        label: filters.subject ? `${chapter.title} · ${topic.title}` : `${subject.title} · ${topic.title}`,
      }))
    )
  );

  // Grouped by chapter for FilingSelect — same subject scoping as `topics`
  // above, just shaped as chapters-with-their-topics instead of a flat list.
  const filingChapters = topicSource.flatMap((subject) =>
    subject.chapters.map((chapter) => ({
      _id: chapter._id,
      title: filters.subject ? chapter.title : `${subject.title} · ${chapter.title}`,
      topics: chapter.topics,
    }))
  );
  // Once a chapter is picked to browse, the topic dropdown only offers that
  // chapter's own topics.
  const topicChapters = filters.chapter && filters.topic !== "none"
    ? filingChapters.filter((c) => c._id === filters.chapter)
    : filingChapters;
  const filingValue = filters.chapter && filters.topic === "none"
    ? `chapter:${filters.chapter}`
    : filters.topic && filters.topic !== "none"
    ? `topic:${filters.topic}`
    : "";

  return (
    <div className="page">
      <div className="page-head spread">
        <div>
          <h1>Questions</h1>
          <p className="muted small tnum" style={{ margin: "2px 0 0" }}>
            {isLoading ? "…" : `${data?.total ?? 0} in the bank`}
          </p>
        </div>
        <div className="row-tight">
          <Link className="btn btn-quiet" to="/questions/import"><Upload size={15} /> Bulk import</Link>
          <Link className="btn" to="/questions/new"><Plus size={15} /> New question</Link>
        </div>
      </div>

      <div className="stack">
        {/* Zero published results for a topic used to be indistinguishable
            from "nothing was ever generated" — this is what tells the two
            apart, since a freshly-generated batch sits in Review until
            approved and would otherwise look like it went nowhere. */}
        {data?.pendingForTopic > 0 && (
          <div className="banner row-tight">
            <Sparkles size={15} />
            <span>
              {data.pendingForTopic} question{data.pendingForTopic === 1 ? "" : "s"} for this topic{" "}
              {data.pendingForTopic === 1 ? "is" : "are"} waiting in Review, not shown here yet.{" "}
              <Link
                to={`/review?topic=${filters.topic}&topicName=${encodeURIComponent(topics.find((t) => t._id === filters.topic)?.label || "")}`}
                style={{ textDecoration: "underline" }}
              >
                Review them
              </Link>
            </span>
          </div>
        )}

        <StatusStrip
          value={filters.type || ""}
          onChange={(v) => setFilter("type", v || undefined)}
          items={[
            { key: "", label: "All types", count: data?.counts?.all },
            ...["mcq", "mtf", "written", "passage", "coding"].map((type) => ({
              key: type,
              label: TYPE_NAMES[type],
              count: data?.counts?.[type],
            })),
          ]}
        />

        <SearchBox value={search} onChange={setSearch} onSubmit={(v) => setFilter("search", v || undefined)} placeholder="Search question text" />

        <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
          <button
            className={`pill pill-btn${params.get("hasSolution") === "false" ? " pill-on" : ""}`}
            onClick={() => setFilter("hasSolution", "false")}
          >
            No solution yet
          </button>

          <button
            className={`pill pill-btn${params.get("quizOnly") === "true" ? " pill-on" : ""}`}
            title="AI questions made for a lecture's quiz and not yet saved to the bank"
            onClick={() => setFilter("quizOnly", "true")}
          >
            Lecture quiz only
          </button>

          {/* What a question already has: backend questionController.js
              RESOURCE_FILTERS. */}
          <select
            className={`pill pill-btn${params.get("resource") ? " pill-on" : ""}`}
            style={{ maxWidth: 200 }}
            value={params.get("resource") || ""}
            onChange={(e) => setFilter("resource", e.target.value || undefined)}
          >
            <option value="">Any resources</option>
            <optgroup label="Solution">
              <option value="solution">Has a written solution</option>
              <option value="no-solution-text">No written solution</option>
              <option value="solution-image">Has a solution picture</option>
              <option value="solution-pdf">Has a PDF or attachment</option>
            </optgroup>
            <optgroup label="Video">
              <option value="solution-video">Has a solution video</option>
              <option value="no-solution-video">No solution video</option>
              <option value="ai-video">Has an AI video</option>
              <option value="ai-video-published">AI video published</option>
              <option value="no-ai-video">No AI video</option>
            </optgroup>
            <optgroup label="Written questions">
              <option value="model-answer">Has a model answer</option>
              <option value="no-model-answer">No model answer</option>
            </optgroup>
          </select>

          {/* Chapter pool, scoped to whatever chapter is already picked in
              the plain Chapter select just below — or every chapter at
              once, syllabus-wide, when none is picked. Used to always clear
              the chapter filter on click, which threw away a chapter an
              admin had just picked right before reaching for this — looked
              exactly like "the chapter filter doesn't work". */}
          <button
            className={`pill pill-btn${params.get("topic") === "none" ? " pill-on" : ""}`}
            onClick={() => {
              const next = new URLSearchParams(params);
              if (params.get("topic") === "none") next.delete("topic");
              else next.set("topic", "none");
              next.delete("page");
              setParams(next);
            }}
          >
            Chapter pool only
          </button>

          {subjects.length > 0 && (
            <SearchSelect
              className="pill pill-btn"
              style={{ maxWidth: 180 }}
              value={filters.subject || ""}
              onChange={(e) => setSubjectFilter(e.target.value || undefined)}
            >
              <option value="">Any subject</option>
              {subjects.map((subject) => (
                <option key={subject._id} value={subject._id}>{subject.title}</option>
              ))}
            </SearchSelect>
          )}

          {/* Browse a whole chapter — every question filed under it, topic'd
              or in the pool. Separate from FilingSelect below on purpose:
              that one only ever narrows to a topic or that chapter's
              topicless pool, never "everything in this chapter" (see
              setChapterFilter's comment above). */}
          {filingChapters.length > 0 && (
            <SearchSelect
              className="pill pill-btn"
              style={{ maxWidth: 180 }}
              value={filters.chapter && filters.topic !== "none" ? filters.chapter : ""}
              onChange={(e) => setChapterFilter(e.target.value)}
            >
              <option value="">Any chapter</option>
              {filingChapters.map((c) => (
                <option key={c._id} value={c._id}>{c.title}</option>
              ))}
            </SearchSelect>
          )}

          {filingChapters.length > 0 && (
            <FilingSelect
              chapters={topicChapters}
              value={filingValue}
              onChange={setFiling}
              placeholder={filters.chapter && filters.topic !== "none" ? "Any topic in this chapter" : filters.subject ? "Any topic in this subject" : "Any topic"}
              className="pill pill-btn"
              style={{ maxWidth: 220 }}
            />
          )}

          {allTags?.length > 0 && (
            <SearchSelect
              className="pill pill-btn"
              style={{ maxWidth: 160 }}
              value={filters.tag || ""}
              onChange={(e) => setFilter("tag", e.target.value || undefined)}
            >
              <option value="">Any tag</option>
              {allTags.map((tag) => (
                <option key={tag} value={tag}>{tag}</option>
              ))}
            </SearchSelect>
          )}

          <select
            className="pill pill-btn"
            style={{ maxWidth: 180 }}
            value={filters.skillType || ""}
            onChange={(e) => setFilter("skillType", e.target.value || undefined)}
          >
            <option value="">Any skill type</option>
            <option value="unassigned">Not assigned</option>
            {SKILL_TYPES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>

          {auditScope && (
            <button
              className="pill pill-btn"
              disabled={auditStarting}
              onClick={startAudit}
              title="AI-review every question in this topic or chapter pool for errors and duplicates"
            >
              <Sparkles size={13} /> {auditStarting ? "Auditing…" : "AI audit"}
            </button>
          )}

          {filtering && (
            <button className="pill pill-btn row-tight" style={{ gap: 4 }} onClick={clearFilters} title="Show every question again">
              <X size={12} /> Clear filters
            </button>
          )}

          <span className="grow" />

          <label className="row-tight small muted" style={{ gap: 6 }}>
            <ArrowUpDown size={13} />
            <select
              className="pill pill-btn"
              value={params.get("sort") || "recent"}
              onChange={(e) => setFilter("sort", e.target.value === "recent" ? undefined : e.target.value)}
            >
              <option value="recent">Newest first</option>
              <option value="topic">By topic</option>
            </select>
          </label>
        </div>

        <FilterChips
          onClearAll={clearFilters}
          chips={[
            filters.search && { key: "search", label: `"${filters.search}"`, onClear: () => { setSearch(""); setFilter("search", undefined); } },
            filters.type && { key: "type", label: TYPE_NAMES[filters.type] || filters.type, onClear: () => setFilter("type", undefined) },
            filters.subject && { key: "subject", label: subjects.find((x) => x._id === filters.subject)?.title || "Subject", onClear: () => setSubjectFilter(undefined) },
            filters.chapter && filters.topic !== "none" && { key: "chapter", label: filingChapters.find((c) => c._id === filters.chapter)?.title || "Chapter", onClear: () => setFilter("chapter", undefined) },
            filters.topic && { key: "topic", label: filters.topic === "none" ? "Chapter pool only" : topics.find((t) => t._id === filters.topic)?.label || "Topic", onClear: () => setFilter("topic", undefined) },
            filters.hasSolution === "false" && { key: "hasSolution", label: "No solution yet", onClear: () => setFilter("hasSolution", undefined) },
            filters.quizOnly === "true" && { key: "quizOnly", label: "Lecture quiz only", onClear: () => setFilter("quizOnly", undefined) },
            filters.resource && { key: "resource", label: RESOURCE_NAMES[filters.resource] || "Resources", onClear: () => setFilter("resource", undefined) },
            filters.tag && { key: "tag", label: `#${filters.tag}`, onClear: () => setFilter("tag", undefined) },
            filters.skillType && { key: "skillType", label: filters.skillType === "unassigned" ? "No skill type" : SKILL_TYPES.find((x) => x.value === filters.skillType)?.label || filters.skillType, onClear: () => setFilter("skillType", undefined) },
          ]}
        />

        <ErrorNote error={error || auditError} />

        {selected.size > 0 && (
          <div className="banner row-tight" style={{ flexWrap: "wrap" }}>
            <strong>{selected.size} selected</strong>

            {data?.total > selected.size && (
              <button className="btn btn-sm btn-quiet" onClick={selectAllMatching} disabled={fetchingAll}>
                {fetchingAll ? "Loading…" : `Select all ${data.total} matching this filter`}
              </button>
            )}

            <span className="grow" />

            <button className="btn btn-sm btn-quiet" disabled={auditStarting} onClick={startSelectedAudit}>
              <Sparkles size={14} /> {auditStarting ? "Auditing…" : `AI audit these ${selected.size}`}
            </button>

            {filingChapters.length > 0 && (
              <FilingSelect
                chapters={filingChapters}
                value={moveTarget}
                onChange={setMoveTarget}
                placeholder="Move to…"
                className="pill pill-btn"
                style={{ maxWidth: 220 }}
              />
            )}
            <button className="btn btn-sm" disabled={!moveTarget || bulkMoveState.isLoading} onClick={runBulkMove}>
              <MoveRight size={14} /> {bulkMoveState.isLoading ? "Moving…" : "Move"}
            </button>

            {authorities?.length > 0 && (
              <SearchSelect
                className="pill pill-btn"
                style={{ maxWidth: 180 }}
                value={archiveAuthority}
                onChange={(e) => setArchiveAuthority(e.target.value)}
                title="There is no generic archive — pick which board/exam/book these belong to"
              >
                <option value="">Choose board/exam/book…</option>
                {authorities.map((a) => (
                  <option key={a._id} value={a._id}>{a.name}</option>
                ))}
              </SearchSelect>
            )}
            {archiveAuthority && (
              <div style={{ maxWidth: 240 }} title="Optional — every year these appeared on this board">
                <YearsInput years={archiveYears} onChange={setArchiveYears} placeholder="Years (optional)" />
              </div>
            )}
            <button
              className="btn btn-sm"
              disabled={!archiveAuthority || bulkArchiveState.isLoading}
              title={archiveAuthority ? undefined : "Pick a board/exam/book first"}
              onClick={() => runBulkArchive(true)}
            >
              <Library size={14} /> {bulkArchiveState.isLoading ? "Working…" : "Add to archive"}
            </button>
            <button className="btn btn-sm btn-quiet" disabled={bulkArchiveState.isLoading} onClick={() => runBulkArchive(false)}>
              Remove from archive
            </button>

            <button className="btn btn-sm btn-quiet" onClick={() => setShowBankForm((s) => !s)}>
              <Sparkles size={14} /> Generate similar with AI
            </button>

            <button className="icon-btn" title="Clear selection" onClick={clearSelection}><X size={15} /></button>
          </div>
        )}


        {showBankForm && (
          <div className="card stack">
            <p className="small muted" style={{ margin: 0 }}>
              Generates brand-new questions in the same style and difficulty as the {selected.size} selected —
              never a copy of them. Lands in Review like any other AI-generated question.
            </p>
            {filingChapters.length > 0 && (
              <FilingSelect
                chapters={filingChapters}
                value={bankFiling}
                onChange={setBankFiling}
                placeholder="File new questions under…"
                className="pill pill-btn"
                style={{ maxWidth: 260 }}
              />
            )}
            <div className="row-tight">
              <label className="row-tight small muted">
                Count
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={20}
                  style={{ width: 70 }}
                  value={bankCount}
                  onChange={(e) => setBankCount(e.target.value)}
                />
              </label>
              <select className="pill pill-btn" value={bankDifficulty} onChange={(e) => setBankDifficulty(e.target.value)}>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
              <button className="btn btn-sm" disabled={!bankFiling || generateState.isLoading} onClick={runGenerateFromBank}>
                {generateState.isLoading ? "Generating…" : "Generate"}
              </button>
            </div>
            <ErrorNote error={generateState.error} />
          </div>
        )}

        {bankResult && (
          bankResult.error ? (
            <ErrorNote error={{ data: { message: bankResult.error } }} />
          ) : (
            <div className="banner banner-ok row-tight">
              <span>{bankResult.message}</span>
              <button className="icon-btn" title="Dismiss" onClick={() => setBankResult(null)} style={{ marginLeft: "auto" }}><X size={15} /></button>
            </div>
          )
        )}

        {archiveResult && (
          archiveResult.error ? (
            <ErrorNote error={{ data: { message: archiveResult.error } }} />
          ) : (
            <div className="banner banner-ok row-tight">
              <span>Updated {archiveResult.updated} question{archiveResult.updated === 1 ? "" : "s"}.</span>
              <button className="icon-btn" title="Dismiss" onClick={() => setArchiveResult(null)} style={{ marginLeft: "auto" }}><X size={15} /></button>
            </div>
          )
        )}

        {moveResult && (
          moveResult.error ? (
            <ErrorNote error={{ data: { message: moveResult.error } }} />
          ) : (
            <div className={`banner row-tight ${moveResult.rejected?.length ? "banner-warn" : "banner-ok"}`}>
              <span>
                Moved {moveResult.moved} question{moveResult.moved === 1 ? "" : "s"}.
                {moveResult.rejected?.length > 0 && ` ${moveResult.rejected.length} skipped — passage questions can't be filed under a topic.`}
              </span>
              <button className="icon-btn" title="Dismiss" onClick={() => setMoveResult(null)} style={{ marginLeft: "auto" }}><X size={15} /></button>
            </div>
          )
        )}

        {isLoading ? (
          <Loading />
        ) : data?.questions?.length ? (
          <div className="list" style={{ opacity: isFetching ? 0.65 : 1, transition: "opacity 120ms ease" }}>
            {data.questions.map((question, index) => {
              const byTopic = filters.sort === "topic";
              const previousTopic = index > 0 ? data.questions[index - 1].topic?.title : null;
              const showTopicHeader = byTopic && question.topic?.title !== previousTopic;

              return (
                <div key={question._id}>
                  {showTopicHeader && (
                    <div className="muted small" style={{ padding: "14px 2px 6px", fontWeight: 500 }}>
                      {question.topic?.title || "No topic"}
                    </div>
                  )}
                  <div className="row-tight" style={{ alignItems: "stretch" }}>
                    <label
                      className="row-tight"
                      style={{ alignItems: "center", padding: "0 4px", cursor: "pointer" }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(question._id)}
                        onChange={() => toggleSelected(question._id)}
                      />
                    </label>
                    <Link to={`/questions/${question._id}`} className="list-row grow">
                <div className="grow">
                  <div className="row-tight" style={{ marginBottom: 6, flexWrap: "wrap" }}>
                    <TypePill type={question.type} />
                    {question.difficulty && <span className="pill">{question.difficulty}</span>}
                    {question.solutionText ? (
                      <span className="pill pill-ok row-tight" style={{ gap: 4 }}>
                        <CheckCircle2 size={11} /> Solution
                      </span>
                    ) : (
                      <span className="pill pill-warn row-tight" style={{ gap: 4 }}>
                        <AlertCircle size={11} /> No solution
                      </span>
                    )}
                    {question.source === "ai" && (
                      <span className="pill pill-ai row-tight" style={{ gap: 4 }}>
                        <Sparkles size={11} /> AI
                      </span>
                    )}
                    {question.status === "pending_review" && (
                      <span className="pill pill-warn">Awaiting review</span>
                    )}
                    {question.lectureQuizOnly && <span className="pill">Lecture quiz only</span>}
                    {question.tags?.map((tag) => (
                      <span key={tag} className="pill">{tag}</span>
                    ))}
                  </div>
                  <div className="row-tight" style={{ alignItems: "flex-start", gap: 10 }}>
                    {question.questionImage?.url && (
                      <img
                        src={question.questionImage.url}
                        alt=""
                        style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 8, flexShrink: 0 }}
                      />
                    )}
                    <Latex as="div" className="grow" style={{ lineHeight: 1.5 }}>
                      {question.question}
                    </Latex>
                  </div>
                  {!byTopic && question.topic?.title && (
                    <div className="muted small" style={{ marginTop: 4 }}>
                      {question.topic.title}
                    </div>
                  )}
                </div>
                <span className="tnum muted small" title="Marks">{question.marks}</span>
                    </Link>
                    <span className="row-hover-actions">
                      <Link className="icon-btn" title="Edit" to={`/questions/${question._id}/edit`}><Pencil size={14} /></Link>
                    </span>
                  </div>
                  {question.lectureQuizOnly && (
                    <div className="stack" style={{ gap: 6, padding: "6px 4px 10px 30px" }}>
                      <div className="spread" style={{ flexWrap: "wrap", gap: 6 }}>
                        <ServingLectures lectures={question.lectures} />
                        <button
                          type="button"
                          className={`btn btn-sm${filingId === question._id ? " btn-quiet" : ""}`}
                          onClick={() => setFilingId(filingId === question._id ? null : question._id)}
                        >
                          <Library size={13} /> {filingId === question._id ? "Close" : "Add to chapter/topic"}
                        </button>
                      </div>
                      {filingId === question._id && (
                        <BankFiling
                          question={question}
                          startChapter={question.chapter?._id || ""}
                          startTopic={question.topic?._id || ""}
                          hint="Adding it puts it in the question bank: the Questions page, the exam builder and practice. It stays in its lecture quizzes."
                          onSaved={() => setFilingId(null)}
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <Empty
            icon={FileQuestion}
            title="No questions match"
            hint={params.toString() ? "Try clearing a filter." : "Write your first question to get started."}
            action={<Link className="btn" to="/questions/new"><Plus size={15} /> New question</Link>}
          />
        )}

        {data && <Pager page={data.page} pages={data.pages} total={data.total} onChange={setPage} />}
      </div>
    </div>
  );
}