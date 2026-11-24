import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Sparkles, Download, Save, BookOpen } from "lucide-react";
import { useGetLiveNotesQuery, useGenerateLiveNotesMutation, useUpdateLiveNotesMutation, useGetLiveClassQuery } from "../api/contentApi";
import { Loading, ErrorNote, DownloadButton } from "../components/bits";
import MarkdownEditor from "../components/MarkdownEditor";

// A class's captions and the notes the AI wrote from them. The teacher can
// edit the notes and put them into the lecture made from the recording.
const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export default function LiveNotes() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: liveClassInfo } = useGetLiveClassQuery(id);
  // A webinar goes back to Webinars, else Live classes.
  const backTo = liveClassInfo?.kind === "webinar" ? { to: "/webinars", label: "Webinars" } : { to: "/live-classes", label: "Live classes" };
  const [writing, setWriting] = useState(false);
  const { data, isLoading, error } = useGetLiveNotesQuery(id, { pollingInterval: writing ? 3000 : 0 });
  const [generate, { isLoading: starting, error: genError }] = useGenerateLiveNotesMutation();
  const [update, { isLoading: saving, error: saveError, data: saved }] = useUpdateLiveNotesMutation();
  const [draft, setDraft] = useState(null);

  const status = data?.notes?.status || "none";
  useEffect(() => setWriting(status === "writing"), [status]);
  useEffect(() => {
    if (data && status !== "writing") setDraft(data.notes?.markdown || "");
  }, [data, status]);

  if (isLoading) return <Loading />;
  if (error) return <div className="page"><ErrorNote error={error} /></div>;

  const lines = data.transcript || [];
  const start = lines[0] ? new Date(lines[0].at) : null;
  const dirty = draft !== null && draft !== (data.notes?.markdown || "");

  return (
    <div className="page">
      <div className="page-head">
        <button className="icon-btn" onClick={() => navigate(backTo.to)}><ArrowLeft size={16} /></button>
        <h1>Class notes · {data.title}</h1>
      </div>

      <div className="stack" style={{ maxWidth: 860 }}>
        <div className="card stack" style={{ gap: 10 }}>
          <div className="row-tight" style={{ gap: 8, flexWrap: "wrap" }}>
            <strong className="grow">Notes</strong>
            <button className="btn btn-sm" disabled={!lines.length || writing || starting} onClick={() => generate(id)}>
              <Sparkles size={14} /> {writing ? "Writing…" : status === "ready" ? "Write again" : "Write notes with AI"}
            </button>
          </div>
          {!lines.length && <p className="hint" style={{ margin: 0 }}>No captions were saved for this class. Turn on <b>Captions</b> in the classroom next time and the AI writes the notes when the class ends.</p>}
          {writing && <p className="hint" style={{ margin: 0 }}>Writing the notes from {lines.length} caption lines. This takes up to a minute.</p>}
          {status === "failed" && <p className="small" style={{ color: "var(--danger)", margin: 0 }}>Couldn't write the notes: {data.notes.error}</p>}
          <ErrorNote error={genError} />

          {status === "ready" && draft !== null && (
            <MarkdownEditor value={draft} onChange={setDraft} minHeight={420} initialView="preview" />
          )}
          {status === "ready" && (
            <div className="row-tight" style={{ gap: 8, flexWrap: "wrap" }}>
              <button className="btn btn-sm btn-primary" disabled={!dirty || saving} onClick={() => update({ id, markdown: draft })}><Save size={14} /> Save</button>
              <button
                className="btn btn-sm"
                disabled={!data.lectures.length || saving}
                title={data.lectures.length ? "Replace the lecture's notes with these" : "Publish the recording as a lecture first"}
                onClick={() => update({ id, markdown: draft, applyToLectures: true })}
              >
                <BookOpen size={14} /> Put into the lecture
              </button>
              {saved?.applied ? <span className="small">Added to {saved.applied} lecture{saved.applied > 1 ? "s" : ""}.</span> : null}
              <ErrorNote error={saveError} />
            </div>
          )}
          {status === "ready" && <p className="hint" style={{ margin: 0 }}>A lecture made from this class's recording includes these notes. Its own AI summary and practice questions then work from them.</p>}
        </div>

        <details className="card">
          <summary className="row-tight" style={{ cursor: "pointer", gap: 8 }}>
            <strong className="grow">Transcript · {lines.length} lines</strong>
            {lines.length > 0 && <DownloadButton className="btn btn-sm btn-quiet" filename="notes.txt" href={`/api/live-classes/${id}/notes?format=txt`} onClick={(e) => e.stopPropagation()}><Download size={14} /> .txt</DownloadButton>}
          </summary>
          <div className="stack" style={{ gap: 4, marginTop: 10, maxHeight: 480, overflowY: "auto" }}>
            {lines.map((l, i) => (
              <div key={i} className="row-tight small" style={{ gap: 10, alignItems: "flex-start" }}>
                <span className="tnum" style={{ opacity: 0.6, minWidth: 40 }}>{clock(Math.max(0, Math.round((new Date(l.at) - start) / 1000)))}</span>
                <span>{l.text}</span>
              </div>
            ))}
          </div>
        </details>
      </div>
    </div>
  );
}
