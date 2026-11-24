import { useLayoutEffect, useRef, useState } from "react";
import { Box, Typography, Button, Dialog, IconButton } from "@mui/material";
import { useTheme, alpha } from "@mui/material/styles";
import { useNavigate } from "react-router-dom";
import { Clock, X } from "lucide-react";
import { COMPONENTS } from "./BatchIcon";
import SafeMarkdown from "./SafeMarkdown";
import NoticeCoverFallback from "./NoticeCoverFallback";

// One card, used both in the homepage carousel and in a batch's Notice
// Central list — the sample this was modelled on used the same card in both
// places too, just inside a different container. Colors are pulled from
// the active theme rather than the sample's hardcoded gradient
// (#00c6ff → #ff5f6d) and button blue (#007bff), since this app ships six
// selectable themes and a fixed gradient would only ever look intentional
// in one of them.
// compact: the home carousel on a phone (Settings → Student app → Compact
// top area on mobile). The cover scales with the screen's height and drops
// on a short screen, and the body shows two lines, so the notice never
// takes most of the first screen.
export const COMPACT_COVER = "clamp(72px, 16svh, 120px)";
export const SHORT_SCREEN = "@media (max-height: 640px)";


// The button's icon at a size that reads next to its label: a preset drawn
// full size (BatchIcon shrinks presets to fit a padded tile), an uploaded
// picture as a small rounded square.
function ButtonIcon({ icon }) {
  if (icon.kind === "custom") {
    return <img src={icon.value} alt="" style={{ width: 20, height: 20, borderRadius: 4, objectFit: "cover", display: "block" }} />;
  }
  const Cmp = COMPONENTS[icon.value];
  return Cmp ? <Cmp size={18} /> : null;
}

const isExternal = (url) => {
  try {
    return new URL(url, window.location.origin).origin !== window.location.origin;
  } catch {
    return false;
  }
};
const goTo = (link, navigate) => {
  if (!link) return;
  if (isExternal(link)) window.open(link, "_blank", "noopener,noreferrer");
  else navigate(link);
};

// The whole notice in a pop-up (Read more). Closes only from its cross.
// Kept outside the carousel's cards, so turning to the next card never
// takes it away.
export function NoticeDialog({ notice, open, onClose }) {
  const navigate = useNavigate();
  if (!notice) return null;
  return (
    <Dialog open={open} fullWidth maxWidth="sm" scroll="body" disableEscapeKeyDown>
      <Box sx={{ position: "relative" }}>
        <IconButton size="small" onClick={onClose} aria-label="Close" sx={{ position: "absolute", right: 8, top: 8, zIndex: 1, bgcolor: "background.paper", "&:hover": { bgcolor: "background.paper" } }}><X size={16} /></IconButton>
        {notice.coverImage?.url && <Box component="img" src={notice.coverImage.url} alt="" sx={{ width: "100%", maxHeight: 220, objectFit: "cover", display: "block" }} />}
        <Box sx={{ p: 2.5 }}>
          <Typography sx={{ fontSize: 18, fontWeight: 600, mb: 1, pr: 4 }}>{notice.title}</Typography>
          <SafeMarkdown>{notice.bodyMarkdown}</SafeMarkdown>
          {notice.link && notice.linkLabel && (
            <Button variant="contained" fullWidth onClick={() => { onClose(); goTo(notice.link, navigate); }} startIcon={notice.icon?.value ? <ButtonIcon icon={notice.icon} /> : undefined} sx={{ mt: 2, textTransform: "none" }}>
              {notice.linkLabel}
            </Button>
          )}
        </Box>
      </Box>
    </Dialog>
  );
}

export default function NoticeCard({ notice, compact = false, onReadMore }) {
  const bodyRef = useRef(null);
  // Read more opens the whole notice in a pop-up, so a long notice never
  // stretches the cards beside it.
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  // Whether the body is taller than the cap, measured after it renders.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (el) setOverflows(el.scrollHeight > el.clientHeight + 2);
  }, [notice.bodyMarkdown]);
  const theme = useTheme();
  const navigate = useNavigate();

  const openLink = () => goTo(notice.link, navigate);

  return (
    <Box
      sx={{
        borderRadius: 3,
        overflow: "hidden",
        position: "relative",
        // Full height of its row, with the button and date at the bottom,
        // so cards side by side line up.
        height: "100%",
        display: "flex",
        flexDirection: "column",
        bgcolor: "background.paper",
        // A thin gradient ring rather than a flat border — the one piece of
        // the sample's look worth keeping as-is, just recolored from the
        // theme's own primary rather than a fixed cyan-to-coral gradient.
        "&::before": {
          content: '""',
          position: "absolute",
          inset: 0,
          borderRadius: 3,
          padding: "1.5px",
          background: `linear-gradient(135deg, ${theme.palette.primary.main}, ${alpha(theme.palette.primary.main, 0.25)})`,
          mask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
          maskComposite: "exclude",
          WebkitMaskComposite: "xor",
          pointerEvents: "none",
        },
      }}
    >
      <Box sx={{ flex: "none", ...(compact ? { height: COMPACT_COVER, [SHORT_SCREEN]: { display: "none" } } : { height: 140 }) }}>
        {notice.coverImage?.url ? (
          <Box component="img" src={notice.coverImage.url} alt="" sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        ) : (
          <NoticeCoverFallback />
        )}
      </Box>

      <Box sx={{ p: compact ? 1.5 : 2, flex: 1, display: "flex", flexDirection: "column" }}>
        <Typography sx={{ fontSize: compact ? 15 : 16, fontWeight: 500, mb: compact ? 0.5 : 0.75 }}>{notice.title}</Typography>

        {/* Capped and faded rather than clamped — a notice's markdown can
            contain headings and lists, which line-clamp does not handle
            cleanly across nested block elements the way it does a single
            paragraph. A longer notice gets Read more. */}
        <Box ref={bodyRef} sx={{ position: "relative", maxHeight: compact ? 44 : 88, overflow: "hidden" }}>
          <SafeMarkdown>{notice.bodyMarkdown}</SafeMarkdown>
          {overflows && (
            <Box sx={{
              position: "absolute", left: 0, right: 0, bottom: 0, height: 28,
              background: `linear-gradient(to bottom, transparent, ${theme.palette.background.paper})`,
            }} />
          )}
        </Box>
        {overflows && (
          <Button size="small" onClick={() => (onReadMore ? onReadMore(notice) : setOpen(true))} sx={{ mt: 0.5, px: 0, minWidth: 0, textTransform: "none", alignSelf: "flex-start" }}>
            Read more
          </Button>
        )}
        <Box sx={{ flex: 1 }} />

        {notice.link && notice.linkLabel && (
          <Button
            variant="contained"
            fullWidth
            onClick={openLink}
            startIcon={notice.icon?.value ? <ButtonIcon icon={notice.icon} /> : undefined}
            sx={{ mt: compact ? 1 : 1.5, textTransform: "none" }}
          >
            {notice.linkLabel}
          </Button>
        )}

        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mt: compact ? 1 : 1.5, pt: compact ? 1 : 1.5, borderTop: 1, borderColor: "divider" }}>
          <Clock size={13} style={{ opacity: 0.5 }} />
          <Typography variant="caption" color="text.secondary">
            {new Date(notice.publishFrom || notice.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}
          </Typography>
        </Box>
      </Box>
      {!onReadMore && <NoticeDialog notice={notice} open={open} onClose={() => setOpen(false)} />}
    </Box>
  );
}
