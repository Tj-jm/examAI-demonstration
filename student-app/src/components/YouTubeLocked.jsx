import { useEffect, useRef, useState } from "react";
import { Box, IconButton, Slider, Typography } from "@mui/material";
import { Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";

// YouTube with its own controls off and a layer over the player, so its
// title, logo and "Watch on YouTube" links can't be clicked and right-click
// does nothing. Play, seek, sound and speed are ours instead (Settings →
// Student app → Lock YouTube player).

let apiReady;
const loadApi = () => {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!apiReady) {
    apiReady = new Promise((resolve) => {
      const before = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        before?.();
        resolve(window.YT);
      };
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
    });
  }
  return apiReady;
};

export const youtubeId = (src) => String(src || "").match(/youtube(?:-nocookie)?\.com\/embed\/([\w-]{11})/)?.[1] || null;

const clock = (s) => {
  const t = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
};

const SPEEDS = [1, 1.25, 1.5, 2, 0.75];

export default function YouTubeLocked({ videoId, title }) {
  const host = useRef(null);
  const player = useRef(null);
  const [ready, setReady] = useState(false);
  const [state, setState] = useState("unstarted"); // unstarted | playing | paused | ended
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seeking, setSeeking] = useState(null);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    let gone = false;
    loadApi().then((YT) => {
      if (gone || !host.current) return;
      const el = document.createElement("div");
      host.current.appendChild(el);
      player.current = new YT.Player(el, {
        host: "https://www.youtube-nocookie.com",
        videoId,
        width: "100%",
        height: "100%",
        playerVars: { controls: 0, disablekb: 1, fs: 0, rel: 0, iv_load_policy: 3, playsinline: 1, modestbranding: 1, origin: window.location.origin },
        events: {
          onReady: (e) => {
            if (gone) return;
            e.target.getIframe().title = title;
            setDuration(e.target.getDuration() || 0);
            setReady(true);
          },
          onStateChange: (e) => {
            const s = { 0: "ended", 1: "playing", 2: "paused" }[e.data];
            if (s) setState(s);
            if (e.data === 1) setDuration(e.target.getDuration() || 0);
          },
        },
      });
    });
    return () => {
      gone = true;
      player.current?.destroy?.();
      player.current = null;
      if (host.current) host.current.innerHTML = "";
    };
  }, [videoId, title]);

  useEffect(() => {
    if (state !== "playing") return undefined;
    const t = setInterval(() => setTime(player.current?.getCurrentTime?.() || 0), 500);
    return () => clearInterval(t);
  }, [state]);

  const p = () => (ready ? player.current : null);

  const play = () => {
    const yt = p();
    if (!yt) return;
    yt.playVideo();
    // Some phones won't start sound from a tap outside the player: start
    // muted then, and the sound button turns it on.
    setTimeout(() => {
      if (player.current?.getPlayerState?.() !== 1 && player.current) {
        player.current.mute();
        setMuted(true);
        player.current.playVideo();
      }
    }, 1500);
  };
  const toggle = () => (state === "playing" ? p()?.pauseVideo() : play());
  const replay = () => {
    p()?.seekTo(0, true);
    setTime(0);
    play();
  };
  const toggleMute = () => {
    const yt = p();
    if (!yt) return;
    if (muted) yt.unMute(); else yt.mute();
    setMuted(!muted);
  };
  const nextSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    p()?.setPlaybackRate(next);
    setSpeed(next);
  };

  const shown = seeking ?? time;
  const big = state !== "playing";

  return (
    <Box sx={{ position: "absolute", inset: 0, bgcolor: "#000", "& iframe": { position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" } }}>
      <Box ref={host} sx={{ position: "absolute", inset: 0 }} />

      {/* The layer: every click on the video lands here, not on YouTube. */}
      <Box onClick={state === "ended" ? undefined : toggle} onContextMenu={(e) => e.preventDefault()}
        sx={{ position: "absolute", inset: 0, zIndex: 3, cursor: ready ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center",
          bgcolor: state === "ended" ? "#000" : state === "unstarted" ? "rgba(0,0,0,0.15)" : "transparent" }}>
        {state === "ended" ? (
          <Box component="button" type="button" onClick={(e) => { e.stopPropagation(); replay(); }}
            sx={{ display: "flex", alignItems: "center", gap: 1, border: "none", borderRadius: 99, px: 2.5, py: 1.25, cursor: "pointer", color: "#fff", bgcolor: "rgba(255,255,255,0.15)", fontSize: 15, fontWeight: 600 }}>
            <RotateCcw size={18} /> Watch again
          </Box>
        ) : big && ready ? (
          <Box sx={{ width: 64, height: 64, borderRadius: "50%", bgcolor: "rgba(0,0,0,0.55)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Play size={30} fill="#fff" />
          </Box>
        ) : null}
      </Box>

      {/* Our controls, under the name watermark (z 5) and the full-screen button (z 6). */}
      {ready && state !== "ended" && (
        <Box onContextMenu={(e) => e.preventDefault()}
          sx={{ position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 4, px: 1, pt: 2, pb: 0.25, display: "flex", alignItems: "center", gap: 0.75, color: "#fff",
            background: "linear-gradient(transparent, rgba(0,0,0,0.7))" }}>
          <IconButton size="small" onClick={toggle} aria-label={state === "playing" ? "Pause" : "Play"} sx={{ color: "#fff" }}>
            {state === "playing" ? <Pause size={18} /> : <Play size={18} />}
          </IconButton>
          <Typography variant="caption" sx={{ minWidth: 76, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
            {clock(shown)} / {clock(duration)}
          </Typography>
          <Slider size="small" value={Math.min(shown, duration || 0)} max={duration || 1} step={1} aria-label="Seek"
            onChange={(_, v) => setSeeking(v)}
            onChangeCommitted={(_, v) => { p()?.seekTo(v, true); setTime(v); setSeeking(null); }}
            sx={{ flex: 1, mx: 1, color: "#fff", "& .MuiSlider-thumb": { width: 12, height: 12 } }} />
          <IconButton size="small" onClick={toggleMute} aria-label={muted ? "Sound on" : "Mute"} sx={{ color: "#fff" }}>
            {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </IconButton>
          <Box component="button" type="button" onClick={nextSpeed} aria-label="Speed"
            sx={{ border: "none", bgcolor: "transparent", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700, minWidth: 40 }}>
            {speed}x
          </Box>
        </Box>
      )}
    </Box>
  );
}
