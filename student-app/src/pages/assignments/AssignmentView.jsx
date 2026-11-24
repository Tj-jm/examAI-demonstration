import { useEffect, useState } from "react";
import { Box, Typography, Paper, Chip, Skeleton, IconButton, Button, TextField, Alert, LinearProgress } from "@mui/material";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Paperclip, Trash2, Upload, Send, ClipboardList } from "lucide-react";
import {
  useGetAssignmentQuery, useSaveAssignmentWorkMutation, useSubmitAssignmentMutation, useUploadAssignmentFileMutation,
} from "../../api/contentApi";
import EmptyState from "../../components/EmptyState";
import SafeMarkdown from "../../components/SafeMarkdown";
import AttachmentList from "../../components/AttachmentList";
import { dueText, statusOf } from "./AssignmentList";
import { tapFeedback } from "../../native/haptics";
import { useHomeMx } from "../../BrandingContext";

const ACCEPT = "image/png,image/jpeg,image/webp,application/pdf,.docx,.pptx,.txt,.md";

export default function AssignmentView() {
  const mx = useHomeMx();
  const { batchId, id } = useParams();
  const navigate = useNavigate();
  const { data: a, isLoading, error } = useGetAssignmentQuery({ batchId, id });
  const [save, { isLoading: saving, error: saveError }] = useSaveAssignmentWorkMutation();
  const [submit, { isLoading: submitting, error: submitError }] = useSubmitAssignmentMutation();
  const [upload, { isLoading: uploading, error: uploadError }] = useUploadAssignmentFileMutation();
  const [text, setText] = useState("");
  const [files, setFiles] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (a?.mine && !dirty) { setText(a.mine.text || ""); setFiles(a.mine.files || []); }
  }, [a, dirty]);

  if (isLoading) return <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 700, mx }}><Skeleton variant="rounded" height={220} /></Box>;
  if (!a) return <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 700, mx }}><EmptyState icon={ClipboardList} title="Can't open this assignment" description={error?.data?.message} /></Box>;

  const mine = a.mine;
  const graded = mine?.status === "graded";
  const editable = !graded && a.open;
  const takesText = a.submissionType !== "files";
  const takesFiles = a.submissionType !== "text";
  const st = statusOf(a);
  const late = new Date(a.dueAt).getTime() < Date.now();

  const persist = async () => {
    await save({ batchId, id, ...(takesText ? { text } : {}), ...(takesFiles ? { files } : {}) }).unwrap();
    setDirty(false);
  };
  const onSave = async () => { await persist(); setNote("Saved. Not handed in yet."); };
  const onSubmit = async () => {
    await persist();
    await submit({ batchId, id }).unwrap();
    tapFeedback();
    setNote("Handed in.");
  };
  const onFile = async (file) => {
    if (!file) return;
    if (files.length >= a.maxFiles) { setNote(`Up to ${a.maxFiles} files.`); return; }
    const stored = await upload({ batchId, id, file }).unwrap();
    setFiles((f) => [...f, stored]);
    setDirty(true);
  };

  const err = saveError || submitError || uploadError;

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 700, mx }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
        <IconButton size="small" onClick={() => navigate(`/batches/${batchId}/assignments`)} aria-label="Back to assignments"><ArrowLeft size={18} /></IconButton>
        <Typography variant="body2" color="text.secondary">Assignments</Typography>
      </Box>

      <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, borderRadius: 3, mb: 2 }}>
        <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.5, mb: 1 }}>
          <Typography variant="h6" sx={{ flex: 1, fontWeight: 600 }}>{a.title}</Typography>
          <Chip size="small" label={st.label} color={st.color} variant={st.color === "default" ? "outlined" : "filled"} />
        </Box>
        <Typography variant="body2" color="text.secondary">
          {dueText(a.dueAt)} · {new Date(a.dueAt).toLocaleString()} · {a.maxMarks} marks
        </Typography>
        {a.allowLate ? (
          <Typography variant="body2" color="text.secondary">
            Late work is accepted for {a.lateDays} day{a.lateDays === 1 ? "" : "s"}, {a.latePenalty}% off for each day late.
          </Typography>
        ) : (
          <Typography variant="body2" color="text.secondary">Late work isn't accepted.</Typography>
        )}
        {a.instructions && <Box sx={{ mt: 2, fontSize: 14.5 }}><SafeMarkdown>{a.instructions}</SafeMarkdown></Box>}
        <AttachmentList attachments={(a.attachments || []).map((f) => ({ ...f, title: f.name || "File" }))} sx={{ mt: 2 }} />
        {a.rubric?.length > 0 && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>How it's marked</Typography>
            {a.rubric.map((r, i) => (
              <Box key={i} sx={{ display: "flex", justifyContent: "space-between", gap: 2, py: 0.5, borderTop: i ? 1 : 0, borderColor: "divider", fontSize: 14 }}>
                <span>{r.criterion}</span>
                <span style={{ whiteSpace: "nowrap" }}>
                  {graded && mine.rubricScores?.[i] ? `${mine.rubricScores[i].marks} / ` : ""}{r.marks}
                </span>
              </Box>
            ))}
          </Box>
        )}
      </Paper>

      {graded && (
        <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, borderRadius: 3, mb: 2, borderColor: "success.main" }}>
          <Typography variant="caption" color="text.secondary">Your grade</Typography>
          <Typography variant="h4" sx={{ fontWeight: 600 }}>{mine.finalMarks} <Typography component="span" variant="h6" color="text.secondary">/ {a.maxMarks}</Typography></Typography>
          {mine.latePenalty > 0 && <Typography variant="body2" color="text.secondary">{mine.marks} before {mine.latePenalty}% off for handing in late.</Typography>}
          {mine.feedback && <Box sx={{ mt: 1.5, fontSize: 14.5, whiteSpace: "pre-wrap" }}>{mine.feedback}</Box>}
          {mine.rubricScores?.some((r) => r.comment) && (
            <Box sx={{ mt: 1.5 }}>
              {mine.rubricScores.map((r, i) => r.comment && (
                <Typography key={i} variant="body2" color="text.secondary">{a.rubric[i]?.criterion}: {r.comment}</Typography>
              ))}
            </Box>
          )}
        </Paper>
      )}

      <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, borderRadius: 3 }}>
        <Typography sx={{ fontWeight: 600, mb: 1 }}>Your work</Typography>
        {mine?.submittedAt && <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>Handed in {new Date(mine.submittedAt).toLocaleString()}{mine.latePenalty ? ` · ${mine.latePenalty}% late penalty` : ""}</Typography>}
        {err && <Alert severity="error" sx={{ mb: 1.5 }}>{err.data?.message || "Something went wrong."}</Alert>}
        {note && !err && <Alert severity="success" sx={{ mb: 1.5 }} onClose={() => setNote("")}>{note}</Alert>}
        {!editable && !graded && !a.open && !mine?.submittedAt && <Alert severity="warning" sx={{ mb: 1.5 }}>This closed before you handed anything in.</Alert>}

        {takesText && (
          <TextField
            multiline
            minRows={6}
            fullWidth
            placeholder="Write your answer here"
            value={text}
            disabled={!editable}
            onChange={(e) => { setText(e.target.value); setDirty(true); }}
            sx={{ mb: 1.5 }}
          />
        )}

        {takesFiles && (
          <Box sx={{ mb: 1.5 }}>
            {files.map((f, i) => (
              <Box key={f.url} sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.5 }}>
                <Paperclip size={15} />
                <Typography component="a" href={f.url} target="_blank" rel="noreferrer" variant="body2" sx={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "inherit" }}>{f.name || `File ${i + 1}`}</Typography>
                {editable && <IconButton size="small" aria-label="Remove file" onClick={() => { setFiles(files.filter((x) => x.url !== f.url)); setDirty(true); }}><Trash2 size={15} /></IconButton>}
              </Box>
            ))}
            {uploading && <LinearProgress sx={{ my: 1 }} />}
            {editable && files.length < a.maxFiles && (
              <Button component="label" size="small" startIcon={<Upload size={15} />} disabled={uploading}>
                Add a file or photo
                <input type="file" hidden accept={ACCEPT} onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
              </Button>
            )}
          </Box>
        )}

        {editable && (
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
            <Button variant="outlined" onClick={onSave} disabled={saving || submitting || !dirty}>Save draft</Button>
            <Button variant="contained" startIcon={<Send size={16} />} onClick={onSubmit} disabled={saving || submitting || uploading || (!text.trim() && !files.length)}>
              {mine?.status === "submitted" ? "Hand in again" : late ? "Hand in late" : "Hand in"}
            </Button>
          </Box>
        )}
        {editable && mine?.status === "submitted" && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
            You can change it and hand it in again until it's graded or closes.
          </Typography>
        )}
      </Paper>
    </Box>
  );
}
