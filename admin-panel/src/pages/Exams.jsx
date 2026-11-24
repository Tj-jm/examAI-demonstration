import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useGetExamsQuery, useCreateExamMutation, useGetBatchesQuery, useGetSubjectsQuery } from "../api/contentApi";
import { Plus, ClipboardList, ChevronRight, CheckCircle2, FileEdit, Radio, Layers, Clock, Users, ListChecks } from "lucide-react";
import { Loading, ErrorNote, Empty, Field, Pager } from "../components/bits";
import { useTerms } from "../terms";
import SearchSelect from "../components/SearchSelect";
import { StatusStrip, FilterChips, ViewToggle, useViewMode, SearchBox } from "../components/ListTools";

const MODES = { quiz: "Quiz", test: "Test", mock: "Mock" };
const STATUS_LABEL = { published: "Published", draft: "Drafts", open: "Open now", unassigned: "Not in a batch" };

// "Opens 3 May, 10:00" / "Closes 5 May" / "Closed": the schedule, short.
const when = (exam) => {
  const fmt = (d) => new Date(d).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const now = Date.now();
  if (exam.opensAt && new Date(exam.opensAt).getTime() > now) return `Opens ${fmt(exam.opensAt)}`;
  if (exam.closesAt) return new Date(exam.closesAt).getTime() > now ? `Closes ${fmt(exam.closesAt)}` : "Closed";
  return "";
};
const batchNames = (exam) => {
  const names = (exam.batches || []).map((b) => b.name).filter(Boolean);
  if (!names.length) return "Not in a batch";
  return names.length > 3 ? `${names.slice(0, 3).join(", ")} +${names.length - 3}` : names.join(", ");
};

function ExamPills({ exam }) {
  return (
    <div className="row-tight" style={{ flexWrap: "wrap", gap: 4 }}>
      <span className="pill">{MODES[exam.mode] || exam.mode}</span>
      {exam.paperSet?.label && (
        <span className="pill row-tight" style={{ gap: 4 }} title="One set of a paper-set group">
          <Layers size={11} /> Set {exam.paperSet.label}
        </span>
      )}
      {exam.isPublished ? (
        <span className="pill pill-ok row-tight" style={{ gap: 4 }}><CheckCircle2 size={11} /> Published</span>
      ) : (
        <span className="pill pill-warn row-tight" style={{ gap: 4 }}><FileEdit size={11} /> Draft</span>
      )}
      {exam.isActive && <span className="pill pill-ok row-tight" style={{ gap: 4 }}><Radio size={11} /> Open</span>}
    </div>
  );
}

export default function Exams() {
  const terms = useTerms();
  // Filters live in the URL, so a filtered list survives a reload and a
  // trip into an exam and back.
  const [params, setParams] = useSearchParams();
  const filters = {
    search: params.get("search") || "",
    batch: params.get("batch") || "",
    subject: params.get("subject") || "",
    mode: params.get("mode") || "",
    status: params.get("status") || "",
  };
  const page = Number(params.get("page")) || 1;
  const [searchDraft, setSearchDraft] = useState(filters.search);
  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    next.delete("page");
    setParams(next);
  };
  const setPage = (n) => {
    const next = new URLSearchParams(params);
    if (n <= 1) next.delete("page"); else next.set("page", String(n));
    setParams(next);
  };
  const filtered = Object.values(filters).some(Boolean);
  const clearFilters = () => { setSearchDraft(""); setParams(new URLSearchParams()); };

  const [view, setView] = useViewMode("exams", "list");
  const query = Object.fromEntries(Object.entries({ ...filters, page, counts: "true" }).filter(([, v]) => v));
  const { data, isLoading, isFetching, error } = useGetExamsQuery(query);
  const { data: batches } = useGetBatchesQuery({ includeInactive: "true" });
  const { data: subjects } = useGetSubjectsQuery();
  const [create, { isLoading: creating, error: createError }] = useCreateExamMutation();
  const [draft, setDraft] = useState(null);
  const navigate = useNavigate();

  if (isLoading) return <Loading />;

  const submit = async (event) => {
    event.preventDefault();
    try {
      const exam = await create({
        title: draft.title,
        durationMinutes: Number(draft.durationMinutes),
        mode: draft.mode,
      }).unwrap();
      setDraft(null);
      // Straight into the builder — a new exam with no questions is not
      // something anyone wants to look at in a list.
      navigate(`/exams/${exam._id}`);
    } catch {
      // rendered below
    }
  };

  const exams = data?.exams || [];
  const counts = data?.counts || {};
  const batchName = (batches || []).find((b) => b._id === filters.batch)?.name;
  const subjectName = (subjects || []).find((x) => x._id === filters.subject)?.title;

  return (
    <div className="page">
      <div className="page-head spread">
        <div>
          <h1>Exams</h1>
          <p className="muted small tnum" style={{ margin: "2px 0 0" }}>
            {data?.total ?? 0} total
          </p>
        </div>
        <div className="row-tight">
          <Link className="btn btn-quiet" to="/exam-sets">
            <Layers size={15} /> Paper sets
          </Link>
          <button
            className="btn"
            onClick={() => setDraft({ title: "", durationMinutes: 40, mode: "test" })}
          >
            <Plus size={15} /> New exam
          </button>
        </div>
      </div>

      <div className="stack">
        <ErrorNote error={error || createError} />

        <StatusStrip
          value={filters.status}
          onChange={(v) => setFilter("status", v)}
          items={[
            { key: "", label: "All exams", count: counts.all },
            { key: "published", label: "Published", count: counts.published, tone: "ok" },
            { key: "draft", label: "Drafts", count: counts.draft, tone: counts.draft ? "warn" : undefined },
            { key: "open", label: "Open now", count: counts.open, tone: "ok" },
            { key: "unassigned", label: "Not in a batch", count: counts.unassigned, tone: counts.unassigned ? "warn" : undefined },
          ]}
        />

        <div className="row-tight" style={{ flexWrap: "wrap", gap: 8 }}>
          <SearchBox value={searchDraft} onChange={setSearchDraft} onSubmit={(v) => setFilter("search", v.trim())} placeholder="Search exams by title" />
          <SearchSelect className="select" style={{ maxWidth: 180 }} value={filters.batch} onChange={(e) => setFilter("batch", e.target.value)}>
            <option value="">Any {terms.batch}</option>
            {(batches || []).map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
          </SearchSelect>
          <SearchSelect className="select" style={{ maxWidth: 180 }} value={filters.subject} onChange={(e) => setFilter("subject", e.target.value)}>
            <option value="">Any subject</option>
            {(subjects || []).map((x) => <option key={x._id} value={x._id}>{x.title}</option>)}
          </SearchSelect>
          <select className="select" style={{ width: "auto" }} value={filters.mode} onChange={(e) => setFilter("mode", e.target.value)}>
            <option value="">Any kind</option>
            <option value="quiz">Quiz</option>
            <option value="test">Test</option>
            <option value="mock">Mock</option>
          </select>
          <ViewToggle value={view} onChange={setView} />
        </div>

        <FilterChips
          onClearAll={clearFilters}
          chips={[
            filters.search && { key: "search", label: `"${filters.search}"`, onClear: () => { setSearchDraft(""); setFilter("search", ""); } },
            filters.batch && { key: "batch", label: batchName || terms.Batch || "Batch", onClear: () => setFilter("batch", "") },
            filters.subject && { key: "subject", label: subjectName || "Subject", onClear: () => setFilter("subject", "") },
            filters.mode && { key: "mode", label: MODES[filters.mode], onClear: () => setFilter("mode", "") },
            filters.status && { key: "status", label: STATUS_LABEL[filters.status], onClear: () => setFilter("status", "") },
          ]}
        />

        {draft && (
          <div className="overlay" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && setDraft(null)}>
          <form className="dialog stack" style={{ maxWidth: 480, width: "94vw" }} onSubmit={submit} onKeyDown={(e) => e.key === "Escape" && setDraft(null)}>
            <h3 style={{ margin: 0 }}>New exam</h3>
            <Field label="Title">
              <input
                className="input"
                autoFocus
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </Field>

            <div className="row">
              <Field label="Length (minutes)">
                <input
                  className="input tnum"
                  type="number"
                  min="1"
                  value={draft.durationMinutes}
                  onChange={(e) => setDraft({ ...draft, durationMinutes: e.target.value })}
                />
              </Field>

              <Field label="Kind">
                <select
                  className="select"
                  value={draft.mode}
                  onChange={(e) => setDraft({ ...draft, mode: e.target.value })}
                >
                  <option value="quiz">Quiz — short and low stakes</option>
                  <option value="test">Test — one attempt</option>
                  <option value="mock">Mock — closes after a set time</option>
                </select>
              </Field>
            </div>

            <div className="row">
              <button className="btn" disabled={creating || !draft.title}>
                {creating ? "Creating" : "Create exam"}
              </button>
              <button type="button" className="btn btn-quiet" onClick={() => setDraft(null)}>
                Cancel
              </button>
            </div>
            <span className="hint">Questions, batches and the schedule come next, in the exam builder.</span>
          </form>
          </div>
        )}

        {exams.length === 0 && !draft && filtered ? (
          <Empty
            icon={ClipboardList}
            title="No exams match"
            hint="Try another filter, or clear them."
            action={<button className="btn btn-quiet" onClick={clearFilters}>Clear filters</button>}
          />
        ) : exams.length === 0 && !draft ? (
          <Empty
            icon={ClipboardList}
            title="No exams yet"
            hint="An exam holds questions of any type in the order you choose."
            action={
              <button
                className="btn"
                onClick={() => setDraft({ title: "", durationMinutes: 40, mode: "test" })}
              >
                New exam
              </button>
            }
          />
        ) : (
          <div className="stack" style={{ opacity: isFetching ? 0.6 : 1, transition: "opacity 120ms" }}>
            {view === "grid" ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 12 }}>
                {exams.map((exam) => (
                  <Link key={exam._id} to={`/exams/${exam._id}`} className="card pool-card" style={{ textDecoration: "none", color: "inherit" }}>
                    <div className="pool-card-body" style={{ gap: 10, padding: 14 }}>
                      <ExamPills exam={exam} />
                      <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.35 }} className="clamp-2">{exam.title}</div>
                      <div className="row-tight muted small tnum" style={{ gap: 12, flexWrap: "wrap" }}>
                        <span className="row-tight" style={{ gap: 4 }}><ListChecks size={13} /> {exam.questionCount}</span>
                        <span className="row-tight" style={{ gap: 4 }}><Clock size={13} /> {exam.durationMinutes} min</span>
                      </div>
                      <div className="muted small truncate row-tight" style={{ gap: 4 }} title={(exam.batches || []).map((b) => b.name).join(", ")}><Users size={13} style={{ flexShrink: 0 }} /> {batchNames(exam)}</div>
                      {when(exam) && <div className="small row-tight" style={{ gap: 4 }}><Clock size={13} className="muted" /> {when(exam)}</div>}
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="list">
                {exams.map((exam) => (
                  <Link className="list-row" key={exam._id} to={`/exams/${exam._id}`}>
                    <div className="grow">
                      <div style={{ marginBottom: 5 }}><ExamPills exam={exam} /></div>
                      <div style={{ fontSize: 14.5 }}>{exam.title}</div>
                      <div className="muted small tnum" style={{ marginTop: 3 }}>
                        {exam.questionCount} question{exam.questionCount === 1 ? "" : "s"} · {exam.durationMinutes} min · {batchNames(exam)}
                        {when(exam) ? ` · ${when(exam)}` : ""}
                      </div>
                    </div>
                    <ChevronRight size={16} className="muted" />
                  </Link>
                ))}
              </div>
            )}
            <Pager page={data?.page || 1} pages={data?.pages || 1} total={data?.total || 0} onChange={setPage} />
          </div>
        )}
      </div>
    </div>
  );
}
