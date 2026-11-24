import { useState } from "react";
import { Box, Typography, Paper, TextField, Button, Alert, IconButton, Chip, Skeleton } from "@mui/material";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { useGetMyTicketQuery, useReplyTicketMutation, useResolveTicketMutation, useUploadSupportImageMutation } from "../../api/accountApi";
import ImageAttach from "../../components/ImageAttach";
import ZoomableImage from "../../components/ZoomableImage";
import EmptyState from "../../components/EmptyState";
import { CATEGORY_LABEL, STATUS_META } from "./supportMeta";

export default function SupportThread() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, error: loadError } = useGetMyTicketQuery(id);
  const [reply, { isLoading: sending, error }] = useReplyTicketMutation();
  const [resolve, { isLoading: resolving }] = useResolveTicketMutation();
  const [upload, { isLoading: uploading }] = useUploadSupportImageMutation();
  const [text, setText] = useState("");
  const [images, setImages] = useState([]);

  if (isLoading) return <Box sx={{ p: 3 }}><Skeleton variant="rounded" height={300} /></Box>;
  const ticket = data?.ticket;
  if (!ticket) {
    return (
      <Box sx={{ p: 3 }}>
        <EmptyState title="Ticket not found" description={loadError?.data?.message} secondaryAction={{ label: "Back to support", onClick: () => navigate("/support") }} />
      </Box>
    );
  }
  const status = STATUS_META[ticket.status] || STATUS_META.open;

  const send = async () => {
    try {
      await reply({ id, text, images }).unwrap();
      setText("");
      setImages([]);
    } catch {
      // shown below
    }
  };

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 720, mx: "var(--home-mx)" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
        <IconButton size="small" onClick={() => navigate("/support")}><ArrowLeft size={18} /></IconButton>
        <Typography variant="h6" sx={{ fontWeight: 500, flex: 1, minWidth: 0 }} noWrap>{ticket.subject}</Typography>
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2, flexWrap: "wrap" }}>
        <Chip size="small" variant="outlined" color={status.color} label={status.label} />
        <Typography variant="caption" color="text.secondary">
          {CATEGORY_LABEL[ticket.category]}{ticket.batch?.name ? ` · ${ticket.batch.name}` : ""} · opened {new Date(ticket.createdAt).toLocaleDateString()}
        </Typography>
        <Box sx={{ flex: 1 }} />
        {ticket.status !== "resolved" && (
          <Button size="small" startIcon={<CheckCircle2 size={15} />} disabled={resolving} onClick={() => resolve(id)}>
            Mark resolved
          </Button>
        )}
      </Box>

      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, mb: 2 }}>
        {ticket.messages.map((m) => {
          const mine = m.from === "student";
          return (
            <Box key={m._id} sx={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start" }}>
              <Paper
                variant={mine ? "elevation" : "outlined"}
                elevation={0}
                sx={{
                  px: 1.75, py: 1.25, borderRadius: 3, maxWidth: "88%",
                  ...(mine ? { bgcolor: "primary.main", color: "primary.contrastText", borderBottomRightRadius: 6 } : { borderBottomLeftRadius: 6 }),
                }}
              >
                <Typography variant="caption" sx={{ display: "block", opacity: 0.8, mb: 0.25 }}>
                  {mine ? "You" : m.author?.name || "Support"} · {new Date(m.at).toLocaleString()}
                </Typography>
                {m.text && <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>{m.text}</Typography>}
                {m.images?.length > 0 && (
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mt: m.text ? 1 : 0 }}>
                    {m.images.map((url) => <ZoomableImage key={url} src={url} sx={{ maxWidth: 200, maxHeight: 200, borderRadius: 2 }} />)}
                  </Box>
                )}
              </Paper>
            </Box>
          );
        })}
      </Box>

      {!ticket.canReply ? (
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
          <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>This ticket is closed. Still need help?</Typography>
          <Button variant="contained" onClick={() => navigate(`/support/new?category=${ticket.category === "appeal" ? "account" : ticket.category}&subject=${encodeURIComponent(ticket.subject)}`)}>
            Open a new ticket
          </Button>
        </Paper>
      ) : (
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, display: "flex", flexDirection: "column", gap: 1.25 }}>
        {ticket.status === "resolved" && (
          <Typography variant="caption" color="text.secondary">
            This ticket is resolved. Replying opens it again{ticket.reopenUntil ? ` — until ${new Date(ticket.reopenUntil).toLocaleDateString(undefined, { day: "numeric", month: "long" })}` : ""}.
          </Typography>
        )}
        <TextField
          placeholder="Write a reply…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          multiline
          minRows={2}
          maxRows={8}
          inputProps={{ maxLength: 4000 }}
          fullWidth
        />
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          <Box sx={{ flex: 1 }}>
            <ImageAttach images={images} onChange={setImages} upload={upload} uploading={uploading} />
          </Box>
          <Button variant="contained" disabled={(!text.trim() && !images.length) || sending || uploading} onClick={send}>
            {sending ? "Sending…" : "Send"}
          </Button>
        </Box>
        {error && <Alert severity="warning">{error.data?.message || "Could not send."}</Alert>}
      </Paper>
      )}
    </Box>
  );
}
