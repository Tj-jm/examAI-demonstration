import { useState } from "react";
import { Box, Paper, Typography, IconButton, Dialog, DialogContent } from "@mui/material";
import { Paperclip, ExternalLink, X, Download } from "lucide-react";

const formatBytes = (bytes) => {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// Same preview rule as a lecture's own attachments (LectureView.jsx): PDFs
// and images render inline in a modal, everything else still opens in a new
// tab since there's no reliable in-browser preview for it.
const previewKind = (mimeType) => {
  if (!mimeType) return null;
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("image/")) return "image";
  return null;
};

// Shared renderer for a Question's solutionAttachments (exam review, custom
// exam review, and every practice-feedback surface) — mirrors the lecture
// attachment list + preview modal so documents behave the same everywhere.
export default function AttachmentList({ attachments, sx }) {
  const [previewFile, setPreviewFile] = useState(null);

  if (!attachments?.length) return null;

  return (
    <>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75, ...sx }}>
        {attachments.map((file) => {
          const kind = previewKind(file.mimeType);
          const commonProps = {
            key: file._id,
            variant: "outlined",
            sx: { p: 1, borderRadius: 1.5, display: "flex", alignItems: "center", gap: 1, textDecoration: "none", color: "text.primary", cursor: "pointer" },
          };
          return kind ? (
            <Paper {...commonProps} onClick={() => setPreviewFile({ ...file, kind })}>
              <Paperclip size={14} />
              <Typography variant="body2" noWrap sx={{ flex: 1, fontSize: 12.5 }}>{file.title}</Typography>
              {file.sizeBytes != null && (
                <Typography variant="caption" color="text.secondary">{formatBytes(file.sizeBytes)}</Typography>
              )}
            </Paper>
          ) : (
            <Paper {...commonProps} component="a" href={file.url} target="_blank" rel="noreferrer">
              <Paperclip size={14} />
              <Typography variant="body2" noWrap sx={{ flex: 1, fontSize: 12.5 }}>{file.title}</Typography>
              {file.sizeBytes != null && (
                <Typography variant="caption" color="text.secondary">{formatBytes(file.sizeBytes)}</Typography>
              )}
              <ExternalLink size={13} />
            </Paper>
          );
        })}
      </Box>

      <Dialog open={Boolean(previewFile)} onClose={() => setPreviewFile(null)} maxWidth="md" fullWidth>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 2, py: 1.5, borderBottom: "1px solid", borderColor: "divider" }}>
          <Typography variant="body2" noWrap sx={{ flex: 1, fontWeight: 500 }}>{previewFile?.title}</Typography>
          <IconButton size="small" component="a" href={previewFile?.url} target="_blank" rel="noreferrer" download>
            <Download size={17} />
          </IconButton>
          <IconButton size="small" onClick={() => setPreviewFile(null)}>
            <X size={18} />
          </IconButton>
        </Box>
        <DialogContent sx={{ p: 0, bgcolor: previewFile?.kind === "pdf" ? "#525659" : "background.paper" }}>
          {previewFile?.kind === "pdf" && (
            <Box component="iframe" src={previewFile.url} sx={{ width: "100%", height: "75vh", border: "none", display: "block" }} />
          )}
          {previewFile?.kind === "image" && (
            <Box
              component="img"
              src={previewFile.url}
              alt={previewFile.title}
              sx={{ width: "100%", maxHeight: "75vh", objectFit: "contain", display: "block" }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
