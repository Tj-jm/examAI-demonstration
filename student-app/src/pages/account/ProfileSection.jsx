import { useEffect, useState } from "react";
import { Box, Typography, Paper, TextField, Button, Alert, Skeleton } from "@mui/material";
import { useGetMeQuery, useUpdateProfileMutation } from "../../api/authApi";
import { useBranding } from "../../BrandingContext";

// Name, and what tax invoices need: the state (when the institution splits
// GST by state) and a business to bill (when it issues tax invoices).
export default function ProfileSection() {
  const { data: me, isLoading } = useGetMeQuery();
  const { receiptInfo = {} } = useBranding() || {};
  const tax = receiptInfo.tax || {};
  const [save, { isLoading: saving, error, isSuccess }] = useUpdateProfileMutation();
  const [form, setForm] = useState(null);
  useEffect(() => {
    if (me) setForm({ name: me.name || "", state: me.state || "", billingName: me.billing?.name || "", billingTaxId: me.billing?.taxId || "" });
  }, [me]);

  if (isLoading || !form) return <Skeleton variant="rounded" height={120} />;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = () => save({
    name: form.name,
    ...(tax.gstSplit ? { state: form.state } : {}),
    ...(tax.enabled ? { billing: { name: form.billingName, taxId: form.billingTaxId } } : {}),
  });

  return (
    <Box>
      <Typography sx={{ fontWeight: 500, mb: 1 }}>Profile</Typography>
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, display: "flex", flexDirection: "column", gap: 1.5 }}>
        {me.studentId && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
            <Typography variant="body2" color="text.secondary">Student ID</Typography>
            <Typography sx={{ fontFamily: "monospace", fontWeight: 600, letterSpacing: 0.5 }}>{me.studentId}</Typography>
            <Button size="small" onClick={() => navigator.clipboard?.writeText(me.studentId).catch(() => {})}>Copy</Button>
          </Box>
        )}
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.5 }}>
          <TextField size="small" label="Name" value={form.name} onChange={set("name")} />
          {tax.gstSplit && <TextField size="small" label="State" value={form.state} onChange={set("state")} />}
          {tax.enabled && <TextField size="small" label="Bill to (business name, optional)" value={form.billingName} onChange={set("billingName")} />}
          {tax.enabled && <TextField size="small" label="Business tax number (optional)" value={form.billingTaxId} onChange={set("billingTaxId")} />}
        </Box>
        {tax.enabled && <Typography variant="caption" color="text.secondary">Used on your invoices from your next purchase.</Typography>}
        {error && <Alert severity="error">{error?.data?.message || "Couldn't save."}</Alert>}
        {isSuccess && !error && <Alert severity="success">Saved.</Alert>}
        <Box><Button variant="contained" disabled={saving || form.name.trim().length < 2} onClick={submit}>{saving ? "Saving" : "Save"}</Button></Box>
      </Paper>
    </Box>
  );
}
