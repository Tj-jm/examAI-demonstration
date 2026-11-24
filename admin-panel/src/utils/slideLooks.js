// The slide looks (backend models/slideDeckModel.js look.preset). Shared by
// SlideView (editor, present mode, the server's PDF) and the .pptx export,
// so every output has the same colours and fonts.

export const SLIDE_FONTS = {
  inter: { css: "'Inter Tight', system-ui, sans-serif", pptx: "Calibri", label: "Inter" },
  poppins: { css: "'Poppins', system-ui, sans-serif", pptx: "Poppins", label: "Poppins" },
  serif: { css: "Georgia, 'Times New Roman', serif", pptx: "Georgia", label: "Georgia" },
  merriweather: { css: "'Merriweather', Georgia, serif", pptx: "Georgia", label: "Merriweather" },
  lora: { css: "'Lora', Georgia, serif", pptx: "Georgia", label: "Lora" },
  playfair: { css: "'Playfair Display', Georgia, serif", pptx: "Georgia", label: "Playfair" },
  condensed: { css: "'Roboto Condensed', 'Arial Narrow', sans-serif", pptx: "Arial Narrow", label: "Condensed" },
  hand: { css: "'Patrick Hand', 'Comic Sans MS', cursive", pptx: "Comic Sans MS", label: "Hand" },
  caveat: { css: "'Caveat', 'Comic Sans MS', cursive", pptx: "Segoe Print", label: "Caveat (chalk)" },
  archivo: { css: "'Archivo Black', Impact, sans-serif", pptx: "Arial Black", label: "Archivo Black" },
};
export const MONO = "ui-monospace, 'JetBrains Mono', Consolas, 'DejaVu Sans Mono', monospace";

// bg, text, muted, accent, panel (boxes, code), codeText, titleBg (the
// title and section slides' background), titleText, head/body fonts.
export const SLIDE_LOOKS = {
  clean: {
    label: "Clean", bg: "#ffffff", text: "#1f2937", muted: "#6b7280", accent: "#2563eb", panel: "#f3f4f6", codeText: "#111827",
    head: "inter", body: "inter", decor: "topbar",
  },
  chalk: {
    label: "Chalk", bg: "#23362b", text: "#f1efe6", muted: "#c9c6b8", accent: "#f6d365", panel: "#16241c", codeText: "#f1efe6",
    head: "caveat", body: "inter", decor: "chalk", headScale: 1.3,
  },
  bold: {
    label: "Bold", bg: "#ffffff", text: "#111111", muted: "#555555", accent: "#7c3aed", panel: "#f4f0ff", codeText: "#111111",
    titleBg: "#7c3aed", titleText: "#ffffff", head: "archivo", body: "inter", decor: "block",
  },
  academic: {
    label: "Academic", bg: "#fbfaf7", text: "#1c1917", muted: "#6b6259", accent: "#7f1d1d", panel: "#f1ede4", codeText: "#1c1917",
    head: "playfair", body: "lora", decor: "rules",
  },
  dark: {
    label: "Dark", bg: "#0f1117", text: "#e6e6e6", muted: "#9aa0aa", accent: "#22d3ee", panel: "#282a36", codeText: "#f8f8f2",
    head: "inter", body: "inter", decor: "hash",
  },
  soft: {
    label: "Soft", bg: "#fdf6f0", text: "#3f3a52", muted: "#7a7390", accent: "#8b5cf6", panel: "#ffffff", codeText: "#3f3a52",
    head: "poppins", body: "poppins", decor: "cards",
  },
  custom: {
    label: "Custom", bg: "#ffffff", text: "#1f2937", muted: "#6b7280", accent: "#0d9488", panel: "#f3f4f6", codeText: "#111827",
    head: "inter", body: "inter", decor: "topbar",
  },
};
export const SLIDE_PRESETS = Object.keys(SLIDE_LOOKS);

const mix = (hex, other, t) => {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [a, b] = [p(hex), p(other)];
  return `#${a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
};
const dark = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); return r * 0.299 + g * 0.587 + b * 0.114 < 140; };

// The deck's look, custom colours and fonts laid over the preset.
export const lookOf = (look = {}) => {
  const base = SLIDE_LOOKS[look.preset] || SLIDE_LOOKS.clean;
  if (look.preset !== "custom") return { ...base, preset: look.preset || "clean", logo: look.logo || "" };
  const bg = look.bg || base.bg;
  const text = look.text || (dark(bg) ? "#f5f5f5" : "#1f2937");
  return {
    ...base, preset: "custom", bg, text, accent: look.accent || base.accent,
    muted: mix(text, bg, 0.4), panel: mix(bg, text, 0.08), codeText: text,
    head: look.headFont || base.head, body: look.bodyFont || base.body,
    bgImage: look.bgImage || "", logo: look.logo || "",
  };
};
