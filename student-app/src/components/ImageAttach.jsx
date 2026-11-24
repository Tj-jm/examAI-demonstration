import { useRef } from "react";
import { Box, IconButton, CircularProgress, Button } from "@mui/material";
import { ImagePlus, X } from "lucide-react";

// Picks and uploads images (up to `max`), showing thumbnails that can be
// removed. `upload(file)` resolves to { url }.
export default function ImageAttach({ images, onChange, upload, uploading, max = 4, label = "Add image" }) {
  const input = useRef(null);
  const pick = async (e) => {
    const files = [...(e.target.files || [])].slice(0, Math.max(0, max - images.length));
    e.target.value = "";
    const added = [];
    for (const file of files) {
      try {
        const { url } = await upload(file).unwrap();
        added.push(url);
      } catch {
        // the caller's mutation error shows it
      }
    }
    if (added.length) onChange([...images, ...added]);
  };

  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, alignItems: "center" }}>
      {images.map((url) => (
        <Box key={url} sx={{ position: "relative", width: 64, height: 64, borderRadius: 2, overflow: "hidden", border: 1, borderColor: "divider" }}>
          <Box component="img" src={url} alt="" sx={{ width: "100%", height: "100%", objectFit: "cover" }} />
          <IconButton
            size="small"
            onClick={() => onChange(images.filter((u) => u !== url))}
            sx={{ position: "absolute", top: 2, right: 2, p: 0.25, bgcolor: "rgba(0,0,0,0.55)", color: "#fff", "&:hover": { bgcolor: "rgba(0,0,0,0.7)" } }}
            aria-label="Remove image"
          >
            <X size={12} />
          </IconButton>
        </Box>
      ))}
      {uploading && <CircularProgress size={18} />}
      {images.length < max && (
        <Button size="small" startIcon={<ImagePlus size={15} />} onClick={() => input.current?.click()} disabled={uploading}>
          {label}
        </Button>
      )}
      <input ref={input} type="file" hidden multiple accept="image/png,image/jpeg,image/webp,image/heic" onChange={pick} />
    </Box>
  );
}
