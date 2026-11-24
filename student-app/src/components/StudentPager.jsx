import { Box, IconButton, Typography } from "@mui/material";
import { ChevronLeft, ChevronRight } from "lucide-react";

// The student app's equivalent of the admin panel's Pager (components/bits.jsx)
// — same {page, pages, total} shape the backend's paginated endpoints already
// return, just styled to match MUI rather than the admin's plain CSS classes.
export default function StudentPager({ page, pages, total, onChange }) {
  if (!pages || pages <= 1) return null;

  return (
    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mt: 2 }}>
      <Typography variant="caption" color="text.secondary">
        {total} notice{total === 1 ? "" : "s"}
      </Typography>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <IconButton size="small" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Previous page">
          <ChevronLeft size={16} />
        </IconButton>
        <Typography variant="caption" color="text.secondary" sx={{ minWidth: 56, textAlign: "center" }}>
          Page {page} of {pages}
        </Typography>
        <IconButton size="small" disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label="Next page">
          <ChevronRight size={16} />
        </IconButton>
      </Box>
    </Box>
  );
}
