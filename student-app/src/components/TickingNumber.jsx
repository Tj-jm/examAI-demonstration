import { useEffect, useRef, useState } from "react";
import { Box } from "@mui/material";

// A balance that ticks from the last value this student saw to the current
// one — so credits bought on the payment page count up on return — and
// flashes green when it went up. `storageKey` remembers the last value
// across pages; without it, only changes while mounted tick.
const read = (key) => {
  try {
    const v = key ? sessionStorage.getItem(`tick:${key}`) : null;
    return v === null ? null : Number(v);
  } catch {
    return null;
  }
};
const write = (key, value) => {
  try {
    if (key) sessionStorage.setItem(`tick:${key}`, String(value));
  } catch {
    // storage blocked: nothing to remember
  }
};

export default function TickingNumber({ value, storageKey, duration = 900 }) {
  const target = Number(value) || 0;
  const [shown, setShown] = useState(() => read(storageKey) ?? target);
  const [rose, setRose] = useState(false);
  const from = useRef(shown);
  useEffect(() => {
    const start = from.current;
    write(storageKey, target);
    if (start === target) return undefined;
    setRose(target > start);
    const t0 = performance.now();
    let frame;
    const tick = (now) => {
      const t = Math.min(1, (now - t0) / duration);
      const v = start + (target - start) * (1 - (1 - t) ** 3);
      setShown(v);
      from.current = v;
      if (t < 1) frame = requestAnimationFrame(tick);
      else setTimeout(() => setRose(false), 900);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, storageKey, duration]);
  return (
    <Box component="span" className="tnum" sx={{ transition: "color 400ms", color: rose ? "success.main" : "inherit", fontWeight: rose ? 700 : "inherit" }}>
      {Math.round(shown)}
    </Box>
  );
}
