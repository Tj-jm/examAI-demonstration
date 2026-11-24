import { useState } from "react";
import { Box, Typography, Paper, TextField, MenuItem, Button, Alert, IconButton } from "@mui/material";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useCreateTicketMutation, useUploadSupportImageMutation } from "../../api/accountApi";
import { useGetBatchesQuery } from "../../api/contentApi";
import ImageAttach from "../../components/ImageAttach";
import { CATEGORIES } from "./supportMeta";
import { useTerms } from "../../BrandingContext";
import PickField from "../../components/PickField";

// ?appeal=<conduct event id>&subject=… opens an appeal from Account standing.
export default function SupportNew() {
  const terms = useTerms();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const appeal = params.get("appeal");
  const [category, setCategory] = useState(appeal ? "account" : params.get("category") || "");
  const [batch, setBatch] = useState("");
  const [subject, setSubject] = useState(params.get("subject") || "");
  const [text, setText] = useState("");
  const [images, setImages] = useState([]);
  const { data: batches } = useGetBatchesQuery();
  const [create, { isLoading, error }] = useCreateTicketMutation();
  const [upload, { isLoading: uploading, error: uploadError }] = useUploadSupportImageMutation();

  const submit = async () => {
    try {
      const { ticket } = await create({ category, batch: batch || undefined, subject, text, images, conductEvent: appeal || undefined }).unwrap();
      navigate(`/support/${ticket._id}`, { replace: true });
    } catch {
      // shown below
    }
  };

  const ready = category && subject.trim() && (text.trim() || images.length);

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 640, mx: "var(--home-mx)" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
        <IconButton size="small" onClick={() => navigate(-1)}><ArrowLeft size={18} /></IconButton>
        <Typography variant="h6" sx={{ fontWeight: 500 }}>{appeal ? "Appeal" : "New ticket"}</Typography>
      </Box>
      <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 3, display: "flex", flexDirection: "column", gap: 2 }}>
        {!appeal && (
          <TextField select label="What is it about?" value={category} onChange={(e) => setCategory(e.target.value)} fullWidth>
            {CATEGORIES.map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
          </TextField>
        )}
        {(batches?.enrolled || []).length > 0 && (
          <PickField label={`${terms.Batch} (optional)`} value={batch} onChange={setBatch} fullWidth
            emptyLabel={`Not about a ${terms.batch}`} options={batches.enrolled.map((b) => ({ value: b._id, label: b.name }))} />
        )}
        <TextField label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} inputProps={{ maxLength: 140 }} fullWidth />
        <TextField
          label={appeal ? "Why should this be reconsidered?" : "Describe the problem"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          multiline
          minRows={5}
          inputProps={{ maxLength: 4000 }}
          fullWidth
        />
        <ImageAttach images={images} onChange={setImages} upload={upload} uploading={uploading} label="Add screenshot" />
        {(error || uploadError) && <Alert severity="warning">{(error || uploadError).data?.message || "Something went wrong."}</Alert>}
        <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
          <Button variant="contained" disabled={!ready || isLoading || uploading} onClick={submit}>
            {isLoading ? "Sending…" : "Send"}
          </Button>
        </Box>
      </Paper>
    </Box>
  );
}
