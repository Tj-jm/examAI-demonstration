import { useState } from "react";
import { useNavigate, useParams, useOutletContext } from "react-router-dom";
import { ArrowLeft, Film, Upload, Lock, Trash2, RefreshCw, ExternalLink, Send } from "lucide-react";
import { useGetLiveRecordingsQuery, useDecideLiveRecordingMutation, useUpdateLiveClassMutation, useGetLiveClassQuery } from "../api/contentApi";
import { Loading, ErrorNote, useConfirm } from "../components/bits";
import ChapterSelect from "../components/ChapterSelect";

// A class's recordings and what happens to each: publish as a lecture on
// the class's batch, keep private (staff only), or delete. Plus the class's
// auto-publish choice.
const STATUS = {
  recording: ["pill pill-bad", "Recording"],
  processing: ["pill pill-warn", "Finishing"],
  ready: ["pill pill-ok", "Ready"],
  failed: ["pill pill-bad", "Failed"],
};
const DECISION = { pending: "Waiting for your decision", published: "Published as a lecture", private: "Private — staff only" };
const length = (s) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "—");
const mb = (b) => (b ? `${(b / 1e6).toFixed(1)} MB` : "");
const LABEL = { vdocipher: "VdoCipher", bunny: "Bunny", vimeo: "Vimeo" };

// Where a recording stands with the video provider, and a way to send it.
function SendRow({ id, rec, targets, choice, onDone }) {
  const [decide, { isLoading, error }] = useDecideLiveRecordingMutation();
  const [to, setTo] = useState(targets.some((t) => t.name === choice.to) ? choice.to : targets[0]?.name || "");
  const s = rec.sent || {};
  if (s.status === "sent") {
    return <p className="small muted" style={{ margin: 0 }}>Sent to {LABEL[s.to] || s.to}: students watch it in its player.{s.removedCopy ? " The server's copy was removed." : ""}</p>;
  }
  if (rec.sending) return <p className="small muted" style={{ margin: 0 }}>Sending to {LABEL[s.to] || s.to}… This can take a while for a long class.</p>;
  if (rec.status !== "ready" || !targets.length || s.removedCopy) return null;
  return (
    <div className="stack" style={{ gap: 4 }}>
      {s.status === "failed" && <p className="small" style={{ color: "var(--incorrect)", margin: 0 }}>Couldn't send to {LABEL[s.to] || s.to}: {s.error}</p>}
      <div className="row-tight" style={{ flexWrap: "wrap" }}>
        <select className="input" style={{ width: "auto" }} value={to} onChange={(e) => setTo(e.target.value)}>
          {targets.map((t) => <option key={t.name} value={t.name}>{t.label}</option>)}
        </select>
        <button className="btn btn-sm btn-quiet" disabled={!to || isLoading} onClick={async () => {
          const r = await decide({ id, rid: rec._id, action: "send", to });
          if (!r.error) onDone();
        }}><Send size={14} /> {s.status === "failed" ? "Try again" : "Send to video provider"}</button>
      </div>
      <ErrorNote error={error} />
    </div>
  );
}

function PublishForm({ id, rec, defaultTitle, defaultChapter, onDone }) {
  const [decide, { isLoading, error }] = useDecideLiveRecordingMutation();
  const [title, setTitle] = useState(defaultTitle);
  const [chapter, setChapter] = useState(defaultChapter || null);
  const [publishNow, setPublishNow] = useState(true);
  return (
    <div className="card-quiet stack" style={{ gap: 8 }}>
      <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Lecture title" />
      <ChapterSelect value={chapter} onChange={setChapter} />
      <label className="row-tight small"><input type="checkbox" checked={publishNow} onChange={(e) => setPublishNow(e.target.checked)} /> Students can see it now (otherwise saved as a draft lecture)</label>
      <ErrorNote error={error} />
      <div className="row-tight">
        <button className="btn btn-primary btn-sm" disabled={!chapter || !title.trim() || isLoading} onClick={async () => {
          const r = await decide({ id, rid: rec._id, action: "publish", title: title.trim(), chapter, publishNow });
          if (!r.error) onDone();
        }}>Publish as lecture</button>
        <button className="btn btn-sm btn-quiet" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}

export default function LiveRecordings() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: liveClassInfo } = useGetLiveClassQuery(id);
  // A webinar goes back to Webinars, else Live classes.
  const backTo = liveClassInfo?.kind === "webinar" ? { to: "/webinars", label: "Webinars" } : { to: "/live-classes", label: "Live classes" };
  const confirm = useConfirm();
  // Teachers watch the recordings; publishing and deleting stay with admins.
  const { me } = useOutletContext() || {};
  const staff = me?.role !== "teacher";
  const { data: lc } = useGetLiveClassQuery(id);
  const { data, isLoading, error, refetch, isFetching } = useGetLiveRecordingsQuery(id, { pollingInterval: 20000 });
  const [decide] = useDecideLiveRecordingMutation();
  const [update] = useUpdateLiveClassMutation();
  const [publishing, setPublishing] = useState(null);

  if (isLoading) return <Loading />;
  if (error) return <div className="page"><ErrorNote error={error} /></div>;
  const recs = data.recordings || [];

  return (
    <div className="page">
      <div className="page-head spread">
        <div>
          <button className="btn btn-sm btn-quiet" onClick={() => navigate(backTo.to)}><ArrowLeft size={14} /> {backTo.label}</button>
          <h1 style={{ marginTop: 6 }}>Recordings · {lc?.title}</h1>
        </div>
        <button className="btn btn-sm btn-quiet" disabled={isFetching} onClick={refetch}><RefreshCw size={14} /> Refresh</button>
      </div>

      {staff && <div className="card stack" style={{ gap: 8, marginBottom: 16 }}>
        <label className="row-tight" style={{ cursor: "pointer" }}>
          <input type="checkbox" checked={Boolean(data.autoPublish)} disabled={!data.publishChapter}
            onChange={(e) => update({ id, autoPublish: e.target.checked }).then(refetch)} />
          <span>Publish finished recordings as lectures automatically</span>
        </label>
        <div className="row-tight" style={{ gap: 8, flexWrap: "wrap" }}>
          <span className="small muted">Into chapter</span>
          <ChapterSelect value={data.publishChapter} style={{ maxWidth: 320 }}
            onChange={(chapter) => update({ id, publishChapter: chapter, ...(chapter ? {} : { autoPublish: false }) }).then(refetch)} />
        </div>
      </div>}

      {staff && <p className="small muted" style={{ marginTop: -8, marginBottom: 16 }}>
        {data.sendChoice?.auto && data.sendChoice.to !== "storage"
          ? `Finished recordings go to ${LABEL[data.sendChoice.to] || data.sendChoice.to} on their own. `
          : "Recordings stay on this server unless you send them to a video provider. "}
        Change this under Settings → Live classroom.
      </p>}

      {recs.length === 0 && <p className="muted">No recordings yet. Press Record in the classroom to start one.</p>}
      <div className="stack">
        {recs.map((r) => {
          const [cls, label] = STATUS[r.status] || ["pill", r.status];
          return (
            <div key={r._id} className="card stack" style={{ gap: 10 }}>
              <div className="spread">
                <div className="row-tight" style={{ gap: 8 }}>
                  <Film size={16} />
                  <strong>{new Date(r.startedAt).toLocaleString()}</strong>
                  <span className={cls}>{label}</span>
                  {r.status === "ready" && <span className="small muted tnum">{length(r.durationSeconds)} · {mb(r.sizeBytes)}</span>}
                </div>
                <span className="small muted">{DECISION[r.decision]}</span>
              </div>
              {r.error && <p className="small" style={{ color: "var(--incorrect)", margin: 0 }}>{r.error}</p>}
              {r.url && <video src={r.url} controls preload="metadata" style={{ width: "100%", maxWidth: 640, borderRadius: 8, background: "#000" }} />}
              {staff && <SendRow id={id} rec={r} targets={data.sendTo || []} choice={data.sendChoice || {}} onDone={refetch} />}
              {!staff ? null : publishing === r._id ? (
                <PublishForm id={id} rec={r} defaultTitle={`${lc?.title || "Live class"} (recording)`} defaultChapter={data.publishChapter} onDone={() => { setPublishing(null); refetch(); }} />
              ) : (
                <div className="row-tight" style={{ flexWrap: "wrap" }}>
                  {r.status === "ready" && r.decision !== "published" && (
                    <button className="btn btn-sm btn-primary" onClick={() => setPublishing(r._id)}><Upload size={14} /> Publish as lecture</button>
                  )}
                  {r.decision === "published" && r.lecture && (
                    <button className="btn btn-sm btn-quiet" onClick={() => navigate(`/lectures/${r.lecture}`)}><ExternalLink size={14} /> Open lecture</button>
                  )}
                  {r.status === "ready" && r.decision === "pending" && (
                    <button className="btn btn-sm btn-quiet" onClick={() => decide({ id, rid: r._id, action: "private" }).then(refetch)}><Lock size={14} /> Keep private</button>
                  )}
                  {r.decision !== "published" && (
                    <button className="btn btn-sm btn-quiet" onClick={async () => {
                      const yes = await confirm({ title: "Delete this recording?", body: "The video file is removed for good.", confirmLabel: "Delete", tone: "danger" });
                      if (yes) decide({ id, rid: r._id, action: "delete" }).then(refetch);
                    }}><Trash2 size={14} /> Delete</button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
