// One brand colour in, a whole student-app palette out (the same nine
// colours, light and dark, as a hand-set custom theme), with the accent
// moved just far enough to stay readable as a button and as text.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export const hexToRgb = (hex) => {
  const h = String(hex || "").replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};
const rgbToHex = (rgb) => `#${rgb.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

const rgbToHsl = ([r, g, b]) => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b); const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s * 100, l * 100];
};
const hsl = (h, s, l) => {
  s = clamp(s, 0, 100) / 100; l = clamp(l, 0, 100) / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return rgbToHex([f(0) * 255, f(8) * 255, f(4) * 255]);
};

const luminance = (hex) => {
  const c = hexToRgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
export const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// The brand colour, darkened (on light) or lightened (on dark) only as much
// as it takes to read at `ratio` against `against`.
const readable = (hex, against, ratio, darker) => {
  const [h, s, l0] = rgbToHsl(hexToRgb(hex));
  let l = l0;
  let out = hsl(h, s, l);
  for (let i = 0; i < 100 && contrast(out, against) < ratio; i++) {
    l += darker ? -1 : 1;
    if (l <= 0 || l >= 100) break;
    out = hsl(h, s, l);
  }
  return out;
};

export function paletteFrom(brand) {
  const rgb = hexToRgb(brand);
  if (!rgb) return null;
  const [h, s0] = rgbToHsl(rgb);
  // A grey brand gets plain neutrals; a coloured one tints them slightly.
  const s = s0 < 8 ? 0 : s0;
  const tint = (amount) => Math.min(s, amount);
  const lightBg = hsl(h, tint(30), 98);
  const darkSurface = hsl(h, tint(18), 10.5);
  const light = {
    primary: hsl(h, tint(35), 12),
    primaryFg: "#FFFFFF",
    accent: readable(brand, "#FFFFFF", 4.5, true),
    bg: lightBg,
    surface: "#FFFFFF",
    surfaceAlt: hsl(h, tint(22), 94.5),
    border: hsl(h, tint(16), 89),
    text: hsl(h, tint(25), 11),
    textMuted: readable(hsl(h, tint(10), 48), lightBg, 4.5, true),
  };
  const darkBg = hsl(h, tint(18), 7);
  const dark = {
    primary: hsl(h, tint(20), 91),
    primaryFg: hsl(h, tint(25), 10),
    accent: readable(brand, darkSurface, 4.5, false),
    bg: darkBg,
    surface: darkSurface,
    surfaceAlt: hsl(h, tint(16), 14),
    border: hsl(h, tint(14), 19),
    text: hsl(h, tint(15), 91),
    textMuted: readable(hsl(h, tint(10), 58), darkSurface, 4.5, false),
  };
  // For the gradient designs: the brand into a neighbouring hue.
  const gradient = { enabled: true, from: light.accent, via: "", to: hsl((h + 40) % 360, Math.max(45, s), 50), angle: 135 };
  return { light, dark, gradient, moved: light.accent !== String(brand).toUpperCase() };
}

// A few main colours of a picture (the logo), most common first: near-white,
// near-black and grey pixels skipped, similar colours counted together.
export function logoColors(url) {
  return new Promise((resolve) => {
    if (!url) { resolve([]); return; }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const size = 64;
        const c = document.createElement("canvas");
        c.width = size; c.height = size;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        const buckets = new Map();
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 200) continue;
          const [hh, ss, ll] = rgbToHsl([data[i], data[i + 1], data[i + 2]]);
          if (ss < 22 || ll < 12 || ll > 92) continue;
          const key = `${Math.round(hh / 20)}-${Math.round(ll / 25)}`;
          const b = buckets.get(key) || { n: 0, r: 0, g: 0, bl: 0 };
          b.n++; b.r += data[i]; b.g += data[i + 1]; b.bl += data[i + 2];
          buckets.set(key, b);
        }
        resolve([...buckets.values()].sort((a, b) => b.n - a.n).slice(0, 5).map((b) => rgbToHex([b.r / b.n, b.g / b.n, b.bl / b.n])));
      } catch {
        resolve([]); // a logo from another site that doesn't allow reading it
      }
    };
    img.onerror = () => resolve([]);
    img.src = url;
  });
}
