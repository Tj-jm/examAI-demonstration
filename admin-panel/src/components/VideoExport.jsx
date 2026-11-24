import { useEffect, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import { Film, X, Circle, Check, Maximize } from "lucide-react";
// Namespace import: this needs the api slice object itself (for
// .util.invalidateTags), not one of its generated hooks.
import * as apiModule from "../api/apiSlice";
import fixWebmDuration from "fix-webm-duration";
import BoardPlayer from "./BoardPlayer";
import { useGetMediaProvidersQuery } from "../api/contentApi";
import { SIZES, captureTab, scaledTrack, evenAudio, recorderFor, uploadParts, captionCues, captionFiles, download, downloadUrl, safeName } from "./videoHd";

// Records the board player into a video file, in this browser: Chrome
// captures this tab cropped to the board, the voice is taken straight
// from the player, and the result is saved as the question's solution
// video or the lecture's video (backend videoLessonController.js
// exportLesson). It plays in real time, so a 5-minute lesson takes 5
// minutes, with this tab open and in front.
//
// HD (720p or 1080p) is the course-site export (Udemy and the like): full screen,
// recorded at that size and made into an H.264 MP4 on the server, evened-out
// sound, and a captions file (.srt and .vtt) from the lesson's timing. It
// can be downloaded instead of (or as well as being) saved here. The
// standard export below is unchanged.
const pickType = () => {
  // WebM first: Chrome's MP4 recording is newer and its files can stall at
  // 0:00 when played back. MP4 is the fallback for browsers without WebM.
  const types = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4"];
  return types.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || "";
};

export default function VideoExport({ lesson, disabled, question }) {
  const dispatch = useDispatch();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState("ready"); // ready | recording | saving | done | error
  const [message, setMessage] = useState("");
  const [signal, setSignal] = useState(0);
  const [withCaptions, setWithCaptions] = useState(true);
  // Where the video goes: storage, or a video provider that takes uploads.
  const { data: providers } = useGetMediaProvidersQuery(undefined, { skip: !open });
  const targets = (providers?.video || []).filter((p) => p.upload);
  const [to, setTo] = useState("");
  const saveTo = to || (targets.some((p) => p.name === "vdocipher") ? "vdocipher" : "storage");
  // HD export (see videoHd.js).
  const [quality, setQuality] = useState("standard");
  const hd = quality.startsWith("hd");
  const dim = quality === "hd1080" ? SIZES[1080] : SIZES[720];
  const [hdTo, setHdTo] = useState("download");
  const [captionFile, setCaptionFile] = useState(true);
  const [isFull, setIsFull] = useState(false);
  const overlayRef = useRef(null);
  const media = useRef({});
  const run = useRef(null);
  // Optional: the server plays it and makes the MP4 (no screen recording).
  const [srvH, setSrvH] = useState(720);
  const [srvTo, setSrvTo] = useState("download");
  const [srvCaps, setSrvCaps] = useState(true);
  // The downloaded file's name (no extension); the title until changed.
  const [srvName, setSrvName] = useState("");
  const zipIt = srvTo === "zip";
  const srvRun = useRef(0);
  const serverMake = async () => {
    const mine = ++srvRun.current;
    setPhase("server");
    setMessage("Asking the server…");
    try {
      const res = await fetch(`/api/video-lessons/${lesson._id}/render`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ h: srvH, to: zipIt ? "download" : srvTo, captions: withCaptions, captionFile: zipIt || srvCaps }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || `The server couldn't start it (${res.status}).`);
      for (;;) {
        await new Promise((ok) => setTimeout(ok, 3000));
        if (srvRun.current !== mine) return;
        const st = await fetch(`/api/video-lessons/${lesson._id}/export/status?upload=${body.job}`, { credentials: "include" }).then((r) => r.json()).catch(() => ({ state: "working" }));
        if (st.state === "error" || (st.message && st.state !== "working")) throw new Error(st.message || "Making the video failed.");
        if (st.state === "done") {
          const base = safeName(srvName.trim() || lesson.title || (question ? "Solution" : "Lecture"));
          if (zipIt) {
            downloadUrl(`${st.download}&zip=1`, base, "zip");
            setMessage(`Downloading ${base}.zip: the video (${(st.sizeBytes / 1e6).toFixed(1)} MB)${st.captions ? " and its captions (.srt, .vtt)" : ""}.`);
            setPhase("done");
            return;
          }
          if (srvTo === "download") {
            downloadUrl(st.download, base);
            setMessage(`Downloading ${base}.mp4 (${(st.sizeBytes / 1e6).toFixed(1)} MB).`);
          } else {
            dispatch(apiModule.apiSlice.util.invalidateTags(["VideoLesson", "Question", "Lecture"]));
            setMessage(`Saved in ${srvH}p as this ${question ? "question's solution video" : "lecture's video"}.${st.uploadError ? ` The video service didn't take it (${st.uploadError}), so it's kept in storage.` : ""}`);
          }
          if (st.captions) {
            download(new Blob([st.captions.srt], { type: "application/x-subrip" }), `${base}.srt`);
            download(new Blob([st.captions.vtt], { type: "text/vtt" }), `${base}.vtt`);
            setMessage((m) => `${m} Captions downloaded (.srt and .vtt).`);
          }
          setPhase("done");
          return;
        }
        setMessage(`${st.step || "Working"}…`);
      }
    } catch (e) {
      if (srvRun.current !== mine) return;
      setPhase("error");
      setMessage(e.message);
    }
  };
  const supported = Boolean(navigator.mediaDevices?.getDisplayMedia && window.MediaRecorder && window.AudioContext);

  // Same-origin audio, so the recording isn't silent when storage sends no
  // CORS headers.
  const exportLesson = {
    ...lesson,
    segments: lesson.segments.map((s) => ({
      ...s,
      audioUrl: s.audioUrl ? `/api/video-lessons/${lesson._id}/audio/${s._id}` : null,
      parts: s.parts ? s.parts.map((p, i) => ({ ...p, audioUrl: p.audioUrl ? `/api/video-lessons/${lesson._id}/audio/${s._id}?clip=${i}` : null })) : s.parts,
      board: (s.board || []).map((b, k) => (b.type === "clip" ? {
        ...b,
        ...(b.url ? { url: `/api/video-lessons/${lesson._id}/clip/${s._id}/${k}` } : {}),
        ...(b.lines ? { lines: b.lines.map((l, n) => ({ ...l, audioUrl: l.audioUrl ? `/api/video-lessons/${lesson._id}/audio/${s._id}?line=${k}.${n}` : null })) } : {}),
      } : b)),
    })),
  };
  // A clip's sound goes into the recording too (each element only once).
  const tapped = useRef(new WeakSet());
  const tapClip = (el) => {
    const { ctx, mix } = media.current;
    if (!ctx || tapped.current.has(el)) return;
    try {
      const src = ctx.createMediaElementSource(el);
      src.connect(mix);
      tapped.current.add(el);
    } catch { /* already wired */ }
  };

  const cleanup = () => {
    const r = run.current;
    if (!r) return;
    r.scaler?.stop();
    r.display?.getTracks().forEach((t) => t.stop());
    r.ctx?.close().catch(() => {});
    run.current = null;
  };

  const start = async () => {
    setMessage("");
    try {
      const display = hd ? await captureTab() : await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "browser", frameRate: 30 },
        audio: false,
        preferCurrentTab: true,
        selfBrowserSurface: "include",
      });
      const [track] = display.getVideoTracks();
      if (window.CropTarget && track.cropTo) await track.cropTo(await window.CropTarget.fromElement(media.current.stage));
      // The audio element can be wired into an AudioContext only once.
      // Everything sounding goes through one bus (mix): to the speakers, and
      // to the recording either as it is or evened out (HD).
      let { ctx, dest, mix, even } = media.current;
      if (!ctx) {
        ctx = new AudioContext();
        dest = ctx.createMediaStreamDestination();
        mix = ctx.createGain();
        even = evenAudio(ctx);
        even.output.connect(dest);
        const src = ctx.createMediaElementSource(media.current.audio);
        src.connect(mix);
        media.current = { ...media.current, ctx, dest, mix, even };
      }
      mix.disconnect();
      mix.connect(ctx.destination);
      mix.connect(hd ? even.input : dest);
      await ctx.resume();
      if (hd) {
        // Shared; now one more click for full screen (it needs its own
        // click), then it records.
        const scaler = scaledTrack(track, dim);
        await scaler.ready;
        const { rec, mimeType } = recorderFor(scaler.track, dest.stream.getAudioTracks(), dim);
        const chunks = [];
        // Sent to the server in parts while it records; the server makes
        // the MP4 (to save, or to download).
        const sink = uploadParts(lesson._id);
        rec.ondataavailable = (e) => e.data.size && (sink ? sink.push(e.data) : chunks.push(e.data));
        run.current = { display, scaler, rec, chunks, sink, mimeType, hd: true };
        track.addEventListener("ended", () => { if (run.current?.rec.state === "recording") { run.current.cancelled = true; run.current.rec.stop(); } else if (run.current && !run.current.startedAt) { cleanup(); setPhase("ready"); } });
        rec.onstop = () => finish();
        setPhase("armed");
        return;
      }
      const mimeType = pickType();
      const rec = new MediaRecorder(new MediaStream([track, ...dest.stream.getAudioTracks()]), { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 2500000 });
      const chunks = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      run.current = { display, rec, chunks, startedAt: performance.now(), mimeType: (mimeType || rec.mimeType || "video/webm").split(";")[0] };
      // Stopping the share from Chrome's bar cancels.
      track.addEventListener("ended", () => { if (run.current?.rec.state === "recording") { run.current.cancelled = true; run.current.rec.stop(); } });
      rec.onstop = () => finish();
      rec.start(1000);
      setPhase("recording");
      setTimeout(() => setSignal((n) => n + 1), 400);
    } catch (e) {
      cleanup();
      setPhase("ready");
      setMessage(e?.name === "NotAllowedError" ? "Recording needs permission to share this tab." : e?.message || "Couldn't start recording.");
    }
  };

  const goHd = async () => {
    const r = run.current;
    if (!r) return;
    try { await overlayRef.current?.requestFullscreen?.(); } catch { /* records in the window instead */ }
    // A moment for the layout to settle at full size.
    setTimeout(() => {
      if (run.current !== r) return;
      r.startedAt = performance.now();
      r.rec.start(1000);
      setPhase("recording");
      setTimeout(() => { r.playAt = performance.now(); setSignal((n) => n + 1); }, 600);
    }, 500);
  };

  // Leaving full screen (Esc) while recording in HD stops and discards.
  useEffect(() => {
    if (!open) return undefined;
    const onFull = () => {
      const full = Boolean(document.fullscreenElement && document.fullscreenElement === overlayRef.current);
      setIsFull(full);
      if (!full && run.current?.hd && run.current.rec.state === "recording") { run.current.cancelled = true; run.current.rec.stop(); }
    };
    document.addEventListener("fullscreenchange", onFull);
    return () => document.removeEventListener("fullscreenchange", onFull);
  }, [open]);
  const leaveFull = () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); };

  const ended = () => {
    // A moment for the last frame and sound to land.
    setTimeout(() => { if (run.current?.rec.state === "recording") run.current.rec.stop(); }, 700);
  };

  const finish = async () => {
    const r = run.current;
    if (!r) return;
    const seconds = (performance.now() - r.startedAt) / 1000;
    const source = r.scaler?.source();
    cleanup();
    if (r.hd) leaveFull();
    if (r.cancelled) { setPhase("ready"); setMessage("Recording stopped. Nothing was saved."); return; }
    if (r.hd) { finishHd(r, seconds, source); return; }
    setPhase("saving");
    try {
      let blob = new Blob(r.chunks, { type: r.mimeType });
      // A recorded WebM has no length in it, so players can't show or seek
      // it; write the length in.
      if (r.mimeType === "video/webm") blob = await fixWebmDuration(blob, seconds * 1000, { logger: false });
      const res = await fetch(`/api/video-lessons/${lesson._id}/export?seconds=${Math.round(seconds)}&to=${saveTo}`, {
        method: "POST", credentials: "include", headers: { "Content-Type": r.mimeType }, body: blob,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || `Saving failed (${res.status}).`);
      dispatch(apiModule.apiSlice.util.invalidateTags(["VideoLesson", "Question", "Lecture"]));
      setPhase("done");
      const where = question ? "question's solution video" : "lecture's video";
      const label = { vdocipher: "VdoCipher (DRM)", bunny: "Bunny Stream", vimeo: "Vimeo" }[body.media?.driver];
      setMessage(label
        ? `Sent to ${label} as this ${where}. It plays once ${label} finishes processing, usually a few minutes.`
        : `Saved as this ${where} (${(blob.size / 1e6).toFixed(1)} MB, ${r.mimeType === "video/mp4" ? "MP4" : "WebM"}).${body.uploadError ? ` The video service didn't take it (${body.uploadError}), so it's kept in storage.` : ""}`);
    } catch (e) {
      setPhase("error");
      setMessage(e.message);
    }
  };

  const finishHd = async (r, seconds, source) => {
    setPhase("saving");
    try {
      const base = safeName(lesson.title || (question ? "Solution" : "Lecture"));
      const notes = [];
      const out = await r.sink.finish(`seconds=${Math.round(seconds)}&to=${hdTo}&h=${dim.height}`, setMessage);
      if (hdTo === "download") {
        downloadUrl(out.download, base);
        notes.push(`Downloading ${base}.mp4 (${(out.sizeBytes / 1e6).toFixed(1)} MB, ${dim.width}×${dim.height} MP4).`);
      } else {
        dispatch(apiModule.apiSlice.util.invalidateTags(["VideoLesson", "Question", "Lecture"]));
        const label = { vdocipher: "VdoCipher (DRM)", bunny: "Bunny Stream", vimeo: "Vimeo" }[out.media?.driver];
        notes.push(label
          ? `Sent to ${label} in ${dim.height}p as this ${question ? "question's solution video" : "lecture's video"}.`
          : `Saved in ${dim.height}p as this ${question ? "question's solution video" : "lecture's video"} (${(out.media.sizeBytes / 1e6).toFixed(1)} MB).${out.uploadError ? ` The video service didn't take it (${out.uploadError}), so it's kept in storage.` : ""}`);
      }
      if (captionFile) {
        const offset = Math.max(0, ((r.playAt || r.startedAt) - r.startedAt) / 1000);
        for (const [name, file] of captionFiles(captionCues(lesson, offset), base)) download(file, name);
        notes.push("Captions downloaded (.srt and .vtt).");
      }
      if (source?.height && source.height < dim.height) notes.push(`Your screen gave ${source.width}×${source.height}, so it was scaled up and may look a little soft. A ${dim.height}p or sharper screen gives the crispest video.`);
      setPhase("done");
      setMessage(notes.join(" "));
    } catch (e) {
      setPhase("error");
      setMessage(e.message);
    }
  };

  const close = () => {
    if (phase === "recording" && run.current) { run.current.cancelled = true; run.current.rec.stop(); }
    srvRun.current += 1;
    cleanup();
    leaveFull();
    setOpen(false);
    setPhase("ready");
    setMessage("");
  };

  return (
    <>
      <button type="button" className="btn btn-sm" disabled={disabled || !supported} title={!supported ? "Recording needs Chrome or Edge on a computer." : disabled ? "Save the script and make the voice first." : ""} onClick={() => setOpen(true)}>
        <Film size={14} /> {lesson.exportedAt ? "Update" : "Save as"} {question ? "solution video" : "lecture video"}
      </button>
      {open && (
        <div ref={overlayRef} style={{ position: "fixed", inset: 0, zIndex: 1000, background: isFull ? "#000" : "rgba(10,12,18,0.88)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: isFull ? "center" : "safe center", overflowY: isFull ? "hidden" : "auto", gap: isFull ? 0 : 12, padding: isFull ? 0 : 16 }}>
          <div style={{ width: isFull ? "min(100vw, calc(100vh * 16 / 9))" : phase === "ready" ? "min(1280px, 94vw, calc((100vh - 300px) * 16 / 9))" : "min(1280px, 94vw, calc((100vh - 160px) * 16 / 9))" }}>
            <BoardPlayer lesson={exportLesson} recording showCaptions={withCaptions} startSignal={signal} onEnded={ended} onClipMedia={tapClip} onMedia={(m) => { media.current = { ...media.current, ...m }; }} />
          </div>
          {!(isFull && phase === "recording") && (<>
          <div style={{ color: "#fff", maxWidth: 760, textAlign: "center", fontSize: 14 }}>
            {phase === "ready" && !hd && <>Chrome will ask what to share: pick <b>this tab</b>. It records in real time; keep this tab open and in front until it finishes.</>}
            {phase === "ready" && hd && <>HD: {dim.width}×{dim.height} MP4, even sound{captionFile ? ", and a captions file" : ""}. Chrome will ask what to share: pick <b>this tab</b>. Then it goes full screen and records in real time. <b>Esc</b> stops and discards.</>}
            {phase === "armed" && <>Sharing is on. Click below: it goes full screen and starts. Keep your hands off until it ends; <b>Esc</b> stops and discards.</>}
            {phase === "recording" && <><Circle size={10} fill="#e53935" color="#e53935" /> Recording… keep this tab in front.</>}
            {phase === "saving" && "Saving the video…"}
            {phase === "server" && <>The server is playing the lesson and making the MP4 (about as long as the lesson). {srvTo === "download" ? "Keep this open to get the download." : "You can close this; it saves when done."}</>}
            {message && <div style={{ marginTop: 6, color: phase === "error" ? "#ff8a80" : "#cfd8dc" }}>{phase === "done" && <Check size={14} />} {message}</div>}
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
            {phase === "ready" && (
              <label style={{ color: "#fff", display: "flex", alignItems: "center", gap: 6, fontSize: 14 }}>
                Quality
                <select className="select" style={{ width: "auto" }} value={quality} onChange={(e) => { setQuality(e.target.value); if (e.target.value.startsWith("hd")) setWithCaptions(false); }}>
                  <option value="standard">Standard</option>
                  <option value="hd">HD 720p (Udemy-ready, light)</option>
                  <option value="hd1080">Full HD 1080p (Udemy-ready, needs a stronger PC)</option>
                </select>
              </label>
            )}
            {phase === "ready" && (
              <label style={{ color: "#fff", display: "flex", alignItems: "center", gap: 6, fontSize: 14 }}>
                <input type="checkbox" checked={withCaptions} onChange={(e) => setWithCaptions(e.target.checked)} /> Captions in the video
              </label>
            )}
            {phase === "ready" && hd && (
              <label style={{ color: "#fff", display: "flex", alignItems: "center", gap: 6, fontSize: 14 }}>
                <input type="checkbox" checked={captionFile} onChange={(e) => setCaptionFile(e.target.checked)} /> Captions file (.srt, .vtt)
              </label>
            )}
            {phase === "ready" && hd && (
              <label style={{ color: "#fff", display: "flex", alignItems: "center", gap: 6, fontSize: 14 }}>
                Save to
                <select className="select" style={{ width: "auto" }} value={hdTo} onChange={(e) => setHdTo(e.target.value)}>
                  <option value="download">This computer (download)</option>
                  <option value="storage">Your storage</option>
                  {targets.map((p) => <option key={p.name} value={p.name}>{p.label}</option>)}
                </select>
              </label>
            )}
            {phase === "ready" && !hd && targets.length > 0 && (
              <label style={{ color: "#fff", display: "flex", alignItems: "center", gap: 6, fontSize: 14 }}>
                Save to
                <select className="select" style={{ width: "auto" }} value={saveTo} onChange={(e) => setTo(e.target.value)}>
                  <option value="storage">Your storage</option>
                  {targets.map((p) => <option key={p.name} value={p.name}>{p.label}</option>)}
                </select>
              </label>
            )}
            {phase === "ready" && <button type="button" className="btn btn-primary" onClick={start}><Circle size={13} /> Start recording</button>}
            {phase === "armed" && <button type="button" className="btn btn-primary" onClick={goHd}><Maximize size={13} /> Full screen and record</button>}
            <button type="button" className="btn" onClick={close}><X size={14} /> {phase === "recording" ? "Stop and discard" : "Close"}</button>
          </div>
          {phase === "ready" && (
            <div style={{ color: "#cfd8dc", fontSize: 13, maxWidth: 760, border: "1px solid rgba(255,255,255,0.25)", borderRadius: 10, padding: "10px 14px", marginTop: 4 }}>
              <div style={{ color: "#fff", fontWeight: 600, textAlign: "center" }}>Or let the server make it (no screen sharing)</div>
              <div style={{ marginTop: 8, display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center", alignItems: "center" }}>
                <span>Uses the saved lesson. No mouse pointer, nothing on your screen. Takes about as long as the lesson.</span>
                <select className="select" style={{ width: "auto" }} value={srvH} onChange={(e) => setSrvH(Number(e.target.value))}>
                  <option value={720}>720p</option>
                  <option value={1080}>1080p</option>
                </select>
                <select className="select" style={{ width: "auto" }} value={srvTo} onChange={(e) => setSrvTo(e.target.value)}>
                  <option value="download">Download</option>
                  <option value="zip">Download as a zip (video and captions)</option>
                  <option value="storage">Your storage</option>
                  {targets.map((p) => <option key={p.name} value={p.name}>{p.label}</option>)}
                </select>
                {(srvTo === "download" || zipIt) && (
                  <input className="input" style={{ width: 220 }} placeholder={safeName(lesson.title || (question ? "Solution" : "Lecture"))} title="File name" aria-label="File name" maxLength={120} value={srvName} onChange={(e) => setSrvName(e.target.value)} />
                )}
                {!zipIt && (
                  <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input type="checkbox" checked={srvCaps} onChange={(e) => setSrvCaps(e.target.checked)} /> Captions file (.srt, .vtt)
                  </label>
                )}
                <button type="button" className="btn btn-sm" onClick={serverMake}><Film size={13} /> Make on the server</button>
              </div>
            </div>
          )}
          </>)}
        </div>
      )}
    </>
  );
}
