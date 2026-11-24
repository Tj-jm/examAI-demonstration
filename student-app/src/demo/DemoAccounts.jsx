import { useEffect, useState } from "react";
import { Box, Chip, Typography } from "@mui/material";
import { API_ROOT } from "../api/apiBase";

// Sales demo: one click fills the sign-in email of the demo student
// (backend GET /api/demo/info). Reps are told the password.
export default function DemoAccounts({ onPick }) {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    fetch(`${API_ROOT}/api/demo/info`, { credentials: "include" }).then((r) => (r.ok ? r.json() : null)).then(setInfo).catch(() => {});
  }, []);
  if (!info?.student) return null;
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
      <Typography variant="caption" color="text.secondary">Demo account</Typography>
      <Chip size="small" clickable label={info.student.name || "Demo student"} title={info.student.email} onClick={() => onPick(info.student.email)} />
      {info.resetting && <Typography variant="caption" color="text.secondary">The demo is being reset. Try again in a minute.</Typography>}
    </Box>
  );
}
