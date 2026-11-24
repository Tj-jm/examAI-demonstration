import { useCallback, useEffect, useState } from "react";
import { Button, Paper } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { Clapperboard, MessagesSquare } from "lucide-react";

// Highlight a passage of a lecture's notes or description and a small menu
// offers "Ask this lecture" and "Short video", the way chat apps do. Each
// hands the passage to its own panel (DocChat, AskVideo), so the switches
// and daily limits are those panels': course chat and short AI videos.

const MAX_TEXT = 1000;

const squeeze = (text) => String(text || "").replace(/\s+/g, " ").trim();

// Shown over (or, on touch screens, under the phone's own menu) a selection
// made inside one of `containers`.
export function SelectionMenu({ containers, ask, video, onPick }) {
  const theme = useTheme();
  const [menu, setMenu] = useState(null); // { text, top, left }

  const read = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return setMenu(null);
    const range = sel.getRangeAt(0);
    const inside = containers.some((ref) => ref.current && ref.current.contains(range.commonAncestorContainer));
    const text = squeeze(sel.toString());
    if (!inside || text.length < 2) return setMenu(null);
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return setMenu(null);
    const touch = window.matchMedia?.("(pointer: coarse)").matches;
    const above = !touch && rect.top > 64;
    const half = 120;
    setMenu({
      text: text.slice(0, MAX_TEXT),
      top: above ? rect.top - 46 : Math.min(rect.bottom + (touch ? 36 : 8), window.innerHeight - 52),
      left: Math.min(Math.max(rect.left + rect.width / 2, half + 8), window.innerWidth - half - 8),
    });
  }, [containers]);

  useEffect(() => {
    let timer = null;
    const later = () => { clearTimeout(timer); timer = setTimeout(read, 200); };
    document.addEventListener("selectionchange", later);
    window.addEventListener("scroll", read, true);
    window.addEventListener("resize", read);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("selectionchange", later);
      window.removeEventListener("scroll", read, true);
      window.removeEventListener("resize", read);
    };
  }, [read]);

  if (!menu || (!ask && !video)) return null;
  const pick = (mode) => {
    onPick(mode, menu.text);
    window.getSelection()?.removeAllRanges();
    setMenu(null);
  };
  return (
    <Paper
      elevation={6}
      // Keeps the selection: a mousedown on the menu would otherwise clear it.
      onMouseDown={(e) => e.preventDefault()}
      sx={{
        position: "fixed", top: menu.top, left: menu.left, transform: "translateX(-50%)", zIndex: theme.zIndex.modal - 1,
        display: "flex", alignItems: "center", gap: 0.25, p: 0.5, borderRadius: 2,
      }}
    >
      {ask && (
        <Button size="small" startIcon={<MessagesSquare size={15} />} onClick={() => pick("ask")} sx={{ textTransform: "none", color: "ai.main", whiteSpace: "nowrap" }}>
          Ask this lecture
        </Button>
      )}
      {video && (
        <Button size="small" startIcon={<Clapperboard size={15} />} onClick={() => pick("video")} sx={{ textTransform: "none", color: "ai.main", whiteSpace: "nowrap" }}>
          Short video
        </Button>
      )}
    </Paper>
  );
}
