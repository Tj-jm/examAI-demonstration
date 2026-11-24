// Poster styles (admin Posters page, drawPoster.js): the font pairs, the
// hand-made looks and their drawing bits (tags, buttons, panels, bullets,
// backgrounds). A look brings its own colours and fonts; without one the
// palette and the chosen font pair are used.
import "@fontsource/hind-siliguri/500.css";
import "@fontsource/hind-siliguri/600.css";
import "@fontsource/hind-siliguri/700.css";
import "@fontsource/noto-serif-bengali/500.css";
import "@fontsource/noto-serif-bengali/800.css";
import "@fontsource/baloo-da-2/600.css";
import "@fontsource/baloo-da-2/800.css";
import "@fontsource/anek-bangla/500.css";
import "@fontsource/anek-bangla/800.css";
import "@fontsource/atma/500.css";
import "@fontsource/atma/700.css";
import "@fontsource/kalam/400.css";
import "@fontsource/kalam/700.css";
import "@fontsource/cabin-sketch/700.css";
import "@fontsource/patrick-hand/400.css";
import "@fontsource/special-elite/400.css";
import "@fontsource/inter-tight/500.css";
import "@fontsource/inter-tight/800.css";
import "@fontsource/inter-tight/900.css";
import "@fontsource/archivo-black/400.css";
import "@fontsource/gloria-hallelujah/400.css";

const BN = '"Hind Siliguri", "Noto Sans Bengali", "Segoe UI", Roboto, system-ui, sans-serif';
const fam = (...names) => `${names.map((n) => `"${n}"`).join(", ")}, ${BN}`;

export const POSTER_LAYOUTS = [
  ["classic", "Classic"],
  ["centered", "Centered"],
  ["split", "Split"],
  ["card", "Card"],
  ["band", "Band"],
  ["magazine", "Magazine"],
  ["podium", "Podium"],
  ["ticket", "Ticket"],
];
// The layout a kind of post starts with.
export const defaultLayout = (kind) => ({ results: "podium", offer: "ticket", greeting: "centered" }[kind] || "classic");

export const POSTER_FONTS = {
  clean: { label: "Clean", head: fam("Hind Siliguri"), headW: 700, body: fam("Hind Siliguri"), bodyW: 500 },
  serif: { label: "Serif", head: fam("Noto Serif Bengali"), headW: 800, body: fam("Noto Serif Bengali"), bodyW: 500 },
  rounded: { label: "Rounded", head: fam("Baloo Da 2"), headW: 800, body: fam("Baloo Da 2"), bodyW: 600 },
  display: { label: "Display", head: fam("Anek Bangla"), headW: 800, body: fam("Anek Bangla"), bodyW: 500 },
  hand: { label: "Handwritten", head: fam("Kalam", "Atma"), headW: 700, body: fam("Kalam", "Atma"), bodyW: 400 },
};

// Hand-made looks, like the student app's designs of the same names.
export const POSTER_LOOKS = {
  khata: {
    label: "Notebook",
    p: { bg: "#FFFDF5", bg2: "#F4EFDC", text: "#2B2F3A", muted: "#5A5F6E", accent: "#FFE680", accentText: "#2B2F3A", head: "#1D3F8A", paper: "#FFF7C2", paperText: "#2B2F3A", paperMuted: "#5A5F6E" },
    fonts: { head: fam("Kalam", "Atma"), headW: 700, body: fam("Kalam", "Atma"), bodyW: 400 },
    margin: 110, typed: true,
  },
  swiss: {
    label: "Swiss poster",
    p: { bg: "#F2F0EB", bg2: "#E6E3DC", text: "#111111", muted: "#3D3D3D", accent: "#E63312", accentText: "#FFFFFF", paper: "#FFFFFF", paperText: "#111111", paperMuted: "#3D3D3D" },
    fonts: { head: fam("Inter Tight", "Anek Bangla"), headW: 900, body: fam("Inter Tight", "Hind Siliguri"), bodyW: 500, label: fam("Inter Tight", "Hind Siliguri"), labelW: 800, upper: true, tight: true },
  },
  sketch: {
    label: "Sketch",
    p: { bg: "#FFFFFF", bg2: "#F6F6F6", text: "#222222", muted: "#4A4A4A", accent: "#FFD84D", accentText: "#222222", paper: "#FFFFFF", paperText: "#222222", paperMuted: "#4A4A4A" },
    fonts: { head: fam("Gloria Hallelujah", "Atma"), headW: 400, body: fam("Gloria Hallelujah", "Atma"), bodyW: 400 },
    typed: true,
  },
};

// Every font a poster may use, loaded before drawing (a canvas doesn't wait).
export const loadPosterFonts = async () => {
  if (!document.fonts?.load) return;
  const faces = [
    "500 40px \"Hind Siliguri\"", "700 40px \"Hind Siliguri\"", "500 40px \"Noto Serif Bengali\"", "800 40px \"Noto Serif Bengali\"",
    "600 40px \"Baloo Da 2\"", "800 40px \"Baloo Da 2\"", "500 40px \"Anek Bangla\"", "800 40px \"Anek Bangla\"",
    "500 40px Atma", "700 40px Atma", "400 40px Kalam", "700 40px Kalam", "700 40px \"Cabin Sketch\"", "400 40px \"Patrick Hand\"",
    "400 40px \"Special Elite\"", "500 40px \"Inter Tight\"", "900 40px \"Inter Tight\"", "800 40px \"Inter Tight\"", "400 40px \"Archivo Black\"", "400 40px \"Gloria Hallelujah\"",
  ];
  await Promise.all(faces.map((f) => document.fonts.load(f, "অA1").catch(() => null)));
};

// The palette and fonts a poster is drawn with.
export const posterTheme = (palette, { look = "", font = "clean" } = {}) => {
  const L = POSTER_LOOKS[look];
  if (L) {
    // A font pair picked over a look replaces its fonts (labels keep theirs).
    const F = POSTER_FONTS[font];
    const fonts = F ? { ...L.fonts, head: F.head, headW: F.headW, body: F.body, bodyW: F.bodyW, ...(L.fonts.label ? {} : { label: F.body }) } : L.fonts;
    return { look, L, p: { head: L.p.text, ...L.p }, f: { label: fonts.body, labelW: 700, ...fonts } };
  }
  const F = POSTER_FONTS[font] || POSTER_FONTS.clean;
  return {
    look: "", L: null,
    p: { head: palette.text, paper: "#FFFFFF", paperText: "#121826", paperMuted: "#4B5565", ...palette },
    f: { ...F, label: F.body, labelW: 800 },
  };
};

// ---- drawing bits ----

// A wobbly rectangle, the same every time for the same box.
const rand = (seed) => { let s = Math.abs(Math.floor(seed)) % 2147483647 || 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; };
export const roughRect = (c, x, y, w, h, wob = 4, seed = x * 7 + y * 13 + w) => {
  const r = rand(seed);
  const j = () => (r() - 0.5) * wob;
  c.beginPath();
  c.moveTo(x + j(), y + j());
  c.lineTo(x + w + j(), y + j());
  c.lineTo(x + w + j(), y + h + j());
  c.lineTo(x + j(), y + h + j());
  c.closePath();
};
export const roundRect = (c, x, y, w, h, r) => {
  r = Math.min(r, h / 2, w / 2);
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
};
const hatch = (c, x, y, w, h, color, gap = 12) => {
  c.save();
  c.beginPath();
  c.rect(x, y, w, h);
  c.clip();
  c.strokeStyle = color;
  c.lineWidth = 4;
  for (let k = -h; k < w; k += gap) { c.beginPath(); c.moveTo(x + k, y + h); c.lineTo(x + k + h, y); c.stroke(); }
  c.restore();
};

export const label = (T, text) => (T.f.upper ? String(text).toUpperCase() : String(text));

// The kind tag: its size, then its drawing.
export const tagBox = (c, T, text, size) => {
  c.font = `${T.f.labelW} ${size}px ${T.f.label}`;
  const tw = c.measureText(label(T, text)).width;
  const padX = T.look === "swiss" || T.look === "sketch" ? 0 : size * 0.8;
  return { w: tw + padX * 2, h: size * 1.85, padX };
};
export const drawTag = (c, T, x, y, text, size) => {
  const { w, h, padX } = tagBox(c, T, text, size);
  const { p } = T;
  const t = label(T, text);
  c.save();
  c.font = `${T.f.labelW} ${size}px ${T.f.label}`;
  c.textBaseline = "middle";
  const ty = y + h / 2 + 2;
  switch (T.look) {
    case "khata":
      c.fillStyle = "rgba(255,214,0,0.55)"; c.fillRect(x - 6, y + h * 0.18, w + 12, h * 0.7);
      c.fillStyle = p.text; c.fillText(t, x + padX, ty); break;
    case "swiss":
      c.fillStyle = p.text; c.fillRect(x, y - 4, Math.min(w, 220), 8);
      c.fillText(t, x, ty + 8); break;
    case "sketch":
      c.fillStyle = p.text; c.fillText(t, x, ty);
      c.strokeStyle = p.text; c.lineWidth = 3;
      c.beginPath(); c.moveTo(x, y + h - 2); c.quadraticCurveTo(x + w / 2, y + h + 6, x + w, y + h - 4); c.stroke(); break;
    default:
      c.fillStyle = p.accent; roundRect(c, x, y, w, h, h / 2); c.fill();
      c.fillStyle = p.accentText; c.fillText(t, x + padX, ty);
  }
  c.restore();
  return { w, h };
};

// The call to action button.
export const buttonBox = (c, T, text, size, max) => {
  c.font = `${T.f.labelW} ${size}px ${T.f.label}`;
  return { w: Math.min(max, c.measureText(label(T, text)).width + size * 1.8), h: size * 2.1 };
};
export const drawButton = (c, T, x, y, w, h, text, size) => {
  const { p } = T;
  const t = label(T, text);
  c.save();
  c.font = `${T.f.labelW} ${size}px ${T.f.label}`;
  c.textBaseline = "middle";
  c.textAlign = "center";
  const cx = x + w / 2; const cy = y + h / 2 + 2;
  switch (T.look) {
    case "khata":
      c.translate(cx, cy); c.rotate(-0.035); c.translate(-cx, -cy);
      c.shadowColor = "rgba(0,0,0,0.2)"; c.shadowBlur = 14; c.shadowOffsetY = 6;
      c.fillStyle = p.accent; c.fillRect(x, y, w, h);
      c.shadowColor = "transparent";
      c.fillStyle = "rgba(255,255,255,0.6)"; c.fillRect(cx - 50, y - 12, 100, 26);
      c.fillStyle = p.text; c.fillText(t, cx, cy, w - size); break;
    case "swiss":
      c.fillStyle = p.accent; c.fillRect(x, y, w, h);
      c.fillStyle = p.accentText; c.fillText(t, cx, cy, w - size); break;
    case "sketch":
      hatch(c, x, y, w, h, p.accent);
      c.strokeStyle = p.text; c.lineWidth = 3; roughRect(c, x, y, w, h, 8); c.stroke(); roughRect(c, x + 3, y - 2, w - 2, h + 3, 8, x + 99); c.stroke();
      c.fillStyle = p.text; c.fillText(t, cx, cy, w - size); break;
    default:
      c.fillStyle = p.accent; roundRect(c, x, y, w, h, h / 2); c.fill();
      c.fillStyle = p.accentText; c.fillText(t, cx, cy, w - size);
  }
  c.restore();
};

// A row's or card's box (score rows, the card layout's card).
export const drawPanel = (c, T, x, y, w, h, { solid = false, radius = 20 } = {}) => {
  const { p } = T;
  c.save();
  switch (T.look) {
    case "khata":
      if (solid) { c.shadowColor = "rgba(0,0,0,0.18)"; c.shadowBlur = 18; c.shadowOffsetY = 8; c.fillStyle = p.paper; c.fillRect(x, y, w, h); }
      else { c.strokeStyle = "rgba(29,63,138,0.45)"; c.lineWidth = 2; c.beginPath(); c.moveTo(x, y + h); c.lineTo(x + w, y + h); c.stroke(); } break;
    case "swiss":
      if (solid) { c.fillStyle = p.paper; c.fillRect(x, y, w, h); }
      c.fillStyle = p.text; c.fillRect(x, y, w, 4); break;
    case "sketch":
      if (solid) { c.fillStyle = p.paper; roughRect(c, x, y, w, h, 8); c.fill(); }
      c.strokeStyle = p.text; c.lineWidth = 3; roughRect(c, x, y, w, h, 8); c.stroke(); break;
    default:
      if (solid) {
        c.shadowColor = "rgba(0,0,0,0.3)"; c.shadowBlur = 40; c.shadowOffsetY = 14;
        c.fillStyle = p.paper; roundRect(c, x, y, w, h, radius); c.fill();
      } else {
        c.globalAlpha *= 0.14; c.fillStyle = p.text; roundRect(c, x, y, w, h, radius); c.fill();
      }
  }
  c.restore();
};

// A point's bullet, at (x, y) its middle.
export const drawBullet = (c, T, x, y, r) => {
  const { p } = T;
  c.save();
  switch (T.look) {
    case "khata": case "sketch":
      c.strokeStyle = T.look === "khata" ? p.head : p.text;
      c.lineWidth = r * 0.45; c.lineCap = "round"; c.lineJoin = "round";
      c.beginPath(); c.moveTo(x - r, y); c.lineTo(x - r * 0.25, y + r * 0.8); c.lineTo(x + r * 1.1, y - r * 0.9); c.stroke(); break;
    case "swiss":
      c.fillStyle = p.text; c.fillRect(x - r * 0.75, y - r * 0.75, r * 1.5, r * 1.5); break;
    default:
      c.fillStyle = p.accent; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  }
  c.restore();
};

// The headline's ink.
export const headInk = (c, T, color) => {
  c.fillStyle = color || T.p.head;
  if (T.L?.glow) { c.shadowColor = "rgba(255,255,255,0.45)"; c.shadowBlur = 8; }
};

// A look's own paper (drawn instead of the palette's gradient).
export const drawLookPaper = (ctx, T, { w, h, drift = 0 }) => {
  const { p } = T;
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, w, h);
  switch (T.look) {
    case "khata": {
      ctx.fillStyle = "#9DB8DD";
      for (let y = 140; y < h; y += 52) ctx.fillRect(0, y, w, 2);
      ctx.fillStyle = "#E07A7A";
      ctx.fillRect(T.L.margin - 22, 0, 3, h);
      break;
    }
    case "swiss": {
      ctx.fillStyle = p.accent;
      ctx.fillRect(w - w * 0.26, 0, w * 0.26, w * 0.26);
      break;
    }
    case "sketch": {
      ctx.strokeStyle = "rgba(34,34,34,0.18)";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      const squiggle = (x, y, s) => { ctx.beginPath(); ctx.moveTo(x, y); for (let k = 1; k <= 6; k++) ctx.quadraticCurveTo(x + k * s - s / 2, y + (k % 2 ? -s : s) * 0.6, x + k * s, y); ctx.stroke(); };
      squiggle(w - 260, 70, 34);
      squiggle(60, h - 60, 30);
      ctx.beginPath(); ctx.arc(w - 120, h - 150, 46, 0, Math.PI * 1.7); ctx.stroke();
      break;
    }
    default:
  }
};

// The picture on a hand-made look, as a thing on the page: a photo held
// taped in (notebook),
// a hard-edged block (Swiss), a stuck-on sticker (bold), a drawn frame
// (sketch). The picture is cropped to fill the frame.
export const drawPhoto = (c, T, img, x, y, w, h) => {
  const { p } = T;
  const fill = (fx, fy, fw, fh) => {
    const k = Math.max(fw / img.width, fh / img.height);
    const iw = img.width * k;
    const ih = img.height * k;
    c.save();
    c.beginPath();
    c.rect(fx, fy, fw, fh);
    c.clip();
    c.drawImage(img, fx + (fw - iw) / 2, fy + (fh - ih) / 2, iw, ih);
    c.restore();
  };
  const tilt = (deg) => { c.translate(x + w / 2, y + h / 2); c.rotate((deg * Math.PI) / 180); c.translate(-(x + w / 2), -(y + h / 2)); };
  c.save();
  switch (T.look) {
    case "khata": {
      tilt(3);
      c.shadowColor = "rgba(0,0,0,0.22)"; c.shadowBlur = 16; c.shadowOffsetY = 8;
      c.fillStyle = "#FFFFFF"; c.fillRect(x, y, w, h);
      c.shadowColor = "transparent";
      fill(x + 14, y + 14, w - 28, h - 28);
      c.fillStyle = "rgba(255,255,255,0.7)";
      for (const [tx, ty, r] of [[x - 18, y + 4, -0.6], [x + w - 46, y + h - 18, -0.6]]) { c.save(); c.translate(tx + 32, ty + 10); c.rotate(r); c.fillRect(-36, -12, 72, 24); c.restore(); }
      break;
    }
    case "swiss":
      fill(x, y, w, h);
      c.fillStyle = p.accent; c.fillRect(x, y + h - 14, w * 0.4, 14);
      break;
    case "sketch":
      fill(x + 6, y + 6, w - 12, h - 12);
      c.strokeStyle = p.text; c.lineWidth = 3;
      roughRect(c, x, y, w, h, 10); c.stroke();
      roughRect(c, x + 4, y - 3, w - 6, h + 4, 10, x + 77); c.stroke();
      break;
    default:
      fill(x, y, w, h);
  }
  c.restore();
};
