import { useEffect, useState } from "react";
import { Box } from "@mui/material";
import { keyframes } from "@emotion/react";

// A short burst of confetti over the page — no library, a few dozen
// falling bits. Plays once per `onceKey` (a result shouldn't celebrate every
// time it's reopened). Plays with reduced motion on too: it's short, falls
// behind nothing interactive, and many PCs have that setting on by default.
const fall = keyframes`
  0% { transform: translate3d(0, -10vh, 0) rotate(0deg); opacity: 1; }
  100% { transform: translate3d(var(--drift), 105vh, 0) rotate(var(--spin)); opacity: 0.9; }
`;
const COLORS = ["#f94144", "#f8961e", "#f9c74f", "#90be6d", "#43aa8b", "#577590", "#9b5de5"];

export default function Confetti({ onceKey, pieces = 70 }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      if (onceKey && sessionStorage.getItem(`confetti:${onceKey}`)) return undefined;
      if (onceKey) sessionStorage.setItem(`confetti:${onceKey}`, "1");
    } catch {
      // storage blocked: celebrate anyway
    }
    setShow(true);
    const timer = setTimeout(() => setShow(false), 3800);
    return () => clearTimeout(timer);
  }, [onceKey]);
  if (!show) return null;

  return (
    <Box aria-hidden sx={{ position: "fixed", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 1400 }}>
      {Array.from({ length: pieces }).map((_, i) => {
        const left = Math.random() * 100;
        const delay = Math.random() * 0.6;
        const duration = 2.2 + Math.random() * 1.3;
        const size = 6 + Math.random() * 6;
        return (
          <Box
            key={i}
            sx={{
              position: "absolute",
              top: 0,
              left: `${left}%`,
              width: size,
              height: size * 0.45,
              bgcolor: COLORS[i % COLORS.length],
              borderRadius: "1px",
              "--drift": `${(Math.random() - 0.5) * 30}vw`,
              "--spin": `${(Math.random() - 0.5) * 900}deg`,
              animation: `${fall} ${duration}s cubic-bezier(.2,.6,.4,1) ${delay}s both`,
            }}
          />
        );
      })}
    </Box>
  );
}
