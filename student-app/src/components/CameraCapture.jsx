import { useEffect, useRef, useState } from "react";
import { Box, Button, Dialog, IconButton, Typography, CircularProgress } from "@mui/material";
import { X, Camera, RotateCcw, Check } from "lucide-react";

// Takes one photo with the device camera, in the app: no gallery and no
// files. Used where a batch allows exam answer photos from the camera only
// (features.cameraOnlyAnswers). onCapture(file) gets a JPEG.
export default function CameraCapture({ open, onClose, onCapture }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [error, setError] = useState(null);
  const [shot, setShot] = useState(null); // { url, blob } once taken
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    let gone = false;
    setError(null);
    setShot(null);
    setReady(false);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This device or browser can't open the camera here.");
      return undefined;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((stream) => {
        if (gone) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(() => setError("Allow camera access to take a photo of your answer."));
    return () => {
      gone = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [open]);

  const take = () => {
    const v = videoRef.current;
    if (!v?.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d").drawImage(v, 0, 0);
    c.toBlob((blob) => blob && setShot({ blob, url: URL.createObjectURL(blob) }), "image/jpeg", 0.9);
  };

  const use = () => {
    onCapture(new File([shot.blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" }));
    onClose();
  };

  useEffect(() => () => { if (shot) URL.revokeObjectURL(shot.url); }, [shot]);

  return (
    <Dialog fullScreen open={open} onClose={onClose} PaperProps={{ sx: { bgcolor: "#000" } }}>
      <Box sx={{ position: "relative", flex: 1, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
        <IconButton onClick={onClose} aria-label="Close" sx={{ position: "absolute", top: 8, left: 8, color: "#fff", zIndex: 2 }}><X size={22} /></IconButton>
        {error ? (
          <Typography sx={{ color: "#fff", px: 3, textAlign: "center" }}>{error}</Typography>
        ) : (
          <>
            {/* Kept mounted under a taken photo, so Retake shows the live
                camera again. */}
            <video ref={(el) => { videoRef.current = el; if (el && streamRef.current && el.srcObject !== streamRef.current) el.srcObject = streamRef.current; }} autoPlay playsInline muted onLoadedData={() => setReady(true)} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: shot ? "none" : "block" }} />
            {shot && <Box component="img" src={shot.url} alt="" sx={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />}
            {!ready && !shot && <CircularProgress sx={{ position: "absolute", color: "#fff" }} />}
          </>
        )}
      </Box>
      {!error && (
        <Box sx={{ display: "flex", justifyContent: "center", gap: 2, p: 2 }}>
          {shot ? (
            <>
              <Button variant="outlined" startIcon={<RotateCcw size={16} />} onClick={() => setShot(null)} sx={{ color: "#fff", borderColor: "#fff" }}>Retake</Button>
              <Button variant="contained" startIcon={<Check size={16} />} onClick={use}>Use photo</Button>
            </>
          ) : (
            <IconButton onClick={take} disabled={!ready} aria-label="Take photo" sx={{ width: 68, height: 68, bgcolor: "#fff", "&:hover": { bgcolor: "#eee" } }}>
              <Camera size={28} color="#000" />
            </IconButton>
          )}
        </Box>
      )}
    </Dialog>
  );
}
