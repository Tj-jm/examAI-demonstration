import { useRef } from "react";
import { Box } from "@mui/material";
import { Maximize } from "lucide-react";
import Watermark from "./Watermark";
import YouTubeLocked, { youtubeId } from "./YouTubeLocked";
import BrandPlayer from "./BrandPlayer";
import useWatermark from "../hooks/useWatermark";
import { useBranding } from "../BrandingContext";

// A video file or a hosted player, with the student's name drifting over
// it. The browser's own download, picture-in-picture and full-screen
// buttons are off: full screen goes through the button here instead, so
// the name stays on top in full screen too. A YouTube video gets the
// locked player when Settings → Student app → Lock YouTube player is on.
export default function ProtectedVideo({ src, file, title = "Video" }) {
  const box = useRef(null);
  const watermark = useWatermark({ hosted: !file });
  const { youtubeLock } = useBranding() || {};
  const ytId = !file && youtubeLock ? youtubeId(src) : null;
  return (
    <Box ref={box} onContextMenu={(e) => e.preventDefault()}
      sx={{ position: "absolute", inset: 0, bgcolor: "#000", "&:fullscreen video, &:fullscreen iframe": { width: "100%", height: "100%" } }}>
      {file ? (
        <BrandPlayer src={src} hls={/\.m3u8(\?|$)/.test(src || "")} title={title} boxRef={box} />
      ) : ytId ? (
        <YouTubeLocked videoId={ytId} title={title} />
      ) : (
        <Box component="iframe" src={src} title={title} allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowFullScreen
          sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }} />
      )}
      <Watermark text={watermark} />
      {ytId && (
        <Box component="button" type="button" aria-label="Full screen"
          onClick={() => (document.fullscreenElement ? document.exitFullscreen() : box.current?.requestFullscreen?.())}
          sx={{ position: "absolute", top: 8, right: 8, zIndex: 6, border: "none", borderRadius: 1, p: 0.75, display: "flex", cursor: "pointer", color: "#fff", bgcolor: "rgba(0,0,0,0.45)" }}>
          <Maximize size={16} />
        </Box>
      )}
    </Box>
  );
}
