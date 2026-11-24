import { useCallback, useEffect, useRef, useState } from "react";
import { Box, CircularProgress, Typography, useTheme } from "@mui/material";
import { Play, Pause, RotateCcw, RotateCw, Volume2, Volume1, VolumeX, Maximize, Minimize, Settings2, Check, ChevronLeft } from "lucide-react";
import { API_ROOT } from "../api/apiBase";
import { nativeHeaders } from "../native/session";
import { useBranding } from "../BrandingContext";
import { openProtected } from "../utils/protectedHls";

// The app's own video player, for video files and protected videos: in the
// school's colour, with skip buttons, speed and quality menus, keyboard
// keys, double-tap to skip on phones, and full screen that keeps the name
// watermark on top (it goes full screen on `boxRef`, which holds both).
// Settings → Student app → Video player sets the colour, the skip length
// and which quality it starts in.

const MESSAGES = {
  409: "This video is now playing on another device. Reload the page to watch here.",
  401: "Sign in again to watch this video.",
  440: "Sign in again to watch this video.",
  403: "This video was opened on another account.",
  410: "This link has expired. Reload the page.",
  429: "Too many video requests. Wait a few minutes.",
  insecure: "Protected videos need a secure (https) page.",
};
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

const store = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const clock = (s) => {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(Math.floor(s % 60)).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
};
const playerId = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");

export default function BrandPlayer({ src, hls: isHls, title, boxRef }) {
  const theme = useTheme();
  const { videoPlayer = {} } = useBranding() || {};
  const accent = /^#[0-9a-f]{6}$/i.test(videoPlayer.accent || "") ? videoPlayer.accent : theme.palette.primary.main;
  const skip = [5, 10, 15, 30].includes(Number(videoPlayer.skip)) ? Number(videoPlayer.skip) : 10;

  const video = useRef(null);
  const hlsRef = useRef(null);
  const hideTimer = useRef(null);
  const tapRef = useRef({ t: 0, side: null });
  const bar = useRef(null);

  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(() => store.get("player.volume", 1));
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(() => store.get("player.speed", 1));
  const [levels, setLevels] = useState([]); // [{ index, height }]
  const [level, setLevel] = useState(-1); // -1 = auto
  const [shownLevel, setShownLevel] = useState(null);
  const [menu, setMenu] = useState(null); // null | "main" | "speed" | "quality"
  const [controls, setControls] = useState(true);
  const [full, setFull] = useState(false);
  const [error, setError] = useState("");
  const [hover, setHover] = useState(null); // { x, t } over the progress bar
  const [flash, setFlash] = useState(null); // "back" | "fwd"
  const [started, setStarted] = useState(false);

  // ---------------------------------------------------------------- source
  useEffect(() => {
    const el = video.current;
    if (!el || !src) return undefined;
    setError("");
    setLevels([]);
    setLevel(-1);
    let gone = false;
    if (!isHls) {
      el.src = src;
      return () => { el.removeAttribute("src"); el.load(); };
    }
    const player = playerId();
    const url = `${src.startsWith("/") ? API_ROOT : ""}${src}${src.includes("?") ? "&" : "?"}p=${player}`;
    let viewing = null;
    import("hls.js").then(async ({ default: Hls }) => {
      if (gone) return;
      if (!Hls.isSupported()) {
        setError("This device can't play protected videos. Update the browser or try Chrome.");
        return;
      }
      try {
        viewing = /\/api\/stream\/hls\//.test(url)
          ? await openProtected(Hls, url, player, nativeHeaders())
          : { url, loader: Hls.DefaultConfig.loader, stop: () => {} };
      } catch (err) {
        if (!gone) setError(MESSAGES[err.code] || "This video couldn't play. Reload the page.");
        return;
      }
      if (gone) { viewing.stop(); return; }
      const best = videoPlayer.startQuality === "best";
      const h = new Hls({
        loader: viewing.loader,
        xhrSetup: (xhr) => {
          xhr.withCredentials = Boolean(API_ROOT);
          for (const [k, v] of Object.entries(nativeHeaders())) xhr.setRequestHeader(k, v);
        },
        // Assume a decent connection at first, so the opening seconds aren't
        // the blurry lowest quality; it steps down if the line can't keep up.
        abrEwmaDefaultEstimate: 4_000_000,
        maxBufferLength: 30,
      });
      hlsRef.current = h;
      h.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
        const list = data.levels.map((l, index) => ({ index, height: l.height })).sort((a, b) => b.height - a.height);
        setLevels(list);
        if (best && list.length) h.startLevel = list[0].index;
      });
      h.on(Hls.Events.LEVEL_SWITCHED, (_, d) => setShownLevel(h.levels[d.level]?.height || null));
      h.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal) return;
        const code = data.response?.code;
        if (MESSAGES[code]) {
          setError(MESSAGES[code]);
          h.destroy();
        } else if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          h.startLoad();
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          h.recoverMediaError();
        } else {
          setError("This video couldn't play. Reload the page.");
        }
      });
      h.loadSource(viewing.url);
      h.attachMedia(el);
    });
    return () => {
      gone = true;
      viewing?.stop();
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, isHls]);

  // ---------------------------------------------------------------- media events
  useEffect(() => {
    const el = video.current;
    if (!el) return undefined;
    el.volume = volume;
    el.playbackRate = speed;
    const on = {
      play: () => { setPlaying(true); setStarted(true); },
      pause: () => setPlaying(false),
      waiting: () => setWaiting(true),
      playing: () => setWaiting(false),
      canplay: () => setWaiting(false),
      timeupdate: () => setTime(el.currentTime),
      durationchange: () => setDuration(el.duration),
      loadedmetadata: () => { setDuration(el.duration); el.playbackRate = store.get("player.speed", 1); },
      progress: () => { if (el.buffered.length) setBuffered(el.buffered.end(el.buffered.length - 1)); },
      volumechange: () => { setMuted(el.muted); setVolume(el.volume); },
    };
    Object.entries(on).forEach(([k, f]) => el.addEventListener(k, f));
    return () => Object.entries(on).forEach(([k, f]) => el.removeEventListener(k, f));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const f = () => setFull(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", f);
    return () => document.removeEventListener("fullscreenchange", f);
  }, []);

  // ---------------------------------------------------------------- actions
  const poke = useCallback(() => {
    setControls(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => { if (video.current && !video.current.paused) { setControls(false); setMenu(null); } }, 2800);
  }, []);
  useEffect(() => () => clearTimeout(hideTimer.current), []);
  useEffect(() => { if (!playing) setControls(true); else poke(); }, [playing, poke]);

  const toggle = () => {
    const el = video.current;
    if (!el || error) return;
    if (el.paused) el.play().catch(() => {}); else el.pause();
  };
  const seekBy = (s) => {
    const el = video.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min((el.duration || 0) - 0.2, el.currentTime + s));
    setFlash(s < 0 ? "back" : "fwd");
    setTimeout(() => setFlash(null), 450);
    poke();
  };
  const setVol = (v) => {
    const el = video.current;
    if (!el) return;
    el.volume = Math.max(0, Math.min(1, v));
    el.muted = el.volume === 0;
    store.set("player.volume", el.volume);
  };
  const toggleMute = () => { const el = video.current; if (el) el.muted = !el.muted; };
  const pickSpeed = (s) => {
    if (video.current) video.current.playbackRate = s;
    setSpeed(s);
    store.set("player.speed", s);
    setMenu(null);
  };
  const pickLevel = (i) => {
    if (hlsRef.current) hlsRef.current.currentLevel = i;
    setLevel(i);
    setMenu(null);
  };
  const toggleFull = () => {
    const box = boxRef?.current;
    const el = video.current;
    if (document.fullscreenElement) document.exitFullscreen();
    else if (box?.requestFullscreen) box.requestFullscreen().catch(() => el?.webkitEnterFullscreen?.());
    else el?.webkitEnterFullscreen?.(); // iPhone: the system's own full screen
  };

  // Click the picture: play/pause. Double-click: full screen. On a phone,
  // a double tap on the left or right third skips back or forward.
  const onSurface = (e) => {
    poke();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const side = x < 0.33 ? "back" : x > 0.67 ? "fwd" : "mid";
    const now = Date.now();
    const quick = now - tapRef.current.t < 300 && tapRef.current.side === side;
    tapRef.current = { t: now, side };
    if (e.pointerType === "touch") {
      if (quick && side !== "mid") { seekBy(side === "back" ? -skip : skip); return; }
      if (!controls) return; // first tap just shows the controls
      setTimeout(() => { if (tapRef.current.t === now) toggle(); }, 280);
      return;
    }
    if (quick) { toggle(); toggleFull(); return; }
    toggle();
  };

  const onKey = (e) => {
    const k = e.key.toLowerCase();
    const map = {
      " ": toggle, k: toggle, arrowleft: () => seekBy(-skip), j: () => seekBy(-skip), arrowright: () => seekBy(skip), l: () => seekBy(skip),
      arrowup: () => setVol(volume + 0.1), arrowdown: () => setVol(volume - 0.1), m: toggleMute, f: toggleFull,
    };
    if (map[k]) { e.preventDefault(); map[k](); poke(); }
  };

  // Dragging along the progress bar.
  const timeAt = (clientX) => {
    const r = bar.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * (duration || 0);
  };
  const onBarDown = (e) => {
    e.stopPropagation();
    const el = video.current;
    if (!el || !duration) return;
    el.currentTime = timeAt(e.clientX);
    const move = (ev) => { el.currentTime = timeAt(ev.clientX); setHover({ x: ev.clientX - bar.current.getBoundingClientRect().left, t: el.currentTime }); };
    // Capture phase: the controls stop pointerup bubbling, and a missed
    // release left every later mouse move seeking.
    const up = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      setHover(null);
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
  };

  // ---------------------------------------------------------------- view
  const pct = (v) => `${duration ? Math.min(100, (v / duration) * 100) : 0}%`;
  const VolIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const qualityLabel = level === -1 ? `Auto${shownLevel ? ` (${shownLevel}p)` : ""}` : `${levels.find((l) => l.index === level)?.height}p`;
  const btn = {
    border: "none", background: "none", color: "#fff", p: 0.75, borderRadius: 1, display: "flex", alignItems: "center", gap: 0.5,
    cursor: "pointer", fontSize: 13, fontFamily: "inherit", "&:hover": { bgcolor: "rgba(255,255,255,0.14)" },
    "&:focus-visible": { outline: `2px solid ${accent}`, outlineOffset: 1 },
  };
  const row = { ...btn, width: "100%", justifyContent: "space-between", px: 1.5, py: 1, borderRadius: 0 };

  return (
    <Box tabIndex={0} onKeyDown={onKey} onPointerMove={poke} aria-label={title}
      sx={{ position: "absolute", inset: 0, bgcolor: "#000", outline: "none", cursor: controls || !playing ? "default" : "none", userSelect: "none", "--accent": accent }}>
      <Box component="video" ref={video} playsInline disablePictureInPicture controlsList="nodownload noremoteplayback" title={title}
        sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", bgcolor: "#000" }} />

      {/* The picture itself: tap targets. */}
      <Box onPointerUp={onSurface} sx={{ position: "absolute", inset: 0, zIndex: 6 }} />

      {/* Skip flash */}
      {flash && (
        <Box sx={{ position: "absolute", top: "50%", [flash === "back" ? "left" : "right"]: "12%", transform: "translateY(-50%)", zIndex: 7, pointerEvents: "none",
          bgcolor: "rgba(0,0,0,0.5)", color: "#fff", borderRadius: 99, px: 2, py: 1, display: "flex", alignItems: "center", gap: 0.75, fontSize: 14, fontWeight: 600 }}>
          {flash === "back" ? <RotateCcw size={18} /> : <RotateCw size={18} />}{skip}s
        </Box>
      )}

      {/* Big play button before it starts / when paused; spinner while loading */}
      {!error && (waiting && started ? (
        <CircularProgress size={44} sx={{ position: "absolute", top: "50%", left: "50%", mt: "-22px", ml: "-22px", color: accent, zIndex: 7, pointerEvents: "none" }} />
      ) : !playing ? (
        <Box component="button" type="button" aria-label="Play" onClick={toggle}
          sx={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", zIndex: 8, width: 68, height: 68, borderRadius: "50%", border: "none",
            bgcolor: accent, color: theme.palette.getContrastText(accent), display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
            boxShadow: "0 6px 24px rgba(0,0,0,0.35)", transition: "transform .15s", "&:hover": { transform: "translate(-50%, -50%) scale(1.06)" } }}>
          <Play size={30} fill="currentColor" style={{ marginLeft: 3 }} />
        </Box>
      ) : null)}

      {/* Controls */}
      <Box onPointerUp={(e) => e.stopPropagation()}
        sx={{ position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 9, px: { xs: 1, sm: 1.5 }, pt: 4, pb: 0.75,
          background: "linear-gradient(transparent, rgba(0,0,0,0.75))", transition: "opacity .2s", opacity: controls ? 1 : 0, pointerEvents: controls ? "auto" : "none" }}>
        {/* Progress */}
        <Box ref={bar} onPointerDown={onBarDown}
          onPointerMove={(e) => { if (duration) setHover({ x: e.clientX - bar.current.getBoundingClientRect().left, t: timeAt(e.clientX) }); }}
          onPointerLeave={() => setHover(null)}
          sx={{ position: "relative", height: 16, display: "flex", alignItems: "center", cursor: "pointer", touchAction: "none", "&:hover .track": { height: 6 }, "&:hover .knob": { transform: "translate(-50%, -50%) scale(1)" } }}>
          <Box className="track" sx={{ position: "relative", width: "100%", height: 4, borderRadius: 2, bgcolor: "rgba(255,255,255,0.25)", transition: "height .15s" }}>
            <Box sx={{ position: "absolute", inset: 0, width: pct(buffered), bgcolor: "rgba(255,255,255,0.35)", borderRadius: 2 }} />
            <Box sx={{ position: "absolute", inset: 0, width: pct(time), bgcolor: accent, borderRadius: 2 }} />
          </Box>
          <Box className="knob" sx={{ position: "absolute", left: pct(time), top: "50%", width: 14, height: 14, borderRadius: "50%", bgcolor: accent, transform: "translate(-50%, -50%) scale(0.7)", transition: "transform .15s", boxShadow: "0 0 0 3px rgba(0,0,0,0.25)" }} />
          {hover && (
            <Box sx={{ position: "absolute", bottom: 20, left: hover.x, transform: "translateX(-50%)", bgcolor: "rgba(0,0,0,0.8)", color: "#fff", fontSize: 12, px: 0.75, py: 0.25, borderRadius: 0.5, pointerEvents: "none", fontVariantNumeric: "tabular-nums" }}>
              {clock(hover.t)}
            </Box>
          )}
        </Box>

        {/* Buttons */}
        <Box sx={{ display: "flex", alignItems: "center", gap: { xs: 0, sm: 0.5 }, mt: 0.25 }}>
          <Box component="button" type="button" sx={btn} onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
            {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
          </Box>
          <Box component="button" type="button" sx={btn} onClick={() => seekBy(-skip)} aria-label={`Back ${skip} seconds`}><RotateCcw size={18} /></Box>
          <Box component="button" type="button" sx={btn} onClick={() => seekBy(skip)} aria-label={`Forward ${skip} seconds`}><RotateCw size={18} /></Box>
          <Box sx={{ display: "flex", alignItems: "center", "&:hover .vol": { width: 70, opacity: 1, ml: 0.5 } }}>
            <Box component="button" type="button" sx={btn} onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}><VolIcon size={19} /></Box>
            <Box className="vol" component="input" type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} aria-label="Volume"
              onChange={(e) => setVol(Number(e.target.value))}
              sx={{ width: 0, opacity: 0, transition: "all .2s", accentColor: accent, display: { xs: "none", sm: "block" }, cursor: "pointer" }} />
          </Box>
          <Typography sx={{ color: "#fff", fontSize: 13, ml: 0.75, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
            {clock(time)} <Box component="span" sx={{ opacity: 0.6 }}>/ {clock(duration)}</Box>
          </Typography>
          <Box sx={{ flex: 1 }} />
          {speed !== 1 && <Typography sx={{ color: "#fff", fontSize: 12, opacity: 0.8, mr: 0.5 }}>{speed}×</Typography>}
          <Box component="button" type="button" sx={btn} onClick={() => setMenu(menu ? null : "main")} aria-label="Settings"><Settings2 size={19} /></Box>
          <Box component="button" type="button" sx={btn} onClick={toggleFull} aria-label={full ? "Exit full screen" : "Full screen"}>
            {full ? <Minimize size={19} /> : <Maximize size={19} />}
          </Box>
        </Box>

        {/* Settings menu: inside the player, so it works in full screen too. */}
        {menu && (
          <Box sx={{ position: "absolute", right: 8, bottom: 56, minWidth: 210, maxHeight: "70vh", overflowY: "auto", bgcolor: "rgba(20,20,24,0.95)", borderRadius: 1.5, py: 0.5, boxShadow: "0 8px 30px rgba(0,0,0,0.5)" }}>
            {menu === "main" && (
              <>
                <Box component="button" type="button" sx={row} onClick={() => setMenu("speed")}>
                  <span>Speed</span><Box component="span" sx={{ opacity: 0.7 }}>{speed === 1 ? "Normal" : `${speed}×`}</Box>
                </Box>
                {levels.length > 1 && (
                  <Box component="button" type="button" sx={row} onClick={() => setMenu("quality")}>
                    <span>Quality</span><Box component="span" sx={{ opacity: 0.7 }}>{qualityLabel}</Box>
                  </Box>
                )}
              </>
            )}
            {menu !== "main" && (
              <Box component="button" type="button" sx={{ ...row, justifyContent: "flex-start", borderBottom: "1px solid rgba(255,255,255,0.12)" }} onClick={() => setMenu("main")}>
                <ChevronLeft size={16} /> {menu === "speed" ? "Speed" : "Quality"}
              </Box>
            )}
            {menu === "speed" && SPEEDS.map((s) => (
              <Box key={s} component="button" type="button" sx={row} onClick={() => pickSpeed(s)}>
                <span>{s === 1 ? "Normal" : `${s}×`}</span>{s === speed && <Check size={16} color={accent} />}
              </Box>
            ))}
            {menu === "quality" && [{ index: -1, height: null }, ...levels].map((l) => (
              <Box key={l.index} component="button" type="button" sx={row} onClick={() => pickLevel(l.index)}>
                <span>{l.index === -1 ? `Auto${level === -1 && shownLevel ? ` (${shownLevel}p)` : ""}` : `${l.height}p${l.height >= 720 ? " HD" : ""}`}</span>
                {l.index === level && <Check size={16} color={accent} />}
              </Box>
            ))}
          </Box>
        )}
      </Box>

      {error && (
        <Box sx={{ position: "absolute", inset: 0, zIndex: 10, display: "flex", alignItems: "center", justifyContent: "center", p: 3, bgcolor: "rgba(0,0,0,0.82)" }}>
          <Typography variant="body2" sx={{ color: "#fff", textAlign: "center", maxWidth: 360 }}>{error}</Typography>
        </Box>
      )}
    </Box>
  );
}
