import { useState } from "react";
import { Link } from "react-router-dom";
import {
  useGetTreeQuery,
  useGetQuestionStatsQuery,
  useCreateSubjectMutation,
  useCreateChapterMutation,
  useCreateTopicMutation,
  useUpdateSubjectMutation,
  useUpdateChapterMutation,
  useUpdateTopicMutation,
  useDeleteSubjectMutation,
  useDeleteChapterMutation,
  useDeleteTopicMutation,
} from "../api/contentApi";
import { useOutletContext } from "react-router-dom";
import {
  ChevronDown, ChevronRight, ChevronUp, Pencil, Plus, Trash2, FolderTree, Check, X,
} from "lucide-react";
import { Loading, ErrorNote, Empty, useConfirm, TeacherLocked, Pager, pageSlice } from "../components/bits";

// The tree is the spine: questions attach to topics, and that is what makes
// topic-level analysis possible. So every level is editable here — rename,
// reorder, delete.
//
// Deletes are refused by the server when anything depends on the node, and the
// refusal names what is in the way. That message is surfaced as written rather
// than replaced with a generic failure.

export default function Content() {
  const { can } = useOutletContext();
  const confirm = useConfirm();
  const { data: allTree, isLoading, error } = useGetTreeQuery();
  const tree = allTree;
  const { data: stats } = useGetQuestionStatsQuery();

  const [createSubject, cSub] = useCreateSubjectMutation();
  const [createChapter, cCh] = useCreateChapterMutation();
  const [createTopic, cTop] = useCreateTopicMutation();
  const [updateSubject] = useUpdateSubjectMutation();
  const [updateChapter] = useUpdateChapterMutation();
  const [updateTopic] = useUpdateTopicMutation();
  const [deleteSubject] = useDeleteSubjectMutation();
  const [deleteChapter] = useDeleteChapterMutation();
  const [deleteTopic] = useDeleteTopicMutation();

  const [open, setOpen] = useState({});
  const [adding, setAdding] = useState(null);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState(null);
  const [page, setPage] = useState(1);
  // Chapters of an open subject, a page at a time (by subject id).
  const [chapterPage, setChapterPage] = useState({});

  if (isLoading) return <Loading />;

  const countsFor = (topicId) => {
    const row = (stats || []).find((s) => !s.chapterPool && String(s._id) === String(topicId));
    return { total: row ? row.total : 0, pending: row ? row.pending : 0 };
  };

  // Questions filed straight under a chapter (topic: null — "chapter pool")
  // never showed up anywhere in this tree: getQuestionStats used to key
  // purely on topic, so every pool question on the platform collapsed into
  // one un-attributable bucket, and a chapter only ever displayed its topic
  // count. A chapter with pool questions (0 topics or not) looked "empty",
  // deleting it was refused server-side with no visible reason why, and
  // there was no link from here to go find and clear them.
  const poolCountsFor = (chapterId) => {
    const row = (stats || []).find((s) => s.chapterPool && String(s.chapter) === String(chapterId));
    return { total: row ? row.total : 0, pending: row ? row.pending : 0 };
  };

  const create = {
    subject: (title) => createSubject({ title }),
    chapter: (title, parentId) => createChapter({ title, subject: parentId }),
    topic: (title, parentId) => createTopic({ title, chapter: parentId }),
  };
  const update = { subject: updateSubject, chapter: updateChapter, topic: updateTopic };
  const remove = { subject: deleteSubject, chapter: deleteChapter, topic: deleteTopic };

  const cancel = () => {
    setAdding(null);
    setEditing(null);
    setDraft("");
  };

  const submitAdd = async (event) => {
    event.preventDefault();
    if (!draft.trim() || !adding) return;
    try {
      await create[adding.kind](draft.trim(), adding.parentId).unwrap();
      cancel();
      setProblem(null);
    } catch (err) {
      setProblem(err);
    }
  };

  const submitRename = async (event) => {
    event.preventDefault();
    if (!draft.trim() || !editing) return;
    try {
      await update[editing.kind]({ id: editing.id, title: draft.trim() }).unwrap();
      cancel();
      setProblem(null);
    } catch (err) {
      setProblem(err);
    }
  };

  const destroy = async (kind, node) => {
    // Naming what sits underneath turns a blind yes/no into a real decision.
    const inside =
      kind === "subject"
        ? `${node.chapters.length} chapter${node.chapters.length === 1 ? "" : "s"}`
        : kind === "chapter"
          ? (() => {
              const pool = poolCountsFor(node._id).total;
              const topicPart = `${node.topics.length} topic${node.topics.length === 1 ? "" : "s"}`;
              // The server's own delete check counts every question under the
              // chapter, topic'd or not — naming only the topic count here
              // used to leave a chapter that looked empty (0 topics) refused
              // for a reason nothing in this dialog mentioned.
              return pool > 0 ? `${topicPart} and ${pool} question${pool === 1 ? "" : "s"} filed directly under it` : topicPart;
            })()
          : `${countsFor(node._id).total} question${countsFor(node._id).total === 1 ? "" : "s"}`;

    const yes = await confirm({
      title: `Delete "${node.title}"?`,
      body: `It holds ${inside}. Deleting is refused while anything is still inside it.`,
    });
    if (!yes) return;

    try {
      await remove[kind](node._id).unwrap();
      setProblem(null);
    } catch (err) {
      setProblem(err);
    }
  };

  // Order is a number on each node, so swapping with a neighbour is the whole
  // operation. No drag library, and it works on a phone.
  const reorder = (kind, items, index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    update[kind]({ id: items[index]._id, order: target });
    update[kind]({ id: items[target]._id, order: index });
  };

  const startEdit = (kind, node) => {
    cancel();
    setEditing({ kind, id: node._id });
    setDraft(node.title);
  };

  const startAdd = (kind, parentId) => {
    cancel();
    setAdding({ kind, parentId });
  };

  const AddForm = ({ placeholder }) => (
    <form onSubmit={submitAdd} className="row-tight" style={{ padding: "6px 0" }}>
      <input
        className="input"
        autoFocus
        placeholder={placeholder}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <button className="btn btn-sm"><Check size={14} /> Add</button>
      <button type="button" className="icon-btn" onClick={cancel} title="Cancel"><X size={15} /></button>
    </form>
  );

  const RenameForm = () => (
    <form onSubmit={submitRename} className="row-tight grow">
      <input
        className="input"
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <button className="btn btn-sm"><Check size={14} /> Save</button>
      <button type="button" className="icon-btn" onClick={cancel} title="Cancel"><X size={15} /></button>
    </form>
  );

  const subjectsShown = pageSlice(tree, page, 20);

  const isAdding = (kind, parentId) => adding?.kind === kind && adding?.parentId === parentId;
  const isEditing = (kind, id) => editing?.kind === kind && editing?.id === id;

  return (
    <div className="page">
      <div className="page-head spread">
        <div>
          <h1>Content</h1>
          <p className="muted small" style={{ margin: "2px 0 0" }}>
            Subjects hold chapters, chapters hold topics, questions attach to topics.
          </p>
        </div>
        {can("manageSubjects") && (
          <button className="btn" onClick={() => startAdd("subject", null)}>
            <Plus size={15} /> New subject
          </button>
        )}
      </div>

      <div className="stack">
        <ErrorNote error={error || problem || cSub.error || cCh.error || cTop.error} />


        {isAdding("subject", null) && (
          <div className="card"><AddForm placeholder="Subject name, like Physics" /></div>
        )}

        {tree?.length ? (
          <>
          {subjectsShown.items.map((subject, i) => {
            const subjectIndex = subjectsShown.start + i;
            const chapters = pageSlice(subject.chapters, chapterPage[subject._id], 25);
            return (
            <div className="card stack" key={subject._id}>
              {/* ---------------- subject ---------------- */}
              <div className="spread">
                {isEditing("subject", subject._id) ? <RenameForm /> : (
                  <>
                    <button
                      className="row-tight grow"
                      style={{ background: "none", border: "none", font: "inherit", color: "inherit", cursor: "pointer", padding: 0, textAlign: "left" }}
                      onClick={() => setOpen({ ...open, [subject._id]: !open[subject._id] })}
                    >
                      <span className="muted">
                        {open[subject._id] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </span>
                      <h2>{subject.title}</h2>
                      <span className="pill tnum">
                        {subject.chapters.length} chapter{subject.chapters.length === 1 ? "" : "s"}
                      </span>
                    </button>

                    <div className="row-tight">
                      {can("manageSubjects") && (
                        <>
                          <button className="icon-btn" title="Move up" disabled={subjectIndex === 0}
                            onClick={() => reorder("subject", tree, subjectIndex, -1)}><ChevronUp size={15} /></button>
                          <button className="icon-btn" title="Move down" disabled={subjectIndex === tree.length - 1}
                            onClick={() => reorder("subject", tree, subjectIndex, 1)}><ChevronDown size={15} /></button>
                          <button className="icon-btn" title="Rename"
                            onClick={() => startEdit("subject", subject)}><Pencil size={14} /></button>
                        </>
                      )}
                      <button className="btn btn-sm btn-quiet" onClick={() => startAdd("chapter", subject._id)}>
                        <Plus size={13} /> Chapter
                      </button>
                      {can("manageSubjects") && (
                        <button className="icon-btn icon-btn-danger" title="Delete subject"
                          onClick={() => destroy("subject", subject)}><Trash2 size={14} /></button>
                      )}
                    </div>
                  </>
                )}
              </div>

              {isAdding("chapter", subject._id) && <AddForm placeholder="Chapter name, like Mechanics" />}

              {open[subject._id] && (
                <div className="stack" style={{ gap: 8, paddingLeft: 16 }}>
                  {subject.chapters.length === 0 && (
                    <p className="hint" style={{ margin: 0 }}>No chapters yet.</p>
                  )}

                  {/* ---------------- chapters ---------------- */}
                  {chapters.items.map((chapter, j) => { const chapterIndex = chapters.start + j; return (
                    <div key={chapter._id} className="card-quiet stack" style={{ gap: 8 }}>
                      <div className="spread">
                        {isEditing("chapter", chapter._id) ? <RenameForm /> : (
                          <>
                            <div className="row-tight grow">
                              <strong style={{ fontWeight: 500 }}>{chapter.title}</strong>
                              {chapter.section && <span className="pill">{chapter.section}</span>}
                              <span className="pill tnum">
                                {chapter.topics.length} topic{chapter.topics.length === 1 ? "" : "s"}
                              </span>
                              {(() => {
                                const pool = poolCountsFor(chapter._id);
                                // Questions filed straight under the chapter (no topic) —
                                // previously invisible here entirely, and the reason a
                                // chapter that looked empty still refused to delete.
                                return pool.total > 0 ? (
                                  <Link className="pill tnum" to={`/questions?topic=none&chapter=${chapter._id}`}>
                                    {pool.total} question{pool.total === 1 ? "" : "s"} (no topic)
                                  </Link>
                                ) : null;
                              })()}
                            </div>

                            <div className="row-tight">
                              <button className="icon-btn" title="Move up" disabled={chapterIndex === 0}
                                onClick={() => reorder("chapter", subject.chapters, chapterIndex, -1)}><ChevronUp size={15} /></button>
                              <button className="icon-btn" title="Move down"
                                disabled={chapterIndex === subject.chapters.length - 1}
                                onClick={() => reorder("chapter", subject.chapters, chapterIndex, 1)}><ChevronDown size={15} /></button>
                              <button className="icon-btn" title="Rename"
                                onClick={() => startEdit("chapter", chapter)}><Pencil size={14} /></button>
                              <button className="btn btn-sm btn-ghost" onClick={() => startAdd("topic", chapter._id)}>
                                <Plus size={13} /> Topic
                              </button>
                              <button className="icon-btn icon-btn-danger" title="Delete chapter"
                                onClick={() => destroy("chapter", chapter)}><Trash2 size={14} /></button>
                            </div>
                          </>
                        )}
                      </div>

                      {isAdding("topic", chapter._id) && <AddForm placeholder="Topic name, like Momentum" />}

                      {/* ---------------- topics ---------------- */}
                      {chapter.topics.length === 0 ? (
                        <p className="hint" style={{ margin: 0 }}>
                          No topics yet. Questions attach to topics, so add at least one.
                        </p>
                      ) : (
                        <div className="stack" style={{ gap: 4 }}>
                          {chapter.topics.map((topic, topicIndex) => {
                            const { total, pending } = countsFor(topic._id);
                            return (
                              <div
                                key={topic._id}
                                className="spread"
                                style={{ background: "var(--surface)", borderRadius: 8, padding: "7px 10px" }}
                              >
                                {isEditing("topic", topic._id) ? <RenameForm /> : (
                                  <>
                                    <span className="grow small truncate">{topic.title}</span>

                                    {total > 0 ? (
                                      <Link className="pill tnum" to={`/questions?topic=${topic._id}`}>
                                        {total} question{total === 1 ? "" : "s"}
                                      </Link>
                                    ) : (
                                      <span className="pill pill-warn">No questions</span>
                                    )}

                                    {pending > 0 && (
                                      <Link className="pill pill-ai tnum" to="/review">
                                        {pending} to review
                                      </Link>
                                    )}

                                    <div className="row-tight">
                                      <button className="icon-btn" title="Move up" disabled={topicIndex === 0}
                                        onClick={() => reorder("topic", chapter.topics, topicIndex, -1)}><ChevronUp size={14} /></button>
                                      <button className="icon-btn" title="Move down"
                                        disabled={topicIndex === chapter.topics.length - 1}
                                        onClick={() => reorder("topic", chapter.topics, topicIndex, 1)}><ChevronDown size={14} /></button>
                                      <button className="icon-btn" title="Rename"
                                        onClick={() => startEdit("topic", topic)}><Pencil size={13} /></button>
                                      <button className="icon-btn icon-btn-danger" title="Delete topic"
                                        onClick={() => destroy("topic", topic)}><Trash2 size={13} /></button>
                                    </div>
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ); })}
                  <Pager page={chapters.page} pages={chapters.pages} total={chapters.total}
                    onChange={(p) => setChapterPage({ ...chapterPage, [subject._id]: p })} />
                </div>
              )}
            </div>
            );
          })}
          <Pager page={subjectsShown.page} pages={subjectsShown.pages} total={subjectsShown.total} onChange={setPage} />
          </>
        ) : (
          <Empty
            icon={FolderTree}
            title="Nothing here yet"
            hint="Start with a subject, then add chapters and topics beneath it."
            action={
              can("manageSubjects") ? (
                <button className="btn" onClick={() => startAdd("subject", null)}>
                  <Plus size={15} /> New subject
                </button>
              ) : <TeacherLocked what="Subjects" />
            }
          />
        )}
      </div>
    </div>
  );
}
