import { useEffect, useRef, useState } from "react";
import { Download, Mic, Film, Play, Square, Music, X } from "lucide-react";
import { usePosterVoiceMutation } from "../api/posterApi";
import { ErrorNote, Field } from "./bits";
import { preparePromo, drawPromoFrame, recordPromo, canRecord } from "../utils/promoVideo";
import { MUSIC, renderMusic } from "../utils/musicLibrary";

// The poster as a short promo video (utils/promoVideo.js): a looping
// preview, an optional AI voice reading the script and music from a file,
// then "Make video" plays it once while recording and offers the file.
export default function PromoVideo({ poster, size, palette, pictureStyle, style, language, voiceover, onVoiceover, voiceReady }) {
  const canvasRef = useRef(null);
  const [makeVoice, voiceState] = usePosterVoiceMutation();
  const [voice, setVoice] = useState(null); // { dataUrl, seconds, forText }
  const [music, setMusic] = useState(null); // a File of their own
  const [track, setTrack] = useState(""); // or a built-in track's id
  const [listening, setListening] = useState(false);
  const listenRef = useRef(null);
  const [phase, setPhase] = useState("preview"); // preview | recording | done
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null); // { url, type, seconds, size }
  const [error, setError] = useState("");
  const abort = useRef(null);
  const audioRef = useRef(null);

  const voiceSeconds = voice && voice.forText === voiceover ? voice.seconds : 0;
  const key = JSON.stringify({ poster, size, palette, pictureStyle, style, voiceSeconds });

  // The preview: plays on a loop until recording starts.
  useEffect(() => {
    if (phase === "recording") return undefined;
    let raf;
    let live = true;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    preparePromo(canvas, JSON.parse(key).poster, { size, palette, pictureStyle, style, voiceSeconds }).then(({ ctx, scene }) => {
      if (!live) return;
      const t0 = performance.now();
      const loop = () => {
        if (!live) return;
        const t = ((performance.now() - t0) / 1000) % (scene.timeline.total + 1.2);
        drawPromoFrame(ctx, scene, Math.min(t, scene.timeline.total));
        raf = requestAnimationFrame(loop);
      };
      loop();
    });
    return () => { live = false; cancelAnimationFrame(raf); };
  }, [key, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { if (result?.url) URL.revokeObjectURL(result.url); }, [result]);

  const runVoice = async () => {
    setError("");
    try {
      const data = await makeVoice({ text: voiceover, language }).unwrap();
      setVoice({ ...data, forText: voiceover });
    } catch { /* shown below */ }
  };

  const record = async () => {
    setError("");
    setResult(null);
    setPhase("recording");
    setProgress(0);
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      const out = await recordPromo(canvasRef.current, poster, { size, palette, pictureStyle, style }, {
        voice: voiceSeconds ? voice.dataUrl : null, music: music || (track ? (secs) => renderMusic(track, secs) : null), onProgress: setProgress, signal: ctl.signal,
      });
      if (out) setResult({ url: URL.createObjectURL(out.blob), type: out.type, seconds: out.seconds, size: out.blob.size });
      setPhase(out ? "done" : "preview");
    } catch (e) {
      setError(e?.message || "The video couldn't be made in this browser.");
      setPhase("preview");
    }
  };

  // Hear a built-in track (15 seconds of it).
  const stopListening = () => {
    try { listenRef.current?.stop(); } catch { /* ended */ }
    listenRef.current?.context?.close?.().catch(() => {});
    listenRef.current = null;
    setListening(false);
  };
  const listen = async () => {
    if (listening) return stopListening();
    setListening(true);
    const buf = await renderMusic(track, 15);
    const ctx = new AudioContext();
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.connect(ctx.destination);
    s.onended = stopListening;
    s.start();
    listenRef.current = s;
  };
  useEffect(() => stopListening, []); // eslint-disable-line react-hooks/exhaustive-deps

  const name = `${(poster.headline || "promo").replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 40)}.${result?.type === "video/mp4" ? "mp4" : "webm"}`;

  if (!canRecord()) return <p className="hint">This browser can't make videos. Use Chrome or Edge on a computer.</p>;

  return (
    <div className="stack" style={{ gap: 10 }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "auto", borderRadius: 8, border: "1px solid var(--border, #ddd)" }} />

      <Field label="Voice-over (optional)" hint={voiceReady ? "Write with AI writes one. Make voice reads it; the video stretches to fit it." : "Set up a voice in Settings → AI → Voice to add one."}>
        <textarea className="textarea" rows={3} value={voiceover || ""} maxLength={700} disabled={phase === "recording"} onChange={(e) => onVoiceover(e.target.value)}
          placeholder="Admission is open for HSC 27. Live classes, weekly exams and AI help. Enrol today." />
      </Field>
      <div className="row-tight" style={{ flexWrap: "wrap", gap: 8 }}>
        <button className="btn btn-sm" disabled={!voiceReady || !String(voiceover || "").trim() || voiceState.isLoading || phase === "recording"} onClick={runVoice}>
          <Mic size={14} /> {voiceState.isLoading ? "Making voice…" : voiceSeconds ? "Make voice again" : "Make voice"}
        </button>
        {voiceSeconds > 0 && (
          <>
            <button className="btn btn-sm btn-quiet" onClick={() => { const a = audioRef.current; if (a) { a.currentTime = 0; a.play().catch(() => {}); } }}><Play size={13} /> Hear it ({Math.round(voiceSeconds)} s)</button>
            <audio ref={audioRef} src={voice.dataUrl} preload="auto" />
          </>
        )}
        {voice && !voiceSeconds && <span className="hint">The script changed: make the voice again to use it.</span>}
      </div>
      <div className="row-tight" style={{ flexWrap: "wrap", gap: 8 }}>
        <Music size={14} className="muted" />
        <select className="select" style={{ width: "auto" }} value={music ? "file" : track} disabled={phase === "recording"}
          onChange={(e) => { stopListening(); if (e.target.value !== "file") { setMusic(null); setTrack(e.target.value); } }}>
          <option value="">No music</option>
          <optgroup label="Built-in (free to use)">
            {MUSIC.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </optgroup>
          {music && <option value="file">Your file: {music.name.slice(0, 30)}</option>}
        </select>
        {track && !music && <button className="btn btn-sm btn-quiet" onClick={listen}>{listening ? <><Square size={13} /> Stop</> : <><Play size={13} /> Listen</>}</button>}
        <label className="btn btn-sm" style={{ cursor: "pointer" }}>
          Upload music
          <input type="file" accept="audio/*" hidden disabled={phase === "recording"} onChange={(e) => { stopListening(); setMusic(e.target.files?.[0] || null); }} />
        </label>
        {music && <button className="btn btn-sm btn-quiet" onClick={() => setMusic(null)}><X size={13} /> Remove file</button>}
      </div>
      <ErrorNote error={voiceState.error} />
      {music && <p className="hint" style={{ margin: 0 }}>Use music you have the rights to: Facebook and Instagram mute or remove videos with copyrighted songs.</p>}

      <div className="row-tight" style={{ flexWrap: "wrap", gap: 8 }}>
        {phase === "recording" ? (
          <>
            <button className="btn" onClick={() => abort.current?.abort()}><Square size={14} /> Stop</button>
            <span className="small muted tnum">Recording… {Math.round(progress * 100)}%. Keep this tab open and in front.</span>
          </>
        ) : (
          <button className="btn btn-primary" disabled={!poster.headline} onClick={record}><Film size={15} /> {result ? "Make video again" : "Make video"}</button>
        )}
        {result && phase !== "recording" && (
          <a className="btn" href={result.url} download={name}><Download size={15} /> Download video ({(result.size / 1e6).toFixed(1)} MB, {result.type === "video/mp4" ? "MP4" : "WebM"})</a>
        )}
      </div>
      {result?.type === "video/webm" && phase !== "recording" && (
        <p className="hint" style={{ margin: 0 }}>This browser saves WebM. Facebook and YouTube take it; for Instagram, convert it to MP4 first (or make it in an up-to-date Chrome, which saves MP4).</p>
      )}
      <ErrorNote error={error ? { data: { message: error } } : null} />
    </div>
  );
}
