import { useState } from "react";
import { Box, Typography, IconButton, Paper, Button, Skeleton, List, ListItemButton, ListItemText, Drawer, useMediaQuery } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Plus, Trash2, MessagesSquare } from "lucide-react";
import { useGetBatchQuery, useGetDocChatSettingsQuery, useGetDocChatThreadsQuery, useDeleteDocChatThreadMutation } from "../../api/contentApi";
import DocChat from "../../components/chat/DocChat";
import EmptyState from "../../components/EmptyState";
import AiUsageMeter from "../../components/AiUsageMeter";
import { useLayoutMode } from "../../layout/Shell";
import { useTerms } from "../../BrandingContext";

// "Ask your course": one chat over every lecture of the batch, with the
// student's past conversations alongside.
export default function CourseChat() {
  const terms = useTerms();
  const { batchId } = useParams();
  const navigate = useNavigate();
  const theme = useTheme();
  const app = useLayoutMode() === "app";
  const mdUp = useMediaQuery(theme.breakpoints.up("md"));
  // The chat list sits beside the chat only with real room for it; the app
  // layout is a 480px column even on a desktop screen.
  const wide = !app && mdUp;
  const { data: batch, isLoading } = useGetBatchQuery(batchId);
  const { data: settings } = useGetDocChatSettingsQuery(batchId, { skip: !batch?.features?.docChat });
  const { data: threadData } = useGetDocChatThreadsQuery({ batchId, lecture: "none" }, { skip: !batch?.features?.docChat });
  const [deleteThread] = useDeleteDocChatThreadMutation();
  const [threadId, setThreadId] = useState(null);
  const [listOpen, setListOpen] = useState(false);

  if (isLoading) return <Box sx={{ p: 3 }}><Skeleton variant="rounded" height={300} /></Box>;

  const available = batch?.features?.aiAssist && batch?.features?.docChat && settings?.enabled !== false && settings?.scope !== "lecture";
  if (!available) {
    return (
      <Box sx={{ p: 3 }}>
        <EmptyState
          icon={MessagesSquare}
          title="Course chat isn't available"
          description="Asking the course documents isn't turned on for this batch."
          secondaryAction={{ label: `Back to ${terms.batch}`, onClick: () => navigate(`/batches/${batchId}`) }}
        />
      </Box>
    );
  }

  const threads = threadData?.threads || [];
  const openCitation = (c) => {
    const params = new URLSearchParams();
    if (c.media) params.set("file", c.media);
    if (c.page) params.set("page", c.page);
    navigate(`/batches/${batchId}/lectures/${c.lecture}${params.toString() ? `?${params}` : ""}`);
  };

  const list = (
    <Box sx={{ width: wide ? 260 : 290, p: 1.5 }}>
      <Button fullWidth variant="outlined" startIcon={<Plus size={16} />} onClick={() => { setThreadId(null); setListOpen(false); }} sx={{ mb: 1 }}>
        New chat
      </Button>
      <List dense disablePadding>
        {threads.map((t) => (
          <ListItemButton
            key={t._id}
            selected={t._id === threadId}
            onClick={() => { setThreadId(t._id); setListOpen(false); }}
            sx={{ borderRadius: 2, pr: 0.5 }}
          >
            <ListItemText primary={t.title || "Chat"} secondary={new Date(t.updatedAt).toLocaleDateString()} primaryTypographyProps={{ noWrap: true, fontSize: 13 }} />
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                deleteThread({ batchId, id: t._id });
                if (t._id === threadId) setThreadId(null);
              }}
              aria-label="Delete chat"
            >
              <Trash2 size={14} />
            </IconButton>
          </ListItemButton>
        ))}
        {threads.length === 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", px: 1, py: 2 }}>No past chats yet.</Typography>
        )}
      </List>
    </Box>
  );

  return (
    <Box sx={{ p: app ? 1.5 : { xs: 2, md: 3 }, maxWidth: 1000, mx: "auto" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
        <IconButton size="small" onClick={() => navigate(`/batches/${batchId}`)}><ArrowLeft size={18} /></IconButton>
        <Typography variant="h6" sx={{ fontWeight: 500, fontSize: 17, flex: 1 }}>Ask your course</Typography>
        {!wide && (
          <Button size="small" startIcon={<MessagesSquare size={15} />} onClick={() => setListOpen(true)}>Chats</Button>
        )}
      </Box>
      {/* With a daily question limit, course chat doesn't use the AI allowance. */}
      {!settings?.freePerDay && <AiUsageMeter batchId={batchId} compact />}
      <Box sx={{ display: "flex", gap: 2, mt: 1 }}>
        {wide && <Paper variant="outlined" sx={{ borderRadius: 3, flexShrink: 0, maxHeight: "70vh", overflowY: "auto" }}>{list}</Paper>}
        <Paper variant="outlined" sx={{ flex: 1, borderRadius: 3, p: app ? 1 : 1.5, minWidth: 0 }}>
          <DocChat
            batchId={batchId}
            threadId={threadId}
            onThread={setThreadId}
            onCitation={openCitation}
            doubtsOn={Boolean(batch.features?.doubtSolving)}
            // App layout: the screen minus its top bar, the fixed bottom
            // tabs and this page's header, so the input is never under the
            // tabs. dvh follows the phone keyboard and browser bars.
            height={app ? "calc(100dvh - 56px - 72px - env(safe-area-inset-bottom) - 130px)" : "65vh"}
          />
        </Paper>
      </Box>
      {!wide && <Drawer anchor="left" open={listOpen} onClose={() => setListOpen(false)}>{list}</Drawer>}
    </Box>
  );
}
