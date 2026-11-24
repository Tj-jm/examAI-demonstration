import { useRef, useState } from "react";
import { Box, Button, IconButton, Typography } from "@mui/material";
import { X } from "lucide-react";
import useAnswerDoodle from "../useAnswerDoodle";

// The practice-side twin of ExamTake.jsx's AnswerImageUploader — same idea
// (one or more photographed pages of working, attached alongside or instead
// of typed text), but simpler underneath: there's no submission document to
// attach to here, just a plain upload that hands back a url the component
// holds in local state and sends along with the actual grade-written call
// when "Check with AI" is pressed. Shared between PracticeSession.jsx (the
// full practice page) and PracticeModal.jsx (the study plan's quick-practice
// popup) — the popup used to skip image answers entirely and hand off to
// the full page for them, which meant a student opening a written question
// from their study plan with only a photographed answer had no way to check
// it without leaving the modal first.
//
// "Draw answer" opens the drawing pad instead (useAnswerDoodle.jsx).
export const MAX_ANSWER_IMAGES = 10;

export default function PracticeAnswerImageUploader({ images, onChange, disabled, batchId, uploadAnswerImage, draftKey, question }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const doodle = useAnswerDoodle({
    images,
    onChange,
    upload: async (file, { drawn } = {}) => (await uploadAnswerImage({ batchId, file, drawn }).unwrap()).url,
    maxImages: MAX_ANSWER_IMAGES,
    draftKey,
    question,
  });

  const pick = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (images.length >= MAX_ANSWER_IMAGES) {
      setError(`Up to ${MAX_ANSWER_IMAGES} images per answer.`);
      return;
    }

    setError(null);
    setUploading(true);
    try {
      const result = await uploadAnswerImage({ batchId, file }).unwrap();
      onChange([...images, result.url]);
      // No camera data: likely a screenshot or saved picture (utils/photo.js).
      if (result.noCamera) setError("That image has no camera data, so it looks like a screenshot or a saved picture. It is flagged for your teacher. Attach photos of your own handwritten work.");
    } catch (err) {
      setError(err.data?.message || "Could not upload that image.");
    } finally {
      setUploading(false);
    }
  };

  const remove = (url) => onChange(images.filter((u) => u !== url));

  return (
    <Box sx={{ mt: 1.5 }}>
      {images.length > 0 && (
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mb: 1 }}>
          {images.map((url) => (
            <Box key={url} sx={{ position: "relative" }}>
              <Box component="img" src={url} alt="" sx={{ width: 72, height: 72, objectFit: "cover", borderRadius: 1.5, display: "block", border: "1px solid", borderColor: "divider" }} />
              {!disabled && (
                <IconButton
                  size="small"
                  onClick={() => remove(url)}
                  sx={{ position: "absolute", top: -8, right: -8, bgcolor: "background.paper", boxShadow: 1, width: 22, height: 22, "&:hover": { bgcolor: "background.paper" } }}
                >
                  <X size={12} />
                </IconButton>
              )}
              {!disabled && doodle.editButton(url)}
            </Box>
          ))}
        </Box>
      )}
      {!disabled && (
        <>
          <input ref={inputRef} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
          <Button
            size="small"
            variant="outlined"
            disabled={uploading || images.length >= MAX_ANSWER_IMAGES}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? "Uploading…" : images.length > 0 ? "Add another image" : "Attach an image"}
          </Button>
          <Box component="span" sx={{ ml: 1 }}>{doodle.button}</Box>
          {doodle.pad}
        </>
      )}
      {error && (
        <Typography variant="caption" color="error" sx={{ display: "block", mt: 0.5 }}>{error}</Typography>
      )}
    </Box>
  );
}
