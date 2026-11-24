import { useEffect, useRef, useState } from "react";
import { keyframes } from "@emotion/react";

// Small, shared motion. The short feedback animations (a pop, a slide, a
// count-up) always play: many PCs have "reduce motion" on by default, and
// these are part of how the app answers a tap. Big or looping motion —
// confetti, a pulsing timer — is still switched off for anyone who asked
// their device for less motion.

export const REDUCED = "@media (prefers-reduced-motion: reduce)";
export const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// sx for a short feedback animation.
export const animate = (name, duration = 400, easing = "ease-out", extra = "") => ({
  animation: `${name} ${duration}ms ${easing} ${extra}`.trim(),
});

// sx for big or looping motion: off with reduced motion.
export const animateBig = (name, duration = 400, easing = "ease-out", extra = "") => ({
  ...animate(name, duration, easing, extra),
  [REDUCED]: { animation: "none" },
});

export const correctPulse = keyframes`
  0% { box-shadow: 0 0 0 0 rgba(46, 160, 67, 0.55); transform: scale(1); }
  30% { transform: scale(1.035); }
  60% { transform: scale(0.99); }
  100% { box-shadow: 0 0 0 14px rgba(46, 160, 67, 0); transform: scale(1); }
`;

export const shake = keyframes`
  0%, 100% { transform: translateX(0); }
  15% { transform: translateX(-9px); }
  30% { transform: translateX(8px); }
  45% { transform: translateX(-6px); }
  60% { transform: translateX(5px); }
  75% { transform: translateX(-2px); }
`;

// The solution box after a checked answer: drops in from above.
export const revealDown = keyframes`
  from { opacity: 0; transform: translateY(-16px) scale(0.98); }
  to { opacity: 1; transform: none; }
`;

// The next question coming in from the right.
export const slideInRight = keyframes`
  from { opacity: 0; transform: translateX(28px); }
  to { opacity: 1; transform: none; }
`;

// A flag being raised.
export const wiggle = keyframes`
  0%, 100% { transform: rotate(0deg); }
  20% { transform: rotate(-18deg); }
  45% { transform: rotate(14deg); }
  70% { transform: rotate(-8deg); }
`;

// A count that just changed.
export const bump = keyframes`
  0% { transform: scale(1); }
  40% { transform: scale(1.25); }
  100% { transform: scale(1); }
`;

// A note that shows for a moment and goes: in, hold, out.
export const flash = keyframes`
  0% { opacity: 0; transform: translateY(6px); }
  15%, 75% { opacity: 1; transform: none; }
  100% { opacity: 0; transform: translateY(-4px); }
`;

// Your own row on a leaderboard: a ring that lights up once.
export const meGlow = keyframes`
  0%, 100% { box-shadow: inset 0 0 0 0 rgba(25, 118, 210, 0); }
  35% { box-shadow: inset 0 0 0 2px rgba(25, 118, 210, 0.7); }
`;

// A podium step rising into place.
export const riseUp = keyframes`
  from { opacity: 0; transform: translateY(40px); }
  to { opacity: 1; transform: none; }
`;

// An empty state's icon drifting gently.
export const float = keyframes`
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-5px); }
`;

export const slideDown = keyframes`
  from { opacity: 0; transform: translateY(-6px); }
  to { opacity: 1; transform: translateY(0); }
`;

export const slideUp = keyframes`
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
`;

export const fadeIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`;

export const popIn = keyframes`
  0% { opacity: 0; transform: scale(0.85); }
  70% { opacity: 1; transform: scale(1.04); }
  100% { transform: scale(1); }
`;

export const softPulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
`;

export const typingDot = keyframes`
  0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
  40% { transform: translateY(-4px); opacity: 1; }
`;

// Grows a bar from 0 to its width on first paint.
export const growX = keyframes`
  from { transform: scaleX(0); }
  to { transform: scaleX(1); }
`;

// Counts up to `value` once it's known.
export function useCountUp(value, duration = 900) {
  const [shown, setShown] = useState(0);
  const frame = useRef(null);
  useEffect(() => {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return undefined;
    const target = Number(value);
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      setShown(target * eased);
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [value, duration]);
  return shown;
}

// The exam timer: a gentle pulse once time is short, a quicker one in the
// last minute.
export const timerPulse = (remainingMs, warnMs) => {
  if (remainingMs === null || remainingMs === undefined || remainingMs <= 0) return {};
  if (remainingMs < 60000) return animateBig(softPulse, 900, "ease-in-out", "infinite");
  if (warnMs !== null && warnMs !== undefined && remainingMs < warnMs) return animateBig(softPulse, 2000, "ease-in-out", "infinite");
  return {};
};
