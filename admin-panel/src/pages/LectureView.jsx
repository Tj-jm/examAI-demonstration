import { useState } from "react";
import VideoFrame from "../components/VideoFrame";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Pencil, Trash2, ArrowLeft, Video, Paperclip, FileText, ShieldCheck,
  CheckCircle2, AlertCircle, ExternalLink, Sparkles, Plus, X, Search,
  Trophy, Users, Eye, BarChart3,
} from "lucide-react";
import {
  useGetLectureQuery, useGetLectureStatsQuery, useDeleteLectureMutation, useGetTreeQuery, useGetBatchesQuery,
  useGetQuestionsQuery, useGetQuestionTagsQuery, useSetItemBatchesMutation,
  useSetLecturePracticeQuestionsMutation, useGenerateLecturePracticeQuestionsMutation,
} from "../api/contentApi";
import { Loading, ErrorNote, Empty, Field, TypePill, Pager, useConfirm } from "../components/bits";
import SafeMarkdown from "../components/SafeMarkdown";
import Latex from "../components/Latex";
import VideoLessonPanel from "../components/VideoLessonPanel";
import { BankFiling } from "../components/BankFiling";
import { useTerms } from "../terms";
import SearchSelect from "../components/SearchSelect";
import { PageTabs, formatDuration } from "../components/ListTools";
import BatchAssign from "../components/BatchAssign";

const VIDEO_LABEL = { bunny: "Bunny Stream", vdocipher: "VdoCipher (DRM)", youtube: "YouTube", vimeo: "Vimeo", link: "Direct link", protected: "Protected video" };

const formatBytes = (bytes) => {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// Who watched it: started, finished, how far on average, per batch.
function WatchStats({ id }) {
  const { data, isLoading, error } = useGetLectureStatsQuery(id);
  if (isLoading) return <div className="card"><span className="muted small">Loading watch numbers…</span></div>;
  if (error) return <div className="card"><ErrorNote error={error} /></div>;
  const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
  return (
    <div className="card stack">
      <div className="row-tight"><BarChart3 size={14} /><h2>Watching</h2></div>
      <div className="stat-grid">
        <div className="stat"><b className="tnum">{data.started}</b><span>students started</span></div>
        <div className="stat"><b className="tnum">{data.finished}</b><span>finished{data.started ? ` (${pct(data.finished, data.started)}%)` : ""}</span></div>
        <div className="stat"><b className="tnum">{data.averagePercent == null ? "–" : `${data.averagePercent}%`}</b><span>watched on average</span></div>
        <div className="stat"><b className="small" style={{ fontSize: 14, paddingTop: 5 }}>{data.lastWatchedAt ? new Date(data.lastWatchedAt).toLocaleDateString() : "Never"}</b><span>last watched</span></div>
      </div>
      {data.averagePercent == null && data.started > 0 && (
        <span className="hint">The video's length is unknown, so the average can't be worked out.</span>
      )}
      {data.byBatch?.length > 1 && (
        <div className="stack" style={{ gap: 8 }}>
          {data.byBatch.map((row) => (
            <div key={row.batch._id} className="row-tight" style={{ gap: 10 }}>
              <span className="small truncate" style={{ width: 160, flexShrink: 0 }}>{row.batch.name}</span>
              <div className="meter grow"><i style={{ width: `${row.averagePercent || 0}%` }} /></div>
              <span className="muted small tnum" style={{ width: 150, textAlign: "right", flexShrink: 0 }}>
                {row.started} started · {row.finished} done
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Look first, edit second: check the video plays, read the notes as a
// student sees them, see who it's assigned to and who watched it.
export default function LectureView() {
  const terms = useTerms();
  const { id } = useParams();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") || "overview";
  const setTab = (value) => {
    const next = new URLSearchParams(params);
    if (value === "overview") next.delete("tab"); else next.set("tab", value);
    setParams(next, { replace: true });
  };

  const { data: lecture, isLoading, error } = useGetLectureQuery(id);
  const [remove, { error: deleteError }] = useDeleteLectureMutation();
  const { data: allBatches } = useGetBatchesQuery({});
  const [setItemBatches, { error: assignError }] = useSetItemBatchesMutation();

  if (isLoading) return <Loading />;
  if (error) return <div className="page"><ErrorNote error={error} /></div>;

  const destroy = async () => {
    const yes = await confirm({
      title: `Delete "${lecture.title}"?`,
      body: lecture.batches?.length
        ? `It is assigned to ${lecture.batches.length} batch${lecture.batches.length === 1 ? "" : "es"} and will disappear for those students.`
        : "It is not assigned to any batch.",
    });
    if (!yes) return;

    try {
      await remove(id).unwrap();
      navigate("/lectures");
    } catch {
      // rendered below
    }
  };

  // One PUT with the whole target list (setItemBatches), same as the exam
  // builder's "Who sits this exam".
  const assignedBatchIds = (lecture.batches || []).map((b) => b._id || b);
  const setBatches = (batchIds) => setItemBatches({ kind: "lectures", itemId: id, batchIds });
  const practiceCount = (lecture.practiceQuestionSets || []).reduce((n, s) => n + (s.questions?.length || 0), 0);
  const length = formatDuration(lecture.video?.durationSeconds);

  return (
    <div className="page">
      <div className="page-head spread">
        <div className="grow">
          <div className="row-tight" style={{ marginBottom: 6, flexWrap: "wrap" }}>
            {lecture.tag && <span className="pill">{lecture.tag}</span>}
            {lecture.batches?.length ? (
              <span className="pill pill-ok row-tight" style={{ gap: 4 }}>
                <CheckCircle2 size={11} />
                {lecture.batches.length} batch{lecture.batches.length === 1 ? "" : "es"}
              </span>
            ) : (
              <span className="pill pill-warn row-tight" style={{ gap: 4 }}>
                <AlertCircle size={11} /> Not assigned
              </span>
            )}
            {lecture.isPublished ? <span className="pill pill-ok">Published</span> : <span className="pill pill-warn">Draft</span>}
          </div>
          <h1 style={{ margin: 0 }}>{lecture.title}</h1>
          <p className="muted small" style={{ margin: "4px 0 0" }}>
            {[lecture.subject?.title, lecture.chapter?.title, lecture.topic?.title]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>

        <div className="row-tight">
          <Link className="btn btn-sm btn-quiet" to="/lectures">
            <ArrowLeft size={14} /> Lectures
          </Link>
          <Link className="btn btn-sm" to={`/lectures/${id}/edit`}>
            <Pencil size={14} /> Edit
          </Link>
        </div>
      </div>

      <div className="stack">
        <ErrorNote error={deleteError || assignError} />

        <PageTabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "overview", label: "Overview", icon: Eye },
            { value: "batches", label: terms.Batches, icon: Users, count: assignedBatchIds.length },
            { value: "practice", label: "Practice", icon: Trophy, count: practiceCount },
            { value: "watching", label: "Watching", icon: BarChart3 },
            { value: "lesson", label: "Video lesson", icon: Sparkles },
          ]}
        />

        {tab === "overview" && (
          <>
            {lecture.description && (
              <div className="card">
                <p className="hint" style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6 }}>
                  {lecture.description}
                </p>
              </div>
            )}

            {lecture.video?.url ? (
              <div className="card stack">
                <div className="row-tight">
                  {["bunny", "vdocipher", "protected"].includes(lecture.video.driver) ? <ShieldCheck size={14} /> : <Video size={14} />}
                  <h2>{VIDEO_LABEL[lecture.video.driver] || "Video"}</h2>
                  {length && <span className="muted small tnum">{length}</span>}
                </div>
                <div className="video-frame">
                  <VideoFrame url={lecture.video.url} file={lecture.video.file} title={lecture.title} />
                </div>
              </div>
            ) : (
              <div className="card row-tight">
                <Video size={15} className="muted" />
                <span className="muted small grow">No video attached.</span>
                <Link className="btn btn-sm btn-quiet" to={`/lectures/${id}/edit`}><Plus size={13} /> Add a video</Link>
              </div>
            )}

            {lecture.bodyMarkdown && (
              <div className="card stack">
                <div className="row-tight"><FileText size={14} /><h2>Notes</h2></div>
                <SafeMarkdown className="prose">{lecture.bodyMarkdown}</SafeMarkdown>
              </div>
            )}

            {lecture.attachments?.length > 0 && (
              <div className="card stack">
                <div className="row-tight"><Paperclip size={14} /><h2>Attachments</h2></div>
                <div className="stack" style={{ gap: 4 }}>
                  {lecture.attachments.map((file) => (
                    <a
                      key={file._id}
                      href={file.url}
                      target="_blank"
                      rel="noreferrer"
                      className="row-tight card-quiet"
                      style={{ padding: "8px 12px", textDecoration: "none", color: "inherit" }}
                    >
                      <Paperclip size={13} className="muted" style={{ flexShrink: 0 }} />
                      <span className="grow small truncate">{file.title}</span>
                      {file.sizeBytes != null && (
                        <span className="muted small tnum">{formatBytes(file.sizeBytes)}</span>
                      )}
                      <ExternalLink size={13} className="muted" />
                    </a>
                  ))}
                </div>
              </div>
            )}

            <div className="card row">
              <Link className="btn btn-quiet" to={`/lectures/${id}/edit`}>
                <Pencil size={15} /> Edit this lecture
              </Link>
              <span className="grow" />
              <button className="btn btn-danger" onClick={destroy}>
                <Trash2 size={15} /> Delete
              </button>
            </div>
          </>
        )}

        {tab === "batches" && (
          <div className="card stack">
            <div className="row-tight"><Users size={14} /><h2>{terms.Batches}</h2></div>
            <p className="hint" style={{ margin: 0 }}>
              Assign this lecture to any number of {terms.batches}. Each one gets its own practice question set.
            </p>
            <BatchAssign assigned={assignedBatchIds} allBatches={allBatches} onChange={setBatches} terms={terms} />
          </div>
        )}

        {tab === "practice" && <PracticeQuestionsSection lecture={lecture} />}

        {tab === "watching" && <WatchStats id={id} />}

        {tab === "lesson" && <VideoLessonPanel lecture={id} editTo={`/lectures/${id}/edit`} />}
      </div>
    </div>
  );
}

// "Ace this lecture" on the student app — a self-check quiz built from
// questions either picked out of the bank here (same picker ExamBuilder.jsx
// uses for an exam, restricted to mcq/mtf — see PRACTICE_TYPES on the
// backend) or generated fresh from this lecture's notes. One set PER BATCH
// (lectureModel.js's practiceQuestionSets) — a lecture assigned to two
// batches can quiz them differently, so everything below operates on
// whichever batch's pill is currently selected, not on the lecture as a
// whole. Nothing downstream treats the two ways of adding a question
// differently except a small "AI" badge, purely for the admin's own review.
function PracticeQuestionsSection({ lecture }) {
  const terms = useTerms();
  const [setQuestions, { isLoading: saving, error: saveError }] = useSetLecturePracticeQuestionsMutation();
  const [generate, { isLoading: generating, error: generateError }] = useGenerateLecturePracticeQuestionsMutation();

  const batches = lecture.batches || [];
  // The chosen batch, or the first one: a batch assigned (or removed) after
  // this page opened must still be the one everything below acts on.
  const [chosenBatchId, setActiveBatchId] = useState("");
  const activeBatchId = batches.some((b) => b._id === chosenBatchId) ? chosenBatchId : batches[0]?._id || "";

  const [picking, setPicking] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  // The question open in the full-view window (by id, so it stays fresh).
  const [viewingId, setViewingId] = useState(null);
  const [genCount, setGenCount] = useState("5");
  const [genTypes, setGenTypes] = useState("mixed");

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [subjectFilter, setSubjectFilterState] = useState("");
  const [topicFilter, setTopicFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [bankPage, setBankPage] = useState(1);

  const { data: tree } = useGetTreeQuery(undefined, { skip: !picking });
  const { data: allTags } = useGetQuestionTagsQuery(undefined, { skip: !picking });

  const subjects = (tree || []).map((subject) => ({ _id: subject._id, title: subject.title }));
  const topicSource = subjectFilter ? (tree || []).filter((s) => s._id === subjectFilter) : (tree || []);
  const topics = topicSource.flatMap((subject) =>
    subject.chapters.flatMap((chapter) =>
      chapter.topics.map((topic) => ({
        _id: topic._id,
        label: subjectFilter ? `${chapter.title} · ${topic.title}` : `${subject.title} · ${topic.title}`,
      }))
    )
  );

  const setFilter = (setter) => (value) => { setter(value); setBankPage(1); };
  const setSubjectFilter = (value) => { setSubjectFilterState(value); setTopicFilter(""); setBankPage(1); };

  const activeSet = (lecture.practiceQuestionSets || []).find((s) => String(s.batch?._id || s.batch) === String(activeBatchId));
  const questions = activeSet?.questions || [];
  const ids = questions.map((q) => q._id);
  const viewing = questions.find((q) => q._id === viewingId) || null;

  const bank = useGetQuestionsQuery(
    {
      search: search || undefined,
      // Written is never offered here — an instant self-check has nothing
      // to grade it against on the student app. See PRACTICE_TYPES.
      type: typeFilter || undefined,
      subject: subjectFilter || undefined,
      topic: topicFilter || undefined,
      tag: tagFilter || undefined,
      page: bankPage,
      limit: 12,
    },
    { skip: !picking }
  );

  const save = (nextIds) => setQuestions({ id: lecture._id, batchId: activeBatchId, questionIds: nextIds });

  const submitGenerate = async (e) => {
    e.preventDefault();
    try {
      await generate({ id: lecture._id, batchId: activeBatchId, count: Number(genCount) || 5, types: genTypes }).unwrap();
      setGenOpen(false);
    } catch {
      // rendered below
    }
  };

  if (batches.length === 0) {
    return (
      <div className="card stack">
        <div className="row-tight"><Trophy size={14} /><h2>Practice questions — "Ace this lecture"</h2></div>
        <p className="hint" style={{ margin: 0 }}>Assign this lecture to a batch first — practice questions are set per batch.</p>
      </div>
    );
  }

  return (
    <div className="card stack">
      <div className="spread">
        <div className="row-tight"><Trophy size={14} /><h2>Practice questions — "Ace this lecture"</h2></div>
        <div className="row-tight">
          <button type="button" className="btn btn-sm btn-quiet" onClick={() => { setGenOpen(!genOpen); setPicking(false); }}>
            <Sparkles size={14} /> Generate with AI
          </button>
          <button type="button" className="btn btn-sm" onClick={() => { setPicking(!picking); setGenOpen(false); }}>
            {picking ? <><X size={14} /> Done</> : <><Plus size={14} /> Add from bank</>}
          </button>
        </div>
      </div>

      <p className="hint" style={{ margin: 0 }}>
        Shown to students under this lecture's content, as a quick self-check quiz with instant answers — not a
        graded exam. Multiple-choice and true/false only, and set separately per batch below. Questions generated
        here stay in this quiz; ones added from the bank also show in the batch's practice as before.
      </p>

      {batches.length > 1 && (
        <div className="row-tight" style={{ flexWrap: "wrap" }}>
          {batches.map((b) => {
            const count = (lecture.practiceQuestionSets || []).find((s) => String(s.batch?._id || s.batch) === String(b._id))?.questions.length || 0;
            return (
              <button
                key={b._id}
                type="button"
                className={`pill pill-btn row-tight${activeBatchId === b._id ? " pill-on" : ""}`}
                style={{ gap: 5 }}
                onClick={() => { setActiveBatchId(b._id); setPicking(false); setGenOpen(false); }}
              >
                {b.name} {count > 0 && <span className="tnum">({count})</span>}
              </button>
            );
          })}
        </div>
      )}

      {questions.length === 0 && !picking && !genOpen && (
        <Empty icon={Trophy} title={`No practice questions yet for this ${terms.batch}`} hint="Add some from the bank, or generate a set from this lecture's notes." />
      )}

      {viewing && <PracticeQuestionWindow question={viewing} lecture={lecture} onClose={() => setViewingId(null)} />}

      {questions.map((question) => (
        <div key={question._id} className="row" style={{ alignItems: "flex-start" }}>
          <div className="grow" role="button" tabIndex={0} title="Open the whole question" style={{ cursor: "pointer" }}
            onClick={() => setViewingId(question._id)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setViewingId(question._id); } }}>
            <div className="row-tight" style={{ marginBottom: 4, flexWrap: "wrap" }}>
              <TypePill type={question.type} />
              {question.source === "ai" && (
                <span className="pill row-tight" style={{ gap: 3 }}><Sparkles size={10} /> AI</span>
              )}
              {question.lectureQuizOnly && <span className="pill">Quiz only</span>}
            </div>
            <div className="row-tight" style={{ alignItems: "flex-start", gap: 10, marginBottom: question.type === "mcq" ? 6 : 0 }}>
              {question.questionImage?.url && (
                <img
                  src={question.questionImage.url}
                  alt=""
                  style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 8, flexShrink: 0 }}
                />
              )}
              <Latex as="div" className="grow small" style={{ lineHeight: 1.5 }}>{question.question}</Latex>
            </div>
            {question.type === "mcq" && question.options?.some((o) => o.image?.url) && (
              <div className="row-tight" style={{ flexWrap: "wrap", gap: 6 }}>
                {question.options.map((o) => o.image?.url && (
                  <img
                    key={o.key}
                    src={o.image.url}
                    alt=""
                    title={o.text}
                    style={{ width: 28, height: 28, objectFit: "cover", borderRadius: 6 }}
                  />
                ))}
              </div>
            )}
          </div>
          <button
            className="icon-btn icon-btn-danger"
            title="Take out of this lecture's practice set"
            onClick={() => save(ids.filter((qid) => qid !== question._id))}
          >
            <X size={15} />
          </button>
        </div>
      ))}

      <ErrorNote error={saveError} />

      {genOpen && (
        <form className="card-quiet stack" onSubmit={submitGenerate}>
          <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>
            <Field label="How many">
              <input
                className="input tnum" type="number" min="3" max="8" style={{ width: 80 }}
                value={genCount} onChange={(e) => setGenCount(e.target.value)}
              />
            </Field>
            <Field label="Question type">
              <select className="select" value={genTypes} onChange={(e) => setGenTypes(e.target.value)}>
                <option value="mixed">Mixed</option>
                <option value="mcq">Multiple choice only</option>
                <option value="mtf">True / false only</option>
              </select>
            </Field>
          </div>
          <ErrorNote error={generateError} />
          <div className="row">
            <button className="btn btn-sm" disabled={generating || !activeBatchId}>
              {generating ? "Generating…" : "Generate"}
            </button>
            <button type="button" className="btn btn-sm btn-quiet" onClick={() => setGenOpen(false)}>Cancel</button>
          </div>
        </form>
      )}

      {picking && (
        <div className="card-quiet stack">
          <div className="search-wrap">
            <Search size={15} className="search-icon" />
            <input
              className="input" style={{ paddingLeft: 36 }}
              placeholder="Search the question bank"
              value={search} onChange={(e) => setFilter(setSearch)(e.target.value)}
            />
          </div>

          <div className="row-tight" style={{ flexWrap: "wrap" }}>
            <select className="select" value={typeFilter} onChange={(e) => setFilter(setTypeFilter)(e.target.value)}>
              <option value="">Multiple choice or true/false</option>
              <option value="mcq">Multiple choice</option>
              <option value="mtf">True / false</option>
            </select>
            {subjects.length > 0 && (
              <SearchSelect className="select" value={subjectFilter} onChange={(e) => setSubjectFilter(e.target.value)}>
                <option value="">All subjects</option>
                {subjects.map((s) => <option key={s._id} value={s._id}>{s.title}</option>)}
              </SearchSelect>
            )}
            <SearchSelect className="select" value={topicFilter} onChange={(e) => setFilter(setTopicFilter)(e.target.value)}>
              <option value="">{subjectFilter ? "All topics in this subject" : "All topics"}</option>
              {topics.map((t) => <option key={t._id} value={t._id}>{t.label}</option>)}
            </SearchSelect>
            {allTags?.length > 0 && (
              <SearchSelect className="select" value={tagFilter} onChange={(e) => setFilter(setTagFilter)(e.target.value)}>
                <option value="">All tags</option>
                {allTags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
              </SearchSelect>
            )}
          </div>

          {bank.isFetching ? (
            <Loading />
          ) : (bank.data?.questions || []).filter((q) => PRACTICE_TYPES.includes(q.type) && !ids.includes(q._id)).length === 0 ? (
            <p className="hint" style={{ margin: 0 }}>
              {bank.data?.total ? "Nothing left on this page — everything's already added, written, or filtered out." : "Nothing matches these filters."}
            </p>
          ) : (
            (bank.data?.questions || [])
              .filter((q) => PRACTICE_TYPES.includes(q.type) && !ids.includes(q._id))
              .map((question) => (
                <button
                  key={question._id}
                  className="row"
                  style={{
                    background: "var(--surface)", border: "none", borderRadius: 8,
                    padding: 10, font: "inherit", color: "inherit", textAlign: "left", cursor: "pointer",
                  }}
                  disabled={saving}
                  onClick={() => save([...ids, question._id])}
                >
                  <div className="grow">
                    <div className="row-tight" style={{ marginBottom: 3 }}><TypePill type={question.type} /></div>
                    <div className="row-tight" style={{ alignItems: "flex-start", gap: 10 }}>
                      {question.questionImage?.url && (
                        <img
                          src={question.questionImage.url}
                          alt=""
                          style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 6, flexShrink: 0 }}
                        />
                      )}
                      <Latex as="div" className="grow small">{question.question}</Latex>
                    </div>
                  </div>
                  <span className="muted">+</span>
                </button>
              ))
          )}

          {bank.data && (
            <Pager page={bank.data.page} pages={bank.data.pages} total={bank.data.total} onChange={setBankPage} />
          )}
        </div>
      )}
    </div>
  );
}

// One practice question in full: question, picture, every option or
// statement with the right answer marked, and the solution. A quiz-only
// question (AI-generated here) can be saved to the question bank under a
// chapter and topic, which makes it a normal question: it then also shows in
// the batch's practice, practice exams and the exam builder.
function PracticeQuestionWindow({ question, lecture, onClose }) {
  // Same subscription as the page: refetching it refreshes the list too.
  const { refetch: refetchLecture } = useGetLectureQuery(lecture._id);
  const inBank = !question.lectureQuizOnly;

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog stack" style={{ maxWidth: 640, width: "100%", maxHeight: "90vh", overflowY: "auto" }} role="dialog" aria-label="Practice question">
        <div className="spread">
          <div className="row-tight" style={{ flexWrap: "wrap" }}>
            <TypePill type={question.type} />
            {question.source === "ai" && <span className="pill row-tight" style={{ gap: 3 }}><Sparkles size={10} /> AI</span>}
            <span className={`pill${inBank ? " pill-ok" : ""}`}>{inBank ? "In the question bank" : "Quiz only"}</span>
          </div>
          <button type="button" className="icon-btn" title="Close" onClick={onClose}><X size={16} /></button>
        </div>

        <Latex as="div" style={{ lineHeight: 1.6 }}>{question.question}</Latex>
        {question.questionImage?.url && (
          <img src={question.questionImage.url} alt="" style={{ maxWidth: "100%", maxHeight: 280, objectFit: "contain", borderRadius: 8 }} />
        )}

        {question.type === "mcq" && (
          <div className="stack" style={{ gap: 6 }}>
            {(question.options || []).map((o) => {
              const right = o.key === question.correctOption;
              return (
                <div key={o.key} className="row-tight" style={{ alignItems: "flex-start", gap: 8, padding: "8px 10px", borderRadius: 8,
                  border: `1px solid ${right ? "var(--ok, #16a34a)" : "var(--border, #ddd)"}`, background: right ? "rgba(22,163,74,0.08)" : "transparent" }}>
                  <strong style={{ minWidth: 18 }}>{o.key}.</strong>
                  <div className="grow stack" style={{ gap: 4 }}>
                    {o.text && <Latex as="div">{o.text}</Latex>}
                    {o.image?.url && <img src={o.image.url} alt="" style={{ maxWidth: 200, maxHeight: 120, objectFit: "contain", borderRadius: 6 }} />}
                  </div>
                  {right && <CheckCircle2 size={16} style={{ color: "var(--ok, #16a34a)", flexShrink: 0 }} />}
                </div>
              );
            })}
          </div>
        )}

        {question.type === "mtf" && (
          <div className="stack" style={{ gap: 6 }}>
            {(question.statements || []).map((st, i) => (
              <div key={i} className="row-tight" style={{ alignItems: "flex-start", gap: 8, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border, #ddd)" }}>
                <Latex as="div" className="grow">{st.text}</Latex>
                <span className={`pill${st.isTrue ? " pill-ok" : " pill-bad"}`}>{st.isTrue ? "True" : "False"}</span>
              </div>
            ))}
          </div>
        )}

        {(question.solutionText || question.solutionImage?.url) && (
          <div className="card-quiet stack" style={{ gap: 6 }}>
            <span className="label">Solution</span>
            {question.solutionText && <Latex as="div" className="small" style={{ lineHeight: 1.6 }}>{question.solutionText}</Latex>}
            {question.solutionImage?.url && <img src={question.solutionImage.url} alt="" style={{ maxWidth: "100%", maxHeight: 240, objectFit: "contain", borderRadius: 8 }} />}
          </div>
        )}

        <BankFiling
          question={question}
          startChapter={question.chapter || lecture.chapter?._id || lecture.chapter || ""}
          startTopic={question.topic || (question.chapter ? "" : lecture.topic?._id || lecture.topic || "")}
          onSaved={refetchLecture}
          hint={inBank
            ? "Moving it changes where it's filed. It stays in this lecture's quiz either way."
            : "Until you save it, it lives only in this lecture's quiz. Saving puts it on the Questions page and in the exam builder, and in this batch's practice. It stays in this lecture's quiz."}
        />
        <div className="row-tight">
          <Link className="btn btn-sm btn-quiet" to={`/questions/${question._id}/edit`}><Pencil size={13} /> Edit question</Link>
        </div>
      </div>
    </div>
  );
}

// Kept in sync by hand with backend/controllers/admin/lectureController.js's
// PRACTICE_TYPES — written is excluded on both ends for the same reason
// (see that file's comment): an instant self-check has no grading step.
const PRACTICE_TYPES = ["mcq", "mtf"];