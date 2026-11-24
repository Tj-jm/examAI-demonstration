import { useEffect, useRef, useState } from "react";

// A stat that counts up to its value when it first shows (and eases to a
// new one when it changes). Works on the number inside a string too —
// "$12.40", "450ms" — keeping its decimals and what's around it.
const NUMBER = /-?\d[\d,]*(\.\d+)?/;

export default function CountUp({ value, duration = 800 }) {
  const text = String(value ?? "");
  const match = text.match(NUMBER);
  const target = match ? Number(match[0].replace(/,/g, "")) : null;
  const decimals = match?.[1] ? match[1].length - 1 : 0;
  const [shown, setShown] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    if (target === null || !Number.isFinite(target)) return undefined;
    const start = from.current;
    const t0 = performance.now();
    let frame;
    const tick = (now) => {
      const t = Math.min(1, (now - t0) / duration);
      const v = start + (target - start) * (1 - (1 - t) ** 3);
      setShown(v);
      from.current = v;
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);

  if (target === null) return text;
  const number = shown.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return text.slice(0, match.index) + number + text.slice(match.index + match[0].length);
}
