import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  useGetLecturesQuery,
  useDeleteLectureMutation,
  useReorderLecturesMutation,
  useUpdateLectureMutation,
  useGetTreeQuery,
  useLazyGetLectureOrderQuery,
} from "../api/contentApi";
import {
  Plus, Trash2, PlayCircle, Video, Paperclip, Pencil, ChevronUp, ChevronDown,
  ShieldCheck, FileText, ChevronRight, Megaphone, ArrowUpDown, Users, Check, Sparkles,
} from "lucide-react";
import { noticeDraftFor } from "../utils/noticeDraft";
import { Loading, ErrorNote, Empty, useConfirm, Pager } from "../components/bits";
import SearchSelect from "../components/SearchSelect";
import { StatusStrip, FilterChips, ViewToggle, useViewMode, SearchBox, formatDuration } from "../components/ListTools";

// Bunny is the only provider that actually locks a video down (signed,
// expiring, domain-locked). The others are a plain embed anyone with the
// link can watch — worth surfacing at a glance on every card.
const VIDEO_LABEL = { bunny: "Bunny", vdocipher: "VdoCipher", protected: "Protected", youtube: "YouTube", vimeo: "Vimeo", link: "Direct link", local: "Uploaded", s3: "Uploaded" };
const LOCKED = ["bunny", "vdocipher", "protected"];

// A poster for the card: YouTube serves one for every video; the others get
// a tinted panel with a play mark.
const youtubeId = (video) => {
  const text = `${video?.url || ""} ${video?.key || ""}`;
  return text.match(/(?:embed\/|youtu\.be\/|[?&]v=|shorts\/)([\w-]{11})/)?.[1]
    || (video?.driver === "youtube" && /^[\w-]{11}$/.test(video?.key || "") ? video.key : null);
};

function Poster({ lecture }) {
  const [broken, setBroken] = useState(false);
  const video = lecture.video;
  const yt = video && youtubeId(video);
  const length = formatDuration(video?.durationSeconds);
  return (
    <div className="thumb-169">
      {yt && !broken
        ? <img src={`https://i.ytimg.com/vi/${yt}/mqdefault.jpg`} alt="" loading="lazy" onError={() => setBroken(true)} />
        : video ? <PlayCircle size={34} strokeWidth={1.5} /> : <Video size={30} strokeWidth={1.5} style={{ opacity: 0.45 }} />}
      <div className="thumb-flag">
        {!lecture.isPublished && <span className="pill pill-warn">Draft</span>}
        {!lecture.batches?.length && <span className="pill pill-warn">Not assigned</span>}
        {!video && <span className="pill">No video</span>}
        {lecture.aiVideo && <span className={`pill row-tight ${lecture.aiVideo === "published" ? "pill-ai" : ""}`} style={{ gap: 3 }}><Sparkles size={10} /> AI video{lecture.aiVideo === "draft" ? " · not live" : ""}</span>}
      </div>
      {length && <span className="thumb-badge tnum">{length}</span>}
    </div>
  );
}

// "Bunny · Notes · 2 files · 3 batches": what the lecture has, in one line.
const metaLine = (lecture) => [
  lecture.video && (VIDEO_LABEL[lecture.video.driver] || "Video"),
  lecture.aiVideo === "published" ? "AI video" : lecture.aiVideo === "draft" ? "AI video (not live)" : null,
  lecture.bodyMarkdown && "Notes",
  lecture.attachments?.length > 0 && `${lecture.attachments.length} file${lecture.attachments.length === 1 ? "" : "s"}`,
  lecture.batches?.length > 0 && `${lecture.batches.length} batch${lecture.batches.length === 1 ? "" : "es"}`,
  lecture.tag,
].filter(Boolean);

function PublishSwitch({ lecture, onToggle }) {
  return (
    <label className="row-tight small" style={{ gap: 6, cursor: "pointer" }} title={lecture.isPublished ? "Published. Click to make it a draft." : "Draft. Click to publish."} onClick={(e) => e.stopPropagation()}>
      <span className="switch">
        <input type="checkbox" checked={!!lecture.isPublished} onChange={() => onToggle(lecture)} />
        <span />
      </span>
      <span className="muted">{lecture.isPublished ? "Live" : "Draft"}</span>
    </label>
  );
}

// A pool. Cards (or rows, for a big pool) grouped by chapter; clicking one
// opens LectureView to look at it, Edit opens LectureEditor.
export default function Lectures() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get("search") || "");
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [reordering, setReordering] = useState(null);
  const [view, setView] = useViewMode("lectures");

  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (!value) next.delete(key);
    else next.set(key, value);
    if (key !== "page") next.delete("page");
    setParams(next);
  };
  const page = Number(params.get("page")) || 1;

  // An old link may still carry ?unassigned=true.
  const status = params.get("status") || (params.get("unassigned") === "true" ? "unassigned" : "");
  const subjectFilter = params.get("subject") || "";
  const chapterFilter = params.get("chapter") || "";
  const topicFilter = params.get("topic") || "";
  const searchFilter = params.get("search") || "";

  const { data, isLoading, isFetching, error } = useGetLecturesQuery({
    includeUnpublished: "true",
    status: status || undefined,
    subject: subjectFilter || undefined,
    chapter: chapterFilter || undefined,
    topic: topicFilter || undefined,
    search: searchFilter || undefined,
    counts: "true",
    page,
    limit: 60,
  });
  const { data: tree } = useGetTreeQuery();
  const [remove] = useDeleteLectureMutation();
  const [reorder] = useReorderLecturesMutation();
  const [update] = useUpdateLectureMutation();
  const [loadOrder] = useLazyGetLectureOrderQuery();
  const confirm = useConfirm();

  if (isLoading) return <Loading />;

  // Subject first, everything else scoped to it.
  const subjects = (tree || []).map((subject) => ({ _id: subject._id, title: subject.title }));
  const chapterSource = subjectFilter ? (tree || []).filter((s) => s._id === subjectFilter) : (tree || []);
  const chapters = chapterSource.flatMap((subject) =>
    subject.chapters.map((chapter) => ({
      _id: chapter._id,
      title: chapter.title,
      label: subjectFilter ? chapter.title : `${subject.title} · ${chapter.title}`,
      topics: chapter.topics || [],
    }))
  );
  const topicOptions = chapters.find((c) => c._id === chapterFilter)?.topics || [];
  const subjectTitle = subjects.find((s) => s._id === subjectFilter)?.title;
  const chapterTitle = chapters.find((c) => c._id === chapterFilter)?.title;
  const topicTitle = topicFilter === "none" ? "No topic" : topicOptions.find((t) => t._id === topicFilter)?.title;

  const setMany = (patch) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value); else next.delete(key);
    }
    next.delete("page");
    next.delete("unassigned");
    setParams(next);
  };
  const setSubjectFilter = (subjectId) => setMany({ subject: subjectId, chapter: "", topic: "" });
  const setChapterFilter = (chapterId) => setMany({ chapter: chapterId, topic: "" });
  const setStatus = (value) => setMany({ status: value });
  const clearAll = () => { setSearch(""); setParams(new URLSearchParams()); };

  const lectures = data?.lectures || [];
  const counts = data?.counts || {};

  // Up/down swaps a lecture with its neighbour in the same chapter. The page
  // shows only part of the pool, so the swap goes into the whole platform
  // order (reorderLectures numbers every id it is sent from 0).
  const move = async (lecture, direction) => {
    const chapterId = lecture.chapter?._id || lecture.chapter;
    const siblings = lectures.filter((l) => (l.chapter?._id || l.chapter) === chapterId);
    const from = siblings.findIndex((l) => l._id === lecture._id);
    const other = siblings[from + direction];
    if (!other) return;
    const { ids } = await loadOrder().unwrap();
    const all = ids.map(String);
    const a = all.indexOf(String(lecture._id));
    const b = all.indexOf(String(other._id));
    if (a < 0 || b < 0) return;
    [all[a], all[b]] = [all[b], all[a]];
    reorder(all);
  };

  const togglePublished = (lecture) => update({ id: lecture._id, isPublished: !lecture.isPublished });

  const destroy = async (lecture) => {
    const yes = await confirm({
      title: `Delete "${lecture.title}"?`,
      body: lecture.batches?.length
        ? `It is assigned to ${lecture.batches.length} batch${lecture.batches.length === 1 ? "" : "es"} and will disappear for those students.`
        : "It is not assigned to any batch.",
    });
    if (yes) remove(lecture._id);
  };

  // Grouped by chapter: "which chapter is this in" is the first thing an
  // author scanning the page wants to know.
  const groups = [];
  const groupIndex = new Map();
  for (const lecture of lectures) {
    const chapterId = lecture.chapter?._id || lecture.chapter || "none";
    if (!groupIndex.has(chapterId)) {
      groupIndex.set(chapterId, groups.length);
      groups.push({ chapterId, title: lecture.chapter?.title || "No chapter", lectures: [] });
    }
    groups[groupIndex.get(chapterId)].lectures.push(lecture);
  }

  const toggleGroup = (chapterId) => {
    const next = new Set(collapsed);
    if (next.has(chapterId)) next.delete(chapterId);
    else next.add(chapterId);
    setCollapsed(next);
  };

  const actions = (lecture) => (
    <>
      <Link className="icon-btn" title="Send to notice" to="/notices/new" state={{ noticeDraft: noticeDraftFor("lecture", lecture) }} onClick={(e) => e.stopPropagation()}>
        <Megaphone size={14} />
      </Link>
      <Link className="icon-btn" title="Edit" to={`/lectures/${lecture._id}/edit`} onClick={(e) => e.stopPropagation()}>
        <Pencil size={14} />
      </Link>
      <button className="icon-btn icon-btn-danger" title="Delete lecture" onClick={(e) => { e.stopPropagation(); destroy(lecture); }}>
        <Trash2 size={14} />
      </button>
    </>
  );

  const orderButtons = (lecture, index, count) => (
    <span className="row-tight" style={{ gap: 2 }} onClick={(e) => e.stopPropagation()}>
      <button className="icon-btn" title="Move up" disabled={index === 0} onClick={() => move(lecture, -1)}><ChevronUp size={14} /></button>
      <button className="icon-btn" title="Move down" disabled={index === count - 1} onClick={() => move(lecture, 1)}><ChevronDown size={14} /></button>
    </span>
  );

  const filtered = Boolean(status || subjectFilter || chapterFilter || topicFilter || searchFilter);

  return (
    <div className="page page-wide">
      <div className="page-head spread">
        <div>
          <h1>Lectures</h1>
          <p className="muted small tnum" style={{ margin: "2px 0 0" }}>
            {`${counts.all ?? data?.total ?? lectures.length} in the pool`}
          </p>
        </div>
        <Link className="btn" to="/lectures/new">
          <Plus size={15} /> New lecture
        </Link>
      </div>

      <div className="stack">
        <ErrorNote error={error} />

        <StatusStrip
          value={status}
          onChange={setStatus}
          items={[
            { key: "", label: "All lectures", count: counts.all },
            { key: "published", label: "Published", count: counts.published, tone: "ok" },
            { key: "draft", label: "Drafts", count: counts.draft, tone: counts.draft ? "warn" : undefined },
            { key: "novideo", label: "No video", count: counts.novideo, tone: counts.novideo ? "warn" : undefined },
            { key: "unassigned", label: "Not in a batch", count: counts.unassigned, tone: counts.unassigned ? "warn" : undefined },
            { key: "aivideo", label: "AI video live", count: counts.aivideo, tone: "ok" },
            { key: "noaivideo", label: "No AI video", count: counts.noaivideo },
          ]}
        />

        <div className="row-tight" style={{ flexWrap: "wrap", gap: 8 }}>
          <SearchBox value={search} onChange={setSearch} onSubmit={(v) => setFilter("search", v)} placeholder="Search lectures by title" />

          {subjects.length > 0 && (
            <SearchSelect className="select" style={{ maxWidth: 180 }} value={subjectFilter} onChange={(e) => setSubjectFilter(e.target.value)}>
              <option value="">Any subject</option>
              {subjects.map((s) => <option key={s._id} value={s._id}>{s.title}</option>)}
            </SearchSelect>
          )}

          {chapters.length > 0 && (
            <SearchSelect className="select" style={{ maxWidth: 220 }} value={chapterFilter} onChange={(e) => setChapterFilter(e.target.value)}>
              <option value="">{subjectFilter ? "Any chapter in this subject" : "Any chapter"}</option>
              {chapters.map((c) => <option key={c._id} value={c._id}>{c.label}</option>)}
            </SearchSelect>
          )}

          {chapterFilter && (
            <SearchSelect className="select" style={{ maxWidth: 200 }} value={topicFilter} onChange={(e) => setFilter("topic", e.target.value)}>
              <option value="">Whole chapter</option>
              <option value="none">Chapter pool only (no topic)</option>
              {topicOptions.map((t) => <option key={t._id} value={t._id}>{t.title}</option>)}
            </SearchSelect>
          )}

          <ViewToggle value={view} onChange={setView} />
        </div>

        <FilterChips
          onClearAll={clearAll}
          chips={[
            searchFilter && { key: "search", label: `"${searchFilter}"`, onClear: () => { setSearch(""); setFilter("search", ""); } },
            subjectFilter && { key: "subject", label: subjectTitle || "Subject", onClear: () => setSubjectFilter("") },
            chapterFilter && { key: "chapter", label: chapterTitle || "Chapter", onClear: () => setChapterFilter("") },
            topicFilter && { key: "topic", label: topicTitle || "Topic", onClear: () => setFilter("topic", "") },
            status && { key: "status", label: { published: "Published", draft: "Drafts", novideo: "No video", unassigned: "Not in a batch", aivideo: "AI video live", noaivideo: "No AI video" }[status], onClear: () => setStatus("") },
          ]}
        />

        {lectures.length ? (
          <div className="stack" style={{ gap: 22, opacity: isFetching ? 0.7 : 1, transition: "opacity 120ms ease" }}>
            {groups.map((group) => {
              const isCollapsed = collapsed.has(group.chapterId);
              const isReordering = reordering === group.chapterId;
              return (
                <section key={group.chapterId} className="stack" style={{ gap: 10 }}>
                  <div className="row-tight spread" style={{ gap: 8 }}>
                    <button
                      type="button"
                      className="row-tight"
                      style={{ background: "none", border: "none", padding: "2px 0", cursor: "pointer", textAlign: "left", font: "inherit", color: "inherit" }}
                      onClick={() => toggleGroup(group.chapterId)}
                    >
                      <ChevronRight size={15} className="muted" style={{ transform: isCollapsed ? "none" : "rotate(90deg)", transition: "transform 120ms ease", flexShrink: 0 }} />
                      <span style={{ fontWeight: 600, fontSize: 14.5 }}>{group.title}</span>
                      <span className="pill tnum">{group.lectures.length}</span>
                    </button>
                    {!isCollapsed && (
                      <span className="row-tight" style={{ gap: 4 }}>
                        {group.lectures.length > 1 && (
                          <button type="button" className={`btn btn-sm ${isReordering ? "" : "btn-quiet"}`} onClick={() => setReordering(isReordering ? null : group.chapterId)}>
                            {isReordering ? <><Check size={13} /> Done</> : <><ArrowUpDown size={13} /> Reorder</>}
                          </button>
                        )}
                        {group.chapterId !== "none" && (
                          <Link className="btn btn-sm btn-quiet" to={`/lectures/new?chapter=${group.chapterId}`}>
                            <Plus size={13} /> Add here
                          </Link>
                        )}
                      </span>
                    )}
                  </div>

                  {!isCollapsed && view === "grid" && (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 14 }}>
                      {group.lectures.map((lecture, index) => (
                        <div
                          key={lecture._id}
                          className="card pool-card stack"
                          tabIndex={0}
                          onClick={() => navigate(`/lectures/${lecture._id}`)}
                          onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && navigate(`/lectures/${lecture._id}`)}
                        >
                          <Poster lecture={lecture} />
                          {!isReordering && <div className="pool-actions">{actions(lecture)}</div>}
                          <div className="pool-card-body">
                            <div style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.35 }} className="clamp-2">{lecture.title}</div>
                            {lecture.topic?.title && <div className="muted small truncate">{lecture.topic.title}</div>}
                            <div className="row-tight spread" style={{ marginTop: 4, gap: 8 }}>
                              <span className="muted small truncate row-tight" style={{ gap: 4 }}>
                                {lecture.video && LOCKED.includes(lecture.video.driver) && <ShieldCheck size={12} style={{ flexShrink: 0 }} />}
                                {metaLine(lecture).join(" · ") || "Empty"}
                              </span>
                              {isReordering
                                ? orderButtons(lecture, index, group.lectures.length)
                                : <PublishSwitch lecture={lecture} onToggle={togglePublished} />}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {!isCollapsed && view === "list" && (
                    <div className="card" style={{ padding: 0, overflowX: "auto" }}>
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Title</th>
                            <th>Video</th>
                            <th>Has</th>
                            <th>Batches</th>
                            <th>Status</th>
                            <th style={{ width: 1 }} />
                          </tr>
                        </thead>
                        <tbody>
                          {group.lectures.map((lecture, index) => (
                            <tr key={lecture._id} style={{ cursor: "pointer" }} onClick={() => navigate(`/lectures/${lecture._id}`)}>
                              <td>
                                <div style={{ fontWeight: 500 }}>{lecture.title}</div>
                                {lecture.topic?.title && <div className="muted small">{lecture.topic.title}</div>}
                              </td>
                              <td className="small" style={{ whiteSpace: "nowrap" }}>
                                {lecture.video
                                  ? <span className="row-tight" style={{ gap: 4 }}>{LOCKED.includes(lecture.video.driver) ? <ShieldCheck size={12} /> : <Video size={12} />}{VIDEO_LABEL[lecture.video.driver] || "Video"}{lecture.video.durationSeconds ? <span className="muted tnum"> · {formatDuration(lecture.video.durationSeconds)}</span> : null}</span>
                                  : <span className="pill pill-warn">No video</span>}
                              </td>
                              <td className="small muted" style={{ whiteSpace: "nowrap" }}>
                                <span className="row-tight" style={{ gap: 8 }}>
                                  {lecture.bodyMarkdown && <span className="row-tight" style={{ gap: 3 }} title="Notes"><FileText size={12} /> Notes</span>}
                                  {lecture.attachments?.length > 0 && <span className="row-tight" style={{ gap: 3 }} title="Files"><Paperclip size={12} /> {lecture.attachments.length}</span>}
                                  {lecture.aiVideo && <span className="row-tight" style={{ gap: 3 }} title={lecture.aiVideo === "published" ? "AI video, live" : "AI video, not published"}><Sparkles size={12} /> {lecture.aiVideo === "published" ? "AI video" : "AI video (not live)"}</span>}
                                </span>
                              </td>
                              <td className="small" style={{ whiteSpace: "nowrap" }}>
                                {lecture.batches?.length
                                  ? <span className="row-tight" style={{ gap: 4 }}><Users size={12} /> {lecture.batches.length}</span>
                                  : <span className="pill pill-warn">None</span>}
                              </td>
                              <td><PublishSwitch lecture={lecture} onToggle={togglePublished} /></td>
                              <td onClick={(e) => e.stopPropagation()}>
                                <span className="row-tight" style={{ gap: 2, justifyContent: "flex-end" }}>
                                  {isReordering ? orderButtons(lecture, index, group.lectures.length) : actions(lecture)}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              );
            })}
            <Pager page={data?.page || 1} pages={data?.pages || 1} total={data?.total || 0} onChange={(p) => setFilter("page", String(p))} />
          </div>
        ) : (
          <Empty
            icon={PlayCircle}
            title={filtered ? "Nothing matches" : "No lectures yet"}
            hint={filtered ? "Try clearing a filter." : "Lectures are optional. Skip this if you only need exams."}
            action={filtered
              ? <button className="btn btn-quiet" onClick={clearAll}>Clear filters</button>
              : <Link className="btn" to="/lectures/new"><Plus size={15} /> New lecture</Link>}
          />
        )}
      </div>
    </div>
  );
}
