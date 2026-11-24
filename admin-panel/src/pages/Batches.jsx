import { useState } from "react";
import { Link } from "react-router-dom";
import {
  useGetProgramsQuery,
  useCreateProgramMutation,
  useUpdateProgramMutation,
  useReorderProgramsMutation,
  useDeleteProgramMutation,
  useGetBatchesQuery,
  useCreateBatchMutation,
  useReorderBatchesMutation,
  useGetSubjectsQuery,
} from "../api/contentApi";
import { useOutletContext } from "react-router-dom";
import { Plus, GraduationCap, ChevronRight, Gift, Tag, PauseCircle, Pencil, Check, X, ChevronUp, ChevronDown, Trash2 } from "lucide-react";
import { Loading, ErrorNote, Empty, Field, TeacherLocked, useConfirm, Pager, pageSlice } from "../components/bits";
import IconPicker from "../components/IconPicker";
import { ImagePicker } from "../components/MediaPickers";
import MarkdownEditor from "../components/MarkdownEditor";
import AiWrite, { AiTranslate } from "../components/AiWrite";
import BatchIcon, { DEFAULT_ICON } from "../components/BatchIcon";
import { useTerms } from "../terms";
import { StatusStrip, ViewToggle, useViewMode, SearchBox } from "../components/ListTools";

const BATCH_STATUS = {
  active: (b) => b.isActive,
  inactive: (b) => !b.isActive,
  free: (b) => b.accessType === "free",
  paid: (b) => b.accessType !== "free",
};

export default function Batches() {
  const terms = useTerms();
  const { can } = useOutletContext();
  const programs = useGetProgramsQuery({ includeInactive: "true" });
  const batches = useGetBatchesQuery({ includeInactive: "true" });
  const { data: subjects } = useGetSubjectsQuery();
  const [createProgram, programState] = useCreateProgramMutation();
  const [updateProgram, updateProgramState] = useUpdateProgramMutation();
  const [reorderPrograms] = useReorderProgramsMutation();
  const [deleteProgram, deleteProgramState] = useDeleteProgramMutation();
  const confirm = useConfirm();
  const [createBatch, batchState] = useCreateBatchMutation();
  const [reorderBatches] = useReorderBatchesMutation();

  const [newProgram, setNewProgram] = useState(null);
  const [newBatch, setNewBatch] = useState(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [view, setView] = useViewMode("batches", "list");
  const [page, setPage] = useState(1);
  // Batches of each program, a page at a time (by program id).
  const [batchPage, setBatchPage] = useState({});
  // Holds a draft for whichever program is being edited — title,
  // description (markdown, in the same editor as Notices), and a catalogue cover image. There was no way to set either
  // of the last two at all before this, only at creation could you even
  // set a title.
  const [editingProgram, setEditingProgram] = useState(null);

  if (programs.isLoading) return <Loading />;

  const startEditProgram = (program) => {
    setEditingProgram({
      _id: program._id,
      title: program.title,
      description: program.description || "",
      image: program.image?._id || null,
      imageUrl: program.image?.url || null,
      isActive: program.isActive,
    });
  };

  const saveProgram = async () => {
    try {
      await updateProgram({
        id: editingProgram._id,
        title: editingProgram.title,
        description: editingProgram.description,
        image: editingProgram.image,
        isActive: editingProgram.isActive,
      }).unwrap();
      setEditingProgram(null);
    } catch {
      // rendered below via ErrorNote
    }
  };

  const submitProgram = async (event) => {
    event.preventDefault();
    await createProgram({ title: newProgram, isActive: true });
    setNewProgram(null);
  };

  const submitBatch = async (event) => {
    event.preventDefault();
    try {
      await createBatch({
        name: newBatch.name,
        program: newBatch.program,
        subjects: newBatch.subjects,
        accessType: newBatch.accessType,
        icon: newBatch.icon,
        isActive: true,
      }).unwrap();
      setNewBatch(null);
    } catch {
      // rendered below
    }
  };

  const q = search.trim().toLowerCase();
  // Already sorted order-then-name by the backend, so this is the program's
  // current display order — what reordering swaps adjacent entries within.
  const byProgramUnfiltered = (programId) =>
    (batches.data || []).filter((b) => (b.program?._id || b.program) === programId);
  const byProgram = (programId) =>
    byProgramUnfiltered(programId)
      .filter((b) => !q || b.name.toLowerCase().includes(q))
      .filter((b) => !status || BATCH_STATUS[status](b));
  const narrowed = Boolean(q || status);
  const allBatches = batches.data || [];
  const countOf = (key) => allBatches.filter(BATCH_STATUS[key]).length;

  // Reordering swaps within the program's full list, not the (possibly
  // search-narrowed) one on screen — moving a filtered row would silently
  // jump it past batches the search is hiding.
  const moveBatch = (programId, batchId, direction) => {
    const siblings = byProgramUnfiltered(programId);
    const from = siblings.findIndex((b) => b._id === batchId);
    const to = from + direction;
    if (from === -1 || to < 0 || to >= siblings.length) return;
    const reordered = [...siblings];
    [reordered[from], reordered[to]] = [reordered[to], reordered[from]];
    reorderBatches({ program: programId, ids: reordered.map((b) => b._id) });
  };

  const moveProgram = (fromIndex, toIndex) => {
    const current = programs.data || [];
    if (fromIndex === toIndex || !can("managePrograms")) return;
    const reordered = [...current];
    const [removed] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, removed);
    reorderPrograms({ ids: reordered.map((p) => p._id) });
  };

  const programsShown = pageSlice(programs.data, page, 10);

  return (
    <div className="page">
      <div className="page-head spread">
        <div>
          <h1>{terms.Batches}</h1>
          <p className="muted small" style={{ margin: "2px 0 0" }}>
            A batch is what a student joins. Content is assigned to it.
          </p>
        </div>
        {can("managePrograms") && (
          <button className="btn" onClick={() => setNewProgram("")}>
            <Plus size={15} /> New program
          </button>
        )}
      </div>

      <div className="stack">
        <ErrorNote error={programs.error || batches.error || programState.error || batchState.error || updateProgramState.error || deleteProgramState.error} />

        <StatusStrip
          value={status}
          onChange={(v) => { setStatus(v); setBatchPage({}); }}
          items={[
            { key: "", label: `All ${terms.batches}`, count: allBatches.length },
            { key: "active", label: "Active", count: countOf("active"), tone: "ok" },
            { key: "inactive", label: "Inactive", count: countOf("inactive"), tone: countOf("inactive") ? "warn" : undefined },
            { key: "free", label: "Free", count: countOf("free") },
            { key: "paid", label: "Paid", count: countOf("paid") },
          ]}
        />

        <div className="row-tight" style={{ gap: 8 }}>
          <SearchBox
            value={search}
            onChange={(v) => { setSearch(v); setBatchPage({}); }}
            onSubmit={() => {}}
            placeholder={`Search ${terms.batches} by name`}
          />
          <ViewToggle value={view} onChange={setView} />
        </div>

        {newProgram !== null && (
          <form className="card row-tight" onSubmit={submitProgram}>
            <input
              className="input"
              autoFocus
              placeholder={`${terms.Program} name, like Year 12 Sciences`}
              value={newProgram}
              onChange={(e) => setNewProgram(e.target.value)}
            />
            <button className="btn btn-sm">Add</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setNewProgram(null)}>
              Cancel
            </button>
          </form>
        )}

        {programs.data?.length === 0 && newProgram === null && (
          <Empty
            icon={GraduationCap}
            title={`No ${terms.programs} yet`}
            hint={`${terms.Programs} group your ${terms.batches}. Most installs need one or two.`}
            action={
              can("managePrograms")
                ? <button className="btn" onClick={() => setNewProgram("")}><Plus size={15} /> New {terms.program}</button>
                : <TeacherLocked what={`${terms.Programs} and ${terms.batches}`} />
            }
          />
        )}

        {programsShown.items.map((program, i) => {
          const programIndex = programsShown.start + i;
          const batchesShown = pageSlice(byProgram(program._id), batchPage[program._id], 20);
          return (
          <div className="card stack" key={program._id}>
            <div className="spread">
              <div className="row-tight">
                <h2>{program.title}</h2>
                {can("managePrograms") && (
                  <button
                    className="icon-btn"
                    title={`Edit ${terms.program}`}
                    onClick={() => startEditProgram(program)}
                  >
                    <Pencil size={13} />
                  </button>
                )}
                {!program.isActive && (
                  <span className="pill pill-warn row-tight" style={{ gap: 4 }}>
                    <PauseCircle size={11} /> Inactive
                  </span>
                )}
              </div>
              {can("manageBatches") && (
              <button
                className="btn btn-sm btn-quiet"
                onClick={() =>
                  setNewBatch({
                    program: program._id,
                    name: "",
                    subjects: [],
                    accessType: "paid",
                    icon: { kind: "preset", value: "GraduationCap" },
                  })
                }
               >
                <Plus size={13} /> Add batch
              </button>
            )}
            {can("managePrograms") && (programs.data || []).length > 1 && !q && (
              <div className="row-tight" style={{ gap: 2, marginLeft: 8 }}>
                <button
                  type="button"
                  className="icon-btn"
                  title={`Move ${terms.program} up`}
                  disabled={programIndex === 0}
                  onClick={() => moveProgram(programIndex, programIndex - 1)}
                >
                  <ChevronUp size={14} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  title={`Move ${terms.program} down`}
                  disabled={programIndex === (programs.data || []).length - 1}
                  onClick={() => moveProgram(programIndex, programIndex + 1)}
                >
                  <ChevronDown size={14} />
                </button>
              </div>
            )}
          </div>

            {editingProgram?._id === program._id && (
              <form
                className="card-quiet stack"
                onSubmit={(e) => { e.preventDefault(); saveProgram(); }}
              >
                <Field label={`${terms.Program} title`}>
                  <input
                    className="input"
                    autoFocus
                    value={editingProgram.title}
                    onChange={(e) => setEditingProgram({ ...editingProgram, title: e.target.value })}
                  />
                </Field>

                <div className="field">
                  <span className="label">Catalogue cover image</span>
                  <p className="hint" style={{ margin: "0 0 6px" }}>
                    Shown on the course catalogue card and its "view more"
                    details. A themed placeholder takes its place if you skip
                    this — separate from the small icon used elsewhere.
                  </p>
                  <ImagePicker
                    folder="programs"
                    label="Cover image"
                    ai="picture"
                    aiPurpose="course"
                    aiContext={editingProgram.title}
                    value={editingProgram.image}
                    url={editingProgram.imageUrl}
                    onChange={(id, url) => setEditingProgram({ ...editingProgram, image: id, imageUrl: url })}
                  />
                </div>

                <MarkdownEditor
                  label="Description"
                  value={editingProgram.description}
                  onChange={(v) => setEditingProgram({ ...editingProgram, description: v })}
                  minHeight={110}
                  mono={false}
                  placeholder="What this program covers, who it's for, what's included…"
                  hint={'Shown in the course catalogue\'s "view more" modal, above each of this program\'s batches.'}
                  actions={(
                    <>
                      <AiWrite
                        task="courseDescription"
                        input={{ kind: "program", id: program._id }}
                        prompt="optional"
                        promptLabel="Anything to add? Who it's for, exam year, what makes it different"
                        placeholder="e.g. For HSC 2027 science students. Bangla medium."
                        title="Write it from this program's batches: their subjects, lectures, exams and practice"
                        onResult={(d) => setEditingProgram({ ...editingProgram, description: d.description })}
                      />
                      <AiTranslate value={editingProgram.description} onChange={(v) => setEditingProgram({ ...editingProgram, description: v })} />
                    </>
                  )}
                />

                <label className="row-tight" style={{ cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={editingProgram.isActive}
                    onChange={(e) => setEditingProgram({ ...editingProgram, isActive: e.target.checked })}
                  />
                  Active — visible to students in the course catalogue
                </label>

                <div className="row">
                  <button className="btn btn-sm" disabled={!editingProgram.title || updateProgramState.isLoading}>
                    <Check size={14} /> {updateProgramState.isLoading ? "Saving" : "Save"}
                  </button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditingProgram(null)}>
                    <X size={14} /> Cancel
                  </button>
                  {/* Only an empty program can go: deleting batches would cut
                      off students who paid for them (programController.js). */}
                  <button
                    type="button"
                    className="btn btn-sm btn-quiet"
                    style={{ marginLeft: "auto", color: "var(--danger, #c0392b)" }}
                    disabled={byProgramUnfiltered(program._id).length > 0 || deleteProgramState.isLoading}
                    title={byProgramUnfiltered(program._id).length > 0 ? "Move or delete this program's batches first" : `Delete this ${terms.program}`}
                    onClick={async () => {
                      const ok = await confirm({
                        title: `Delete ${program.title}?`,
                        body: "The program is removed. This can't be undone.",
                        confirmLabel: "Delete",
                        tone: "danger",
                      });
                      if (!ok) return;
                      const r = await deleteProgram(program._id);
                      if (!r.error) setEditingProgram(null);
                    }}
                  >
                    <Trash2 size={14} /> Delete program
                  </button>
                </div>
                {byProgramUnfiltered(program._id).length > 0 && (
                  <span className="hint">
                    To delete this program, move or delete its {byProgramUnfiltered(program._id).length} batch{byProgramUnfiltered(program._id).length === 1 ? "" : "es"} first, or untick Active to hide it.
                  </span>
                )}
              </form>
            )}

            {newBatch?.program === program._id && (
              <form className="card-quiet stack" onSubmit={submitBatch}>
                <IconPicker
                  currentIcon={newBatch.icon}
                  isDefault={newBatch.icon?.kind === "preset" && (newBatch.icon?.value || DEFAULT_ICON) === DEFAULT_ICON}
                  onPickPreset={(value) => setNewBatch({ ...newBatch, icon: { kind: "preset", value } })}
                  onReset={() => setNewBatch({ ...newBatch, icon: { kind: "preset", value: DEFAULT_ICON } })}
                />

                <Field label={`${terms.Batch} name`}>
                  <input
                    className="input"
                    autoFocus
                    placeholder="Physics — Year 12"
                    value={newBatch.name}
                    onChange={(e) => setNewBatch({ ...newBatch, name: e.target.value })}
                  />
                </Field>

                <div className="field">
                  <span className="label">Subjects</span>
                  <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
                    {(subjects || []).map((subject) => {
                      const on = newBatch.subjects.includes(subject._id);
                      return (
                        <button
                          key={subject._id}
                          type="button"
                          className={`pill pill-btn${on ? " pill-on" : ""}`}
                          onClick={() =>
                            setNewBatch({
                              ...newBatch,
                              subjects: on
                                ? newBatch.subjects.filter((s) => s !== subject._id)
                                : [...newBatch.subjects, subject._id],
                            })
                          }
                        >
                          {subject.title}
                        </button>
                      );
                    })}
                  </div>
                  <span className="hint">
                    Used to filter the content picker. It does not decide what students see.
                  </span>
                </div>

                <div className="field">
                  <span className="label">Access</span>
                  <div className="row-tight">
                    {[["paid", "Paid"], ["free", "Free for everyone"]].map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        className={`pill pill-btn${newBatch.accessType === value ? " pill-on" : ""}`}
                        onClick={() => setNewBatch({ ...newBatch, accessType: value })}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="row">
                  <button className="btn btn-sm" disabled={!newBatch.name}>Create {terms.batch}</button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setNewBatch(null)}>
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {byProgram(program._id).length === 0 ? (
              <p className="hint" style={{ margin: 0 }}>
                {narrowed ? `No ${terms.batches} match.` : `No ${terms.batches} in this ${terms.program} yet.`}
              </p>
            ) : (
              <div className="stack" style={{ gap: 8 }}>
                <div style={view === "grid" ? { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 10 } : { display: "flex", flexDirection: "column", gap: 8 }}>
                {batchesShown.items.map((batch) => {
                  const activePlans = (batch.plans || []).filter((p) => p.isActive !== false);
                  const startingPrice = activePlans.length > 0
                    ? Math.min(...activePlans.map((p) => p.price))
                    : null;
                  const orderedSiblings = byProgramUnfiltered(program._id);
                  const siblingIndex = orderedSiblings.findIndex((b) => b._id === batch._id);
                  return (
                  <Link className={`card-quiet batch-row${view === "grid" ? " batch-tile" : " spread"}`} key={batch._id} to={`/batches/${batch._id}`}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                      background: "var(--surface)", display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <BatchIcon icon={batch.icon} size={18} />
                    </div>
                    <div className="grow">
                      <div className="row-tight" style={{ marginBottom: 4, flexWrap: "wrap" }}>
                        {batch.accessType === "free" ? (
                          <span className="pill pill-ok row-tight" style={{ gap: 4 }}>
                            <Gift size={11} /> Free
                          </span>
                        ) : (
                          <span className="pill row-tight tnum" style={{ gap: 4 }}>
                            <Tag size={11} />
                            {batch.plans?.length || 0} plan{batch.plans?.length === 1 ? "" : "s"}
                            {startingPrice !== null && ` · from ${startingPrice}`}
                          </span>
                        )}
                        {!batch.isActive && (
                          <span className="pill pill-warn row-tight" style={{ gap: 4 }}>
                            <PauseCircle size={11} /> Inactive
                          </span>
                        )}
                      </div>
                      <strong style={{ fontWeight: 500 }}>{batch.name}</strong>
                      {batch.subjects?.length > 0 && (
                        <div className="muted small" style={{ marginTop: 3 }}>
                          {batch.subjects.map((s) => s.title || s).join(", ")}
                        </div>
                      )}
                    </div>
                    {can("manageBatches") && !narrowed && view === "list" && orderedSiblings.length > 1 && (
                      <div
                        className="row-tight row-hover-actions"
                        style={{ gap: 2 }}
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                      >
                        <button
                          type="button"
                          className="icon-btn"
                          title="Move up"
                          disabled={siblingIndex === 0}
                          onClick={() => moveBatch(program._id, batch._id, -1)}
                        >
                          <ChevronUp size={14} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          title="Move down"
                          disabled={siblingIndex === orderedSiblings.length - 1}
                          onClick={() => moveBatch(program._id, batch._id, 1)}
                        >
                          <ChevronDown size={14} />
                        </button>
                      </div>
                    )}
                    {view === "list" && <ChevronRight size={16} className="muted" />}
                  </Link>
                  );
                })}
                </div>
                <Pager page={batchesShown.page} pages={batchesShown.pages} total={batchesShown.total}
                  onChange={(p) => setBatchPage({ ...batchPage, [program._id]: p })} />
              </div>
            )}
          </div>
          );
        })}
        <Pager page={programsShown.page} pages={programsShown.pages} total={programsShown.total} onChange={setPage} />
      </div>
    </div>
  );
}
