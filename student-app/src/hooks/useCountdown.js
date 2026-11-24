import { useEffect, useRef, useState } from "react";

// Drives the "resend code" cooldown. Purely a client-side pacing UI — the
// real abuse guard is the backend's otpLimiter (5 sends/hour per IP); this
// just stops someone mashing the button every second. restart() is called
// after every successful send (first send and every resend), so returning
// to this screen later or resending both reset the same clock.
export default function useCountdown(initialSeconds) {
  const [seconds, setSeconds] = useState(initialSeconds);

  useEffect(() => {
    if (seconds <= 0) return undefined;
    const id = setInterval(() => setSeconds((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [seconds > 0]);

  const restart = (next = initialSeconds) => setSeconds(next);

  return [seconds, restart];
}
