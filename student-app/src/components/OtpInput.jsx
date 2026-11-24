import { useRef } from "react";
import { Box, TextField } from "@mui/material";

// Six single-digit boxes standing in for one text field, because that is
// what a code input is expected to look and behave like: type a digit, focus
// jumps to the next box; backspace on an empty box jumps back; pasting the
// whole code (from a copied SMS/email) fills every box at once instead of
// only the one that was focused.
export default function OtpInput({ value, onChange, length = 6, autoFocus, disabled, error }) {
  const refs = useRef([]);
  const digits = Array.from({ length }, (_, i) => value[i] || "");

  const handleChange = (i, raw) => {
    const clean = raw.replace(/\D/g, "");
    if (!clean) {
      onChange(value.slice(0, i) + value.slice(i + 1));
      return;
    }
    // Only the last typed character — covers mobile keyboards that report
    // the whole field's contents instead of just the new key.
    const digit = clean[clean.length - 1];
    const next = digits.slice();
    next[i] = digit;
    onChange(next.join("").slice(0, length));
    if (i < length - 1) refs.current[i + 1]?.focus();
  };

  const handleKeyDown = (i, e) => {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      refs.current[i - 1]?.focus();
    }
  };

  const handlePaste = (e) => {
    const raw = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    if (!raw) return;
    e.preventDefault();
    onChange(raw);
    refs.current[Math.min(raw.length, length - 1)]?.focus();
  };

  return (
    <Box sx={{ display: "flex", gap: 1, justifyContent: "space-between" }}>
      {digits.map((d, i) => (
        <TextField
          key={i}
          inputRef={(el) => (refs.current[i] = el)}
          value={d}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          autoFocus={autoFocus && i === 0}
          disabled={disabled}
          error={error}
          inputProps={{
            inputMode: "numeric",
            maxLength: 1,
            style: { textAlign: "center", fontSize: 20, padding: "12px 0" },
          }}
          sx={{ width: { xs: 40, sm: 46 } }}
        />
      ))}
    </Box>
  );
}
