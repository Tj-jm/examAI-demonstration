import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Button, Dialog, IconButton, Tooltip, Typography, ToggleButton, ToggleButtonGroup, CircularProgress } from "@mui/material";
import { X, Pen, Highlighter, Eraser, Undo2, Redo2, Trash2, Plus, Check, Square, Rows3, Grid3x3, Minus, MoveUpRight, RectangleHorizontal, Circle, Ruler, RotateCw, FileQuestion, ChevronUp } from "lucide-react";
import Latex from "./Latex";
import useNoTouchSelect, { NO_TOUCH_SELECT } from "./useNoTouchSelect";

// A full-screen drawing pad for a written answer: pages of paper (blank,
// lined or grid) a student writes on with a finger, mouse or stylus. Each
// page is attached as one image, through the same upload the "Attach an
// image" button uses, so grading, AI grading and the teacher's annotator
// see it like any photographed page.
//
// While open, pages are kept on this device (IndexedDB, under draftKey), so
// a refresh or a crash mid-exam doesn't lose them; attaching clears them.
// An attached page reopens fully editable on the device that drew it (its
// layers are kept under the image's url). Anywhere else, or for a photo,
// the image comes back as the page's background: new strokes go on top,
// the old ones can't be erased.

export const PAGE_W = 1240;
export const PAGE_H = 1754; // A4 at 150 dpi
const COLORS = ["#111111", "#1e4fd8", "#d32f2f", "#2e7d32", "#7b1fa2", "#ef6c00"];
const WIDTHS = [4, 8, 16];
const HISTORY = 30;
const SHAPES = ["line", "arrow", "rect", "circle"];
// The ruler, in page units: its top edge is the straight edge.
const RULER_L = 1000;
const RULER_H = 96;
const MM = PAGE_W / 210; // page units per millimetre (A4 is 210 mm wide)
const SNAP = 36; // how close to the edge a stroke starts to follow it

// ---- device draft store (IndexedDB, falls back to nothing) ----
const DB = "examai-doodles";
const openDb = () => new Promise((resolve, reject) => {
  const req = indexedDB.open(DB, 1);
  req.onupgradeneeded = () => req.result.createObjectStore("pages");
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
const store = async (mode, fn) => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("pages", mode);
    const req = fn(tx.objectStore("pages"));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
};
const draftGet = (key) => (key ? store("readonly", (s) => s.get(key)).catch(() => null) : Promise.resolve(null));
const draftSet = (key, value) => (key ? store("readwrite", (s) => s.put(value, key)).catch(() => {}) : Promise.resolve());
export const clearDoodleDraft = (key) => (key ? store("readwrite", (s) => s.delete(key)).catch(() => {}) : Promise.resolve());

const loadImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => resolve(img);
  img.onerror = reject;
  img.src = src;
});

// The paper itself, drawn under the ink.
const drawPaper = (ctx, paper) => {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  if (paper === "blank") return;
  ctx.strokeStyle = paper === "grid" ? "#dfe5ee" : "#cfd8e6";
  ctx.lineWidth = 2;
  const step = paper === "grid" ? 50 : 62;
  for (let y = step * 2; y < PAGE_H; y += step) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(PAGE_W, y); ctx.stroke();
  }
  if (paper === "grid") {
    for (let x = step; x < PAGE_W; x += step) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, PAGE_H); ctx.stroke();
    }
  } else {
    ctx.strokeStyle = "#f2b8b8";
    ctx.beginPath(); ctx.moveTo(120, 0); ctx.lineTo(120, PAGE_H); ctx.stroke();
  }
};

const blankPage = (paper = "lined") => ({ id: `${Date.now()}-${Math.random()}`, paper, background: null, ink: null });

// A page flattened to one JPEG: paper, background, ink.
const renderPage = async (page) => {
  const c = document.createElement("canvas");
  c.width = PAGE_W; c.height = PAGE_H;
  const ctx = c.getContext("2d");
  drawPaper(ctx, page.background ? "blank" : page.paper);
  if (page.background) {
    const img = await loadImage(page.background);
    const s = Math.min(PAGE_W / img.width, PAGE_H / img.height);
    ctx.drawImage(img, (PAGE_W - img.width * s) / 2, 0, img.width * s, img.height * s);
  }
  if (page.ink) ctx.drawImage(await loadImage(page.ink), 0, 0);
  return new Promise((resolve) => c.toBlob(resolve, "image/jpeg", 0.85));
};

// Reads an attached image back as a page's background, as a data URL so it
// survives the draft store and draws onto a canvas without CORS trouble.
const imageAsDataUrl = async (url) => {
  const blob = await (await fetch(url, { credentials: "include" })).blob();
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsDataURL(blob);
  });
};

function Thumb({ page, active, index, onClick }) {
  return (
    <Box
      onClick={onClick}
      sx={{
        width: 52, height: 74, flexShrink: 0, borderRadius: 1, cursor: "pointer", position: "relative", overflow: "hidden",
        border: "2px solid", borderColor: active ? "primary.main" : "divider", bgcolor: "#fff",
      }}
    >
      {/* Not touch targets: a long press on a thumbnail must not open the
          browser's image menu (Share / Copy image). The tile takes the tap. */}
      {page.background && <Box component="img" src={page.background} alt="" draggable={false} sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none" }} />}
      {page.ink && <Box component="img" src={page.ink} alt="" draggable={false} sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} />}
      <Typography sx={{ position: "absolute", bottom: 1, right: 4, fontSize: 10, color: "#666" }}>{index + 1}</Typography>
    </Box>
  );
}

// open: show the pad. startFrom: an attached image url to draw on (one
// page), or null for fresh pages. maxPages: how many images the answer can
// still take. onAttach(files) uploads them and resolves once done; throw to
// keep the pad open; resolve with the new images' urls, in order, to keep
// the pages editable later. forceAttach: set true (time up) to attach and close.
// question: the question being answered ({ question, questionImage }),
// shown in a panel above the page so it can be read while writing.
export default function DoodlePad({ open, onClose, onAttach, draftKey, startFrom = null, maxPages = 10, forceAttach = false, question = null }) {
  const [pages, setPages] = useState([]);
  const [current, setCurrent] = useState(0);
  const [tool, setTool] = useState("pen");
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(WIDTHS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [showQuestion, setShowQuestion] = useState(true);
  // { x, y, angle }: the left end of the ruler's edge, in page units.
  const [ruler, setRuler] = useState(null);
  const rulerDrag = useRef(null);

  const paperRef = useRef(null);
  const inkRef = useRef(null);
  const liveRef = useRef(null); // the stroke being drawn, before it's committed
  const sheetRef = useRef(null);
  // The sheet only exists once the pad is open and its pages have loaded.
  useNoTouchSelect(sheetRef, open && loaded);
  // The rest of the pad (question, toolbar, page strip): no long-press
  // menu or text selection either, but its buttons still work.
  const padRef = useRef(null);
  useNoTouchSelect(padRef, open && loaded, { menusOnly: true });
  const stroke = useRef(null);
  const penSeen = useRef(false);
  // The sheet cancels the browser's own touch scrolling, so on a phone,
  // where the page fills the screen, scrolling is done here: two fingers
  // move the page (one finger once a stylus is in use).
  const scrollRef = useRef(null);
  const touches = useRef(new Map()); // pointerId -> { x, y }
  const pan = useRef(null); // the fingers' last midpoint while scrolling
  const undo = useRef([]);
  const redo = useRef([]);
  const [, bump] = useState(0);
  const key = draftKey && (startFrom ? `${draftKey}:edit:${startFrom}` : draftKey);

  // Load the draft (or start fresh) each time the pad opens.
  useEffect(() => {
    if (!open) return undefined;
    let gone = false;
    setLoaded(false);
    setError(null);
    (async () => {
      const saved = await draftGet(key);
      let next = saved?.pages?.length ? saved.pages : null;
      if (!next && startFrom) {
        const drawn = await draftGet(`url:${startFrom}`);
        if (drawn) next = [drawn];
      }
      if (!next && startFrom) {
        try {
          next = [{ ...blankPage("blank"), background: await imageAsDataUrl(startFrom) }];
        } catch {
          next = [blankPage("blank")];
          setError("Couldn't load that image to draw on.");
        }
      }
      if (gone) return;
      setPages(next || [blankPage()]);
      setCurrent(0);
      undo.current = []; redo.current = [];
      setLoaded(true);
    })();
    return () => { gone = true; };
  }, [open, key, startFrom]);

  const page = pages[current];

  // Paint the current page's paper and ink onto the canvases.
  useEffect(() => {
    if (!open || !loaded || !page) return;
    const paper = paperRef.current?.getContext("2d");
    const ink = inkRef.current?.getContext("2d");
    if (!paper || !ink) return;
    drawPaper(paper, page.background ? "blank" : page.paper);
    let gone = false;
    if (page.background) {
      loadImage(page.background).then((img) => {
        if (gone) return;
        const s = Math.min(PAGE_W / img.width, PAGE_H / img.height);
        paper.drawImage(img, (PAGE_W - img.width * s) / 2, 0, img.width * s, img.height * s);
      }).catch(() => {});
    }
    ink.clearRect(0, 0, PAGE_W, PAGE_H);
    if (page.ink) loadImage(page.ink).then((img) => { if (!gone) ink.drawImage(img, 0, 0); }).catch(() => {});
    return () => { gone = true; };
    // Only when the page itself changes, not on every ink save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loaded, current, page?.id, page?.paper, page?.background]);

  // Keep the draft on the device as the student works.
  const persist = useCallback((next) => { draftSet(key, { pages: next, at: Date.now() }); }, [key]);

  const saveInk = useCallback(() => {
    const data = inkRef.current.toDataURL("image/png");
    setPages((prev) => {
      const next = prev.map((p, i) => (i === current ? { ...p, ink: data } : p));
      persist(next);
      return next;
    });
  }, [current, persist]);

  const snapshot = () => {
    const ctx = inkRef.current.getContext("2d");
    undo.current.push(ctx.getImageData(0, 0, PAGE_W, PAGE_H));
    if (undo.current.length > HISTORY) undo.current.shift();
    redo.current = [];
    bump((n) => n + 1);
  };

  const point = (e) => {
    const r = inkRef.current.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * PAGE_W, y: ((e.clientY - r.top) / r.height) * PAGE_H, p: e.pressure || 0.5 };
  };

  // The stroke so far, smoothed through the midpoints between samples.
  const tracePath = (ctx, pts) => {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    if (pts.length === 1) ctx.lineTo(pts[0].x + 0.1, pts[0].y);
    for (let i = 1; i < pts.length - 1; i += 1) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const my = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    if (pts.length > 1) ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  };

  const styleFor = (ctx, pen) => {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = color;
    const w = tool === "highlighter" ? width * 4 : tool === "eraser" ? width * 5 : width;
    // A stylus's pressure thickens or thins the line a little.
    ctx.lineWidth = pen && tool === "pen" ? w * (0.6 + stroke.current.pressure * 0.8) : w;
  };

  // Where a point lands on the ruler's edge, or null when it isn't near it.
  const onEdge = (pt) => {
    if (!ruler) return null;
    const dx = Math.cos(ruler.angle), dy = Math.sin(ruler.angle);
    const rx = pt.x - ruler.x, ry = pt.y - ruler.y;
    const along = rx * dx + ry * dy;
    const across = -rx * dy + ry * dx; // positive is the ruler's body
    if (along < -SNAP || along > RULER_L + SNAP || across > SNAP || across < -SNAP) return null;
    return { x: ruler.x + along * dx, y: ruler.y + along * dy, along };
  };

  const drawShape = (ctx, a, b) => {
    ctx.beginPath();
    if (tool === "line" || tool === "arrow") {
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      if (tool === "arrow") {
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        const head = 18 + width * 2.5;
        for (const side of [-1, 1]) {
          ctx.moveTo(b.x, b.y);
          ctx.lineTo(b.x - head * Math.cos(angle + side * 0.45), b.y - head * Math.sin(angle + side * 0.45));
        }
      }
    } else if (tool === "rect") {
      ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    } else if (tool === "circle") {
      ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2 || 0.5, Math.abs(b.y - a.y) / 2 || 0.5, 0, 0, Math.PI * 2);
    }
    ctx.stroke();
  };

  const midpoint = () => {
    const pts = [...touches.current.values()];
    return { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length };
  };

  // A stroke begun by the first of two fingers is taken back.
  const dropStroke = () => {
    if (!stroke.current) return;
    stroke.current = null;
    liveRef.current.getContext("2d").clearRect(0, 0, PAGE_W, PAGE_H);
    const before = undo.current.pop();
    if (before) inkRef.current.getContext("2d").putImageData(before, 0, 0);
    bump((n) => n + 1);
  };

  const down = (e) => {
    // Never let the browser act on a touch here (iPad selection menus),
    // including a palm that is ignored below.
    e.preventDefault();
    if (e.pointerType === "pen") penSeen.current = true;
    if (e.pointerType === "touch") {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      // Once a stylus is in use a finger (or resting palm) only scrolls.
      if (touches.current.size > 1 || penSeen.current) {
        e.currentTarget.setPointerCapture(e.pointerId);
        dropStroke();
        pan.current = midpoint();
        return;
      }
    }
    if (e.button > 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    snapshot();
    const pt = point(e);
    // A pen or highlighter stroke started on the ruler's edge runs along it.
    const edge = (tool === "pen" || tool === "highlighter") && onEdge(pt);
    stroke.current = { id: e.pointerId, pts: [pt], pen: e.pointerType === "pen", pressure: pt.p, edge: edge || null };
    move(e);
  };

  const move = (e) => {
    if (e.pointerType === "touch" && touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pan.current) {
        const next = midpoint();
        scrollRef.current?.scrollBy(pan.current.x - next.x, pan.current.y - next.y);
        pan.current = next;
        return;
      }
    }
    const s = stroke.current;
    if (!s || s.id !== e.pointerId) return;
    const events = e.nativeEvent.getCoalescedEvents?.() || [e.nativeEvent];
    for (const ev of events) {
      const pt = point(ev);
      const last = s.pts[s.pts.length - 1];
      if (s.pts.length > 1 && Math.hypot(pt.x - last.x, pt.y - last.y) < 1.5) continue;
      s.pts.push(pt);
    }
    s.pressure = s.pts[s.pts.length - 1].p;
    const live = liveRef.current.getContext("2d");
    if (SHAPES.includes(tool) || s.edge) {
      // Shapes and ruler lines are redrawn whole from the first point.
      const last = s.pts[s.pts.length - 1];
      const end = s.edge ? (onEdge(last) || s.edge) : last;
      live.clearRect(0, 0, PAGE_W, PAGE_H);
      styleFor(live, false);
      if (s.edge) {
        live.beginPath(); live.moveTo(s.edge.x, s.edge.y); live.lineTo(end.x, end.y); live.stroke();
      } else {
        drawShape(live, s.pts[0], end);
      }
      return;
    }
    if (tool === "eraser") {
      // Erases straight off the ink, leaving the paper.
      const ink = inkRef.current.getContext("2d");
      ink.save();
      ink.globalCompositeOperation = "destination-out";
      styleFor(ink, s.pen);
      tracePath(ink, s.pts.slice(-3));
      ink.stroke();
      ink.restore();
      return;
    }
    // Pen and highlighter draw the whole stroke on a live layer, so a
    // highlighter doesn't darken where it overlaps itself.
    live.clearRect(0, 0, PAGE_W, PAGE_H);
    styleFor(live, s.pen);
    tracePath(live, s.pts);
    live.stroke();
  };

  const up = (e) => {
    if (e.pointerType === "touch") {
      touches.current.delete(e.pointerId);
      if (pan.current) {
        // Scrolling lasts until every finger is up; never turns into a stroke.
        pan.current = touches.current.size ? midpoint() : null;
        return;
      }
    }
    const s = stroke.current;
    if (!s || s.id !== e.pointerId) return;
    stroke.current = null;
    if (tool !== "eraser") {
      const ink = inkRef.current.getContext("2d");
      ink.save();
      if (tool === "highlighter") ink.globalAlpha = 0.35;
      ink.drawImage(liveRef.current, 0, 0);
      ink.restore();
      liveRef.current.getContext("2d").clearRect(0, 0, PAGE_W, PAGE_H);
    }
    saveInk();
  };

  const stepHistory = (from, to) => {
    if (!from.current.length) return;
    const ctx = inkRef.current.getContext("2d");
    to.current.push(ctx.getImageData(0, 0, PAGE_W, PAGE_H));
    ctx.putImageData(from.current.pop(), 0, 0);
    bump((n) => n + 1);
    saveInk();
  };

  const clearPage = () => {
    snapshot();
    inkRef.current.getContext("2d").clearRect(0, 0, PAGE_W, PAGE_H);
    saveInk();
  };

  const goTo = (i) => {
    undo.current = []; redo.current = [];
    setCurrent(i);
  };

  const addPage = () => {
    if (pages.length >= maxPages) return;
    const next = [...pages, blankPage(page?.background ? "lined" : page?.paper)];
    setPages(next);
    persist(next);
    goTo(next.length - 1);
  };

  const removePage = () => {
    if (pages.length <= 1) { clearPage(); return; }
    const next = pages.filter((_, i) => i !== current);
    setPages(next);
    persist(next);
    goTo(Math.max(0, current - 1));
  };

  const setPaper = (paper) => {
    if (!paper || page.background) return;
    const next = pages.map((p, i) => (i === current ? { ...p, paper } : p));
    setPages(next);
    persist(next);
  };

  // Pages with nothing on them aren't attached.
  const attach = useCallback(async () => {
    if (busy) return;
    const used = pages.filter((p) => p.ink || p.background);
    if (!used.length) { onClose(); return; }
    setBusy(true);
    setError(null);
    try {
      const files = [];
      for (let i = 0; i < used.length; i += 1) {
        const blob = await renderPage(used[i]);
        files.push(new File([blob], `drawing-${i + 1}.jpg`, { type: "image/jpeg" }));
      }
      const urls = await onAttach(files);
      if (Array.isArray(urls)) await Promise.all(urls.map((u, i) => u && draftSet(`url:${u}`, used[i])));
      await clearDoodleDraft(key);
      onClose();
    } catch (err) {
      setError(err?.data?.message || err?.message || "Couldn't attach the pages. Try again.");
    } finally {
      setBusy(false);
    }
  }, [busy, pages, onAttach, onClose, key]);

  // Time up: what's drawn is attached rather than lost.
  const attachRef = useRef(attach);
  attachRef.current = attach;
  useEffect(() => {
    if (open && forceAttach && loaded) attachRef.current();
  }, [open, forceAttach, loaded]);

  // Moving the ruler (drag its body) and turning it (drag the round handle,
  // about its left end; it settles on whole 15° steps when close).
  const rulerDown = (e, mode) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    rulerDrag.current = { id: e.pointerId, mode, start: point(e), from: ruler };
  };
  const rulerMove = (e) => {
    const d = rulerDrag.current;
    if (!d || d.id !== e.pointerId) return;
    const pt = point(e);
    if (d.mode === "move") {
      setRuler({ ...d.from, x: d.from.x + pt.x - d.start.x, y: d.from.y + pt.y - d.start.y });
    } else {
      let angle = Math.atan2(pt.y - d.from.y, pt.x - d.from.x);
      const step = Math.PI / 12;
      if (Math.abs(angle - Math.round(angle / step) * step) < 0.03) angle = Math.round(angle / step) * step;
      setRuler({ ...d.from, angle });
    }
  };
  const rulerUp = (e) => { if (rulerDrag.current?.id === e.pointerId) rulerDrag.current = null; };
  const toggleRuler = () => setRuler((r) => (r ? null : { x: (PAGE_W - RULER_L) / 2, y: PAGE_H * 0.3, angle: 0 }));
  const degrees = ruler ? Math.round((((ruler.angle * 180) / Math.PI) % 360 + 360) % 360) : 0;

  const usedCount = pages.filter((p) => p.ink || p.background).length;
  const tools = [
    ["pen", "Pen", Pen], ["highlighter", "Highlighter", Highlighter], ["eraser", "Eraser", Eraser],
    ["line", "Straight line", Minus], ["arrow", "Arrow", MoveUpRight], ["rect", "Rectangle", RectangleHorizontal], ["circle", "Circle", Circle],
  ];

  return (
    <Dialog fullScreen open={open} onClose={busy ? undefined : onClose} PaperProps={{ ref: padRef, sx: { bgcolor: "#e9ecf1", ...NO_TOUCH_SELECT } }}>
      {/* Toolbar */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 1, bgcolor: "background.paper", borderBottom: "1px solid", borderColor: "divider", flexWrap: "wrap" }}>
        <IconButton size="small" onClick={onClose} disabled={busy} aria-label="Close"><X size={18} /></IconButton>
        <ToggleButtonGroup size="small" exclusive value={tool} onChange={(_, v) => v && setTool(v)}>
          {tools.map(([v, label, Icon]) => (
            <ToggleButton key={v} value={v} aria-label={label}><Tooltip title={label}><Icon size={16} /></Tooltip></ToggleButton>
          ))}
        </ToggleButtonGroup>
        <Box sx={{ display: "flex", gap: 0.5 }}>
          {COLORS.map((c) => (
            <Box
              key={c}
              onClick={() => { setColor(c); if (tool === "eraser") setTool("pen"); }}
              sx={{ width: 22, height: 22, borderRadius: "50%", bgcolor: c, cursor: "pointer", border: "2px solid", borderColor: color === c ? "primary.main" : "transparent", boxShadow: color === c ? "0 0 0 2px #fff inset" : "none" }}
            />
          ))}
        </Box>
        <ToggleButtonGroup size="small" exclusive value={width} onChange={(_, v) => v && setWidth(v)}>
          {WIDTHS.map((w) => (
            <ToggleButton key={w} value={w} aria-label={`Width ${w}`}>
              <Box sx={{ width: 14, height: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Box sx={{ width: Math.min(14, w + 2), height: Math.min(14, w + 2), borderRadius: "50%", bgcolor: "text.primary" }} />
              </Box>
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <Tooltip title={ruler ? "Put the ruler away" : "Ruler"}>
          <ToggleButton size="small" value="ruler" selected={Boolean(ruler)} onChange={toggleRuler} aria-label="Ruler"><Ruler size={16} /></ToggleButton>
        </Tooltip>
        {question && (
          <Tooltip title={showQuestion ? "Hide the question" : "Show the question"}>
            <ToggleButton size="small" value="question" selected={showQuestion} onChange={() => setShowQuestion((v) => !v)} aria-label="Question"><FileQuestion size={16} /></ToggleButton>
          </Tooltip>
        )}
        <IconButton size="small" onClick={() => stepHistory(undo, redo)} disabled={!undo.current.length} aria-label="Undo"><Undo2 size={17} /></IconButton>
        <IconButton size="small" onClick={() => stepHistory(redo, undo)} disabled={!redo.current.length} aria-label="Redo"><Redo2 size={17} /></IconButton>
        <Tooltip title="Clear this page"><IconButton size="small" onClick={clearPage} aria-label="Clear page"><Trash2 size={17} /></IconButton></Tooltip>
        {!page?.background && (
          <ToggleButtonGroup size="small" exclusive value={page?.paper || "lined"} onChange={(_, v) => setPaper(v)}>
            <ToggleButton value="blank" aria-label="Blank paper"><Tooltip title="Blank"><Square size={15} /></Tooltip></ToggleButton>
            <ToggleButton value="lined" aria-label="Lined paper"><Tooltip title="Lined"><Rows3 size={15} /></Tooltip></ToggleButton>
            <ToggleButton value="grid" aria-label="Grid paper"><Tooltip title="Grid"><Grid3x3 size={15} /></Tooltip></ToggleButton>
          </ToggleButtonGroup>
        )}
        <Box sx={{ flex: 1 }} />
        <Button variant="contained" size="small" onClick={attach} disabled={busy || !loaded} startIcon={busy ? <CircularProgress size={14} color="inherit" /> : <Check size={15} />}>
          {busy ? "Attaching…" : usedCount ? `Attach ${usedCount} page${usedCount === 1 ? "" : "s"}` : "Done"}
        </Button>
      </Box>
      {error && <Typography color="error" variant="body2" sx={{ px: 2, py: 0.5, bgcolor: "background.paper" }}>{error}</Typography>}

      {/* The question, to read while writing. Scrolls on its own. */}
      {question && showQuestion && (
        <Box sx={{ position: "relative", px: 2, py: 1.25, bgcolor: "background.paper", borderBottom: "1px solid", borderColor: "divider", maxHeight: "28vh", overflow: "auto" }}>
          <IconButton size="small" onClick={() => setShowQuestion(false)} aria-label="Hide the question" sx={{ position: "absolute", top: 4, right: 4 }}><ChevronUp size={16} /></IconButton>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>Question</Typography>
          <Box sx={{ pr: 4, fontSize: 15 }}><Latex as="div">{question.question || ""}</Latex></Box>
          {question.questionImage?.url && (
            <Box component="img" src={question.questionImage.url} alt="" sx={{ display: "block", maxWidth: "100%", maxHeight: 200, mt: 1, borderRadius: 1 }} />
          )}
          {/* A written question under a passage: that question, below the passage. */}
          {question.part && (
            <Box sx={{ mt: 1.5, pt: 1, borderTop: 1, borderColor: "divider", fontSize: 15, display: "flex", gap: 1 }}>
              <Box component="span" sx={{ fontWeight: 600, flexShrink: 0 }}>({question.part.label})</Box>
              <Box sx={{ flex: 1 }}>
                <Latex as="div">{question.part.question || ""}</Latex>
                {question.part.questionImage?.url && (
                  <Box component="img" src={question.part.questionImage.url} alt="" sx={{ display: "block", maxWidth: "100%", maxHeight: 200, mt: 1, borderRadius: 1 }} />
                )}
              </Box>
            </Box>
          )}
        </Box>
      )}

      {/* Page */}
      <Box ref={scrollRef} sx={{ flex: 1, overflow: "auto", p: { xs: 1, sm: 2 }, display: "flex", justifyContent: "center", alignItems: "flex-start" }}>
        {loaded ? (
          <Box ref={sheetRef} sx={{ position: "relative", width: "100%", maxWidth: 820, aspectRatio: `${PAGE_W} / ${PAGE_H}`, boxShadow: 3, bgcolor: "#fff", touchAction: "none", ...NO_TOUCH_SELECT }}>
            {[paperRef, inkRef, liveRef].map((ref, i) => (
              <canvas
                key={i}
                ref={ref}
                width={PAGE_W}
                height={PAGE_H}
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: i === 2 ? "auto" : "none", touchAction: "none", cursor: tool === "eraser" ? "cell" : "crosshair" }}
                {...(i === 2 ? { onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerCancel: up } : {})}
              />
            ))}
            {ruler && (
              <Box
                onPointerDown={(e) => rulerDown(e, "move")}
                onPointerMove={rulerMove}
                onPointerUp={rulerUp}
                onPointerCancel={rulerUp}
                sx={{
                  position: "absolute",
                  left: `${(ruler.x / PAGE_W) * 100}%`,
                  top: `${(ruler.y / PAGE_H) * 100}%`,
                  width: `${(RULER_L / PAGE_W) * 100}%`,
                  height: `${(RULER_H / PAGE_H) * 100}%`,
                  transform: `rotate(${ruler.angle}rad)`,
                  transformOrigin: "0 0",
                  touchAction: "none",
                  cursor: "move",
                  bgcolor: "rgba(255, 236, 160, 0.72)",
                  border: "1px solid rgba(120, 100, 20, 0.55)",
                  borderRadius: "2px",
                  boxShadow: 2,
                  // Millimetre and centimetre marks along the edge.
                  backgroundImage: "linear-gradient(90deg, rgba(60,50,10,.8) 1px, transparent 1px), linear-gradient(90deg, rgba(60,50,10,.6) 1px, transparent 1px)",
                  backgroundSize: `${((10 * MM) / RULER_L) * 100}% 38%, ${(MM / RULER_L) * 100}% 18%`,
                  backgroundRepeat: "repeat-x",
                  backgroundPosition: "0 0, 0 0",
                }}
              >
                <Typography sx={{ position: "absolute", left: 8, bottom: 2, fontSize: 11, color: "rgba(60,50,10,.85)", userSelect: "none", pointerEvents: "none" }}>
                  {degrees}°
                </Typography>
                <Box
                  onPointerDown={(e) => rulerDown(e, "turn")}
                  aria-label="Turn the ruler"
                  sx={{ position: "absolute", right: -14, top: "50%", mt: "-14px", width: 28, height: 28, borderRadius: "50%", bgcolor: "#fff", border: "1px solid rgba(120,100,20,.6)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "grab", touchAction: "none", boxShadow: 1 }}
                >
                  <RotateCw size={14} />
                </Box>
              </Box>
            )}
          </Box>
        ) : (
          <CircularProgress sx={{ mt: 8 }} />
        )}
      </Box>

      {/* Pages */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 1, bgcolor: "background.paper", borderTop: "1px solid", borderColor: "divider", overflowX: "auto" }}>
        {pages.map((p, i) => <Thumb key={p.id} page={p} index={i} active={i === current} onClick={() => goTo(i)} />)}
        {!startFrom && (
          <Tooltip title={pages.length >= maxPages ? `Up to ${maxPages} pages` : "Add a page"}>
            <span>
              <IconButton onClick={addPage} disabled={pages.length >= maxPages} sx={{ border: "1px dashed", borderColor: "divider", borderRadius: 1, width: 52, height: 74 }} aria-label="Add page"><Plus size={18} /></IconButton>
            </span>
          </Tooltip>
        )}
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>Page {current + 1} of {pages.length}</Typography>
        <Tooltip title={pages.length > 1 ? "Delete this page" : "Clear this page"}>
          <IconButton size="small" onClick={removePage} aria-label="Delete page"><Trash2 size={16} /></IconButton>
        </Tooltip>
      </Box>
    </Dialog>
  );
}
