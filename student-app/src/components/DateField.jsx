import { useMemo, useRef, useState } from "react";
import { Box, TextField, Popover, IconButton, Typography, InputAdornment } from "@mui/material";
import { useTheme, alpha } from "@mui/material/styles";
import { keyframes } from "@emotion/react";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { animate, popIn } from "../motion";

// A date field with the app's own calendar instead of the browser's: it
// follows the theme (light, dark, every design) and looks the same on
// every phone. value and min are "yyyy-mm-dd" strings; onChange gets one
// back, or "" when cleared.
//
// sx styles the field like any TextField; paperSx styles the calendar
// card (the tutor console passes its own dark panel colours).

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
const daysBetween = (a, b) => Math.round((b - a) / 86400000);

const slideL = keyframes`from { opacity: 0; transform: translateX(14px); } to { opacity: 1; transform: none; }`;
const slideR = keyframes`from { opacity: 0; transform: translateX(-14px); } to { opacity: 1; transform: none; }`;

// Monday-first week, the way most of the world reads a calendar.
const WEEKDAYS = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday: "narrow" }));

const QUICK = [
  { label: "1 week", days: 7 },
  { label: "2 weeks", days: 14 },
  { label: "1 month", months: 1 },
];

export default function DateField({ label = "Date", value, onChange, min, sx, paperSx, size = "small", fullWidth }) {
  const theme = useTheme();
  const anchor = useRef(null);
  const [open, setOpen] = useState(false);
  const today = useMemo(() => {
    const t = new Date();
    return new Date(t.getFullYear(), t.getMonth(), t.getDate());
  }, []);
  const selected = parse(value);
  const minDate = parse(min);
  const [view, setView] = useState(() => selected || today);
  const [dir, setDir] = useState(0);

  const openCal = () => {
    setView(selected || minDate || today);
    setDir(0);
    setOpen(true);
  };
  const move = (n) => {
    setDir(n);
    setView((v) => addMonths(v, n));
  };
  const pick = (d) => {
    onChange(ymd(d));
    setOpen(false);
  };
  const blocked = (d) => Boolean(minDate && d < minDate);

  const first = new Date(view.getFullYear(), view.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const cells = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(view.getFullYear(), view.getMonth(), i + 1)),
  ];
  const canBack = !minDate || addMonths(view, 0) > new Date(minDate.getFullYear(), minDate.getMonth(), 1);

  const away = selected ? daysBetween(today, selected) : null;
  const shown = selected
    ? `${selected.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: selected.getFullYear() !== today.getFullYear() ? "numeric" : undefined })}${away === 0 ? " · today" : away === 1 ? " · tomorrow" : away > 1 ? ` · in ${away} days` : ""}`
    : "";

  const primary = theme.palette.primary.main;
  const onPrimary = theme.palette.primary.contrastText;

  return (
    <>
      <TextField
        size={size}
        label={label}
        value={shown}
        placeholder="Pick a date"
        onClick={openCal}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") { e.preventDefault(); openCal(); } }}
        fullWidth={fullWidth}
        InputLabelProps={{ shrink: Boolean(shown) || open || undefined }}
        inputProps={{ readOnly: true, "aria-haspopup": "dialog", style: { cursor: "pointer" } }}
        InputProps={{
          ref: anchor,
          sx: { cursor: "pointer" },
          endAdornment: (
            <InputAdornment position="end" sx={{ color: "inherit", opacity: 0.75 }}>
              <CalendarDays size={17} />
            </InputAdornment>
          ),
        }}
        sx={sx}
      />
      <Popover
        open={open}
        anchorEl={anchor.current}
        onClose={() => setOpen(false)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        slotProps={{
          paper: {
            role: "dialog",
            "aria-label": label,
            sx: {
              mt: 1, p: 1.75, width: 300, maxWidth: "calc(100vw - 32px)", borderRadius: 3,
              border: 1, borderColor: "divider",
              boxShadow: `0 18px 48px ${alpha("#000", theme.palette.mode === "dark" ? 0.5 : 0.16)}`,
              ...animate(popIn, 220),
              ...paperSx,
            },
          },
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
          <IconButton size="small" onClick={() => move(-1)} disabled={!canBack} aria-label="Previous month" sx={{ color: "inherit" }}>
            <ChevronLeft size={18} />
          </IconButton>
          <Typography key={`${view.getFullYear()}-${view.getMonth()}`} sx={{ flex: 1, textAlign: "center", fontWeight: 700, fontSize: 15, ...animate(dir < 0 ? slideR : slideL, 220) }}>
            {view.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
          </Typography>
          <IconButton size="small" onClick={() => move(1)} aria-label="Next month" sx={{ color: "inherit" }}>
            <ChevronRight size={18} />
          </IconButton>
        </Box>

        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", mb: 0.5 }}>
          {WEEKDAYS.map((w, i) => (
            <Typography key={i} sx={{ textAlign: "center", fontSize: 11.5, fontWeight: 600, opacity: 0.55, py: 0.5 }}>{w}</Typography>
          ))}
        </Box>

        <Box
          key={`${view.getFullYear()}-${view.getMonth()}`}
          role="grid"
          sx={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 0.25, ...(dir ? animate(dir < 0 ? slideR : slideL, 240) : {}) }}
        >
          {cells.map((d, i) => {
            if (!d) return <Box key={`e${i}`} />;
            const isSel = selected && d.getTime() === selected.getTime();
            const isToday = d.getTime() === today.getTime();
            const off = blocked(d);
            return (
              <Box
                key={d.getDate()}
                component="button"
                type="button"
                role="gridcell"
                aria-selected={Boolean(isSel)}
                aria-label={d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
                disabled={off}
                onClick={() => pick(d)}
                sx={{
                  font: "inherit", fontSize: 13.5, fontWeight: isSel || isToday ? 700 : 500,
                  aspectRatio: "1", width: "100%", borderRadius: "50%", border: "none", p: 0,
                  cursor: off ? "default" : "pointer",
                  color: isSel ? onPrimary : "inherit",
                  opacity: off ? 0.28 : 1,
                  bgcolor: isSel ? primary : "transparent",
                  boxShadow: isSel ? `0 4px 14px ${alpha(primary, 0.45)}` : isToday ? `inset 0 0 0 1.5px ${primary}` : "none",
                  transition: "background-color 150ms, transform 120ms",
                  "&:hover": off || isSel ? {} : { bgcolor: alpha(primary, 0.12) },
                  "&:active": off ? {} : { transform: "scale(0.9)" },
                  "&:focus-visible": { outline: `2px solid ${primary}`, outlineOffset: 1 },
                  ...(isSel ? animate(popIn, 260) : {}),
                }}
              >
                {d.getDate()}
              </Box>
            );
          })}
        </Box>

        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mt: 1.5, pt: 1.5, borderTop: 1, borderColor: "divider", flexWrap: "wrap" }}>
          {QUICK.map((q) => {
            const d = q.days ? addDays(today, q.days) : new Date(today.getFullYear(), today.getMonth() + q.months, today.getDate());
            if (blocked(d)) return null;
            return (
              <Box
                key={q.label}
                component="button"
                type="button"
                onClick={() => pick(d)}
                sx={{
                  font: "inherit", fontSize: 12, fontWeight: 600, cursor: "pointer", px: 1.25, py: 0.5, borderRadius: 999,
                  border: 1, borderColor: alpha(primary, 0.35), bgcolor: alpha(primary, 0.08), color: "inherit",
                  transition: "background-color 150ms", "&:hover": { bgcolor: alpha(primary, 0.16) },
                }}
              >
                {q.label}
              </Box>
            );
          })}
          {selected && (
            <IconButton size="small" onClick={() => { onChange(""); setOpen(false); }} aria-label="Clear date" sx={{ ml: "auto", color: "inherit", opacity: 0.7 }}>
              <X size={16} />
            </IconButton>
          )}
        </Box>
      </Popover>
    </>
  );
}
