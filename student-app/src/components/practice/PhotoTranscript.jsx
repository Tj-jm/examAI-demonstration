import { useState } from "react";
import { Box, Typography, ButtonBase, Collapse } from "@mui/material";
import { ChevronDown, ScanText } from "lucide-react";
import Latex from "../Latex";

// What the AI read from the answer photos before marking them — so a
// student can see when a column or line was missed and retake the photo.
export default function PhotoTranscript({ text, fontSize = 13 }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <Box sx={{ mt: 1.25 }}>
      <ButtonBase onClick={() => setOpen((v) => !v)} sx={{ gap: 0.75, borderRadius: 1, color: "text.secondary", fontSize: 12.5, fontWeight: 500 }}>
        <ScanText size={14} /> What the AI read from your photo
        <ChevronDown size={14} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
      </ButtonBase>
      <Collapse in={open}>
        <Box sx={{ mt: 0.75, p: 1.25, borderRadius: 1.5, bgcolor: "background.paper", border: "1px dashed", borderColor: "divider" }}>
          <Latex as="div" style={{ fontSize, whiteSpace: "pre-wrap" }}>{text}</Latex>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>
            Something missing? Retake the photo straight on, in good light, with the whole page in view.
          </Typography>
        </Box>
      </Collapse>
    </Box>
  );
}
