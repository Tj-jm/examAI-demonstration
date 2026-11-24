import { useEffect, useRef, useState } from "react";
import { Clapperboard, X, Circle, Check, Maximize, FolderOpen } from "lucide-react";
import BoardPlayer from "./BoardPlayer";
import { useGetCourseVideoLessonsQuery } from "../api/contentApi";
import { SIZES, captureTab, scaledTrack, evenAudio, recorderFor, uploadParts, downloadUrl, captionCues, captionFiles, saveFile, safeName, sameOriginLesson } from "./videoHd";

// A whole course (a batch's lectures, in course order) recorded as HD
// videos, one after another, with one share and one full screen: each
// lecture's AI video lesson becomes "01 - Title.mp4" plus its captions
// (.srt, .vtt), written into a folder you pick (Chrome) or downloaded.
// Made for course sites (Udemy and the like). Nothing on the site changes:
// lecture videos stay as they are. Like the single export it plays in real
// time, so a 2-hour course takes 2 hours with this tab in front; Esc stops
// (lectures already finished are kept).
const readyOf = (l, voiceReady) => {
  if (!l.lesson) return "No AI video lesson";
  if (l.lesson.busy) return "Being made";
  if (voiceReady && l.lesson.needVoice > 0) return `${l.lesson.needVoice} part${l.lesson.needVoice === 1 ? "" : "s"} without voice`;
  return "";
};

export default function CourseVideoExport({ batchId, name }) {
  const [open, setOpen] = useState(false);
  const { data, isFetching, refetch } = useGetCourseVideoLessonsQuery(batchId, { skip: !open });
  const lectures = data?.lectures || [];
  const ready = lectures.filter((l) => !readyOf(l, data?.voiceReady));
  const [picked, setPicked] = useState(null); // Set of lecture ids; null = all ready
  const chosen = ready.filter((l) => !picked || picked.has(l._id));
  const [burnIn, setBurnIn] = useState(false);
  const [captionFile, setCaptionFile] = useState(true);
  const [dir, setDir] = useState(null);
  const [res, setRes] = useState(720);
  const dim = SIZES[res];
  const [phase, setPhase] = useState("ready"); // ready | armed | recording | done | error
  const [message, setMessage] = useState("");
  const [current, setCurrent] = useState(null); // { lesson, index, total, title }
  const [log, setLog] = useState([]);
  const [isFull, setIsFull] = useState(false);
  const [signal, setSignal] = useState(0);
  const overlayRef = useRef(null);
  const frameRef = useRef(null);
  const run = useRef(null);
  const waits = useRef({});
  const supported = Boolean(navigator.mediaDevices?.getDisplayMedia && window.MediaRecorder && window.AudioContext);
  const canPickFolder = typeof window.showDirectoryPicker === "function";

  useEffect(() => { if (open) setPicked(null); }, [open]);

  const toggle = (id) => setPicked((p) => {
    const next = new Set(p || ready.map((l) => l._id));
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const pickFolder = async () => {
    try { setDir(await window.showDirectoryPicker({ mode: "readwrite" })); } catch { /* kept as it was */ }
  };

  const cleanup = () => {
    const r = run.current;
    if (!r) return;
    r.stopped = true;
    r.scaler?.stop();
    r.display?.getTracks().forEach((t) => t.stop());
    r.ctx?.close().catch(() => {});
    run.current = null;
  };
  const leaveFull = () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); };

  // Esc (leaving full screen) or stopping the share ends the run.
  const stopAll = () => {
    const r = run.current;
    if (!r || r.stopped) return;
    r.stopped = true;
    if (r.rec?.state === "recording") { r.cancelled = true; r.rec.stop(); }
    waits.current.ended?.();
    waits.current.media?.();
  };
  useEffect(() => {
    if (!open) return undefined;
    const onFull = () => {
      const full = Boolean(document.fullscreenElement && document.fullscreenElement === overlayRef.current);
      setIsFull(full);
      if (!full && run.current?.recording) stopAll();
    };
    document.addEventListener("fullscreenchange", onFull);
    return () => document.removeEventListener("fullscreenchange", onFull);
  }, [open]);

  const share = async () => {
    setMessage("");
    try {
      const display = await captureTab();
      const [track] = display.getVideoTracks();
      if (window.CropTarget && track.cropTo) await track.cropTo(await window.CropTarget.fromElement(frameRef.current));
      const ctx = new AudioContext();
      const dest = ctx.createMediaStreamDestination();
      const mix = ctx.createGain();
      const even = evenAudio(ctx);
      mix.connect(ctx.destination);
      mix.connect(even.input);
      even.output.connect(dest);
      await ctx.resume();
      const scaler = scaledTrack(track, dim);
      await scaler.ready;
      run.current = { display, ctx, dest, mix, scaler, tapped: new WeakSet() };
      track.addEventListener("ended", () => { if (run.current?.recording) stopAll(); else { cleanup(); setPhase("ready"); } });
      setPhase("armed");
    } catch (e) {
      cleanup();
      setPhase("ready");
      setMessage(e?.name === "NotAllowedError" ? "Recording needs permission to share this tab." : e?.message || "Couldn't start recording.");
    }
  };

  // The player's audio, and each clip's, into the mix (each element once).
  const tap = (el) => {
    const r = run.current;
    if (!r || !el || r.tapped.has(el)) return;
    try {
      r.ctx.createMediaElementSource(el).connect(r.mix);
      r.tapped.add(el);
    } catch { /* already wired */ }
  };
  const onMedia = (m) => { tap(m.audio); waits.current.media?.(); };
  const onEnded = () => setTimeout(() => waits.current.ended?.(), 700);

  // Sent to the server in parts while it records; the server makes the MP4.
  const recordOne = (r, lessonId) => new Promise((resolve) => {
    const { rec, mimeType } = recorderFor(r.scaler.track, r.dest.stream.getAudioTracks(), dim);
    const sink = uploadParts(lessonId);
    rec.ondataavailable = (e) => e.data.size && sink.push(e.data);
    r.rec = rec;
    const startedAt = performance.now();
    let playAt = startedAt;
    rec.onstop = () => resolve({ sink, mimeType, seconds: (performance.now() - startedAt) / 1000, offset: (playAt - startedAt) / 1000, cancelled: r.cancelled });
    waits.current.ended = () => { waits.current.ended = null; if (rec.state === "recording") rec.stop(); };
    rec.start(1000);
    setTimeout(() => {
      if (r.stopped) return;
      playAt = performance.now();
      setSignal((n) => n + 1);
    }, 600);
  });

  const go = async () => {
    const r = run.current;
    if (!r) return;
    try { await overlayRef.current?.requestFullscreen?.(); } catch { /* records in the window instead */ }
    r.recording = true;
    setPhase("recording");
    const pad = String(chosen.length).length < 2 ? 2 : String(chosen.length).length;
    const done = [];
    let failed = "";
    for (let i = 0; i < chosen.length && !r.stopped; i += 1) {
      const l = chosen[i];
      try {
        const res = await fetch(`/api/video-lessons?lecture=${l._id}`, { credentials: "include" });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.lesson) throw new Error(body.message || "Couldn't load it.");
        const lesson = sameOriginLesson(body.lesson);
        // Mount the player and wait for its media, then a moment for the
        // pictures to load.
        const mounted = new Promise((ok) => { waits.current.media = () => { waits.current.media = null; ok(); }; });
        // Signal back to 0 with the new player, so it waits for its start.
        setSignal(0);
        setCurrent({ lesson, index: i, total: chosen.length, title: l.title });
        await mounted;
        await new Promise((ok) => setTimeout(ok, 1200));
        if (r.stopped) break;
        const base = `${String(i + 1).padStart(pad, "0")} - ${safeName(l.title, "Lecture")}`;
        const out = await recordOne(r, lesson._id);
        if (out.cancelled) break;
        const made = await out.sink.finish(`seconds=${Math.round(out.seconds)}&to=download&h=${dim.height}`);
        if (dir) {
          // Streamed from the server into the file, not through memory.
          const res = await fetch(`${made.download}&name=${encodeURIComponent(base)}`, { credentials: "include" });
          if (!res.ok) throw new Error(`Fetching the MP4 failed (${res.status}).`);
          await res.body.pipeTo(await (await dir.getFileHandle(`${base}.mp4`, { create: true })).createWritable());
        } else downloadUrl(made.download, base);
        if (captionFile) for (const [n, f] of captionFiles(captionCues(lesson, Math.max(0, out.offset)), base)) await saveFile(dir, n, f);
        done.push(`${base}.mp4`);
        setLog([...done]);
      } catch (e) {
        failed = `${l.title}: ${e.message}`;
        break;
      }
    }
    const source = r.scaler.source();
    const stoppedEarly = r.stopped;
    setCurrent(null);
    cleanup();
    leaveFull();
    if (r.closed) return;
    const notes = [`${done.length} of ${chosen.length} lecture${chosen.length === 1 ? "" : "s"} saved${dir ? ` in the folder "${dir.name}"` : " to your downloads"} (${dim.width}×${dim.height}).`];
    if (failed) notes.push(`Stopped at ${failed}`);
    else if (stoppedEarly && done.length < chosen.length) notes.push("Stopped; the lecture that was recording wasn't saved.");
    if (source?.height && source.height < dim.height) notes.push(`Your screen gave ${source.width}×${source.height}, so it was scaled up and may look a little soft.`);
    setPhase(failed ? "error" : "done");
    setMessage(notes.join(" "));
  };

  const close = () => {
    if (run.current) run.current.closed = true;
    stopAll();
    cleanup();
    leaveFull();
    setOpen(false);
    setPhase("ready");
    setMessage("");
    setLog([]);
    setCurrent(null);
  };

  const label = { color: "#fff", display: "flex", alignItems: "center", gap: 6, fontSize: 14 };
  const recordingFull = isFull && phase === "recording";

  return (
    <>
      <button type="button" className="btn btn-sm" disabled={!supported} title={supported ? "Every lecture's AI video lesson as HD files, for Udemy and other course sites" : "Recording needs Chrome or Edge on a computer."} onClick={() => setOpen(true)}>
        <Clapperboard size={14} /> Export course videos
      </button>
      {open && (
        <div ref={overlayRef} style={{ position: "fixed", inset: 0, zIndex: 1000, background: recordingFull ? "#000" : "rgba(10,12,18,0.92)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: recordingFull ? 0 : 14, padding: recordingFull ? 0 : 16, overflowY: "auto" }}>
          {/* The board area: the share is cropped to this. */}
          <div ref={frameRef} style={{ width: recordingFull ? "min(100vw, calc(100vh * 16 / 9))" : "min(960px, 94vw, calc(55vh * 16 / 9))", aspectRatio: "16 / 9", background: "#111", flex: "none" }}>
            {current && (
              <BoardPlayer key={current.lesson._id} lesson={current.lesson} recording showCaptions={burnIn} startSignal={signal} onEnded={onEnded} onClipMedia={tap} onMedia={onMedia} />
            )}
          </div>
          {!recordingFull && (
            <div style={{ color: "#fff", width: "min(960px, 94vw)", fontSize: 14 }} className="stack">
              <div style={{ fontWeight: 700, fontSize: 16 }}>Export course videos{name ? `: ${name}` : ""}</div>
              {phase === "ready" && (
                <>
                  <div style={{ color: "#cfd8dc" }}>
                    Each lecture's AI video lesson, in course order, as a {dim.width}×{dim.height} MP4 (made on the server) with even sound{captionFile ? " and a captions file" : ""}. It plays in real time with one share and full screen; keep this tab in front. <b>Esc</b> stops (finished lectures are kept). Nothing on the site changes.
                  </div>
                  {isFetching && !data ? <div>Loading lectures…</div> : lectures.length === 0 ? <div>No lectures in this batch.</div> : (
                    <div style={{ maxHeight: "28vh", overflowY: "auto", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, padding: 8 }}>
                      {lectures.map((l) => {
                        const why = readyOf(l, data?.voiceReady);
                        return (
                          <label key={l._id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", opacity: why ? 0.5 : 1 }}>
                            <input type="checkbox" disabled={Boolean(why)} checked={!why && (!picked || picked.has(l._id))} onChange={() => toggle(l._id)} />
                            <span style={{ flex: 1, minWidth: 0 }}>{l.title}{l.chapter ? <span style={{ color: "#90a4ae" }}> · {l.chapter}</span> : null}</span>
                            {why && <span style={{ color: "#ffcc80", fontSize: 12 }}>{why}</span>}
                          </label>
                        );
                      })}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                    <label style={label}>
                      Size
                      <select className="select" style={{ width: "auto" }} value={res} onChange={(e) => setRes(Number(e.target.value))}>
                        <option value={720}>720p (light)</option>
                        <option value={1080}>1080p (needs a stronger PC)</option>
                      </select>
                    </label>
                    <label style={label}><input type="checkbox" checked={captionFile} onChange={(e) => setCaptionFile(e.target.checked)} /> Captions files (.srt, .vtt)</label>
                    <label style={label}><input type="checkbox" checked={burnIn} onChange={(e) => setBurnIn(e.target.checked)} /> Captions in the video</label>
                    {canPickFolder && (
                      <button type="button" className="btn btn-sm" onClick={pickFolder}><FolderOpen size={13} /> {dir ? `Folder: ${dir.name}` : "Save into a folder…"}</button>
                    )}
                    {!dir && <span style={{ color: "#90a4ae", fontSize: 12 }}>{canPickFolder ? "Or they go to your downloads (Chrome may ask to allow several)." : "They go to your downloads (Chrome may ask to allow several)."}</span>}
                  </div>
                </>
              )}
              {phase === "armed" && <div>Sharing is on. Click below: it goes full screen and records {chosen.length} lecture{chosen.length === 1 ? "" : "s"} back to back. <b>Esc</b> stops.</div>}
              {phase === "recording" && current && <div><Circle size={10} fill="#e53935" color="#e53935" /> Recording {current.index + 1} of {current.total}: {current.title}</div>}
              {log.length > 0 && phase !== "ready" && <div style={{ color: "#cfd8dc", fontSize: 12 }}>Saved: {log.join(", ")}</div>}
              {message && <div style={{ color: phase === "error" ? "#ff8a80" : "#cfd8dc" }}>{phase === "done" && <Check size={14} />} {message}</div>}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {phase === "ready" && (
                  <button type="button" className="btn btn-primary" disabled={chosen.length === 0} onClick={share}><Circle size={13} /> Start ({chosen.length})</button>
                )}
                {phase === "armed" && <button type="button" className="btn btn-primary" onClick={go}><Maximize size={13} /> Full screen and record</button>}
                {(phase === "done" || phase === "error") && <button type="button" className="btn" onClick={() => { setPhase("ready"); setMessage(""); setLog([]); refetch(); }}>Again</button>}
                <button type="button" className="btn" onClick={close}><X size={14} /> {phase === "recording" ? "Stop" : "Close"}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
