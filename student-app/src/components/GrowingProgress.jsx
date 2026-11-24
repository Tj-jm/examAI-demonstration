import { useEffect, useState } from "react";
import { LinearProgress } from "@mui/material";

// A determinate LinearProgress that fills from 0 when it first appears
// (MUI animates value changes, but not the first value).
export default function GrowingProgress({ value = 0, ...props }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(value));
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return (
    <LinearProgress
      variant="determinate"
      value={shown}
      {...props}
      sx={{ "& .MuiLinearProgress-bar": { transitionDuration: "900ms" }, ...(props.sx || {}) }}
    />
  );
}
