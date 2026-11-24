import { useEffect, useRef, useState } from "react";
import { Box, Typography, Button, ButtonBase, Paper, IconButton } from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { NoticeDialog } from "./NoticeCard";
import NoticeCoverFallback from "./NoticeCoverFallback";

// The home page's notice styles other than Cards (Settings → Student app →
// Notice style): Banner, Spotlight and Rail. Each opens a notice
// in the same pop-up as Cards' Read more.

// Notices a student has opened, kept on this device (shared with the
// Cards strip on phones).
export const SEEN_KEY = "examai.seenNotices";
export const readSeen = () => {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "[]")); } catch { return new Set(); }
};
const saveSeen = (set) => {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...set].slice(-100))); } catch { /* private mode */ }
};

// The first line of a notice's text, without markdown signs.
const firstLine = (md) => String(md || "").split("\n").map((l) => l.replace(/[*_#>`~[\]]|\(https?:[^)]*\)/g, "").trim()).find(Boolean) || "";
const dateOf = (n) => new Date(n.publishFrom || n.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" });
const isExternal = (url) => {
  try { return new URL(url, window.location.origin).origin !== window.location.origin; } catch { return false; }
};

function Thumb({ notice, size, radius = 1.5 }) {
  return (
    <Box sx={{ width: size, height: size, borderRadius: radius, overflow: "hidden", flex: "none" }}>
      {notice.coverImage?.url
        ? <Box component="img" src={notice.coverImage.url} alt="" sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        : <NoticeCoverFallback iconSize={Math.round(size * 0.45)} />}
    </Box>
  );
}

// Which notice is open, and which have been seen.
function useOpen() {
  const [open, setOpen] = useState(null);
  const [seen, setSeen] = useState(readSeen);
  const show = (n) => {
    setOpen(n);
    const next = new Set(seen).add(n._id);
    setSeen(next);
    saveSeen(next);
  };
  const dialog = <NoticeDialog notice={open} open={Boolean(open)} onClose={() => setOpen(null)} />;
  return { open, show, seen, dialog };
}

// The notice's own button: its link, or the pop-up when it has none.
function useAct(show) {
  const navigate = useNavigate();
  return (n) => {
    if (!n.link) return show(n);
    if (isExternal(n.link)) window.open(n.link, "_blank", "noopener,noreferrer");
    else navigate(n.link);
  };
}

// ---- Banner: one slim bar, turning to the next notice by itself ---------------
export function NoticeBanner({ notices, phone, compact }) {
  const { open, show, dialog } = useOpen();
  const act = useAct(show);
  const [index, setIndex] = useState(0);
  const count = notices.length;
  // Turns by itself; a swipe or a dot restarts the wait.
  useEffect(() => {
    if (count <= 1 || open) return undefined;
    const t = setInterval(() => setIndex((i) => (i + 1) % count), 6000);
    return () => clearInterval(t);
  }, [count, open, index]);
  // A swipe left or right turns it; the click that ends a swipe opens nothing.
  const touchX = useRef(null);
  const swiped = useRef(false);
  const onTouchStart = (e) => { touchX.current = e.touches[0].clientX; };
  const onTouchEnd = (e) => {
    if (touchX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    touchX.current = null;
    if (Math.abs(dx) > 40 && count > 1) {
      swiped.current = true;
      setTimeout(() => { swiped.current = false; }, 400);
      setIndex((i) => (i + (dx < 0 ? 1 : -1) + count) % count);
    }
  };
  const unlessSwiped = (fn) => () => { if (!swiped.current) fn(); };
  useEffect(() => { if (index >= count) setIndex(0); }, [count, index]);
  const n = notices[index % count];
  const small = phone && compact;
  const label = n.link && n.linkLabel ? (phone && n.linkLabel.length > 10 ? "Open" : n.linkLabel) : "Read";
  return (
    <Box sx={{ mb: small ? 2 : 3 }}>
      <Paper variant="outlined" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} sx={{ display: "flex", alignItems: "center", gap: small ? 1 : 1.5, p: small ? 1 : 1.25, pl: small ? 1.25 : 1.75, borderRadius: 3, touchAction: "pan-y" }}>
        <ButtonBase onClick={unlessSwiped(() => show(n))} sx={{ display: "flex", alignItems: "center", gap: small ? 1 : 1.5, flex: 1, minWidth: 0, textAlign: "left", borderRadius: 2 }}>
          <Thumb notice={n} size={small ? 32 : phone ? 38 : 44} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography noWrap sx={{ fontWeight: 600, fontSize: small ? 13.5 : 15 }}>{n.title}</Typography>
            <Typography noWrap variant="caption" color="text.secondary" component="div">
              {phone ? (count > 1 ? `${(index % count) + 1}/${count}` : dateOf(n)) : firstLine(n.bodyMarkdown) || dateOf(n)}
            </Typography>
          </Box>
        </ButtonBase>
        {!phone && count > 1 && (
          <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
            {notices.map((x, i) => (
              <Box key={x._id} component="button" aria-label={`Notice ${i + 1}`} onClick={() => setIndex(i)} sx={{ border: 0, p: 0, cursor: "pointer", height: 7, width: i === index % count ? 16 : 7, borderRadius: 4, bgcolor: i === index % count ? "primary.main" : "action.disabled", transition: "width 200ms ease" }} />
            ))}
          </Box>
        )}
        <Button size="small" variant="contained" disableElevation onClick={unlessSwiped(() => act(n))} sx={{ textTransform: "none", whiteSpace: "nowrap", flex: "none", px: small ? 1.25 : 2 }}>{label}</Button>
      </Paper>
      {dialog}
    </Box>
  );
}

// ---- Spotlight: one big notice, the next ones beside it (wide screens) --------
export function NoticeSpotlight({ notices }) {
  const { show, dialog } = useOpen();
  const act = useAct(show);
  const [all, setAll] = useState(false);
  const lead = notices.find((n) => n.featured) || notices[0];
  const rest = notices.filter((n) => n._id !== lead._id);
  const shown = all ? rest : rest.slice(0, 3);
  return (
    <Box sx={{ mb: 3, display: "grid", gridTemplateColumns: rest.length ? "minmax(0, 1.4fr) minmax(0, 1fr)" : "1fr", gap: 2, alignItems: "start" }}>
      <Paper variant="outlined" sx={{ display: "flex", borderRadius: 3, overflow: "hidden", minHeight: 200 }}>
        <Box sx={{ width: "38%", flex: "none" }}>
          {lead.coverImage?.url
            ? <Box component="img" src={lead.coverImage.url} alt="" sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            : <NoticeCoverFallback />}
        </Box>
        <Box sx={{ p: 2.25, flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          {lead.featured && <Typography variant="caption" sx={{ color: "primary.main", fontWeight: 700, letterSpacing: 1 }}>FEATURED</Typography>}
          <Typography sx={{ fontWeight: 700, fontSize: 20, lineHeight: 1.25, my: 0.5 }}>{lead.title}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{firstLine(lead.bodyMarkdown)}</Typography>
          <Box sx={{ flex: 1 }} />
          <Box sx={{ display: "flex", gap: 1, mt: 1.5, flexWrap: "wrap" }}>
            {lead.link && lead.linkLabel && <Button variant="contained" disableElevation onClick={() => act(lead)} sx={{ textTransform: "none" }}>{lead.linkLabel}</Button>}
            <Button onClick={() => show(lead)} sx={{ textTransform: "none" }}>Read more</Button>
          </Box>
        </Box>
      </Paper>
      {rest.length > 0 && (
        <Paper variant="outlined" sx={{ borderRadius: 3, px: 1.5, py: 0.5, maxHeight: all ? 420 : "none", overflowY: all ? "auto" : "visible" }}>
          {shown.map((n, i) => (
            <ButtonBase key={n._id} onClick={() => show(n)} sx={{ display: "flex", width: "100%", gap: 1.25, alignItems: "center", py: 1.1, textAlign: "left", borderTop: i ? 1 : 0, borderColor: "divider" }}>
              <Thumb notice={n} size={36} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography noWrap sx={{ fontWeight: 600, fontSize: 14 }}>{n.title}</Typography>
                <Typography variant="caption" color="text.secondary">{dateOf(n)}</Typography>
              </Box>
              <ChevronRight size={16} style={{ opacity: 0.5, flex: "none" }} />
            </ButtonBase>
          ))}
          {rest.length > 3 && (
            <Button size="small" onClick={() => setAll(!all)} sx={{ textTransform: "none", px: 0, my: 0.5 }}>{all ? "Show fewer" : `All notices (${notices.length})`}</Button>
          )}
        </Paper>
      )}
      {dialog}
    </Box>
  );
}

// ---- Rail: a column of notices beside the batches (wide screens) --------------
export function NoticeRail({ notices }) {
  const { show, dialog } = useOpen();
  const [all, setAll] = useState(false);
  const shown = all ? notices : notices.slice(0, 5);
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, letterSpacing: 1 }}>NOTICES</Typography>
      {shown.map((n, i) => (
        <Paper key={n._id} variant="outlined" sx={{ borderRadius: 3, overflow: "hidden" }}>
          <ButtonBase onClick={() => show(n)} sx={{ display: "block", width: "100%", textAlign: "left" }}>
            {i === 0 && (
              <Box sx={{ height: 90 }}>
                {n.coverImage?.url
                  ? <Box component="img" src={n.coverImage.url} alt="" sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  : <NoticeCoverFallback />}
              </Box>
            )}
            <Box sx={{ p: 1.25 }}>
              <Typography sx={{ fontWeight: 600, fontSize: 14, lineHeight: 1.3, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{n.title}</Typography>
              <Typography variant="caption" color="text.secondary" noWrap component="div">{i === 0 ? firstLine(n.bodyMarkdown) || dateOf(n) : dateOf(n)}</Typography>
            </Box>
          </ButtonBase>
        </Paper>
      ))}
      {notices.length > 5 && (
        <Button size="small" onClick={() => setAll(!all)} sx={{ textTransform: "none", alignSelf: "flex-start", px: 0 }}>{all ? "Show fewer" : `All notices (${notices.length})`}</Button>
      )}
      {dialog}
    </Box>
  );
}
