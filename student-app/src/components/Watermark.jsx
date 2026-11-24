import { useEffect, useState } from "react";

// A faint name that drifts to a new spot every few seconds, so a screen
// recording shows whose account it came from: over the board player and
// the student app's video files (ProtectedVideo.jsx).
export default function Watermark({ text, color = "#fff" }) {
  const [pos, setPos] = useState({ x: 6, y: 10 });
  useEffect(() => {
    if (!text) return undefined;
    const t = setInterval(() => setPos({ x: 3 + Math.random() * 55, y: 5 + Math.random() * 80 }), 4000);
    return () => clearInterval(t);
  }, [text]);
  if (!text) return null;
  return (
    <div aria-hidden style={{ position: "absolute", left: `${pos.x}%`, top: `${pos.y}%`, transition: "left 1.5s ease, top 1.5s ease", opacity: 0.35, color, fontSize: "clamp(10px, 1.7vw, 15px)", fontWeight: 600, lineHeight: 1.2, whiteSpace: "nowrap", pointerEvents: "none", userSelect: "none", textShadow: "0 0 3px rgba(0,0,0,0.45)", zIndex: 5 }}>
      {text}
    </div>
  );
}
