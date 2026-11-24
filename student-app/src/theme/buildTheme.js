import { createTheme, alpha, lighten, darken, getContrastRatio } from "@mui/material/styles";
import { Slide } from "@mui/material";
import { themes, semantic, resolveMode } from "./tokens";
import { slideDown } from "../motion";

// A bare number is px at the default 16px root; as rem it follows the root size.
const pxToRem = (v) => (typeof v === "number" ? `${v / 16}rem` : v);

// Two axes, deliberately independent: theme (sixteen accent colors, always
// consistent with the admin panel) and design (which visual language wears
// that color). Layout — sidebar vs. bottom tabs, in Shell.jsx — is a third,
// also independent. An institution can be "web layout, editorial design,
// emerald theme" just as easily as "app layout, panel design, indigo theme".
//
// Design is pushed almost entirely into the theme itself — typography,
// shape, how Paper reads — rather than into per-page conditionals, so every
// existing and future page inherits it automatically instead of needing to
// remember to branch on it. The couple of spots that still branch (a solid
// color banner that would fight a restrained design's restraint) do so by
// reading design from BrandingContext directly, checking it against
// RESTRAINED_DESIGNS below, not from anything else here.

const DESIGNS = {
  // Energetic, app-native: rounded cards, bold sans throughout, generous
  // color. The original default — batch progress rings, streaks, a card
  // grid dashboard.
  panel: {
    borderRadius: 12,
    buttonRadius: 8,
    headingFamily: '"Inter", "Helvetica Neue", Arial, sans-serif',
    bodyFamily: '"Inter", "Helvetica Neue", Arial, sans-serif',
    headingWeight: 500,
    paperVariantBorder: 1,
    chipRadius: 16,
    letterSpacing: "normal",
    dividerOpacity: 1,
  },
  // Calm and paper-toned: the subject is a timed academic exercise, so the
  // job of the screen is to stay out of the way of thinking. Serif headings
  // — the exam-paper voice — sharp corners, hairline rules instead of soft
  // rounded tiles, restrained color (accent used for actions and correct/
  // selected states, never as a big decorative fill).
  editorial: {
    borderRadius: 3,
    buttonRadius: 3,
    headingFamily: '"Iowan Old Style", "Palatino Linotype", Georgia, serif',
    bodyFamily: '"Source Sans 3", "Source Sans Pro", "Helvetica Neue", Arial, sans-serif',
    headingWeight: 400,
    paperVariantBorder: 1,
    chipRadius: 3,
    letterSpacing: "0.01em",
    dividerOpacity: 0.9,
  },
  // Dense and technical: monospace throughout, square corners, tabular
  // numerals reading as data rather than decoration.
  mono: {
    borderRadius: 0,
    buttonRadius: 0,
    headingFamily: '"JetBrains Mono", ui-monospace, monospace',
    bodyFamily: '"JetBrains Mono", ui-monospace, monospace',
    headingWeight: 700,
    paperVariantBorder: 1,
    chipRadius: 0,
    letterSpacing: "0.02em",
    dividerOpacity: 0.9,
  },
  // Rounded and pastel: big radii, soft tinted surfaces, a friendlier
  // read than panel without going as loud as y2k.
  soft: {
    borderRadius: 20,
    buttonRadius: 20,
    headingFamily: '"Nunito", system-ui, sans-serif',
    bodyFamily: '"Nunito", system-ui, sans-serif',
    headingWeight: 800,
    paperVariantBorder: 1,
    chipRadius: 20,
    letterSpacing: "normal",
    dividerOpacity: 1,
  },
  // Tight and information-dense: smaller radii, system sans, built for
  // seeing more per screen rather than for decoration.
  compact: {
    borderRadius: 6,
    buttonRadius: 6,
    headingFamily: 'ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif',
    bodyFamily: 'ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif',
    headingWeight: 600,
    paperVariantBorder: 1,
    chipRadius: 6,
    letterSpacing: "normal",
    dividerOpacity: 0.9,
  },
  // Formal and print-derived: serif headings, sharp corners, generous
  // letter-spacing on labels — reads like a printed prospectus.
  classic: {
    borderRadius: 2,
    buttonRadius: 2,
    headingFamily: '"Playfair Display", "Lora", Georgia, serif',
    bodyFamily: '"PT Serif", Georgia, serif',
    headingWeight: 700,
    paperVariantBorder: 1,
    chipRadius: 2,
    letterSpacing: "0.03em",
    dividerOpacity: 0.9,
  },
  // Y2K web revival: big pill radii, rounded display sans, glossy pastel
  // gradients on the banner spots that read design directly.
  y2k: {
    borderRadius: 22,
    buttonRadius: 20,
    headingFamily: '"Baloo 2", system-ui, sans-serif',
    bodyFamily: '"Baloo 2", system-ui, sans-serif',
    headingWeight: 700,
    paperVariantBorder: 1,
    chipRadius: 22,
    letterSpacing: "normal",
    dividerOpacity: 1,
  },
  // Terminal-neon: monospace, small radii, meant to sit on a dark theme
  // (indigo/slate in dark mode) so the glow accents in the banner spots
  // actually read as glow rather than as a mistake.
  neon: {
    borderRadius: 8,
    buttonRadius: 6,
    headingFamily: '"JetBrains Mono", ui-monospace, monospace',
    bodyFamily: '"JetBrains Mono", ui-monospace, monospace',
    headingWeight: 600,
    paperVariantBorder: 1,
    chipRadius: 8,
    letterSpacing: "0.02em",
    dividerOpacity: 0.9,
  },
  // Retro-futuristic sunset: rounded glassy cards, a display face built for
  // short headings, generous radii — the loudest of the pastel/neon trio.
  vaporwave: {
    borderRadius: 14,
    buttonRadius: 14,
    headingFamily: '"Audiowide", system-ui, sans-serif',
    bodyFamily: '"Poppins", system-ui, sans-serif',
    headingWeight: 400,
    paperVariantBorder: 1,
    chipRadius: 14,
    letterSpacing: "0.02em",
    dividerOpacity: 1,
  },
  // 8-bit game UI: square corners throughout, a pixel display face for
  // headings only (body copy stays in the readable sans — a whole screen
  // of Press Start 2P is not actually legible at exam-taking sizes).
  pixel: {
    borderRadius: 0,
    buttonRadius: 0,
    headingFamily: '"Press Start 2P", monospace',
    bodyFamily: '"Inter", "Helvetica Neue", Arial, sans-serif',
    headingWeight: 400,
    paperVariantBorder: 1,
    chipRadius: 0,
    letterSpacing: "0.02em",
    dividerOpacity: 1,
  },
  // Hand-drawn: every card, button and chip outlined in a rough pen line,
  // handwritten headings, hatched banners. Body text stays a clear hand.
  sketch: {
    borderRadius: 10,
    buttonRadius: 10,
    headingFamily: '"Gloria Hallelujah", "Atma", "Comic Sans MS", cursive',
    bodyFamily: '"Patrick Hand", "Atma", "Hind Siliguri", "Helvetica Neue", Arial, sans-serif',
    headingWeight: 400,
    paperVariantBorder: 2,
    chipRadius: 10,
    letterSpacing: "0.01em",
    dividerOpacity: 1,
  },
  // An exercise notebook (khata): ruled paper with a red margin line,
  // paper cards taped on at a slight tilt, sticky-note chips, handwriting.
  khata: {
    borderRadius: 3,
    buttonRadius: 8,
    headingFamily: '"Kalam", "Atma", "Comic Sans MS", cursive',
    bodyFamily: '"Kalam", "Atma", "Hind Siliguri", "Helvetica Neue", Arial, sans-serif',
    headingWeight: 700,
    paperVariantBorder: 0,
    chipRadius: 3,
    letterSpacing: "normal",
    dividerOpacity: 1,
  },
  // A Swiss poster: strict sans, heavy rules instead of boxes, huge tight
  // headings and numbers, uppercase labels, square corners.
  swiss: {
    borderRadius: 0,
    buttonRadius: 0,
    headingFamily: '"Inter Tight", "Hind Siliguri", "Helvetica Neue", Arial, sans-serif',
    bodyFamily: '"Inter Tight", "Hind Siliguri", "Helvetica Neue", Arial, sans-serif',
    headingWeight: 800,
    paperVariantBorder: 0,
    chipRadius: 0,
    letterSpacing: "-0.01em",
    dividerOpacity: 1,
  },
  // Gradient-forward and glossy: rounded cards, circular gradient-ring
  // badges wherever a page has one, generous radii on both cards and
  // buttons.
  aurora: {
    borderRadius: 16,
    buttonRadius: 14,
    headingFamily: '"Inter", "Helvetica Neue", Arial, sans-serif',
    bodyFamily: '"Inter", "Helvetica Neue", Arial, sans-serif',
    headingWeight: 700,
    paperVariantBorder: 1,
    chipRadius: 16,
    letterSpacing: "normal",
    dividerOpacity: 1,
  },
  // Same as panel otherwise — the one thing this design changes is that
  // every card (every outlined Paper — see the MuiPaper override below)
  // lifts off the background with a soft shadow instead of sitting flush
  // against it inside a hairline border. Everything else (type, radii,
  // banner fills) is untouched, so this reads as "panel, but with depth"
  // rather than as its own unrelated look.
  depth: {
    borderRadius: 14,
    buttonRadius: 10,
    headingFamily: '"Inter", "Helvetica Neue", Arial, sans-serif',
    bodyFamily: '"Inter", "Helvetica Neue", Arial, sans-serif',
    headingWeight: 600,
    paperVariantBorder: 1,
    chipRadius: 14,
    letterSpacing: "normal",
    dividerOpacity: 1,
  },
};

// The "couple of spots" per-page (a solid banner, a score card) that still
// branch directly on design rather than through theme tokens — see the file
// header. They only ever need a two-way choice: a big, colorful fill (panel,
// soft, y2k) or a restrained, bordered/hairline treatment that a loud fill
// would fight (editorial, mono, compact, classic, neon). This is that list,
// shared so every branch point stays in sync when a new design is added.
// The web fonts each design is drawn in, fetched from Google Fonts by
// App.jsx (they aren't bundled). Without them every design fell back to the
// system font and most looked alike.
export const DESIGN_FONTS = {
  panel: ["Inter"],
  editorial: ["Source Sans 3"],
  mono: ["JetBrains Mono"],
  soft: ["Nunito"],
  compact: [],
  classic: ["Playfair Display", "PT Serif"],
  y2k: ["Baloo 2"],
  neon: ["JetBrains Mono"],
  vaporwave: ["Audiowide", "Poppins"],
  pixel: ["Press Start 2P", "Inter"],
  aurora: ["Inter"],
  depth: ["Inter"],
  sketch: ["Gloria Hallelujah", "Patrick Hand", "Atma"],
  khata: ["Kalam", "Atma"],
  swiss: ["Inter Tight", "Hind Siliguri"],
};


// A hand-drawn outline in plain CSS: uneven elliptical corners make a
// straight border wobble like a pen line. Two shapes, alternated between
// neighbouring cards so they don't all wobble alike.
const HAND = "255px 15px 225px 15px / 15px 225px 15px 255px";
const HAND2 = "15px 225px 15px 255px / 255px 15px 225px 15px";
const HAND_SMALL = "14px 4px 16px 5px / 5px 15px 4px 14px";

export const RESTRAINED_DESIGNS = new Set(["editorial", "mono", "compact", "classic", "neon"]);

// The same "couple of spots" from RESTRAINED_DESIGNS above (Dashboard's
// continue-watching banner, BatchHome's header, ExamResult's score card,
// PaymentShell's top bar, Shell's logo square) also used to be the ONE
// place every bold-fill design actually diverged visually from panel — and
// until now they all drew the exact same flat theme.palette.primary.main
// fill no matter which design was active, which is why y2k / vaporwave /
// aurora / pixel / neon read as visually identical to panel despite being
// described (Settings.jsx's hint text) as gradient, glow or arcade-styled.
// This is the actual per-design treatment for those spots: a CSS
// `background` value — solid for panel/pixel, gradient for soft/y2k/
// vaporwave/aurora, a dark glow box for neon — built from the ACTIVE
// theme's own accent color (via lighten/darken/alpha) so two institutions
// on the same design still look different if they picked different theme
// colors, plus the text color and any extra border/shadow that spot needs.
// Call this only from a spot already gated by `!RESTRAINED_DESIGNS.has(design)`
// — a restrained design keeps its hairline/bordered look untouched.
// Text and icons on a coloured fill: white when it reads at 4.5:1 (WCAG
// AA) on every colour of the fill, otherwise whichever of white or dark ink
// reads better on its worst colour. A light accent (most themes' dark-mode
// accent, or a pale custom one) used to get white text regardless.
const DARK_INK = "#14161A";
export const readableOn = (...colors) => {
  const worst = (ink) => Math.min(...colors.map((c) => getContrastRatio(c, ink)));
  const white = worst("#FFFFFF");
  return white >= 4.5 || white >= worst(DARK_INK) ? "#FFFFFF" : DARK_INK;
};

export const getBoldFill = (design, theme) => {
  const accent = theme.palette.primary.main;
  // A custom theme's own gradient replaces a gradient design's built-in one.
  const g = theme.examai?.customGradient;
  if (g && ["soft", "y2k", "vaporwave", "aurora"].includes(design)) {
    const stops = [g.from, g.via, g.to].filter(Boolean);
    return { background: `linear-gradient(${g.angle ?? 135}deg, ${stops.join(", ")})`, color: readableOn(...stops) };
  }

  switch (design) {
    case "soft":
      // A single-hue radial highlight, not a rainbow — soft's own identity
      // is "pastel and friendly," not "loud gradient."
      return {
        background: `radial-gradient(circle at 28% 22%, ${lighten(accent, 0.32)} 0%, ${accent} 75%)`,
        color: readableOn(lighten(accent, 0.32), accent),
      };
    case "y2k":
      // Glossy, light, bubble-chrome — a bright cool-to-cooler sweep tinted
      // through the active accent, not tied to any one theme's hue.
      return {
        background: `linear-gradient(135deg, ${lighten(accent, 0.35)} 0%, ${lighten(accent, 0.08)} 45%, ${darken(accent, 0.05)} 100%)`,
        color: readableOn(lighten(accent, 0.35), lighten(accent, 0.08), darken(accent, 0.05)),
      };
    case "vaporwave":
      // Dark, moody sunset — deep violet through the accent into hot pink,
      // vertical-leaning like the reference. The one bold-fill design that
      // stays dark regardless of the fill itself being "colorful."
      return {
        background: `linear-gradient(160deg, #2E1A47 0%, ${accent} 45%, #FF6AA9 78%, #FFC26A 100%)`,
        // Text sits over the darker upper part, so the pale end is left out.
        color: readableOn("#2E1A47", accent),
      };
    case "aurora":
      // Bright, glossy, cyan-to-magenta through the accent — the gradient
      // banner this design is named for.
      return {
        background: `linear-gradient(115deg, #1EA7E0 0%, ${accent} 50%, #E63CA0 100%)`,
        color: readableOn("#1EA7E0", accent, "#E63CA0"),
      };
    case "neon":
      // Not a gradient — a dark glow box, independent of light/dark mode,
      // because neon's whole point (terminal on black) reads as a mistake
      // on a light fill.
      return {
        background: "#0B0E14",
        color: accent,
        border: `1px solid ${alpha(accent, 0.5)}`,
        boxShadow: `0 0 24px ${alpha(accent, 0.35)}`,
      };
    case "sketch": {
      // Pen hatching in the accent over paper, in a rough ink outline.
      const dark = theme.palette.mode === "dark";
      const ink = dark ? theme.palette.text.primary : "#222222";
      const paper = theme.palette.background.paper;
      return {
        background: `repeating-linear-gradient(-45deg, ${alpha(accent, dark ? 0.5 : 0.35)} 0 2px, transparent 2px 8px), ${paper}`,
        color: theme.palette.text.primary,
        border: `2px solid ${ink}`,
        borderRadius: HAND_SMALL,
        boxShadow: "none",
      };
    }
    case "swiss":
      // A flat colour block, square, no frame.
      return { background: accent, color: readableOn(accent), borderRadius: "0px", boxShadow: "none" };
    case "khata":
      // A sheet of coloured paper, slightly lifted off the page.
      return { background: accent, color: readableOn(accent), borderRadius: "3px", boxShadow: "0 1px 1px rgba(0,0,0,0.08), 0 8px 18px rgba(40,40,60,0.18)" };
    case "pixel":
      // Flat fill, but with the chunky border + hard offset shadow that
      // actually reads as "arcade UI" — a gradient would fight the flat-
      // color 8-bit look, so the differentiation here is the border/shadow.
      return {
        background: accent,
        color: readableOn(accent),
        border: "3px solid #14161A",
        borderRadius: 0,
        boxShadow: "4px 4px 0 #14161A",
      };
    default:
      // panel, and any future bold-fill design without its own treatment.
      return { background: accent, color: readableOn(accent) };
  }
};

// The preset themes differ only in their accent, on near-identical white
// (or near-black) pages, so most of them looked alike. Each preset's page,
// alt surfaces and borders are tinted with its accent, enough to give it a
// colour of its own; text, cards in light mode and the accent itself are
// left as they are. Slate and graphite stay neutral, and a custom theme is
// used exactly as entered.
const NEUTRAL_THEMES = new Set(["slate", "graphite", "custom"]);
const mix = (color, base, amount) => {
  const toRgb = (hex) => {
    const h = hex.replace("#", "");
    const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
  };
  const a = toRgb(color);
  const b = toRgb(base);
  return `#${a.map((c, i) => Math.round(b[i] + (c - b[i]) * amount).toString(16).padStart(2, "0")).join("")}`;
};
const withIdentity = (t, mode, themeName) => {
  if (NEUTRAL_THEMES.has(themeName)) return t;
  if (mode === "dark") {
    return {
      ...t,
      bg: mix(t.accent, "#0D0E11", 0.09),
      surface: mix(t.accent, "#16181C", 0.08),
      surfaceAlt: mix(t.accent, "#1E2025", 0.14),
      border: mix(t.accent, "#2A2D33", 0.22),
    };
  }
  return {
    ...t,
    bg: mix(t.accent, "#FFFFFF", 0.06),
    surfaceAlt: mix(t.accent, "#FFFFFF", 0.11),
    border: mix(t.accent, "#FFFFFF", 0.2),
  };
};

// What each reworked design changes beyond corners and fonts: how cards,
// buttons and chips look, the page itself, and spacing. Pushed through the
// theme so every page gets it, and kept when an admin sets their own font.
// Panel, editorial, depth and pixel aren't listed: they keep their look.
const designLayer = (design, t, dark) => {
  const glass = (a) => alpha(t.surface, a);
  switch (design) {
    case "soft":
      // Tinted, borderless cards on a soft coloured shadow; pill buttons.
      return {
        card: { borderColor: "transparent", backgroundColor: mix(t.accent, t.surface, dark ? 0.06 : 0.035), boxShadow: `0 6px 22px ${alpha(t.accent, dark ? 0.18 : 0.1)}` },
        button: { borderRadius: 999, paddingLeft: 18, paddingRight: 18 },
        chip: { borderRadius: 999, fontWeight: 600 },
      };
    case "sketch": {
      // Rough pen outlines everywhere; a faint second stroke on buttons.
      const ink = dark ? t.text : "#222222";
      return {
        page: dark ? t.bg : mix(t.accent, "#FFFDF8", 0.03),
        hoverShadow: `3px 4px 0 -1px ${alpha(ink, 0.35)}`,
        card: { border: `2px solid ${ink}`, borderRadius: HAND, boxShadow: "none", "&:nth-of-type(even)": { borderRadius: HAND2 } },
        button: {
          borderRadius: HAND_SMALL,
          border: `2px solid ${ink}`,
          "&::after": { content: '""', position: "absolute", inset: -3, border: `1.5px solid ${alpha(ink, 0.35)}`, borderRadius: "5px 16px 4px 15px / 15px 4px 14px 5px", pointerEvents: "none" },
        },
        chip: { border: `1.5px solid ${ink}`, borderRadius: HAND_SMALL },
      };
    }
    case "swiss": {
      // No boxes: a heavy rule above each block, tight heavy type, labels
      // in small uppercase.
      const ink = dark ? t.text : "#111111";
      return {
        page: dark ? t.bg : mix(t.accent, "#F4F2EE", 0.02),
        hoverShadow: "none",
        card: { border: "none", borderTop: `3px solid ${ink}`, borderRadius: 0, boxShadow: "none", backgroundColor: "transparent" },
        button: { textTransform: "uppercase", fontWeight: 800, letterSpacing: "0.02em", borderRadius: 0 },
        chip: { borderRadius: 0, textTransform: "uppercase", fontWeight: 700, fontSize: 11, letterSpacing: "0.04em" },
        caption: { textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 },
        heading: { letterSpacing: "-0.03em" },
        divider: { borderColor: ink, borderBottomWidth: 2, opacity: 1 },
      };
    }
    case "khata": {
      // Ruled exercise-book paper: blue rules every line, a red margin line
      // (wide screens only; on a phone it would run through the text).
      const rule = alpha("#6f9bd6", dark ? 0.16 : 0.32);
      const margin = alpha("#e06b6b", dark ? 0.4 : 0.65);
      const paper = dark ? t.bg : mix(t.accent, "#FDFBF3", 0.03);
      const lines = `repeating-linear-gradient(180deg, transparent 0 27px, ${rule} 27px 28px)`;
      return {
        page: `${lines}, ${paper}`,
        pageWide: `linear-gradient(90deg, transparent 47px, ${margin} 47px, ${margin} 49px, transparent 49px), ${lines}, ${paper}`,
        hoverShadow: `0 2px 2px rgba(0,0,0,0.08), 0 12px 22px ${alpha(dark ? "#000000" : "#28283c", dark ? 0.55 : 0.18)}`,
        // A tapable card is a piece of paper taped on, a little crooked.
        tilt: true,
        card: { border: "none", borderRadius: 3, backgroundColor: t.surface, boxShadow: `0 1px 1px rgba(0,0,0,0.06), 0 6px 14px ${alpha(dark ? "#000000" : "#28283c", dark ? 0.5 : 0.12)}` },
        button: { borderRadius: HAND_SMALL, fontWeight: 700 },
        // A plain chip is a sticky note.
        chip: (o) => (o.color === "default" && o.variant !== "outlined"
          ? { backgroundColor: "#FFF27A", color: "#3A3200", borderRadius: 2, boxShadow: "0 2px 4px rgba(0,0,0,0.15)", transform: "rotate(-1.5deg)" }
          : { borderRadius: HAND_SMALL }),
      };
    }
    case "compact":
      // Denser: tighter spacing, smaller type, small controls.
      return {
        spacing: 6,
        fontSize: 13,
        buttonSize: "small",
        card: { boxShadow: "none" },
        chip: { height: 22, fontSize: 12 },
      };
    case "classic":
      // Printed-prospectus sections: a heavy rule on top, a hairline below,
      // no box; small-caps labels and letter-spaced buttons.
      return {
        card: { border: "none", borderTop: `2px solid ${t.text}`, borderBottom: `1px solid ${t.border}`, borderRadius: 0, boxShadow: "none" },
        button: { textTransform: "uppercase", letterSpacing: "0.12em", fontSize: 12.5, borderRadius: 0 },
        chip: { borderRadius: 0, fontVariant: "small-caps", letterSpacing: "0.06em" },
        caption: { fontVariant: "small-caps", letterSpacing: "0.05em" },
      };
    case "mono":
      // Terminal panes: dashed high-contrast outlines, square, flat.
      return {
        card: { border: `1px dashed ${alpha(t.text, dark ? 0.45 : 0.4)}`, borderRadius: 0, boxShadow: "none" },
        button: { textTransform: "uppercase", letterSpacing: "0.06em", borderRadius: 0 },
        chip: { borderRadius: 0, border: `1px solid ${alpha(t.text, 0.35)}` },
      };
    case "neon":
      // Glowing outlines on black.
      return {
        page: "#07080B",
        card: { backgroundColor: "#0D0F14", border: `1px solid ${alpha(t.accent, 0.45)}`, boxShadow: `0 0 18px ${alpha(t.accent, 0.16)}, inset 0 0 12px ${alpha(t.accent, 0.05)}` },
        button: { boxShadow: `0 0 14px ${alpha(t.accent, 0.55)}`, "&:hover": { boxShadow: `0 0 22px ${alpha(t.accent, 0.8)}` } },
        chip: { border: `1px solid ${alpha(t.accent, 0.5)}`, boxShadow: `0 0 8px ${alpha(t.accent, 0.25)}` },
      };
    case "y2k":
      // Glossy bubbles: a shine on cards and buttons, thick soft outline.
      return {
        // The shine is translucent, so a card a page fills with a colour
        // (primary.main and the like) keeps it and its text stays readable.
        card: { border: `2px solid ${alpha(t.accent, dark ? 0.35 : 0.22)}`, backgroundColor: mix(t.accent, t.surface, dark ? 0.08 : 0.05), backgroundImage: `linear-gradient(180deg, ${alpha("#FFFFFF", dark ? 0.06 : 0.45)}, ${alpha("#FFFFFF", 0)} 60%)`, boxShadow: `0 4px 0 ${alpha(t.accent, 0.12)}` },
        button: { borderRadius: 999, backgroundImage: `linear-gradient(180deg, ${alpha("#FFFFFF", 0.35)}, ${alpha("#FFFFFF", 0)} 55%)`, boxShadow: `inset 0 -2px 0 ${alpha("#000000", 0.15)}` },
        chip: { borderRadius: 999, fontWeight: 600 },
      };
    case "vaporwave":
      // A sunset page with frosted-glass cards.
      return {
        page: dark
          ? `linear-gradient(170deg, #1B0F33 0%, #2B1140 45%, #3A1235 75%, #24122E 100%)`
          : `linear-gradient(170deg, #F3E8FF 0%, #FFE3F1 45%, #FFEBDD 80%, #FFF4E6 100%)`,
        card: { backgroundColor: glass(dark ? 0.55 : 0.68), backdropFilter: "blur(12px)", border: `1px solid ${alpha("#FFFFFF", dark ? 0.12 : 0.6)}`, boxShadow: `0 8px 28px ${alpha("#5B2A86", dark ? 0.35 : 0.12)}` },
        button: { backgroundImage: "linear-gradient(90deg, rgba(255,106,169,0.0), rgba(255,106,169,0.35))" },
        chip: { backdropFilter: "blur(6px)" },
      };
    case "aurora":
      // Soft colour washes behind glassy cards.
      return {
        page: `radial-gradient(60% 50% at 10% 0%, ${alpha("#1EA7E0", dark ? 0.22 : 0.16)}, transparent 70%), radial-gradient(50% 45% at 95% 10%, ${alpha("#E63CA0", dark ? 0.2 : 0.13)}, transparent 70%), radial-gradient(60% 50% at 50% 100%, ${alpha(t.accent, dark ? 0.22 : 0.14)}, transparent 70%), ${t.bg}`,
        card: { backgroundColor: glass(dark ? 0.62 : 0.78), backdropFilter: "blur(14px)", border: `1px solid ${alpha("#FFFFFF", dark ? 0.1 : 0.7)}`, boxShadow: `0 10px 30px ${alpha(t.accent, dark ? 0.2 : 0.1)}` },
        chip: { fontWeight: 600 },
      };
    default:
      return {};
  }
};

export const buildTheme = (themeName, mode, design = "panel", customTheme = null, fonts = null) => {
  // "custom" isn't a key in the themes map above — its palette comes from
  // admin-entered settings instead (studentUi.customTheme, see
  // appSettingsModel.js), passed straight through by App.jsx. Same
  // light/dark shape as every preset, so nothing below this line needs to
  // know or care which case it is.
  const theme = themeName === "custom" && customTheme ? customTheme : (themes[themeName] || themes.slate);
  // Neon is a terminal on black: always dark, whatever the mode.
  const resolved = design === "neon" ? "dark" : resolveMode(mode);
  const t = withIdentity(theme[resolved], resolved, themeName);
  const s = semantic[resolved];
  const d = DESIGNS[design] || DESIGNS.panel;
  const L = designLayer(design, t, resolved === "dark");
  // A solid page colour of the design's own (neon) replaces the theme's.
  const pageColor = L.pageColor || (L.page && L.page.startsWith("#") ? L.page : t.bg);

  // Free-text admin override (studentUi.fonts, appSettingsModel.js) — the
  // design's own font stays as the fallback tail rather than being replaced
  // outright, so a mistyped/unloaded family degrades to the design's normal
  // look instead of the browser's serif default. App.jsx is what actually
  // fetches these families from Google Fonts by name; this just wires the
  // CSS family name into the same typography keys DESIGNS already fills.
  const headingFamily = fonts?.heading ? `"${fonts.heading}", ${d.headingFamily}` : d.headingFamily;
  const bodyFamily = fonts?.body ? `"${fonts.body}", ${d.bodyFamily}` : d.bodyFamily;

  // "depth"'s one distinguishing trait: every outlined Paper gets a real
  // shadow instead of a hairline border. Dark mode needs a noticeably
  // stronger shadow than light mode to read at all against an already-dark
  // background — the same alpha that's subtle on a white surface is
  // invisible on a near-black one.
  const cardShadow = design === "depth"
    ? (resolved === "dark" ? "0 4px 18px rgba(0,0,0,0.5)" : "0 2px 10px rgba(15,23,42,0.09), 0 1px 3px rgba(15,23,42,0.06)")
    : "none";

  return createTheme({
    // sx={{ fontSize: 13 }} becomes 0.8125rem instead of 13px, so the
    // student's text size (utils/textSize.js, the root font size) reaches
    // every screen, not only the theme's own rem-based variants.
    unstable_sxConfig: { fontSize: { themeKey: "typography", transform: pxToRem } },
    // Not MUI's: a custom theme's banner gradient, when on. Kept out of the
    // palette, where MUI reads .main off every entry and a null crashed it.
    examai: {
      customGradient: themeName === "custom" && customTheme?.gradient?.enabled && customTheme.gradient.from && customTheme.gradient.to
        ? customTheme.gradient
        : null,
      // Kept so a page can rebuild this theme in other colours (CoursePage).
      fonts,
      // A course page custom theme's banner colours (CourseDesigns.jsx).
      banner: themeName === "custom" ? customTheme?.banner || null : null,
    },
    palette: {
      mode: resolved,
      primary: { main: t.accent, contrastText: readableOn(t.accent) },
      // Hover and selected tints in the theme's own colour, not grey.
      ...(NEUTRAL_THEMES.has(themeName) ? {} : { action: { hover: alpha(t.accent, 0.07), selected: alpha(t.accent, 0.13) } }),
      background: { default: pageColor, paper: design === "neon" ? "#0D0F14" : L.paper || t.surface },
      text: L.text || { primary: t.text, secondary: t.textMuted },
      divider: L.border || t.border,
      success: { main: s.correct },
      error: { main: s.incorrect },
      warning: { main: s.warning },
      // Not a real MUI palette key — read explicitly where an AI-written
      // solution needs the same tint the admin panel gives one.
      ai: { main: s.ai, bg: s.aiBg },
      correctBg: s.correctBg,
      incorrectBg: s.incorrectBg,
      warningBg: s.warningBg,
      surfaceAlt: t.surfaceAlt,
    },
    // Pages give corners as multiples of this (borderRadius: 3 is three
    // of it), so a large design radius turned tall tiles into ovals. Capped
    // at panel's own 12 (depth keeps its 14); the design's own radius still
    // applies to Paper and Card.
    shape: { borderRadius: design === "depth" ? d.borderRadius : Math.min(d.borderRadius, 12) },
    ...(L.spacing ? { spacing: L.spacing } : {}),
    typography: {
      fontFamily: bodyFamily,
      ...(L.fontSize ? { fontSize: L.fontSize } : {}),
      ...(L.caption ? { caption: L.caption, overline: L.caption } : {}),
      h1: { fontFamily: headingFamily, fontWeight: d.headingWeight, ...(L.heading || {}) },
      h2: { fontFamily: headingFamily, fontWeight: d.headingWeight, ...(L.heading || {}) },
      h3: { fontFamily: headingFamily, fontWeight: d.headingWeight, ...(L.heading || {}) },
      h4: { fontFamily: headingFamily, fontWeight: d.headingWeight, ...(L.heading || {}) },
      h5: { fontFamily: headingFamily, fontWeight: d.headingWeight, letterSpacing: d.letterSpacing, ...(L.heading || {}) },
      h6: { fontFamily: headingFamily, fontWeight: d.headingWeight, letterSpacing: d.letterSpacing, ...(L.heading || {}) },
      button: { textTransform: "none", fontWeight: 500, fontFamily: bodyFamily },
    },
    components: {
      MuiButton: {
        ...(L.buttonSize ? { defaultProps: { size: L.buttonSize } } : {}),
        styleOverrides: {
          root: {
            borderRadius: d.buttonRadius,
            boxShadow: "none",
            ...(L.button || {}),
          },
          containedPrimary: { "&:hover": { boxShadow: "none" } },
        },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          // A card you can tap (an onClick or a link) lifts a little under
          // the pointer and presses in when tapped.
          root: ({ ownerState }) => ({
            ...(ownerState.onClick || ownerState.to || ownerState.href
              ? {
                  transition: "transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease",
                  "@media (hover: hover)": {
                    "&:hover": { transform: "translateY(-2px)", boxShadow: L.hoverShadow || "0 6px 18px rgba(0, 0, 0, 0.08)" },
                  },
                  "&:active": { transform: "scale(0.985)" },
                  // Khata: taped on, a little crooked, alternating.
                  ...(L.tilt && ownerState.variant === "outlined"
                    ? {
                        position: "relative",
                        overflow: "visible",
                        transform: "rotate(-0.6deg)",
                        "&:nth-of-type(even)": { transform: "rotate(0.5deg)" },
                        "@media (hover: hover)": { "&&:hover": { transform: "rotate(0deg) translateY(-2px)", boxShadow: L.hoverShadow } },
                        "&::before": { content: '""', position: "absolute", top: -9, left: "50%", width: 64, height: 18, marginLeft: "-32px", background: "rgba(240, 220, 140, 0.75)", transform: "rotate(-3deg)", boxShadow: "0 1px 2px rgba(0,0,0,0.1)", pointerEvents: "none", zIndex: 1 },
                      }
                    : {}),
                }
              : null),
            backgroundImage: "none",
            // Editorial's "card" is a document section, not a soft tile —
            // a plain hairline rather than the rounded, slightly heavier
            // outline panel's tiles use. "depth" keeps the same 1px border
            // width (so nothing shifts size against every other design)
            // but makes it transparent — the shadow below is what actually
            // separates the card from the page instead.
            borderColor: design === "depth" ? "transparent" : t.border,
            boxShadow: cardShadow,
            // The design's own card look, on outlined (card) Paper only.
            ...(ownerState.variant === "outlined" ? (L.card || {}) : {}),
          }),
        },
      },
      MuiAppBar: {
        defaultProps: { elevation: 0 },
      },
      // Messages slide in rather than just appearing: an inline alert drops
      // into place, a toast slides up from the edge.
      MuiAlert: {
        styleOverrides: { root: { animation: `${slideDown} 260ms ease-out` } },
      },
      MuiSnackbar: {
        defaultProps: { TransitionComponent: Slide },
      },
      // Loading placeholders shimmer rather than blink.
      MuiSkeleton: {
        defaultProps: { animation: "wave" },
      },
      MuiChip: {
        styleOverrides: {
          root: ({ ownerState }) => ({ borderRadius: d.chipRadius, ...(typeof L.chip === "function" ? L.chip(ownerState) : L.chip || {}) }),
        },
      },
      MuiCard: {
        styleOverrides: {
          root: { borderRadius: d.borderRadius },
        },
      },
      // The hairline-leaning designs lean on dividers between sections more
      // than panel/soft/y2k do, so their rule lines read a touch more
      // deliberately than a default hairline would — dividerOpacity per
      // design controls that, always defined so this key is never
      // undefined (that was crashing createTheme's internal merge).
      MuiDivider: { styleOverrides: { root: { borderColor: L.border || t.border, opacity: d.dividerOpacity, ...(L.divider || {}) } } },
      ...(L.radio ? { MuiRadio: { styleOverrides: { root: L.radio } } } : {}),
      // The browser's own scrollbar (chunky, square, OS-themed) is the one
      // thing on the page that never picked up any theme — most visible on
      // a MUI Dialog, which scrolls its own Paper with that same default
      // bar. Reskinned everywhere at once, off the current theme's own
      // tokens, so it stays consistent across all 22 presets and a custom
      // palette alike rather than needing a per-component override.
      MuiCssBaseline: {
        styleOverrides: {
          "*::-webkit-scrollbar": { width: 8, height: 8 },
          "*::-webkit-scrollbar-track": { background: "transparent" },
          "*::-webkit-scrollbar-thumb": {
            background: t.border,
            borderRadius: 8,
            border: "2px solid transparent",
            backgroundClip: "padding-box",
          },
          "*::-webkit-scrollbar-thumb:hover": { background: t.textMuted },
          "*": { scrollbarWidth: "thin", scrollbarColor: `${t.border} transparent` },
          // Large text sizes (utils/textSize.js) made a long heading or a
          // row of controls wider than a phone, and the whole page slid
          // sideways. Long words wrap, and nothing scrolls the page
          // sideways ("clip", unlike "hidden", keeps sticky headers working).
          "html, body": { overflowX: "clip", maxWidth: "100%" },
          "h1, h2, h3, h4, h5, h6, p": { overflowWrap: "break-word" },
          "img, video, canvas, iframe": { maxWidth: "100%" },
          // Wide content scrolls on its own instead of being cut off by the
          // page clip above: tables, code blocks, long display equations.
          ".md-table-wrap": { overflowX: "auto", maxWidth: "100%", WebkitOverflowScrolling: "touch" },
          "pre, .katex-display": { overflowX: "auto", maxWidth: "100%" },
          ".katex-display": { overflowY: "hidden" },
          // Cards built from a plain Box (the landing page's) take the same
          // outline and shadow as an outlined Paper in this design.
          // Pixel's are chunky: a thick ink border and a hard offset shadow,
          // like its banners (accent-coloured in dark mode, where black
          // wouldn't show).
          ".examai-card": ["sketch", "khata", "swiss"].includes(design)
            ? { ...L.card, "&:nth-of-type(even)": undefined }
            : design === "pixel"
            ? {
                border: `2px solid ${resolved === "dark" ? t.accent : "#14161A"}`,
                boxShadow: `4px 4px 0 ${resolved === "dark" ? t.accent : "#14161A"}`,
              }
            : {
                border: `1px solid ${design === "depth" ? "transparent" : t.border}`,
                boxShadow: cardShadow,
                ...(L.card || {}),
              },
          // A gradient page for the designs that have one.
          ...(L.page && !L.page.startsWith("#") ? { body: { background: L.page, backgroundAttachment: "fixed" } } : {}),
          ...(L.pageWide ? { "@media (min-width: 900px)": { body: { background: L.pageWide, backgroundAttachment: "fixed" } } } : {}),
        },
      },
    },
  });
};