// Draws a social media poster on a canvas (admin Posters page). Text is
// drawn here, not by an image model, so names and numbers are exact.
// A style is { layout, look, font } (posterStyles.js): the layout places
// the parts, the look (or the palette and font pair) colours and draws
// them.
import { posterTheme, loadPosterFonts, drawTag, tagBox, drawButton, buttonBox, drawPanel, drawBullet, headInk, drawLookPaper, drawPhoto, roundRect, label } from "./posterStyles";

export const POSTER_SIZES = {
  square: { w: 1080, h: 1080, label: "Square (Facebook, Instagram)" },
  portrait: { w: 1080, h: 1350, label: "Portrait (feed)" },
  story: { w: 1080, h: 1920, label: "Story" },
};

export const PALETTES = {
  navy: { bg: "#0F1E3D", bg2: "#1F3A73", text: "#FFFFFF", muted: "#C9D4EA", accent: "#FFC845", accentText: "#0F1E3D" },
  emerald: { bg: "#06352B", bg2: "#0E6B52", text: "#FFFFFF", muted: "#BFE6D6", accent: "#F7D046", accentText: "#06352B" },
  crimson: { bg: "#4A0B14", bg2: "#9B1B30", text: "#FFFFFF", muted: "#F3C9CF", accent: "#FFD166", accentText: "#4A0B14" },
  sunrise: { bg: "#FFF4E6", bg2: "#FFD8A8", text: "#3A2410", muted: "#7A5536", accent: "#E8590C", accentText: "#FFFFFF" },
  plum: { bg: "#2B1140", bg2: "#5B2A86", text: "#FFFFFF", muted: "#DCCBEF", accent: "#7CF2C3", accentText: "#2B1140" },
  clean: { bg: "#FFFFFF", bg2: "#EEF2F7", text: "#121826", muted: "#4B5565", accent: "#2457D6", accentText: "#FFFFFF" },
};

const loadImage = (src, cors) => new Promise((resolve) => {
  if (!src) return resolve(null);
  const img = new Image();
  if (cors) img.crossOrigin = "anonymous";
  img.onload = () => resolve(img);
  img.onerror = () => resolve(null);
  img.src = src;
});

// Lines of `text` no wider than `max`, at most `limit` of them.
const wrap = (ctx, text, max, limit = 3) => {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > max && line) {
      lines.push(line);
      line = w;
      if (lines.length === limit) break;
    } else line = next;
  }
  if (line && lines.length < limit) lines.push(line);
  return lines;
};

// The biggest size (down to `min`) at which `text` fits in `limit` lines
// and `maxHeight` pixels.
const fit = (ctx, text, max, { size, min, weight = 800, family, limit = 2, maxHeight = Infinity, lead = 1.15 }) => {
  for (let s = size; s >= min; s -= 4) {
    ctx.font = `${weight} ${s}px ${family}`;
    const words = String(text || "").split(/\s+/);
    const lines = wrap(ctx, text, max, limit + 1);
    if (lines.length <= limit && lines.length * s * lead <= maxHeight && words.every((w) => ctx.measureText(w).width <= max)) return { size: s, lines };
  }
  ctx.font = `${weight} ${min}px ${family}`;
  return { size: min, lines: wrap(ctx, text, max, limit) };
};

// Whether drawing `img` leaves a canvas exportable (a once-tainted canvas
// stays tainted, so this is tried on a scrap one).
const drawsClean = (img) => {
  try {
    const c = document.createElement("canvas");
    c.width = 1;
    c.height = 1;
    const x = c.getContext("2d");
    x.drawImage(img, 0, 0, 1, 1);
    x.getImageData(0, 0, 1, 1);
    return true;
  } catch {
    return false;
  }
};

const ALL = ["header", "tag", "headline", "subline", "body", "footer"];
const tagOf = (poster) => poster.tag ?? { batch: "ADMISSION OPEN", results: "TOP SCORERS", offer: "SPECIAL OFFER" }[poster.kind];
const setSpacing = (c, T) => { if (T.f.tight && "letterSpacing" in c) c.letterSpacing = "-2px"; };

// What a layout left out for lack of room, said under the preview. Set
// afresh by each posterPieces call (it runs in one go).
let CUT = [];
const plural = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;

// Lays out the parts of a poster in the box R, top to bottom, as pieces
// (each draws itself): { pieces, y (where the parts end) }.
// o: parts (which to lay out), align (left | center), scale, cover (a
// book's cover on the right), compact (the footer straight after the rest
// instead of at the bottom), headSize, ink (text colours: text, muted,
// head), headerGap.
const flow = (ctx, T, poster, R, o = {}) => {
  const parts = new Set(o.parts || ALL);
  const s = o.scale || 1;
  const center = o.align === "center";
  const ink = { text: T.p.text, muted: T.p.muted, head: T.p.head, ...(o.ink || {}) };
  const pieces = [];
  const add = (group, box, draw, extra) => pieces.push({ group, box, draw, ...extra });
  const X = R.x;
  // The right-hand column: a book's cover, or a look's picture.
  const side = o.cover ? (poster.coverImg ? "cover" : poster.photo ? "photo" : null) : null;
  const cover = side === "cover" ? poster.coverImg : null;
  const coverW = side ? Math.round(R.w * 0.4) : 0;
  const inner = R.w - (side ? coverW + 40 : 0);
  const tx = center ? X + inner / 2 : X; // where text is anchored
  const align = center ? "center" : "left";
  let y = R.y;

  if (parts.has("header")) {
    const logo = poster.logo;
    const lh = 84 * s;
    const lw = logo ? Math.min(260 * s, (logo.width / logo.height) * lh) : 0;
    const name = poster.siteName ? String(poster.siteName).slice(0, 40) : "";
    ctx.font = `700 ${40 * s}px ${T.f.body}`;
    const nw = name ? Math.min(ctx.measureText(name).width, R.w - lw - 20) : 0;
    const total = lw + (lw && nw ? 20 * s : 0) + nw;
    const sx = center ? X + (R.w - total) / 2 : X;
    const hy = y;
    if (logo) add("header", { x: sx, y: hy, w: lw, h: lh }, (c) => c.drawImage(logo, sx, hy, lw, lh));
    if (name) {
      const nx = sx + lw + (lw ? 20 * s : 0);
      add("header", { x: nx, y: hy, w: nw, h: lh }, (c) => {
        c.fillStyle = ink.text;
        c.font = `700 ${40 * s}px ${T.f.body}`;
        c.textBaseline = "middle";
        c.fillText(name, nx, hy + lh / 2, R.w - (nx - X));
        c.textBaseline = "alphabetic";
      });
    }
    if (logo || name) y += lh + (o.headerGap ?? (R.h > 1200 ? 140 : 70) * s);
  }

  if (cover) {
    const cw = coverW;
    const ch = Math.min(cw * (cover.height / cover.width), R.y + R.h - 150 - y - 30);
    const cwFit = ch * (cover.width / cover.height);
    const cx = X + R.w - cwFit;
    const cy = y + Math.max(0, (R.y + R.h - 150 - y - ch) / 2 - 20);
    add("tag", { x: cx, y: cy, w: cwFit, h: ch }, (c) => {
      c.save();
      c.shadowColor = "rgba(0,0,0,.45)";
      c.shadowBlur = 40;
      c.shadowOffsetX = 10;
      c.shadowOffsetY = 18;
      c.fillStyle = "#000";
      c.fillRect(cx, cy, cwFit, ch);
      c.restore();
      c.drawImage(cover, cx, cy, cwFit, ch);
      // The spine's shade, so it reads as a book.
      const g = c.createLinearGradient(cx, 0, cx + cwFit * 0.08, 0);
      g.addColorStop(0, "rgba(0,0,0,.35)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = g;
      c.fillRect(cx, cy, cwFit * 0.08, ch);
    });
  }

  if (side === "photo") {
    const pw = coverW;
    const avail = R.y + R.h - (parts.has("footer") ? 150 * s : 0) - y - 20;
    const ph = Math.min(avail, pw * 1.15);
    if (ph >= 120) {
      const px = X + R.w - pw;
      const py = y + Math.max(0, (avail - ph) / 2);
      add("photo", { x: px, y: py, w: pw, h: ph }, (c) => drawPhoto(c, T, poster.photo, px, py, pw, ph));
    } else CUT.push("the picture");
  }

  const tag = tagOf(poster);
  if (parts.has("tag") && tag) {
    const size = 30 * s;
    const box = tagBox(ctx, T, tag, size);
    const ty = y + (T.look === "swiss" ? 8 : 0);
    const bx = center ? tx - box.w / 2 : X;
    add("tag", { x: bx, y: ty, w: box.w, h: box.h }, (c) => drawTag(c, T, bx, ty, tag, size));
    y = ty + box.h + 40 * s;
  }

  const footerH = parts.has("footer") && !o.compact ? (center ? 210 : 150) * s : 0;
  const bottom = R.y + R.h - footerH;
  const results = poster.kind === "results" && poster.scorers?.length;
  // The subline and points, at body scale b: shrunk (to three quarters)
  // before anything is left out.
  const measure = (b) => {
    const sb = s * b;
    ctx.font = `${T.f.bodyW} ${40 * sb}px ${T.f.body}`;
    const sl = parts.has("subline") && poster.subline ? wrap(ctx, poster.subline, inner, 3) : [];
    const sh = sl.length ? 24 * s + sl.length * 40 * sb * 1.35 : 0;
    let rh = 40 * s;
    if (parts.has("body")) {
      if (results) rh += (poster.examTitle ? 60 * s : 0) + Math.min(10, poster.scorers.length) * 72 * s;
      else if (poster.points?.length) {
        ctx.font = `600 ${40 * sb}px ${T.f.body}`;
        for (const pt of poster.points.slice(0, o.maxPoints || 4)) rh += wrap(ctx, pt, inner - 50 * s, 2).length * 52 * sb + 18 * sb;
      }
    }
    if (o.compact && parts.has("footer") && poster.cta) rh += 130 * s;
    return { sl, sh, rh };
  };
  const limitY = o.compact ? R.y + R.h : bottom;
  const headKeep = parts.has("headline") && poster.headline ? 2 * 60 * s : 0; // two lines at a readable size
  let b = 1;
  let m = measure(1);
  while (b > 0.76 && y + headKeep + m.sh + m.rh > limitY) { b -= 0.06; m = measure(b); }
  const sb = s * b;
  const subSize = 40 * sb;
  const subLines = m.sl;
  const subLead = subSize * 1.35;
  const subH = m.sh;
  const restH = m.rh;

  if (parts.has("headline") && poster.headline) {
    const headText = T.f.headUpper ? String(poster.headline).toUpperCase() : poster.headline;
    const lead = T.f.tight ? 0.98 : 1.15;
    ctx.save();
    setSpacing(ctx, T);
    const head = fit(ctx, headText, inner, { size: (o.headSize || 104) * s, min: 48 * s, weight: T.f.headW, family: T.f.head, limit: 3, maxHeight: (o.compact ? R.y + R.h : bottom) - y - subH - restH, lead });
    ctx.restore();
    head.lines.forEach((line, i) => {
      y += head.size * (i ? lead : 1);
      const ly = y;
      ctx.font = `${T.f.headW} ${head.size}px ${T.f.head}`;
      const lw = Math.min(inner, ctx.measureText(line).width);
      add("headline", { x: center ? tx - lw / 2 : X, y: ly - head.size, w: lw, h: head.size * 1.2 }, (c) => {
        c.save();
        headInk(c, T, ink.head);
        setSpacing(c, T);
        c.font = `${T.f.headW} ${head.size}px ${T.f.head}`;
        c.textAlign = align;
        c.fillText(line, tx, ly, inner);
        c.restore();
      }, T.L?.typed ? { motion: "type" } : null);
    });
    y += head.size * 0.15;
  }
  // A subline that wouldn't fit above the footer loses lines (then goes).
  const subWas = subLines.length;
  while (subLines.length && !o.compact && y + 24 * s + subLines.length * subLead > bottom - 10) subLines.pop();
  if (subLines.length < subWas) CUT.push(subLines.length ? "the end of the subline" : "the subline");
  if (subLines.length) {
    y += 24 * s;
    const sy = y;
    add("subline", { x: X, y: sy, w: inner, h: subLines.length * subLead }, (c) => {
      c.fillStyle = ink.muted;
      c.font = `${T.f.bodyW} ${subSize}px ${T.f.body}`;
      c.textAlign = align;
      subLines.forEach((line, i) => c.fillText(line, tx, sy + subSize * 1.1 + i * subLead, inner));
      c.textAlign = "left";
    });
    y += subLines.length * subLead;
  }
  y += 40 * s;

  if (parts.has("body") && results) {
    if (poster.examTitle) {
      const ey = y;
      add("subline", { x: X, y: ey, w: inner, h: 60 * s }, (c) => {
        c.fillStyle = ink.muted;
        c.font = `600 ${32 * s}px ${T.f.body}`;
        c.textAlign = align;
        c.fillText(String(poster.examTitle).slice(0, 60), tx, ey + 32 * s, inner);
        c.textAlign = "left";
      });
      y += 60 * s;
    }
    // As many rows as fit above the footer.
    const rows = poster.scorers.slice(0, Math.max(1, Math.min(10, Math.floor((bottom - y - 20) / (64 * s)))));
    if (rows.length < Math.min(10, poster.scorers.length)) CUT.push(plural(Math.min(10, poster.scorers.length) - rows.length, "scorer"));
    const rowH = Math.max(64 * s, Math.min(110 * s, (bottom - y - 20) / rows.length));
    for (const sc of rows) {
      const ry = y;
      const rh = rowH - 14 * s;
      add("item", { x: X, y: ry, w: inner, h: rh }, (c) => {
        drawPanel(c, T, X, ry, inner, rh);
        const mid = ry + rh / 2;
        const r = rh * 0.36;
        c.fillStyle = sc.rank <= 3 ? T.p.accent : ink.muted;
        c.beginPath();
        c.arc(X + 24 * s + r, mid, r, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = sc.rank <= 3 ? T.p.accentText : T.p.bg;
        c.font = `800 ${Math.round(r * 1.1)}px ${T.f.body}`;
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillText(String(sc.rank), X + 24 * s + r, mid + 2);
        c.textAlign = "left";
        c.fillStyle = ink.text;
        const fs = Math.round(Math.min(44 * s, rowH * 0.4));
        c.font = `700 ${fs}px ${T.f.body}`;
        const score = sc.totalMarks ? `${sc.marks}/${sc.totalMarks}` : String(sc.marks);
        const scoreW = (c.measureText(score).width || 0) + 30;
        c.fillText(String(sc.name), X + 24 * s + r * 2 + 28 * s, mid + 2, inner - (r * 2 + 80 * s) - scoreW);
        c.textAlign = "right";
        c.fillText(score, X + inner - 30 * s, mid + 2);
        c.textAlign = "left";
        c.textBaseline = "alphabetic";
      });
      y += rowH;
    }
  } else if (parts.has("body") && poster.points?.length) {
    const fs = 40 * sb;
    ctx.font = `600 ${fs}px ${T.f.body}`;
    const pts = poster.points.slice(0, o.maxPoints || 4).filter((pt) => String(pt).trim());
    let shown = 0;
    for (const pt of pts) {
      const lines = wrap(ctx, center ? `• ${pt}` : pt, inner - (center ? 0 : 50 * s), 2);
      if (y + lines.length * 52 * sb > bottom) break;
      const py = y;
      add("item", { x: X, y: py, w: inner, h: lines.length * 52 * sb }, (c) => {
        if (!center) drawBullet(c, T, X + 14 * s, py + 28 * sb, 12 * sb);
        c.fillStyle = ink.text;
        c.font = `600 ${fs}px ${T.f.body}`;
        c.textAlign = align;
        lines.forEach((line, i) => c.fillText(line, center ? tx : X + 50 * s, py + 42 * sb + i * 52 * sb));
        c.textAlign = "left";
      });
      y += lines.length * 52 * sb + 18 * sb;
      shown++;
    }
    if (shown < pts.length) CUT.push(plural(pts.length - shown, "point"));
  }

  if (parts.has("footer")) {
    const fy = o.compact ? y : bottom + 20 * s;
    const cs = 40 * s;
    if (poster.cta) {
      const b = buttonBox(ctx, T, poster.cta, cs, inner * (center ? 0.8 : 0.6));
      const bx = center ? tx - b.w / 2 : X;
      add("cta", { x: bx, y: fy, w: b.w, h: b.h }, (c) => drawButton(c, T, bx, fy, b.w, b.h, poster.cta, cs));
      if (o.compact) y = fy + b.h + 20 * s;
    }
    if (poster.contact) {
      const fs = 32 * s;
      ctx.font = `600 ${fs}px ${T.f.body}`;
      const cw = center ? inner : inner * 0.45;
      const lines = wrap(ctx, poster.contact, cw, 2);
      const cy = center ? fy + 84 * s + 40 * s : fy;
      add("contact", { x: center ? X : X + R.w - cw, y: cy, w: cw, h: 84 * s }, (c) => {
        c.fillStyle = ink.muted;
        c.font = `600 ${fs}px ${T.f.body}`;
        c.textAlign = center ? "center" : "right";
        lines.forEach((line, i) => c.fillText(line, center ? tx : X + R.w, cy + 36 * s + i * 40 * s - (lines.length - 1) * 20 * s));
        c.textAlign = "left";
      });
    }
  }
  return { pieces, y };
};

// Moves pieces down by dy.
const shift = (pieces, dy) => pieces.map((pc) => ({ ...pc, box: { ...pc.box, y: pc.box.y + dy }, draw: (c) => { c.save(); c.translate(0, dy); pc.draw(c); c.restore(); } }));

const padOf = (T) => T.L?.pad || 80;
const regionOf = (T, w, h) => {
  const pad = padOf(T);
  const left = T.L?.margin || pad;
  return { x: left, y: pad, w: w - left - pad, h: h - pad * 2 };
};

// ---- layouts: (ctx, T, poster, { w, h }) → pieces (and .area, the
// picture's place when the layout gives it one) ----

const classic = (ctx, T, poster, { w, h }) => flow(ctx, T, poster, regionOf(T, w, h), { cover: true }).pieces;

const centered = (ctx, T, poster, { w, h }) => {
  const pad = padOf(T);
  const R = { x: pad, y: pad, w: w - pad * 2, h: h - pad * 2 };
  // The name at the top, the button and contact at the foot, the rest in
  // the middle of what's between.
  const top = flow(ctx, T, poster, R, { parts: ["header"], align: "center", headerGap: 0 });
  const foot = flow(ctx, T, { ...poster, headline: "" }, R, { parts: ["footer"], align: "center" });
  const footTop = Math.min(h - pad, ...foot.pieces.map((pc) => pc.box.y));
  // A look's picture sits above the words, centred.
  const ph = poster.photo ? Math.min(h * 0.26, (footTop - top.y) * 0.34) : 0;
  const photo = [];
  if (ph >= 120) {
    const pw = Math.min(R.w * 0.6, ph * 1.35);
    const px = w / 2 - pw / 2;
    const py = top.y + 30;
    photo.push({ group: "photo", box: { x: px, y: py, w: pw, h: ph }, draw: (c) => drawPhoto(c, T, poster.photo, px, py, pw, ph) });
  } else if (poster.photo) CUT.push("the picture");
  const gap = photo.length ? ph + 50 : 0;
  const room = { x: R.x, y: 0, w: R.w, h: footTop - top.y - 60 - gap };
  const mid = flow(ctx, T, poster, room, { parts: ["tag", "headline", "subline", "body"], align: "center", headSize: 120, compact: true });
  const dy = top.y + 30 + gap + Math.max(0, (room.h - mid.y) / 2);
  const out = [...top.pieces, ...photo, ...shift(mid.pieces, dy), ...foot.pieces];
  if (!T.look) {
    // A thin frame, like a card.
    out.unshift({ group: "decor", box: { x: 0, y: 0, w, h }, draw: (c) => {
      c.save();
      c.strokeStyle = T.p.accent;
      c.globalAlpha *= 0.55;
      c.lineWidth = 3;
      c.strokeRect(36, 36, w - 72, h - 72);
      c.restore();
    } });
  }
  return out;
};

const split = (ctx, T, poster, { w, h }) => {
  const pad = padOf(T);
  const cut = Math.round(w * 0.44);
  const R = { x: cut + 56, y: pad, w: w - cut - 56 - pad, h: h - pad * 2 };
  const out = flow(ctx, T, poster, R, { scale: 0.8, maxPoints: 3 }).pieces;
  out.area = { x: 0, y: 0, w: cut, h };
  return out;
};

const card = (ctx, T, poster, { w, h }) => {
  const pad = padOf(T);
  const onPicture = Boolean(poster.hasPicture) && !T.look;
  const head = flow(ctx, T, poster, { x: pad, y: pad, w: w - pad * 2, h: 120 }, { parts: ["header"], ink: onPicture ? { text: "#FFFFFF" } : undefined }).pieces;
  const inset = 52;
  const cw = w - pad * 2;
  const maxH = h - pad - 200;
  const ink = { text: T.p.paperText, muted: T.p.paperMuted, head: T.look ? T.p.head : T.p.paperText };
  const body = flow(ctx, { ...T, p: { ...T.p, text: ink.text, muted: ink.muted, head: ink.head } }, poster, { x: pad + inset, y: 0, w: cw - inset * 2, h: maxH - inset * 2 }, { parts: ["tag", "headline", "subline", "body", "footer"], compact: true, scale: 0.85, headSize: 96, maxPoints: 3, ink });
  const cardH = Math.min(maxH, body.y + inset);
  const top = h - pad - cardH;
  const out = [...head, { group: "card", box: { x: pad, y: top, w: cw, h: cardH }, draw: (c) => drawPanel(c, T, pad, top, cw, cardH, { solid: true, radius: 28 }) }, ...shift(body.pieces, top + inset)];
  out.area = { x: 0, y: 0, w, h, full: true };
  return out;
};

const band = (ctx, T, poster, { w, h }) => {
  const R = regionOf(T, w, h);
  const top = flow(ctx, T, poster, R, { parts: ["header", "tag"] });
  const out = [...top.pieces];
  const angle = -0.12;
  const text = T.f.headUpper ? String(poster.headline || "").toUpperCase() : String(poster.headline || "");
  // On a square the band is slimmer and sits higher, leaving room below.
  const square = h < 1200;
  const head = fit(ctx, text, w * 0.8, { size: square ? 108 : 124, min: 52, weight: T.f.headW, family: T.f.head, limit: 2, maxHeight: h * (square ? 0.22 : 0.3) });
  const bandH = head.lines.length * head.size * 1.12 + (square ? 60 : 90);
  const cy = square ? top.y + bandH / 2 + 30 : Math.max(top.y + bandH / 2 + 40, h * (h > 1400 ? 0.4 : 0.47));
  const rot = (c, f) => { c.save(); c.translate(w / 2, cy); c.rotate(angle); c.translate(-w / 2, -cy); f(); c.restore(); };
  out.push({ group: "band", box: { x: -100, y: cy - bandH / 2, w: w + 200, h: bandH }, motion: "slide", draw: (c) => rot(c, () => {
    c.fillStyle = T.p.accent;
    c.fillRect(-100, cy - bandH / 2, w + 200, bandH);
  }) });
  const first = cy - (head.lines.length * head.size * 1.12) / 2 + head.size * 0.88;
  head.lines.forEach((line, i) => {
    const ly = first + i * head.size * 1.12;
    out.push({ group: "headline", box: { x: w * 0.1, y: ly - head.size, w: w * 0.8, h: head.size * 1.2 }, draw: (c) => rot(c, () => {
      c.fillStyle = T.p.accentText;
      setSpacing(c, T);
      c.font = `${T.f.headW} ${head.size}px ${T.f.head}`;
      c.textAlign = "center";
      c.fillText(line, w / 2, ly, w * 0.84);
    }) });
  });
  const below = cy + bandH / 2 + (square ? 60 : 70);
  out.push(...flow(ctx, T, poster, { x: R.x, y: below, w: R.w, h: R.y + R.h - below }, { parts: ["subline", "body", "footer"], maxPoints: 3, cover: true }).pieces);
  return out;
};

const magazine = (ctx, T, poster, { w, h }) => {
  const pad = padOf(T);
  const left = T.L?.margin || pad;
  const out = [];
  const top = flow(ctx, T, poster, { x: left, y: pad * 0.7, w: w - left - pad - 60, h: 80 }, { parts: ["header"], scale: 0.7, headerGap: 40 });
  out.push(...top.pieces);
  const text = T.f.headUpper ? String(poster.headline || "").toUpperCase() : String(poster.headline || "");
  ctx.save();
  if ("letterSpacing" in ctx) ctx.letterSpacing = "-3px";
  const head = fit(ctx, text, w - left - pad - 40, { size: 210, min: 80, weight: T.f.headW, family: T.f.head, limit: 3, maxHeight: h * (h > 1400 ? 0.34 : 0.4), lead: 0.95 });
  ctx.restore();
  let y = top.y;
  head.lines.forEach((line, i) => {
    y += head.size * (i ? 0.95 : 0.9);
    const ly = y;
    out.push({ group: "headline", box: { x: left, y: ly - head.size, w: w - left - pad, h: head.size }, draw: (c) => {
      c.save();
      headInk(c, T, T.p.head);
      if ("letterSpacing" in c) c.letterSpacing = "-3px";
      c.font = `${T.f.headW} ${head.size}px ${T.f.head}`;
      c.fillText(line, left, ly, w - left - pad);
      c.restore();
    }, ...(T.L?.typed ? { motion: "type" } : {}) });
  });
  y += 30;
  const sub = flow(ctx, T, poster, { x: left, y, w: w - left - pad - 120, h: 200 }, { parts: ["subline"], scale: 0.85 });
  out.push(...sub.pieces);
  if (poster.siteName) {
    const name = String(poster.siteName).toUpperCase().slice(0, 30);
    out.push({ group: "header", box: { x: w - pad, y: pad, w: 40, h: 400 }, draw: (c) => {
      c.save();
      c.translate(w - pad * 0.55, pad * 0.8);
      c.rotate(Math.PI / 2);
      c.fillStyle = T.p.muted;
      c.font = `600 22px ${T.f.body}`;
      if ("letterSpacing" in c) c.letterSpacing = "6px";
      c.fillText(name, 0, 0);
      c.restore();
    } });
  }
  const picY = Math.min(h - 260, Math.max(sub.y + 10, h * 0.5));
  out.area = { x: 0, y: picY, w, h: h - picY };
  // The button and contact sit on the picture's foot.
  const footY = h - pad - 84;
  if (poster.cta) {
    const b = buttonBox(ctx, T, poster.cta, 38, w * 0.55);
    out.push({ group: "cta", box: { x: left, y: footY, w: b.w, h: b.h }, draw: (c) => drawButton(c, T, left, footY, b.w, b.h, poster.cta, 38) });
  }
  if (poster.contact) {
    out.push({ group: "contact", box: { x: w * 0.55, y: footY, w: w * 0.45 - pad, h: 80 }, draw: (c) => {
      c.save();
      c.fillStyle = "#FFFFFF";
      c.shadowColor = "rgba(0,0,0,0.6)";
      c.shadowBlur = 10;
      c.font = `600 30px ${T.f.body}`;
      c.textAlign = "right";
      c.fillText(String(poster.contact).slice(0, 40), w - pad, footY + 50, w * 0.45 - pad);
      c.restore();
    } });
  }
  return out;
};

const initial = (name) => (String(name || "?").trim().match(/\S/u) || ["?"])[0].toUpperCase();

const podium = (ctx, T, poster, { w, h }) => {
  if (!(poster.kind === "results" && poster.scorers?.length)) return centered(ctx, T, poster, { w, h });
  const pad = padOf(T);
  const R = { x: pad, y: pad, w: w - pad * 2, h: h - pad * 2 };
  const top = flow(ctx, T, poster, R, { parts: ["header", "tag", "headline"], align: "center", headSize: h > 1400 ? 110 : 84, headerGap: h > 1400 ? 120 : 40, compact: true });
  const out = [...top.pieces];
  let y = top.y;
  if (poster.examTitle) {
    const ey = y - 10;
    out.push({ group: "subline", box: { x: pad, y: ey, w: R.w, h: 50 }, draw: (c) => {
      c.fillStyle = T.p.muted;
      c.font = `600 34px ${T.f.body}`;
      c.textAlign = "center";
      c.fillText(String(poster.examTitle).slice(0, 60), w / 2, ey + 34, R.w);
      c.textAlign = "left";
    } });
    y += 50;
  }
  const sorted = [...poster.scorers].sort((a, b) => a.rank - b.rank);
  const top3 = sorted.slice(0, 3);
  const rest = sorted.slice(3, 9);
  const floor = h;
  // Bigger on a tall poster.
  let k = h > 1400 ? 1.4 : h > 1200 ? 1.15 : 1;
  let stageH = Math.min(h * 0.26, 300 * k);
  // Shrunk to the room under the headline: the winner's block, name and
  // picture must fit.
  const need = stageH + 120 * k + 76 * k * 2 + 10;
  if (need > floor - y - 10) { const f = Math.max(0.55, (floor - y - 10) / need); stageH *= f; k *= f; }
  const colW = Math.min(250 * k, R.w / 3 - 20);
  const heights = [1, 0.72, 0.52]; // 1st, 2nd, 3rd
  const order = [1, 0, 2]; // 2nd, 1st, 3rd, left to right
  const gap = 16;
  const x0 = w / 2 - (colW * 3 + gap * 2) / 2;
  // The rest, in two columns, between the headline and the stage.
  // Only as many rows as fit above the tallest avatar.
  const avatarsTop = floor - stageH - 120 * k - 76 * k * 2 - 10;
  const rowsFit = Math.max(0, Math.floor((avatarsTop - (y + 10)) / 56));
  if (rowsFit * 2 < rest.length) {
    // No room for rows: the rest on one line ("4. Tania 44 · 5. Arif 43"),
    // as small as it takes, else left out.
    const all = rest.splice(0);
    if (avatarsTop - y >= 40) {
      const text = all.map((sc) => `${sc.rank}. ${String(sc.name).split(/\s+/)[0]} ${sc.marks}`).join("  ·  ");
      let fs = 30;
      ctx.font = `600 ${fs}px ${T.f.body}`;
      while (fs > 20 && ctx.measureText(text).width > R.w) { fs -= 2; ctx.font = `600 ${fs}px ${T.f.body}`; }
      const ly = Math.min(avatarsTop - 12, y + 30);
      out.push({ group: "item", box: { x: pad, y: ly - fs, w: R.w, h: fs * 1.3 }, draw: (c) => {
        c.fillStyle = T.p.muted;
        c.font = `600 ${fs}px ${T.f.body}`;
        c.textAlign = "center";
        c.fillText(text, w / 2, ly, R.w);
        c.textAlign = "left";
      } });
    } else CUT.push(plural(all.length, "scorer"));
  }
  if (rest.length) {
    const listTop = Math.max(y + 10, avatarsTop - Math.ceil(rest.length / 2) * 56);
    rest.forEach((sc, i) => {
      const colX = i % 2 ? w / 2 + 20 : pad;
      const ry = listTop + Math.floor(i / 2) * 56;
      const score = sc.totalMarks ? `${sc.marks}/${sc.totalMarks}` : String(sc.marks);
      out.push({ group: "item", box: { x: colX, y: ry, w: w / 2 - pad - 20, h: 48 }, draw: (c) => {
        c.font = `600 30px ${T.f.body}`;
        c.fillStyle = T.p.muted;
        c.fillText(`${sc.rank}.`, colX, ry + 34);
        c.fillStyle = T.p.text;
        c.fillText(String(sc.name), colX + 52, ry + 34, w / 2 - pad - 200);
        c.textAlign = "right";
        c.fillText(score, colX + w / 2 - pad - 30, ry + 34);
        c.textAlign = "left";
      } });
    });
  }
  order.forEach((ix, col) => {
    const sc = top3[ix];
    if (!sc) return;
    const bh = stageH * heights[ix];
    const bx = x0 + col * (colW + gap);
    const by = floor - bh;
    out.push({ group: "stage", motion: "rise", box: { x: bx, y: by, w: colW, h: bh }, draw: (c) => {
      c.save();
      c.fillStyle = T.p.accent;
      if (T.look) c.fillRect(bx, by, colW, bh + 20);
      else { roundRect(c, bx, by, colW, bh + 30, 14); c.fill(); }
      if (T.look === "sketch") { c.strokeStyle = T.p.text; c.lineWidth = 4; c.strokeRect(bx, by, colW, bh + 20); }
      c.fillStyle = T.p.accentText;
      c.font = `800 ${Math.round(Math.min(90, bh * 0.5))}px ${T.f.head}`;
      c.textAlign = "center";
      c.fillText(String(sc.rank), bx + colW / 2, by + Math.min(90, bh * 0.5) + 14);
      c.restore();
    } });
    const r = (ix === 0 ? 76 : 62) * k;
    const ay = by - 120 * k - r;
    const ax = bx + colW / 2;
    const score = sc.totalMarks ? `${sc.marks}/${sc.totalMarks}` : String(sc.marks);
    out.push({ group: "item", box: { x: ax - r, y: ay - r, w: r * 2, h: r * 2 + 120 }, draw: (c) => {
      c.save();
      c.fillStyle = T.p.paper === "#FFFFFF" && !T.look ? T.p.muted : T.p.paper;
      c.beginPath();
      c.arc(ax, ay, r, 0, Math.PI * 2);
      c.fill();
      c.lineWidth = 7;
      c.strokeStyle = T.p.accent;
      c.stroke();
      c.fillStyle = T.look ? T.p.paperText : T.p.bg;
      c.font = `800 ${Math.round(r * 0.95)}px ${T.f.head}`;
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(initial(sc.name), ax, ay + 4);
      c.textBaseline = "alphabetic";
      c.fillStyle = T.p.text;
      c.font = `700 ${32 * k}px ${T.f.body}`;
      c.fillText(String(sc.name).split(/\s+/).slice(0, 2).join(" "), ax, ay + r + 46 * k, colW + 10);
      c.fillStyle = T.look ? T.p.text : T.p.accent;
      c.font = `700 ${28 * k}px ${T.f.body}`;
      c.fillText(score, ax, ay + r + 84 * k);
      c.restore();
    } });
  });
  // Confetti, for the plain look.
  if (!T.look) {
    out.unshift({ group: "decor", box: { x: 0, y: 0, w, h }, draw: (c) => {
      const dots = [[0.08, 0.3, "#FFD166"], [0.9, 0.22, "#7CF2C3"], [0.72, 0.4, "#FFFFFF"], [0.22, 0.48, "#7CF2C3"], [0.94, 0.55, "#FFD166"], [0.05, 0.62, "#FFFFFF"], [0.6, 0.12, "#FFD166"], [0.35, 0.2, "#FFFFFF"]];
      c.save();
      for (const [x, yy, col] of dots) { c.fillStyle = col; c.globalAlpha = 0.8; c.beginPath(); c.arc(w * x, h * yy, 7, 0, Math.PI * 2); c.fill(); }
      c.restore();
    } });
  }
  return out;
};

const ticket = (ctx, T, poster, { w, h }) => {
  const R = regionOf(T, w, h);
  const top = flow(ctx, T, poster, R, { parts: ["header", "tag", "headline"], headSize: 80, headerGap: 50, compact: true });
  const out = [...top.pieces];
  const tx = R.x;
  const tw = R.w;
  const th = Math.min(400, Math.max(300, h * 0.3));
  const ty = top.y + 10;
  const stub = 210;
  const big = String(poster.offerText || poster.subline || "").trim() || "OFFER";
  const bigFit = fit(ctx, big, tw - stub - 90, { size: 150, min: 56, weight: T.f.headW, family: T.f.head, limit: 2, maxHeight: th - (poster.until ? 110 : 60), lead: 1 });
  const code = String(poster.couponCode || "").trim();
  const notch = T.p.bg;
  out.push({ group: "ticket", box: { x: tx, y: ty, w: tw, h: th }, draw: (c) => {
    c.save();
    c.fillStyle = T.p.accent;
    if (T.look) c.fillRect(tx, ty, tw, th);
    else { roundRect(c, tx, ty, tw, th, 26); c.fill(); }
    if (T.look === "sketch") { c.strokeStyle = T.p.text; c.lineWidth = 4; c.strokeRect(tx, ty, tw, th); }
    // The tear line and its notches.
    const lx = tx + tw - stub;
    c.fillStyle = notch;
    c.beginPath(); c.arc(lx, ty, 22, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(lx, ty + th, 22, 0, Math.PI * 2); c.fill();
    c.strokeStyle = T.p.accentText;
    c.globalAlpha = 0.5;
    c.lineWidth = 4;
    c.setLineDash([14, 12]);
    c.beginPath(); c.moveTo(lx, ty + 30); c.lineTo(lx, ty + th - 30); c.stroke();
    c.setLineDash([]);
    c.globalAlpha = 1;
    c.fillStyle = T.p.accentText;
    c.font = `${T.f.headW} ${bigFit.size}px ${T.f.head}`;
    bigFit.lines.forEach((line, i) => c.fillText(line, tx + 44, ty + 40 + bigFit.size * (0.9 + i), tw - stub - 80));
    if (poster.until) {
      c.font = `600 30px ${T.f.body}`;
      c.globalAlpha = 0.85;
      c.fillText(String(poster.until).slice(0, 50), tx + 44, ty + th - 40, tw - stub - 80);
      c.globalAlpha = 1;
    }
    c.restore();
  } });
  out.push({ group: "ticket", motion: "stamp", box: { x: tx + tw - stub, y: ty, w: stub, h: th }, draw: (c) => {
    c.save();
    c.translate(tx + tw - stub / 2, ty + th / 2);
    c.rotate(-Math.PI / 2);
    c.fillStyle = T.p.accentText;
    const text = code || label(T, "Offer");
    let size = 64;
    c.font = `400 ${size}px "Special Elite", ${T.f.label}`;
    while (size > 26 && c.measureText(text).width > th - 60) { size -= 4; c.font = `400 ${size}px "Special Elite", ${T.f.label}`; }
    if ("letterSpacing" in c) c.letterSpacing = "4px";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(text, 0, 0);
    c.restore();
  } });
  const below = ty + th + 50;
  out.push(...flow(ctx, T, { ...poster, subline: poster.offerText ? poster.subline : "" }, { x: R.x, y: below, w: R.w, h: R.y + R.h - below }, { parts: ["subline", "body", "footer"], maxPoints: 2, scale: 0.9, cover: true }).pieces);
  return out;
};

const LAYOUTS = { classic, centered, split, card, band, magazine, podium, ticket };

// The poster as pieces, in reading order, each drawing itself: the poster
// draws them all at once, the promo video (promoVideo.js) brings them in
// one after another. group says which part it is (decor, header, tag,
// headline, subline, item, band, card, stage, ticket, cta, contact); box
// is roughly where it sits; motion, a piece's own way in. The list's
// .area is where the layout puts the picture, .T the theme.
// poster: { kind, tag, headline, subline, points[], cta, scorers[],
//           examTitle, siteName, contact, logo (image), coverImg,
//           offerText, until, couponCode, hasPicture, bgImg (the
//           picture, loaded) }
export const posterPieces = (ctx, poster, { w, h, p, style = {} }) => {
  const T = posterTheme(p, style);
  const layout = LAYOUTS[style.layout] ? style.layout : "classic";
  // A look draws its own paper, so the picture goes on it as a framed
  // photo (where the layout has no place of its own for it).
  const photo = T.look && poster.bgImg && !["split", "card", "magazine", "podium"].includes(layout) && style.photo !== false ? poster.bgImg : null;
  CUT = [];
  const pieces = LAYOUTS[layout](ctx, T, { ...poster, photo }, { w, h });
  pieces.T = T;
  pieces.cut = [...new Set(CUT)];
  return pieces;
};

const coverDraw = (ctx, img, a, zoom) => {
  const scale = Math.max(a.w / img.width, a.h / img.height) * zoom;
  const bw = img.width * scale;
  const bh = img.height * scale;
  ctx.save();
  ctx.beginPath();
  ctx.rect(a.x, a.y, a.w, a.h);
  ctx.clip();
  ctx.drawImage(img, a.x + (a.w - bw) / 2, a.y + (a.h - bh) / 2, bw, bh);
  ctx.restore();
};

// The background: the palette's gradient (or the look's own paper), the
// picture (under a tint, lighter with pictureStyle "strong", or in the
// layout's own place for it), or quiet shapes. zoom > 1 pushes in on the
// picture (the video's slow zoom); drift moves the shapes.
export const drawBackground = (ctx, { w, h, p, bg, pictureStyle = "soft", zoom = 1, drift = 0, T, area }) => {
  if (T?.look) drawLookPaper(ctx, T, { w, h, drift });
  else {
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, p.bg);
    grad.addColorStop(1, p.bg2);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    if (bg && !area) {
      coverDraw(ctx, bg, { x: 0, y: 0, w, h }, zoom);
      if (pictureStyle === "strong") {
        // The picture shows; a wash from the top and bottom keeps text readable.
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
        const shade = ctx.createLinearGradient(0, 0, 0, h);
        shade.addColorStop(0, `${p.bg}cc`);
        shade.addColorStop(0.45, `${p.bg}33`);
        shade.addColorStop(1, `${p.bg}ee`);
        ctx.globalAlpha = 1;
        ctx.fillStyle = shade;
        ctx.fillRect(0, 0, w, h);
      } else {
        ctx.globalAlpha = 0.72;
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      }
      ctx.globalAlpha = 1;
    } else if (!area) {
      // A quiet shape so a plain poster isn't flat.
      ctx.globalAlpha = 0.08;
      ctx.fillStyle = p.text;
      ctx.beginPath();
      ctx.arc(w * 0.92 - drift * 40, h * 0.08 + drift * 30, w * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(w * 0.05 + drift * 30, h * 0.98 - drift * 40, w * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
  if (!area) return;
  const pp = T?.p || p;
  if (bg) {
    coverDraw(ctx, bg, area, zoom);
    if (area.full) {
      // Under the card layout's header: a shade so the name reads.
      const g = ctx.createLinearGradient(0, 0, 0, h * 0.3);
      g.addColorStop(0, "rgba(0,0,0,0.45)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h * 0.3);
    } else if (area.y > 0) {
      // Under the magazine's button and contact.
      const g = ctx.createLinearGradient(0, h - 220, 0, h);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(0,0,0,0.55)");
      ctx.fillStyle = g;
      ctx.fillRect(0, h - 220, w, 220);
    }
  } else if (!area.full) {
    // No picture: a block of the second colour with rings.
    ctx.save();
    ctx.beginPath();
    ctx.rect(area.x, area.y, area.w, area.h);
    ctx.clip();
    ctx.fillStyle = T?.look ? pp.bg2 : pp.accent;
    ctx.fillRect(area.x, area.y, area.w, area.h);
    ctx.strokeStyle = T?.look ? pp.text : pp.accentText;
    ctx.globalAlpha = 0.18;
    ctx.lineWidth = 6;
    const cx = area.x + area.w * 0.5 + drift * 30;
    const cy = area.y + area.h * 0.55;
    for (let r = 60; r < Math.max(area.w, area.h); r += 70) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); }
    ctx.restore();
  }
  if (T?.look === "sketch") {
    ctx.strokeStyle = pp.text;
    ctx.lineWidth = 5;
    if (area.full) return;
    if (area.y > 0) { ctx.beginPath(); ctx.moveTo(0, area.y); ctx.lineTo(w, area.y); ctx.stroke(); }
    else { ctx.beginPath(); ctx.moveTo(area.w, 0); ctx.lineTo(area.w, h); ctx.stroke(); }
  }
};

// The pictures a poster uses, loaded; the logo is left out when drawing
// it would block the download (cross-origin without CORS).
export const loadPosterImages = async (poster) => {
  const bg = await loadImage(poster.background, false);
  let logo = await loadImage(poster.logo, true);
  const logoOk = !logo || drawsClean(logo);
  if (!logoOk) logo = null;
  let coverImg = await loadImage(poster.cover, true);
  if (coverImg && !drawsClean(coverImg)) coverImg = null;
  return { bg, logo, logoOk, coverImg };
};

export const posterFrame = (canvas, size) => {
  const { w, h } = POSTER_SIZES[size] || POSTER_SIZES.square;
  canvas.width = w;
  canvas.height = h;
  return { w, h };
};

// Returns { logoOk: false when the logo couldn't be drawn safely (it's
// left out), cut: what didn't fit }.
export const drawPoster = async (canvas, poster, { size = "square", palette = "navy", pictureStyle = "soft", style = {} } = {}) => {
  const { w, h } = posterFrame(canvas, size);
  const p = PALETTES[palette] || PALETTES.navy;
  const ctx = canvas.getContext("2d");
  await loadPosterFonts();
  if (document.fonts?.ready) await document.fonts.ready.catch(() => {});
  const { bg, logo, logoOk, coverImg } = await loadPosterImages(poster);
  const pieces = posterPieces(ctx, { ...poster, logo, coverImg, bgImg: bg, hasPicture: Boolean(bg) }, { w, h, p, style });
  drawBackground(ctx, { w, h, p, bg, pictureStyle, T: pieces.T, area: pieces.area });
  for (const piece of pieces) piece.draw(ctx);
  return { logoOk, cut: pieces.cut };
};
