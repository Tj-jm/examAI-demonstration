import { useEffect, useRef, useState } from "react";
import VideoLessonPanel from "../components/VideoLessonPanel";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  useGetTreeQuery,
  useGetLectureQuery,
  useCreateLectureMutation,
  useUpdateLectureMutation,
  useSuggestLectureDescriptionMutation,
  useReindexLectureMutation,
  useReadLectureScansMutation,
  useGetVideoLessonQuery,
  useUploadMediaMutation,
} from "../api/contentApi";
import { ArrowLeft, Sparkles, MessagesSquare, RefreshCw, ImagePlus, Loader2, CheckCircle2, Circle, FolderTree, Eye } from "lucide-react";
import { Loading, ErrorNote, Field } from "../components/bits";
import { VideoPicker, AttachmentPicker } from "../components/MediaPickers";
import MarkdownEditor from "../components/MarkdownEditor";
import { AiTranslate } from "../components/AiWrite";
import ImageEditor from "../components/ImageEditor";
import SearchSelect from "../components/SearchSelect";
import { SaveBar, useCtrlS, useUnsaved, sameWork } from "../components/ListTools";

// What a lecture needs before students get much out of it. Title and
// chapter are required; the rest is a nudge.
function ReadyCheck({ draft, aiVideo }) {
  const items = [
    ["Title", Boolean(draft.title.trim()), true],
    ["Chapter", Boolean(draft.chapter), true],
    ["Video", Boolean(draft.video)],
    ["Written notes", Boolean(draft.bodyMarkdown.trim())],
    ["Short description", Boolean(draft.description.trim())],
    [aiVideo === "draft" ? "AI video (made, not published)" : aiVideo === "new" ? "AI video (save the lecture first)" : "AI video", aiVideo === "published"],
  ];
  const done = items.filter(([, ok]) => ok).length;
  return (
    <div className="card stack" style={{ gap: 10 }}>
      <div className="spread">
        <span className="label">Ready check</span>
        <span className="muted small tnum">{done}/{items.length}</span>
      </div>
      <div className="meter"><i style={{ width: `${(done / items.length) * 100}%` }} /></div>
      <ul className="checklist">
        {items.map(([label, ok, required]) => (
          <li key={label} className={ok ? "done" : ""}>
            {ok ? <CheckCircle2 size={14} /> : <Circle size={14} />}
            {label}{required && !ok && <span className="muted small">(needed)</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

// What course chat can read from this lecture: its notes and files, cut into
// searchable pieces. Scanned pages need AI vision first — that costs money,
// so it's a button, not automatic.
function DocIndexStatus({ id }) {
  const [poll, setPoll] = useState(0);
  const { data: lecture } = useGetLectureQuery(id, { pollingInterval: poll });
  const [reindex, { isLoading: reindexing, error: reindexError }] = useReindexLectureMutation();
  const [readScans, { isLoading: starting, error: readError, data: readResult }] = useReadLectureScansMutation();
  const index = lecture?.docIndex || { status: "none" };
  const indexing = index.status === "indexing";
  useEffect(() => {
    setPoll(indexing ? 3000 : 0);
  }, [indexing]);
  const pendingPages = (index.pendingScans || []).reduce((n, e) => n + (e.pages?.length || 0), 0);

  return (
    <div className="card stack">
      <div className="spread">
        <span className="label row-tight" style={{ gap: 6 }}><MessagesSquare size={14} /> Course chat</span>
        <button className="btn btn-sm btn-quiet" disabled={reindexing || indexing} onClick={() => reindex(id)}>
          <RefreshCw size={13} /> {reindexing || indexing ? "Indexing…" : "Re-index"}
        </button>
      </div>
      <p className="small" style={{ margin: 0 }}>
        {index.status === "ready" && `${index.chunks} searchable piece${index.chunks === 1 ? "" : "s"} from the notes and files.`}
        {index.status === "indexing" && "Reading the notes and files…"}
        {index.status === "failed" && `Indexing failed: ${index.error || "unknown error"}.`}
        {index.status === "none" && "Not indexed yet — it happens automatically when you save notes or files."}
      </p>
      {pendingPages > 0 && (
        <div className="banner banner-warn stack" style={{ gap: 6 }}>
          <span className="small">
            {pendingPages} scanned page{pendingPages === 1 ? "" : "s"} ({index.pendingScans.map((e) => e.title).join(", ")}) {pendingPages === 1 ? "has" : "have"} no text layer, so course chat can't read {pendingPages === 1 ? "it" : "them"} yet.
            Reading them uses AI vision — one AI call per page.
          </span>
          <div>
            <button className="btn btn-sm" disabled={starting || indexing} onClick={() => readScans(id).then(() => setPoll(3000))}>
              Read {pendingPages} page{pendingPages === 1 ? "" : "s"} with AI
            </button>
          </div>
        </div>
      )}
      {readResult?.message && indexing && <span className="hint">{readResult.message}</span>}
      {index.skipped?.length > 0 && (
        <span className="hint">Not readable by course chat: {index.skipped.join(", ")} (videos, images and unknown file types).</span>
      )}
      <ErrorNote error={reindexError || readError} />
    </div>
  );
}

// The pictures already in the notes, as small thumbnails: click one to edit it.
function NoteImages({ body, onEdit }) {
  const images = [];
  const seen = new Set();
  for (const m of (body || "").matchAll(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g)) {
    if (!seen.has(m[2])) { seen.add(m[2]); images.push({ name: m[1], url: m[2] }); }
  }
  if (!images.length) return null;
  return (
    <div className="row-tight" style={{ flexWrap: "wrap", gap: 8 }}>
      <span className="hint">Pictures in the notes, click to edit:</span>
      {images.map((img) => (
        <button
          type="button"
          key={img.url}
          className="thumb"
          title={img.name ? `Edit "${img.name}"` : "Edit picture"}
          style={{ width: 64, height: 48, padding: 0, cursor: "pointer", border: "1px solid var(--line, #ddd)", borderRadius: 6, overflow: "hidden" }}
          onClick={() => onEdit(img.url, img.name)}
        >
          <img src={img.url} alt={img.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </button>
      ))}
    </div>
  );
}

const emptyDraft = () => ({
  title: "",
  chapter: "",
  topic: "",
  tag: "",
  description: "",
  bodyMarkdown: "",
  video: null,
  videoUrl: null,
  attachments: [],
  isPublished: true,
});

const BODY_PLACEHOLDER =
  "## Section heading" +
  "\n\n" +
  "Notes, a worked example, a reading — anything a video alone doesn't cover.";

// One route for both jobs: /lectures/new and /lectures/:id/edit. Same shape
// as QuestionEditor — create and edit are different starting states of an
// otherwise identical form, not two different forms.
export default function LectureEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isNew = !id;
  const formRef = useRef(null);
  // The draft as it was loaded, to tell whether anything changed.
  const [initial, setInitial] = useState(null);

  const { data: tree } = useGetTreeQuery();
  const { data: existing, isLoading } = useGetLectureQuery(id, { skip: isNew });
  // The lecture's AI video lesson, for the ready check.
  const { data: lessonData } = useGetVideoLessonQuery({ lecture: id }, { skip: isNew });
  const aiLesson = lessonData?.lesson;
  const aiVideo = isNew ? "new" : aiLesson?.segments?.length ? (aiLesson.published ? "published" : "draft") : "none";
  const [create, { isLoading: creating, error: createError }] = useCreateLectureMutation();
  const [update, { isLoading: updating, error: updateError }] = useUpdateLectureMutation();
  const [suggestDescription, { isLoading: suggestingDescription, error: suggestError }] = useSuggestLectureDescriptionMutation();
  // "Add here" on the lectures page opens a new lecture with its chapter set.
  const [draft, setDraft] = useState(() => (isNew ? { ...emptyDraft(), chapter: searchParams.get("chapter") || "" } : null));
  // "Insert image" (or a picture pasted or dropped into the notes) opens the
  // image editor first; saving uploads the edited copy and writes it into the
  // notes at the cursor, by a link that never expires (/api/stream/file/…).
  // A picture already in the notes can be reopened and edited the same way:
  // the edited copy is uploaded and its link replaces the old one.
  const notesRef = useRef(null);
  const [uploadMedia, { isLoading: uploadingImage, error: imageError }] = useUploadMediaMutation();
  // { source, name, at } for a new picture; { source, name, replace } to edit one in the notes.
  const [editingImage, setEditingImage] = useState(null);
  const openNewImage = (file) => {
    if (!file || !file.type?.startsWith("image/")) return;
    const name = (file.name || "").replace(/\.[^.]+$/, "").replace(/[[\]]/g, "") || "image";
    setEditingImage({ source: file, name, at: notesRef.current?.selectionStart ?? null });
  };
  const saveImage = async (blob, type) => {
    const job = editingImage;
    const ext = (type || blob.type || "image/png").split("/")[1] || "png";
    const file = new File([blob], `${job.name}.${ext === "jpeg" ? "jpg" : ext}`, { type: type || blob.type });
    const media = await uploadMedia({ file, folder: "lectures" }).unwrap().catch(() => null);
    setEditingImage(null);
    if (!media?.key) return;
    const url = `/api/stream/file/${media.key}`;
    setDraft((d) => {
      const body = d.bodyMarkdown || "";
      if (job.replace) return { ...d, bodyMarkdown: body.split(job.replace).join(url) };
      const line = `![${job.name}](${url})`;
      const at = job.at ?? body.length;
      const before = body.slice(0, at);
      const after = body.slice(at);
      const pre = before && !before.endsWith("\n") ? "\n\n" : "";
      const post = after && !after.startsWith("\n") ? "\n\n" : "";
      return { ...d, bodyMarkdown: `${before}${pre}${line}${post}${after}` };
    });
  };
  const pastedImage = (items) => [...(items || [])].find((i) => i.kind === "file" && i.type.startsWith("image/"))?.getAsFile();
  // Subject is UI-only narrowing — the lecture itself is never saved with a
  // subject, only a chapter (same as Questions.jsx/ExamBuilder.jsx's own
  // subject-first pickers). A flat "every chapter across every subject" list
  // stopped being scannable once a real syllabus loaded in — this two-step
  // narrowing is what those other pickers already do.
  const [subjectId, setSubjectId] = useState("");

  useEffect(() => {
    if (isNew) { setInitial((v) => v || draft); return; }
    if (existing) {
      const loaded = {
        title: existing.title,
        chapter: existing.chapter?._id || existing.chapter || "",
        topic: existing.topic?._id || existing.topic || "",
        tag: existing.tag || "",
        description: existing.description || "",
        bodyMarkdown: existing.bodyMarkdown || "",
        video: existing.video?._id || null,
        videoUrl: existing.video?.url || null,
        attachments: existing.attachments || [],
        isPublished: existing.isPublished,
      };
      setDraft(loaded);
      setInitial(loaded);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, existing?._id]);

  // Editing an existing lecture: back-fill which subject its chapter belongs
  // to, once the tree and the lecture have both loaded — the form only ever
  // stores a chapter, so the subject narrowing has to be derived, not read
  // straight off the lecture.
  useEffect(() => {
    if (subjectId || !tree || !draft?.chapter) return;
    const owner = tree.find((s) => s.chapters.some((c) => c._id === draft.chapter));
    if (owner) setSubjectId(owner._id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, draft?.chapter]);

  const subjects = (tree || []).map((subject) => ({ _id: subject._id, title: subject.title }));
  // The chapter select is disabled until a subject is chosen (below), so
  // this only ever needs to list one subject's chapters at a time.
  const chapters = (subjectId ? (tree || []).find((s) => s._id === subjectId)?.chapters : []) || [];
  const chapterOptions = chapters.map((chapter) => ({
    _id: chapter._id,
    label: chapter.title,
    topics: chapter.topics || [],
  }));

  const backTarget = isNew ? "/lectures" : `/lectures/${id}`;
  const dirty = Boolean(draft && initial && !sameWork(draft, initial));
  const { leave, clear } = useUnsaved(dirty);
  const canSave = Boolean(draft?.title && draft?.chapter) && !creating && !updating;
  useCtrlS(() => { if (canSave) formRef.current?.requestSubmit(); }, Boolean(draft));

  if (!isNew && (isLoading || !draft)) return <Loading />;
  if (!draft) return <Loading />;

  const set = (patch) => setDraft({ ...draft, ...patch });

  // Picking a different subject drops whatever chapter/topic was chosen
  // under the old one — same reasoning as Lectures.jsx's own
  // setSubjectFilter/setChapterFilter.
  const chooseSubject = (id) => {
    setSubjectId(id);
    set({ chapter: "", topic: "" });
  };

  // Runs straight off the form's own current text — not the saved lecture —
  // so this works before a new lecture has ever been created, and reflects
  // notes typed but not yet saved on an existing one. Draft-only: fills the
  // field, the admin still reviews and hits Save like any other edit.
  const runSuggestDescription = async () => {
    try {
      const { description } = await suggestDescription({ title: draft.title, bodyMarkdown: draft.bodyMarkdown }).unwrap();
      set({ description });
    } catch {
      // rendered below via suggestError
    }
  };

  // A topic filed under a chapter other than the one just chosen is invalid
  // — the backend rejects it — so switching chapters clears it here rather
  // than leaving a stale, now-illegal selection in the form.
  const chapterObj = chapterOptions.find((c) => c._id === draft.chapter);
  const topicOptions = chapterObj?.topics || [];

  const submit = async (event) => {
    event.preventDefault();
    const payload = {
      title: draft.title,
      chapter: draft.chapter,
      topic: draft.topic || null,
      tag: draft.tag,
      description: draft.description,
      bodyMarkdown: draft.bodyMarkdown,
      video: draft.video,
      attachments: draft.attachments.map((a) => a._id),
      isPublished: draft.isPublished,
    };

    try {
      if (isNew) {
        const made = await create(payload).unwrap();
        clear();
        navigate(`/lectures/${made._id}`);
      } else {
        await update({ id, ...payload }).unwrap();
        clear();
        navigate(`/lectures/${id}`);
      }
    } catch {
      // rendered below
    }
  };

  const placement = (
    <div className="card stack">
      <span className="label row-tight" style={{ gap: 6 }}><FolderTree size={14} /> Where it lives</span>
      <Field label="Subject">
        <SearchSelect className="select" value={subjectId} onChange={(e) => chooseSubject(e.target.value)}>
          <option value="">Choose a subject</option>
          {subjects.map((s) => <option key={s._id} value={s._id}>{s.title}</option>)}
        </SearchSelect>
      </Field>
      <Field label="Chapter">
        <SearchSelect className="select" value={draft.chapter} onChange={(e) => set({ chapter: e.target.value, topic: "" })} disabled={!subjectId}>
          <option value="">{subjectId ? "Choose a chapter" : "Choose a subject first"}</option>
          {chapterOptions.map((c) => <option key={c._id} value={c._id}>{c.label}</option>)}
        </SearchSelect>
      </Field>
      <Field label="Topic" hint="Optional. Narrows the lecture within the chapter.">
        <SearchSelect className="select" value={draft.topic} onChange={(e) => set({ topic: e.target.value })} disabled={!draft.chapter}>
          <option value="">Whole chapter</option>
          {topicOptions.map((t) => <option key={t._id} value={t._id}>{t.title}</option>)}
        </SearchSelect>
      </Field>
      <Field label="Tag" hint="For your own grouping. It does not affect access.">
        <input className="input" placeholder="Core" value={draft.tag} onChange={(e) => set({ tag: e.target.value })} />
      </Field>
    </div>
  );

  const visibility = (
    <div className="card stack" style={{ gap: 8 }}>
      <span className="label row-tight" style={{ gap: 6 }}><Eye size={14} /> Visibility</span>
      <label className="row-tight" style={{ cursor: "pointer", gap: 10 }}>
        <span className="switch">
          <input type="checkbox" checked={draft.isPublished} onChange={(e) => set({ isPublished: e.target.checked })} />
          <span />
        </span>
        <span className="small"><b>{draft.isPublished ? "Published" : "Draft"}</b></span>
      </label>
      <span className="hint">
        {draft.isPublished ? "Students in every batch it's assigned to can open it." : "Hidden from students until you publish it."}
      </span>
    </div>
  );

  return (
    <>
    {editingImage && (
      <ImageEditor
        source={editingImage.source}
        saving={uploadingImage}
        onCancel={() => setEditingImage(null)}
        onSave={saveImage}
      />
    )}
    <form ref={formRef} className="page page-wide" onSubmit={submit}>
      <div className="page-head spread">
        <div>
          <h1>{isNew ? "New lecture" : "Edit lecture"}</h1>
          {!isNew && existing?.title && <p className="muted small" style={{ margin: "2px 0 0" }}>{existing.title}</p>}
        </div>
        <button type="button" className="btn btn-sm btn-quiet" onClick={() => leave(backTarget)}>
          <ArrowLeft size={14} /> {isNew ? "Lectures" : "Back"}
        </button>
      </div>

      <div className="editor-cols">
        <div className="stack" style={{ gap: "var(--sp-4)" }}>
          <div className="card stack">
            <Field label="Title">
              <input
                className="input"
                autoFocus
                placeholder="What is this lecture about?"
                style={{ fontSize: 16, fontWeight: 500 }}
                value={draft.title}
                onChange={(e) => set({ title: e.target.value })}
              />
              <div className="row-tight" style={{ justifyContent: "flex-end" }}><AiTranslate value={draft.title} onChange={(v) => set({ title: v })} /></div>
            </Field>
          </div>

          <div className="card stack">
            <span className="label">Video</span>
            {/* Every driver goes through the same picker, since attaching one
                is the same action no matter where the video lives. */}
            <VideoPicker
              value={draft.video}
              url={draft.videoUrl}
              onChange={(videoId, url) => set({ video: videoId, videoUrl: url })}
            />
          </div>

          <div className="card stack">
            <div className="spread">
              <span className="label">Description</span>
              <span className="row-tight" style={{ gap: 4 }}>
                <AiTranslate value={draft.description} onChange={(v) => set({ description: v })} />
                <button
                  type="button"
                  className="btn btn-sm btn-quiet"
                  disabled={!draft.bodyMarkdown.trim() || suggestingDescription}
                  title={!draft.bodyMarkdown.trim() ? "Write the lecture's notes first" : "Draft a description from the notes below"}
                  onClick={runSuggestDescription}
                >
                  <Sparkles size={13} /> {suggestingDescription ? "Writing…" : "Write with AI"}
                </button>
              </span>
            </div>
            <textarea
              className="textarea"
              style={{ minHeight: 60 }}
              placeholder="A short summary shown before the video. Optional."
              value={draft.description}
              onChange={(e) => set({ description: e.target.value })}
            />
            <ErrorNote error={suggestError} />
          </div>

          <div className="card stack">
            <MarkdownEditor
              label="Written content"
              value={draft.bodyMarkdown}
              onChange={(v) => set({ bodyMarkdown: v })}
              textareaRef={notesRef}
              placeholder={BODY_PLACEHOLDER}
              actions={<AiTranslate value={draft.bodyMarkdown} onChange={(v) => set({ bodyMarkdown: v })} />}
              tools={(
                <label className="btn btn-sm btn-quiet" style={{ cursor: uploadingImage ? "wait" : "pointer" }} title="Or paste or drop a picture into the notes. It goes in where the cursor is.">
                  {uploadingImage ? <Loader2 size={14} className="spin" /> : <ImagePlus size={14} />} Insert image
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden disabled={uploadingImage}
                    onChange={(e) => { openNewImage(e.target.files?.[0]); e.target.value = ""; }} />
                </label>
              )}
              onPaste={(e) => {
                const file = pastedImage(e.clipboardData?.items);
                if (file) { e.preventDefault(); openNewImage(file); }
              }}
              onDrop={(e) => {
                const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith("image/"));
                if (file) { e.preventDefault(); openNewImage(file); }
              }}
              hint="Paste or drop a picture into the notes and it goes in where the cursor is. LaTeX works too ($x^2$). Nothing here runs as code."
            />
            <ErrorNote error={imageError} />
            <NoteImages
              body={draft.bodyMarkdown}
              onEdit={(url, name) => setEditingImage({ source: url, name: name || "image", replace: url })}
            />
          </div>

          <div className="card stack">
            <span className="label">Attachments</span>
            <AttachmentPicker
              value={draft.attachments}
              onChange={(attachments) => set({ attachments })}
            />
          </div>

          {!isNew && <VideoLessonPanel lecture={id} notes={draft.bodyMarkdown} />}
        </div>

        <aside className="editor-side">
          {placement}
          {visibility}
          <ReadyCheck draft={draft} aiVideo={aiVideo} />
          {!isNew && <DocIndexStatus id={id} />}
        </aside>
      </div>

      <ErrorNote error={createError || updateError} />

      <SaveBar
        dirty={dirty}
        saving={creating || updating}
        disabled={!canSave}
        onCancel={() => leave(backTarget)}
        saveLabel={isNew ? "Create lecture" : "Save changes"}
        savingLabel={isNew ? "Creating" : "Saving"}
        note={!draft.title || !draft.chapter ? "A title and a chapter are needed" : undefined}
      />
    </form>
    </>
  );
}
