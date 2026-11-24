import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Presentation, Plus, Play, Copy, Trash2, Pencil } from "lucide-react";
import { useGetSlideDecksQuery, useCreateSlideDeckMutation, useDuplicateSlideDeckMutation, useDeleteSlideDeckMutation } from "../api/slideApi";
import { Loading, ErrorNote, Empty, useConfirm } from "./bits";
import { FitSlide } from "./SlideView";
import { StatusStrip, ViewToggle, useViewMode, SearchBox } from "./ListTools";

const STATUS = {
  shown: (d) => d.published,
  hidden: (d) => !d.published,
  empty: (d) => !d.count,
};

// Batch → Slides: the batch's lecture decks (pages/SlideEditor.jsx).
export default function BatchSlides({ batchId }) {
  const nav = useNavigate();
  const confirm = useConfirm();
  const { data: decks, isLoading, error } = useGetSlideDecksQuery(batchId);
  const [create, creating] = useCreateSlideDeckMutation();
  const [duplicate] = useDuplicateSlideDeckMutation();
  const [remove] = useDeleteSlideDeckMutation();
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [view, setView] = useViewMode("slides");

  const newDeck = async () => {
    const r = await create({ batch: batchId });
    if (r.data?._id) nav(`/slides/${r.data._id}`);
  };
  const del = async (d) => {
    if (await confirm({ title: `Delete "${d.title}"?`, body: "Its slides and notes are deleted for good.", confirmLabel: "Delete" })) remove(d._id);
  };
  const present = (d) => window.open(`${import.meta.env.BASE_URL}slides/${d._id}/present`, "_blank");

  if (isLoading) return <Loading />;
  const all = decks || [];
  const q = search.trim().toLowerCase();
  const shown = all
    .filter((d) => !status || STATUS[status](d))
    .filter((d) => !q || (d.title || "").toLowerCase().includes(q));
  const count = (key) => all.filter(STATUS[key]).length;

  const actions = (d) => (
    <>
      {d.count > 0 && <button type="button" className="icon-btn" title="Present" onClick={(e) => { e.stopPropagation(); present(d); }}><Play size={14} /></button>}
      <button type="button" className="icon-btn" title="Edit" onClick={(e) => { e.stopPropagation(); nav(`/slides/${d._id}`); }}><Pencil size={14} /></button>
      <button type="button" className="icon-btn" title="Duplicate" onClick={(e) => { e.stopPropagation(); duplicate(d._id); }}><Copy size={14} /></button>
      <button type="button" className="icon-btn icon-btn-danger" title="Delete" onClick={(e) => { e.stopPropagation(); del(d); }}><Trash2 size={14} /></button>
    </>
  );

  return (
    <div className="stack">
      <div className="spread">
        <div className="row-tight"><Presentation size={17} className="muted" /><h2>Lecture slides</h2></div>
        <button type="button" className="btn btn-sm" disabled={creating.isLoading} onClick={newDeck}><Plus size={14} /> New deck</button>
      </div>
      <ErrorNote error={error || creating.error} />
      {!all.length ? (
        <Empty icon={Presentation} title="No decks yet" hint="Make slides from a chapter's lectures and questions, or your own notes." />
      ) : (
        <>
          <StatusStrip
            value={status}
            onChange={setStatus}
            items={[
              { key: "", label: "All decks", count: all.length },
              { key: "shown", label: "Shown to students", count: count("shown"), tone: "ok" },
              { key: "hidden", label: "Not shown", count: count("hidden") },
              { key: "empty", label: "No slides yet", count: count("empty"), tone: count("empty") ? "warn" : undefined },
            ]}
          />
          <div className="row-tight" style={{ gap: 8 }}>
            <SearchBox value={search} onChange={setSearch} onSubmit={() => {}} placeholder="Search decks by title" />
            <ViewToggle value={view} onChange={setView} />
          </div>
          {!shown.length && <p className="hint" style={{ margin: 0 }}>No decks match.</p>}
          {view === "grid" ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 14 }}>
              {shown.map((d) => (
                <div key={d._id} className="card pool-card" tabIndex={0} onClick={() => nav(`/slides/${d._id}`)} onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && nav(`/slides/${d._id}`)}>
                  <div style={{ borderBottom: "1px solid var(--border)" }}>
                    {d.first ? <FitSlide deck={d} slide={{ bullets: [], left: [], right: [], ...d.first }} total={0} /> : (
                      <div className="thumb-169"><Presentation size={30} strokeWidth={1.5} /></div>
                    )}
                  </div>
                  <div className="pool-actions">{actions(d)}</div>
                  <div className="pool-card-body">
                    <div className="clamp-2" style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.35 }}>{d.title}</div>
                    <div className="row-tight spread" style={{ gap: 6 }}>
                      <span className="muted small tnum">{d.count} slide{d.count === 1 ? "" : "s"} · {new Date(d.updatedAt).toLocaleDateString()}</span>
                      {d.published ? <span className="pill pill-ok">Shown</span> : <span className="pill">Hidden</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="list">
              {shown.map((d) => (
                <div key={d._id} className="list-row" style={{ cursor: "pointer" }} onClick={() => nav(`/slides/${d._id}`)}>
                  <Presentation size={16} className="muted" style={{ flexShrink: 0 }} />
                  <div className="grow">
                    <div style={{ fontWeight: 500 }}>{d.title}</div>
                    <div className="muted small tnum">{d.count} slide{d.count === 1 ? "" : "s"} · {new Date(d.updatedAt).toLocaleDateString()}</div>
                  </div>
                  {d.published ? <span className="pill pill-ok">Shown</span> : <span className="pill">Hidden</span>}
                  <span className="row-tight" style={{ gap: 2 }}>{actions(d)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
