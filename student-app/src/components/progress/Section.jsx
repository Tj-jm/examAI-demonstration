import { Box, Typography, Paper } from "@mui/material";
import { animate, slideUp } from "../../motion";

// One card on "My progress": a title, a line under it, an optional control
// on the right, then the content.
export default function Section({ title, subtitle, action, children, delay = 0 }) {
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 }, borderRadius: 3, minWidth: 0, ...animate(slideUp, 420, "ease-out", `${delay * 70}ms both`) }}>
      <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 1.5, mb: 2, flexWrap: "wrap" }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h6" sx={{ fontSize: 16, fontWeight: 600 }}>{title}</Typography>
          {subtitle && <Typography variant="caption" color="text.secondary">{subtitle}</Typography>}
        </Box>
        {action}
      </Box>
      {children}
    </Paper>
  );
}
