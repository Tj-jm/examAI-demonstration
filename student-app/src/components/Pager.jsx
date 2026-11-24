import { Box, Typography, Pagination } from "@mui/material";

// Same {page, pages, total, onChange} contract as the admin panel's own
// Pager (components/bits.jsx) — different rendering (MUI's built-in
// Pagination rather than hand-rolled prev/next buttons) since this app is
// MUI-based throughout, but the same shape means a page that fetches
// {items, total, page, pages} from the backend wires up identically
// regardless of which app it's in.
export default function Pager({ page, pages, total, onChange }) {
  if (!pages || pages <= 1) return null;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0.5, mt: 2 }}>
      <Pagination
        page={page}
        count={pages}
        onChange={(e, next) => onChange(next)}
        size="small"
        shape="rounded"
      />
      <Typography variant="caption" color="text.secondary">
        {total} result{total === 1 ? "" : "s"}
      </Typography>
    </Box>
  );
}
