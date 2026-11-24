import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  useGetQuestionsQuery, useGetTreeQuery, useGetArchiveStatsQuery,
  useGetAuthoritiesQuery, useCreateAuthorityMutation, useUpdateAuthorityMutation, useUploadAuthorityIconMutation,
  useDeleteAuthorityMutation, useBulkArchiveQuestionsMutation,
} from "../api/contentApi";
import { Plus, Library, Pencil, Trash2, Check, X, CheckCircle2, AlertCircle, Archive as ArchiveIcon, Layers, Settings2 } from "lucide-react";
import { Loading, ErrorNote, Empty, TypePill, Pager, useConfirm } from "../components/bits";
import Latex from "../components/Latex";
import BatchIcon from "../components/BatchIcon";
import IconPicker from "../components/IconPicker";
import SearchSelect from "../components/SearchSelect";
import { FilterChips, SearchBox, PageTabs } from "../components/ListTools";

// Matches ExamAuthority.icon's schema default (backend/models/examAuthorityModel.js).
const AUTHORITY_DEFAULT_ICON = "Landmark";
const TYPE_LABEL = { board_exam: "Board exam", entrance_exam: "Entrance exam", textbook: "Textbook", question_bank: "Question bank" };

// The public archive is Question documents with isPublic: true, filed under
// boards, exams and books (authorities). Two tabs: the questions, browsed by
// board and year; and the boards themselves.
export default function Archive() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get("search") || "");
  const page = Number(params.get("page")) || 1;
  const tab = params.get("tab") || "questions";

  const filters = {
    isPublic: "true",
    search: params.get("search") || undefined,
    authority: params.get("authority") || undefined,
    year: params.get("year") || undefined,
    subject: params.get("subject") || undefined,
    page,
    limit: 30,
  };

  const { data, isLoading, isFetching, error } = useGetQuestionsQuery(filters, { skip: tab !== "questions" });
  const { data: authorities } = useGetAuthoritiesQuery();
  const { data: stats } = useGetArchiveStatsQuery({ authority: filters.authority, subject: filters.subject });
  const { data: tree } = useGetTreeQuery();
  const [unarchive] = useBulkArchiveQuestionsMutation();
  const confirm = useConfirm();

  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value === undefined || value === "") next.delete(key);
    else next.set(key, value);
    if (key !== "page") next.delete("page");
    // A year belongs to the board picked; another board has other years.
    if (key === "authority") next.delete("year");
    setParams(next);
  };
  const setPage = (n) => setFilter("page", n <= 1 ? undefined : String(n));
  const setTab = (value) => {
    const next = new URLSearchParams(params);
    if (value === "questions") next.delete("tab"); else next.set("tab", value);
    setParams(next);
  };
  const clearAll = () => { setSearch(""); setParams(new URLSearchParams()); };

  const byAuthority = stats?.byAuthority || {};
  // Several years at once: "2019,2021" in the url.
  const pickedYears = (filters.year || "").split(",").filter(Boolean);
  const setYears = (list) => setFilter("year", [...new Set(list)].sort((a, b) => b - a).join(",") || undefined);
  const boardName = (id) => (authorities || []).find((a) => a._id === id)?.name;
  const subjectName = (tree || []).find((s) => s._id === filters.subject)?.title;
  const here = `/archive${params.toString() ? `?${params}` : ""}`;

  const removeFromArchive = async (question) => {
    const yes = await confirm({
      title: "Remove from the archive?",
      body: "Students stop seeing it in the archive. The question stays in the bank, with its boards and years.",
      confirmLabel: "Remove",
      tone: "neutral",
    });
    if (yes) unarchive({ questionIds: [question._id], isPublic: false });
  };

  return (
    <div className="page page-wide">
      <div className="page-head spread">
        <div>
          <h1>Archive</h1>
          <p className="muted small tnum" style={{ margin: "2px 0 0" }}>
            {stats ? `${stats.total} public questions · ${(authorities || []).length} boards and books` : "…"}
          </p>
        </div>
        <Link className="btn" to="/questions/new"><Plus size={15} /> New question</Link>
      </div>

      <div className="stack">
        <PageTabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "questions", label: "Questions", icon: ArchiveIcon },
            { value: "boards", label: "Boards and books", icon: Settings2, count: (authorities || []).length },
          ]}
        />

        {tab === "boards" ? (
          <BoardsPanel authorities={authorities || []} counts={byAuthority} />
        ) : (
          <>
            {(authorities || []).length > 0 && (
              <div className="board-tiles">
                <button type="button" className={`board-tile${!filters.authority ? " board-tile-on" : ""}`} onClick={() => setFilter("authority", undefined)}>
                  <span className="board-tile-icon"><Layers size={16} /></span>
                  <span className="grow truncate">All boards</span>
                  <span className="tnum muted">{stats?.total ?? "–"}</span>
                </button>
                {authorities.map((a) => (
                  <button
                    key={a._id}
                    type="button"
                    title={a.name}
                    className={`board-tile${filters.authority === a._id ? " board-tile-on" : ""}`}
                    onClick={() => setFilter("authority", filters.authority === a._id ? undefined : a._id)}
                  >
                    <span className="board-tile-icon"><BatchIcon icon={a.icon} size={16} imgSize={22} /></span>
                    <span className="grow truncate">{a.shortName || a.name}</span>
                    <span className="tnum muted">{byAuthority[a._id] || 0}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="row-tight" style={{ flexWrap: "wrap", gap: 8 }}>
              <SearchBox value={search} onChange={setSearch} onSubmit={(v) => setFilter("search", v || undefined)} placeholder="Search the archive" />
              <select
                className="select"
                style={{ width: "auto" }}
                value=""
                onChange={(e) => e.target.value && setYears([...pickedYears, e.target.value])}
                disabled={!stats?.years?.length}
                title="Pick as many years as you like"
              >
                <option value="">{!stats?.years?.length ? "No years yet" : pickedYears.length ? "Add a year" : "Any year"}</option>
                {(stats?.years || []).filter((y) => !pickedYears.includes(String(y.year))).map((y) => (
                  <option key={y.year} value={y.year}>{y.year} ({y.count})</option>
                ))}
              </select>
              {(tree || []).length > 0 && (
                <SearchSelect className="select" style={{ maxWidth: 200 }} value={filters.subject || ""} onChange={(e) => setFilter("subject", e.target.value || undefined)}>
                  <option value="">Any subject</option>
                  {tree.map((subject) => <option key={subject._id} value={subject._id}>{subject.title}</option>)}
                </SearchSelect>
              )}
            </div>

            <FilterChips
              onClearAll={clearAll}
              chips={[
                filters.search && { key: "search", label: `"${filters.search}"`, onClear: () => { setSearch(""); setFilter("search", undefined); } },
                filters.authority && { key: "authority", label: boardName(filters.authority) || "Board", onClear: () => setFilter("authority", undefined) },
                ...pickedYears.map((y) => ({ key: `year-${y}`, label: y, onClear: () => setYears(pickedYears.filter((x) => x !== y)) })),
                filters.subject && { key: "subject", label: subjectName || "Subject", onClear: () => setFilter("subject", undefined) },
              ]}
            />

            <ErrorNote error={error} />

            {isLoading ? (
              <Loading />
            ) : data?.questions?.length ? (
              <div className="list" style={{ opacity: isFetching ? 0.65 : 1, transition: "opacity 120ms ease" }}>
                {data.questions.map((question) => (
                  <div key={question._id} className="row-tight" style={{ alignItems: "stretch" }}>
                    <Link to={`/questions/${question._id}`} state={{ from: "archive", back: here }} className="list-row grow">
                      <div className="grow">
                        <div className="row-tight" style={{ marginBottom: 6, flexWrap: "wrap" }}>
                          <TypePill type={question.type} />
                          {(question.sources || []).map((source, i) => (
                            <SourcePill key={source.authority?._id || i} source={source} />
                          ))}
                          {question.solutionText || question.modelAnswer
                            ? <span className="pill pill-ok row-tight" style={{ gap: 4 }}><CheckCircle2 size={11} /> Solution</span>
                            : <span className="pill pill-warn row-tight" style={{ gap: 4 }}><AlertCircle size={11} /> No solution</span>}
                        </div>
                        <Latex as="div" className="grow" style={{ lineHeight: 1.5 }}>{question.question}</Latex>
                        {(question.chapter?.title || question.topic?.title) && (
                          <div className="muted small" style={{ marginTop: 4 }}>
                            {[question.chapter?.title, question.topic?.title].filter(Boolean).join(" · ")}
                          </div>
                        )}
                      </div>
                      {question.marks != null && <span className="tnum muted small" title="Marks">{question.marks}</span>}
                    </Link>
                    <span className="row-hover-actions" style={{ gap: 2 }}>
                      <Link className="icon-btn" title="Edit" to={`/questions/${question._id}/edit`} state={{ from: "archive", back: here }}><Pencil size={14} /></Link>
                      <button type="button" className="icon-btn" title="Remove from the archive" onClick={() => removeFromArchive(question)}><X size={14} /></button>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <Empty
                icon={Library}
                title="No public questions match"
                hint={params.toString() ? "Try clearing a filter." : "Mark a question \"Public\" in the editor, or pick questions on the Questions page and add them to the archive."}
                action={params.toString() ? <button className="btn btn-quiet" onClick={clearAll}>Clear filters</button> : <Link className="btn btn-quiet" to="/questions">Open Questions</Link>}
              />
            )}

            {data && <Pager page={data.page} pages={data.pages} total={data.total} onChange={setPage} />}
          </>
        )}
      </div>
    </div>
  );
}

// Every board, exam and book: rename, short name, type, icon, delete.
function BoardsPanel({ authorities, counts }) {
  const [createAuthority, createState] = useCreateAuthorityMutation();
  const [updateAuthority, updateState] = useUpdateAuthorityMutation();
  const [deleteAuthority, deleteState] = useDeleteAuthorityMutation();
  const [uploadAuthorityIcon, uploadIconState] = useUploadAuthorityIconMutation();
  const confirm = useConfirm();
  const [adding, setAdding] = useState({ name: "", shortName: "", type: "board_exam" });
  const [editing, setEditing] = useState(null);
  const [iconFor, setIconFor] = useState(null);

  const add = async (e) => {
    e.preventDefault();
    if (!adding.name.trim()) return;
    const r = await createAuthority({ name: adding.name.trim(), shortName: adding.shortName.trim() || undefined, type: adding.type });
    if (!r.error) setAdding({ name: "", shortName: "", type: adding.type });
  };
  const saveEdit = async () => {
    const r = await updateAuthority({ id: editing._id, name: editing.name.trim(), shortName: editing.shortName.trim(), type: editing.type });
    if (!r.error) setEditing(null);
  };
  const remove = async (a) => {
    const used = counts[a._id] || 0;
    const yes = await confirm({
      title: `Delete "${a.name}"?`,
      body: used ? `${used} public question${used === 1 ? " is" : "s are"} filed under it, so it can't be deleted until they're moved.` : "It has no questions filed under it.",
    });
    if (yes) deleteAuthority(a._id);
  };

  return (
    <div className="stack">
      <form className="card row-tight" style={{ flexWrap: "wrap", gap: 8 }} onSubmit={add}>
        <input className="input" style={{ flex: "2 1 220px" }} placeholder="Name, e.g. Dhaka Board or NCTB Physics" value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} />
        <input className="input" style={{ flex: "1 1 110px" }} placeholder="Short name, e.g. DB" value={adding.shortName} onChange={(e) => setAdding({ ...adding, shortName: e.target.value })} />
        <select className="select" style={{ width: "auto" }} value={adding.type} onChange={(e) => setAdding({ ...adding, type: e.target.value })}>
          {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button className="btn" disabled={!adding.name.trim() || createState.isLoading}><Plus size={14} /> Add</button>
      </form>
      <ErrorNote error={createState.error || updateState.error || deleteState.error} />

      {authorities.length === 0 ? (
        <Empty icon={Library} title="No boards, exams or books yet" hint="Add the boards and books your archive questions come from." />
      ) : (
        <div className="card" style={{ padding: 0, overflow: "visible" }}>
          <table className="table">
            <thead>
              <tr><th style={{ width: 44 }} /><th>Name</th><th>Short name</th><th>Kind</th><th>Questions</th><th style={{ width: 1 }} /></tr>
            </thead>
            <tbody>
              {authorities.map((a) => {
                const isEditing = editing?._id === a._id;
                return (
                  <tr key={a._id}>
                    <td style={{ position: "relative" }}>
                      <button type="button" className="icon-btn" title="Change icon" onClick={() => setIconFor(iconFor === a._id ? null : a._id)}>
                        <BatchIcon icon={a.icon} size={15} imgSize={20} />
                      </button>
                      {iconFor === a._id && (
                        <div className="popover">
                          <IconPicker
                            currentIcon={a.icon}
                            uploading={uploadIconState.isLoading}
                            isDefault={a.icon?.kind === "preset" && (a.icon?.value || AUTHORITY_DEFAULT_ICON) === AUTHORITY_DEFAULT_ICON}
                            onPickPreset={(value) => { updateAuthority({ id: a._id, icon: { kind: "preset", value } }); setIconFor(null); }}
                            onUpload={(file) => uploadAuthorityIcon({ id: a._id, file }).then(() => setIconFor(null))}
                            onReset={() => { updateAuthority({ id: a._id, icon: { kind: "preset", value: AUTHORITY_DEFAULT_ICON } }); setIconFor(null); }}
                            onClose={() => setIconFor(null)}
                          />
                        </div>
                      )}
                    </td>
                    {isEditing ? (
                      <>
                        <td><input className="input" autoFocus value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && saveEdit()} /></td>
                        <td><input className="input" value={editing.shortName} onChange={(e) => setEditing({ ...editing, shortName: e.target.value })} onKeyDown={(e) => e.key === "Enter" && saveEdit()} /></td>
                        <td>
                          <select className="select" value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value })}>
                            {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          </select>
                        </td>
                      </>
                    ) : (
                      <>
                        <td style={{ fontWeight: 500 }}>{a.name}</td>
                        <td className="muted">{a.shortName || "–"}</td>
                        <td className="muted">{TYPE_LABEL[a.type] || a.type}</td>
                      </>
                    )}
                    <td className="tnum">{counts[a._id] || 0}</td>
                    <td>
                      <span className="row-tight" style={{ gap: 2, justifyContent: "flex-end" }}>
                        {isEditing ? (
                          <>
                            <button type="button" className="icon-btn" title="Save" disabled={!editing.name.trim() || updateState.isLoading} onClick={saveEdit}><Check size={14} /></button>
                            <button type="button" className="icon-btn" title="Cancel" onClick={() => setEditing(null)}><X size={14} /></button>
                          </>
                        ) : (
                          <>
                            <Link className="btn btn-sm btn-quiet" to={`/archive?authority=${a._id}`}>Open</Link>
                            <button type="button" className="icon-btn" title="Edit" onClick={() => setEditing({ _id: a._id, name: a.name, shortName: a.shortName || "", type: a.type })}><Pencil size={14} /></button>
                            <button type="button" className="icon-btn icon-btn-danger" title="Delete" onClick={() => remove(a)}><Trash2 size={14} /></button>
                          </>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// One board and every year the question appeared on it — "DB · 2015, 2017,
// 2019". A long run collapses to a count, full list on hover.
function SourcePill({ source }) {
  const name = source.authority?.shortName || source.authority?.name || "Board";
  const years = source.years || [];
  const yearText = years.length > 4 ? `×${years.length}` : years.join(", ");
  return (
    <span className="pill tnum" title={`${source.authority?.name || name}${years.length ? `: ${years.join(", ")}` : ""}${source.paperLabel ? ` — ${source.paperLabel}` : ""}`}>
      {name}
      {yearText && <> · {yearText}</>}
      {source.paperLabel && <span className="muted"> · {source.paperLabel}</span>}
    </span>
  );
}
