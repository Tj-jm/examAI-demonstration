import { Box, Chip } from "@mui/material";

// A row of filter chips for a list (exams, live classes), each with its
// count when the server sends one. Scrolls sideways on a narrow phone
// rather than wrapping into a second row.
export default function FilterChips({ options, value, counts, onChange }) {
  return (
    <Box sx={{ display: "flex", gap: 1, mb: 2, overflowX: "auto", pb: 0.5, "&::-webkit-scrollbar": { display: "none" } }}>
      {options.map(([key, label]) => {
        const on = value === key;
        const n = counts?.[key];
        return (
          <Chip
            key={key}
            label={n !== undefined ? `${label} ${n}` : label}
            color={on ? "primary" : "default"}
            variant={on ? "filled" : "outlined"}
            onClick={() => onChange(key)}
            sx={{ flexShrink: 0, fontWeight: on ? 600 : 400 }}
          />
        );
      })}
    </Box>
  );
}
