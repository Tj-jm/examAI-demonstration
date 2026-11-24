import { useRef, useState } from "react";
import { Box, Dialog, IconButton } from "@mui/material";
import { X, ZoomIn, ZoomOut } from "lucide-react";

// Every question/option image in the student app goes through this rather
// than a bare <img> — one click opens it full-size in a dialog, which
// matters most for a diagram-only option (no text at all) that's otherwise
// stuck at thumbnail size. preventDefault + stopPropagation on the click
// matter here specifically: this image usually sits inside something else
// that reacts to a click of its own — an MCQ option row (McqOptions' own
// onClick) or a <label> wrapping a radio input (ExamTake's
// FormControlLabel, where a browser forwards an unprevented click straight
// to the input) — without both, tapping the image to zoom would also
// select that option.
// In the dialog, + / - (or a double tap) magnify up to 4x; scroll or drag
// to move around, so a handwritten script page can be read line by line.
const ZOOMS = [1, 1.5, 2, 3, 4];

export default function ZoomableImage({ src, alt = "", sx, badge = false }) {
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(0);
  const fitWidth = useRef(0);
  const pane = useRef(null);
  const drag = useRef(null);
  if (!src) return null;

  const close = () => { setOpen(false); setZoom(0); };
  const step = (d) => setZoom((z) => Math.max(0, Math.min(ZOOMS.length - 1, z + d)));
  const scale = ZOOMS[zoom];
  const onDown = (e) => {
    if (zoom === 0 || e.pointerType === "touch") return;
    drag.current = { x: e.clientX, y: e.clientY, left: pane.current.scrollLeft, top: pane.current.scrollTop };
  };
  const onMove = (e) => {
    if (!drag.current) return;
    pane.current.scrollLeft = drag.current.left - (e.clientX - drag.current.x);
    pane.current.scrollTop = drag.current.top - (e.clientY - drag.current.y);
  };

  return (
    <>
      <Box sx={{ position: "relative", display: "inline-block", maxWidth: "100%", verticalAlign: "top" }}>
        <Box
          component="img"
          src={src}
          alt={alt}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
          }}
          sx={{ cursor: "zoom-in", display: "block", ...sx }}
        />
        {badge && (
          <Box sx={{ position: "absolute", right: 6, bottom: 6, width: 26, height: 26, borderRadius: "50%", bgcolor: "rgba(0,0,0,0.55)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
            <ZoomIn size={15} />
          </Box>
        )}
      </Box>
      <Dialog
        open={open}
        onClose={close}
        maxWidth={false}
        PaperProps={{ sx: { bgcolor: "transparent", boxShadow: "none", overflow: "visible", m: 2 } }}
      >
        <Box sx={{ position: "relative" }}>
          <IconButton
            onClick={close}
            size="small"
            aria-label="Close"
            sx={{
              position: "absolute", top: -16, right: -16, bgcolor: "background.paper",
              boxShadow: 2, "&:hover": { bgcolor: "background.paper" },
            }}
          >
            <X size={16} />
          </IconButton>
          <Box
            ref={pane}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={() => { drag.current = null; }}
            onPointerLeave={() => { drag.current = null; }}
            sx={{ maxWidth: "90vw", maxHeight: "85vh", overflow: "auto", borderRadius: 1, cursor: zoom ? "grab" : "zoom-in", touchAction: zoom ? "pan-x pan-y" : "auto" }}
          >
            <Box
              component="img"
              src={src}
              alt={alt}
              draggable={false}
              onLoad={(e) => { fitWidth.current = e.currentTarget.clientWidth; }}
              onDoubleClick={() => setZoom((z) => (z ? 0 : 2))}
              sx={zoom
                ? { width: fitWidth.current * scale, maxWidth: "none", display: "block" }
                : { maxWidth: "90vw", maxHeight: "85vh", display: "block" }}
            />
          </Box>
          <Box sx={{ position: "absolute", bottom: 10, left: "50%", transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: 0.5, bgcolor: "rgba(0,0,0,0.6)", color: "#fff", borderRadius: 999, px: 0.5 }}>
            <IconButton size="small" aria-label="Zoom out" disabled={zoom === 0} onClick={() => step(-1)} sx={{ color: "#fff", "&.Mui-disabled": { color: "rgba(255,255,255,0.35)" } }}><ZoomOut size={18} /></IconButton>
            <Box component="span" sx={{ fontSize: 12, minWidth: 34, textAlign: "center" }}>{Math.round(scale * 100)}%</Box>
            <IconButton size="small" aria-label="Zoom in" disabled={zoom === ZOOMS.length - 1} onClick={() => step(1)} sx={{ color: "#fff", "&.Mui-disabled": { color: "rgba(255,255,255,0.35)" } }}><ZoomIn size={18} /></IconButton>
          </Box>
        </Box>
      </Dialog>
    </>
  );
}
