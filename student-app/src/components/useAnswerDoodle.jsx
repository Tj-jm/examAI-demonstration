import { lazy, Suspense, useState } from "react";
import { Button, IconButton } from "@mui/material";
import { PenLine, Pencil } from "lucide-react";

const DoodlePad = lazy(() => import("./DoodlePad"));

// The drawing pad wired to a written answer's image list, for the image
// uploaders (exam and practice). "Draw answer" opens fresh pages; the
// pencil on an attached image reopens it to draw on. Each page uploads
// through the uploader's own upload(file, { drawn: true }) => url.
//
// Returns the button, the per-image edit button, and the pad itself.
export default function useAnswerDoodle({ images, onChange, upload, maxImages, draftKey, forceAttach = false, question = null }) {
  const [editing, setEditing] = useState(null); // { url } when drawing on an attached image
  const [open, setOpen] = useState(false);
  const room = maxImages - images.length;

  const onAttach = async (files) => {
    const urls = [];
    for (const file of files) urls.push(await upload(file, { drawn: true }));
    if (editing) {
      const at = images.indexOf(editing.url);
      const next = [...images];
      next.splice(at < 0 ? next.length : at, at < 0 ? 0 : 1, ...urls);
      onChange(next.slice(0, maxImages));
    } else {
      onChange([...images, ...urls].slice(0, maxImages));
    }
    return urls;
  };

  const close = () => { setOpen(false); setEditing(null); };

  const button = (
    <Button size="small" variant="outlined" startIcon={<PenLine size={14} />} disabled={room <= 0} onClick={() => { setEditing(null); setOpen(true); }}>
      Draw answer
    </Button>
  );

  const editButton = (url) => (
    <IconButton
      size="small"
      aria-label="Draw on this page"
      onClick={() => { setEditing({ url }); setOpen(true); }}
      sx={{ position: "absolute", bottom: -8, right: -8, bgcolor: "background.paper", boxShadow: 1, width: 22, height: 22, "&:hover": { bgcolor: "background.paper" } }}
    >
      <Pencil size={11} />
    </IconButton>
  );

  const pad = open && (
    <Suspense fallback={null}>
      <DoodlePad
        open={open}
        onClose={close}
        onAttach={onAttach}
        draftKey={draftKey}
        startFrom={editing?.url || null}
        // Drawing on an attached image keeps it one page.
        maxPages={editing ? 1 : Math.max(1, room)}
        forceAttach={forceAttach}
        question={question}
      />
    </Suspense>
  );

  return { button, editButton, pad };
}
