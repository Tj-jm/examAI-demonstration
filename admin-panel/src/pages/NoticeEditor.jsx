import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  useGetNoticeQuery, useCreateNoticeMutation, useUpdateNoticeMutation, useGetBatchesQuery,
  useUploadMediaMutation,
} from "../api/contentApi";
import { ArrowLeft, Globe, Users, Send } from "lucide-react";
import { Loading, ErrorNote, Field } from "../components/bits";
import { ImagePicker } from "../components/MediaPickers";
import IconPicker from "../components/IconPicker";
import BatchIcon from "../components/BatchIcon";
import MarkdownEditor from "../components/MarkdownEditor";
import AiWrite, { AiTranslate } from "../components/AiWrite";
import { useTerms } from "../terms";
import { SaveBar, useCtrlS, useUnsaved, sameWork } from "../components/ListTools";

const emptyDraft = () => ({
  title: "",
  bodyMarkdown: "",
  noticeType: "general",
  batches: [],
  coverImage: null,
  coverImageUrl: null,
  icon: { kind: "preset", value: null },
  link: "",
  linkLabel: "",
  pushText: "",
  featured: false,
  isPublished: false,
  publishFrom: "",
  publishUntil: "",
});

// datetime-local wants "YYYY-MM-DDTHH:mm" in local time, not an ISO string
// with a Z on the end — converting straight with toISOString() would show
// the wrong time to anyone not in UTC.
const toLocalInput = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const BODY_PLACEHOLDER =
  "## Exam schedule moved\n\nThe midterm has been pushed to **Friday, 10am**. Bring a calculator.";

// One route for both jobs, same shape as LectureEditor and QuestionEditor —
// create and edit are different starting states of the same form.
export default function NoticeEditor() {
  const terms = useTerms();
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id;
  // "Send to notice" on a lecture or exam opens this with a draft filled in.
  const prefill = useLocation().state?.noticeDraft;

  const { data: existing, isLoading } = useGetNoticeQuery(id, { skip: isNew });
  const { data: batches } = useGetBatchesQuery({});
  const [create, { isLoading: creating, error: createError }] = useCreateNoticeMutation();
  const [update, { isLoading: updating, error: updateError }] = useUpdateNoticeMutation();
  const [uploadMedia, { isLoading: uploadingIcon }] = useUploadMediaMutation();

  const [draft, setDraft] = useState(isNew ? { ...emptyDraft(), ...(prefill || {}) } : null);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  // The draft as loaded, to tell whether anything changed.
  const [initial, setInitial] = useState(() => (isNew ? draft : null));

  useEffect(() => {
    if (!isNew && existing) {
      const loaded = {
        title: existing.title,
        bodyMarkdown: existing.bodyMarkdown || "",
        noticeType: existing.noticeType,
        batches: (existing.batches || []).map((b) => b._id || b),
        coverImage: existing.coverImage?._id || null,
        coverImageUrl: existing.coverImage?.url || null,
        icon: existing.icon || { kind: "preset", value: null },
        link: existing.link || "",
        linkLabel: existing.linkLabel || "",
        pushText: existing.pushText || "",
        featured: Boolean(existing.featured),
        isPublished: existing.isPublished,
        publishFrom: toLocalInput(existing.publishFrom),
        publishUntil: toLocalInput(existing.publishUntil),
      };
      setDraft(loaded);
      setInitial(loaded);
    }
  }, [isNew, existing]);

  const dirty = Boolean(draft && initial && !sameWork(draft, initial));
  const { leave, clear } = useUnsaved(dirty);
  const saveRef = useRef(null);
  useCtrlS(() => saveRef.current?.(), Boolean(draft));

  if (!isNew && isLoading) return <Loading />;
  if (!draft) return null;

  const set = (patch) => setDraft({ ...draft, ...patch });

  const toggleBatch = (batchId) => {
    const next = draft.batches.includes(batchId)
      ? draft.batches.filter((b) => b !== batchId)
      : [...draft.batches, batchId];
    set({ batches: next });
  };

  const valid =
    draft.title.trim() &&
    draft.bodyMarkdown.trim() &&
    (draft.noticeType === "general" || draft.batches.length > 0) &&
    Boolean(draft.link) === Boolean(draft.linkLabel);

  const save = async () => {
    const body = {
      title: draft.title.trim(),
      bodyMarkdown: draft.bodyMarkdown,
      noticeType: draft.noticeType,
      batches: draft.noticeType === "batch" ? draft.batches : [],
      coverImage: draft.coverImage,
      icon: draft.icon,
      link: draft.link || null,
      linkLabel: draft.linkLabel || null,
      pushText: draft.pushText.trim(),
      featured: draft.noticeType === "general" && draft.featured,
      isPublished: draft.isPublished,
      // Empty string means "cleared" — sent as null rather than dropped, so
      // clearing a previously-set schedule field actually clears it instead
      // of the update silently keeping the old value (pick() on the backend
      // only skips a field when it is undefined, not null or "").
      publishFrom: draft.publishFrom ? new Date(draft.publishFrom).toISOString() : null,
      publishUntil: draft.publishUntil ? new Date(draft.publishUntil).toISOString() : null,
    };

    const result = isNew ? await create(body) : await update({ id, ...body });
    if (!result.error) { clear(); navigate("/notices"); }
  };
  saveRef.current = () => { if (valid && !creating && !updating) save(); };

  return (
    <div className="page">
      <div className="page-head row-tight">
        <button className="icon-btn" onClick={() => leave("/notices")}><ArrowLeft size={18} /></button>
        <h1>{isNew ? "New notice" : "Edit notice"}</h1>
      </div>

      <div className="stack" style={{ maxWidth: 640 }}>
        <ErrorNote error={createError || updateError} />

        <div className="card stack">
          <AiWrite
            lead="Say what it's about and let AI draft the title, notice and phone line."
            task="notice"
            prompt="required"
            label="Write notice with AI"
            promptLabel="What is the notice about?"
            placeholder="e.g. Physics mock moved from Friday 10 am to Sunday 3 pm. Same syllabus."
            input={{ noticeType: draft.noticeType, batches: draft.noticeType === "batch" ? draft.batches : [] }}
            onResult={(d) => set({ title: d.title, bodyMarkdown: d.bodyMarkdown, pushText: d.pushText })}
          />
          <Field label="Title">
            <input
              className="input"
              autoFocus
              value={draft.title}
              onChange={(e) => set({ title: e.target.value })}
              placeholder="Exam schedule moved"
            />
            <div className="row-tight" style={{ justifyContent: "flex-end" }}><AiTranslate value={draft.title} onChange={(v) => set({ title: v })} /></div>
          </Field>

          <div className="field">
            <span className="label">Cover image</span>
            <p className="hint" style={{ margin: "0 0 6px" }}>
              Optional. Shown at the top of the card — a themed placeholder
              takes its place if you skip this.
            </p>
            <ImagePicker
              folder="notices"
              label="Cover image"
              ai="picture"
              aiPurpose="notice"
              aiContext={[draft.title, draft.bodyMarkdown].filter(Boolean).join(". ").slice(0, 400)}
              value={draft.coverImage}
              url={draft.coverImageUrl}
              onChange={(id, url) => set({ coverImage: id, coverImageUrl: url })}
            />
          </div>

          <MarkdownEditor
            label="Description"
            value={draft.bodyMarkdown}
            onChange={(v) => set({ bodyMarkdown: v })}
            minHeight={130}
            mono={false}
            placeholder={BODY_PLACEHOLDER}
            actions={<AiTranslate value={draft.bodyMarkdown} onChange={(v) => set({ bodyMarkdown: v })} />}
          />

          <div className="field">
            <div className="spread" style={{ flexWrap: "wrap", gap: 6 }}>
              <span className="label">Phone notification</span>
              <AiWrite
                task="pushLine"
                prompt="none"
                label="Write from notice"
                disabled={!draft.bodyMarkdown.trim()}
                title={draft.bodyMarkdown.trim() ? "One line with the key point" : "Write the notice first"}
                input={{ title: draft.title, body: draft.bodyMarkdown }}
                onResult={(d) => set({ pushText: d.pushText })}
              />
            </div>
            <input
              className="input"
              aria-label="Phone notification"
              maxLength={140}
              value={draft.pushText}
              placeholder="A new notice was posted."
              onChange={(e) => set({ pushText: e.target.value })}
            />
            <span className="hint">The line students see in the phone notification under the title. Empty: "A new notice was posted."</span>
          </div>
        </div>

        <div className="card stack">
          <div className="row-tight"><h2 style={{ fontSize: 15 }}>Who sees it</h2></div>

          <div className="row-tight">
            <button
              className={`pill pill-btn row-tight${draft.noticeType === "general" ? " pill-on" : ""}`}
              style={{ gap: 5 }}
              onClick={() => set({ noticeType: "general" })}
            >
              <Globe size={12} /> General — everyone
            </button>
            <button
              className={`pill pill-btn row-tight${draft.noticeType === "batch" ? " pill-on" : ""}`}
              style={{ gap: 5 }}
              onClick={() => set({ noticeType: "batch" })}
            >
              <Users size={12} /> One or more batches
            </button>
          </div>

          {draft.noticeType === "general" && (
            <p className="hint" style={{ margin: 0 }}>
              Appears in the carousel on every student's homepage.
            </p>
          )}

          {draft.noticeType === "general" && (
            <>
              <label className="row-tight" style={{ cursor: "pointer" }}>
                <input type="checkbox" checked={draft.featured} onChange={(e) => set({ featured: e.target.checked })} />
                <span className="small">Featured</span>
              </label>
              <p className="hint" style={{ margin: 0 }}>
                Shown as a full card on phones even when the home screen uses
                the slim notice strip. For urgent news like an exam change.
              </p>
            </>
          )}

          {draft.noticeType === "batch" && (
            <>
              <p className="hint" style={{ margin: 0 }}>
                Appears in Notice Central for students in the batches you pick.
              </p>
              <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
                {(batches || []).map((batch) => (
                  <button
                    key={batch._id}
                    className={`pill pill-btn${draft.batches.includes(batch._id) ? " pill-on" : ""}`}
                    onClick={() => toggleBatch(batch._id)}
                  >
                    {batch.name}
                  </button>
                ))}
                {(!batches || batches.length === 0) && (
                  <p className="hint" style={{ margin: 0 }}>No {terms.batches} yet. Create one first.</p>
                )}
              </div>
            </>
          )}
        </div>

        <div className="card stack">
          <div className="row-tight"><h2 style={{ fontSize: 15 }}>Call to action</h2></div>
          <p className="hint" style={{ margin: 0 }}>Optional. A button students can tap on the card.</p>

          <div className="row">
            <Field label="Link"><input className="input" placeholder="/batches/.../exams or https://…" value={draft.link} onChange={(e) => set({ link: e.target.value })} /></Field>
            <Field label="Button label"><input className="input" placeholder="View schedule" value={draft.linkLabel} onChange={(e) => set({ linkLabel: e.target.value })} /></Field>
          </div>
          {Boolean(draft.link) !== Boolean(draft.linkLabel) && (
            <p className="hint" style={{ color: "var(--incorrect)" }}>Set both, or clear both.</p>
          )}

          <div className="field">
            <span className="label">Button icon</span>
            <button
              type="button"
              className="card-quiet spread"
              style={{ width: "100%", border: "none", cursor: "pointer", font: "inherit", color: "inherit", textAlign: "left" }}
              onClick={() => setIconPickerOpen(!iconPickerOpen)}
            >
              <div className="row-tight grow">
                <div style={{
                  width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                  background: "var(--surface)", display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {draft.icon?.value
                    ? <BatchIcon icon={draft.icon} size={draft.icon.kind === "custom" ? 22 : 30} />
                    : <Send size={14} className="muted" />}
                </div>
                <span className="small">{draft.icon?.value ? "Custom" : "Default arrow"}</span>
              </div>
              <span className="muted small">{iconPickerOpen ? "Close" : "Change"}</span>
            </button>
            {iconPickerOpen && (
              <IconPicker
                currentIcon={draft.icon}
                uploading={uploadingIcon}
                isDefault={!draft.icon?.value}
                onReset={() => set({ icon: { kind: "preset", value: null } })}
                onPickPreset={(value) => set({ icon: { kind: "preset", value } })}
                onUpload={(file) =>
                  uploadMedia({ file, folder: "notices" }).unwrap().then((media) =>
                    set({ icon: { kind: "custom", value: media.url } })
                  )
                }
                onClose={() => setIconPickerOpen(false)}
              />
            )}
          </div>
        </div>

        <div className="card stack">
          <div className="row-tight"><h2 style={{ fontSize: 15 }}>Visibility</h2></div>

          <label className="row-tight" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={draft.isPublished} onChange={(e) => set({ isPublished: e.target.checked })} />
            <span className="small">Published</span>
          </label>
          <p className="hint" style={{ margin: 0 }}>
            Off keeps this a draft regardless of the dates below. On with no
            dates set means live immediately, indefinitely.
          </p>

          <div className="row">
            <Field label="Show from" hint="Optional">
              <input
                className="input"
                type="datetime-local"
                value={draft.publishFrom}
                onChange={(e) => set({ publishFrom: e.target.value })}
              />
            </Field>
            <Field label="Show until" hint="Optional">
              <input
                className="input"
                type="datetime-local"
                value={draft.publishUntil}
                onChange={(e) => set({ publishUntil: e.target.value })}
              />
            </Field>
          </div>
        </div>

        <SaveBar
          type="button"
          dirty={dirty}
          saving={creating || updating}
          disabled={!valid}
          onSave={save}
          onCancel={() => leave("/notices")}
          saveLabel={isNew ? "Create notice" : "Save changes"}
          note={!valid ? "A title and a message are needed" : undefined}
        />
      </div>
    </div>
  );
}
