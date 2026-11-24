import { useState } from "react";
import { Plus, Trash2, Pencil, Megaphone, ExternalLink, Check, X } from "lucide-react";
import {
  useGetUpdatesQuery, useCreateUpdateItemMutation, useUpdateUpdateItemMutation, useDeleteUpdateItemMutation,
} from "../api/contentApi";
import { Loading, ErrorNote, Empty, Field, useConfirm, Pager } from "../components/bits";

const emptyDraft = () => ({ title: "", body: "", link: "", isActive: true });

// The content behind the landing page's "Updates" section (see
// LandingPage.jsx) — a growing list an admin adds to over time, unlike
// every other section's content which is a single fixed blob of text.
// Reached from there rather than getting its own nav entry, since it only
// ever matters in the context of that one section.
export default function Updates() {
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useGetUpdatesQuery({ page });
  const [create, { isLoading: creating, error: createError }] = useCreateUpdateItemMutation();
  const [update, { isLoading: saving, error: saveError }] = useUpdateUpdateItemMutation();
  const [remove] = useDeleteUpdateItemMutation();
  const confirm = useConfirm();

  const [editingId, setEditingId] = useState(null); // null | "new" | an _id
  const [draft, setDraft] = useState(emptyDraft());

  const updates = data?.updates || [];

  const startNew = () => { setDraft(emptyDraft()); setEditingId("new"); };
  const startEdit = (u) => {
    setDraft({ title: u.title, body: u.body || "", link: u.link || "", isActive: u.isActive });
    setEditingId(u._id);
  };
  const cancel = () => setEditingId(null);

  const save = async () => {
    if (!draft.title.trim()) return;
    const body = { ...draft, link: draft.link.trim() || null };
    if (editingId === "new") await create(body).unwrap();
    else await update({ id: editingId, ...body }).unwrap();
    setEditingId(null);
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Updates</h1>
        <button className="btn" onClick={startNew}><Plus size={15} /> New update</button>
      </div>

      <ErrorNote error={error} />

      {editingId && (
        <div className="card stack" style={{ marginBottom: 16 }}>
          <div className="row-tight"><h2 style={{ fontSize: 15 }}>{editingId === "new" ? "New update" : "Edit update"}</h2></div>
          <ErrorNote error={createError || saveError} />
          <Field label="Title">
            <input className="input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </Field>
          <Field label="Body" hint="Optional. A short line or two — this is an announcement, not an article.">
            <textarea className="textarea" rows={3} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
          </Field>
          <Field label="Link" hint="Optional. Where 'read more' goes, if anywhere.">
            <input className="input" value={draft.link} onChange={(e) => setDraft({ ...draft, link: e.target.value })} placeholder="https://…" />
          </Field>
          <label className="row-tight small" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} />
            Visible on the landing page
          </label>
          <div className="row-tight">
            <button className="btn" disabled={!draft.title.trim() || creating || saving} onClick={save}>
              <Check size={14} /> Save
            </button>
            <button className="btn btn-quiet" onClick={cancel}><X size={14} /> Cancel</button>
          </div>
        </div>
      )}

      {isLoading ? (
        <Loading />
      ) : updates.length === 0 ? (
        <Empty icon={Megaphone} title="No updates yet" description="Announcements posted here can show in the landing page's Updates section." />
      ) : (
        <div className="card stack" style={{ gap: 0 }}>
          {updates.map((u) => (
            <div key={u._id} className="spread" style={{ padding: "12px 0", borderTop: "1px solid var(--border)" }}>
              <div className="grow">
                <div className="row-tight" style={{ marginBottom: 2, flexWrap: "wrap" }}>
                  <strong className="small">{u.title}</strong>
                  {!u.isActive && <span className="pill">Hidden</span>}
                  {u.link && <ExternalLink size={12} className="muted" />}
                </div>
                {u.body && <div className="muted small">{u.body}</div>}
                <div className="muted small">{new Date(u.publishedAt).toLocaleDateString()}</div>
              </div>
              <div className="row-tight">
                <button className="icon-btn" title="Edit" onClick={() => startEdit(u)}><Pencil size={14} /></button>
                <button
                  className="icon-btn icon-btn-danger"
                  title="Delete"
                  onClick={async () => {
                    const yes = await confirm({ title: `Delete "${u.title}"?`, body: "This cannot be undone.", confirmLabel: "Delete" });
                    if (yes) remove(u._id);
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
          <Pager page={data?.page || 1} pages={data?.pages || 1} total={data?.total || 0} onChange={setPage} />
        </div>
      )}
    </div>
  );
}
