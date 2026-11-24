import { useEffect, useRef, useState } from "react";
import { Box, IconButton, Typography, Drawer, useMediaQuery } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { ChevronLeft, ChevronRight, Megaphone, X } from "lucide-react";
import { useGetGeneralNoticesQuery } from "../api/contentApi";
import NoticeCard, { NoticeDialog, COMPACT_COVER, SHORT_SCREEN } from "./NoticeCard";
import { useLayoutMode } from "../layout/Shell";
import { useBranding } from "../BrandingContext";
import { NoticeBanner, NoticeSpotlight } from "./NoticeStyles";

const AUTO_ADVANCE_MS = 6000;

// No carousel library in this app anywhere else, so this is hand-rolled
// rather than adding one for a single homepage widget: one card visible at
// a time (three side by side in the web layout on a wide screen, moving one
// card per step), auto-advancing, with dots and arrows for manual control. It does
// not support drag-to-swipe — tapping a dot or an arrow is the manual path
// on touch devices, which costs nothing extra to build and is no harder to
// use than a swipe gesture would have been.
//
// Renders nothing at all when there are no live general notices — this
// sits above four different dashboard layouts (see Dashboard.jsx) and none
// of them should show an empty banner just because nobody has posted
// anything.
export default function GeneralNoticeCarousel() {
  const { data, isLoading } = useGetGeneralNoticesQuery();
  const { noticeStrip, noticeStyle, compactMobile, compactShort } = useBranding();
  const phone = useMediaQuery("(max-width:599px)");
  const short = useMediaQuery("(max-height:820px)");
  const wide = useMediaQuery("(min-width:900px)");
  const notices = data?.notices || [];
  if (isLoading || notices.length === 0) return null;
  // Settings → Student app → Notice style. Banner everywhere;
  // Spotlight on wide screens only (else Cards). Rail is placed by the
  // home page itself (Dashboard.jsx), and is Cards anywhere else.
  const compact = phone ? compactMobile : short && compactShort;
  if (noticeStyle === "banner") return <NoticeBanner notices={notices} phone={phone} compact={compact} />;
  if (noticeStyle === "spotlight" && wide) return <NoticeSpotlight notices={notices} />;
  // Settings → Student app → Notice strip on phones: featured notices stay
  // full cards, the rest fold into one slim line.
  if (phone && noticeStrip) {
    const featured = notices.filter((n) => n.featured);
    const rest = notices.filter((n) => !n.featured);
    return (
      <>
        {featured.length > 0 && <NoticeCards notices={featured} />}
        {rest.length > 0 && <NoticeStrip notices={rest} />}
      </>
    );
  }
  return <NoticeCards notices={notices} />;
}

function NoticeCards({ notices }) {
  // The notice open in Read more: the carousel holds still meanwhile.
  const [reading, setReading] = useState(null);
  const [index, setIndex] = useState(0);
  const wide = useMediaQuery("(min-width:760px)");
  const perView = useLayoutMode() === "web" && wide ? Math.min(3, notices.length) : 1;
  const { compactMobile, compactShort } = useBranding();
  // A phone, or a short wider screen such as a laptop's; each has its own switch.
  const phone = useMediaQuery("(max-width:599px)");
  const short = useMediaQuery("(max-height:820px)");
  const compact = phone ? compactMobile : short && compactShort;
  // Arrows sit on the cover's middle; with the cover hidden on a short
  // screen, beside the title.
  const arrowTop = compact ? { top: `calc(${COMPACT_COVER} / 2)`, [SHORT_SCREEN]: { top: 22 } } : { top: "56px" };
  // Only cycles when there are more notices than fit at once.
  const steps = notices.length > perView ? notices.length : 1;

  // Auto-advance pauses itself rather than being torn down whenever notices
  // changes identity between refetches — keying the effect on notices.length
  // (which only changes when the actual set of live notices changes, not on
  // every background refetch returning the same array in a new reference)
  // is what stops the timer silently resetting every few seconds.
  useEffect(() => {
    if (steps <= 1 || reading) return;
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % steps);
    }, AUTO_ADVANCE_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps, reading]);

  // The active index has to be clamped independently of the timer effect —
  // if the set shrinks (a notice expires between refetches) while sitting on
  // its last card, the stale index would point past the new end of the array.
  useEffect(() => {
    if (index >= steps) setIndex(0);
  }, [steps, index]);

  const go = (delta) => setIndex((i) => (i + delta + steps) % steps);
  const shown = Array.from({ length: perView }, (_, k) => notices[(index + k) % notices.length]);

  return (
    <Box sx={{ mb: compact ? 2 : 3, maxWidth: perView > 1 ? "none" : 420 }}>
      <Box sx={{ position: "relative" }}>
        <Box sx={{ display: "grid", gridTemplateColumns: `repeat(${perView}, minmax(0, 1fr))`, gap: 2, alignItems: "stretch" }}>
          {shown.map((n) => <NoticeCard key={n._id} notice={n} compact={compact} onReadMore={setReading} />)}
        </Box>
        <NoticeDialog notice={reading} open={Boolean(reading)} onClose={() => setReading(null)} />

        {steps > 1 && (
          <>
            <IconButton
              size="small"
              onClick={() => go(-1)}
              aria-label="Previous notice"
              sx={{
                position: "absolute", ...arrowTop, left: { xs: 4, sm: -18 }, transform: "translateY(-50%)",
                bgcolor: "background.paper", boxShadow: 1,
                "&:hover": { bgcolor: "background.paper" },
              }}
            >
              <ChevronLeft size={16} />
            </IconButton>
            <IconButton
              size="small"
              onClick={() => go(1)}
              aria-label="Next notice"
              sx={{
                position: "absolute", ...arrowTop, right: { xs: 4, sm: -18 }, transform: "translateY(-50%)",
                bgcolor: "background.paper", boxShadow: 1,
                "&:hover": { bgcolor: "background.paper" },
              }}
            >
              <ChevronRight size={16} />
            </IconButton>
          </>
        )}
      </Box>

      {steps > 1 && (
        <Box sx={{ display: "flex", justifyContent: "center", gap: 0.75, mt: compact ? 0.75 : 1.25 }}>
          {notices.map((n, i) => (
            <Box
              key={n._id}
              component="button"
              onClick={() => setIndex(i)}
              aria-label={`Go to notice ${i + 1}`}
              sx={{
                width: i === index ? 16 : 6, height: 6, borderRadius: 3,
                border: "none", cursor: "pointer", p: 0,
                bgcolor: i === index ? "primary.main" : "action.disabled",
                transition: "width 200ms ease",
              }}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}

const STRIP_ADVANCE_MS = 4500;
const SEEN_KEY = "examai.seenNotices";
const readSeen = () => {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "[]")); } catch { return new Set(); }
};

// One line on a phone: the title, a counter and a dot for a notice not yet
// opened. Rotates by itself, swipes left or right, and a tap opens the full
// notice in a bottom sheet.
function NoticeStrip({ notices }) {
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(null);
  const [seen, setSeen] = useState(readSeen);
  const touchX = useRef(null);
  // A swipe also ends in a click; this stops it opening the notice.
  const swiped = useRef(false);
  const count = notices.length;

  useEffect(() => {
    if (count <= 1 || open) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % count), STRIP_ADVANCE_MS);
    return () => clearInterval(timer);
  }, [count, open]);
  useEffect(() => {
    if (index >= count) setIndex(0);
  }, [count, index]);

  const notice = notices[index % count];
  const go = (delta) => setIndex((i) => (i + delta + count) % count);
  const show = (n) => {
    setOpen(n);
    const next = new Set(seen).add(n._id);
    setSeen(next);
    try { localStorage.setItem(SEEN_KEY, JSON.stringify([...next].slice(-100))); } catch { /* private mode */ }
  };

  return (
    <>
      <Box
        component="button"
        onClick={() => { if (swiped.current) { swiped.current = false; return; } show(notice); }}
        onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => {
          if (touchX.current === null) return;
          const dx = e.changedTouches[0].clientX - touchX.current;
          touchX.current = null;
          if (Math.abs(dx) > 40 && count > 1) { swiped.current = true; setTimeout(() => { swiped.current = false; }, 400); go(dx < 0 ? 1 : -1); }
        }}
        aria-label={`Notice: ${notice.title}`}
        sx={(theme) => ({
          width: "100%", mb: 2, px: 1.5, height: 48, border: 1, borderColor: alpha(theme.palette.primary.main, 0.3),
          borderRadius: 3, bgcolor: alpha(theme.palette.primary.main, 0.06), color: "text.primary",
          display: "flex", alignItems: "center", gap: 1.25, cursor: "pointer", font: "inherit", textAlign: "left",
        })}
      >
        <Box sx={{ position: "relative", display: "flex", color: "primary.main", flexShrink: 0 }}>
          <Megaphone size={18} />
          {!seen.has(notice._id) && (
            <Box sx={{ position: "absolute", top: -3, right: -4, width: 8, height: 8, borderRadius: "50%", bgcolor: "error.main", border: 2, borderColor: "background.paper" }} />
          )}
        </Box>
        <Typography key={notice._id} noWrap sx={{
          flex: 1, minWidth: 0, fontSize: 14, fontWeight: 500,
          animation: "noticeIn 300ms ease", "@keyframes noticeIn": { from: { opacity: 0, transform: "translateY(6px)" }, to: { opacity: 1, transform: "none" } },
        }}>
          {notice.title}
        </Typography>
        {count > 1 && (
          <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>{(index % count) + 1}/{count}</Typography>
        )}
        <ChevronRight size={16} style={{ flexShrink: 0, opacity: 0.6 }} />
      </Box>

      <Drawer
        anchor="bottom"
        open={Boolean(open)}
        onClose={() => setOpen(null)}
        PaperProps={{ sx: { borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: "85svh", p: 1.5, pb: "calc(12px + env(safe-area-inset-bottom))" } }}
      >
        <Box sx={{ display: "flex", justifyContent: "center", position: "relative", mb: 1 }}>
          <Box sx={{ width: 36, height: 4, borderRadius: 2, bgcolor: "action.disabled", mt: 0.5 }} />
          <IconButton size="small" onClick={() => setOpen(null)} aria-label="Close" sx={{ position: "absolute", right: 0, top: -4 }}>
            <X size={16} />
          </IconButton>
        </Box>
        {open && <NoticeCard notice={open} />}
      </Drawer>
    </>
  );
}
