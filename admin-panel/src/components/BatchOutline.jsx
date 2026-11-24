import { useEffect, useMemo, useState } from "react";
import {
  ChevronUp, ChevronDown, ChevronRight, GripVertical, Plus, Pencil, Trash2, RotateCcw, Eye, Save, Check, X, FolderOpen, PlayCircle,
} from "lucide-react";
import { useGetOutlineQuery, useSaveOutlineMutation } from "../api/contentApi";
import { Loading, ErrorNote, useConfirm } from "./bits";
import { useTerms } from "../terms";

// The batch's outline: one order for its subjects, chapters, topics and
// lectures, and named groups of chapters (papers, terms, units). Students
// see everything in this batch in this order (backend utils/courseOutline.js).
//
// Edited as a draft and saved in one go. Chapters move by drag and drop,
// the arrows, or "Move to"; topics and lectures move with their arrows
// inside an opened chapter.

const UNGROUPED = "";
let keySeq = 0;
const newKey = () => `new-${(keySeq += 1)}`;

const move = (list, from, to) => {
  if (to < 0 || to >= list.length || from === to) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
};

const draftFrom = (data) => ({
  groups: data.groups.map((g) => ({ key: g._id, _id: g._id, name: g.name, chapters: g.chapters })),
  subjects: data.subjects.map((s) => s._id),
  chapters: data.chapters.map((c) => c._id),
  topics: Object.fromEntries(data.chapters.map((c) => [c._id, c.topics.map((t) => t._id)])),
  lectures: Object.fromEntries(data.chapters.map((c) => [c._id, c.lectures.map((l) => l._id)])),
});

const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export default function BatchOutline({ batchId }) {
  const terms = useTerms();
  const { data, isLoading, error, refetch } = useGetOutlineQuery(batchId);
  const [save, saveState] = useSaveOutlineMutation();
  const confirm = useConfirm();
  const [draft, setDraft] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [open, setOpen] = useState({});
  const [dragging, setDragging] = useState(null);
  const [dropAt, setDropAt] = useState(null);
  const [naming, setNaming] = useState(null); // { key, value } — a group being named
  const [preview, setPreview] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data && !dirty) setDraft(draftFrom(data));
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const chapterById = useMemo(() => new Map((data?.chapters || []).map((c) => [c._id, c])), [data]);
  const subjectById = useMemo(() => new Map((data?.subjects || []).map((s) => [s._id, s])), [data]);

  if (isLoading || (!draft && !error)) return <Loading />;
  if (error) return <ErrorNote error={error} />;

  const update = (fn) => {
    setDraft((d) => fn(d));
    setDirty(true);
    setSaved(false);
  };

  const groupOf = (chapterId) => draft.groups.find((g) => g.chapters.includes(chapterId))?.key ?? UNGROUPED;
  const ungroupedIn = (subjectId) => draft.chapters.filter((id) => groupOf(id) === UNGROUPED && chapterById.get(id)?.subject === subjectId);

  // Puts a chapter into a group (or back out), before `beforeId` or at the end.
  const placeChapter = (chapterId, groupKey, beforeId = null) => update((d) => {
    const groups = d.groups.map((g) => ({ ...g, chapters: g.chapters.filter((id) => id !== chapterId) }));
    let chapters = d.chapters.filter((id) => id !== chapterId);
    if (groupKey !== UNGROUPED) {
      const g = groups.find((x) => x.key === groupKey);
      const at = beforeId ? g.chapters.indexOf(beforeId) : -1;
      g.chapters.splice(at >= 0 ? at : g.chapters.length, 0, chapterId);
      chapters.push(chapterId);
    } else {
      const at = beforeId ? chapters.indexOf(beforeId) : -1;
      if (at >= 0) chapters.splice(at, 0, chapterId);
      else {
        // At the end of its subject's ungrouped chapters.
        const subject = chapterById.get(chapterId)?.subject;
        const last = chapters.map((id, i) => [id, i]).filter(([id]) => chapterById.get(id)?.subject === subject).pop();
        chapters.splice(last ? last[1] + 1 : chapters.length, 0, chapterId);
      }
    }
    return { ...d, groups, chapters };
  });

  // Up/down inside whatever list the chapter is shown in.
  const nudgeChapter = (chapterId, delta) => {
    const groupKey = groupOf(chapterId);
    if (groupKey !== UNGROUPED) {
      update((d) => ({
        ...d,
        groups: d.groups.map((g) => (g.key !== groupKey ? g : { ...g, chapters: move(g.chapters, g.chapters.indexOf(chapterId), g.chapters.indexOf(chapterId) + delta) })),
      }));
      return;
    }
    const siblings = ungroupedIn(chapterById.get(chapterId)?.subject);
    const neighbour = siblings[siblings.indexOf(chapterId) + delta];
    if (!neighbour) return;
    update((d) => ({ ...d, chapters: move(d.chapters, d.chapters.indexOf(chapterId), d.chapters.indexOf(neighbour)) }));
  };

  const nudgeChild = (kind, chapterId, index, delta) => update((d) => ({
    ...d, [kind]: { ...d[kind], [chapterId]: move(d[kind][chapterId], index, index + delta) },
  }));

  const addGroup = (name) => update((d) => ({ ...d, groups: [...d.groups, { key: newKey(), name, chapters: [] }] }));
  const renameGroup = (key, name) => update((d) => ({ ...d, groups: d.groups.map((g) => (g.key === key ? { ...g, name } : g)) }));
  const removeGroup = (key) => update((d) => ({ ...d, groups: d.groups.filter((g) => g.key !== key) }));
  const nudgeGroup = (index, delta) => update((d) => ({ ...d, groups: move(d.groups, index, index + delta) }));
  const nudgeSubject = (index, delta) => update((d) => ({ ...d, subjects: move(d.subjects, index, index + delta) }));
  const addSubjectToGroup = (groupKey, subjectId) => update((d) => {
    const ids = d.chapters.filter((id) => chapterById.get(id)?.subject === subjectId && !d.groups.some((g) => g.chapters.includes(id)));
    return { ...d, groups: d.groups.map((g) => (g.key === groupKey ? { ...g, chapters: [...g.chapters, ...ids] } : g)) };
  });

  const submitName = () => {
    const name = naming.value.trim().slice(0, 60);
    if (!name) return setNaming(null);
    if (draft.groups.some((g) => g.key !== naming.key && g.name.toLowerCase() === name.toLowerCase())) return;
    if (naming.key) renameGroup(naming.key, name);
    else addGroup(name);
    setNaming(null);
  };

  const body = () => ({
    groups: draft.groups.map((g) => ({ ...(g._id ? { _id: g._id } : {}), name: g.name, chapters: g.chapters })),
    subjects: draft.subjects,
    // Grouped chapters first in group order, then the rest by subject, so
    // the saved list reads the way the page shows it.
    chapters: [...draft.groups.flatMap((g) => g.chapters), ...draft.subjects.flatMap((s) => ungroupedIn(s))],
    topics: draft.chapters.flatMap((id) => draft.topics[id] || []),
    lectures: draft.chapters.flatMap((id) => draft.lectures[id] || []),
  });

  const onSave = async () => {
    await save({ batchId, ...body() }).unwrap();
    setDirty(false);
    setSaved(true);
  };

  const onDiscard = () => {
    setDraft(draftFrom(data));
    setDirty(false);
  };

  const onReset = async () => {
    const yes = await confirm({
      title: "Reset to the syllabus order?",
      body: `Every group is removed and this ${terms.batch} goes back to the order set on the Content page. Students see the change at once.`,
      confirmLabel: "Reset",
    });
    if (!yes) return;
    await save({ batchId }).unwrap();
    setDirty(false);
    refetch();
  };

  // ---- drag and drop (chapters only)
  const dragProps = (chapterId) => ({
    draggable: true,
    onDragStart: (e) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", chapterId);
      // Deferred: the drop zones appear when this is set, and changing the
      // page in the same tick a drag starts makes the browser cancel it.
      setTimeout(() => setDragging(chapterId), 0);
    },
    onDragEnd: () => { setDragging(null); setDropAt(null); },
  });
  const dropProps = (groupKey, beforeId = null) => ({
    onDragOver: (e) => {
      if (!dragging) return;
      // Ungrouped chapters stay under their own subject.
      if (groupKey === UNGROUPED && beforeId && chapterById.get(beforeId)?.subject !== chapterById.get(dragging)?.subject) return;
      e.preventDefault();
      e.stopPropagation();
      setDropAt(`${groupKey}:${beforeId || "end"}`);
    },
    onDrop: (e) => {
      e.preventDefault();
      e.stopPropagation();
      const moving = dragging || e.dataTransfer.getData("text/plain");
      if (moving && moving !== beforeId && chapterById.has(moving)) placeChapter(moving, groupKey, beforeId);
      setDragging(null);
      setDropAt(null);
    },
  });

  // Plain render functions, not components: a component defined in here
  // would remount on every render and cancel a drag in progress.
  const chapterRow = ({ chapterId, groupKey, index, total, showSubject }) => {
    const c = chapterById.get(chapterId);
    if (!c) return null;
    const isOpen = open[chapterId];
    const topics = (draft.topics[chapterId] || []).map((id) => c.topics.find((t) => t._id === id)).filter(Boolean);
    const lectures = (draft.lectures[chapterId] || []).map((id) => c.lectures.find((l) => l._id === id)).filter(Boolean);
    return (
      <div
        key={chapterId}
        {...dropProps(groupKey, chapterId)}
        className="card-quiet"
        style={{
          padding: "8px 10px",
          opacity: dragging === chapterId ? 0.45 : 1,
          boxShadow: dropAt === `${groupKey}:${chapterId}` ? "inset 0 2px 0 var(--primary)" : undefined,
          transition: "box-shadow 120ms, opacity 120ms",
        }}
      >
        <div className="spread" style={{ gap: 8 }}>
          <div className="row-tight grow" style={{ minWidth: 0 }}>
            <span {...dragProps(chapterId)} title="Drag to move" style={{ cursor: "grab", display: "flex", color: "var(--text-muted)" }}>
              <GripVertical size={15} />
            </span>
            <button type="button" className="icon-btn" title={isOpen ? "Hide topics and lectures" : "Show topics and lectures"}
              onClick={() => setOpen((o) => ({ ...o, [chapterId]: !o[chapterId] }))}>
              {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            </button>
            <strong className="truncate" style={{ fontWeight: 500 }}>{c.title}</strong>
            {showSubject && <span className="pill">{subjectById.get(c.subject)?.title}</span>}
            {c.isNew && <span className="pill pill-warn" title="Added since the outline was last saved">New</span>}
            <span className="pill tnum small">{count(c.lectures.length, "lecture")}</span>
            {c.questions > 0 && <span className="pill tnum small">{count(c.questions, "question")}</span>}
            {c.archive > 0 && <span className="pill tnum small">{c.archive} archive</span>}
          </div>
          <div className="row-tight">
            <select className="pill pill-btn" value={groupKey} title="Move to group" onChange={(e) => placeChapter(chapterId, e.target.value)} style={{ maxWidth: 150 }}>
              <option value={UNGROUPED}>No group</option>
              {draft.groups.map((g) => <option key={g.key} value={g.key}>{g.name}</option>)}
            </select>
            <button type="button" className="icon-btn" title="Move up" disabled={index === 0} onClick={() => nudgeChapter(chapterId, -1)}><ChevronUp size={15} /></button>
            <button type="button" className="icon-btn" title="Move down" disabled={index === total - 1} onClick={() => nudgeChapter(chapterId, 1)}><ChevronDown size={15} /></button>
          </div>
        </div>

        {isOpen && (
          <div className="stack" style={{ gap: 10, padding: "10px 4px 2px 30px" }}>
            <ChildList
              label="Topics"
              empty="No topics in this chapter."
              items={topics}
              render={(t) => (
                <>
                  <span className="truncate grow">{t.title}</span>
                  {t.questions > 0 && <span className="pill tnum small">{count(t.questions, "question")}</span>}
                  {t.archive > 0 && <span className="pill tnum small">{t.archive} archive</span>}
                </>
              )}
              onMove={(i, delta) => nudgeChild("topics", chapterId, i, delta)}
            />
            <ChildList
              label="Lectures"
              empty="No lectures from this chapter in this batch."
              items={lectures}
              render={(l) => (
                <>
                  <PlayCircle size={13} style={{ flexShrink: 0, color: "var(--text-muted)" }} />
                  <span className="truncate grow">{l.title}</span>
                  {l.topic && <span className="pill small">{c.topics.find((t) => t._id === l.topic)?.title || "Topic"}</span>}
                  {!l.isPublished && <span className="pill small">Draft</span>}
                </>
              )}
              onMove={(i, delta) => nudgeChild("lectures", chapterId, i, delta)}
            />
          </div>
        )}
      </div>
    );
  };

  const endDrop = ({ groupKey, label }) => (
    <div
      {...dropProps(groupKey)}
      className="hint"
      style={{
        border: `1px dashed ${dropAt === `${groupKey}:end` ? "var(--primary)" : "var(--border)"}`,
        borderRadius: 8, padding: "8px 10px", textAlign: "center",
        display: dragging ? "block" : label ? "block" : "none",
      }}
    >
      {dragging ? "Drop here" : label}
    </div>
  );

  const subjectsWithUngrouped = draft.subjects.filter((s) => ungroupedIn(s).length > 0);

  return (
    <div className="stack">
      <div className="spread" style={{ flexWrap: "wrap" }}>
        <div className="grow" style={{ minWidth: 240 }}>
          <h2 style={{ margin: 0 }}>Outline</h2>
          <p className="hint" style={{ margin: "4px 0 0" }}>
            The order students see this batch's lectures, practice, archive, study plan and progress in. Group chapters into papers, terms or units, or leave them by subject.
          </p>
        </div>
        <div className="row-tight" style={{ flexWrap: "wrap" }}>
          <button type="button" className="btn btn-sm btn-quiet" onClick={() => setPreview((p) => !p)}>
            <Eye size={13} /> {preview ? "Edit" : "Student view"}
          </button>
          {data.saved && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={onReset} disabled={saveState.isLoading}>
              <RotateCcw size={13} /> Reset to syllabus order
            </button>
          )}
          {dirty && <button type="button" className="btn btn-sm btn-ghost" onClick={onDiscard}>Discard</button>}
          <button type="button" className={`btn btn-sm${saved && !dirty ? " btn-ok" : ""}`} onClick={onSave} disabled={!dirty || saveState.isLoading}>
            {saved && !dirty ? <><Check size={13} /> Saved</> : <><Save size={13} /> {saveState.isLoading ? "Saving…" : "Save outline"}</>}
          </button>
        </div>
      </div>
      <ErrorNote error={saveState.error} />

      {data.chapters.length === 0 ? (
        <p className="hint">Nothing to arrange yet. Pick subjects for this {terms.batch}, or assign lectures or questions, and their chapters show up here.</p>
      ) : preview ? (
        <StudentPreview draft={draft} chapterById={chapterById} subjectById={subjectById} ungroupedIn={ungroupedIn} />
      ) : (
        <>
          {/* ---------------- groups ---------------- */}
          <div className="stack" style={{ gap: 12 }}>
            {draft.groups.map((g, gi) => {
              const addable = draft.subjects.filter((s) => ungroupedIn(s).length > 0);
              return (
                <div key={g.key} className="card stack" style={{ gap: 8 }}>
                  <div className="spread" style={{ flexWrap: "wrap" }}>
                    {naming?.key === g.key ? (
                      <NameForm naming={naming} setNaming={setNaming} onSubmit={submitName} />
                    ) : (
                      <div className="row-tight">
                        <FolderOpen size={16} style={{ color: "var(--primary)" }} />
                        <h3 style={{ margin: 0 }}>{g.name}</h3>
                        <span className="pill tnum small">{count(g.chapters.length, "chapter")}</span>
                      </div>
                    )}
                    <div className="row-tight">
                      {addable.length > 0 && (
                        <select className="pill pill-btn" value="" onChange={(e) => e.target.value && addSubjectToGroup(g.key, e.target.value)} style={{ maxWidth: 190 }}>
                          <option value="">Add a subject's chapters…</option>
                          {addable.map((s) => <option key={s} value={s}>{subjectById.get(s)?.title}</option>)}
                        </select>
                      )}
                      <button type="button" className="icon-btn" title="Move group up" disabled={gi === 0} onClick={() => nudgeGroup(gi, -1)}><ChevronUp size={15} /></button>
                      <button type="button" className="icon-btn" title="Move group down" disabled={gi === draft.groups.length - 1} onClick={() => nudgeGroup(gi, 1)}><ChevronDown size={15} /></button>
                      <button type="button" className="icon-btn" title="Rename group" onClick={() => setNaming({ key: g.key, value: g.name })}><Pencil size={14} /></button>
                      <button type="button" className="icon-btn icon-btn-danger" title="Remove group (its chapters stay, ungrouped)" onClick={() => removeGroup(g.key)}><Trash2 size={14} /></button>
                    </div>
                  </div>
                  <div className="stack" style={{ gap: 6 }} {...dropProps(g.key)}>
                    {g.chapters.map((id, i) => (
                      chapterRow({ chapterId: id, groupKey: g.key, index: i, total: g.chapters.length, showSubject: draft.subjects.length > 1 })
                    ))}
                    {endDrop({ groupKey: g.key, label: g.chapters.length ? "" : "Drag chapters here, use “Move to”, or add a subject's chapters." })}
                  </div>
                </div>
              );
            })}

            {naming && !naming.key ? (
              <div className="card"><NameForm naming={naming} setNaming={setNaming} onSubmit={submitName} placeholder="Group name, like Paper 1 or Term 1" /></div>
            ) : (
              <button type="button" className="btn btn-sm btn-quiet" style={{ alignSelf: "flex-start" }} onClick={() => setNaming({ key: null, value: "" })}>
                <Plus size={13} /> New group
              </button>
            )}
          </div>

          {/* ---------------- ungrouped, by subject ---------------- */}
          {subjectsWithUngrouped.length > 0 && (
            <div className="stack" style={{ gap: 12 }}>
              {draft.groups.length > 0 && <h3 style={{ margin: "8px 0 0" }}>Not in a group</h3>}
              {draft.subjects.map((s, si) => {
                const ids = ungroupedIn(s);
                if (!ids.length) return null;
                return (
                  <div key={s} className="card stack" style={{ gap: 8 }}>
                    <div className="spread">
                      <h3 style={{ margin: 0 }}>{subjectById.get(s)?.title}</h3>
                      {draft.subjects.length > 1 && (
                        <div className="row-tight">
                          <button type="button" className="icon-btn" title="Move subject up" disabled={si === 0} onClick={() => nudgeSubject(si, -1)}><ChevronUp size={15} /></button>
                          <button type="button" className="icon-btn" title="Move subject down" disabled={si === draft.subjects.length - 1} onClick={() => nudgeSubject(si, 1)}><ChevronDown size={15} /></button>
                        </div>
                      )}
                    </div>
                    <div className="stack" style={{ gap: 6 }}>
                      {ids.map((id, i) => (
                        chapterRow({ chapterId: id, groupKey: UNGROUPED, index: i, total: ids.length })
                      ))}
                    </div>
                  </div>
                );
              })}
              {dragging && groupOf(dragging) !== UNGROUPED && endDrop({ groupKey: UNGROUPED })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function NameForm({ naming, setNaming, onSubmit, placeholder }) {
  return (
    <form className="row-tight grow" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
      <input
        className="input"
        autoFocus
        maxLength={60}
        placeholder={placeholder || "Group name"}
        value={naming.value}
        onChange={(e) => setNaming({ ...naming, value: e.target.value })}
        onKeyDown={(e) => { if (e.key === "Escape") setNaming(null); }}
        style={{ maxWidth: 320 }}
      />
      <button type="submit" className="icon-btn" title="Save name" disabled={!naming.value.trim()}><Check size={15} /></button>
      <button type="button" className="icon-btn" title="Cancel" onClick={() => setNaming(null)}><X size={15} /></button>
    </form>
  );
}

function ChildList({ label, empty, items, render, onMove }) {
  return (
    <div className="stack" style={{ gap: 4 }}>
      <span className="label">{label}</span>
      {items.length === 0 ? (
        <span className="hint">{empty}</span>
      ) : items.map((item, i) => (
        <div key={item._id} className="row-tight" style={{ padding: "3px 0", borderBottom: "1px solid var(--border)" }}>
          <span className="muted tnum small" style={{ width: 18, textAlign: "right" }}>{i + 1}</span>
          {render(item)}
          <button type="button" className="icon-btn" title="Move up" disabled={i === 0} onClick={() => onMove(i, -1)}><ChevronUp size={14} /></button>
          <button type="button" className="icon-btn" title="Move down" disabled={i === items.length - 1} onClick={() => onMove(i, 1)}><ChevronDown size={14} /></button>
        </div>
      ))}
    </div>
  );
}

// Roughly what a student's lecture and practice lists look like with this
// draft: group headers, then chapters, each with its topics and lectures.
function StudentPreview({ draft, chapterById, subjectById, ungroupedIn }) {
  const sections = [
    ...draft.groups.map((g) => ({ key: g.key, title: g.name, chapters: g.chapters })),
    ...draft.subjects.map((s) => ({ key: s, title: subjectById.get(s)?.title, chapters: ungroupedIn(s), subject: true })),
  ].filter((s) => s.chapters.length);
  let n = 0;
  return (
    <div className="card stack" style={{ gap: 14, maxWidth: 560 }}>
      {sections.map((s) => (
        <div key={s.key} className="stack" style={{ gap: 6 }}>
          <span className={s.subject ? "label" : "pill pill-on"} style={{ alignSelf: "flex-start" }}>{s.title}</span>
          {s.chapters.map((id) => {
            const c = chapterById.get(id);
            if (!c) return null;
            const lectures = (draft.lectures[id] || []).map((lid) => c.lectures.find((l) => l._id === lid)).filter((l) => l?.isPublished);
            const topics = (draft.topics[id] || []).map((tid) => c.topics.find((t) => t._id === tid)).filter((t) => t && (t.questions || t.archive));
            return (
              <div key={id} style={{ paddingLeft: 8, borderLeft: "2px solid var(--border)" }}>
                <strong style={{ fontWeight: 600 }}>{c.title}</strong>
                {lectures.map((l) => (
                  <div key={l._id} className="row-tight small" style={{ paddingLeft: 10 }}>
                    <span className="muted tnum">{(n += 1)}.</span> <PlayCircle size={12} /> {l.title}
                  </div>
                ))}
                {topics.length > 0 && <div className="hint" style={{ paddingLeft: 10 }}>Practice: {topics.map((t) => t.title).join(" · ")}</div>}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
