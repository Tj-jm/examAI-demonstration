import { useState } from "react";
import {
  Box, Typography, Paper, Button, Alert, TextField, Dialog, DialogTitle, DialogContent, DialogActions, Skeleton,
} from "@mui/material";
import { Trash2 } from "lucide-react";
import { useGetDeletionQuery, useRequestDeletionMutation, useCancelDeletionMutation } from "../../api/accountApi";

const day = (d) => new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

// Asking for the account to be deleted, with a grace period to change
// one's mind (settings in admin → Account deletions).
export default function DeleteAccountSection() {
  const { data, isLoading } = useGetDeletionQuery();
  const [requestDeletion, { isLoading: requesting, error }] = useRequestDeletionMutation();
  const [cancel, { isLoading: cancelling }] = useCancelDeletionMutation();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState("");

  if (isLoading) return <Skeleton variant="rounded" height={90} />;
  if (!data?.enabled && !data?.request) return null;
  const request = data.request;

  return (
    <Box>
      <Typography sx={{ fontWeight: 500, mb: 1 }}>Delete account</Typography>
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, display: "flex", flexDirection: "column", gap: 1.5 }}>
        {request ? (
          <>
            <Alert severity="warning">
              {request.status === "awaiting"
                ? "Your account is waiting for staff to approve its deletion."
                : `Your account will be deleted on ${day(request.scheduledFor)}${data.needsApproval ? ", after staff review" : ""}.`}
            </Alert>
            <Box>
              <Button variant="outlined" disabled={cancelling} onClick={() => cancel()}>
                {cancelling ? "Cancelling…" : "Cancel deletion — keep my account"}
              </Button>
            </Box>
          </>
        ) : (
          <>
            {data.lastRejected && (
              <Alert severity="info">Your last request wasn't approved: {data.lastRejected.note}</Alert>
            )}
            <Typography variant="body2" color="text.secondary">
              Your profile, chats, doubts, practice history and support tickets are deleted. Payment records are kept without your
              name, and exam results stay on leaderboards as "Deleted student".
              {data.graceDays > 0 ? ` You have ${data.graceDays} days to change your mind.` : ""}
            </Typography>
            <Box>
              <Button color="error" variant="outlined" startIcon={<Trash2 size={15} />} onClick={() => setOpen(true)}>
                Delete my account
              </Button>
            </Box>
          </>
        )}
      </Paper>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Delete your account?</DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: "8px !important" }}>
          <TextField label="Why are you leaving? (optional)" value={reason} onChange={(e) => setReason(e.target.value)} multiline minRows={2} fullWidth />
          <TextField label='Type DELETE to confirm' value={confirm} onChange={(e) => setConfirm(e.target.value)} fullWidth />
          {error && <Alert severity="warning">{error.data?.message || "Could not send the request."}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Keep my account</Button>
          <Button
            color="error"
            variant="contained"
            disabled={confirm.trim().toUpperCase() !== "DELETE" || requesting}
            onClick={async () => {
              try {
                await requestDeletion({ reason, confirm }).unwrap();
                setOpen(false);
                setConfirm("");
              } catch {
                // shown above
              }
            }}
          >
            {requesting ? "Sending…" : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
