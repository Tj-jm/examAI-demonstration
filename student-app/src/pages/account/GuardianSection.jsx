import { useEffect, useState } from "react";
import { Box, Typography, Paper, TextField, Button, Alert, Skeleton } from "@mui/material";
import { useGetGuardianQuery, useUpdateGuardianMutation } from "../../api/accountApi";

// Who gets this student's progress reports. A student can add a guardian
// when none is on record; changing one the institution entered is up to
// staff (unless they allow it), so reports can't be redirected.
export default function GuardianSection() {
  const { data, isLoading } = useGetGuardianQuery();
  const [save, { isLoading: saving, error, isSuccess }] = useUpdateGuardianMutation();
  const [form, setForm] = useState(null);
  useEffect(() => { if (data) setForm(data.guardian); }, [data]);

  if (isLoading || !form) return <Skeleton variant="rounded" height={120} />;
  const g = data.guardian;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <Box>
      <Typography sx={{ fontWeight: 500, mb: 1 }}>Guardian</Typography>
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, display: "flex", flexDirection: "column", gap: 1.5 }}>
        <Typography variant="body2" color="text.secondary">
          Your progress reports and exam results can go to a parent or guardian by SMS or email.
        </Typography>
        {data.canEdit ? (
          <>
            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.5 }}>
              <TextField size="small" label="Name" value={form.name} onChange={set("name")} />
              <TextField size="small" label="Relation" placeholder="e.g. Mother" value={form.relation} onChange={set("relation")} />
              <TextField size="small" label="Phone" value={form.phone} onChange={set("phone")} inputProps={{ inputMode: "tel" }} />
              <TextField size="small" label="Email" type="email" value={form.email} onChange={set("email")} />
            </Box>
            {error && <Alert severity="error">{error?.data?.message || "Couldn't save."}</Alert>}
            {isSuccess && !error && <Alert severity="success">Saved.</Alert>}
            <Box><Button variant="contained" disabled={saving || (!form.phone && !form.email)} onClick={() => save(form)}>{saving ? "Saving" : "Save"}</Button></Box>
          </>
        ) : (
          <>
            <Typography>{[g.name && `${g.name}${g.relation ? ` (${g.relation})` : ""}`, g.phone, g.email].filter(Boolean).join(" · ")}</Typography>
            <Typography variant="caption" color="text.secondary">Set by your institution. Ask them to change it.</Typography>
          </>
        )}
      </Paper>
    </Box>
  );
}
