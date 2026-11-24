import { useEffect, useRef, useState } from "react";
import {
  ImagePlus, X, Loader2, Video, Link2, ShieldCheck, ShieldAlert, AlertTriangle,
  Paperclip, Plus, ExternalLink, FileText, Library, Upload, Pencil, RefreshCw,
} from "lucide-react";
import ImageEditor from "./ImageEditor";
import AiImageButton from "./AiImage";
import {
  useUploadMediaMutation,
  useLinkVideoMutation,
  useGetMediaProvidersQuery,
  useAttachFromDocumentMutation,
  useGetMediaQuery,
  useProtectMediaMutation,
} from "../api/contentApi";
import VideoFrame from "./VideoFrame";
import { useGetDocumentsQuery } from "../api/aiApi";

// ---------------------------------------------------------------- images

// Used on a question, on each option, and on a solution. Holds a Media id and
// shows a thumbnail — the parent only ever stores the id, so moving from local
// disk to S3 later rewrites nothing.
//
// ai: "picture" (notices, landing page) or "diagram" (questions, solutions)
// adds an AI button; aiContext is the text it starts from.
export function ImagePicker({ value, url, onChange, label = "Image", compact = false, folder = "questions", ai = null, aiPurpose = "notice", aiContext = "" }) {
  const input = useRef(null);
  const [upload, { isLoading, error }] = useUploadMediaMutation();
  const [preview, setPreview] = useState(url || null);
  // The image being edited: a newly picked file, or the attached image's url.
  const [editing, setEditing] = useState(null);

  // useState reads its argument once. The form this sits in loads its question
  // asynchronously, so at mount `url` is undefined and the saved image never
  // appeared — it looked as though the upload had not stuck.
  //
  // A local object url set during an upload must not be clobbered, so the sync
  // only runs for real urls arriving from the server.
  useEffect(() => {
    if (url && url !== preview && !String(preview || "").startsWith("blob:")) {
      setPreview(url);
    }
    if (!url && !value) {
      setPreview(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, value]);

  // A picked file opens in the editor first; saving there uploads it.
  const pick = (event) => {
    const file = event.target.files?.[0];
    // Reset so the same file can be chosen again.
    event.target.value = "";
    if (file) setEditing({ source: file, name: file.name });
  };

  const saveEdited = async (blob, type) => {
    const base = (editing?.name || "image").replace(/\.[a-z0-9]+$/i, "");
    const file = blob instanceof File ? blob : new File([blob], `${base}.${type === "image/jpeg" ? "jpg" : "png"}`, { type });
    setEditing(null);
    await send(file);
  };

  const send = async (file) => {
    // Shown immediately from the local file rather than waiting for the round
    // trip, so a large diagram does not look like nothing happened.
    const localUrl = URL.createObjectURL(file);
    setPreview(localUrl);

    try {
      const media = await upload({ file, folder }).unwrap();
      setPreview(media.url);
      onChange(media._id, media.url);
    } catch {
      setPreview(url || null);
    } finally {
      // The object url held the file in memory until the real one arrived.
      URL.revokeObjectURL(localUrl);
    }
  };

  const editor = editing && (
    <ImageEditor source={editing.source} saving={isLoading} onCancel={() => setEditing(null)} onSave={saveEdited} />
  );

  const clear = () => {
    setPreview(null);
    onChange(null, null);
  };

  if (preview) {
    return (
      <div className={compact ? "row-tight" : "stack"} style={{ gap: 8 }}>
        <div className="thumb">
          <img src={preview} alt="" />
          <button type="button" className="thumb-remove" onClick={clear} title="Remove image">
            <X size={13} />
          </button>
          {!String(preview).startsWith("blob:") && (
            <button type="button" className="thumb-edit" onClick={() => setEditing({ source: preview, name: "image" })} title="Edit image">
              <Pencil size={12} />
            </button>
          )}
        </div>
        {!compact && <span className="hint">{label} attached.</span>}
        {editor}
      </div>
    );
  }

  const aiButton = ai && (
    <AiImageButton
      kind={ai}
      purpose={aiPurpose}
      context={aiContext}
      compact={compact}
      onPicture={(media) => { setPreview(media.url); onChange(media._id, media.url); }}
      onDiagram={(blob) => setEditing({ source: blob, name: "diagram" })}
    />
  );

  const uploadButton = (
    <button
      type="button"
      className={compact ? "icon-btn" : "btn btn-sm btn-quiet"}
      onClick={() => input.current?.click()}
      disabled={isLoading}
      title={`Add ${label.toLowerCase()}`}
    >
      {isLoading
        ? <Loader2 size={compact ? 15 : 14} className="spin" />
        : <ImagePlus size={compact ? 15 : 14} />}
      {!compact && (isLoading ? "Uploading" : label)}
    </button>
  );

  return (
    <>
      {aiButton && !compact
        ? <div className="row-tight" style={{ flexWrap: "wrap" }}>{uploadButton}{aiButton}</div>
        : <>{aiButton}{uploadButton}</>}

      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        style={{ display: "none" }}
        onChange={pick}
      />

      {error && (
        <span className="hint" style={{ color: "var(--incorrect)" }}>
          {error?.data?.message || "That upload failed."}
        </span>
      )}
      {editor}
    </>
  );
}

// ---------------------------------------------------------------- video

// Video is never stored here. It is handed to a provider that specialises in
// delivery, or referenced where it already lives.
// Sends a video file for the self-hosted protected player, with progress
// (XHR: fetch can't report upload progress). Resolves to the new Media.
const uploadProtected = (file, { title, hd }, onProgress) =>
  new Promise((resolve, reject) => {
    const body = new FormData();
    body.append("file", file);
    if (title) body.append("title", title);
    body.append("hd", hd ? "true" : "false");
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/media/protected");
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* not json */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.message || "The upload failed."));
    };
    xhr.onerror = () => reject(new Error("The upload was cut off. Check the connection and try again."));
    xhr.send(body);
  });

// A protected video's state: being prepared (with progress), failed (with
// Retry), or ready (and in which qualities).
function ProtectionState({ media, onRetry, retrying }) {
  const p = media?.protection;
  if (!p) return null;
  if (p.status === "queued" || p.status === "converting") {
    return (
      <div className="stack" style={{ gap: 4 }}>
        <span className="hint row-tight"><Loader2 size={13} className="spin" /> {p.status === "queued" ? "Waiting to be protected…" : `Protecting: ${p.progress || 0}%`} You can save and leave; it carries on.</span>
        <div className="progress"><div className="progress-bar" style={{ width: `${p.progress || 0}%` }} /></div>
      </div>
    );
  }
  if (p.status === "failed") {
    return (
      <div className="banner banner-warn row-tight">
        <AlertTriangle size={15} style={{ flexShrink: 0 }} />
        <span className="grow">Protecting failed: {p.error || "unknown error"}</span>
        <button type="button" className="btn btn-sm" disabled={retrying} onClick={onRetry}>Retry</button>
      </div>
    );
  }
  if (media.driver !== "protected") return null;
  return (
    <span className="hint row-tight"><ShieldCheck size={13} /> Protected · {p.qualities?.join(", ")} · encrypted, plays only for signed-in viewers</span>
  );
}

export function VideoPicker({ value, url, onChange }) {
  const { data: providers } = useGetMediaProvidersQuery();
  const [link, { isLoading, error }] = useLinkVideoMutation();
  const [protect, { isLoading: protecting, error: protectError }] = useProtectMediaMutation();

  const [provider, setProvider] = useState("youtube");
  const [input, setInput] = useState("");
  const [hd, setHd] = useState(true);
  const [sending, setSending] = useState(null); // upload progress 0..100
  const [sendError, setSendError] = useState("");
  const fileInput = useRef(null);

  // While a protected video is being prepared, check on it every few seconds.
  const [poll, setPoll] = useState(false);
  const { data: media } = useGetMediaQuery(value, { skip: !value, pollingInterval: poll ? 4000 : 0 });
  const status = media?.protection?.status;
  useEffect(() => { setPoll(status === "queued" || status === "converting"); }, [status]);
  // Hand the playable link up once it exists (a new upload starts without).
  useEffect(() => {
    if (value && media?._id === value && media.url && media.url !== url) onChange(value, media.url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media?.url]);

  const options = [
    ...(providers?.video || []),
    { name: "protected", label: "Upload (protected)", signed: true, configured: true, needs: [] },
  ];
  const chosen = options.find((p) => p.name === provider);

  // No <form> here: this picker is used inside the lecture form, which is
  // itself a <form>. Nested forms are invalid HTML, and the practical bug it
  // caused was worse than cosmetic — clicking Attach submitted this inner
  // form correctly, but that submit event still bubbles to the outer one
  // (preventDefault on one event doesn't stop it reaching an ancestor's own
  // listener), silently saving and closing the whole lecture at the same
  // time. A plain div with an explicit click handler, plus manual handling
  // of Enter in the input, does the same job without a second form to leak
  // into the one around it.
  const attach = async () => {
    try {
      const m = await link({ provider, input }).unwrap();
      onChange(m._id, m.url);
      setInput("");
    } catch {
      // rendered below
    }
  };

  const send = async (file) => {
    setSendError("");
    setSending(0);
    try {
      const m = await uploadProtected(file, { title: input.trim() || file.name, hd }, setSending);
      onChange(m._id, m.url || null);
      setInput("");
    } catch (e) {
      setSendError(e.message);
    } finally {
      setSending(null);
    }
  };

  if (value) {
    const playUrl = media?.url ?? url;
    const isFile = media ? media.file : /^\/api\/stream\//.test(url || "");
    const busy = ["queued", "converting"].includes(status);
    const canProtect = media && media.file && media.driver !== "protected" && !busy;
    const canAgain = media?.driver === "protected" && media.protection?.reconvert && !busy && status !== "failed";
    return (
      <div className="stack" style={{ gap: 8 }}>
        {playUrl ? (
          <div className="video-frame">
            <VideoFrame url={playUrl} file={isFile} />
          </div>
        ) : null}
        <ProtectionState media={media} retrying={protecting} onRetry={() => protect({ id: value, hd: media?.protection?.hd })} />
        {canProtect && status !== "failed" && (
          <div className="row-tight" style={{ flexWrap: "wrap" }}>
            <button type="button" className="btn btn-sm" disabled={protecting} onClick={() => protect({ id: value, hd })}>
              <ShieldCheck size={14} /> Protect this video
            </button>
            <label className="row-tight hint" style={{ gap: 4 }}>
              <input type="checkbox" checked={hd} onChange={(e) => setHd(e.target.checked)} /> Include 1080p
            </label>
            <span className="hint">Encrypts it in chunks so download tools can't save it.</span>
          </div>
        )}
        {canAgain && (
          <div className="row-tight" style={{ flexWrap: "wrap" }}>
            <button type="button" className="btn btn-sm btn-quiet" disabled={protecting} onClick={() => protect({ id: value, hd })}>
              <RefreshCw size={14} /> Convert again
            </button>
            <label className="row-tight hint" style={{ gap: 4 }}>
              <input type="checkbox" checked={hd} onChange={(e) => setHd(e.target.checked)} /> Include 1080p
            </label>
            <span className="hint">From the original, at the current quality settings. It keeps playing meanwhile.</span>
          </div>
        )}
        {protectError && <span className="hint" style={{ color: "var(--incorrect)" }}>{protectError?.data?.message || "Couldn't start protecting it."}</span>}
        <button type="button" className="btn btn-sm btn-quiet" onClick={() => onChange(null, null)}>
          <X size={14} /> Remove video
        </button>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row-tight" style={{ flexWrap: "wrap" }}>
        {options.map((p) => (
          <button
            key={p.name}
            type="button"
            className={`pill pill-btn row-tight${provider === p.name ? " pill-on" : ""}`}
            style={{ gap: 5 }}
            onClick={() => setProvider(p.name)}
            disabled={!p.configured}
            title={p.configured ? undefined : `Needs ${p.needs.join(" and ")} in the environment`}
          >
            {p.name === "protected" ? <Upload size={11} /> : p.signed ? <ShieldCheck size={11} /> : <Video size={11} />}
            {p.label}
          </button>
        ))}
      </div>

      {provider === "protected" ? (
        <div className="stack" style={{ gap: 8 }}>
          <span className="hint row-tight">
            <ShieldCheck size={13} style={{ flexShrink: 0 }} />
            Kept on your own server, cut into encrypted chunks. Plays only for signed-in viewers; download tools can't save it.
          </span>
          <input className="input" placeholder="Title (optional)" value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }} />
          <div className="row-tight" style={{ flexWrap: "wrap" }}>
            <input ref={fileInput} type="file" accept="video/*" hidden
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) send(f); }} />
            <button type="button" className="btn btn-sm" disabled={sending !== null} onClick={() => fileInput.current?.click()}>
              {sending !== null ? <><Loader2 size={14} className="spin" /> Uploading {sending}%</> : <><Upload size={14} /> Choose video</>}
            </button>
            <label className="row-tight hint" style={{ gap: 4 }}>
              <input type="checkbox" checked={hd} onChange={(e) => setHd(e.target.checked)} /> Include 1080p
            </label>
          </div>
          {sending !== null && <div className="progress"><div className="progress-bar" style={{ width: `${sending}%` }} /></div>}
          {sendError && <span className="hint" style={{ color: "var(--incorrect)" }}>{sendError}</span>}
        </div>
      ) : (
        <>
          {chosen && !chosen.signed && (
            <div className="row-tight hint">
              <ShieldAlert size={13} style={{ flexShrink: 0 }} />
              <span>
                Anyone with this link can watch without signing in. Bunny Stream and
                VdoCipher are the options that expire; VdoCipher adds DRM.
              </span>
            </div>
          )}

          {chosen && !chosen.configured && (
            <div className="banner banner-warn row-tight">
              <AlertTriangle size={15} style={{ flexShrink: 0 }} />
              <span>Set {chosen.needs.join(" and ")} in the environment to use {chosen.label}.</span>
            </div>
          )}

          <div className="row-tight">
            <div className="search-wrap grow">
              <Link2 size={15} className="search-icon" />
              <input
                className="input"
                style={{ paddingLeft: 36 }}
                placeholder={
                  provider === "bunny" ? "Bunny video id"
                    : provider === "vdocipher" ? "VdoCipher video id"
                    : provider === "youtube" ? "Paste a YouTube link"
                    : provider === "vimeo" ? "Paste a Vimeo link"
                    : "Paste a direct video URL"
                }
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  // Enter in a text input normally submits the nearest ancestor
                  // form — with no inner form to catch that anymore, it would
                  // fall through to the outer lecture form instead unless this
                  // stops it explicitly.
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (input.trim() && !isLoading && chosen?.configured) attach();
                  }
                }}
              />
            </div>
            <button
              type="button"
              className="btn btn-sm"
              disabled={!input.trim() || isLoading || !chosen?.configured}
              onClick={attach}
            >
              {isLoading ? "Adding" : "Attach"}
            </button>
          </div>

          {error && (
            <span className="hint" style={{ color: "var(--incorrect)" }}>
              {error?.data?.message || "That video could not be attached."}
            </span>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------- attachments

const formatBytes = (bytes) => {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// A lecture can carry more than one file — slides, a worksheet, a reading.
// Two ways in: upload something new (any type the ingest pipeline itself
// knows how to read, plus images), or point at a document already sitting in
// the ingest library. The library path never uploads anything a second time
// — it hands back a Media record pointing at the same stored bytes.
export function AttachmentPicker({ value = [], onChange }) {
  const input = useRef(null);
  const [mode, setMode] = useState("upload");
  const [search, setSearch] = useState("");

  const [upload, { isLoading: uploading, error: uploadError }] = useUploadMediaMutation();
  const [attachFromDocument, { isLoading: attaching, error: attachError }] =
    useAttachFromDocumentMutation();
  const { data: library, isLoading: loadingLibrary } = useGetDocumentsQuery(search, {
    skip: mode !== "library",
  });

  const attached = value;
  const addMedia = (media) => {
    if (attached.some((a) => a._id === media._id)) return;
    onChange([...attached, media]);
  };
  const remove = (id) => onChange(attached.filter((a) => a._id !== id));

  const pickFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const media = await upload({ file, folder: "lectures" }).unwrap();
      addMedia(media);
    } catch {
      // rendered below
    } finally {
      event.target.value = "";
    }
  };

  return (
    <div className="stack" style={{ gap: 8 }}>
      {attached.length > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          {attached.map((file) => (
            <div
              key={file._id}
              className="row-tight card-quiet"
              style={{ padding: "6px 10px", gap: 8 }}
            >
              <Paperclip size={14} className="muted" style={{ flexShrink: 0 }} />
              <span className="grow truncate small">{file.title}</span>
              {file.sizeBytes != null && (
                <span className="muted small tnum">{formatBytes(file.sizeBytes)}</span>
              )}
              {file.url && (
                <a
                  href={file.url}
                  target="_blank"
                  rel="noreferrer"
                  className="icon-btn"
                  title="Open in a new tab"
                >
                  <ExternalLink size={13} />
                </a>
              )}
              <button
                type="button"
                className="icon-btn icon-btn-danger"
                title="Remove attachment"
                onClick={() => remove(file._id)}
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="row-tight">
        <button
          type="button"
          className={`pill pill-btn${mode === "upload" ? " pill-on" : ""}`}
          onClick={() => setMode("upload")}
        >
          <Upload size={12} /> Upload
        </button>
        <button
          type="button"
          className={`pill pill-btn${mode === "library" ? " pill-on" : ""}`}
          onClick={() => setMode("library")}
        >
          <Library size={12} /> From your library
        </button>
      </div>

      {mode === "upload" ? (
        <>
          <button
            type="button"
            className="btn btn-sm btn-quiet"
            style={{ alignSelf: "flex-start" }}
            onClick={() => input.current?.click()}
            disabled={uploading}
          >
            {uploading ? <Loader2 size={14} className="spin" /> : <Paperclip size={14} />}
            {uploading ? "Uploading" : "Add a file"}
          </button>
          <input
            ref={input}
            type="file"
            accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.docx,.pptx,.txt,.md"
            style={{ display: "none" }}
            onChange={pickFile}
          />
          <p className="hint" style={{ margin: 0 }}>
            Images, PDF, Word, PowerPoint, plain text or Markdown.
          </p>
          {uploadError && (
            <span className="hint" style={{ color: "var(--incorrect)" }}>
              {uploadError?.data?.message || "That upload failed."}
            </span>
          )}
        </>
      ) : (
        <div className="stack" style={{ gap: 6 }}>
          <input
            className="input"
            placeholder="Search your library"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {loadingLibrary ? (
            <p className="hint" style={{ margin: 0 }}>Loading your library…</p>
          ) : (library?.documents || []).length === 0 ? (
            <p className="hint" style={{ margin: 0 }}>
              {search ? "Nothing matches that search." : "Nothing in your library yet."}
            </p>
          ) : (
            <div className="stack" style={{ gap: 4, maxHeight: 220, overflowY: "auto" }}>
              {library.documents.map((doc) => (
                <button
                  key={doc._id}
                  type="button"
                  className="card-quiet row spread"
                  style={{ textAlign: "left", cursor: "pointer" }}
                  disabled={attaching}
                  onClick={async () => {
                    try {
                      const media = await attachFromDocument(doc._id).unwrap();
                      addMedia(media);
                    } catch {
                      // rendered below
                    }
                  }}
                >
                  <span className="row-tight grow small" style={{ gap: 6 }}>
                    <FileText size={14} className="muted" />
                    {doc.title}
                  </span>
                  <Plus size={13} className="muted" />
                </button>
              ))}
            </div>
          )}
          {attachError && (
            <span className="hint" style={{ color: "var(--incorrect)" }}>
              {attachError?.data?.message || "That could not be attached."}
            </span>
          )}
        </div>
      )}
    </div>
  );
}