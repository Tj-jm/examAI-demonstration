import { useEffect, useRef, useState } from "react";
import { openProtected } from "../utils/protectedHls";

// Plays any attached video in the admin panel: a protected video
// (self-hosted, encrypted chunks) through hls.js, a stored file in the
// browser's player, and a hosted one (YouTube, Vimeo, Bunny, VdoCipher)
// in its own embed. Goes inside a .video-frame box.
export default function VideoFrame({ url, file, title = "Video" }) {
  const hls = file && /\.m3u8(\?|$)/.test(url || "");
  if (hls) return <HlsPlayer url={url} title={title} />;
  if (file) return <video src={url} controls playsInline title={title} />;
  return <iframe src={url} title={title} allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowFullScreen />;
}

function HlsPlayer({ url, title }) {
  const ref = useRef(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const el = ref.current;
    if (!el || !url) return undefined;
    setError("");
    let player = null;
    let viewing = null;
    let gone = false;
    const id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
    const src = `${url}${url.includes("?") ? "&" : "?"}p=${id}`;
    import("hls.js").then(async ({ default: Hls }) => {
      if (gone) return;
      if (!Hls.isSupported()) {
        setError("This browser can't play protected videos.");
        return;
      }
      try {
        viewing = /\/api\/stream\/hls\//.test(src)
          ? await openProtected(Hls, src, id)
          : { url: src, loader: Hls.DefaultConfig.loader, stop: () => {} };
      } catch (err) {
        if (!gone) setError(err.code === 410 ? "This link has expired. Reload the page." : err.code === "insecure" ? err.message : "This video couldn't play.");
        return;
      }
      if (gone) { viewing.stop(); return; }
      player = new Hls({ loader: viewing.loader });
      player.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          setError(data.response?.code === 410 ? "This link has expired. Reload the page." : "This video couldn't play.");
          player.destroy();
        }
      });
      player.loadSource(viewing.url);
      player.attachMedia(el);
    });
    return () => {
      gone = true;
      viewing?.stop();
      player?.destroy();
    };
  }, [url]);
  return (
    <>
      <video ref={ref} controls playsInline title={title} />
      {error && <div className="video-frame-msg">{error}</div>}
    </>
  );
}
